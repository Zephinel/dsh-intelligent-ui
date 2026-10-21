/**
 * Unit tests for the image-export geometry and file-name helpers.
 *
 * Run: node --test test/client/export-image-plan.test.mjs
 *
 * The module is imported as TypeScript source: Node >= 22.18 strips type
 * annotations natively, so the test needs no build step.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  beautifyPlan,
  composeBox,
  exportScaleFactor,
  fileStem,
  imageFileName,
} from '../../src/client/export-image-plan.ts'

test('1x and 2x map to device factors', () => {
  assert.equal(exportScaleFactor('1x'), 1)
  assert.equal(exportScaleFactor('2x'), 2)
})

test('each frame keeps the same proportions at both scales', () => {
  const raw = beautifyPlan('raw', 1)
  assert.deepEqual(raw, { padding: 0, radius: 0, shadow: null })
  assert.deepEqual(beautifyPlan('raw', 2), raw)

  const rounded = beautifyPlan('rounded', 1)
  assert.equal(rounded.padding, 24)
  assert.equal(rounded.radius, 20)
  assert.equal(rounded.shadow, null)
  assert.deepEqual(beautifyPlan('rounded', 2), { padding: 48, radius: 40, shadow: null })

  const card = beautifyPlan('card', 1)
  assert.equal(card.padding, 32)
  assert.equal(card.radius, 24)
  assert.deepEqual(card.shadow, { blur: 24, offsetY: 8, color: 'rgba(0, 0, 0, 0.18)' })
  assert.deepEqual(beautifyPlan('card', 2), {
    padding: 64,
    radius: 48,
    shadow: { blur: 48, offsetY: 16, color: 'rgba(0, 0, 0, 0.18)' },
  })
})

test('the composed canvas reserves room for the frame shadow', () => {
  const raw = composeBox(100, 50, beautifyPlan('raw', 1))
  assert.deepEqual(raw, {
    canvasWidth: 100,
    canvasHeight: 50,
    backgroundX: 0,
    backgroundY: 0,
    backgroundWidth: 100,
    backgroundHeight: 50,
    contentX: 0,
    contentY: 0,
  })

  const rounded = composeBox(100, 50, beautifyPlan('rounded', 1))
  assert.equal(rounded.canvasWidth, 148)
  assert.equal(rounded.canvasHeight, 98)
  assert.equal(rounded.backgroundWidth, 148)
  assert.equal(rounded.contentX, 24)

  // Card 1x: padding 32 + shadow bleed ceil(24 + 8 + 2) = 34 per side.
  const card = composeBox(100, 50, beautifyPlan('card', 1))
  assert.deepEqual(card, {
    canvasWidth: 100 + 64 + 68,
    canvasHeight: 50 + 64 + 68,
    backgroundX: 34,
    backgroundY: 34,
    backgroundWidth: 164,
    backgroundHeight: 114,
    contentX: 66,
    contentY: 66,
  })

  // The shadow must fit: the background inset is at least blur + offset.
  assert.ok(card.backgroundX >= 24 + 8, 'bleed covers the horizontal shadow')
  assert.ok(card.backgroundY >= 24 + 8, 'bleed covers the vertical shadow')
  const card2x = composeBox(200, 100, beautifyPlan('card', 2))
  assert.equal(card2x.canvasWidth - (200 + 128), 2 * 66, '2x doubles the shadow bleed')
})

test('file names stay filesystem-safe and readable', () => {
  assert.equal(fileStem(' Shanghai  itinerary '), 'Shanghai-itinerary')
  assert.equal(fileStem('销售/看板: 2026'), '销售-看板-2026')
  assert.equal(fileStem('a\\b*c?d"e<f>g|h'), 'a-b-c-d-e-f-g-h')
  assert.equal(fileStem(undefined), 'interactive-answer')
  assert.equal(fileStem('   '), 'interactive-answer')
  assert.equal(fileStem('x'.repeat(120)).length, 80)
})

test('the image file name carries a sortable local timestamp', () => {
  const title = 'Sales dashboard'
  const when = new Date(2026, 9, 22, 2, 3, 4)
  assert.equal(imageFileName(title, when), 'Sales-dashboard-20261022-020304.png')
  assert.match(imageFileName(undefined, when), /^interactive-answer-\d{8}-\d{6}\.png$/)
})
