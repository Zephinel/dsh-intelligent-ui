/**
 * Unit tests for the Artifact arrangement batch-order semantics.
 *
 * Restores the order coverage that disappeared with the legacy single-operation
 * batch API (the preview/apply half of the old file stays deleted): the pure
 * up/down/top/bottom rules, the store action touching only `targetOrder` and
 * `orderChanged`, and the per-parent nested behaviour.
 *
 * Run: node --test test/client/artifact-edit-batch-order.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DST_PROGRAM, DST_TITLE } from '../browser/fixtures/dst-artifact.ts'
import { NESTED_PROGRAM, NESTED_TITLE } from '../browser/fixtures/nested-artifact.ts'
import { ARTIFACT_BASE_ROUTE_PATH } from '../../src/shared/artifact-base.ts'
import { ARTIFACT_STRUCTURE_ROUTE_PATH } from '../../src/shared/artifact-structure.ts'
import {
  batchMoveTarget,
  canBatchMove,
  editKey,
  editSessionFor,
  moveArtifactBlocks,
  moveArtifactNestedBlocks,
  openArtifactBlockEditor,
  openArtifactEditor,
  resetArtifactOrder,
  saveArtifactBlockInstruction,
  setArtifactNestedMode,
} from '../../src/client/artifact-edit/store.ts'

/** Every URL/body pair the current fetch stub received, in order. */
const fetchLog = []

/** JSON response helper. */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
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

/** Default Host: registration succeeds and the revision probe reports no conflict. */
function hostHandler() {
  return (url) => {
    if (url === ARTIFACT_BASE_ROUTE_PATH) return json({ ok: true, registered: true })
    return json({
      artifactId: 'call_1',
      revisionId: 'call_1',
      revision: 1,
      latestRevisionId: 'call_1',
      latestRevision: 1,
      conflict: false,
    })
  }
}

/** Wait for fire-and-forget ensure/probe requests to settle. */
async function settleRoute() {
  for (let index = 0; index < 6; index += 1) await new Promise(resolve => setTimeout(resolve, 0))
}

/** One rendered card program, as the card extraction produces it. */
function programFor(callId) {
  return { callId, program: DST_PROGRAM, title: DST_TITLE, style: 'card', running: false }
}

/** The nested fixture rendered as one card. */
function nestedProgramFor(callId) {
  return { callId, program: NESTED_PROGRAM, title: NESTED_TITLE, style: 'card', running: false }
}

/** Open one editor and wait for the initial probe/registration. */
async function openEditor(sessionId, callId) {
  assert.deepEqual(openArtifactEditor(sessionId, programFor(callId)), { ok: true })
  await settleRoute()
  return editKey(sessionId, callId)
}

/** Open one nested-mode editor and wait for the initial probe/registration. */
async function openNestedEditor(sessionId, callId) {
  assert.deepEqual(openArtifactEditor(sessionId, nestedProgramFor(callId)), { ok: true })
  await settleRoute()
  const key = editKey(sessionId, callId)
  assert.equal(setArtifactNestedMode(key, true), true)
  return key
}

/** Structure request bodies in send order. */
const structureCalls = () => fetchLog.filter(entry => entry.url === ARTIFACT_STRUCTURE_ROUTE_PATH)

test('batch order: up and down move every selected block one slot without crossing', () => {
  assert.deepEqual(batchMoveTarget(['b1', 'b2', 'b3', 'b4'], ['b2', 'b4'], 'up'), ['b2', 'b1', 'b4', 'b3'])
  assert.deepEqual(batchMoveTarget(['b1', 'b2', 'b3', 'b4'], ['b1', 'b3'], 'down'), ['b2', 'b1', 'b4', 'b3'])
  // A contiguous selected group cannot cross itself: both ends are blocked.
  assert.equal(batchMoveTarget(['b1', 'b2', 'b3', 'b4'], ['b1', 'b2'], 'up'), undefined)
  // A selected block swaps with one unselected neighbour, so a block just above
  // another selected block moves into the slot the first one vacated.
  assert.deepEqual(batchMoveTarget(['b1', 'b2', 'b3', 'b4'], ['b2', 'b3'], 'up'), ['b2', 'b3', 'b1', 'b4'])
  assert.equal(canBatchMove(['b1', 'b2', 'b3', 'b4'], ['b1', 'b2'], 'up'), false)
  assert.equal(canBatchMove(['b1', 'b2', 'b3', 'b4'], ['b2', 'b3'], 'up'), true)
})

test('batch order: top and bottom keep the selected relative order', () => {
  assert.deepEqual(batchMoveTarget(['b1', 'b2', 'b3', 'b4', 'b5'], ['b4', 'b2'], 'top'), ['b2', 'b4', 'b1', 'b3', 'b5'])
  assert.deepEqual(batchMoveTarget(['b1', 'b2', 'b3', 'b4', 'b5'], ['b4', 'b2'], 'bottom'), ['b1', 'b3', 'b5', 'b2', 'b4'])
  // Already at the requested edge / empty selection means no-op.
  assert.equal(batchMoveTarget(['b1', 'b2', 'b3'], ['b1', 'b2'], 'top'), undefined)
  assert.equal(batchMoveTarget(['b1', 'b2', 'b3'], ['b2', 'b3'], 'bottom'), undefined)
  assert.equal(batchMoveTarget(['b1', 'b2', 'b3'], [], 'up'), undefined)
  assert.equal(batchMoveTarget(['b1', 'b2', 'b3'], ['b9'], 'down'), undefined)
})

test('batch order: the store action changes only targetOrder and keeps edit requests intact', async () => {
  stubFetch(hostHandler())
  const sessionId = 's-batch-order'
  const key = await openEditor(sessionId, 'call_batch_order')
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'keep this request')
  const before = editSessionFor(sessionId, 'call_batch_order')
  assert.deepEqual(before.originalOrder, before.targetOrder)

  moveArtifactBlocks(key, ['b1', 'b2'], 'bottom')
  let session = editSessionFor(sessionId, 'call_batch_order')
  assert.equal(session.targetOrder.slice(-2).join(','), 'b1,b2')
  assert.equal(session.orderChanged, true)
  assert.deepEqual(session.originalOrder, before.originalOrder, 'the base page order is untouched')
  assert.deepEqual(session.selection, [{ blockId: 'b3', order: 1, instruction: 'keep this request' }], 'edit numbering and colours are untouched')

  moveArtifactBlocks(key, ['b1', 'b2'], 'top')
  session = editSessionFor(sessionId, 'call_batch_order')
  assert.deepEqual(session.targetOrder, before.originalOrder, 'moving back to the top restores the base order')
  assert.equal(session.orderChanged, false)
  assert.equal(structureCalls().length, 0, 'arrangement operations never reach the structure route')
})

test('batch order: no selection or an immovable selection is a store no-op', async () => {
  stubFetch(hostHandler())
  const sessionId = 's-batch-order-noop'
  const key = await openEditor(sessionId, 'call_batch_order_noop')
  const before = editSessionFor(sessionId, 'call_batch_order_noop')
  moveArtifactBlocks(key, [], 'up')
  let session = editSessionFor(sessionId, 'call_batch_order_noop')
  assert.deepEqual(session.targetOrder, before.targetOrder, 'an empty selection changes nothing')
  assert.equal(session.orderChanged, false)
  // The first block cannot move up; the last cannot move down.
  moveArtifactBlocks(key, ['b1'], 'up')
  moveArtifactBlocks(key, [before.targetOrder.at(-1)], 'down')
  session = editSessionFor(sessionId, 'call_batch_order_noop')
  assert.deepEqual(session.targetOrder, before.targetOrder, 'boundary moves are no-ops')
  assert.equal(session.orderChanged, false)
  // Reset restores the base order without touching the saved request.
  saveArtifactBlockInstruction(key, 'b2', 'keep me')
  moveArtifactBlocks(key, ['b2'], 'top')
  assert.equal(editSessionFor(sessionId, 'call_batch_order_noop').orderChanged, true)
  resetArtifactOrder(key)
  session = editSessionFor(sessionId, 'call_batch_order_noop')
  assert.deepEqual(session.targetOrder, before.originalOrder, 'reset restores the page order')
  assert.equal(session.orderChanged, false)
  assert.deepEqual(session.selection.map(entry => [entry.blockId, entry.instruction]), [['b2', 'keep me']], 'reset keeps the saved request')
  assert.equal(structureCalls().length, 0, 'no arrangement action reaches the structure route')
})

test('nested batch order moves each selected child inside its own parent group', async () => {
  stubFetch(hostHandler())
  const sessionId = 's-nested-batch-order'
  const key = await openNestedEditor(sessionId, 'call_nested_batch_order')
  let session = editSessionFor(sessionId, 'call_nested_batch_order')
  assert.deepEqual(session.nestedOrder['b1'], ['b1.1', 'b1.2'], 'card group lists Title and Col')
  assert.deepEqual(session.nestedOrder['b1.2'], ['b1.2.1', 'b1.2.2', 'b1.2.3'])
  assert.deepEqual(session.nestedOrder['b2.2'], ['b2.2.1', 'b2.2.2'])

  moveArtifactNestedBlocks(key, ['b1.2.1', 'b2.2.1'], 'down')
  session = editSessionFor(sessionId, 'call_nested_batch_order')
  assert.deepEqual(session.nestedOrder['b1.2'], ['b1.2.2', 'b1.2.1', 'b1.2.3'], 'the first parent group moves one slot down')
  assert.deepEqual(session.nestedOrder['b2.2'], ['b2.2.2', 'b2.2.1'], 'the second parent group moves independently')
  assert.deepEqual(session.nestedOrder['b1'], ['b1.1', 'b1.2'], 'unselected groups are untouched')
  assert.equal(session.nestedOrderChanged, true)
  assert.deepEqual(session.selection, [], 'nested ordering leaves saved requests untouched')
  assert.equal(structureCalls().length, 0, 'nested ordering never reaches the structure route')

  // A boundary selection is a no-op rather than an error.
  moveArtifactNestedBlocks(key, ['b1.1'], 'up')
  assert.deepEqual(editSessionFor(sessionId, 'call_nested_batch_order').nestedOrder['b1'], ['b1.1', 'b1.2'])

  moveArtifactNestedBlocks(key, ['b1.2.1', 'b2.2.1'], 'top')
  session = editSessionFor(sessionId, 'call_nested_batch_order')
  assert.deepEqual(session.nestedOrder['b1.2'], ['b1.2.1', 'b1.2.2', 'b1.2.3'])
  assert.deepEqual(session.nestedOrder['b2.2'], ['b2.2.1', 'b2.2.2'])
  assert.equal(session.nestedOrderChanged, false, 'moving back to the top restores the base order')
})

test('nested batch order: no selection or no movable child is a no-op', async () => {
  stubFetch(hostHandler())
  const sessionId = 's-nested-batch-order-noop'
  const key = await openNestedEditor(sessionId, 'call_nested_batch_order_noop')
  const before = editSessionFor(sessionId, 'call_nested_batch_order_noop')
  moveArtifactNestedBlocks(key, [], 'down')
  moveArtifactNestedBlocks(key, ['b1.1'], 'up')
  moveArtifactNestedBlocks(key, ['b2.2.2'], 'down')
  const session = editSessionFor(sessionId, 'call_nested_batch_order_noop')
  assert.deepEqual(session.nestedOrder, before.nestedOrder, 'immovable nested selections change nothing')
  assert.equal(session.nestedOrderChanged, false)
  assert.equal(structureCalls().length, 0)
})
