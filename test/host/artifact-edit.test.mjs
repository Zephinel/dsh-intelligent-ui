/**
 * Host regression test: a structured block edit envelope observed on the user
 * message stream is validated, applied by the next render_ui call and recorded
 * as a new immutable artifact revision.
 *
 *   node scripts/build.mjs host
 *   node --test test/host/artifact-edit.test.mjs
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ARTIFACT_EDIT_CLOSE, ARTIFACT_EDIT_OPEN, ARTIFACT_PROGRAM_CLOSE, ARTIFACT_PROGRAM_OPEN,
  blockEditToolContract, buildBlockEditToolArgs, buildEditRequestText, buildStyleEditRequestText, buildStyleEditToolArgs, isArtifactRevisionMeta, styleEditToolContract,
} from '../../src/shared/artifact-edit.ts'
import { extractArtifactBlocks, readRootLayout, reorderProgramToTargetOrder } from '../../src/shared/artifact-blocks.ts'
import { extractBlockBundle } from '../../src/shared/artifact-block-bundle.ts'
import { ARTIFACT_EDIT_TTL, createArtifactEditController } from '../../src/host/artifact-edit.ts'
import { describeArticleLayoutProblem, inspectProgram } from '../../src/host/program-validation.ts'
import { createArtifactRevisionStore } from '../../src/host/artifact-revisions.ts'
import { assertDshToolSchema } from '../../src/host/tool-schema.ts'
import { DST_PROGRAM, DST_TITLE } from '../browser/fixtures/dst-artifact.ts'
import { NESTED_PROGRAM, NESTED_TITLE } from '../browser/fixtures/nested-artifact.ts'
import { buildArtifactTree } from '../../src/shared/program-cst.ts'
import { THEME, template } from './style-fixtures.mjs'

const plugin = await import('../../lib/index.js')
const homes = []
const originalHome = process.env.DSH_HOME

after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
})

/** The user asks to change the month card's hint text. */
const UPDATED_PROGRAM = DST_PROGRAM.replace('选地区，再点月份，看当月的状态。', '切换地区，再点月份，查看当月的夏令时状态。')
const ARTICLE = 'root = Col([toc, section])\ntoc = Toc(["Intro"])\nsection = Section("Intro", [Markdown("Body.")])'

const BASE_BLOCKS = extractArtifactBlocks(DST_PROGRAM).blocks
/** The base page order: b1…b9. */
const ORIGINAL_ORDER = BASE_BLOCKS.map(block => block.blockId)
/** Move the rules table first and the page header into the middle of the page. */
const TARGET_ORDER = ['b5', 'b2', 'b3', 'b4', 'b1', 'b6', 'b7', 'b8', 'b9']

/** One saved block instruction for the fixture's base page. */
function blockEdit(blockId, instruction = '把这一块的说明文字改得更明确。', selectionOrder = 1) {
  const block = BASE_BLOCKS.find(candidate => candidate.blockId === blockId)
  if (block === undefined) throw new Error(`DST fixture block ${blockId} is missing`)
  return {
    blockId: block.blockId,
    nodePath: block.nodePath,
    originalIndex: block.originalIndex,
    selectionOrder,
    componentType: block.componentType,
    ...block.title === undefined ? {} : { title: block.title },
    instruction,
  }
}

/** One valid structured edit request for the DST fixture's month card (b4). */
function editRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    artifactId: 'call-original',
    baseRevisionId: 'call-original',
    baseRevision: 1,
    title: DST_TITLE,
    style: 'card',
    edits: [blockEdit('b4')],
    targetOrder: [...ORIGINAL_ORDER],
    program: DST_PROGRAM,
    ...overrides,
  }
}

/** A mini program whose root holds one edited expression per requested block. */
function blockFragment(blockIds, replacements) {
  const bundle = extractBlockBundle(DST_PROGRAM, blockIds)
  if (bundle === undefined) throw new Error('DST fixture bundle is unavailable')
  const expressions = bundle.blocks.map(block => {
    const replacement = replacements[block.blockId]
    if (replacement === undefined) throw new Error(`no replacement for ${block.blockId}`)
    const expression = block.source.replace(replacement[0], replacement[1])
    assert.notEqual(expression, block.source, `replacement applies to ${block.blockId}`)
    return expression
  })
  return `root = Col([${expressions.join(', ')}])`
}

const UPDATED_MONTH = ['选地区，再点月份，看当月的状态。', '切换地区，再点月份，查看当月的夏令时状态。']

/** One valid result-owned temporary style snapshot for a card page. */
const TEMPORARY_STYLE = { schemaVersion: 1, baseLayout: 'card', directives: 'Keep compact groups and clear hierarchy.', theme: THEME }

/** One V1 envelope for a chosen artifact and requestId (multi-card send helper). */
function artifactRequest({ requestId, artifactId = 'call-original', ...overrides } = {}) {
  return editRequest({
    artifactId,
    baseRevisionId: artifactId,
    ...requestId === undefined ? {} : { requestId },
    ...overrides,
  })
}

/** One branch envelope based on an older recorded revision. */
function branchRequest(overrides = {}) {
  return artifactRequest({
    requestId: 'req_branch_001',
    artifactId: 'call-old',
    baseRevisionId: 'call-old-2',
    baseRevision: 2,
    branch: true,
    ...overrides,
  })
}

/** Concatenate one envelope per Composer chip into the one user message the Host observes. */
function batchText(...requests) {
  return requests.map(request => buildEditRequestText(request)).join('\n\n')
}

/** M4-1 base tree for the nested fixture (Col/Row/Card containers). */
const NESTED_TREE = buildArtifactTree(NESTED_PROGRAM, { containerTypes: ['Col', 'Row', 'Card'] })

/** One nested edit bound to a CST node id and content digest. */
function nestedEdit(nodeId, selectionOrder = 1, overrides = {}) {
  const node = NESTED_TREE.nodes.get(nodeId)
  if (node === undefined) throw new Error(`nested fixture node ${nodeId} is missing`)
  return {
    blockId: `b1.${selectionOrder}`,
    nodePath: node.nodePath,
    nodeId,
    sourceDigest: node.digest,
    parentBlockId: 'b1',
    depth: node.depth,
    originalIndex: 1,
    selectionOrder,
    componentType: node.componentType,
    ...node.title === undefined ? {} : { title: node.title },
    instruction: '改这一块的文案。',
    ...overrides,
  }
}

/** One model-generated addition for the nested fixture. */
function nestedAddition(parentNodeId, index, instruction = 'add a new block here') {
  const parent = NESTED_TREE.nodes.get(parentNodeId)
  if (parent === undefined) throw new Error(`nested fixture node ${parentNodeId} is missing`)
  return {
    parentBlockId: parent.nodeId === NESTED_TREE.rootNodeId ? 'b1' : 'b1.1',
    parentNodeId,
    index,
    instruction,
  }
}

/** One all-nested edit request for the nested fixture. */
function nestedRequest(edits, overrides = {}) {
  return {
    schemaVersion: 1,
    artifactId: 'call-original',
    baseRevisionId: 'call-original',
    baseRevision: 1,
    title: NESTED_TITLE,
    style: 'card',
    edits,
    targetOrder: ['b1', 'b2'],
    program: NESTED_PROGRAM,
    ...overrides,
  }
}

/** The model mini program for a nested edit. */
function nestedFragment(...expressions) {
  return `root = Col([${expressions.join(', ')}])`
}

/** One M4-2 order-only request (no content edits) for the nested fixture. */
function parentOrderRequest(orderByParent, overrides = {}) {
  return {
    schemaVersion: 1,
    artifactId: 'call-original',
    baseRevisionId: 'call-original',
    baseRevision: 1,
    title: NESTED_TITLE,
    style: 'card',
    edits: [],
    targetOrder: ['b1', 'b2'],
    orderByParent,
    program: NESTED_PROGRAM,
    ...overrides,
  }
}

/** One durable revision record for the pre-seeded stale-batch tests. */
function revisionRecord(overrides = {}) {
  return {
    revisionId: 'call-old-2', artifactId: 'call-old', baseRevisionId: 'call-old', revision: 2,
    sessionId: 's1', style: 'card', editedBlockIds: ['b4'], createdAt: 1,
    ...overrides,
  }
}

/** The same base with no instructions: only the arrangement can make it a change. */
function orderOnlyRequest(overrides = {}) {
  return { ...editRequest(overrides), edits: [] }
}

/** Write the envelope directly so tests can transmit header fields the composer omits. */
function rawEnvelope(request) {
  const { program, ...header } = request
  return [ARTIFACT_EDIT_OPEN, JSON.stringify(header), ARTIFACT_EDIT_CLOSE, '', ARTIFACT_PROGRAM_OPEN, program, ARTIFACT_PROGRAM_CLOSE].join('\n')
}

const ENVELOPE = buildEditRequestText(editRequest())
const MALFORMED_ENVELOPE = `${ARTIFACT_EDIT_OPEN}\n{broken}\n${ARTIFACT_EDIT_CLOSE}`

/** One approved result-owned snapshot for a natural-language style edit. */
const STYLE_SNAPSHOT = { ...TEMPORARY_STYLE, directives: 'Quieter editorial layout: fewer decorations, lighter headings, more breathing room.' }
/** A different snapshot used to prove a changed style is accepted. */
const STYLE_SNAPSHOT_ALT = { ...STYLE_SNAPSHOT, directives: 'Spacious magazine layout with an airy type scale and muted dividers.' }

/** One revision-bound natural-language style edit request for the DST fixture. */
function styleRequest(overrides = {}) {
  return {
    kind: 'style',
    schemaVersion: 1,
    requestId: 'req_style_0001',
    artifactId: 'call-original',
    baseRevisionId: 'call-original',
    baseRevision: 1,
    title: DST_TITLE,
    style: 'card',
    temporaryStyle: TEMPORARY_STYLE,
    styleInstruction: '更安静的编辑感排版：减少装饰、标题更轻、留白更舒展。',
    program: DST_PROGRAM,
    ...overrides,
  }
}

/** The render_ui arguments one model call uses to apply a pending style edit. */
function styleArgs(overrides = {}) {
  return {
    program: DST_PROGRAM,
    style: 'card',
    temporaryStyle: STYLE_SNAPSHOT,
    editRequestId: 'req_style_0001',
    ...overrides,
  }
}

/** Mount the plugin on a stub context that keeps every live session listener. */
function mount({ answerStyle = 'auto', templates = [], revisions = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'iui-artifact-edit-'))
  homes.push(home)
  process.env.DSH_HOME = home
  writeFileSync(join(home, 'dsh-intelligent-ui-styles.json'), JSON.stringify({ version: 1, templates }))
  if (revisions.length > 0) writeFileSync(join(home, 'dsh-intelligent-ui-artifacts.json'), JSON.stringify({ version: 1, revisions }))
  const registered = { tools: [], sessionEvents: [], commands: [] }
  plugin.apply({
    tools: { register(definition) { registered.tools.push(definition) } },
    systemPrompt: { section() {} },
    on(event, handler) { if (event === 'session/event') registered.sessionEvents.push(handler) },
    inject(dependencies, callback) {
      if (dependencies.includes('webServer')) {
        callback({
          webServer: { register() { return () => {} } },
          connection: { requestRejection() { return undefined } },
          effect(fn) { return fn() },
        })
        return
      }
      if (dependencies.includes('sessionProjections') && dependencies.includes('commands')) {
        callback({
          sessionProjections: { register() { return () => {} } },
          commands: { register(definition) { registered.commands.push(definition); return () => {} } },
        })
      }
    },
  }, { globalEnabled: { get: () => true }, answerStyle: { get: () => answerStyle } })
  const agent = { session: { id: 's1' } }
  let seq = 0
  const event = (type, data, sessionId = 's1') => {
    for (const handler of registered.sessionEvents) handler({ id: sessionId }, { type, data, seq: ++seq })
  }
  const send = text => event('user/message', { id: 'edit-message', source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const tool = registered.tools.find(definition => definition.name === 'render_ui')
  const blockTool = registered.tools.find(definition => definition.name === 'edit_ui_blocks')
  const command = rawInput => registered.commands.at(-1).handler({ agent, rawInput })
  return { ...registered, tool, blockTool, home, agent, event, send, command, file: join(home, 'dsh-intelligent-ui-artifacts.json') }
}

test('registers the revision output fields while ordinary renders keep a null presentation meta', async () => {
  const m = mount()
  const properties = m.tool.output.schema.properties
  for (const key of ['artifactId', 'revisionId', 'baseRevisionId', 'revision', 'editedBlockIds', 'program']) assert.ok(properties[key], key)
  assert.equal(properties.revision.type, 'integer')
  assert.deepEqual(properties.editedBlockIds.items, { type: 'string' })
  assert.equal(properties.program.type, 'string')
  const value = await m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-original' })
  assert.equal(value.style, 'card')
  assert.equal(value.styleSource, 'builtin')
  assert.equal(value.revision, undefined)
  assert.equal(value.artifactId, undefined)
  assert.equal(value.program, undefined)
  assert.equal(m.tool.output.presentationMeta({}, value), null)
  assert.equal(m.tool.output.render({}, value)[0].text, `Interactive UI rendered for the user (${value.statements} statements, card style).`)
  assert.equal(existsSync(m.file), false, 'ordinary renders record no revision')
})

test('an edit envelope records revision 2 through edit_ui_blocks with composed lineage', async () => {
  const m = mount()
  await m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-original' })
  m.send(ENVELOPE)
  const value = await m.blockTool.execute({ program: blockFragment(['b4'], { b4: UPDATED_MONTH }) }, { agent: m.agent, callId: 'call-edit-1' })
  assert.equal(value.artifactId, 'call-original')
  assert.equal(value.revisionId, 'call-edit-1')
  assert.equal(value.baseRevisionId, 'call-original')
  assert.equal(value.revision, 2)
  assert.deepEqual(value.editedBlockIds, ['b4'])
  assert.match(value.program, /切换地区，再点月份，查看当月的夏令时状态。/)
  assert.equal(value.warnings, undefined)
  assert.deepEqual(m.blockTool.output.presentationMeta({}, value), {
    artifactId: 'call-original', revisionId: 'call-edit-1', baseRevisionId: 'call-original', revision: 2,
    editedBlockIds: ['b4'], program: value.program, title: DST_TITLE, style: 'card',
  })
  assert.equal(m.blockTool.output.render({}, value)[0].text, 'Interactive UI updated for the user (revision 2 of the artifact, 1 blocks edited).')
  const file = JSON.parse(readFileSync(m.file, 'utf8'))
  assert.equal(file.version, 1)
  assert.equal(file.revisions.length, 1)
  const [record] = file.revisions
  assert.equal(record.revisionId, 'call-edit-1')
  assert.equal(record.artifactId, 'call-original')
  assert.equal(record.baseRevisionId, 'call-original')
  assert.equal(record.revision, 2)
  assert.equal(record.sessionId, 's1')
  assert.equal(record.style, 'card')
  assert.equal(record.title, DST_TITLE)
  assert.deepEqual(record.editedBlockIds, ['b4'])
  assert.ok(Number.isSafeInteger(record.createdAt))
  // The request was consumed: a later render in the same session is ordinary again.
  const later = await m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-later' })
  assert.equal(later.revision, undefined)
})

test('a block edit leaves unselected blocks untouched and reports no preservation warnings', async () => {
  const m = mount()
  m.send(ENVELOPE)
  const value = await m.blockTool.execute({ program: blockFragment(['b4'], { b4: UPDATED_MONTH }) }, { agent: m.agent, callId: 'call-edit-warn' })
  assert.equal(value.warnings, undefined)
  assert.equal(m.blockTool.output.render({}, value)[0].text, 'Interactive UI updated for the user (revision 2 of the artifact, 1 blocks edited).')
  // The structural slice guarantee: every unselected root child is byte-identical.
  const baseRoot = readRootLayout(DST_PROGRAM)
  const composedRoot = readRootLayout(value.program)
  assert.ok(baseRoot !== undefined && composedRoot !== undefined)
  baseRoot.children.forEach((child, index) => {
    if (index !== 3) assert.equal(composedRoot.children[index], child, `unselected root child ${index} stays byte-identical`)
  })
  assert.equal(JSON.parse(readFileSync(m.file, 'utf8')).revisions.length, 1)
})

test('an edit from a stale base revision is rejected and must be reloaded', async () => {
  const m = mount()
  const fragment = blockFragment(['b4'], { b4: UPDATED_MONTH })
  m.send(ENVELOPE)
  await m.blockTool.execute({ program: fragment }, { agent: m.agent, callId: 'call-edit-1' })
  // A second tab still shows revision 1 and sends the same base again.
  m.send(ENVELOPE)
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment }, { agent: m.agent, callId: 'call-edit-2' }),
    /out of date\. Ask the user to reload the rendered page and make the edit again/,
  )
  assert.equal(JSON.parse(readFileSync(m.file, 'utf8')).revisions.length, 1)
})

test('an unreadable edit envelope blocks the turn render with a reload error', async () => {
  const m = mount()
  m.send(MALFORMED_ENVELOPE)
  await assert.rejects(
    () => m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-bad' }),
    /could not be read, so the page was not updated\. Ask the user to reload the rendered page/,
  )
})

test('a style mismatch is rejected without consuming an order-only edit request', async () => {
  const m = mount()
  m.send(buildEditRequestText(orderOnlyRequest({ targetOrder: TARGET_ORDER })))
  await assert.rejects(
    () => m.tool.execute({ program: ARTICLE, style: 'article' }, { agent: m.agent, callId: 'call-wrong-style' }),
    /must keep the recorded page style "card"; pass style: "card"/,
  )
  assert.equal(existsSync(m.file), false)
  const value = await m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-edit-1' })
  assert.equal(value.revision, 2)
  assert.equal(typeof value.program, 'string')
})

test('injected user-role context cannot arm an edit request', async () => {
  const m = mount()
  m.event('user/message', { id: 'skill', source: { kind: 'plugin' }, content: [{ type: 'text', text: ENVELOPE }] })
  const value = await m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-plain' })
  assert.equal(value.revision, undefined)
  assert.equal(existsSync(m.file), false)
})

test('an order-only request applies deterministic reordering and records the normalized program', async () => {
  const m = mount()
  m.send(buildEditRequestText(orderOnlyRequest({ targetOrder: TARGET_ORDER })))
  const value = await m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-order-1' })
  assert.equal(value.revision, 2)
  assert.deepEqual(value.editedBlockIds, [])
  const expected = reorderProgramToTargetOrder(DST_PROGRAM, TARGET_ORDER, extractArtifactBlocks(DST_PROGRAM))
  assert.ok(expected !== undefined)
  assert.equal(value.program, expected, 'the lineage carries the Host-normalized program')
  assert.match(value.program, /^root = Col\(\[rulesTable, answerCard, clockCard, monthCard, head, whyCard, chinaCard, mythTable, footnote\]\)/)
  assert.equal(value.warnings, undefined)
  assert.deepEqual(m.tool.output.presentationMeta({}, value), {
    artifactId: 'call-original', revisionId: 'call-order-1', baseRevisionId: 'call-original', revision: 2,
    editedBlockIds: [], program: expected, title: DST_TITLE,
  })
  assert.equal(m.tool.output.render({}, value)[0].text, 'Interactive UI updated for the user (revision 2 of the artifact, block order adjusted).')
  const [record] = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.equal(record.revisionId, 'call-order-1')
  assert.deepEqual(record.editedBlockIds, [])
  // The request was consumed: a later render in the same session is ordinary again.
  const later = await m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-after-order' })
  assert.equal(later.revision, undefined)
})

test('a combined block edit and arrangement applies both and normalizes the order', async () => {
  const m = mount()
  m.send(buildEditRequestText(editRequest({ edits: [blockEdit('b4')], targetOrder: TARGET_ORDER })))
  const value = await m.blockTool.execute({ program: blockFragment(['b4'], { b4: UPDATED_MONTH }) }, { agent: m.agent, callId: 'call-combined' })
  assert.match(value.program, /切换地区，再点月份，查看当月的夏令时状态。/)
  assert.match(value.program, /^root = Col\(\[rulesTable, answerCard, clockCard, Card\(\[Title\("一年里什么时候生效"/)
  assert.deepEqual(value.editedBlockIds, ['b4'])
  assert.equal(value.warnings, undefined, 'reordering alone does not warn about preserved blocks')
  assert.equal(m.blockTool.output.render({}, value)[0].text, 'Interactive UI updated for the user (revision 2 of the artifact, 1 blocks edited).')
})

test('a client orderChanged:false hint does not suppress the Host reorder', async () => {
  const m = mount()
  m.send(rawEnvelope(orderOnlyRequest({ targetOrder: TARGET_ORDER, orderChanged: false })))
  const value = await m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-hint' })
  assert.equal(typeof value.program, 'string')
  assert.match(value.program, /^root = Col\(\[rulesTable, answerCard, /)
})

test('an arrangement that drops a top-level block fails retryably without consuming the request', async () => {
  const m = mount()
  m.send(buildEditRequestText(orderOnlyRequest({ targetOrder: TARGET_ORDER })))
  const dropped = DST_PROGRAM.replace(', whyCard', '')
  await assert.rejects(
    () => m.tool.execute({ program: dropped, style: 'card' }, { agent: m.agent, callId: 'call-drop' }),
    /could not be verified because the updated program did not keep every top-level block; keep the same top-level blocks with their statement names\/titles \(no add\/remove\/merge\) and try again/,
  )
  assert.equal(existsSync(m.file), false, 'the failed arrangement records no revision')
  const value = await m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-retry' })
  assert.equal(value.revision, 2)
  assert.equal(typeof value.program, 'string')
})

test('an arrangement whose normalized program exceeds the revision bound is rejected', async () => {
  const m = mount()
  m.send(buildEditRequestText(orderOnlyRequest({ targetOrder: TARGET_ORDER })))
  const oversized = DST_PROGRAM.replace('选地区，再点月份，看当月的状态。', 'x'.repeat(200_001))
  await assert.rejects(
    () => m.tool.execute({ program: oversized, style: 'card' }, { agent: m.agent, callId: 'call-oversized' }),
    /arranged program is too long for an artifact revision \(limit 200000 characters\)/,
  )
  assert.equal(existsSync(m.file), false)
})

test('target orders that are not a complete permutation are rejected before rendering', async () => {
  for (const [targetOrder, expected] of [
    [ORIGINAL_ORDER.slice(0, -1), /invalid target order \(wrong_length\)/],
    [[...ORIGINAL_ORDER.slice(0, -1), 'b99'], /invalid target order \(unknown_block\)/],
    [ORIGINAL_ORDER.map((id, index) => index === 0 ? 'b42' : id), /invalid target order \(unknown_block\)/],
  ]) {
    const m = mount()
    m.send(buildEditRequestText(orderOnlyRequest({ targetOrder })))
    await assert.rejects(() => m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-invalid-order' }), expected)
    // Invalid requests stay armed as invalid: a retry is rejected again, never silently rendered.
    await assert.rejects(() => m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-invalid-retry' }), expected)
    assert.equal(existsSync(m.file), false)
  }
})

test('a duplicate target-order id and a missing targetOrder are unreadable envelopes', async () => {
  const duplicate = mount()
  duplicate.send(buildEditRequestText(orderOnlyRequest({ targetOrder: [...ORIGINAL_ORDER.slice(0, -1), 'b1'] })))
  await assert.rejects(
    () => duplicate.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: duplicate.agent, callId: 'call-dup' }),
    /could not be read, so the page was not updated/,
  )
  const missing = mount()
  const { targetOrder: _targetOrder, ...withoutTargetOrder } = orderOnlyRequest()
  missing.send(rawEnvelope(withoutTargetOrder))
  await assert.rejects(
    () => missing.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: missing.agent, callId: 'call-missing-order' }),
    /could not be read, so the page was not updated/,
  )
  assert.equal(existsSync(duplicate.file), false)
  assert.equal(existsSync(missing.file), false)
})

test('a request that changes nothing is rejected instead of rendering a fake revision', async () => {
  const m = mount()
  m.send(buildEditRequestText(orderOnlyRequest()))
  await assert.rejects(
    () => m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-noop' }),
    /changes nothing \(no instructions, no global instruction and the same block order\)/,
  )
  assert.equal(existsSync(m.file), false)
})

test('registers edit_ui_blocks before render_ui with a minimal schema and the full revision meta', () => {
  const m = mount()
  assert.deepEqual(m.tools.map(tool => tool.name), ['edit_ui_blocks', 'render_ui'], 'render_ui stays the last registration')
  assert.deepEqual(m.blockTool.parameters.required, ['program'])
  assert.deepEqual(Object.keys(m.blockTool.parameters.properties), ['program', 'requestId', 'artifactId'])
  assert.equal(m.tool.parameters.properties.editRequestId.type, 'string', 'render_ui can select one pending request')
  for (const key of ['program', 'title', 'style', 'styleId', 'warnings', 'artifactId', 'revisionId', 'baseRevisionId', 'revision', 'editedBlockIds']) {
    assert.ok(m.blockTool.output.schema.properties[key], key)
  }
  assert.deepEqual(m.blockTool.output.schema.required, ['statements', 'style', 'program', 'artifactId', 'revisionId', 'revision'])
  assertDshToolSchema(m.blockTool.parameters, 'edit_ui_blocks.parameters')
  assertDshToolSchema(m.blockTool.output.schema, 'edit_ui_blocks.output.schema')
})

test('edit_ui_blocks splices one edited block and records the composed page in the result meta', async () => {
  const m = mount()
  await m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-original' })
  m.send(ENVELOPE)
  const fragment = blockFragment(['b4'], { b4: UPDATED_MONTH })
  const value = await m.blockTool.execute({ program: fragment }, { agent: m.agent, callId: 'call-block-1' })
  assert.equal(value.artifactId, 'call-original')
  assert.equal(value.revisionId, 'call-block-1')
  assert.equal(value.baseRevisionId, 'call-original')
  assert.equal(value.revision, 2)
  assert.deepEqual(value.editedBlockIds, ['b4'])
  assert.equal(value.style, 'card')
  assert.equal(value.title, DST_TITLE)
  assert.equal(Object.hasOwn(value, 'styleId'), false)
  assert.ok(value.statements > 0)
  assert.match(value.program, /切换地区，再点月份，查看当月的夏令时状态。/)
  // Only the selected slot changes: every other root child stays byte-identical.
  const baseRoot = readRootLayout(DST_PROGRAM)
  const composedRoot = readRootLayout(value.program)
  assert.ok(baseRoot !== undefined && composedRoot !== undefined)
  assert.equal(composedRoot.children.length, baseRoot.children.length)
  baseRoot.children.forEach((child, index) => {
    if (index === 3) {
      assert.match(composedRoot.children[index], /^Card\(\[Title\("一年里什么时候生效"/)
      return
    }
    assert.equal(composedRoot.children[index], child, `root child ${index} stays byte-identical`)
  })
  // The client renders result meta, never the tool arguments.
  const meta = m.blockTool.output.presentationMeta({}, value)
  assert.deepEqual(meta, {
    artifactId: 'call-original', revisionId: 'call-block-1', baseRevisionId: 'call-original', revision: 2,
    editedBlockIds: ['b4'], program: value.program, title: DST_TITLE, style: 'card',
  })
  assert.equal(isArtifactRevisionMeta(meta), true)
  assert.equal(m.blockTool.output.render({}, value)[0].text, 'Interactive UI updated for the user (revision 2 of the artifact, 1 blocks edited).')
  const [record] = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.equal(record.revisionId, 'call-block-1')
  assert.deepEqual(record.editedBlockIds, ['b4'])
  assert.equal(record.title, DST_TITLE)
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment }, { agent: m.agent, callId: 'call-block-again' }),
    /no block edit request is pending/,
  )
})

test('edit_ui_blocks splices two blocks in request order into the unchanged page', async () => {
  const m = mount()
  m.send(buildEditRequestText(editRequest({
    edits: [blockEdit('b2', '更新答案卡正文。', 1), blockEdit('b4', '更新月份卡说明。', 2)],
  })))
  const fragment = blockFragment(['b2', 'b4'], {
    b2: ['所以夏令时是一项临时调整', '所以夏令时只是一项临时调整'],
    b4: UPDATED_MONTH,
  })
  const value = await m.blockTool.execute({ program: fragment }, { agent: m.agent, callId: 'call-block-two' })
  assert.deepEqual(value.editedBlockIds, ['b2', 'b4'])
  assert.match(value.program, /所以夏令时只是一项临时调整/)
  assert.match(value.program, /切换地区，再点月份，查看当月的夏令时状态。/)
  const baseRoot = readRootLayout(DST_PROGRAM)
  const composedRoot = readRootLayout(value.program)
  assert.ok(baseRoot !== undefined && composedRoot !== undefined)
  baseRoot.children.forEach((child, index) => {
    if (index === 1 || index === 3) return
    assert.equal(composedRoot.children[index], child, `root child ${index} stays byte-identical`)
  })
})

test('a saved-template edit keeps the recorded styleId and title in the result meta', async () => {
  const custom = template()
  const m = mount({ answerStyle: custom.id, templates: [custom] })
  await m.tool.execute({ program: DST_PROGRAM, style: 'card', styleId: custom.id }, { agent: m.agent, callId: 'call-original' })
  m.send(buildEditRequestText(editRequest({ styleId: custom.id })))
  const value = await m.blockTool.execute({ program: blockFragment(['b4'], { b4: UPDATED_MONTH }) }, { agent: m.agent, callId: 'call-block-template' })
  assert.equal(value.style, 'card')
  assert.equal(value.styleId, custom.id)
  assert.equal(value.title, DST_TITLE)
  assert.deepEqual(m.blockTool.output.presentationMeta({}, value), {
    artifactId: 'call-original', revisionId: 'call-block-template', baseRevisionId: 'call-original', revision: 2,
    editedBlockIds: ['b4'], program: value.program, title: DST_TITLE, style: 'card', styleId: custom.id,
  })
  const [record] = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.equal(record.styleId, custom.id)
})

test('render_ui rejects content edits and keeps the request armed for edit_ui_blocks', async () => {
  const m = mount()
  m.send(ENVELOPE)
  await assert.rejects(
    () => m.tool.execute({ program: UPDATED_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-render-wrong' }),
    /call edit_ui_blocks once with a mini program containing only the selected blocks/,
  )
  assert.equal(existsSync(m.file), false)
  const value = await m.blockTool.execute({ program: blockFragment(['b4'], { b4: UPDATED_MONTH }) }, { agent: m.agent, callId: 'call-block-after-reject' })
  assert.equal(value.revision, 2)
})

test('edit_ui_blocks without a pending request or with an order-only request rejects', async () => {
  const plain = mount()
  await assert.rejects(
    () => plain.blockTool.execute({ program: 'root = Col([Card([Title("x")])])' }, { agent: plain.agent, callId: 'call-none' }),
    /no block edit request is pending/,
  )
  const ordered = mount()
  ordered.send(buildEditRequestText(orderOnlyRequest({ targetOrder: TARGET_ORDER })))
  await assert.rejects(
    () => ordered.blockTool.execute({ program: 'root = Col([Card([Title("x")])])' }, { agent: ordered.agent, callId: 'call-order' }),
    /only changes block order or the global instruction; call render_ui/,
  )
  // The order-only request stays armed for the full-page render_ui path.
  const value = await ordered.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: ordered.agent, callId: 'call-render-order' })
  assert.equal(value.revision, 2)
  assert.equal(typeof value.program, 'string')
})

test('a block program that does not fit the request fails retryably without consuming it', async () => {
  const m = mount()
  m.send(ENVELOPE)
  await assert.rejects(
    () => m.blockTool.execute({ program: 'root = Col([Card([Title("x")]), Card([Title("y")])])' }, { agent: m.agent, callId: 'call-bad-fragment' }),
    /block program does not fit this edit \(fragment_block_count_mismatch:expected 1 got 2\)/,
  )
  assert.equal(existsSync(m.file), false)
  const value = await m.blockTool.execute({ program: blockFragment(['b4'], { b4: UPDATED_MONTH }) }, { agent: m.agent, callId: 'call-retry-fragment' })
  assert.equal(value.revision, 2)
})

test('edit_ui_blocks surfaces an invalid pending request instead of rendering', async () => {
  const m = mount()
  m.send(buildEditRequestText(orderOnlyRequest()))
  await assert.rejects(
    () => m.blockTool.execute({ program: 'root = Col([Card([Title("x")])])' }, { agent: m.agent, callId: 'call-invalid-pending' }),
    /edit_ui_blocks: this block edit request changes nothing/,
  )
  assert.equal(existsSync(m.file), false)
})

test('one message with two artifact envelopes arms two requests applied independently', async () => {
  // v1 note: the Host trusts each envelope's program for its own (same-user) request;
  // it validates structure and lineage, not a registry-level program digest.
  const m = mount()
  m.send(batchText(
    artifactRequest({ requestId: 'req_edit_0001' }),
    artifactRequest({ requestId: 'req_edit_0002', artifactId: 'call-second' }),
  ))
  const fragment = blockFragment(['b4'], { b4: UPDATED_MONTH })
  const secondFragment = blockFragment(['b4'], { b4: ['选地区，再点月份，看当月的状态。', '按地区切换月份，查看当月的状态。'] })
  const first = await m.blockTool.execute({ program: fragment, requestId: 'req_edit_0001', artifactId: 'call-original' }, { agent: m.agent, callId: 'call-batch-1' })
  const second = await m.blockTool.execute({ program: secondFragment, requestId: 'req_edit_0002', artifactId: 'call-second' }, { agent: m.agent, callId: 'call-batch-2' })
  assert.equal(first.artifactId, 'call-original')
  assert.equal(second.artifactId, 'call-second')
  assert.equal(first.revision, 2)
  assert.equal(second.revision, 2)
  assert.equal(first.revisionId, 'call-batch-1')
  assert.equal(second.revisionId, 'call-batch-2')
  assert.ok(typeof first.program === 'string' && typeof second.program === 'string')
  assert.notEqual(first.program, second.program, 'each artifact carries its own composed page')
  const records = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.deepEqual(records.map(record => [record.artifactId, record.revisionId, record.revision]), [
    ['call-original', 'call-batch-1', 2],
    ['call-second', 'call-batch-2', 2],
  ])
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment, requestId: 'req_edit_0001' }, { agent: m.agent, callId: 'call-batch-3' }),
    /no block edit request is pending/,
  )
})

test('two pending requests require a selector and stay armed when it is missing', async () => {
  const m = mount()
  m.send(batchText(
    artifactRequest({ requestId: 'req_edit_0001' }),
    artifactRequest({ requestId: 'req_edit_0002', artifactId: 'call-second' }),
  ))
  const fragment = blockFragment(['b4'], { b4: UPDATED_MONTH })
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment }, { agent: m.agent, callId: 'call-no-selector' }),
    (error) => {
      assert.match(error.message, /edit_ui_blocks: this session has 2 pending Artifact edit requests, so choose exactly one pending request by passing requestId/)
      assert.match(error.message, /requestId "req_edit_0001" \/ artifactId "call-original"/)
      assert.match(error.message, /requestId "req_edit_0002" \/ artifactId "call-second"/)
      assert.ok(error.message.indexOf('req_edit_0001') < error.message.indexOf('req_edit_0002'), 'choices keep request order')
      return true
    },
  )
  assert.equal(existsSync(m.file), false, 'a selection error records nothing')
  // Both requests stay armed: artifactId alone is a unique selector, requestId alone works too.
  const first = await m.blockTool.execute({ program: fragment, artifactId: 'call-original' }, { agent: m.agent, callId: 'call-selector-1' })
  const second = await m.blockTool.execute({ program: fragment, requestId: 'req_edit_0002' }, { agent: m.agent, callId: 'call-selector-2' })
  assert.equal(first.artifactId, 'call-original')
  assert.equal(second.artifactId, 'call-second')
  assert.equal(JSON.parse(readFileSync(m.file, 'utf8')).revisions.length, 2)
})

test('unknown requestId and artifactId mismatches are rejected without consuming pending requests', async () => {
  const m = mount()
  m.send(batchText(
    artifactRequest({ requestId: 'req_edit_0001' }),
    artifactRequest({ requestId: 'req_edit_0002', artifactId: 'call-second' }),
  ))
  const fragment = blockFragment(['b4'], { b4: UPDATED_MONTH })
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment, requestId: 'req_missing_001' }, { agent: m.agent, callId: 'call-unknown-id' }),
    /no pending Artifact edit request matches requestId "req_missing_001"; pass one of the pending requestIds/,
  )
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment, requestId: 'req_edit_0001', artifactId: 'call-second' }, { agent: m.agent, callId: 'call-mismatch' }),
    /requestId "req_edit_0001" belongs to artifactId "call-original", not "call-second"/,
  )
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment, artifactId: 'call-unknown' }, { agent: m.agent, callId: 'call-unknown-artifact' }),
    /no pending Artifact edit request matches artifactId "call-unknown"/,
  )
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment, requestId: 'short' }, { agent: m.agent, callId: 'call-bad-id' }),
    /requestId must be 8-80 characters/,
  )
  assert.equal(existsSync(m.file), false)
  const first = await m.blockTool.execute({ program: fragment, requestId: 'req_edit_0001' }, { agent: m.agent, callId: 'call-after-errors-1' })
  const second = await m.blockTool.execute({ program: fragment, requestId: 'req_edit_0002' }, { agent: m.agent, callId: 'call-after-errors-2' })
  assert.equal(first.revision, 2)
  assert.equal(second.revision, 2)
})

test('one stale pending request fails independently while the other applies', async () => {
  const m = mount({ revisions: [revisionRecord()] })
  m.send(batchText(
    artifactRequest({ requestId: 'req_stale_001', artifactId: 'call-old' }),
    artifactRequest({ requestId: 'req_valid_001', artifactId: 'call-new' }),
  ))
  const fragment = blockFragment(['b4'], { b4: UPDATED_MONTH })
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment, requestId: 'req_stale_001' }, { agent: m.agent, callId: 'call-stale' }),
    /out of date\. Ask the user to reload the rendered page and make the edit again/,
  )
  const valid = await m.blockTool.execute({ program: fragment, requestId: 'req_valid_001' }, { agent: m.agent, callId: 'call-valid' })
  assert.equal(valid.artifactId, 'call-new')
  assert.equal(valid.revision, 2)
  const records = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.deepEqual(records.map(record => record.artifactId), ['call-old', 'call-new'])
})

test('render_ui applies the selected order-only request with editRequestId and leaves block requests armed', async () => {
  const m = mount()
  m.send(batchText(
    artifactRequest({ requestId: 'req_block_001' }),
    artifactRequest({ requestId: 'req_order_001', artifactId: 'call-second', edits: [], targetOrder: TARGET_ORDER }),
  ))
  await assert.rejects(
    () => m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-render-no-selector' }),
    (error) => {
      assert.match(error.message, /render_ui: this session has 2 pending Artifact edit requests, so choose exactly one pending request by passing editRequestId/)
      assert.match(error.message, /order\/global only: use render_ui with editRequestId/)
      return true
    },
  )
  await assert.rejects(
    () => m.tool.execute({ program: DST_PROGRAM, style: 'card', editRequestId: 'req_block_001' }, { agent: m.agent, callId: 'call-render-block' }),
    /call edit_ui_blocks once with a mini program containing only the selected blocks/,
  )
  const ordered = await m.tool.execute({ program: DST_PROGRAM, style: 'card', editRequestId: 'req_order_001' }, { agent: m.agent, callId: 'call-render-order' })
  assert.equal(ordered.artifactId, 'call-second')
  assert.equal(ordered.revision, 2)
  assert.equal(ordered.requestId, 'req_order_001', 'the fulfilled request id is projected for client reconciliation')
  assert.deepEqual(ordered.editedBlockIds, [])
  assert.equal(typeof ordered.program, 'string', 'the order-only revision carries its normalized page')
  // The block request was not consumed by the order-only render.
  const blockValue = await m.blockTool.execute(
    { program: blockFragment(['b4'], { b4: UPDATED_MONTH }), requestId: 'req_block_001' },
    { agent: m.agent, callId: 'call-block-later' },
  )
  assert.equal(blockValue.artifactId, 'call-original')
  await assert.rejects(
    () => m.tool.execute({ program: DST_PROGRAM, style: 'card', editRequestId: 'req_order_001' }, { agent: m.agent, callId: 'call-render-after' }),
    /no pending Artifact edit request matches editRequestId "req_order_001"/,
  )
})

test('a batch arms only the first request per artifact and reports the duplicate', async () => {
  const m = mount()
  m.send(batchText(
    artifactRequest({ requestId: 'req_dup_0001' }),
    artifactRequest({ requestId: 'req_dup_0002' }),
  ))
  const fragment = blockFragment(['b4'], { b4: UPDATED_MONTH })
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment, requestId: 'req_dup_0002' }, { agent: m.agent, callId: 'call-dup-second' }),
    /more than one edit request for artifactId "call-original"; only the first request per artifact is armed/,
  )
  assert.equal(existsSync(m.file), false)
  const value = await m.blockTool.execute({ program: fragment, requestId: 'req_dup_0001' }, { agent: m.agent, callId: 'call-dup-first' })
  assert.equal(value.revision, 2)
})

test('a message with more than three envelopes arms the first three in request order', async () => {
  const m = mount()
  m.send(batchText(
    artifactRequest({ requestId: 'req_over_0001' }),
    artifactRequest({ requestId: 'req_over_0002', artifactId: 'call-second' }),
    artifactRequest({ requestId: 'req_over_0003', artifactId: 'call-third' }),
    artifactRequest({ requestId: 'req_over_0004', artifactId: 'call-fourth' }),
  ))
  const fragment = blockFragment(['b4'], { b4: UPDATED_MONTH })
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment, requestId: 'req_over_0004' }, { agent: m.agent, callId: 'call-over-4' }),
    (error) => {
      assert.match(error.message, /no pending Artifact edit request matches requestId "req_over_0004"/)
      const choices = error.message.split('Pending: ')[1] ?? ''
      assert.match(choices, /req_over_0001/)
      assert.match(choices, /req_over_0002/)
      assert.match(choices, /req_over_0003/)
      assert.doesNotMatch(choices, /req_over_0004/)
      return true
    },
  )
})

test('an edit request id is projected on the revision meta for client reconciliation', async () => {
  const m = mount()
  m.send(buildEditRequestText(artifactRequest({ requestId: 'req_meta_0001' })))
  const value = await m.blockTool.execute(
    { program: blockFragment(['b4'], { b4: UPDATED_MONTH }), requestId: 'req_meta_0001' },
    { agent: m.agent, callId: 'call-meta-1' },
  )
  assert.equal(value.requestId, 'req_meta_0001')
  assert.deepEqual(m.blockTool.output.presentationMeta({}, value), {
    artifactId: 'call-original', revisionId: 'call-meta-1', requestId: 'req_meta_0001',
    baseRevisionId: 'call-original', revision: 2, editedBlockIds: ['b4'], program: value.program, title: DST_TITLE, style: 'card',
  })
})

test('a branch edit from an older revision records latest.revision + 1', async () => {
  const m = mount({
    revisions: [
      revisionRecord(),
      revisionRecord({ revisionId: 'call-old-3', baseRevisionId: 'call-old-2', revision: 3, createdAt: 2 }),
    ],
  })
  m.send(buildEditRequestText(branchRequest({ targetOrder: TARGET_ORDER })))
  const value = await m.blockTool.execute(
    { program: blockFragment(['b4'], { b4: UPDATED_MONTH }), requestId: 'req_branch_001' },
    { agent: m.agent, callId: 'call-branch-1' },
  )
  assert.equal(value.artifactId, 'call-old')
  assert.equal(value.baseRevisionId, 'call-old-2', 'the new revision keeps the older base')
  assert.equal(value.revision, 4, 'branch revisions continue from the current head')
  assert.equal(value.requestId, 'req_branch_001')
  // The deterministic target order still applies on a branch edit.
  assert.match(value.program, /^root = Col\(\[rulesTable, answerCard, clockCard, Card\(\[Title\("一年里什么时候生效"/)
  const meta = m.blockTool.output.presentationMeta({}, value)
  assert.equal(meta.revision, 4)
  assert.equal(meta.baseRevisionId, 'call-old-2')
  assert.equal(meta.requestId, 'req_branch_001')
  const records = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  const latest = records.filter(record => record.artifactId === 'call-old').sort((left, right) => left.revision - right.revision).at(-1)
  assert.equal(latest.revisionId, 'call-branch-1')
  assert.equal(latest.revision, 4)
  assert.equal(latest.baseRevisionId, 'call-old-2')
})

test('a branch edit from the unrecorded first revision is allowed', async () => {
  const m = mount({
    revisions: [
      revisionRecord(),
      revisionRecord({ revisionId: 'call-old-3', baseRevisionId: 'call-old-2', revision: 3, createdAt: 2 }),
    ],
  })
  m.send(buildEditRequestText(branchRequest({ requestId: 'req_branch_first', baseRevisionId: 'call-old', baseRevision: 1 })))
  const value = await m.blockTool.execute(
    { program: blockFragment(['b4'], { b4: UPDATED_MONTH }), requestId: 'req_branch_first' },
    { agent: m.agent, callId: 'call-branch-first' },
  )
  assert.equal(value.baseRevisionId, 'call-old')
  assert.equal(value.revision, 4)
})

test('a non-branch edit from an older revision is still rejected as stale', async () => {
  const m = mount({
    revisions: [
      revisionRecord(),
      revisionRecord({ revisionId: 'call-old-3', baseRevisionId: 'call-old-2', revision: 3, createdAt: 2 }),
    ],
  })
  m.send(buildEditRequestText(branchRequest({ requestId: 'req_stale_old_001', branch: undefined })))
  await assert.rejects(
    () => m.blockTool.execute({ program: blockFragment(['b4'], { b4: UPDATED_MONTH }), requestId: 'req_stale_old_001' }, { agent: m.agent, callId: 'call-old-no-branch' }),
    /out of date\. Ask the user to reload the rendered page and make the edit again/,
  )
})

test('invalid branch bases are rejected model-readably without recording', async () => {
  const m = mount({
    revisions: [
      revisionRecord(),
      revisionRecord({ revisionId: 'call-old-3', baseRevisionId: 'call-old-2', revision: 3, createdAt: 2 }),
      revisionRecord({ revisionId: 'call-other-2', artifactId: 'call-other', baseRevisionId: 'call-other', revision: 2, createdAt: 3 }),
    ],
  })
  const fragment = blockFragment(['b4'], { b4: UPDATED_MONTH })
  m.send(buildEditRequestText(branchRequest({ requestId: 'req_branch_missing', baseRevisionId: 'call-old-missing', baseRevision: 5 })))
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment, requestId: 'req_branch_missing' }, { agent: m.agent, callId: 'call-branch-missing' }),
    /only revision 1 \(the original render\) may be unrecorded/,
  )
  m.send(buildEditRequestText(branchRequest({ requestId: 'req_branch_foreign', baseRevisionId: 'call-other-2', baseRevision: 2 })))
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment, requestId: 'req_branch_foreign' }, { agent: m.agent, callId: 'call-branch-foreign' }),
    /belongs to artifact "call-other", not "call-old"/,
  )
  m.send(buildEditRequestText(branchRequest({ requestId: 'req_branch_mismatch', baseRevisionId: 'call-old-2', baseRevision: 5 })))
  await assert.rejects(
    () => m.blockTool.execute({ program: fragment, requestId: 'req_branch_mismatch' }, { agent: m.agent, callId: 'call-branch-mismatch' }),
    /says it targets revision 5, but base revision "call-old-2" is revision 2/,
  )
  assert.equal(JSON.parse(readFileSync(m.file, 'utf8')).revisions.length, 3)
})

test('a temporary-style block edit records and projects the snapshot', async () => {
  const m = mount()
  m.send(buildEditRequestText(artifactRequest({ requestId: 'req_temp_0001', temporaryStyle: TEMPORARY_STYLE })))
  const value = await m.blockTool.execute(
    { program: blockFragment(['b4'], { b4: UPDATED_MONTH }), requestId: 'req_temp_0001' },
    { agent: m.agent, callId: 'call-temp-1' },
  )
  assert.equal(value.style, 'card')
  assert.equal(Object.hasOwn(value, 'styleId'), false, 'temporary styles never carry a template id')
  assert.deepEqual(value.temporaryStyle, TEMPORARY_STYLE)
  const meta = m.blockTool.output.presentationMeta({}, value)
  assert.deepEqual(meta, {
    artifactId: 'call-original', revisionId: 'call-temp-1', requestId: 'req_temp_0001',
    baseRevisionId: 'call-original', revision: 2, editedBlockIds: ['b4'], program: value.program,
    title: DST_TITLE, style: 'card', temporaryStyle: TEMPORARY_STYLE,
  })
  assert.equal(isArtifactRevisionMeta(meta), true)
  // Output/standard value schemas declare the snapshot as a JSON object.
  assert.equal(m.blockTool.output.schema.properties.temporaryStyle.type, 'object')
  assertDshToolSchema(m.blockTool.output.schema, 'edit_ui_blocks.output.schema')
  const [record] = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.deepEqual(record.temporaryStyle, TEMPORARY_STYLE)
  assert.equal(record.style, 'card')
  assert.equal(Object.hasOwn(record, 'styleId'), false)
  assert.equal(record.revisionId, 'call-temp-1')
})

test('the render_ui full-program fallback stays closed for temporary-style edits', async () => {
  const m = mount()
  m.send(buildEditRequestText(artifactRequest({
    requestId: 'req_temp_order',
    edits: [],
    targetOrder: TARGET_ORDER,
    temporaryStyle: TEMPORARY_STYLE,
  })))
  await assert.rejects(
    () => m.tool.execute({ program: DST_PROGRAM, style: 'card', editRequestId: 'req_temp_order' }, { agent: m.agent, callId: 'call-temp-order' }),
    /render_ui: this artifact uses a result-owned temporary style, so only content edits through edit_ui_blocks are supported/,
  )
  assert.equal(existsSync(m.file), false)
})

test('invalid temporary-style envelopes are rejected before rendering', async () => {
  for (const request of [
    editRequest({ requestId: 'req_temp_bad_layout', temporaryStyle: { ...TEMPORARY_STYLE, baseLayout: 'free' } }),
    editRequest({ requestId: 'req_temp_with_style', styleId: 'cs_abcdef123456', temporaryStyle: TEMPORARY_STYLE }),
    editRequest({ requestId: 'req_temp_long', temporaryStyle: { ...TEMPORARY_STYLE, directives: 'x'.repeat(2001) } }),
  ]) {
    const m = mount()
    m.send(buildEditRequestText(request))
    await assert.rejects(
      () => m.blockTool.execute({ program: blockFragment(['b4'], { b4: UPDATED_MONTH }) }, { agent: m.agent, callId: 'call-temp-bad' }),
      /could not be read, so the page was not updated/,
    )
    assert.equal(existsSync(m.file), false)
  }
})

test('a nested content edit rewrites one nested block and preserves untouched source bytes', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([nestedEdit('n5')])))
  const value = await m.blockTool.execute({ program: nestedFragment('Text("A nested", "sm")') }, { agent: m.agent, callId: 'call-nested-1' })
  assert.equal(value.artifactId, 'call-original')
  assert.equal(value.revision, 2)
  assert.deepEqual(value.editedBlockIds, ['b1'], 'the affected root-level block id is recorded')
  const lines = value.program.split('\n')
  assert.equal(lines[0], NESTED_PROGRAM.split('\n')[0])
  assert.match(lines[1], /Col\(\[Text\("A nested", "sm"\), Text\("B", "sm"\), Text\(sharedText, "sm"\)\]\)/)
  assert.equal(lines[2], NESTED_PROGRAM.split('\n')[2], 'the second card statement is byte-identical')
  assert.equal(lines[3], NESTED_PROGRAM.split('\n')[3], 'the shared helper statement is byte-identical')
  assert.equal(value.warnings, undefined, 'only the edited root block changed, so no preservation warning')
  const [record] = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.equal(record.revisionId, 'call-nested-1')
  assert.deepEqual(record.editedBlockIds, ['b1'])
  assert.equal(m.blockTool.output.presentationMeta({}, value).program, value.program)
  await assert.rejects(
    () => m.blockTool.execute({ program: nestedFragment('Text("X", "sm")') }, { agent: m.agent, callId: 'call-nested-retry' }),
    /no block edit request is pending/,
  )
})

test('a nested edit can target a root-level block node and stays a content replacement', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([nestedEdit('n2')])))
  const value = await m.blockTool.execute({ program: nestedFragment('Card([Title("新外层", "sm"), Text("内容", "sm")])') }, { agent: m.agent, callId: 'call-nested-root-child' })
  assert.match(value.program.split('\n')[0], /root = Col\(\[Card\(\[Title\("新外层", "sm"\), Text\("内容", "sm"\)\]\), secondCard\]\)/)
  assert.equal(value.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2])
})

test('multiple nested edits are mapped by selection order and only change their own subtrees', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([nestedEdit('n11', 2), nestedEdit('n5', 1)])))
  const value = await m.blockTool.execute({
    program: nestedFragment('Text("A two", "sm")', 'Text("C two", "sm")'),
  }, { agent: m.agent, callId: 'call-nested-two' })
  const lines = value.program.split('\n')
  assert.match(lines[1], /Text\("A two", "sm"\), Text\("B", "sm"\), Text\(sharedText, "sm"\)/)
  assert.match(lines[2], /Row\(\[Text\("C two", "sm"\), Text\("D", "sm"\)\]\)/)
  assert.deepEqual([...value.editedBlockIds].sort(), ['b1', 'b2'])
  assert.equal(value.warnings, undefined)
  assert.equal(JSON.parse(readFileSync(m.file, 'utf8')).revisions.length, 1)
})

test('nested edit fragments may append new helper statements without redefining page names', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([nestedEdit('n5')])))
  const value = await m.blockTool.execute({
    program: 'root = Col([newText])\nnewText = Text("from a helper", "sm")',
  }, { agent: m.agent, callId: 'call-nested-helper' })
  assert.match(value.program.split('\n')[1], /Col\(\[newText, Text\("B", "sm"\)/)
  assert.ok(value.program.endsWith('newText = Text("from a helper", "sm")'))
  assert.equal(value.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2])
})

test('a nested edit combines with root targetOrder reordering', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([nestedEdit('n5')], { targetOrder: ['b2', 'b1'] })))
  const value = await m.blockTool.execute({ program: nestedFragment('Text("A ordered", "sm")') }, { agent: m.agent, callId: 'call-nested-order' })
  const lines = value.program.split('\n')
  assert.equal(lines[0], 'root = Col([secondCard, outerCard])', 'the deterministic root reorder still applies')
  assert.match(lines[1], /Text\("A ordered", "sm"\)/)
  assert.equal(lines[2], NESTED_PROGRAM.split('\n')[2])
  assert.equal(typeof value.program, 'string')
})

test('a nested edit from an older branch revision records latest+1 and edits the nested block', async () => {
  const m = mount({
    revisions: [
      revisionRecord(),
      revisionRecord({ revisionId: 'call-old-3', baseRevisionId: 'call-old-2', revision: 3, createdAt: 2 }),
    ],
  })
  m.send(buildEditRequestText(nestedRequest([nestedEdit('n5')], {
    artifactId: 'call-old',
    baseRevisionId: 'call-old-2',
    baseRevision: 2,
    branch: true,
  })))
  const value = await m.blockTool.execute({ program: nestedFragment('Text("A branch", "sm")') }, { agent: m.agent, callId: 'call-nested-branch' })
  assert.equal(value.artifactId, 'call-old')
  assert.equal(value.baseRevisionId, 'call-old-2')
  assert.equal(value.revision, 4)
  assert.match(value.program.split('\n')[1], /Text\("A branch", "sm"\)/)
})

test('a nested edit keeps a result-owned temporary style snapshot', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([nestedEdit('n5')], { temporaryStyle: TEMPORARY_STYLE })))
  const value = await m.blockTool.execute({ program: nestedFragment('Text("A temp", "sm")') }, { agent: m.agent, callId: 'call-nested-temp' })
  assert.deepEqual(value.temporaryStyle, TEMPORARY_STYLE)
  assert.equal(value.style, 'card')
  assert.equal(Object.hasOwn(value, 'styleId'), false)
  const [record] = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.deepEqual(record.temporaryStyle, TEMPORARY_STYLE)
})

test('unsafe nested requests are rejected before rendering and record nothing', async () => {
  // Stale content digest: observer arms an unusable request, tool calls stay rejected.
  const digest = mount()
  digest.send(buildEditRequestText(nestedRequest([nestedEdit('n5', 1, { sourceDigest: 'deadbeef' })])))
  await assert.rejects(
    () => digest.blockTool.execute({ program: nestedFragment('Text("X", "sm")') }, { agent: digest.agent, callId: 'call-nested-digest' }),
    /changed since it was selected; ask the user to reload the page and reselect it/,
  )
  await assert.rejects(
    () => digest.blockTool.execute({ program: nestedFragment('Text("X", "sm")') }, { agent: digest.agent, callId: 'call-nested-digest-2' }),
    /changed since it was selected/,
  )
  assert.equal(existsSync(digest.file), false)
  // Unknown node id.
  const unknown = mount()
  unknown.send(buildEditRequestText(nestedRequest([nestedEdit('n5', 1, { nodeId: 'n99' })])))
  await assert.rejects(
    () => unknown.blockTool.execute({ program: nestedFragment('Text("X", "sm")') }, { agent: unknown.agent, callId: 'call-nested-unknown' }),
    /is not part of the current revision/,
  )
  assert.equal(existsSync(unknown.file), false)
  // Ancestor + descendant selected together.
  const ancestors = mount()
  ancestors.send(buildEditRequestText(nestedRequest([nestedEdit('n2', 1), nestedEdit('n5', 2)])))
  await assert.rejects(
    () => ancestors.blockTool.execute({ program: nestedFragment('Card([Text("x")])', 'Text("y", "sm")') }, { agent: ancestors.agent, callId: 'call-nested-ancestor' }),
    /cannot include a block together with its ancestor or descendant/,
  )
  assert.equal(existsSync(ancestors.file), false)
  // Mixed legacy and nested edits.
  const mixed = mount()
  mixed.send(buildEditRequestText(nestedRequest([nestedEdit('n5', 1), blockEdit('b2', 'legacy nested mix', 2)])))
  await assert.rejects(
    () => mixed.blockTool.execute({ program: nestedFragment('Text("X", "sm")') }, { agent: mixed.agent, callId: 'call-nested-mixed' }),
    /mixing top-level and nested edits in one request is not supported/,
  )
  assert.equal(existsSync(mixed.file), false)
})

test('nested edit validation rejects duplicate targets and edits a Title node', async () => {
  const duplicate = mount()
  duplicate.send(buildEditRequestText(nestedRequest([nestedEdit('n5', 1), nestedEdit('n5', 2, { blockId: 'b1.2' })])))
  await assert.rejects(
    () => duplicate.blockTool.execute({ program: nestedFragment('Text("a", "sm")', 'Text("b", "sm")') }, { agent: duplicate.agent, callId: 'call-nested-duplicate' }),
    /is selected more than once/,
  )
  assert.equal(existsSync(duplicate.file), false)
  // A nested Title is an ordinary editable block now.
  const title = mount()
  title.send(buildEditRequestText(nestedRequest([nestedEdit('n3')])))
  const value = await title.blockTool.execute({ program: nestedFragment('Title("X", "sm")') }, { agent: title.agent, callId: 'call-nested-title' })
  assert.equal(value.revision, 2)
  assert.match(value.program, /Title\("X", "sm"\)/)
  assert.equal(existsSync(title.file), true)
})

test('a malformed nested fragment fails retryably and keeps the request armed', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([nestedEdit('n5')])))
  await assert.rejects(
    () => m.blockTool.execute({ program: nestedFragment('Text("a", "sm")', 'Text("b", "sm")') }, { agent: m.agent, callId: 'call-nested-mismatch' }),
    /return exactly 1 root children, one per selected block in selection order/,
  )
  assert.equal(existsSync(m.file), false)
  const value = await m.blockTool.execute({ program: nestedFragment('Text("A retry", "sm")') }, { agent: m.agent, callId: 'call-nested-retry-ok' })
  assert.equal(value.revision, 2)
})

test('a nested order-only request rebuilds the hierarchy through render_ui', async () => {
  const m = mount()
  m.send(buildEditRequestText(parentOrderRequest({ n4: ['n7', 'n5', 'n6'] }, { requestId: 'req_parent_order1' })))
  const value = await m.tool.execute({ program: NESTED_PROGRAM, style: 'card', editRequestId: 'req_parent_order1' }, { agent: m.agent, callId: 'call-parent-order-1' })
  assert.equal(value.revision, 2)
  assert.deepEqual(value.editedBlockIds, [])
  assert.match(value.program.split('\n')[1], /Col\(\[Text\(sharedText, "sm"\), Text\("A", "sm"\), Text\("B", "sm"\)\]\)/)
  assert.equal(value.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2])
  assert.equal(typeof value.program, 'string')
  assert.equal(m.tool.output.presentationMeta({}, value).program, value.program)
  const [record] = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.deepEqual(record.editedBlockIds, [])
  assert.equal(record.revision, 2)
})

test('a root orderByParent group owns the root order and is not undone by targetOrder', async () => {
  const m = mount()
  m.send(buildEditRequestText(parentOrderRequest({ root: ['n8', 'n2'] }, { requestId: 'req_parent_order2' })))
  const value = await m.tool.execute({ program: NESTED_PROGRAM, style: 'card', editRequestId: 'req_parent_order2' }, { agent: m.agent, callId: 'call-parent-order-2' })
  assert.equal(value.program.split('\n')[0], 'root = Col([secondCard, outerCard])')
  assert.equal(value.program.split('\n')[1], NESTED_PROGRAM.split('\n')[1])
  assert.equal(value.warnings, undefined)
})

test('nested content edits and orderByParent compose deterministically', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([nestedEdit('n5')], {
    requestId: 'req_combo_order1',
    orderByParent: { n4: ['n7', 'n5', 'n6'] },
  })))
  const value = await m.blockTool.execute({ program: nestedFragment('Text("A edited", "sm")'), requestId: 'req_combo_order1' }, { agent: m.agent, callId: 'call-combo-order-1' })
  assert.equal(value.revision, 2)
  assert.match(value.program.split('\n')[1], /Col\(\[Text\(sharedText, "sm"\), Text\("A edited", "sm"\), Text\("B", "sm"\)\]\)/)
  assert.equal(value.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2])
  assert.deepEqual(value.editedBlockIds, ['b1'])
})

test('an unchanged orderByParent group plus a content edit is not treated as a no-op', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([nestedEdit('n5')], {
    requestId: 'req_combo_nooporder',
    orderByParent: { n4: ['n5', 'n6', 'n7'] },
  })))
  const value = await m.blockTool.execute({ program: nestedFragment('Text("A only", "sm")'), requestId: 'req_combo_nooporder' }, { agent: m.agent, callId: 'call-combo-noop-order' })
  assert.match(value.program.split('\n')[1], /Col\(\[Text\("A only", "sm"\), Text\("B", "sm"\), Text\(sharedText, "sm"\)\]\)/)
})

test('invalid orderByParent groups are rejected before rendering and record nothing', async () => {
  const cases = [
    [{ n99: ['n5'] }, /unknown parent/],
    [{ n4: ['n5', 'n6'] }, /must list every editable child exactly once/],
    [{ n2: ['n3'] }, /must list every editable child exactly once/],
    [{ n4: ['n5', 'n6', 'n11'] }, /lists a block from a different parent/],
    [{ root: ['n8', 'n2'] }, /targetOrder and orderByParent\.root cannot disagree/],
  ]
  for (const [orderByParent, expected] of cases) {
    const m = mount()
    const overrides = orderByParent.root === undefined ? { requestId: 'req_bad_order' } : { requestId: 'req_bad_order', targetOrder: ['b2', 'b1'] }
    m.send(buildEditRequestText(parentOrderRequest(orderByParent, overrides)))
    await assert.rejects(
      () => m.tool.execute({ program: NESTED_PROGRAM, style: 'card', editRequestId: 'req_bad_order' }, { agent: m.agent, callId: 'call-bad-order' }),
      expected,
    )
    assert.equal(existsSync(m.file), false, expected.source)
  }
})

test('a no-op order-only request is rejected consistently', async () => {
  const m = mount()
  m.send(buildEditRequestText(parentOrderRequest({ n4: ['n5', 'n6', 'n7'] }, { requestId: 'req_noop_order' })))
  await assert.rejects(
    () => m.tool.execute({ program: NESTED_PROGRAM, style: 'card', editRequestId: 'req_noop_order' }, { agent: m.agent, callId: 'call-noop-order' }),
    /changes nothing/,
  )
  assert.equal(existsSync(m.file), false)
})

test('a page that no longer matches the ordering fails retryably and keeps the request armed', async () => {
  const m = mount()
  m.send(buildEditRequestText(parentOrderRequest({ n4: ['n7', 'n5', 'n6'] }, { requestId: 'req_retry_order' })))
  const broken = 'root = Col([secondCard])\nsecondCard = Card([Title("第二张卡片", "sm"), Row([Text("C", "sm"), Text("D", "sm")])], "soft")\nsharedText = "shared"\nouterCard = Card([Title("外层卡片", "sm"), Col([Text("A", "sm"), Text("B", "sm"), Text(sharedText, "sm")])])'
  await assert.rejects(
    () => m.tool.execute({ program: broken, style: 'card', editRequestId: 'req_retry_order' }, { agent: m.agent, callId: 'call-broken-order' }),
    /requested block order|could not map the edited page|no longer keeps block/,
  )
  assert.equal(existsSync(m.file), false)
  const value = await m.tool.execute({ program: NESTED_PROGRAM, style: 'card', editRequestId: 'req_retry_order' }, { agent: m.agent, callId: 'call-retry-order' })
  assert.equal(value.revision, 2)
})

test('additions-only requests insert model-authored blocks into a nested parent', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([], {
    requestId: 'req_add_only_1',
    additions: [nestedAddition('n4', 3, 'add a callout under the existing text')],
  })))
  const value = await m.blockTool.execute({ program: nestedFragment('Text("new callout", "sm")'), requestId: 'req_add_only_1' }, { agent: m.agent, callId: 'call-add-only-1' })
  assert.equal(value.revision, 2)
  assert.deepEqual(value.editedBlockIds, ['b1'])
  assert.match(value.program.split('\n')[1], /Col\(\[Text\("A", "sm"\), Text\("B", "sm"\), Text\(sharedText, "sm"\), Text\("new callout", "sm"\)\]\)/)
  assert.equal(value.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2], 'the second card statement is byte-identical')
  assert.equal(value.program.split('\n')[3], NESTED_PROGRAM.split('\n')[3])
  assert.equal(m.blockTool.output.presentationMeta({}, value).program, value.program)
  const [record] = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.equal(record.revisionId, 'call-add-only-1')
})

test('additions-only requests work on a temporary-style base and keep the snapshot', async () => {
  const m = mount()
  const request = nestedRequest([], {
    requestId: 'req_add_temp_1',
    additions: [nestedAddition('n4', 3, 'add a temp-style callout')],
    temporaryStyle: { ...TEMPORARY_STYLE },
  })
  m.send(buildEditRequestText(request))
  const value = await m.blockTool.execute({ program: nestedFragment('Text("temp callout", "sm")'), requestId: 'req_add_temp_1' }, { agent: m.agent, callId: 'call-add-temp-1' })
  assert.equal(value.revision, 2)
  const [record] = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.deepEqual(record.temporaryStyle, TEMPORARY_STYLE, 'the temporary snapshot is retained')
})

test('additions-only requests can target the root and insert several blocks in request order', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([], {
    requestId: 'req_add_root_1',
    additions: [nestedAddition('n1', 1, 'first new top-level block'), nestedAddition('n1', 2, 'second new top-level block')],
  })))
  const value = await m.blockTool.execute({ program: nestedFragment('Text("one", "sm")', 'Text("two", "sm")'), requestId: 'req_add_root_1' }, { agent: m.agent, callId: 'call-add-root-1' })
  assert.equal(value.program.split('\n')[0], 'root = Col([outerCard, Text("one", "sm"), Text("two", "sm"), secondCard])')
  assert.equal(value.program.split('\n')[1], NESTED_PROGRAM.split('\n')[1])
  assert.deepEqual(value.editedBlockIds, [], 'a root-level addition has no containing root block')
  assert.equal(value.warnings, undefined)
})

test('edits and additions compose by fragment order and survive an edit that changes node ids', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([
    nestedEdit('n6', 2),
    nestedEdit('n5', 1),
  ], {
    requestId: 'req_add_combo_1',
    additions: [nestedAddition('n8', 1, 'insert before the row')],
  })))
  const value = await m.blockTool.execute({
    // Fragment children: sorted edits first (n5 then n6), then additions in request order.
    program: nestedFragment('Col([Text("A nested", "sm"), Text("B nested", "sm")])', 'Text("B rewritten", "sm")', 'Text("card new", "sm")'),
    requestId: 'req_add_combo_1',
  }, { agent: m.agent, callId: 'call-add-combo-1' })
  assert.match(value.program.split('\n')[1], /Col\(\[Col\(\[Text\("A nested", "sm"\), Text\("B nested", "sm"\)\]\), Text\("B rewritten", "sm"\), Text\(sharedText, "sm"\)\]\)/)
  assert.match(value.program.split('\n')[2], /secondCard = Card\(\[Title\("第二张卡片", "sm"\), Text\("card new", "sm"\), Row\(/)
  assert.equal(value.program.split('\n')[3], NESTED_PROGRAM.split('\n')[3])
})

test('additions only accept parents outside the edited subtrees', async () => {
  const cases = [
    { edits: [nestedEdit('n5')], addition: nestedAddition('n5', 0), expected: /being edited or is an ancestor\/descendant/ },
    { edits: [nestedEdit('n5')], addition: nestedAddition('n2', 1), expected: /being edited or is an ancestor\/descendant/ },
    { edits: [nestedEdit('n2')], addition: nestedAddition('n4', 3), expected: /being edited or is an ancestor\/descendant/ },
  ]
  for (const [index, entry] of cases.entries()) {
    const m = mount()
    m.send(buildEditRequestText(nestedRequest(entry.edits, { requestId: `req_add_conflict_${index}`, additions: [entry.addition] })))
    await assert.rejects(
      () => m.blockTool.execute({ program: nestedFragment('Text("x", "sm")', 'Text("y", "sm")'), requestId: `req_add_conflict_${index}` }, { agent: m.agent, callId: `call-add-conflict-${index}` }),
      entry.expected,
    )
    assert.equal(existsSync(m.file), false)
  }
})

test('additions cannot mix with legacy top-level edits in one request', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([blockEdit('b2', 'legacy top-level edit', 1)], {
    requestId: 'req_add_mixed',
    additions: [nestedAddition('n4', 0, 'new nested block')],
  })))
  await assert.rejects(
    () => m.blockTool.execute({ program: nestedFragment('Text("legacy", "sm")', 'Text("new", "sm")'), requestId: 'req_add_mixed' }, { agent: m.agent, callId: 'call-add-mixed' }),
    /mixing top-level and nested edits in one request is not supported/,
  )
  assert.equal(existsSync(m.file), false)
})

test('additions reject invalid parents, positions and malformed fragments retryably', async () => {
  const invalid = [
    { addition: { parentBlockId: 'b1', parentNodeId: 'n99', index: 0, instruction: 'x' }, expected: /not part of the current revision/ },
    { addition: nestedAddition('n5', 0), expected: /cannot receive new blocks|has no writable children slot/ },
    { addition: nestedAddition('n3', 0), expected: /cannot receive new blocks/ },
    { addition: nestedAddition('n4', 99), expected: /new block position for parent .* must be between 0 and 3/ },
  ]
  for (const [index, entry] of invalid.entries()) {
    const m = mount()
    m.send(buildEditRequestText(nestedRequest([], { requestId: `req_add_invalid_${index}`, additions: [entry.addition] })))
    await assert.rejects(
      () => m.blockTool.execute({ program: nestedFragment('Text("x", "sm")'), requestId: `req_add_invalid_${index}` }, { agent: m.agent, callId: `call-add-invalid-${index}` }),
      entry.expected,
    )
    assert.equal(existsSync(m.file), false)
  }
  // Malformed fragment stays retryable with the pending request armed.
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([], { requestId: 'req_add_retry', additions: [nestedAddition('n4', 0)] })))
  await assert.rejects(
    () => m.blockTool.execute({ program: nestedFragment('Text("a", "sm")', 'Text("b", "sm")'), requestId: 'req_add_retry' }, { agent: m.agent, callId: 'call-add-bad-fragment' }),
    /return exactly 1 root children: 0 edited block\(s\) in selection order followed by 1 new block\(s\) in request order/,
  )
  assert.equal(existsSync(m.file), false)
  const value = await m.blockTool.execute({ program: nestedFragment('Text("A added", "sm")'), requestId: 'req_add_retry' }, { agent: m.agent, callId: 'call-add-retry-ok' })
  assert.equal(value.revision, 2)
  assert.match(value.program.split('\n')[1], /Col\(\[Text\("A added", "sm"\), Text\("A", "sm"\), Text\("B", "sm"\), Text\(sharedText, "sm"\)\]\)/)
})

test('additions may use new helper statements and a multi-line mini program root', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([], { requestId: 'req_add_helper', additions: [nestedAddition('n4', 0)] })))
  const value = await m.blockTool.execute({
    program: 'root = Col([newText])\nnewText = Card([Text("from addition helper", "sm")])',
    requestId: 'req_add_helper',
  }, { agent: m.agent, callId: 'call-add-helper' })
  assert.match(value.program.split('\n')[1], /Col\(\[newText, Text\("A", "sm"\)/)
  assert.match(value.program, /newText = Card\(\[Text\("from addition helper", "sm"\)\]\)/)
})

test('strict mode accepts a nested edit that only changes the selected block', async () => {
  const m = mount()
  m.send(buildEditRequestText(nestedRequest([nestedEdit('n5')], { strict: true, requestId: 'req_strict_ok' })))
  const value = await m.blockTool.execute({
    program: nestedFragment('Text("A strict", "sm")'),
    requestId: 'req_strict_ok',
  }, { agent: m.agent, callId: 'call-strict-ok' })
  assert.equal(value.revision, 2)
  assert.equal(value.warnings, undefined)
  assert.match(value.program.split('\n')[1], /Text\("A strict", "sm"\)/)
  assert.equal(JSON.parse(readFileSync(m.file, 'utf8')).revisions.length, 1)
})

test('strict mode rejects a full render that changes an unselected block and keeps the request armed', async () => {
  const m = mount()
  m.send(buildEditRequestText({
    schemaVersion: 1, artifactId: 'call-original', baseRevisionId: 'call-original', baseRevision: 1,
    requestId: 'req_strict_full', title: NESTED_TITLE, style: 'card', edits: [],
    targetOrder: ['b1', 'b2'], globalInstruction: 'Tidy up the spacing without changing any block.',
    strict: true, program: NESTED_PROGRAM,
  }))
  const changed = NESTED_PROGRAM.replace('Text("B", "sm")', 'Text("B changed", "sm")')
  await assert.rejects(
    () => m.tool.execute({ program: changed, style: 'card', editRequestId: 'req_strict_full' }, { agent: m.agent, callId: 'call-strict-full-bad' }),
    (error) => {
      assert.match(error.message, /^render_ui: strict mode is on; unselected block\(s\) changed: /)
      assert.match(error.message, /Unselected block .* changed/)
      assert.ok(error.message.length < 1_500, 'the error summarizes warnings instead of echoing the page')
      assert.equal(error.message.includes('root = Col('), false)
      return true
    },
  )
  assert.equal(existsSync(m.file), false, 'a strict rejection records no revision')
  // The same pending request can be retried when the model leaves unselected blocks unchanged.
  const value = await m.tool.execute({ program: NESTED_PROGRAM, style: 'card', editRequestId: 'req_strict_full' }, { agent: m.agent, callId: 'call-strict-full-ok' })
  assert.equal(value.revision, 2)
  assert.equal(JSON.parse(readFileSync(m.file, 'utf8')).revisions.length, 1)
})

test('non-strict full render keeps the unselected-block warning and records the revision', async () => {
  const m = mount()
  const request = {
    schemaVersion: 1, artifactId: 'call-original', baseRevisionId: 'call-original', baseRevision: 1,
    requestId: 'req_strict_off', title: NESTED_TITLE, style: 'card', edits: [],
    targetOrder: ['b1', 'b2'], globalInstruction: 'Tidy up the spacing.', program: NESTED_PROGRAM,
  }
  m.send(buildEditRequestText(request))
  const changed = NESTED_PROGRAM.replace('Text("B", "sm")', 'Text("B changed", "sm")')
  const value = await m.tool.execute({ program: changed, style: 'card', editRequestId: 'req_strict_off' }, { agent: m.agent, callId: 'call-strict-off' })
  assert.equal(value.revision, 2)
  assert.ok(Array.isArray(value.warnings) && value.warnings.some(warning => /Unselected block .* changed/.test(warning)))
  assert.equal(JSON.parse(readFileSync(m.file, 'utf8')).revisions.length, 1)
})

test('strict mode does not reject order-only or nested-order requests', async () => {
  const m = mount()
  m.send(buildEditRequestText(parentOrderRequest({ n4: ['n7', 'n5', 'n6'] }, { strict: true, requestId: 'req_strict_order' })))
  const value = await m.tool.execute({ program: NESTED_PROGRAM, style: 'card', editRequestId: 'req_strict_order' }, { agent: m.agent, callId: 'call-strict-order' })
  assert.equal(value.revision, 2)
  assert.match(value.program.split('\n')[1], /Col\(\[Text\(sharedText, "sm"\), Text\("A", "sm"\), Text\("B", "sm"\)\]\)/)
})

test('strict mode summary mentions every unselected block it can, without full source', async () => {
  const m = mount()
  m.send(buildEditRequestText({
    schemaVersion: 1, artifactId: 'call-original', baseRevisionId: 'call-original', baseRevision: 1,
    requestId: 'req_strict_multi', title: NESTED_TITLE, style: 'card', edits: [],
    targetOrder: ['b1', 'b2'], globalInstruction: 'Tidy up.',
    strict: true, program: NESTED_PROGRAM,
  }))
  const changed = NESTED_PROGRAM
    .replace('Text("B", "sm")', 'Text("B changed", "sm")')
    .replace('Text("D", "sm")', 'Text("D changed", "sm")')
  await assert.rejects(
    () => m.tool.execute({ program: changed, style: 'card', editRequestId: 'req_strict_multi' }, { agent: m.agent, callId: 'call-strict-multi' }),
    (error) => {
      assert.match(error.message, /strict mode is on/)
      assert.ok(error.message.includes('Unselected block'))
      assert.equal(existsSync(m.file), false)
      return true
    },
  )
})

/** Drive the controller directly so the TTL and session bound are observable. */
function directController() {
  const home = mkdtempSync(join(tmpdir(), 'iui-artifact-edit-direct-'))
  homes.push(home)
  process.env.DSH_HOME = home
  const revisions = createArtifactRevisionStore()
  const handlers = []
  let time = 100
  const controller = createArtifactEditController(
    { on(name, handler) { if (name === 'session/event') handlers.push(handler) } },
    revisions,
    { now: () => time },
  )
  const send = (text, sessionId = 's1') => {
    for (const handler of handlers) {
      handler({ id: sessionId }, { type: 'user/message', data: { id: 'm', source: { kind: 'user' }, content: [{ type: 'text', text }] } })
    }
  }
  return { controller, send, advance(milliseconds) { time += milliseconds } }
}

test('armed edit requests expire after the TTL, and a new envelope replaces the old one', () => {
  const direct = directController()
  direct.send(ENVELOPE)
  assert.ok(direct.controller.pending('s1').request)
  direct.advance(ARTIFACT_EDIT_TTL - 1)
  assert.ok(direct.controller.pending('s1').request)
  direct.advance(1)
  assert.equal(direct.controller.pending('s1'), undefined)
  direct.send(MALFORMED_ENVELOPE)
  assert.equal(direct.controller.pending('s1').request, undefined)
  assert.match(direct.controller.pending('s1').invalidReason, /could not be read/)
  direct.send(ENVELOPE)
  assert.ok(direct.controller.pending('s1').request)
  direct.advance(ARTIFACT_EDIT_TTL)
  assert.throws(
    () => direct.controller.apply({ sessionId: 's1', callId: 'call-late', args: { program: DST_PROGRAM, style: 'card' } }),
    /expired before the page was updated\. Ask the user to reload the rendered page/,
  )
})

test('the pending registry keeps at most 64 sessions and drops the oldest', () => {
  const direct = directController()
  for (let index = 0; index < 65; index++) direct.send(ENVELOPE, `session-${index}`)
  assert.equal(direct.controller.pending('session-0'), undefined)
  assert.ok(direct.controller.pending('session-1').request)
  assert.ok(direct.controller.pending('session-64').request)
})

test('render_ui advertises the style-edit fields without leaking the branch flag in the projection', () => {
  const m = mount()
  const properties = m.tool.output.schema.properties
  for (const key of ['styleEdit', 'temporaryStyle', 'title']) assert.ok(properties[key], key)
  assert.equal(properties.styleEdit.type, 'boolean')
  assert.equal(properties.temporaryStyle.type, 'object')
  assertDshToolSchema(m.tool.output.schema, 'render_ui.output.schema')
  assert.deepEqual(m.tool.output.schema.required, ['statements', 'style'])
})

test('a natural-language style edit records revision 2 with the model snapshot and no block ids', async () => {
  const m = mount()
  await m.tool.execute({ program: DST_PROGRAM, style: 'card' }, { agent: m.agent, callId: 'call-original' })
  m.send(buildEditRequestText(styleRequest()))
  const value = await m.tool.execute(styleArgs(), { agent: m.agent, callId: 'call-style-1' })
  assert.equal(value.styleEdit, true)
  assert.equal(value.revision, 2)
  assert.equal(value.requestId, 'req_style_0001')
  assert.equal(value.baseRevisionId, 'call-original')
  assert.equal(value.style, 'card')
  assert.deepEqual(value.temporaryStyle, STYLE_SNAPSHOT)
  assert.equal(value.title, DST_TITLE)
  assert.equal(Object.hasOwn(value, 'styleId'), false)
  assert.equal(Object.hasOwn(value, 'editedBlockIds'), false, 'a style edit changes no block')
  const [record] = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.equal(record.revisionId, 'call-style-1')
  assert.equal(record.style, 'card')
  assert.deepEqual(record.temporaryStyle, STYLE_SNAPSHOT, 'H7: the approved tool-argument snapshot is recorded')
  assert.equal(Object.hasOwn(record, 'styleId'), false)
  assert.equal(Object.hasOwn(record, 'editedBlockIds'), false)
  // The revision boundary recorded the result snapshot exactly once, before the revision write.
  const results = JSON.parse(readFileSync(join(m.home, 'dsh-intelligent-ui-results.json'), 'utf8')).results
  assert.deepEqual(results, [{
    resultId: 'call-style-1',
    sessionId: 's1',
    snapshot: STYLE_SNAPSHOT,
    parentResultId: 'call-original',
    createdAt: record.createdAt,
  }])
  const meta = m.tool.output.presentationMeta({}, value)
  assert.deepEqual(meta, {
    artifactId: 'call-original',
    revisionId: 'call-style-1',
    requestId: 'req_style_0001',
    baseRevisionId: 'call-original',
    revision: 2,
    style: 'card',
    temporaryStyle: STYLE_SNAPSHOT,
    title: DST_TITLE,
  })
  assert.equal(isArtifactRevisionMeta(meta), true)
  assert.equal(Object.hasOwn(meta, 'styleEdit'), false, 'H6: the projection meta never carries the branch flag')
  assert.equal(Object.hasOwn(meta, 'kind'), false)
  assert.equal(m.tool.output.render({}, value)[0].text, 'Interactive UI style updated for the user (revision 2 of the artifact, card layout).')
  const programs = JSON.parse(readFileSync(join(m.home, 'dsh-intelligent-ui-programs.json'), 'utf8')).programs
  assert.ok(programs.some((entry) => entry.revisionId === 'call-style-1'))
  // The request was consumed exactly once.
  await assert.rejects(
    () => m.tool.execute(styleArgs({ temporaryStyle: STYLE_SNAPSHOT_ALT }), { agent: m.agent, callId: 'call-style-again' }),
    /no pending Artifact edit request matches editRequestId/,
  )
})

test('a style edit on a template-based page keeps the layout and drops the template id', async () => {
  const custom = template()
  const m = mount({ answerStyle: custom.id, templates: [custom] })
  await m.tool.execute({ program: DST_PROGRAM, style: custom.baseLayout, styleId: custom.id }, { agent: m.agent, callId: 'call-original' })
  m.send(buildEditRequestText(styleRequest({ styleId: custom.id, temporaryStyle: undefined })))
  const value = await m.tool.execute(styleArgs(), { agent: m.agent, callId: 'call-style-template' })
  assert.equal(value.styleEdit, true)
  assert.equal(value.style, custom.baseLayout)
  assert.equal(Object.hasOwn(value, 'styleId'), false, 'the snapshot replaces the template id')
  const [record] = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  assert.equal(record.style, custom.baseLayout)
  assert.equal(Object.hasOwn(record, 'styleId'), false)
  assert.deepEqual(record.temporaryStyle, STYLE_SNAPSHOT)
})

test('an unchanged style edit is a no-op that stays armed; a changed snapshot is accepted', async () => {
  const m = mount()
  m.send(buildEditRequestText(styleRequest()))
  await assert.rejects(
    () => m.tool.execute(styleArgs({ temporaryStyle: TEMPORARY_STYLE }), { agent: m.agent, callId: 'call-style-noop' }),
    /changes nothing \(the program and the approved temporaryStyle snapshot are unchanged\)/,
  )
  assert.equal(existsSync(m.file), false, 'a no-op records no revision')
  const value = await m.tool.execute(styleArgs({ temporaryStyle: STYLE_SNAPSHOT }), { agent: m.agent, callId: 'call-style-retry' })
  assert.equal(value.styleEdit, true)
  assert.equal(value.revision, 2)
})

test('style edits are explicit, snapshot-bound and never mix with block or on-demand paths', async () => {
  // H2: an unknown selector fails before any on-demand authorization.
  const selectorMiss = mount()
  await assert.rejects(
    () => selectorMiss.tool.execute(styleArgs({ editRequestId: 'req_unknown_0001' }), { agent: selectorMiss.agent, callId: 'call-selector' }),
    /no pending Artifact edit request matches editRequestId/,
  )
  // H1: a single pending style request is never auto-applied without editRequestId.
  const h1 = mount()
  h1.send(buildEditRequestText(styleRequest()))
  await assert.rejects(
    () => h1.tool.execute({ program: DST_PROGRAM, style: 'card', temporaryStyle: STYLE_SNAPSHOT }, { agent: h1.agent, callId: 'call-h1' }),
    /pending natural-language style edit \(requestId "req_style_0001"\)/,
  )
  assert.equal(existsSync(h1.file), false, 'H1: the style request was not applied')
  // A style edit without the approved snapshot is rejected.
  await assert.rejects(
    () => h1.tool.execute({ program: DST_PROGRAM, style: 'card', editRequestId: 'req_style_0001' }, { agent: h1.agent, callId: 'call-no-snapshot' }),
    /must be rendered with the approved temporaryStyle snapshot/,
  )
  // Bad baseLayout and unsafe contrast reuse the on-demand snapshot checks.
  await assert.rejects(
    () => h1.tool.execute(styleArgs({ temporaryStyle: { ...STYLE_SNAPSHOT, baseLayout: 'article' } }), { agent: h1.agent, callId: 'call-bad-layout' }),
    /baseLayout must match style/,
  )
  await assert.rejects(
    () => h1.tool.execute(styleArgs({ temporaryStyle: { ...STYLE_SNAPSHOT, theme: { ...THEME, light: { ...THEME.light, accent: '#aaaaaa' } } } }), { agent: h1.agent, callId: 'call-bad-contrast' }),
    /contrast must be at least 3:1/,
  )
  // The recorded styleId must not travel with the model's style-edit arguments.
  await assert.rejects(
    () => h1.tool.execute(styleArgs({ styleId: 'cs_abcdef123456' }), { agent: h1.agent, callId: 'call-style-id' }),
    /keeps the recorded page style; omit styleId/,
  )
  // edit_ui_blocks redirects a style request and keeps it armed.
  await assert.rejects(
    () => h1.blockTool.execute({ program: 'root = Col([Text("x")])' }, { agent: h1.agent, callId: 'call-redirect' }),
    /changes the page presentation only; call render_ui/,
  )
  assert.equal(existsSync(h1.file), false, 'the redirect consumes nothing')
  // With no pending request at all, a temporaryStyle still needs on-demand authorization.
  const noPending = mount()
  await assert.rejects(
    () => noPending.tool.execute({ program: DST_PROGRAM, style: 'card', temporaryStyle: STYLE_SNAPSHOT }, { agent: noPending.agent, callId: 'call-no-pending' }),
    /requires a bound, running on-demand operation/,
  )
  // A temporaryStyle argument cannot substitute for a pending block request either.
  const blockTemp = mount()
  blockTemp.send(buildEditRequestText(editRequest()))
  await assert.rejects(
    () => blockTemp.tool.execute({ program: DST_PROGRAM, style: 'card', temporaryStyle: STYLE_SNAPSHOT }, { agent: blockTemp.agent, callId: 'call-block-temp' }),
    /requires a bound, running on-demand operation/,
  )
})

test('the documented style-edit tool args are accepted by the Host for every base kind', async () => {
  // Couples the envelope contract (built-in / saved-template / temporary base)
  // to the Host's accepted render_ui arguments: serializer/Host drift fails here.
  const cases = [
    { label: 'builtin', request: styleRequest() },
    { label: 'saved', request: (() => { const r = styleRequest(); delete r.temporaryStyle; r.styleId = 'cs_abcdef123456'; return r })() },
    { label: 'temporary', request: styleRequest({ temporaryStyle: { ...TEMPORARY_STYLE } }) },
  ]
  for (const [index, entry] of cases.entries()) {
    const contract = styleEditToolContract(entry.request)
    assert.equal(contract.style, entry.request.style)
    assert.equal(contract.editRequestId, entry.request.requestId)
    assert.equal(contract.requiresTemporaryStyle, true)
    assert.deepEqual([...contract.requiredArguments], ['program', 'style', 'editRequestId', 'temporaryStyle'])
    assert.deepEqual([...contract.optionalArguments], [])
    assert.deepEqual([...contract.forbiddenArguments], ['styleId', 'artifactId'])
    const args = buildStyleEditToolArgs(entry.request, DST_PROGRAM, STYLE_SNAPSHOT)
    assert.deepEqual(Object.keys(args).sort(), ['editRequestId', 'program', 'style', 'temporaryStyle'])
    const m = mount()
    m.send(buildEditRequestText(entry.request))
    const value = await m.tool.execute(
      args,
      { agent: m.agent, callId: 'call-contract-style-' + index },
    )
    assert.equal(value.styleEdit, true, entry.label + ' base: the documented args are accepted')
    assert.equal(value.revision, 2, entry.label + ' base: one revision recorded')
  }
})
test('the documented block-edit tool args match the contract and are accepted by the Host', async () => {
  // Couples both block envelope modes to the Host tools and pins the generated
  // argument sets: content edits use edit_ui_blocks fragments (selector included),
  // order-only requests use render_ui with the recorded style/styleId.
  const fragmentRequest = editRequest({ requestId: 'req_block_contract1' })
  const fragmentContract = blockEditToolContract(fragmentRequest)
  assert.equal(fragmentContract.tool, 'edit_ui_blocks')
  assert.deepEqual([...fragmentContract.requiredArguments], ['program'])
  assert.deepEqual([...fragmentContract.optionalArguments], ['requestId', 'artifactId'])
  assert.deepEqual([...fragmentContract.forbiddenArguments], ['style', 'styleId', 'temporaryStyle'])
  const fragment = blockFragment(['b4'], { b4: UPDATED_MONTH })
  const fragmentArgs = buildBlockEditToolArgs(fragmentRequest, fragment)
  assert.deepEqual(Object.keys(fragmentArgs).sort(), ['artifactId', 'program', 'requestId'])
  const fragmentMount = mount()
  fragmentMount.send(buildEditRequestText(fragmentRequest))
  fragmentMount.send(buildEditRequestText(editRequest({ requestId: 'req_block_contract2' })))
  const fragmentValue = await fragmentMount.blockTool.execute(fragmentArgs, { agent: fragmentMount.agent, callId: 'call-contract-block-fragment' })
  assert.equal(fragmentValue.revision, 2, 'fragment contract args are accepted with two pending requests')
  assert.equal(fragmentValue.requestId, 'req_block_contract1', 'the contract selector picks the right request')

  const renderRequest = orderOnlyRequest({ targetOrder: TARGET_ORDER, requestId: 'req_render_contract1', styleId: 'cs_abcdef123456', title: DST_TITLE })
  const renderContract = blockEditToolContract(renderRequest)
  assert.equal(renderContract.tool, 'render_ui')
  assert.deepEqual([...renderContract.requiredArguments], ['program', 'style'])
  assert.deepEqual([...renderContract.optionalArguments], ['styleId', 'editRequestId'])
  assert.deepEqual([...renderContract.forbiddenArguments], ['temporaryStyle', 'requestId', 'artifactId'])
  const reordered = reorderProgramToTargetOrder(DST_PROGRAM, TARGET_ORDER, extractArtifactBlocks(DST_PROGRAM))
  const renderArgs = buildBlockEditToolArgs(renderRequest, reordered)
  assert.deepEqual(Object.keys(renderArgs).sort(), ['editRequestId', 'program', 'style', 'styleId'])
  const renderMount = mount()
  renderMount.send(buildEditRequestText(renderRequest))
  const renderValue = await renderMount.tool.execute(renderArgs, { agent: renderMount.agent, callId: 'call-contract-block-render' })
  assert.equal(renderValue.revision, 2, 'render contract args are accepted')
  assert.equal(renderValue.title, DST_TITLE, 'the recorded title survives an order-only edit')
  assert.equal(renderValue.styleId, 'cs_abcdef123456', 'the recorded template identity survives an order-only edit')
  const renderMeta = renderMount.tool.output.presentationMeta({}, renderValue)
  assert.equal(renderMeta.title, DST_TITLE, 'presentationMeta carries the recorded title')
  assert.equal(renderMeta.styleId, 'cs_abcdef123456', 'presentationMeta carries the recorded template id')
})

test('an order-only edit uses the artifact recorded style when the session template differs', async () => {
  // H4: a pending block edit renders the artifact identity, not the session's
  // current template; the generated contract must not deadlock this state.
  const m = mount({ answerStyle: 'article' })
  const request = orderOnlyRequest({ targetOrder: TARGET_ORDER })
  const reordered = reorderProgramToTargetOrder(DST_PROGRAM, TARGET_ORDER, extractArtifactBlocks(DST_PROGRAM))
  m.send(buildEditRequestText(request))
  const value = await m.tool.execute(buildBlockEditToolArgs(request, reordered), { agent: m.agent, callId: 'call-contract-artifact-style' })
  assert.equal(value.revision, 2)
  assert.equal(value.style, 'card')
})

test('a recorded result-owned snapshot is authoritative for content edits', async () => {
  const authoritative = { schemaVersion: 1, baseLayout: 'card', directives: 'Authoritative skin kept by the registry.' }
  const forged = { ...authoritative, directives: 'Forged skin from the client request.' }
  const m = mount()
  const first = editRequest({ requestId: 'req_temp_snapshot_a', temporaryStyle: authoritative })
  m.send(buildEditRequestText(first))
  await m.blockTool.execute(buildBlockEditToolArgs(first, blockFragment(['b4'], { b4: UPDATED_MONTH })), { agent: m.agent, callId: 'call-temp-first' })
  const second = editRequest({
    requestId: 'req_temp_snapshot_b',
    baseRevisionId: 'call-temp-first',
    baseRevision: 2,
    temporaryStyle: forged,
  })
  m.send(buildEditRequestText(second))
  const value = await m.blockTool.execute(buildBlockEditToolArgs(second, blockFragment(['b4'], { b4: UPDATED_MONTH })), { agent: m.agent, callId: 'call-temp-second' })
  assert.equal(value.revision, 3)
  const revisions = JSON.parse(readFileSync(m.file, 'utf8')).revisions
  const recorded = revisions.find(entry => entry.revisionId === 'call-temp-second')
  assert.deepEqual(recorded.temporaryStyle, authoritative, 'the forged snapshot is ignored')
})

test('an armed on-demand turn cannot absorb a pending style edit (H3)', async () => {
  const m = mount()
  const armed = m.command('on-demand')
  assert.match(String(armed.text), /armed/)
  m.send(buildEditRequestText(styleRequest()))
  await assert.rejects(
    () => m.tool.execute(styleArgs(), { agent: m.agent, callId: 'call-h3' }),
    /inside a Host-authorized on-demand turn, so it cannot apply a pending natural-language style edit/,
  )
  assert.equal(existsSync(m.file), false, 'H3: the style edit records nothing during an on-demand turn')
})

test('stale and branch base rules apply to natural-language style edits', async () => {
  const m = mount()
  m.send(buildEditRequestText(styleRequest()))
  // A block edit on the same artifact records revision 2 while the style request stays armed.
  m.send(buildEditRequestText(editRequest({ requestId: 'req_block_0001' })))
  await m.blockTool.execute({ program: blockFragment(['b4'], { b4: UPDATED_MONTH }), requestId: 'req_block_0001' }, { agent: m.agent, callId: 'call-block-1' })
  await assert.rejects(
    () => m.tool.execute(styleArgs(), { agent: m.agent, callId: 'call-style-stale' }),
    /targets revision 1, but revision 2 is now the latest; the page is out of date/,
  )
  // A branch style edit may target the older revision; it records latest + 1.
  m.send(buildEditRequestText(styleRequest({ requestId: 'req_style_branch', branch: true, temporaryStyle: undefined })))
  const branched = await m.tool.execute(
    styleArgs({ editRequestId: 'req_style_branch' }),
    { agent: m.agent, callId: 'call-style-branch' },
  )
  assert.equal(branched.styleEdit, true)
  assert.equal(branched.revision, 3)
  assert.equal(branched.baseRevisionId, 'call-original')
})

test('a style edit that returns no editable blocks warns once (H4)', async () => {
  const m = mount()
  m.send(buildEditRequestText(styleRequest()))
  const value = await m.tool.execute(styleArgs({ program: 'root = Col([])' }), { agent: m.agent, callId: 'call-h4' })
  assert.equal(value.styleEdit, true)
  assert.ok(value.warnings.includes('The updated page no longer exposes any editable blocks; a style-only revision should keep the original blocks and change only their presentation.'))
  const rendered = m.tool.output.render({}, value)[0].text
  assert.match(rendered, /Interactive UI style updated for the user \(revision 2 of the artifact, card layout\)\. Notes: .*editable blocks/)
})

test('program inspection and the article predicate keep their exact render_ui messages', async () => {
  // Valid programs inspect with no fatal finding and a positive statement count.
  const dst = inspectProgram(DST_PROGRAM)
  assert.equal(dst.findings.filter(finding => finding.fatal).length, 0)
  assert.ok(dst.statements > 0)
  assert.ok(dst.types.has('Card'))
  const valid = inspectProgram(ARTICLE)
  assert.equal(valid.findings.filter(finding => finding.fatal).length, 0)
  // A valid article page passes the shared predicate.
  assert.equal(describeArticleLayoutProblem(ARTICLE), undefined)
  // The predicate returns the exact inline message render_ui has always thrown.
  assert.equal(
    describeArticleLayoutProblem(DST_PROGRAM),
    'render_ui: the article style needs a Toc and at least one Section. '
      + 'Use Toc(["..."]) and Section("...", [Markdown("...")]) for every major part; a plain Markdown program is the card style.',
  )
  // Anchor problems are the same messages articleAnchorError produced inline.
  const duplicateSections = 'root = Col([toc, a, b])\ntoc = Toc(["Intro", "Intro"])\na = Section("Intro", [Markdown("A.")])\nb = Section("Intro", [Markdown("B.")])'
  assert.match(describeArticleLayoutProblem(duplicateSections), /Section anchors must be unique/)
  const missingTarget = 'root = Col([toc, section])\ntoc = Toc(["Missing"])\nsection = Section("Intro", [Markdown("Body.")])'
  assert.match(describeArticleLayoutProblem(missingTarget), /every Toc entry must target a Section anchor/)
  // render_ui throws exactly those messages (the built Host still calls the same path).
  const m = mount()
  await assert.rejects(
    () => m.tool.execute({ program: DST_PROGRAM, style: 'article' }, { agent: m.agent, callId: 'call-article-missing' }),
    /render_ui: the article style needs a Toc and at least one Section\. Use Toc\(\["\.\.\."\]\)/,
  )
  await assert.rejects(
    () => m.tool.execute({ program: duplicateSections, style: 'article' }, { agent: m.agent, callId: 'call-article-anchor' }),
    /Section anchors must be unique/,
  )
  const article = await m.tool.execute({ program: ARTICLE, style: 'article' }, { agent: m.agent, callId: 'call-article-ok' })
  assert.equal(article.style, 'article')
  assert.equal(existsSync(m.file), false)
})

test('a style edit that adds a top-level block warns and keeps the style-only guarantee', async () => {
  const base = 'root = Col([a, b])\na = Title("A")\nb = Text("B")'
  const added = 'root = Col([a, b, c])\na = Title("A")\nb = Text("B")\nc = Text("C")'
  const m = mount()
  m.send(buildEditRequestText(styleRequest({ program: base, title: undefined })))
  const value = await m.tool.execute(styleArgs({ program: added }), { agent: m.agent, callId: 'call-style-added' })
  assert.equal(value.styleEdit, true)
  assert.ok(
    value.warnings.some(warning => /Top-level blocks changed: the page now has 3 top-level blocks instead of 2/.test(warning)),
    'adding a top-level block is warned about',
  )
  assert.match(m.tool.output.render({}, value)[0].text, /Top-level blocks changed/)
})

test('a style edit that reorders top-level blocks warns and keeps the style-only guarantee', async () => {
  const base = 'root = Col([a, b])\na = Title("A")\nb = Text("B")'
  const reordered = 'root = Col([b, a])\na = Title("A")\nb = Text("B")'
  const m = mount()
  m.send(buildEditRequestText(styleRequest({ program: base, title: undefined })))
  const value = await m.tool.execute(styleArgs({ program: reordered }), { agent: m.agent, callId: 'call-style-reordered' })
  assert.equal(value.styleEdit, true)
  assert.ok(
    value.warnings.some(warning => /Top-level block order changed; a style edit must keep the page structure/.test(warning)),
    'reordering top-level blocks is warned about',
  )
})

test('a style edit that keeps the top-level blocks and order produces no structure warning', async () => {
  const base = 'root = Col([a, b])\na = Title("A")\nb = Text("B")'
  const m = mount()
  m.send(buildEditRequestText(styleRequest({ program: base, title: undefined })))
  const value = await m.tool.execute(styleArgs({ program: base }), { agent: m.agent, callId: 'call-style-unchanged' })
  assert.equal(value.styleEdit, true)
  assert.equal(
    (value.warnings ?? []).some(warning => /Top-level block(?:s changed| order changed)/.test(warning)),
    false,
    'an unchanged structure produces no structure warning',
  )
  assert.equal(value.warnings, undefined, 'the only allowed warning is none here')
})
