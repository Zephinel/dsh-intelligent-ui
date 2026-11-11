/**
 * Unit tests for the M2 version-bar item merge and the FLIP geometry helpers.
 *
 * Run: node --test test/client/version-items.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_VERSION_BAR_ITEMS, buildVersionItems } from '../../src/client/artifact-edit/version-items.ts'
import { STAGE_FLIP_DURATION_MS, interpolateFlipRect, rectOf } from '../../src/client/artifact-edit/stage-flip.ts'

/** One Host history row fixture. */
function historyRow(revision, overrides = {}) {
  return {
    revisionId: `rev-${revision}`,
    revision,
    source: 'edit',
    createdAt: 1000 + revision,
    hasProgram: true,
    ...overrides,
  }
}

test('items merge history, local and known revisions newest first', () => {
  const { items, total } = buildVersionItems({
    history: [historyRow(3), historyRow(2), historyRow(1, { source: 'initial' })],
    local: [{ revisionId: 'local-4', revision: 4, kind: 'structure', createdAt: 2000 }],
    known: new Map([['rev-5', { revisionId: 'rev-5', revision: 5 }]]),
    selectedRevisionId: 'local-4',
    draftRevisionIds: new Set(['rev-2']),
  })
  assert.equal(total, 5)
  assert.deepEqual(items.map(item => item.revision), [5, 4, 3, 2, 1])
  assert.equal(items[0].current, false)
  assert.equal(items[1].current, true, 'the selected revision is marked current')
  assert.equal(items[1].local, true, 'local revision cards are flagged')
  assert.equal(items[3].draft, true, 'the drafted revision is marked')
  assert.equal(items[4].source, 'initial')
  assert.equal(items[1].source, 'structure')
})

test('style-switch structure revisions get their own source token', () => {
  const { items } = buildVersionItems({
    history: [historyRow(2, { revisionId: 'struct_abc123', source: 'structure', editedBlockIds: [] })],
  })
  assert.equal(items[0].source, 'style')
  const operation = buildVersionItems({ history: [historyRow(2, { revisionId: 'rev-2', source: 'structure', editedBlockIds: ['b1'] })] })
  assert.equal(operation.items[0].source, 'structure')
})

test('a local props kind keeps its specific source over the Host structure label', () => {
  // A props quick-adjust is recorded by the Host as a `struct_` structure
  // revision with no edited blocks, which historyBarSource alone would call a
  // style switch; the client-local card knows it was a props adjustment.
  const { items } = buildVersionItems({
    history: [historyRow(2, { revisionId: 'struct_a1b2c3', source: 'structure', editedBlockIds: [] })],
    local: [{ revisionId: 'struct_a1b2c3', revision: 2, kind: 'props', createdAt: 7 }],
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].source, 'props', 'the local props kind wins over the generic structure label')
})

test('a store-known props revision upgrades a disabled history row with its kind', () => {
  const { items } = buildVersionItems({
    history: [historyRow(2, { revisionId: 'struct_d4e5f6', source: 'structure', editedBlockIds: [], hasProgram: false })],
    known: new Map([['struct_d4e5f6', { revisionId: 'struct_d4e5f6', revision: 2, localRevision: true, localRevisionKind: 'props' }]]),
  })
  assert.equal(items[0].hasProgram, true)
  assert.equal(items[0].source, 'props', 'the known local kind also keeps the props label')
})

test('history metadata wins over a local/known duplicate but program availability adds up', () => {
  const { items } = buildVersionItems({
    history: [historyRow(2, { hasProgram: false, createdAt: 42 })],
    local: [{ revisionId: 'rev-2', revision: 2, kind: 'restore', createdAt: 999 }],
    known: new Map([['rev-2', { revisionId: 'rev-2', revision: 2 }]]),
  })
  assert.equal(items.length, 1)
  assert.equal(items[0].hasProgram, true, 'a local/known duplicate makes the revision selectable')
  assert.equal(items[0].createdAt, 42, 'the recorded history time wins')
  assert.equal(items[0].source, 'edit', 'the recorded history source wins')
  assert.equal(items[0].local, true)
})

test('the bar caps items at the recent limit and reports the remainder', () => {
  const history = Array.from({ length: 25 }, (_, index) => historyRow(25 - index))
  const { items, total } = buildVersionItems({ history })
  assert.equal(MAX_VERSION_BAR_ITEMS, 20)
  assert.equal(total, 25)
  assert.equal(items.length, 20)
  assert.equal(items[0].revision, 25)
  assert.equal(items[19].revision, 6)
})

test('a custom limit is honoured and local revisions can be flagged selectable', () => {
  const { items } = buildVersionItems({
    history: [historyRow(2), historyRow(1, { source: 'initial' })],
    local: [{ revisionId: 'local-3', revision: 3, createdAt: 1 }],
    limit: 2,
  })
  assert.deepEqual(items.map(item => item.revision), [3, 2])
  assert.equal(items[0].hasProgram, true)
  assert.equal(items[0].source, 'restore')
})

test('FLIP rectangles interpolate linearly and clamp progress', () => {
  const from = { left: 10, top: 20, width: 100, height: 50 }
  const to = { left: 110, top: 120, width: 400, height: 250 }
  assert.deepEqual(interpolateFlipRect(from, to, 0), from)
  assert.deepEqual(interpolateFlipRect(from, to, 1), to)
  assert.deepEqual(interpolateFlipRect(from, to, 0.5), { left: 60, top: 70, width: 250, height: 150 })
  assert.deepEqual(interpolateFlipRect(from, to, -1), from, 'negative progress clamps')
  assert.deepEqual(interpolateFlipRect(from, to, 2), to, 'overflow progress clamps')
  assert.deepEqual(interpolateFlipRect(from, to, Number.NaN), from, 'invalid progress falls back to the start')
  assert.equal(STAGE_FLIP_DURATION_MS > 0 && STAGE_FLIP_DURATION_MS <= 400, true)
})

test('rectOf copies only geometry fields', () => {
  assert.deepEqual(rectOf({ left: 1, top: 2, width: 3, height: 4, x: 1, y: 2, bottom: 6, right: 4 }), { left: 1, top: 2, width: 3, height: 4 })
})

test('a store-known revision stays selectable even when the history row reports no program', () => {
  const { items } = buildVersionItems({
    history: [historyRow(2, { hasProgram: false }), historyRow(1)],
    known: new Map([['rev-2', { revisionId: 'rev-2', revision: 2 }]]),
  })
  assert.equal(items[0].hasProgram, true, 'the known program upgrades the disabled history row')
  assert.equal(items[0].source, 'edit', 'history metadata still wins for the source')
})
