/**
 * Unit tests for the client edit-session store and the structured request codec.
 *
 * Run: node --test test/client/artifact-edit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DST_PROGRAM, DST_TITLE } from '../browser/fixtures/dst-artifact.ts'
import {
  ARTIFACT_EDIT_SOURCE,
  buildEditRequestText,
  describeEditRequestProblem,
  describeTargetOrderProblem,
  isArtifactEditRequest,
  isArtifactRevisionStatus,
  isNoOpEditRequest,
  isReorderedOrder,
  nextEditRequestSummary,
  parseEditRequestText,
} from '../../src/shared/artifact-edit.ts'
import {
  clearAllArtifactEdits,
  closeArtifactEditor,
  editChipLabel,
  editKey,
  editProblemMessage,
  editSessionFor,
  installArtifactComposerBridge,
  moveArtifactBlock,
  moveArtifactBlockBy,
  openArtifactBlockEditor,
  openArtifactEditor,
  probeArtifactRevisionStatus,
  referenceForSession,
  removeArtifactSelection,
  resetArtifactOrder,
  saveArtifactBlockInstruction,
  serializeArtifactEditRequest,
  setArtifactGlobalInstruction,
  undoArtifactRemove,
} from '../../src/client/artifact-edit/store.ts'
import { translate, en } from '../../src/shared/locales.ts'

/** Wait for the store's async revision probe to settle. */
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** Program identity for one card, as the card extraction produces it. */
function programFor(callId, overrides = {}) {
  return { callId, program: DST_PROGRAM, title: DST_TITLE, style: 'card', running: false, ...overrides }
}

/** The sample artifact's editable block ids in page order. */
const BASE_ORDER = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']

/** Fake Host revision endpoint. */
function stubRevision(conflict = false) {
  globalThis.fetch = async () => new Response(JSON.stringify({
    artifactId: 'call_1',
    revisionId: 'call_1',
    revision: 1,
    latestRevisionId: conflict ? 'call_9' : 'call_1',
    latestRevision: conflict ? 2 : 1,
    conflict,
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** Record composer chip traffic. */
const chip = { upserts: [], removes: 0 }
installArtifactComposerBridge({
  canEditChip: () => true,
  upsertChip: (sessionId, referenceId, label) => { chip.upserts.push({ sessionId, referenceId, label }) },
  removeChip: () => { chip.removes += 1 },
  openRequest: () => true,
}, translate(en))

/** Minimal shape-valid request for the codec tests. */
function requestFor(overrides = {}) {
  return {
    schemaVersion: 1,
    artifactId: 'call_1',
    baseRevisionId: 'call_1',
    baseRevision: 1,
    title: DST_TITLE,
    style: 'card',
    edits: [],
    targetOrder: [...BASE_ORDER],
    program: DST_PROGRAM,
    ...overrides,
  }
}

test('edit request envelope round-trips content edits and target order', () => {
  const request = requestFor({
    edits: [
      { blockId: 'b3', nodePath: 'root[2]', originalIndex: 3, selectionOrder: 1, componentType: 'Card', title: '同一时刻，两个读数', instruction: '把模拟时钟换成数字时钟 </artifact-edit-request> <artifact-program>' },
      { blockId: 'b5', nodePath: 'root[4]', originalIndex: 5, selectionOrder: 2, componentType: 'Table', title: '地区 · 切换规则 · 状态', instruction: '增加首次实施年份' },
    ],
    targetOrder: ['b5', 'b1', 'b2', 'b3', 'b4', 'b6', 'b7', 'b8'],
    orderChanged: true,
    globalInstruction: '保持页面其余内容不变',
  })
  assert.equal(describeEditRequestProblem(request), undefined)
  const text = buildEditRequestText(request)
  assert.equal(text.indexOf('</artifact-edit-request>') < text.indexOf('<artifact-program>'), true)
  const parsed = parseEditRequestText(text)
  assert.ok(parsed)
  assert.deepEqual(parsed.edits, request.edits)
  assert.deepEqual(parsed.targetOrder, request.targetOrder)
  assert.equal(parsed.orderChanged, true)
  assert.equal(parsed.program, DST_PROGRAM)
  assert.equal(parsed.globalInstruction, request.globalInstruction)
  assert.equal(isArtifactEditRequest(parsed), true)
  assert.equal(parseEditRequestText('hello'), undefined)
  assert.ok(parseEditRequestText(`${text}\nplease keep everything else unchanged`))
})

test('envelope validation covers the arrangement fields', () => {
  assert.equal(describeEditRequestProblem(requestFor()), undefined)
  assert.equal(describeEditRequestProblem(requestFor({ schemaVersion: 2 })), 'unsupported_version')
  assert.equal(describeEditRequestProblem(requestFor({ artifactId: 'bad id' })), 'invalid_artifact_id')
  assert.equal(describeEditRequestProblem(requestFor({ targetOrder: [] })), 'invalid_target_order')
  assert.equal(describeEditRequestProblem(requestFor({ targetOrder: ['b1', 'b1'] })), 'invalid_target_order')
  assert.equal(describeEditRequestProblem(requestFor({ targetOrder: ['b1', 'b2', 'x'] })), 'invalid_target_order')
  assert.equal(describeEditRequestProblem(requestFor({ orderChanged: 'yes' })), 'invalid_order_changed')
  assert.equal(describeEditRequestProblem(requestFor({
    edits: [{ blockId: 'b9', nodePath: 'root[8]', originalIndex: 9, selectionOrder: 1, componentType: 'Card', instruction: 'x' }],
  })), 'edit_not_in_target_order')
  assert.equal(describeEditRequestProblem(requestFor({
    edits: [{ blockId: 'b3', nodePath: 'root[2]', originalIndex: 3, selectionOrder: 1, componentType: 'Card', instruction: '  ' }],
  })), 'invalid_instruction')
  // Shape validation accepts any bounded set of block ids; the Host checks the
  // permutation against the base revision (see describeTargetOrderProblem).
  assert.equal(describeEditRequestProblem(requestFor({ targetOrder: ['b1', 'b2', 'b3'] })), undefined)
  assert.equal(describeEditRequestProblem(requestFor({ extra: 1 })), 'unknown_field')
})

test('target-order helpers detect permutations and no-op requests', () => {
  assert.equal(describeTargetOrderProblem(BASE_ORDER, BASE_ORDER), undefined)
  assert.equal(describeTargetOrderProblem(['b2', 'b1'], ['b1', 'b2']), undefined)
  assert.equal(describeTargetOrderProblem(['b1'], ['b1', 'b2']), 'wrong_length')
  assert.equal(describeTargetOrderProblem(['b1', 'b1'], ['b1', 'b2']), 'duplicate_block')
  assert.equal(describeTargetOrderProblem(['b1', 'b9'], ['b1', 'b2']), 'unknown_block')
  assert.equal(describeTargetOrderProblem(['b1', 'b2', 'b3'], ['b1', 'b2']), 'wrong_length')
  assert.equal(isReorderedOrder(BASE_ORDER, [...BASE_ORDER]), false)
  assert.equal(isReorderedOrder(BASE_ORDER, ['b2', 'b1', ...BASE_ORDER.slice(2)]), true)
  assert.equal(isNoOpEditRequest(requestFor(), BASE_ORDER), true)
  assert.equal(isNoOpEditRequest(requestFor({ targetOrder: ['b2', 'b1', ...BASE_ORDER.slice(2)] }), BASE_ORDER), false)
  assert.equal(isNoOpEditRequest(requestFor({ globalInstruction: 'note' }), BASE_ORDER), false)
  assert.equal(isNoOpEditRequest(requestFor({
    edits: [{ blockId: 'b3', nodePath: 'root[2]', originalIndex: 3, selectionOrder: 1, componentType: 'Card', instruction: 'x' }],
  }), BASE_ORDER), false)
})

test('sent-message summary covers the envelope and reports reordering', () => {
  const text = buildEditRequestText(requestFor({
    edits: [{ blockId: 'b3', nodePath: 'root[2]', originalIndex: 3, selectionOrder: 1, componentType: 'Card', instruction: 'x' }],
    targetOrder: ['b3', 'b1', 'b2', 'b4', 'b5', 'b6', 'b7', 'b8'],
    orderChanged: true,
  }))
  const summary = nextEditRequestSummary(`before ${text} after`, 0)
  assert.ok(summary)
  assert.equal(summary.count, 1)
  assert.equal(summary.reordered, true)
  assert.equal(summary.globalOnly, false)
  assert.equal(`before ${text} after`.slice(summary.start, summary.end).endsWith('</artifact-program>'), true)
  const orderOnly = nextEditRequestSummary(buildEditRequestText(requestFor({
    targetOrder: ['b2', 'b1', ...BASE_ORDER.slice(2)],
    orderChanged: true,
  })), 0)
  assert.equal(orderOnly?.count, 0)
  assert.equal(orderOnly?.reordered, true)
})

test('revision status guard accepts a well-formed Host answer', () => {
  assert.equal(isArtifactRevisionStatus({ artifactId: 'a', revisionId: 'a', revision: 1, latestRevisionId: 'b', latestRevision: 2, conflict: true }), true)
  assert.equal(isArtifactRevisionStatus({ artifactId: 'a', revisionId: 'a', revision: 1, latestRevisionId: 'b', latestRevision: 2, conflict: 'no' }), false)
})

test('store: content edits create requests only on save and serialize', async () => {
  stubRevision(false)
  const opened = openArtifactEditor('s1', programFor('call_a'))
  assert.deepEqual(opened, { ok: true })
  await settle()
  const key = editKey('s1', 'call_a')
  assert.equal(editSessionFor('s1', 'call_a').status, 'ready')
  // Opening the popover does not create a request.
  openArtifactBlockEditor(key, 'b3')
  assert.equal(editSessionFor('s1', 'call_a').activeBlockId, 'b3')
  assert.equal(editSessionFor('s1', 'call_a').selection.length, 0)
  saveArtifactBlockInstruction(key, 'b3', ' 把模拟时钟换成数字时钟，并显示日期 ')
  assert.deepEqual(editSessionFor('s1', 'call_a').selection.map(item => [item.blockId, item.order]), [['b3', 1]])
  assert.equal(chip.upserts.at(-1).label, en['edit.chip.edits'].replace('{count}', '1'))

  openArtifactBlockEditor(key, 'b5')
  saveArtifactBlockInstruction(key, 'b5', '增加首次实施年份')
  assert.deepEqual(editSessionFor('s1', 'call_a').selection.map(item => [item.blockId, item.order]), [['b3', 1], ['b5', 2]])
  assert.equal(chip.upserts.at(-1).label, en['edit.chip.edits'].replace('{count}', '2'))

  // Removal keeps the numbering of the remaining request and is undoable.
  removeArtifactSelection(key, 'b3')
  assert.deepEqual(editSessionFor('s1', 'call_a').selection.map(item => [item.blockId, item.order]), [['b5', 2]])
  undoArtifactRemove(key)
  assert.deepEqual(editSessionFor('s1', 'call_a').selection.map(item => [item.blockId, item.order]), [['b5', 2], ['b3', 1]])

  setArtifactGlobalInstruction(key, '保持页面其余内容不变')
  const outcome = await serializeArtifactEditRequest(referenceForSession(key))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.request.artifactId, 'call_a')
  assert.deepEqual(outcome.request.edits.map(edit => [edit.blockId, edit.selectionOrder, edit.instruction]), [
    ['b3', 1, '把模拟时钟换成数字时钟，并显示日期'],
    ['b5', 2, '增加首次实施年份'],
  ])
  assert.deepEqual(outcome.request.targetOrder, BASE_ORDER)
  assert.equal(outcome.request.orderChanged, undefined)
  assert.equal(outcome.request.program, DST_PROGRAM)
  assert.equal(outcome.request.globalInstruction, '保持页面其余内容不变')
  assert.equal(editSessionFor('s1', 'call_a').status, 'submitted')
})

test('store: order-only requests are valid and carry the target order', async () => {
  stubRevision(false)
  openArtifactEditor('s2', programFor('call_b'))
  await settle()
  const key = editKey('s2', 'call_b')
  moveArtifactBlock(key, 'b5', 0)
  const session = editSessionFor('s2', 'call_b')
  assert.equal(session.orderChanged, true)
  assert.deepEqual(session.targetOrder.slice(0, 2), ['b5', 'b1'])
  assert.equal(chip.upserts.at(-1).label, en['edit.chip.order'])

  // Keyboard-equivalent move and boundary clamping.
  moveArtifactBlockBy(key, 'b5', -5)
  assert.deepEqual(editSessionFor('s2', 'call_b').targetOrder.slice(0, 2), ['b5', 'b1'])
  moveArtifactBlockBy(key, 'b5', 1)
  assert.deepEqual(editSessionFor('s2', 'call_b').targetOrder.slice(0, 3), ['b1', 'b5', 'b2'])

  const outcome = await serializeArtifactEditRequest(referenceForSession(key))
  assert.equal(outcome.ok, true)
  assert.deepEqual(outcome.request.edits, [])
  assert.equal(outcome.request.orderChanged, true)
  assert.deepEqual(outcome.request.targetOrder.slice(0, 3), ['b1', 'b5', 'b2'])
  assert.equal(outcome.request.targetOrder.length, BASE_ORDER.length)
  assert.equal(editSessionFor('s2', 'call_b').status, 'submitted')
})

test('store: reset order keeps edits, numbers and global instruction', async () => {
  stubRevision(false)
  openArtifactEditor('s3', programFor('call_c'))
  await settle()
  const key = editKey('s3', 'call_c')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'first instruction')
  setArtifactGlobalInstruction(key, 'global note')
  moveArtifactBlock(key, 'b7', 0)
  assert.equal(editSessionFor('s3', 'call_c').orderChanged, true)
  assert.equal(chip.upserts.at(-1).label, `${en['edit.chip.mixed'].replace('{count}', '1')}${en['edit.chip.suffix']}`)
  resetArtifactOrder(key)
  const session = editSessionFor('s3', 'call_c')
  assert.equal(session.orderChanged, false)
  assert.deepEqual(session.targetOrder, BASE_ORDER)
  assert.deepEqual(session.selection.map(item => [item.blockId, item.order]), [['b3', 1]])
  assert.equal(session.globalInstruction, 'global note')
  assert.equal(chip.upserts.at(-1).label, `${en['edit.chip.edits'].replace('{count}', '1')}${en['edit.chip.suffix']}`)
})

test('store: clearing edits keeps the arrangement and chip label follows the shape', async () => {
  stubRevision(false)
  openArtifactEditor('s4', programFor('call_d'))
  await settle()
  const key = editKey('s4', 'call_d')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'first instruction')
  moveArtifactBlock(key, 'b8', 0)
  assert.equal(chip.upserts.at(-1).label, en['edit.chip.mixed'].replace('{count}', '1'))
  clearAllArtifactEdits(key)
  assert.equal(editSessionFor('s4', 'call_d').selection.length, 0)
  assert.equal(editSessionFor('s4', 'call_d').orderChanged, true)
  assert.equal(chip.upserts.at(-1).label, en['edit.chip.order'])

  // Saving an empty instruction removes an existing request and creates nothing.
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'temporary request')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', '   ')
  assert.equal(editSessionFor('s4', 'call_d').selection.length, 0)
})

test('store: empty, no-op and conflict sends are blocked', async () => {
  stubRevision(false)
  openArtifactEditor('s5', programFor('call_e'))
  await settle()
  const key = editKey('s5', 'call_e')
  assert.deepEqual(await serializeArtifactEditRequest(referenceForSession(key)), { ok: false, problem: 'empty' })
  assert.equal(editProblemMessage('empty'), en['edit.errorEmpty'])

  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'change it')
  stubRevision(true)
  assert.deepEqual(await serializeArtifactEditRequest(referenceForSession(key)), { ok: false, problem: 'conflict' })
  assert.equal(editProblemMessage('conflict'), en['edit.conflictSend'])
  // A chip id that never named a session is stale; only an empty internal ref is missing.
  assert.deepEqual(await serializeArtifactEditRequest('missing-ref'), { ok: false, problem: 'stale' })
})

test('store: chip references are deterministic across reloads', () => {
  const key = editKey('s-ref', 'call_ref')
  const reference = referenceForSession(key)
  assert.equal(reference, `${ARTIFACT_EDIT_SOURCE}:${key}`)
  assert.equal(reference.includes(key), true)
  assert.equal(referenceForSession(key), reference)
  assert.notEqual(referenceForSession(editKey('s-ref2', 'call_ref2')), reference)
})

test('store: unresolvable chip references report stale, not missing', async () => {
  // Empty/internal refs never named an edit session.
  assert.deepEqual(await serializeArtifactEditRequest(''), { ok: false, problem: 'missing' })
  assert.deepEqual(await serializeArtifactEditRequest('   '), { ok: false, problem: 'missing' })
  // Unknown chip ids and chips whose session is gone are stale.
  assert.deepEqual(await serializeArtifactEditRequest('missing-ref'), { ok: false, problem: 'stale' })
  const orphan = referenceForSession(editKey('s-orphan', 'call_orphan'))
  assert.deepEqual(await serializeArtifactEditRequest(orphan), { ok: false, problem: 'stale' })
  assert.equal(editProblemMessage('stale'), en['edit.errorStale'])
})

test('store: a restored deterministic chip resolves after the editor is reopened', async () => {
  stubRevision(false)
  openArtifactEditor('s-ref', programFor('call_ref'))
  await settle()
  const key = editKey('s-ref', 'call_ref')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'first instruction')
  const restoredReference = referenceForSession(key)
  closeArtifactEditor(key)
  openArtifactEditor('s-ref', programFor('call_ref'))
  await settle()
  const outcome = await serializeArtifactEditRequest(restoredReference)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.request.baseRevisionId, 'call_ref')
})

test('store: the silent revision probe only raises a conflict', async () => {
  stubRevision(false)
  openArtifactEditor('s9', programFor('call_j'))
  await settle()
  const key = editKey('s9', 'call_j')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'change it')
  assert.equal(editSessionFor('s9', 'call_j').status, 'ready')

  stubRevision(true)
  await probeArtifactRevisionStatus(key)
  const conflicted = editSessionFor('s9', 'call_j')
  assert.equal(conflicted.status, 'conflict')
  assert.deepEqual(conflicted.selection.map(item => item.blockId), ['b3'])

  // A later 'ok' answer never auto-clears the conflict.
  stubRevision(false)
  await probeArtifactRevisionStatus(key)
  assert.equal(editSessionFor('s9', 'call_j').status, 'conflict')

  // Missing and submitted sessions are skipped without throwing.
  await probeArtifactRevisionStatus(editKey('s9-none', 'call_none'))
  const submittedKey = editKey('s10', 'call_k')
  openArtifactEditor('s10', programFor('call_k'))
  await settle()
  openArtifactBlockEditor(submittedKey, 'b3')
  saveArtifactBlockInstruction(submittedKey, 'b3', 'x')
  assert.equal((await serializeArtifactEditRequest(referenceForSession(submittedKey))).ok, true)
  stubRevision(true)
  await probeArtifactRevisionStatus(submittedKey)
  assert.equal(editSessionFor('s10', 'call_k').status, 'submitted')
})

test('store: reopening keeps saved requests, numbering and target order', async () => {
  stubRevision(false)
  openArtifactEditor('s6', programFor('call_f'))
  await settle()
  const key = editKey('s6', 'call_f')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'first instruction')
  moveArtifactBlock(key, 'b4', 1)
  closeArtifactEditor(key)
  assert.equal(editSessionFor('s6', 'call_f').editing, false)
  const reopened = openArtifactEditor('s6', programFor('call_f'))
  assert.deepEqual(reopened, { ok: true })
  await settle()
  const session = editSessionFor('s6', 'call_f')
  assert.equal(session.editing, true)
  assert.equal(session.selection[0].instruction, 'first instruction')
  assert.deepEqual(session.targetOrder.slice(0, 2), ['b1', 'b4'])

  // A saved content edit keeps working after reordering.
  openArtifactBlockEditor(key, 'b3')
  assert.equal(editSessionFor('s6', 'call_f').activeDraft, 'first instruction')
})

test('store: custom templates keep their style id in the request', async () => {
  stubRevision(false)
  openArtifactEditor('s7', programFor('call_g', { styleId: 'cs_ocean01' }))
  await settle()
  const key = editKey('s7', 'call_g')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'keep the reading style')
  const outcome = await serializeArtifactEditRequest(referenceForSession(key))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.request.styleId, 'cs_ocean01')
  assert.equal(outcome.request.style, 'card')
})

test('store: temporary-style results and unsupported programs never open', () => {
  stubRevision(false)
  assert.deepEqual(openArtifactEditor('s8', programFor('call_h', { styleSource: 'temporary' })), { ok: false, reason: 'unsupported' })
  assert.deepEqual(openArtifactEditor('s8', programFor('call_i', { program: 'root = Row([Title("a"), Text("b")])' })), { ok: false, reason: 'unsupported' })
})

test('chip label helper covers every request shape', () => {
  assert.equal(editChipLabel({ count: 0, reordered: true, hasGlobal: false }), en['edit.chip.order'])
  assert.equal(editChipLabel({ count: 2, reordered: false, hasGlobal: false }), en['edit.chip.edits'].replace('{count}', '2'))
  assert.equal(editChipLabel({ count: 2, reordered: true, hasGlobal: false }), en['edit.chip.mixed'].replace('{count}', '2'))
  assert.equal(editChipLabel({ count: 0, reordered: false, hasGlobal: true }), en['edit.chip.global'])
  assert.equal(editChipLabel({ count: 2, reordered: true, hasGlobal: true }), `${en['edit.chip.mixed'].replace('{count}', '2')}${en['edit.chip.suffix']}`)
})
