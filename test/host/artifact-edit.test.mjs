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
  buildEditRequestText, isArtifactRevisionMeta,
} from '../../src/shared/artifact-edit.ts'
import { extractArtifactBlocks, readRootLayout, reorderProgramToTargetOrder } from '../../src/shared/artifact-blocks.ts'
import { extractBlockBundle } from '../../src/shared/artifact-block-bundle.ts'
import { ARTIFACT_EDIT_TTL, createArtifactEditController } from '../../src/host/artifact-edit.ts'
import { createArtifactRevisionStore } from '../../src/host/artifact-revisions.ts'
import { assertDshToolSchema } from '../../src/host/tool-schema.ts'
import { DST_PROGRAM, DST_TITLE } from '../browser/fixtures/dst-artifact.ts'
import { template } from './style-fixtures.mjs'

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
/** The base page order: b1…b8. */
const ORIGINAL_ORDER = BASE_BLOCKS.map(block => block.blockId)
/** Move the rules table first and the page header into the middle of the page. */
const TARGET_ORDER = ['b5', 'b2', 'b3', 'b4', 'b1', 'b6', 'b7', 'b8']

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

/** Mount the plugin on a stub context that keeps every live session listener. */
function mount({ answerStyle = 'auto', templates = [], revisions = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'iui-artifact-edit-'))
  homes.push(home)
  process.env.DSH_HOME = home
  writeFileSync(join(home, 'dsh-intelligent-ui-styles.json'), JSON.stringify({ version: 1, templates }))
  if (revisions.length > 0) writeFileSync(join(home, 'dsh-intelligent-ui-artifacts.json'), JSON.stringify({ version: 1, revisions }))
  const registered = { tools: [], sessionEvents: [] }
  plugin.apply({
    tools: { register(definition) { registered.tools.push(definition) } },
    systemPrompt: { section() {} },
    on(event, handler) { if (event === 'session/event') registered.sessionEvents.push(handler) },
    inject(dependencies, callback) {
      if (!dependencies.includes('webServer')) return
      callback({
        webServer: { register() { return () => {} } },
        connection: { requestRejection() { return undefined } },
        effect(fn) { return fn() },
      })
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
  return { ...registered, tool, blockTool, home, agent, event, send, file: join(home, 'dsh-intelligent-ui-artifacts.json') }
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
    editedBlockIds: [], program: expected,
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
