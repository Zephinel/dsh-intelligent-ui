/**
 * Unit tests for the Artifact arrangement batch operations.
 *
 * Covers the pure order semantics shared by the store and the panel's disabled
 * states, and the batch structure path: one preview request, one apply request,
 * one local structural revision, plus the selection cap and unresolved-block
 * guards. The Host apply loop is imported so the duplicate order/index contract
 * is pinned against the real implementation, not a copy.
 *
 * Run: node --test test/client/artifact-edit-batch-ops.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DST_PROGRAM, DST_TITLE } from '../browser/fixtures/dst-artifact.ts'
import { ARTIFACT_BASE_ROUTE_PATH } from '../../src/shared/artifact-base.ts'
import { ARTIFACT_STRUCTURE_ROUTE_PATH, MAX_ARTIFACT_STRUCTURE_OPERATIONS } from '../../src/shared/artifact-structure.ts'
import { applyStructureBatch } from '../../src/host/artifact-structure.ts'
import {
  batchMoveTarget,
  canBatchMove,
  cancelArtifactStructurePreview,
  confirmArtifactStructurePreview,
  editKey,
  editSessionFor,
  moveArtifactBlocks,
  openArtifactBlockEditor,
  openArtifactEditor,
  previewArtifactStructure,
  previewBatchArtifactStructure,
  saveArtifactBlockInstruction,
} from '../../src/client/artifact-edit/store.ts'
import { localRevisionsFor } from '../../src/client/artifact-edit/local-revisions.ts'
import { en, translate } from '../../src/shared/locales.ts'

const t = translate(en)

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
function hostHandler(structure = () => json({ error: { code: 'invalid_input', message: 'unexpected' } }, 400)) {
  return (url, body) => {
    if (url === ARTIFACT_BASE_ROUTE_PATH) return json({ ok: true, registered: true })
    if (url === ARTIFACT_STRUCTURE_ROUTE_PATH) return structure(body)
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

/** Wait for fire-and-forget ensure/probe requests plus a route round trip. */
async function settleRoute() {
  for (let index = 0; index < 6; index += 1) await new Promise(resolve => setTimeout(resolve, 0))
}

/** One rendered card program, as the card extraction produces it. */
function programFor(callId, program = DST_PROGRAM, title = DST_TITLE) {
  return { callId, program, title, style: 'card', running: false }
}

/** Structure request bodies in send order. */
const structureCalls = () => fetchLog.filter(entry => entry.url === ARTIFACT_STRUCTURE_ROUTE_PATH)

/** Open one editor and wait for the initial probe/registration to settle. */
async function openEditor(sessionId, callId) {
  assert.deepEqual(openArtifactEditor(sessionId, programFor(callId)), { ok: true })
  await settleRoute()
  return editKey(sessionId, callId)
}

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

test('batch duplicate sends descending operations so every copy lands after its source', async () => {
  let appliedProgram
  stubFetch(hostHandler(body => {
    if (body.preview === true) {
      const applied = applyStructureBatch(DST_PROGRAM, body.operations)
      assert.equal(applied.ok, true)
      appliedProgram = applied.program
      return json({
        ok: true,
        preview: {
          program: applied.program,
          operations: body.operations,
          changedBlockIds: applied.affectedRootBlockIds,
          touched: [],
        },
      })
    }
    return json({
      ok: true,
      result: {
        artifactId: 'call_batch_dup',
        revisionId: 'struct_batch_dup',
        baseRevisionId: 'call_batch_dup',
        revision: 2,
        operationId: body.operationId,
        program: appliedProgram,
        style: 'card',
        title: DST_TITLE,
      },
    }, 201)
  }))
  const sessionId = 's-batch-dup'
  const key = await openEditor(sessionId, 'call_batch_dup')

  previewBatchArtifactStructure(key, ['b1', 'b2'], 'duplicate')
  await settleRoute()
  const previews = structureCalls()
  assert.equal(previews.length, 1, 'the batch preview is one request')
  assert.equal(previews[0].body.preview, true)
  assert.equal('program' in previews[0].body, false, 'no client program is sent')
  assert.equal(previews[0].body.operations.length, 2)
  assert.deepEqual(previews[0].body.operations.map(operation => operation.op), ['duplicate', 'duplicate'])
  // Descending page order: b2 duplicates first (index 1 + 1), then b1 (index 0 + 1).
  assert.deepEqual(previews[0].body.operations.map(operation => operation.toIndex), [2, 1])
  assert.notEqual(previews[0].body.operations[0].nodeId, previews[0].body.operations[1].nodeId)

  const previewSession = editSessionFor(sessionId, 'call_batch_dup')
  assert.equal(previewSession.structurePreview.batch, true)
  assert.deepEqual(previewSession.structurePreview.blockIds, ['b1', 'b2'])
  assert.equal(previewSession.structurePreview.status, 'ready')
  assert.equal(previewSession.structurePreview.diff.some(line => line.kind === 'add'), true, 'the dialog gets the added diff lines')

  // The real Host apply accepts the same batch and puts each copy after its source.
  const applied = applyStructureBatch(DST_PROGRAM, previews[0].body.operations)
  assert.equal(applied.ok, true)
  const rootLine = applied.program.split('\n')[0]
  assert.equal(rootLine.includes('head, head_copy1, answerCard, answerCard_copy1'), true, rootLine)
  assert.equal(applied.ok, true, 'the batch stays valid after both duplicates')

  confirmArtifactStructurePreview(key)
  await settleRoute()
  const calls = structureCalls()
  assert.equal(calls.length, 2, 'confirm posts one real batch')
  assert.equal(calls[1].body.preview, undefined)
  assert.deepEqual(calls[1].body.operations, calls[0].body.operations, 'the confirmed batch matches the previewed one')
  const revisions = localRevisionsFor(sessionId)
  assert.equal(revisions.length, 1, 'one batch produces one local revision card')
  assert.equal(revisions[0].kind, 'structure')
  assert.equal(editSessionFor(sessionId, 'call_batch_dup').status, 'submitted')
})

test('batch delete sends one request and records one local revision', async () => {
  let requestCount = 0
  stubFetch(hostHandler(body => {
    if (body.preview === true) {
      const applied = applyStructureBatch(DST_PROGRAM, body.operations)
      assert.equal(applied.ok, true)
      return json({ ok: true, preview: { program: applied.program, operations: body.operations, changedBlockIds: applied.affectedRootBlockIds, touched: [] } })
    }
    requestCount += 1
    return json({
      ok: true,
      result: {
        artifactId: 'call_batch_del',
        revisionId: 'struct_batch_delete',
        baseRevisionId: 'call_batch_del',
        revision: 2,
        operationId: body.operationId,
        program: DST_PROGRAM,
        style: 'card',
        title: DST_TITLE,
      },
    }, 201)
  }))
  const sessionId = 's-batch-del'
  const key = await openEditor(sessionId, 'call_batch_del')
  previewBatchArtifactStructure(key, ['b1', 'b2'], 'delete')
  await settleRoute()
  const previews = structureCalls()
  assert.equal(previews.length, 1)
  const operations = previews[0].body.operations
  assert.deepEqual(operations.map(operation => operation.op), ['delete', 'delete'])
  assert.notEqual(operations[0].nodeId, operations[1].nodeId, 'each selected block has its own node')
  assert.equal(operations.some(operation => 'toIndex' in operation), false, 'delete carries no destination index')
  confirmArtifactStructurePreview(key)
  await settleRoute()
  assert.equal(requestCount, 1, 'one real batch apply')
  const revisions = localRevisionsFor(sessionId)
  assert.equal(revisions.length, 1, 'one batch delete produces one revision card')
  assert.equal(revisions[0].kind, 'structure')
})

test('batch structure actions refuse more than the Host cap before sending', async () => {
  const statementIds = Array.from({ length: 21 }, (_, index) => `s${index + 1}`)
  const program = [
    `root = Col([${statementIds.join(', ')}])`,
    ...statementIds.map((id, index) => `${id} = Text("item ${index + 1}", "sm")`),
  ].join('\n')
  stubFetch(hostHandler())
  const sessionId = 's-batch-cap'
  assert.deepEqual(openArtifactEditor(sessionId, programFor('call_batch_cap', program, '21 blocks')), { ok: true })
  await settleRoute()
  const key = editKey(sessionId, 'call_batch_cap')
  const session = editSessionFor(sessionId, 'call_batch_cap')
  assert.equal(session.targetOrder.length, 21)
  assert.equal(MAX_ARTIFACT_STRUCTURE_OPERATIONS, 20)

  previewBatchArtifactStructure(key, session.targetOrder, 'delete')
  assert.equal(structureCalls().length, 0, 'the over-limit batch never reaches the route')
  assert.equal(
    editSessionFor(sessionId, 'call_batch_cap').structureError,
    t('edit.batchLimit', { max: MAX_ARTIFACT_STRUCTURE_OPERATIONS, count: 21 }),
  )
})

test('batch structure actions refuse an unresolved block before sending', async () => {
  stubFetch(hostHandler())
  const sessionId = 's-batch-unresolved'
  const key = await openEditor(sessionId, 'call_batch_unresolved')
  previewBatchArtifactStructure(key, ['b1', 'b99'], 'duplicate')
  assert.equal(structureCalls().length, 0, 'the unresolved batch never reaches the route')
  assert.equal(editSessionFor(sessionId, 'call_batch_unresolved').structureError, t('edit.batchUnresolved'))
})

test('cancelling a batch preview drops it without applying anything', async () => {
  stubFetch(hostHandler(() => json({ ok: true, preview: { program: DST_PROGRAM, operations: [], changedBlockIds: [], touched: [] } })))
  const sessionId = 's-batch-cancel'
  const key = await openEditor(sessionId, 'call_batch_cancel')
  previewBatchArtifactStructure(key, ['b1', 'b2'], 'duplicate')
  await settleRoute()
  assert.equal(editSessionFor(sessionId, 'call_batch_cancel').structurePreview.status, 'ready')
  cancelArtifactStructurePreview(key)
  assert.equal(editSessionFor(sessionId, 'call_batch_cancel').structurePreview, undefined)
  assert.equal(structureCalls().length, 1, 'cancel never posts a real apply')
  assert.equal(localRevisionsFor(sessionId).length, 0)
})

test('single-block preview and apply keep their one-operation shape', async () => {
  let appliedProgram = DST_PROGRAM
  stubFetch(hostHandler(body => {
    if (body.preview === true) {
      const applied = applyStructureBatch(DST_PROGRAM, body.operations)
      appliedProgram = applied.ok === true ? applied.program : DST_PROGRAM
      return json({ ok: true, preview: { program: appliedProgram, operations: body.operations, changedBlockIds: ['b3'], touched: [] } })
    }
    return json({
      ok: true,
      result: {
        artifactId: 'call_single_dup',
        revisionId: 'struct_single_dup',
        baseRevisionId: 'call_single_dup',
        revision: 2,
        operationId: body.operationId,
        program: appliedProgram,
        style: 'card',
        title: DST_TITLE,
      },
    }, 201)
  }))
  const sessionId = 's-single-dup'
  const key = await openEditor(sessionId, 'call_single_dup')
  previewArtifactStructure(key, 'b3', 'duplicate')
  await settleRoute()
  const calls = structureCalls()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].body.operations.length, 1, 'the one-block path still sends a single operation')
  const preview = editSessionFor(sessionId, 'call_single_dup').structurePreview
  assert.equal(preview.batch, undefined)
  assert.equal(preview.blockIds, undefined)
  confirmArtifactStructurePreview(key)
  await settleRoute()
  assert.equal(structureCalls()[1].body.operations.length, 1)
  assert.equal(localRevisionsFor(sessionId).length, 1)
})
