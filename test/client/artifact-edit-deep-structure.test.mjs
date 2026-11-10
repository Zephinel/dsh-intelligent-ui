/**
 * Unit tests for the deep-page structure fallback of the Apply pipeline.
 *
 * Real dashboard pages nest root -> Card -> Col -> Row -> Card -> Col -> Text
 * (depth 6). The historical `MAX_CST_DEPTH = 4` made every queued structure
 * operation resolve as `unresolved`; these tests lock the raised limit and the
 * accurate depth/nested-target conflicts for pages that remain too deep.
 *
 * Run: node --test test/client/artifact-edit-deep-structure.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEEP_DASHBOARD_PROGRAM, VERY_DEEP_PROGRAM } from '../browser/fixtures/deep-artifact.ts'
import { resolvePendingStructureOperations } from '../../src/client/artifact-edit/store.ts'
import { applyStructureBatch } from '../../src/host/artifact-structure.ts'

/** One queued operation fixture. */
function op(overrides) {
  return { id: `op-${Math.random().toString(36).slice(2)}`, createdAt: 1, ...overrides }
}

test('a dashboard-depth page resolves root duplicate/delete and the real Host applies it', () => {
  const duplicate = resolvePendingStructureOperations(DEEP_DASHBOARD_PROGRAM, [op({ op: 'duplicate', blockId: 'b3' })])
  assert.deepEqual(duplicate.conflicts, [], 'no conflict for a root duplicate on a depth-6 page')
  assert.equal(duplicate.operations.length, 1)
  assert.equal(duplicate.operations[0].op, 'duplicate')
  assert.equal(typeof duplicate.operations[0].nodeId, 'string')
  assert.equal(typeof duplicate.operations[0].sourceDigest, 'string')
  const duplicated = applyStructureBatch(DEEP_DASHBOARD_PROGRAM, duplicate.operations)
  assert.equal(duplicated.ok, true, 'the real Host batch engine accepts the root duplicate')
  if (duplicated.ok) {
    assert.equal((duplicated.program.match(/板块 1"/g) ?? []).length, 2, 'the duplicated card is present in the new revision')
  }

  const deletion = resolvePendingStructureOperations(DEEP_DASHBOARD_PROGRAM, [op({ op: 'delete', blockId: 'b7' })])
  assert.deepEqual(deletion.conflicts, [], 'no conflict for a root delete on a depth-6 page')
  const deleted = applyStructureBatch(DEEP_DASHBOARD_PROGRAM, deletion.operations)
  assert.equal(deleted.ok, true, 'the real Host batch engine accepts the root delete')
  if (deleted.ok) assert.equal(deleted.program.includes('板块 5'), false, 'the deleted card is gone')

  const move = resolvePendingStructureOperations(DEEP_DASHBOARD_PROGRAM, [op({ op: 'move', blockId: 'b1' })])
  assert.deepEqual(move.conflicts, [], 'no conflict for a root move on a depth-6 page')
  const moved = applyStructureBatch(DEEP_DASHBOARD_PROGRAM, move.operations)
  assert.equal(moved.ok, true, 'the real Host batch engine accepts the root move')
})

test('a page past the supported depth reports a depth conflict, never "unresolved"', () => {
  const resolved = resolvePendingStructureOperations(VERY_DEEP_PROGRAM, [
    op({ op: 'duplicate', blockId: 'b1' }),
    op({ op: 'delete', blockId: 'b3' }),
  ])
  assert.deepEqual(resolved.operations, [], 'nothing is sent for a too-deep page')
  assert.deepEqual(resolved.conflicts.map(conflict => conflict.kind), ['depth', 'depth'])
  assert.equal(resolved.conflicts.some(conflict => conflict.kind === 'unresolved'), false)
  // The Host applies the same policy, so the client conflict matches reality.
  const built = resolvePendingStructureOperations(VERY_DEEP_PROGRAM, [op({ op: 'duplicate', blockId: 'b1' })])
  assert.deepEqual(built.operations, [])
})

test('a nested move on a too-deep page gets the dedicated nested-target conflict', () => {
  const resolved = resolvePendingStructureOperations(VERY_DEEP_PROGRAM, [
    op({ op: 'move', blockId: 'b1', targetParentBlockId: 'b2' }),
  ])
  assert.deepEqual(resolved.operations, [])
  assert.deepEqual(resolved.conflicts.map(conflict => conflict.kind), ['nestedTarget'])
  assert.equal(resolved.conflicts[0].blockId, 'b1')
})
