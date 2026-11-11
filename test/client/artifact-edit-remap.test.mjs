/**
 * Unit tests for the save → preview → Apply draft remap (task-11).
 *
 * Run: node --test test/client/artifact-edit-remap.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_PENDING_STRUCTURE_OPS,
  detectPendingConflicts,
  isBlockDescendant,
  mapOldToNewBlocks,
  remapAdditions,
  remapNestedOrder,
  remapSelection,
  remapTargetOrder,
} from '../../src/client/artifact-edit/remap.ts'
import { MAX_ARTIFACT_STRUCTURE_OPERATIONS } from '../../src/shared/artifact-structure.ts'

/** One display block fixture. */
let seq = 0
function block(blockId, overrides = {}) {
  seq += 1
  const depth = (blockId.match(/\./g) ?? []).length
  return {
    blockId,
    componentType: 'Text',
    kind: 'text',
    title: blockId,
    originalIndex: seq,
    depth,
    ...overrides,
  }
}

/** One queued structure operation fixture. */
function op(overrides = {}) {
  return { id: `op-${Math.random().toString(36).slice(2)}`, op: 'delete', blockId: 'b1', createdAt: 1, ...overrides }
}

test('descendant ids are structural prefixes only', () => {
  assert.equal(isBlockDescendant('b1.2', 'b1'), true)
  assert.equal(isBlockDescendant('b1.2.1', 'b1'), true)
  assert.equal(isBlockDescendant('b10', 'b1'), false)
  assert.equal(isBlockDescendant('b1', 'b1'), false)
})

test('delete/duplicate/move pair untouched blocks across the revision', () => {
  const oldBlocks = [
    block('b1', { title: 'Alpha', componentType: 'Card' }),
    block('b2', { title: 'Beta' }),
    block('b3', { title: 'Gamma' }),
  ]
  // b2 deleted; a duplicate of alpha appears after b1.
  const newBlocks = [
    block('b1', { title: 'Alpha', componentType: 'Card' }),
    block('b2', { title: 'Alpha', componentType: 'Card' }),
    block('b3', { title: 'Gamma' }),
  ]
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, [op({ blockId: 'b2' }), op({ blockId: 'b1', op: 'duplicate' })])
  assert.deepEqual([...mapping.mapping.entries()], [['b1', 'b1'], ['b3', 'b3']])
  assert.equal(mapping.removed.has('b2'), true)
  assert.equal(mapping.duplicated.has('b2'), true, 'the copy after b1 is never a mapping target')
  assert.equal(mapping.unmapped.length, 0)
  assert.equal(mapping.reliable, true)
})

test('a container delete removes its descendants from the mapping', () => {
  const oldBlocks = [
    block('b1', { title: 'Box', componentType: 'Box' }),
    block('b1.1', { title: 'Child', parentBlockId: 'b1' }),
    block('b2', { title: 'After' }),
  ]
  const newBlocks = [block('b1', { title: 'After' })]
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, [op({ blockId: 'b1' })])
  assert.equal(mapping.removed.has('b1.1'), true)
  assert.equal(mapping.mapping.get('b2'), 'b1', 'the surviving sibling takes the only remaining block')
})

test('duplicated blocks never claim an old draft entry', () => {
  const oldBlocks = [block('b1', { title: 'Alpha' })]
  const newBlocks = [block('b1', { title: 'Alpha' }), block('b2', { title: 'Alpha' })]
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, [op({ op: 'duplicate', blockId: 'b1' })])
  assert.equal(mapping.duplicated.has('b2'), true)
  assert.equal(mapping.duplicated.has('b1'), false)
  assert.deepEqual([...mapping.mapping.entries()], [['b1', 'b1']])
  const selection = remapSelection([{ blockId: 'b1', order: 1, instruction: '改文案' }], mapping.mapping)
  assert.deepEqual(selection.selection, [{ blockId: 'b1', order: 1, instruction: '改文案' }])
})

test('selection and additions on removed blocks are reported as conflicts and dropped', () => {
  const blocks = [block('b1'), block('b2'), block('b3')]
  const conflicts = detectPendingConflicts({
    ops: [op({ blockId: 'b1' }), op({ blockId: 'b3', op: 'duplicate' })],
    blocks,
    selection: [{ blockId: 'b1' }, { blockId: 'b2' }],
    additions: [{ parentBlockId: 'b1', instruction: '新增' }],
    styleInstruction: '',
  })
  assert.deepEqual(conflicts.map(conflict => conflict.kind).sort(), ['addition', 'selection'])
  const mapping = mapOldToNewBlocks(blocks, [], [op({ blockId: 'b1' })])
  assert.deepEqual(remapSelection([{ blockId: 'b1', order: 1, instruction: 'x' }], mapping.mapping).unmapped, ['b1'])
  assert.deepEqual(remapAdditions([{ parentBlockId: 'b1', instruction: 'x' }], mapping.mapping).unmappedParents, ['b1'])
})

test('style instructions and invalid batches block Apply', () => {
  const blocks = [block('b1'), block('b1.1', { parentBlockId: 'b1' })]
  assert.equal(detectPendingConflicts({ ops: [op()], blocks, selection: [], styleInstruction: '改成蓝色' }).some(conflict => conflict.kind === 'styleMixed'), true)
  assert.equal(detectPendingConflicts({ ops: [op(), op({ blockId: 'b1.1' })], blocks, selection: [], styleInstruction: '' }).some(conflict => conflict.kind === 'overlap'), true)
  assert.equal(detectPendingConflicts({ ops: [op(), op()], blocks, selection: [], styleInstruction: '' }).some(conflict => conflict.kind === 'duplicate'), true)
  assert.equal(detectPendingConflicts({ ops: [op({ blockId: 'missing' })], blocks, selection: [], styleInstruction: '' }).some(conflict => conflict.kind === 'unresolved'), true)
  const many = Array.from({ length: 21 }, (_, index) => op({ blockId: `b${index + 1}` }))
  assert.equal(detectPendingConflicts({ ops: many, blocks: Array.from({ length: 21 }, (_, index) => block(`b${index + 1}`)), selection: [], styleInstruction: '' }).some(conflict => conflict.kind === 'limit'), true)
})

test('the client queue cap is the shared Host batch cap, so they cannot drift', () => {
  assert.equal(MAX_PENDING_STRUCTURE_OPS, MAX_ARTIFACT_STRUCTURE_OPERATIONS, 'one shared 20-op limit')
  assert.equal(MAX_PENDING_STRUCTURE_OPS, 20)
  const blocks = Array.from({ length: MAX_PENDING_STRUCTURE_OPS + 1 }, (_, index) => block(`b${index + 1}`))
  const atCap = blocks.slice(0, MAX_PENDING_STRUCTURE_OPS).map((item, index) => op({ blockId: item.blockId, id: `op-${index}` }))
  assert.equal(detectPendingConflicts({ ops: atCap, blocks, selection: [], styleInstruction: '' }).some(conflict => conflict.kind === 'limit'), false, 'the batch cap itself is accepted')
  const overCap = [...atCap, op({ blockId: blocks[MAX_PENDING_STRUCTURE_OPS].blockId, id: 'op-over' })]
  assert.equal(detectPendingConflicts({ ops: overCap, blocks, selection: [], styleInstruction: '' }).some(conflict => conflict.kind === 'limit'), true, 'the first op over the cap is rejected')
})

test('a clean batch has no conflicts', () => {
  assert.deepEqual(detectPendingConflicts({ ops: [op({ blockId: 'b2' })], blocks: [block('b1'), block('b2')], selection: [{ blockId: 'b1' }], styleInstruction: '' }), [])
})

test('target order keeps the user arrangement and places new blocks at their base position', () => {
  const oldBlocks = [block('b1', { title: 'one' }), block('b2', { title: 'two' }), block('b3', { title: 'three' })]
  const newBlocks = [
    block('b1', { title: 'one', originalIndex: 1 }),
    block('b2', { title: 'two', originalIndex: 2 }),
    block('b3', { title: 'three', originalIndex: 3 }),
    block('b4', { title: 'three', originalIndex: 4 }),
  ]
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, [op({ op: 'duplicate', blockId: 'b3' })])
  assert.equal(mapping.reliable, true)
  const remapped = remapTargetOrder(['b3', 'b1', 'b2'], mapping.mapping, newBlocks)
  assert.deepEqual(remapped.targetOrder, ['b3', 'b4', 'b1', 'b2'])
  assert.equal(remapped.orderChanged, true, 'the new copy joins directly after its source position')
})

test('MAJOR-1: an identical-text copy never steals the next sibling\'s saved request', () => {
  const oldBlocks = [block('b1', { title: undefined }), block('b2', { title: undefined })]
  const newBlocks = [
    block('b1', { title: undefined, originalIndex: 1 }),
    block('b2', { title: undefined, originalIndex: 2 }),
    block('b3', { title: undefined, originalIndex: 3 }),
  ]
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, [op({ op: 'duplicate', blockId: 'b1' })])
  assert.equal(mapping.reliable, true)
  assert.equal(mapping.duplicated.has('b2'), true, 'the inserted copy is excluded from pairing')
  assert.equal(mapping.mapping.get('b1'), 'b1')
  assert.equal(mapping.mapping.get('b2'), 'b3', 'the saved request on the second block stays on the original block')
  assert.deepEqual(remapSelection([{ blockId: 'b2', order: 1, instruction: '改第二段' }], mapping.mapping).selection.map(entry => entry.blockId), ['b3'])
  // The previous algorithm mapped old b2 to new b2 (the copy); the fixed mapping must not.
  assert.notEqual(mapping.mapping.get('b2'), 'b2')
})

test('MAJOR-1: a duplicate mixed with a move is unreliable, never guessed', () => {
  const oldBlocks = [block('b1', { title: 'a' }), block('b2', { title: 'b' })]
  const newBlocks = [block('b1', { title: 'a' }), block('b2', { title: 'a' })]
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, [
    { id: 'm1', op: 'move', blockId: 'b1', targetParentBlockId: 'root', createdAt: 1 },
    { id: 'd1', op: 'duplicate', blockId: 'b1', createdAt: 2 },
  ])
  assert.equal(mapping.reliable, false)
})

test('target order matches the new base when the user arrangement equals it', () => {
  const oldBlocks = [block('b1', { title: 'one' }), block('b2', { title: 'two' })]
  const newBlocks = [block('b1', { title: 'one' }), block('b2', { title: 'two' })]
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, [op({ op: 'duplicate', blockId: 'b1' })])
  const remapped = remapTargetOrder(['b1', 'b2'], mapping.mapping, newBlocks)
  assert.deepEqual(remapped.targetOrder, ['b1', 'b2'])
  assert.equal(remapped.orderChanged, false)
})

test('nested order drops removed children and keeps only changed groups', () => {
  const oldBlocks = [
    block('b1', { componentType: 'Box' }),
    block('b1.1', { parentBlockId: 'b1', title: 'a' }),
    block('b1.2', { parentBlockId: 'b1', title: 'b' }),
  ]
  const newBlocks = [
    block('b1', { componentType: 'Box' }),
    block('b1.1', { parentBlockId: 'b1', title: 'b' }),
  ]
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, [op({ blockId: 'b1.2' })])
  const remapped = remapNestedOrder({ nestedOrder: { b1: ['b1.2', 'b1.1'] }, mapping: mapping.mapping, newBlocks })
  assert.deepEqual(remapped.nestedOriginalOrder, { b1: ['b1.1'] })
  assert.deepEqual(remapped.nestedOrder, {}, 'the only remaining child needs no order group')
  assert.equal(remapped.nestedOrderChanged, false)
})

test('a child move keeps the container mapped when its derived title changes', () => {
  // A Col/Card title is derived from its first child text, so moving that child
  // changes the container's display title even though the container itself is
  // untouched. The mapping must still pair it by type + position.
  const container = { componentType: 'Col', kind: 'container' }
  const oldBlocks = [
    block('b1', { componentType: 'Card', kind: 'container', title: '卡片' }),
    block('b1.1', { parentBlockId: 'b1', ...container, title: 'A' }),
    block('b1.1.1', { parentBlockId: 'b1.1', title: 'A' }),
    block('b1.1.2', { parentBlockId: 'b1.1', title: 'B' }),
    block('b2', { componentType: 'Card', kind: 'container', title: '第二张' }),
    block('b2.1', { parentBlockId: 'b2', title: 'C' }),
  ]
  const newBlocks = [
    block('b1', { componentType: 'Card', kind: 'container', title: '卡片' }),
    block('b1.1', { parentBlockId: 'b1', ...container, title: 'B' }),
    block('b1.1.1', { parentBlockId: 'b1.1', title: 'B' }),
    block('b2', { componentType: 'Card', kind: 'container', title: '第二张' }),
    block('b2.1', { parentBlockId: 'b2', title: 'C' }),
    block('b2.2', { parentBlockId: 'b2', title: 'A' }),
  ]
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, [
    { id: 'm1', op: 'move', blockId: 'b1.1.1', targetParentBlockId: 'b2', createdAt: 1 },
  ])
  assert.equal(mapping.reliable, true)
  assert.equal(mapping.mapping.get('b1.1'), 'b1.1', 'the container pairs by type and position')
  assert.equal(mapping.mapping.get('b1.1.2'), 'b1.1.1', 'the untouched sibling keeps its identity')
  assert.equal(mapping.mapping.get('b1.1.1'), 'b2.2', 'the moved child pairs with its appended slot')
  assert.deepEqual(mapping.unmapped, [])
})

test('a pure nested duplicate is not reported as an arrangement change', () => {
  const oldBlocks = [
    block('b1', { componentType: 'Box' }),
    block('b1.1', { parentBlockId: 'b1', title: 'a' }),
    block('b1.2', { parentBlockId: 'b1', title: 'b' }),
  ]
  // Duplicating b1.1 inserts the copy directly after it: [a, a-copy, b].
  const newBlocks = [
    block('b1', { componentType: 'Box' }),
    block('b1.1', { parentBlockId: 'b1', title: 'a' }),
    block('b1.2', { parentBlockId: 'b1', title: 'a' }),
    block('b1.3', { parentBlockId: 'b1', title: 'b' }),
  ]
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, [op({ op: 'duplicate', blockId: 'b1.1' })])
  assert.equal(mapping.reliable, true)
  assert.equal(mapping.mapping.get('b1.2'), 'b1.3', 'the original second child keeps its own identity')
  const remapped = remapNestedOrder({ nestedOrder: { b1: ['b1.1', 'b1.2'] }, mapping: mapping.mapping, newBlocks })
  assert.deepEqual(remapped.nestedOrder, {}, 'an untouched order needs no pending group after a duplicate')
  assert.equal(remapped.nestedOrderChanged, false, 'a pure duplicate does not become a model request')
  assert.deepEqual(remapped.nestedOriginalOrder, { b1: ['b1.1', 'b1.2', 'b1.3'] })
})

test('a reordered nested group keeps its order and puts the copy next to its source', () => {
  const oldBlocks = [
    block('b1', { componentType: 'Box' }),
    block('b1.1', { parentBlockId: 'b1', title: 'a' }),
    block('b1.2', { parentBlockId: 'b1', title: 'b' }),
  ]
  const newBlocks = [
    block('b1', { componentType: 'Box' }),
    block('b1.1', { parentBlockId: 'b1', title: 'a' }),
    block('b1.2', { parentBlockId: 'b1', title: 'a' }),
    block('b1.3', { parentBlockId: 'b1', title: 'b' }),
  ]
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, [op({ op: 'duplicate', blockId: 'b1.1' })])
  const remapped = remapNestedOrder({ nestedOrder: { b1: ['b1.2', 'b1.1'] }, mapping: mapping.mapping, newBlocks })
  assert.deepEqual(remapped.nestedOrder, { b1: ['b1.3', 'b1.1', 'b1.2'] })
  assert.equal(remapped.nestedOrderChanged, true)
})
