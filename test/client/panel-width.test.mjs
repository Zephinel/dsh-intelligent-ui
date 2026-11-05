/**
 * Unit tests for the B1-5 edit-panel chat width fitter.
 *
 * Run: node --test test/client/panel-width.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyEditChatContentWidth,
  CHAT_CONTENT_SELECTOR,
  CHAT_CONTENT_WIDTH_VAR,
  CONTENT_WIDTH_ANIMATION_MS,
  DEFAULT_CHAT_CONTENT_WIDTH,
  EDIT_PANEL_MEDIA_QUERY,
  EDIT_PANEL_RIGHT_INSET,
  easeContentWidth,
  fitChatContentWidth,
} from '../../src/client/artifact-edit/panel-width.ts'

/** Docked panel width for one content width, mirroring the CSS clamp. */
function panelWidthFor(viewportWidth, contentWidth, panelMin = 272, panelMax = 360) {
  return Math.min(Math.max((viewportWidth - contentWidth) / 2 + 16, panelMin), panelMax)
}

test('the reported default viewport narrows the content so the panel does not overlap', () => {
  const desired = fitChatContentWidth({ viewportWidth: 1440, contentWidth: 748 })
  assert.equal(desired, 672)
  // 672 content + two 360px panels + two 24px gaps fills the 1440 viewport.
  const panel = panelWidthFor(1440, desired)
  assert.equal(desired + 2 * (panel + 24), 1440)
})

test('a wide viewport with a wide user preference converges to a safe width', () => {
  // Task sample mentioned ~1804; the stated fixed-point formulas converge to
  // 1780 (panel 360, gap 24 on both sides). 1804 would need a different gap
  // accounting, so the deterministic value is asserted here.
  const desired = fitChatContentWidth({ viewportWidth: 2548, contentWidth: 1900 })
  assert.equal(desired, 1780)
  const panel = panelWidthFor(2548, desired)
  assert.equal(panel, 360)
  assert.ok(desired + 2 * (panel + 24) <= 2548 + 0.5)
  assert.ok(desired < 1900)
})

test('the 1180px breakpoint still converges to a positive usable width', () => {
  const desired = fitChatContentWidth({ viewportWidth: 1180, contentWidth: 748 })
  assert.equal(desired, 412)
  assert.ok(desired > 0)
  const panel = panelWidthFor(1180, desired)
  assert.equal(desired + 2 * (panel + 24), 1180)
})

test('the floating panel right inset reserves its 12px and narrows further', () => {
  // Default (inset 0) stays 672. The content stays centered, so a 12px panel
  // inset costs half of the available width on each side: the fitted content
  // loses 2 * 12px: 1440 - 24 - 2 * 384 = 648.
  assert.equal(fitChatContentWidth({ viewportWidth: 1440, contentWidth: 748, panelRightInset: 0 }), 672)
  assert.equal(fitChatContentWidth({ viewportWidth: 1440, contentWidth: 748, panelRightInset: 12 }), 648)
  assert.equal(fitChatContentWidth({ viewportWidth: 1800, contentWidth: 1520, panelRightInset: 12 }), 1008)
  // A preferred width that already fits stays untouched even with the inset.
  assert.equal(fitChatContentWidth({ viewportWidth: 1800, contentWidth: 920, panelRightInset: 12 }), 920)
})

test('a viewport with room for the preferred width is left unchanged', () => {
  assert.equal(fitChatContentWidth({ viewportWidth: 4000, contentWidth: 748 }), 748)
  assert.equal(fitChatContentWidth({ viewportWidth: 2000, contentWidth: 600 }), 600)
})

test('a too-small viewport returns the preferred width instead of forcing a squeeze', () => {
  // minContent + two (panelMin + gap) = 360 + 2 * 296 = 952; below that the
  // docked layout cannot fit, so the shell width is left alone.
  assert.equal(fitChatContentWidth({ viewportWidth: 600, contentWidth: 748 }), 748)
  assert.equal(fitChatContentWidth({ viewportWidth: 951, contentWidth: 748 }), 748)
})

test('minContent is a hard lower bound for the fitted width', () => {
  assert.equal(fitChatContentWidth({ viewportWidth: 1440, contentWidth: 748, minContent: 700 }), 700)
  // The default floor stays below every usable wide-breakpoint result.
  assert.equal(fitChatContentWidth({ viewportWidth: 1180, contentWidth: 748, minContent: 360 }), 412)
})

test('the fitted width never overlaps the docked panel across common viewports', () => {
  for (const viewportWidth of [1180, 1200, 1280, 1366, 1440, 1600, 1920, 2548]) {
    const preferred = 1900
    const desired = fitChatContentWidth({ viewportWidth, contentWidth: preferred })
    assert.ok(Number.isFinite(desired) && desired > 0, `width at ${viewportWidth}`)
    if (desired === preferred) continue
    const panel = panelWidthFor(viewportWidth, desired)
    assert.ok(
      desired + 2 * (panel + 24) <= viewportWidth + 0.5,
      `content ${desired} + panels ${panel} overflow ${viewportWidth}`,
    )
  }
})

test('invalid sizes are passed through unchanged', () => {
  assert.equal(fitChatContentWidth({ viewportWidth: 0, contentWidth: 748 }), 748)
  assert.equal(fitChatContentWidth({ viewportWidth: -100, contentWidth: 748 }), 748)
  assert.equal(fitChatContentWidth({ viewportWidth: 1440, contentWidth: 0 }), 0)
  assert.equal(fitChatContentWidth({ viewportWidth: Number.NaN, contentWidth: 748 }), 748)
})

test('the shared animation easing matches the CSS panel curve', () => {
  assert.equal(CONTENT_WIDTH_ANIMATION_MS, 220)
  assert.equal(easeContentWidth(0), 0)
  assert.equal(easeContentWidth(1), 1)
  assert.equal(easeContentWidth(-1), 0)
  assert.equal(easeContentWidth(2), 1)
  // Ease-out: monotonic, and more than half the distance at the midpoint.
  let previous = 0
  for (const progress of [0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const eased = easeContentWidth(progress)
    assert.ok(eased >= previous, `easing is monotonic at ${progress}`)
    assert.ok(eased >= 0 && eased <= 1, `easing stays in range at ${progress}`)
    previous = eased
  }
  assert.ok(easeContentWidth(0.5) > 0.5)
  assert.ok(easeContentWidth(0.3) > easeContentWidth(0.2))
})

test('the controller animates content between the base and fitted widths', () => {
  const previousObserver = globalThis.MutationObserver
  globalThis.MutationObserver = undefined
  try {
    const frames = []
    let frameId = 0
    let now = 0
    const elementStyle = {
      values: new Map(),
      getPropertyValue(name) { return this.values.get(name) ?? '' },
      getPropertyPriority() { return '' },
      setProperty(name, value) { this.values.set(name, String(value)) },
      removeProperty(name) { this.values.delete(name) },
    }
    const parentStyle = {
      getPropertyValue() { return '' },
    }
    const element = {
      style: elementStyle,
      parentElement: { style: parentStyle },
      getBoundingClientRect: () => ({ left: 0, width: 1440, top: 0, height: 0 }),
    }
    const win = {
      innerWidth: 1440,
      getComputedStyle: () => ({ getPropertyValue: () => '900px' }),
      matchMedia: query => ({ matches: query.includes('prefers-reduced-motion') ? false : true }),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      cancelAnimationFrame: id => { const index = frames.findIndex(entry => entry.id === id); if (index >= 0) frames.splice(index, 1) },
      requestAnimationFrame: callback => { frameId += 1; frames.push({ id: frameId, callback }); return frameId },
      performance: { now: () => now },
    }
    const doc = { querySelector: () => element }
    const controller = applyEditChatContentWidth(win, doc)
    const widthNow = () => Number.parseFloat(elementStyle.getPropertyValue('--dsh-chat-content-width'))
    assert.equal(widthNow(), 900)
    const runFrame = at => {
      now = at
      const pending = frames.splice(0)
      for (const entry of pending) entry.callback(now)
    }
    runFrame(0)
    assert.ok(Math.abs(widthNow() - 900) < 0.5, 'animation starts at the base width')
    runFrame(CONTENT_WIDTH_ANIMATION_MS / 2)
    const middle = widthNow()
    assert.ok(middle < 900 && middle > 648, `mid animation ${middle} sits between fitted and base`)
    runFrame(CONTENT_WIDTH_ANIMATION_MS)
    assert.ok(Math.abs(widthNow() - 648) < 0.5, 'animation ends at the fitted width')
    controller.close()
    runFrame(CONTENT_WIDTH_ANIMATION_MS + CONTENT_WIDTH_ANIMATION_MS / 2)
    const closingMiddle = widthNow()
    assert.ok(closingMiddle > 648 && closingMiddle < 900, 'closing animates back toward the base')
    runFrame(CONTENT_WIDTH_ANIMATION_MS * 2)
    assert.ok(Math.abs(widthNow() - 900) < 0.5, 'closing ends at the base width')
    controller.dispose()
    assert.equal(elementStyle.getPropertyValue('--dsh-chat-content-width'), '', 'dispose removes the inline override')
  } finally {
    globalThis.MutationObserver = previousObserver
  }
})

test('exposes the DOM contract constants used by the panel effect', () => {
  assert.equal(EDIT_PANEL_MEDIA_QUERY, '(min-width: 1180px)')
  assert.equal(EDIT_PANEL_RIGHT_INSET, 12)
  assert.equal(CHAT_CONTENT_SELECTOR, '[data-conversation-content][data-conversation-region="chat"]')
  assert.equal(CHAT_CONTENT_WIDTH_VAR, '--dsh-chat-content-width')
  assert.equal(DEFAULT_CHAT_CONTENT_WIDTH, 748)
})

test('accounts for the sidebar offset and conversation column width', () => {
  // 1800px viewport, 280px sidebar, 1520px conversation column: a centered
  // 920px card would run under the 360px docked panel, so it must shrink to
  // keep a 24px gap (content right edge 1416, panel left 1440).
  assert.equal(fitChatContentWidth({
    viewportWidth: 1800,
    contentWidth: 920,
    columnLeft: 280,
    columnWidth: 1520,
  }), 752)
  // The same viewport with no sidebar offset needs a wider content column.
  assert.equal(fitChatContentWidth({ viewportWidth: 1800, contentWidth: 920 }), 920)
  // A wider user preference still converges to the column-aware fixed point.
  assert.equal(fitChatContentWidth({
    viewportWidth: 1928,
    contentWidth: 930,
    columnLeft: 280,
    columnWidth: 1648,
  }), 880)
})
