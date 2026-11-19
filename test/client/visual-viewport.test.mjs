/**
 * Visual-viewport fitting for custom fixed overlays. The integration is
 * exercised by the browser suite/manual GUI pass; this pins the arithmetic.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fitFixedBox, visualViewportBounds } from '../../src/client/visual-viewport.ts'

const originalWindow = globalThis.window

function withWindow(value) {
  globalThis.window = value
}

test('visualViewportBounds reports the visible layout-coordinate region', () => {
  withWindow({
    innerWidth: 1400,
    innerHeight: 857,
    visualViewport: { offsetLeft: 374, offsetTop: 171, width: 933.3333, height: 571.3333 },
  })
  try {
    const bounds = visualViewportBounds(8)
    assert.equal(bounds.left, 382)
    assert.equal(bounds.top, 179)
    assert.equal(bounds.right, 382 + (933.3333 - 16))
    assert.equal(bounds.width, 933.3333 - 16)
    assert.equal(bounds.height, 571.3333 - 16)
  } finally {
    globalThis.window = originalWindow
  }
})

test('fitFixedBox keeps a tall panel inside the visual viewport', () => {
  withWindow({
    innerWidth: 1400,
    innerHeight: 857,
    visualViewport: { offsetLeft: 374, offsetTop: 171, width: 933.3333, height: 571.3333 },
  })
  try {
    const fitted = fitFixedBox({ left: 1000, top: 12, width: 460, maxHeight: 600 }, 8)
    assert.equal(fitted.left, 933.3333 - 16 - 460 + 382, 'left is clamped so the right edge stays visible')
    assert.equal(fitted.top, 179, 'a panel fully above the visual viewport is moved to its top edge')
    assert.equal(fitted.width, 460)
    assert.equal(fitted.maxHeight, 571.3333 - 16, 'the remaining visible height caps the panel')
  } finally {
    globalThis.window = originalWindow
  }
})

test('fitFixedBox falls back to the layout viewport when visualViewport is absent', () => {
  withWindow({ innerWidth: 800, innerHeight: 600 })
  try {
    const bounds = visualViewportBounds(10)
    assert.deepEqual(bounds, { left: 10, top: 10, right: 790, bottom: 590, width: 780, height: 580 })
    const fitted = fitFixedBox({ left: 900, top: 700, width: 500, maxHeight: 400 }, 10)
    assert.equal(fitted.left, 290)
    assert.equal(fitted.top, 510)
    assert.equal(fitted.maxHeight, 80)
  } finally {
    globalThis.window = originalWindow
  }
})
