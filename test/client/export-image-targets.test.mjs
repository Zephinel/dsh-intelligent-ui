/**
 * Unit tests for the version-aware image-export capture planner and the vertical
 * stacking geometry used when one Turn resolves to several stage cards.
 *
 * Run: node --test test/client/export-image-targets.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_CAPTURABLE_STAGE_MESSAGE, planExportCapture } from '../../src/client/export-image-targets.ts'
import { stackBoxes } from '../../src/client/export-image-plan.ts'

/** Minimal stand-in for a DOM element; the planner only compares identity. */
function element(name) {
  return { name }
}

test('a pre-version card list keeps the legacy container capture', () => {
  const card = element('card')
  assert.deepEqual(planExportCapture([{ element: card, kind: 'card' }], () => null), { kind: 'container' })
  assert.deepEqual(planExportCapture([], () => null), { kind: 'container' })
})

test('notices resolve to their artifact stage cards in first-appearance order', () => {
  const noticeA = element('notice-a')
  const noticeB = element('notice-b')
  const stageA = element('stage-a')
  const stageB = element('stage-b')
  const stages = new Map([['art-a', stageA], ['art-b', stageB]])
  const plan = planExportCapture([
    { element: noticeB, artifactId: 'art-b', kind: 'notice' },
    { element: noticeA, artifactId: 'art-a', kind: 'notice' },
    { element: element('notice-a-2'), artifactId: 'art-a', kind: 'notice' },
  ], id => stages.get(id))
  assert.equal(plan.kind, 'elements')
  assert.deepEqual(plan.elements.map(entry => entry.name), ['stage-b', 'stage-a'], 'order follows the Turn and artifacts dedupe')
})

test('without a mounted stage a full local card of the same Turn is captured', () => {
  const localCard = element('local-card')
  const plan = planExportCapture([
    { element: element('other-notice'), artifactId: 'art-a', kind: 'notice' },
    { element: localCard, artifactId: 'art-a', kind: 'card' },
  ], () => null)
  assert.equal(plan.kind, 'elements')
  assert.deepEqual(plan.elements.map(entry => entry.name), ['local-card'])
})

test('a notice-only artifact without a stage is a hard error, never a stale export', () => {
  const plan = planExportCapture([{ element: element('notice'), artifactId: 'art-a', kind: 'notice' }], () => null)
  assert.deepEqual(plan, { kind: 'error', message: NO_CAPTURABLE_STAGE_MESSAGE })
})

test('legacy cards mixed into a versioned Turn keep their position', () => {
  const localCard = element('local-card')
  const legacy = element('legacy')
  const stage = element('stage')
  const plan = planExportCapture([
    { element: element('notice'), artifactId: 'art-a', kind: 'notice' },
    { element: localCard, artifactId: 'art-a', kind: 'card' },
    { element: legacy, kind: 'card' },
    { element: stage, artifactId: 'art-b', kind: 'card' },
  ], id => id === 'art-b' ? stage : null)
  assert.equal(plan.kind, 'elements')
  assert.deepEqual(plan.elements.map(entry => entry.name), ['local-card', 'legacy', 'stage'])
})

test('stack geometry lays captures out vertically with one gap', () => {
  assert.deepEqual(stackBoxes([{ width: 100, height: 40 }, { width: 80, height: 30 }], 12), {
    width: 100,
    height: 40 + 12 + 30,
    offsets: [0, 52],
  })
  assert.deepEqual(stackBoxes([], 12), { width: 0, height: 0, offsets: [] })
  assert.deepEqual(stackBoxes([{ width: 10, height: 10 }], 12), { width: 10, height: 10, offsets: [0] })
})
