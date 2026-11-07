/**
 * Unit tests for the client edit-session store and the structured request codec.
 *
 * Run: node --test test/client/artifact-edit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DST_PROGRAM, DST_TITLE } from '../browser/fixtures/dst-artifact.ts'
import { PROPS_PROGRAM, PROPS_TITLE } from '../browser/fixtures/props-artifact.ts'
import {
  ARTIFACT_EDIT_SOURCE,
  ARTIFACT_STYLE_EDIT_KIND,
  MAX_ARTIFACT_PROGRAM_CHARS,
  MAX_STYLE_INSTRUCTION_CHARS,
  buildBlockEditRequestText,
  buildEditRequestText,
  buildStyleEditRequestText,
  describeEditRequestProblem,
  describeTargetOrderProblem,
  isArtifactEditRequest,
  isArtifactRevisionStatus,
  isNoOpEditRequest,
  isReorderedOrder,
  isRequestId,
  isStyleEditRequest,
  nextEditRequestSummary,
  parseEditRequestText,
  parseEditRequestTexts,
} from '../../src/shared/artifact-edit.ts'
import { ARTIFACT_BASE_ROUTE_PATH } from '../../src/shared/artifact-base.ts'
import { ARTIFACT_STRUCTURE_ROUTE_PATH } from '../../src/shared/artifact-structure.ts'
import {
  ARTIFACT_DRAFT_INDEX_PREFIX,
  ARTIFACT_DRAFT_STORAGE_PREFIX,
  activateDraft,
  activeDraftKeyFor,
  applyArtifactBlockProps,
  applyArtifactStructure,
  attachDraft,
  clearAllArtifactEdits,
  closeArtifactEditor,
  chipLabelForSession,
  discardDraft,
  draftSessionFor,
  draftSessionsFor,
  editChipLabel,
  editKey,
  editProblemMessage,
  editSessionFor,
  editingSessionFor,
  enableBranch,
  flushArtifactDraftPersistence,
  hasArtifactEditContent,
  hydrateArtifactDrafts,
  installArtifactComposerBridge,
  moveArtifactBlock,
  moveArtifactBlockBy,
  noteArtifactChipMissing,
  openArtifactBlockEditor,
  openArtifactEditor,
  previewArtifactStructure,
  probeArtifactRevisionStatus,
  referenceForSession,
  removeArtifactSelection,
  resetArtifactOrder,
  saveArtifactBlockInstruction,
  serializeArtifactEditRequest,
  setArtifactGlobalInstruction,
  setArtifactStyleEditSupported,
  setArtifactStyleInstruction,
  supportsBlockEditing,
  undoArtifactRemove,
} from '../../src/client/artifact-edit/store.ts'
import {
  removeArtifactChip,
  upsertArtifactChip,
  verifyArtifactChipAttachment,
} from '../../src/client/artifact-edit/composer.ts'
import { translate, en } from '../../src/shared/locales.ts'

/** Tiny sessionStorage stand-in: the store must work with and without one. */
function createFakeSessionStorage() {
  const map = new Map()
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: key => { map.delete(key) },
    clear: () => { map.clear() },
    key: index => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
}

/** Per-tab storage used by the persistence tests. */
const testStorage = createFakeSessionStorage()
try {
  Object.defineProperty(globalThis, 'sessionStorage', { value: testStorage, configurable: true, writable: true })
} catch {
  globalThis.sessionStorage = testStorage
}

/** Persist one synthetic draft record plus its chat index. */
function putStoredDraft(sessionId, key, overrides = {}) {
  const record = {
    key,
    sessionId,
    artifactId: key.slice(sessionId.length + 1),
    baseRevisionId: key.slice(sessionId.length + 1),
    baseRevision: 1,
    requestId: 'req_restore0001',
    title: DST_TITLE,
    style: 'card',
    program: DST_PROGRAM,
    originalOrder: [...BASE_ORDER],
    targetOrder: [...BASE_ORDER],
    orderChanged: false,
    selection: [{ blockId: 'b3', order: 1, instruction: 'restored edit' }],
    globalInstruction: '',
    attached: true,
    ...overrides,
  }
  testStorage.setItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}${key}`, JSON.stringify(record))
  const index = testStorage.getItem(`${ARTIFACT_DRAFT_INDEX_PREFIX}${sessionId}`)
  const keys = index === null ? [] : JSON.parse(index)
  if (!keys.includes(key)) keys.push(key)
  testStorage.setItem(`${ARTIFACT_DRAFT_INDEX_PREFIX}${sessionId}`, JSON.stringify(keys))
  return record
}

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
const BASE_ORDER = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9']

/** Valid result-owned temporary style snapshot used by the M3-4 tests. */
const TEMP_STYLE = { schemaVersion: 1, baseLayout: 'card', directives: 'Calm editorial palette; keep the type quiet.' }

/** Every URL/body pair the current fetch stub received, in order. */
const fetchLog = []

/**
 * Fake Host endpoints, routed by URL so the base-registration request that
 * now accompanies editor opening never consumes a revision-probe response.
 */
function stubRevision(conflict = false) {
  fetchLog.length = 0
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? '')
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    fetchLog.push({ url, method: init?.method ?? 'GET', body })
    if (url === ARTIFACT_BASE_ROUTE_PATH) {
      return new Response(JSON.stringify({ ok: true, registered: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      artifactId: 'call_1',
      revisionId: 'call_1',
      revision: 1,
      latestRevisionId: conflict ? 'call_9' : 'call_1',
      latestRevision: conflict ? 2 : 1,
      conflict,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

/** Replace the fetch stub with one answering every route from a handler. */
function stubFetch(handler) {
  fetchLog.length = 0
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? '')
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    fetchLog.push({ url, method: init?.method ?? 'GET', body })
    return handler(url, body, init)
  }
}

/** Base-registration call entries of the current fetch log. */
const baseCalls = () => fetchLog.filter(entry => entry.url === ARTIFACT_BASE_ROUTE_PATH)

/** Record composer chip traffic (one chip per attached draft). */
const chip = { upserts: [], removes: [] }
installArtifactComposerBridge({
  canEditChip: () => true,
  upsertChip: (sessionId, referenceId, label) => { chip.upserts.push({ sessionId, referenceId, label }) },
  removeChip: (sessionId, referenceId) => { chip.removes.push({ sessionId, referenceId }) },
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

/** Minimal shape-valid natural-language style request for the codec tests. */
function styleRequestFor(overrides = {}) {
  return {
    kind: ARTIFACT_STYLE_EDIT_KIND,
    schemaVersion: 1,
    requestId: 'req_style0001',
    artifactId: 'call_1',
    baseRevisionId: 'call_1',
    baseRevision: 1,
    title: DST_TITLE,
    style: 'card',
    styleInstruction: '换成更冷静的配色，并收紧间距。',
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
    targetOrder: ['b5', 'b1', 'b2', 'b3', 'b4', 'b6', 'b7', 'b8', 'b9'],
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
  assert.equal(isStyleEditRequest(parsed), false)
  // Block envelopes never serialize a kind marker, even when the request carries one.
  assert.equal(text.includes('"kind"'), false)
  assert.equal(buildBlockEditRequestText({ ...request, kind: 'blocks' }), text)
  assert.equal(buildEditRequestText({ ...request, kind: 'blocks' }), text)
  assert.equal(parseEditRequestText('hello'), undefined)
  assert.ok(parseEditRequestText(`${text}\nplease keep everything else unchanged`))
})

test('style edit envelope round-trips the style instruction', () => {
  const request = styleRequestFor({
    styleInstruction: '换成更冷静的配色 </artifact-edit-request> <artifact-program> 并收紧间距',
  })
  assert.equal(describeEditRequestProblem(request), undefined)
  const text = buildStyleEditRequestText(request)
  assert.equal(buildEditRequestText(request), text)
  const parsed = parseEditRequestText(text)
  assert.ok(parsed)
  assert.equal(isStyleEditRequest(parsed), true)
  assert.equal(isArtifactEditRequest(parsed), true)
  assert.equal(parsed.kind, ARTIFACT_STYLE_EDIT_KIND)
  assert.equal(parsed.requestId, 'req_style0001')
  assert.equal(parsed.styleInstruction, request.styleInstruction)
  assert.equal(parsed.program, DST_PROGRAM)
  assert.equal('edits' in parsed, false)
  assert.equal('targetOrder' in parsed, false)
  // The JSON header carries the discriminator and escapes `<`; the program follows it.
  assert.ok(text.includes('"kind":"style"'))
  assert.ok(text.includes('\\u003c/artifact-edit-request>'))
  assert.equal(text.indexOf('</artifact-edit-request>') < text.indexOf('<artifact-program>'), true)
  // Model-facing prose carries the apply contract.
  assert.ok(text.includes('Call the render_ui tool exactly once'))
  assert.ok(text.includes('editRequestId'))
  assert.ok(text.includes('pass style: "card"'))
  assert.ok(text.includes('temporaryStyle') === false)
  assert.ok(text.includes('warns when blocks change'))
  // A batch may mix style and block envelopes; each parses independently.
  const batch = parseEditRequestTexts(`${text}\n\n${buildEditRequestText(requestFor())}`)
  assert.equal(batch.length, 2)
  assert.equal(isStyleEditRequest(batch[0]), true)
  assert.equal(isStyleEditRequest(batch[1]), false)
})

test('style envelopes keep the recorded skin and temporary-style contract', () => {
  const saved = styleRequestFor({ styleId: 'cs_abcdef123456' })
  assert.equal(describeEditRequestProblem(saved), undefined)
  const savedText = buildStyleEditRequestText(saved)
  assert.ok(savedText.includes('styleId: "cs_abcdef123456"'))
  assert.ok(savedText.includes('pass style: "card" and styleId'))

  const temporary = styleRequestFor({ temporaryStyle: { ...TEMP_STYLE } })
  assert.equal(describeEditRequestProblem(temporary), undefined)
  const temporaryText = buildStyleEditRequestText(temporary)
  assert.ok(temporaryText.includes('pass the complete temporaryStyle'))
  assert.ok(temporaryText.includes('omit styleId'))
  assert.ok(temporaryText.includes(JSON.stringify(TEMP_STYLE)))
  assert.equal(parseEditRequestText(temporaryText).temporaryStyle.directives, TEMP_STYLE.directives)
})

test('style envelope validation is strict', () => {
  assert.equal(describeEditRequestProblem(styleRequestFor({ requestId: undefined })), 'invalid_request_id')
  assert.equal(describeEditRequestProblem(styleRequestFor({ requestId: 'bad id' })), 'invalid_request_id')
  assert.equal(describeEditRequestProblem(styleRequestFor({ styleInstruction: '' })), 'invalid_style_instruction')
  assert.equal(describeEditRequestProblem(styleRequestFor({ styleInstruction: '   ' })), 'invalid_style_instruction')
  assert.equal(describeEditRequestProblem(styleRequestFor({ styleInstruction: 'x'.repeat(MAX_STYLE_INSTRUCTION_CHARS + 1) })), 'invalid_style_instruction')
  assert.equal(describeEditRequestProblem(styleRequestFor({ schemaVersion: 2 })), 'unsupported_version')
  assert.equal(describeEditRequestProblem(styleRequestFor({ style: 'wide' })), 'invalid_style')
  assert.equal(describeEditRequestProblem(styleRequestFor({ program: '' })), 'invalid_program')
  assert.equal(describeEditRequestProblem(styleRequestFor({ baseRevision: 0 })), 'invalid_base_revision')
  assert.equal(describeEditRequestProblem(styleRequestFor({ styleId: 'cs_bad' })), 'invalid_style_id')
  assert.equal(describeEditRequestProblem(styleRequestFor({ temporaryStyle: { ...TEMP_STYLE }, styleId: 'cs_abcdef' })), 'invalid_temporary_style')
  // Block/arrangement fields are not part of the style contract.
  assert.equal(describeEditRequestProblem(styleRequestFor({ targetOrder: [...BASE_ORDER] })), 'unknown_field')
  assert.equal(describeEditRequestProblem(styleRequestFor({ edits: [] })), 'unknown_field')
  assert.equal(describeEditRequestProblem(styleRequestFor({ globalInstruction: 'x' })), 'unknown_field')
  // The kind marker is validated on block envelopes and cannot carry a style instruction.
  assert.equal(describeEditRequestProblem(requestFor({ kind: 'blocks' })), undefined)
  assert.equal(describeEditRequestProblem(requestFor({ kind: 'bogus' })), 'unknown_kind')
  assert.equal(describeEditRequestProblem(requestFor({ styleInstruction: 'cool' })), 'unknown_field')
  // A block-shaped envelope marked as style dispatches to the strict style branch.
  assert.equal(describeEditRequestProblem(requestFor({ kind: ARTIFACT_STYLE_EDIT_KIND })), 'unknown_field')
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
    edits: [{ blockId: 'b10', nodePath: 'root[9]', originalIndex: 10, selectionOrder: 1, componentType: 'Card', instruction: 'x' }],
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
    targetOrder: ['b3', 'b1', 'b2', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'],
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
  assert.equal(orderOnly?.style, false)
})

test('sent-message summary flags a style envelope and covers its program', () => {
  const text = buildStyleEditRequestText(styleRequestFor())
  const wrapped = `before ${text} after`
  const summary = nextEditRequestSummary(wrapped, 0)
  assert.ok(summary)
  assert.equal(summary.style, true)
  assert.equal(summary.count, 0)
  assert.equal(summary.globalOnly, false)
  assert.equal(summary.reordered, false)
  assert.equal(summary.hasGlobal, false)
  assert.equal(wrapped.slice(summary.start, summary.end).endsWith('</artifact-program>'), true)
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
  assert.equal(chip.upserts.at(-1).label, chipLabelForSession(editSessionFor('s1', 'call_a')))

  openArtifactBlockEditor(key, 'b5')
  saveArtifactBlockInstruction(key, 'b5', '增加首次实施年份')
  assert.deepEqual(editSessionFor('s1', 'call_a').selection.map(item => [item.blockId, item.order]), [['b3', 1], ['b5', 2]])
  assert.equal(chip.upserts.at(-1).label, chipLabelForSession(editSessionFor('s1', 'call_a')))

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
  assert.equal(chip.upserts.at(-1).label, chipLabelForSession(editSessionFor('s2', 'call_b')))

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
  assert.equal(chip.upserts.at(-1).label, chipLabelForSession(editSessionFor('s3', 'call_c')))
  resetArtifactOrder(key)
  const session = editSessionFor('s3', 'call_c')
  assert.equal(session.orderChanged, false)
  assert.deepEqual(session.targetOrder, BASE_ORDER)
  assert.deepEqual(session.selection.map(item => [item.blockId, item.order]), [['b3', 1]])
  assert.equal(session.globalInstruction, 'global note')
  assert.equal(chip.upserts.at(-1).label, chipLabelForSession(editSessionFor('s3', 'call_c')))
})

test('store: clearing edits keeps the arrangement and chip label follows the shape', async () => {
  stubRevision(false)
  openArtifactEditor('s4', programFor('call_d'))
  await settle()
  const key = editKey('s4', 'call_d')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'first instruction')
  moveArtifactBlock(key, 'b8', 0)
  assert.equal(chip.upserts.at(-1).label, chipLabelForSession(editSessionFor('s4', 'call_d')))
  clearAllArtifactEdits(key)
  assert.equal(editSessionFor('s4', 'call_d').selection.length, 0)
  assert.equal(editSessionFor('s4', 'call_d').orderChanged, true)
  assert.equal(chip.upserts.at(-1).label, chipLabelForSession(editSessionFor('s4', 'call_d')))

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
  // A style edit labels first and is never combined with block facts.
  assert.equal(editChipLabel({ count: 0, reordered: false, hasGlobal: false, style: true }), en['edit.chipTail.style'])
  assert.equal(editChipLabel({ count: 2, reordered: true, hasGlobal: true, style: true }), en['edit.chipTail.style'])
})

/**
 * Minimal composer editor simulator: one detect character per chip. The chip
 * helpers only need occurrence geometry, so the clipboard projection stays out
 * of this fixture.
 */
function fakeComposer() {
  const state = { draft: '', draftRev: 1, phase: 'plain', occurrences: [] }
  let nextId = 1
  const rewrite = (span, content) => {
    state.occurrences = state.occurrences.filter(occurrence => occurrence.offset + occurrence.length <= span.start || occurrence.offset >= span.end)
    state.draft = state.draft.slice(0, span.start) + content + state.draft.slice(span.end)
    state.draftRev += 1
  }
  const input = {
    insertReference(ref, span) {
      rewrite(span, '#')
      state.occurrences.push({ occurrenceId: nextId += 1, source: ref.source, ref: ref.ref, label: ref.label, offset: span.start, length: 1 })
      state.occurrences.sort((left, right) => left.offset - right.offset)
      return true
    },
    insertText(text, span) {
      rewrite(span, text)
      return true
    },
  }
  return { state, access: { readInput: () => state, inputFor: () => input } }
}

test('store: two drafts coexist and switching keeps both', async () => {
  stubRevision(false)
  openArtifactEditor('m1', programFor('call_m1a'))
  await settle()
  const keyA = editKey('m1', 'call_m1a')
  openArtifactBlockEditor(keyA, 'b3')
  saveArtifactBlockInstruction(keyA, 'b3', 'A edit')

  openArtifactEditor('m1', programFor('call_m1b'))
  await settle()
  const keyB = editKey('m1', 'call_m1b')
  assert.equal(draftSessionFor(keyA).editing, false)
  assert.equal(draftSessionFor(keyA).selection.length, 1)
  assert.equal(draftSessionFor(keyB).editing, true)
  assert.equal(editingSessionFor('m1').key, keyB)
  assert.equal(activeDraftKeyFor('m1'), keyB)
  // An empty canvas draft is transient; give B content so both are retained.
  assert.deepEqual(draftSessionsFor('m1').map(draft => draft.key), [keyA])
  openArtifactBlockEditor(keyB, 'b5')
  saveArtifactBlockInstruction(keyB, 'b5', 'B edit')
  assert.deepEqual(draftSessionsFor('m1').map(draft => draft.key), [keyA, keyB])

  assert.equal(activateDraft(keyA), true)
  assert.equal(draftSessionFor(keyA).editing, true)
  assert.equal(draftSessionFor(keyB).editing, false)
  assert.equal(editingSessionFor('m1').key, keyA)

  // Reopening card B reactivates B without losing A.
  openArtifactEditor('m1', programFor('call_m1b'))
  await settle()
  assert.equal(draftSessionFor(keyB).editing, true)
  assert.equal(draftSessionFor(keyA).editing, false)
  assert.equal(draftSessionFor(keyA).selection[0].instruction, 'A edit')
  assert.equal(editingSessionFor('m1').key, keyB)

  // Both attached drafts own a chip; switching the canvas never removes them.
  const references = chip.upserts.filter(upsert => upsert.sessionId === 'm1').map(upsert => upsert.referenceId)
  assert.equal(new Set(references).size, 2)
  assert.equal(chip.removes.some(remove => remove.sessionId === 'm1'), false)

  // One Send serializes each chip into its own envelope with its own id.
  const outcomeA = await serializeArtifactEditRequest(referenceForSession(keyA))
  const outcomeB = await serializeArtifactEditRequest(referenceForSession(keyB))
  assert.equal(outcomeA.ok, true)
  assert.equal(outcomeB.ok, true)
  assert.notEqual(outcomeA.request.requestId, outcomeB.request.requestId)
  assert.notEqual(outcomeA.request.artifactId, outcomeB.request.artifactId)
  assert.equal(outcomeA.request.baseRevisionId, 'call_m1a')
  assert.equal(outcomeB.request.baseRevisionId, 'call_m1b')
})

test('store: every draft keeps one stable valid request id and sends it', async () => {
  stubRevision(false)
  openArtifactEditor('m2', programFor('call_m2'))
  await settle()
  const key = editKey('m2', 'call_m2')
  const requestId = draftSessionFor(key).requestId
  assert.equal(isRequestId(requestId), true)
  assert.equal(requestId, draftSessionFor(key).requestId)

  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'edit')
  assert.equal(draftSessionFor(key).requestId, requestId)

  const outcome = await serializeArtifactEditRequest(referenceForSession(key))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.request.requestId, requestId)
  // The consumed draft's chip is stale if it is serialized a second time.
  assert.deepEqual(await serializeArtifactEditRequest(referenceForSession(key)), { ok: false, problem: 'stale' })

  // Reusing the consumed draft after the send starts a new draft with a new id.
  openArtifactEditor('m2', programFor('call_m2'))
  await settle()
  const reused = draftSessionFor(key)
  assert.equal(reused.status, 'ready')
  assert.equal(isRequestId(reused.requestId), true)
  assert.notEqual(reused.requestId, requestId)
})

test('store: the per-chat draft cap rejects a seventh draft', async () => {
  stubRevision(false)
  for (let index = 0; index < 6; index += 1) {
    const callId = `call_cap${index}`
    openArtifactEditor('m3', programFor(callId))
    await settle()
    const key = editKey('m3', callId)
    openArtifactBlockEditor(key, 'b3')
    saveArtifactBlockInstruction(key, 'b3', `cap edit ${index}`)
  }
  assert.equal(draftSessionsFor('m3').length, 6)
  assert.deepEqual(openArtifactEditor('m3', programFor('call_cap6')), { ok: false, reason: 'limit' })
  assert.equal(draftSessionsFor('m3').length, 6)

  discardDraft(editKey('m3', 'call_cap0'))
  assert.equal(draftSessionsFor('m3').length, 5)
  assert.deepEqual(openArtifactEditor('m3', programFor('call_cap6')), { ok: true })
})

test('store: only three drafts join the batch; extras start detached and attach later', async () => {
  stubRevision(false)
  const keys = []
  for (let index = 0; index < 4; index += 1) {
    const callId = `call_batch${index}`
    openArtifactEditor('m4', programFor(callId))
    await settle()
    const key = editKey('m4', callId)
    keys.push(key)
    openArtifactBlockEditor(key, 'b3')
    saveArtifactBlockInstruction(key, 'b3', `batch edit ${index}`)
  }
  assert.deepEqual(keys.map(key => draftSessionFor(key).attached), [true, true, true, false])
  assert.equal(attachDraft(keys[3]), false)
  const references = chip.upserts.filter(upsert => upsert.sessionId === 'm4').map(upsert => upsert.referenceId)
  assert.equal(references.includes(referenceForSession(keys[3])), false)
  assert.equal(references.includes(referenceForSession(keys[0])), true)

  // The user deletes chip 0, which frees the batch slot for draft 4.
  noteArtifactChipMissing(referenceForSession(keys[0]))
  assert.equal(draftSessionFor(keys[0]).attached, false)
  assert.equal(draftSessionFor(keys[0]).selection.length, 1)
  assert.equal(attachDraft(keys[3]), true)
  assert.equal(draftSessionFor(keys[3]).attached, true)
})

test('store: closing keeps a non-empty draft and discards an empty one', async () => {
  stubRevision(false)
  openArtifactEditor('m6', programFor('call_m6empty'))
  await settle()
  const emptyKey = editKey('m6', 'call_m6empty')
  closeArtifactEditor(emptyKey)
  assert.equal(draftSessionFor(emptyKey), undefined)

  openArtifactEditor('m6', programFor('call_m6full'))
  await settle()
  const fullKey = editKey('m6', 'call_m6full')
  openArtifactBlockEditor(fullKey, 'b3')
  saveArtifactBlockInstruction(fullKey, 'b3', 'kept edit')
  closeArtifactEditor(fullKey)
  const kept = draftSessionFor(fullKey)
  assert.ok(kept)
  assert.equal(kept.editing, false)
  assert.equal(kept.attached, true)
  assert.equal(kept.selection.length, 1)
  assert.equal(editingSessionFor('m6'), undefined)

  discardDraft(fullKey)
  assert.equal(draftSessionFor(fullKey), undefined)
  assert.equal(chip.removes.some(remove => remove.referenceId === `${ARTIFACT_EDIT_SOURCE}:${fullKey}`), true)
})

test('store: each attached draft has its own chip label and reference', async () => {
  stubRevision(false)
  openArtifactEditor('m5', programFor('call_m5', { title: 'Page A' }))
  await settle()
  const key = editKey('m5', 'call_m5')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'page a edit')
  const upsert = chip.upserts.filter(candidate => candidate.sessionId === 'm5').at(-1)
  assert.ok(upsert)
  assert.equal(upsert.referenceId, referenceForSession(key))
  assert.equal(upsert.label, chipLabelForSession(draftSessionFor(key)))
  assert.equal(upsert.label.includes('Page A'), true)
  assert.equal(upsert.label.includes(en['edit.revision'].replace('{n}', '1')), true)
  assert.equal(upsert.label.includes(en['edit.chipTail.edits'].replace('{count}', '1')), true)
})

test('composer: chips are inserted, updated and removed by reference', () => {
  const { state, access } = fakeComposer()
  const referenceA = `${ARTIFACT_EDIT_SOURCE}:chat-a:call_a`
  const referenceB = `${ARTIFACT_EDIT_SOURCE}:chat-b:call_b`
  assert.equal(upsertArtifactChip(access, 'chat', referenceA, 'Edit A'), true)
  assert.equal(upsertArtifactChip(access, 'chat', referenceB, 'Edit B'), true)
  assert.deepEqual(state.occurrences.map(occurrence => occurrence.ref), [referenceA, referenceB])

  // A label update replaces only chip A and keeps chip B in place.
  assert.equal(upsertArtifactChip(access, 'chat', referenceA, 'Edit A updated'), true)
  assert.deepEqual(state.occurrences.map(occurrence => occurrence.ref), [referenceA, referenceB])
  assert.equal(state.occurrences.find(occurrence => occurrence.ref === referenceA).label, 'Edit A updated')

  removeArtifactChip(access, 'chat', referenceB)
  assert.deepEqual(state.occurrences.map(occurrence => occurrence.ref), [referenceA])
})

test('composer: deleting a chip detaches the draft instead of re-inserting it', async () => {
  stubRevision(false)
  openArtifactEditor('m7', programFor('call_m7'))
  await settle()
  const key = editKey('m7', 'call_m7')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'first edit')
  const reference = referenceForSession(key)
  assert.equal(draftSessionFor(key).attached, true)

  const { state, access } = fakeComposer()
  assert.equal(upsertArtifactChip(access, 'm7', reference, 'chip'), true)
  // Simulate the user deleting the chip in the composer.
  state.occurrences.length = 0
  state.draft = ''
  verifyArtifactChipAttachment(access, 'm7', reference)
  assert.equal(draftSessionFor(key).attached, false)
  assert.equal(draftSessionFor(key).selection.length, 1)

  // Detached drafts never re-insert their chip on the next edit.
  const upsertsBefore = chip.upserts.filter(candidate => candidate.referenceId === reference).length
  openArtifactBlockEditor(key, 'b5')
  saveArtifactBlockInstruction(key, 'b5', 'second edit')
  assert.equal(chip.upserts.filter(candidate => candidate.referenceId === reference).length, upsertsBefore)

  // An explicit attach brings the chip back.
  assert.equal(attachDraft(key), true)
  assert.equal(chip.upserts.filter(candidate => candidate.referenceId === reference).length, upsertsBefore + 1)
})

test('store: an old revision can branch from a known conflict', async () => {
  stubRevision(false)
  openArtifactEditor('b1', programFor('call_branch'))
  await settle()
  const key = editKey('b1', 'call_branch')
  // A ready probe already records the latest revision number for the banner.
  assert.equal(draftSessionFor(key).latestRevision, 1)
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'branch edit')

  stubRevision(true)
  await probeArtifactRevisionStatus(key)
  const conflicted = draftSessionFor(key)
  assert.equal(conflicted.status, 'conflict')
  assert.equal(conflicted.latestRevision, 2)

  // A conflict enables branch mode; the draft becomes sendable again.
  assert.equal(enableBranch(key), true)
  const branched = draftSessionFor(key)
  assert.equal(branched.status, 'ready')
  assert.equal(branched.branch, true)
  assert.equal(branched.latestRevision, 2)
  assert.equal(chip.upserts.at(-1).label, chipLabelForSession(branched))
  assert.equal(chip.upserts.at(-1).label.endsWith(en['edit.chip.branchSuffix']), true)

  // Sending a branch request is not blocked by the head mismatch and carries branch:true.
  stubRevision(true)
  const outcome = await serializeArtifactEditRequest(referenceForSession(key))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.request.branch, true)
  const text = buildEditRequestText(outcome.request)
  assert.equal(parseEditRequestText(text).branch, true)
  // The consumed draft no longer carries branch mode.
  assert.equal(draftSessionFor(key).branch, false)
})

test('store: enableBranch is a no-op outside a known conflict', async () => {
  stubRevision(false)
  openArtifactEditor('b2', programFor('call_ready'))
  await settle()
  const key = editKey('b2', 'call_ready')
  assert.equal(draftSessionFor(key).status, 'ready')
  assert.equal(enableBranch(key), false)
  assert.notEqual(draftSessionFor(key).branch, true)
  assert.equal(enableBranch('does-not-exist:call_none'), false)
})

test('store: a non-branch conflict still blocks while branch drafts ignore later conflicts', async () => {
  stubRevision(false)
  openArtifactEditor('b3', programFor('call_block'))
  await settle()
  const key = editKey('b3', 'call_block')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'blocked edit')
  stubRevision(true)
  assert.deepEqual(await serializeArtifactEditRequest(referenceForSession(key)), { ok: false, problem: 'conflict' })
  assert.equal(draftSessionFor(key).status, 'ready')

  stubRevision(false)
  await probeArtifactRevisionStatus(key)
  assert.equal(draftSessionFor(key).latestRevision, 1)
  stubRevision(true)
  await probeArtifactRevisionStatus(key)
  assert.equal(draftSessionFor(key).status, 'conflict')
  assert.equal(draftSessionFor(key).latestRevision, 2)

  assert.equal(enableBranch(key), true)
  // A later conflict answer only refreshes the banner metadata in branch mode.
  stubRevision(true)
  await probeArtifactRevisionStatus(key)
  assert.equal(draftSessionFor(key).status, 'ready')
  assert.equal(draftSessionFor(key).branch, true)
})

test('store: branch mode survives closing and reopening the draft', async () => {
  stubRevision(false)
  openArtifactEditor('b4', programFor('call_reopen'))
  await settle()
  const key = editKey('b4', 'call_reopen')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'keep me')
  stubRevision(true)
  await probeArtifactRevisionStatus(key)
  assert.equal(enableBranch(key), true)

  closeArtifactEditor(key)
  assert.equal(draftSessionFor(key).editing, false)
  assert.equal(draftSessionFor(key).branch, true)

  stubRevision(false)
  openArtifactEditor('b4', programFor('call_reopen'))
  await settle()
  const reopened = draftSessionFor(key)
  assert.equal(reopened.status, 'ready')
  assert.equal(reopened.branch, true)
  assert.equal(reopened.selection.length, 1)
})

test('store: unsent drafts persist to sessionStorage and hydrate after a reload', async () => {
  stubRevision(false)
  openArtifactEditor('p1', programFor('call_p1'))
  await settle()
  const key = editKey('p1', 'call_p1')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'persist me')
  setArtifactGlobalInstruction(key, 'keep global')
  moveArtifactBlock(key, 'b4', 1)
  flushArtifactDraftPersistence()

  const raw = testStorage.getItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}${key}`)
  assert.ok(raw)
  const stored = JSON.parse(raw)
  assert.equal(stored.requestId, draftSessionFor(key).requestId)
  assert.deepEqual(stored.selection.map(entry => [entry.blockId, entry.instruction]), [['b3', 'persist me']])
  assert.equal(stored.globalInstruction, 'keep global')
  assert.equal(stored.attached, true)
  assert.deepEqual(stored.targetOrder.slice(0, 2), ['b1', 'b4'])
  assert.equal(stored.orderChanged, true)
  assert.deepEqual(JSON.parse(testStorage.getItem(`${ARTIFACT_DRAFT_INDEX_PREFIX}p1`)), [key])

  // Simulate a reload: the same payload under a chat with no in-memory state.
  const clone = { ...stored, key: `p2:${stored.baseRevisionId}`, sessionId: 'p2' }
  testStorage.setItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}${clone.key}`, JSON.stringify(clone))
  testStorage.setItem(`${ARTIFACT_DRAFT_INDEX_PREFIX}p2`, JSON.stringify([clone.key]))

  const restored = editSessionFor('p2', stored.baseRevisionId)
  assert.ok(restored)
  assert.equal(restored.key, clone.key)
  assert.equal(restored.editing, false)
  assert.equal(restored.status, 'ready')
  assert.equal(restored.requestId, stored.requestId)
  assert.equal(restored.attached, true)
  assert.equal(restored.latestRevision, undefined)
  assert.deepEqual(restored.selection.map(entry => [entry.blockId, entry.order, entry.instruction]), [['b3', 1, 'persist me']])
  assert.deepEqual(restored.targetOrder.slice(0, 2), ['b1', 'b4'])
  assert.equal(restored.orderChanged, true)
  assert.equal(restored.globalInstruction, 'keep global')
  assert.equal(restored.blocks.length, BASE_ORDER.length)
  assert.equal(typeof restored.wrappedProgram, 'string')

  // Hydration is idempotent and re-attaches the restored draft's composer chip.
  assert.equal(hydrateArtifactDrafts('p2'), 0)
  await new Promise(resolve => setTimeout(resolve, 320))
  assert.equal(chip.upserts.some(upsert => upsert.sessionId === 'p2'
    && upsert.referenceId === `${ARTIFACT_EDIT_SOURCE}:${clone.key}`), true)
})

test('store: corrupt or unusable persisted drafts are ignored and cleaned up', () => {
  testStorage.setItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}q1:call_bad`, '{not json')
  testStorage.setItem(`${ARTIFACT_DRAFT_INDEX_PREFIX}q1`, JSON.stringify(['q1:call_bad']))
  assert.equal(hydrateArtifactDrafts('q1'), 0)
  assert.equal(testStorage.getItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}q1:call_bad`), null)

  putStoredDraft('q2', 'q2:call_x', { program: '' })
  assert.equal(hydrateArtifactDrafts('q2'), 0)
  assert.equal(testStorage.getItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}q2:call_x`), null)

  putStoredDraft('q3', 'q3:call_x', { program: 'x'.repeat(MAX_ARTIFACT_PROGRAM_CHARS + 1) })
  assert.equal(hydrateArtifactDrafts('q3'), 0)
  assert.equal(testStorage.getItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}q3:call_x`), null)

  putStoredDraft('q4', 'q4:call_x', { targetOrder: ['b1'] })
  assert.equal(hydrateArtifactDrafts('q4'), 0)

  // Unknown block ids inside a stored selection are dropped, not fatal.
  putStoredDraft('q5', 'q5:call_x', {
    selection: [
      { blockId: 'b3', order: 1, instruction: 'known' },
      { blockId: 'b999', order: 2, instruction: 'unknown' },
    ],
  })
  assert.equal(hydrateArtifactDrafts('q5'), 1)
  assert.deepEqual(draftSessionFor('q5:call_x').selection.map(entry => entry.blockId), ['b3'])
})

test('store: discarding or sending a draft clears its persisted copy and index', async () => {
  stubRevision(false)
  openArtifactEditor('p4', programFor('call_p4'))
  await settle()
  const discardKey = editKey('p4', 'call_p4')
  openArtifactBlockEditor(discardKey, 'b3')
  saveArtifactBlockInstruction(discardKey, 'b3', 'to discard')
  flushArtifactDraftPersistence()
  assert.ok(testStorage.getItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}${discardKey}`))
  discardDraft(discardKey)
  assert.equal(testStorage.getItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}${discardKey}`), null)
  const discardedIndex = testStorage.getItem(`${ARTIFACT_DRAFT_INDEX_PREFIX}p4`)
  assert.equal(discardedIndex === null || JSON.parse(discardedIndex).length === 0, true)

  openArtifactEditor('p5', programFor('call_p5'))
  await settle()
  const sendKey = editKey('p5', 'call_p5')
  openArtifactBlockEditor(sendKey, 'b3')
  saveArtifactBlockInstruction(sendKey, 'b3', 'to send')
  flushArtifactDraftPersistence()
  assert.ok(testStorage.getItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}${sendKey}`))
  const outcome = await serializeArtifactEditRequest(referenceForSession(sendKey))
  assert.equal(outcome.ok, true)
  assert.equal(testStorage.getItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}${sendKey}`), null)
})

test('store: serialize hydrates a restored chip from its deterministic reference', async () => {
  const key = 'p6:call_r6'
  const record = putStoredDraft('p6', key)
  stubRevision(false)
  const outcome = await serializeArtifactEditRequest(`${ARTIFACT_EDIT_SOURCE}:${key}`)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.request.requestId, record.requestId)
  assert.equal(outcome.request.baseRevisionId, 'call_r6')
  assert.deepEqual(outcome.request.edits.map(edit => [edit.blockId, edit.instruction]), [['b3', 'restored edit']])
  assert.equal(testStorage.getItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}${key}`), null)
  assert.equal(draftSessionFor(key).status, 'submitted')
})

test('store: persistence is a silent no-op without sessionStorage', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { value: undefined, configurable: true, writable: true })
    assert.doesNotThrow(() => flushArtifactDraftPersistence())
    assert.equal(editSessionFor('no-storage-chat', 'call_none'), undefined)
  } finally {
    if (descriptor !== undefined) Object.defineProperty(globalThis, 'sessionStorage', descriptor)
    else Object.defineProperty(globalThis, 'sessionStorage', { value: testStorage, configurable: true, writable: true })
  }
})

test('store: the chat index rehydrates every persisted draft', () => {
  const keyA = 'p7:call_r7a'
  const keyB = 'p7:call_r7b'
  putStoredDraft('p7', keyA, { requestId: 'req_restore0002' })
  putStoredDraft('p7', keyB, {
    requestId: 'req_restore0003',
    targetOrder: ['b2', 'b1', ...BASE_ORDER.slice(2)],
    orderChanged: true,
    attached: false,
    selection: [{ blockId: 'b5', order: 1, instruction: 'second draft' }],
  })
  assert.deepEqual(JSON.parse(testStorage.getItem(`${ARTIFACT_DRAFT_INDEX_PREFIX}p7`)), [keyA, keyB])
  assert.equal(hydrateArtifactDrafts('p7'), 2)
  assert.equal(draftSessionFor(keyA).requestId, 'req_restore0002')
  assert.equal(draftSessionFor(keyB).requestId, 'req_restore0003')
  assert.equal(draftSessionFor(keyB).attached, false)
  assert.deepEqual(draftSessionFor(keyB).targetOrder.slice(0, 2), ['b2', 'b1'])
  assert.equal(draftSessionFor(keyB).orderChanged, true)
  assert.deepEqual(draftSessionFor(keyB).selection.map(entry => entry.blockId), ['b5'])
  assert.equal(draftSessionsFor('p7').length, 2)
})

test('store: temporary-style cards with a valid snapshot open and keep it', async () => {
  stubRevision(false)
  const program = programFor('call_temp1', { styleSource: 'temporary', temporaryStyle: TEMP_STYLE })
  assert.equal(supportsBlockEditing(program), true)
  assert.deepEqual(openArtifactEditor('t1', program), { ok: true })
  await settle()
  const session = draftSessionFor(editKey('t1', 'call_temp1'))
  assert.deepEqual(session.temporaryStyle, TEMP_STYLE)
  assert.equal(session.style, 'card')
  assert.equal(session.styleId, undefined)

  // Missing or invalid snapshots still offer no editor.
  assert.deepEqual(
    openArtifactEditor('t1', programFor('call_temp_missing', { styleSource: 'temporary' })),
    { ok: false, reason: 'unsupported' },
  )
  assert.deepEqual(
    openArtifactEditor('t1', programFor('call_temp_invalid', {
      styleSource: 'temporary',
      temporaryStyle: { schemaVersion: 1, baseLayout: 'card', directives: '' },
    })),
    { ok: false, reason: 'unsupported' },
  )
})

test('store: temporary-style content edits send the snapshot without a style id', async () => {
  stubRevision(false)
  openArtifactEditor('t2', programFor('call_temp2', { styleSource: 'temporary', temporaryStyle: TEMP_STYLE }))
  await settle()
  const key = editKey('t2', 'call_temp2')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'temp content edit')
  const outcome = await serializeArtifactEditRequest(referenceForSession(key))
  assert.equal(outcome.ok, true)
  assert.deepEqual(outcome.request.temporaryStyle, TEMP_STYLE)
  assert.equal(outcome.request.styleId, undefined)
  assert.equal(outcome.request.style, 'card')
  const text = buildEditRequestText(outcome.request)
  assert.deepEqual(parseEditRequestText(text).temporaryStyle, TEMP_STYLE)
  assert.equal(text.includes('"styleId"'), false)
  assert.equal(draftSessionFor(key).status, 'submitted')
})

test('store: temporary-style reorder or global-only sends are rejected before probing', async () => {
  stubRevision(false)
  openArtifactEditor('t3', programFor('call_temp3', { styleSource: 'temporary', temporaryStyle: TEMP_STYLE }))
  await settle()
  const key = editKey('t3', 'call_temp3')
  moveArtifactBlock(key, 'b5', 0)
  assert.deepEqual(await serializeArtifactEditRequest(referenceForSession(key)), { ok: false, problem: 'temporary_order' })
  assert.equal(draftSessionFor(key).status, 'ready')
  assert.equal(draftSessionFor(key).submittedAt, undefined)
  assert.equal(editProblemMessage('temporary_order'), en['edit.errorTemporaryOrder'])

  resetArtifactOrder(key)
  setArtifactGlobalInstruction(key, 'global only')
  assert.deepEqual(await serializeArtifactEditRequest(referenceForSession(key)), { ok: false, problem: 'temporary_order' })
  assert.equal(draftSessionFor(key).status, 'ready')
})

test('store: temporary-style drafts persist and rehydrate their snapshot', async () => {
  stubRevision(false)
  openArtifactEditor('t4', programFor('call_temp4', { styleSource: 'temporary', temporaryStyle: TEMP_STYLE }))
  await settle()
  const key = editKey('t4', 'call_temp4')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'persisted temp edit')
  flushArtifactDraftPersistence()
  const raw = testStorage.getItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}${key}`)
  assert.ok(raw)
  const stored = JSON.parse(raw)
  assert.deepEqual(stored.temporaryStyle, TEMP_STYLE)
  assert.equal(stored.styleId, undefined)

  // Reload simulation under a new chat id.
  const clone = { ...stored, key: `t4r:${stored.baseRevisionId}`, sessionId: 't4r' }
  testStorage.setItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}${clone.key}`, JSON.stringify(clone))
  testStorage.setItem(`${ARTIFACT_DRAFT_INDEX_PREFIX}t4r`, JSON.stringify([clone.key]))
  const restored = editSessionFor('t4r', stored.baseRevisionId)
  assert.ok(restored)
  assert.deepEqual(restored.temporaryStyle, TEMP_STYLE)
  assert.equal(restored.styleId, undefined)

  const outcome = await serializeArtifactEditRequest(referenceForSession(clone.key))
  assert.equal(outcome.ok, true)
  assert.deepEqual(outcome.request.temporaryStyle, TEMP_STYLE)
  assert.equal(outcome.request.styleId, undefined)
})

test('store: a style instruction sends a style envelope and skips block fields', async () => {
  setArtifactStyleEditSupported(true)
  stubRevision(false)
  openArtifactEditor('st1', programFor('call_style_a'))
  await settle()
  const key = editKey('st1', 'call_style_a')
  setArtifactStyleInstruction(key, '  换成更冷静的配色  ')
  await settle()
  assert.equal(draftSessionFor(key).styleInstruction, '  换成更冷静的配色  ')
  assert.equal(hasArtifactEditContent(draftSessionFor(key)), true)
  // The chip label sync is debounced with the typed global instruction.
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.ok(chip.upserts.at(-1).label.includes(en['edit.chipTail.style']))
  assert.ok(chipLabelForSession(draftSessionFor(key)).includes(en['edit.chipTail.style']))

  const outcome = await serializeArtifactEditRequest(referenceForSession(key))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.request.kind, 'style')
  assert.equal(outcome.request.styleInstruction, '换成更冷静的配色')
  assert.equal('edits' in outcome.request, false)
  assert.equal('targetOrder' in outcome.request, false)
  assert.equal(outcome.request.requestId.startsWith('req_'), true)
  const text = buildEditRequestText(outcome.request)
  assert.deepEqual(parseEditRequestText(text), outcome.request)
  assert.equal(draftSessionFor(key).status, 'submitted')
})

test('store: style and block content cannot be sent together', async () => {
  setArtifactStyleEditSupported(true)
  stubRevision(false)
  openArtifactEditor('st2', programFor('call_style_b'))
  await settle()
  const key = editKey('st2', 'call_style_b')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'change a block')
  setArtifactStyleInstruction(key, 'cool palette')
  assert.deepEqual(await serializeArtifactEditRequest(referenceForSession(key)), { ok: false, problem: 'style_mixed' })
  assert.equal(editProblemMessage('style_mixed'), en['edit.styleMixed'])
  // The style chip label still wins the summary while both exist.
  assert.ok(chipLabelForSession(draftSessionFor(key)).includes(en['edit.chipTail.style']))

  clearAllArtifactEdits(key)
  setArtifactStyleInstruction(key, '')
  assert.deepEqual(await serializeArtifactEditRequest(referenceForSession(key)), { ok: false, problem: 'empty' })
})

test('store: an old Host without the style capability drops pending instructions', async () => {
  setArtifactStyleEditSupported(true)
  stubRevision(false)
  openArtifactEditor('st3', programFor('call_style_c'))
  await settle()
  const key = editKey('st3', 'call_style_c')
  setArtifactStyleInstruction(key, 'cool palette')
  setArtifactStyleEditSupported(false)
  assert.equal(draftSessionFor(key).styleInstruction, '')
  assert.equal(editProblemMessage('style_unsupported'), en['edit.styleUnavailable'])
  // Defensive: even if an instruction (e.g. a late patch) reappears, the send
  // is refused so an old Host never receives an unreadable style envelope.
  setArtifactStyleInstruction(key, 'cool palette')
  assert.deepEqual(await serializeArtifactEditRequest(referenceForSession(key)), { ok: false, problem: 'style_unsupported' })
  setArtifactStyleEditSupported(true)
})

test('store: style instructions persist, rehydrate and tolerate old drafts', async () => {
  setArtifactStyleEditSupported(true)
  stubRevision(false)
  openArtifactEditor('st4', programFor('call_style_d'))
  await settle()
  const key = editKey('st4', 'call_style_d')
  setArtifactStyleInstruction(key, 'persisted style')
  flushArtifactDraftPersistence()
  const stored = JSON.parse(testStorage.getItem(`${ARTIFACT_DRAFT_STORAGE_PREFIX}${key}`))
  assert.equal(stored.styleInstruction, 'persisted style')
  assert.deepEqual(stored.selection, [])

  // A style-only restored draft hydrates: the instruction alone keeps it alive.
  putStoredDraft('st5', 'st5:call_style_e', { requestId: 'req_style0002', styleInstruction: 'restored style', selection: [] })
  assert.equal(hydrateArtifactDrafts('st5'), 1)
  assert.equal(draftSessionFor('st5:call_style_e').styleInstruction, 'restored style')
  assert.equal(hasArtifactEditContent(draftSessionFor('st5:call_style_e')), true)

  // Drafts persisted before style editing existed lack the field and still load.
  putStoredDraft('st5', 'st5:call_style_f', { requestId: 'req_style0003' })
  hydrateArtifactDrafts('st5')
  assert.equal(draftSessionFor('st5:call_style_f').styleInstruction, '')

  // An old Host drops the restored style instruction but keeps block content.
  setArtifactStyleEditSupported(false)
  putStoredDraft('st6', 'st6:call_style_g', {
    requestId: 'req_style0004',
    styleInstruction: 'old host style',
    selection: [{ blockId: 'b3', order: 1, instruction: 'keep this block edit' }],
  })
  hydrateArtifactDrafts('st6')
  const downgraded = draftSessionFor('st6:call_style_g')
  assert.equal(downgraded.styleInstruction, '')
  assert.deepEqual(downgraded.selection.map(entry => entry.blockId), ['b3'])
  setArtifactStyleEditSupported(true)
})

test('store: normal drafts still serialize without a temporary style', async () => {
  stubRevision(false)
  openArtifactEditor('t5', programFor('call_normal5'))
  await settle()
  const key = editKey('t5', 'call_normal5')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'normal edit')
  const outcome = await serializeArtifactEditRequest(referenceForSession(key))
  assert.equal(outcome.ok, true)
  assert.equal(outcome.request.temporaryStyle, undefined)
  assert.equal(outcome.request.styleId, undefined)
  assert.equal(outcome.request.style, 'card')
})

/** Wait for a fire-and-forget ensure plus a route round trip to settle. */
async function settleRoute() {
  for (let index = 0; index < 6; index += 1) await new Promise(resolve => setTimeout(resolve, 0))
}

test('store: opening the editor registers the rendered base once with its revision identity', async () => {
  stubRevision(false)
  const first = openArtifactEditor('s-base-open', programFor('call_base_open'))
  assert.deepEqual(first, { ok: true })
  await settleRoute()
  const calls = baseCalls()
  assert.equal(calls.length, 1, 'opening the editor posts exactly one base registration')
  assert.deepEqual(calls[0].body, {
    schemaVersion: 1,
    artifactId: 'call_base_open',
    revisionId: 'call_base_open',
    program: DST_PROGRAM,
  })
  // Closing and reopening the same card (draft retained or recreated) is cached.
  closeArtifactEditor(editKey('s-base-open', 'call_base_open'))
  assert.deepEqual(openArtifactEditor('s-base-open', programFor('call_base_open')), { ok: true })
  await settleRoute()
  assert.equal(baseCalls().length, 1, 'the settled registration is not repeated')
  // A later revision of the same artifact registers its own revision identity.
  assert.deepEqual(openArtifactEditor('s-base-open', programFor('call_base_open_2', {
    artifactId: 'call_base_open',
    revisionId: 'call_base_open_2',
    revision: 2,
  })), { ok: true })
  await settleRoute()
  const revisionCalls = baseCalls()
  assert.equal(revisionCalls.length, 2)
  assert.equal(revisionCalls[1].body.artifactId, 'call_base_open')
  assert.equal(revisionCalls[1].body.revisionId, 'call_base_open_2')
})

test('store: a structure preview waits for the base registration before it POSTs', async () => {
  let releaseBase
  const baseGate = new Promise(resolve => { releaseBase = resolve })
  stubFetch((url, body) => {
    if (url === ARTIFACT_BASE_ROUTE_PATH) {
      // Hold the registration open: without `await ensureBaseForSession` the
      // structure POST below would race ahead and fail the assertion.
      return baseGate.then(() => new Response(JSON.stringify({ ok: true, registered: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    if (url === ARTIFACT_STRUCTURE_ROUTE_PATH) {
      return new Response(JSON.stringify({
        ok: true,
        preview: { program: `${DST_PROGRAM}\npreviewMarker = Text("preview")`, operations: body.operations, changedBlockIds: ['b3'], touched: [] },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      artifactId: 'call_structure_order',
      revisionId: 'call_structure_order',
      revision: 1,
      latestRevisionId: 'call_structure_order',
      latestRevision: 1,
      conflict: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  assert.deepEqual(openArtifactEditor('s-structure-order', programFor('call_structure_order')), { ok: true })
  await settleRoute()
  assert.equal(fetchLog.filter(entry => entry.url === ARTIFACT_BASE_ROUTE_PATH).length, 1, 'opening the editor started the registration')
  assert.equal(fetchLog.filter(entry => entry.url === ARTIFACT_STRUCTURE_ROUTE_PATH).length, 0, 'no structure request before the preview call')
  previewArtifactStructure(editKey('s-structure-order', 'call_structure_order'), 'b3', 'duplicate')
  await settleRoute()
  assert.equal(
    fetchLog.filter(entry => entry.url === ARTIFACT_STRUCTURE_ROUTE_PATH).length,
    0,
    'the structure preview must not POST while the base registration is unresolved',
  )
  releaseBase()
  await settleRoute()
  const baseIndex = fetchLog.findIndex(entry => entry.url === ARTIFACT_BASE_ROUTE_PATH)
  const structureIndex = fetchLog.findIndex(entry => entry.url === ARTIFACT_STRUCTURE_ROUTE_PATH)
  assert.ok(baseIndex >= 0, 'the base registration ran first')
  assert.ok(structureIndex > baseIndex, 'the structure preview POST follows the base registration')
  const structureCalls = fetchLog.filter(entry => entry.url === ARTIFACT_STRUCTURE_ROUTE_PATH)
  assert.equal(structureCalls.length, 1)
  assert.equal(structureCalls[0].body.preview, true)
  assert.equal('program' in structureCalls[0].body, false, 'structure requests never carry a client program')
  assert.equal(structureCalls[0].body.baseRevisionId, 'call_structure_order')
  assert.equal(structureCalls[0].body.operations[0].op, 'duplicate')
  const session = editSessionFor('s-structure-order', 'call_structure_order')
  assert.equal(session.structurePreview.status, 'ready')
})

test('store: a reported missing base invalidates the cached registration so reopening re-posts it', async () => {
  let baseAttempts = 0
  stubFetch(url => {
    if (url === ARTIFACT_BASE_ROUTE_PATH) {
      baseAttempts += 1
      return new Response(JSON.stringify({ ok: true, registered: baseAttempts === 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === ARTIFACT_STRUCTURE_ROUTE_PATH) {
      return new Response(JSON.stringify({ error: { code: 'base_missing', message: 'missing' } }), {
        status: 404, headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      artifactId: 'call_invalidate',
      revisionId: 'call_invalidate',
      revision: 1,
      latestRevisionId: 'call_invalidate',
      latestRevision: 1,
      conflict: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const card = 'call_invalidate'
  assert.deepEqual(openArtifactEditor('s-invalidate', programFor(card)), { ok: true })
  await settleRoute()
  let baseIndexes = fetchLog.flatMap((entry, index) => entry.url === ARTIFACT_BASE_ROUTE_PATH ? [index] : [])
  assert.equal(baseIndexes.length, 1, 'the first open registered the base')
  await applyArtifactStructure(editKey('s-invalidate', card), 'b3', 'duplicate')
  assert.equal(editSessionFor('s-invalidate', card).structureError, en['edit.structureBaseMissing'])
  const missIndex = fetchLog.findIndex(entry => entry.url === ARTIFACT_STRUCTURE_ROUTE_PATH)
  assert.ok(missIndex >= 0, 'the apply reached the structure route')
  // The Host said the base program is gone: closing and reopening the canvas
  // must re-post the rendered program instead of serving the stale success.
  closeArtifactEditor(editKey('s-invalidate', card))
  assert.deepEqual(openArtifactEditor('s-invalidate', programFor(card)), { ok: true })
  await settleRoute()
  baseIndexes = fetchLog.flatMap((entry, index) => entry.url === ARTIFACT_BASE_ROUTE_PATH ? [index] : [])
  assert.equal(baseIndexes.length, 2, 'exactly one re-registration after the miss')
  assert.equal(baseAttempts, 2)
  assert.ok(baseIndexes[1] > missIndex, 'the second base POST happens after the missing-base failure')
})

test('store: preview, apply and quick adjust share the actionable missing-base copy', async () => {
  const missingBase = code => new Response(JSON.stringify({ error: { code, message: 'missing' } }), {
    status: 404, headers: { 'content-type': 'application/json' },
  })
  for (const code of ['artifact_missing', 'base_missing']) {
    stubFetch((url, body) => {
      if (url === ARTIFACT_BASE_ROUTE_PATH) {
        return new Response(JSON.stringify({ ok: true, registered: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === ARTIFACT_STRUCTURE_ROUTE_PATH) return missingBase(code)
      return new Response(JSON.stringify({}), { status: 500 })
    })
    // Preview failure now preserves the Host error code instead of a generic message.
    const previewCard = `call_preview_${code}`
    assert.deepEqual(openArtifactEditor('s-missing-preview', programFor(previewCard)), { ok: true })
    await settleRoute()
    previewArtifactStructure(editKey('s-missing-preview', previewCard), 'b3', 'duplicate')
    await settleRoute()
    const previewSession = editSessionFor('s-missing-preview', previewCard)
    assert.equal(previewSession.structurePreview.status, 'failed')
    assert.equal(previewSession.structurePreview.error, en['edit.structureBaseMissing'])
    assert.equal(previewSession.structurePreview.error.includes('re-render'), true, 'the copy offers the re-render path')
    assert.equal(previewSession.structurePreview.error.includes('instruction edit'), true, 'the copy offers the instruction path')

    // Apply failure uses the same copy.
    const applyCard = `call_apply_${code}`
    assert.deepEqual(openArtifactEditor('s-missing-apply', programFor(applyCard)), { ok: true })
    await settleRoute()
    await applyArtifactStructure(editKey('s-missing-apply', applyCard), 'b3', 'duplicate')
    const applySession = editSessionFor('s-missing-apply', applyCard)
    assert.equal(applySession.structureError, en['edit.structureBaseMissing'])
    assert.equal(applySession.structureError.includes('re-render'), true)
  }
  // Quick adjust (props surface) explains the missing program/card record.
  for (const [code, key] of [['base_missing', 'edit.propsNoBase'], ['artifact_missing', 'edit.propsMissingArtifact']]) {
    stubFetch(url => url === ARTIFACT_BASE_ROUTE_PATH
      ? new Response(JSON.stringify({ ok: true, registered: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      : missingBase(code))
    const card = `props-missing-${code}`
    assert.deepEqual(openArtifactEditor('s-missing-props', {
      callId: card, program: PROPS_PROGRAM, title: PROPS_TITLE, style: 'card', running: false,
    }), { ok: true })
    await settleRoute()
    await applyArtifactBlockProps(editKey('s-missing-props', card), 'b2', { color: 'info' })
    const session = editSessionFor('s-missing-props', card)
    assert.equal(session.propsError, en[key])
    assert.equal(session.propsFallback, code)
    assert.equal(session.propsError.includes('instruction edit'), true, 'quick adjust also points at instruction editing')
  }
})
