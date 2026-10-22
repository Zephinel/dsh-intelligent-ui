#!/usr/bin/env node
/**
 * Browser E2E for the composer style panel (component level).
 *
 * Builds `test/browser/harness/entry.tsx`, serves it from a temporary directory,
 * starts headless Chrome with CDP, and drives the real DOM:
 * chip -> menu -> This session only -> style panel -> slider -> Escape.
 *
 * Chrome is required; set CHROME_BIN to override the macOS default. The test is
 * intentionally outside `npm run check` so CI needs no browser.
 *
 *   npm run test:browser
 */
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-style-e2e-'))
const bundle = join(temp, 'bundle.js')
let server
let browser
let cdp

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/entry.tsx')],
    outfile: bundle,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
    jsx: 'automatic',
    absWorkingDir: root,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })

  await copyFile(join(root, 'src/client/index.css'), join(temp, 'index.css'))
  await writeFile(join(temp, 'index.html'), html(), 'utf8')
  server = await startStaticServer(temp)
  browser = await launchChrome({ url: `${server.url}index.html`, width: 900, height: 900 })
  if (browser === null) {
    console.log('style-panel E2E: skipped (Chrome not found; set CHROME_BIN)')
    process.exitCode = 0
    await cleanup()
    process.exit()
  }
  cdp = await connectCdp(browser.port)

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.waitFor('document.readyState === "complete"', 'load')
  await cdp.waitFor('!!document.querySelector("[data-dsh-iui-toggle]")', 'chip')

  const initial = await cdp.evaluate(`(() => { const b=document.querySelector('[data-dsh-iui-toggle]'); return { state:b.dataset.state, label:b.textContent.trim(), aria:b.getAttribute('aria-label') } })()`)
  assert.equal(initial.state, 'inherit')
  assert.match(initial.label, /UI: Follow global/)
  assert.equal(initial.aria, 'Intelligent UI: follow global')

  await cdp.evaluate('document.querySelector("[data-dsh-iui-toggle]").click()')
  await cdp.waitFor('!!document.querySelector("[role=menu]")', 'menu')
  // Let the chip's chevron rotation finish before measuring it.
  await cdp.waitFor(`(() => {
    const matrix = new DOMMatrix(getComputedStyle(document.querySelector('.dsh-iui-chevron')).transform)
    return Math.abs(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI) > 170
  })()`, 'chevron rotated up')
  const menu = await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].map(b => b.textContent.trim())')
  assert.ok(!menu.some(item => /All sessions|全部会话/.test(item)), 'All sessions must be absent')
  assert.ok(menu.some(item => /Display style|显示样式/.test(item)), 'Display style entry must exist')

  const layout = await cdp.evaluate(`(() => {
    const root = document.querySelector('[role=menu]')
    const rect = root.getBoundingClientRect()
    const rows = [...root.querySelectorAll('[role=menuitem]')].map(row => row.getBoundingClientRect())
    const divider = root.querySelector('.dsh-iui-menu-divider')?.getBoundingClientRect()
    const chip = document.querySelector('[data-dsh-iui-toggle]')
    const chipRect = chip.getBoundingClientRect()
    const chipStyle = getComputedStyle(chip)
    const chevron = chip.querySelector('.dsh-iui-chevron')
    return {
      width: Math.round(rect.width),
      left: Math.round(rect.left),
      rightGap: Math.round(chipRect.right - rect.right),
      rowHeights: rows.map(row => Math.round(row.height)),
      divider: divider === undefined ? null : {
        insetLeft: Math.round(divider.left - rect.left),
        insetRight: Math.round(rect.right - divider.right),
      },
      chipRadius: chipStyle.borderRadius,
      chipBackground: chipStyle.backgroundColor,
      chipColor: chipStyle.color,
      chevronOpen: chevron.dataset.open,
      chevronRotation: (() => {
        const matrix = new DOMMatrix(getComputedStyle(chevron).transform)
        return Math.round(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI)
      })(),
      wraps: [...root.querySelectorAll('.dsh-iui-menu-label, .dsh-iui-menu-hint')]
        .some(el => el.scrollWidth > el.clientWidth + 1),
    }
  })()`)
  assert.ok(layout.width >= 208 && layout.width < 320, 'the scope menu is content-sized with a comfortable minimum width')
  assert.equal(layout.rightGap, 0, 'the scope menu right edge aligns with the chip')
  assert.ok(layout.left >= 0, 'the right-aligned menu stays inside the viewport')
  assert.ok(layout.rowHeights.every(height => height >= 40), 'menu rows keep the shared vertical rhythm')
  assert.ok(layout.divider !== null, 'a divider separates the Display style row')
  assert.ok(layout.divider.insetLeft >= 8 && layout.divider.insetRight >= 8, 'the divider is inset from the menu edges')
  assert.equal(layout.chipRadius, '6px', 'the chip uses the native composer radius token')
  assert.equal(layout.chipBackground, 'rgb(46, 46, 46)', 'the open chip uses the native hover fill')
  assert.equal(layout.chipColor, 'rgb(184, 184, 184)', 'the chip label uses the native secondary label color')
  assert.equal(layout.chevronOpen, 'true', 'the open chip reports an open chevron')
  assert.ok(Math.abs(layout.chevronRotation) > 170, 'the open chip points its chevron up once (180deg)')
  assert.equal(layout.wraps, false, 'menu labels and hints stay on one line')

  // The explicit Display style row must open the panel while the chip stays on
  // Follow global; this is the route that does not require an `on` override.
  await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(b => /Display style|显示样式/.test(b.textContent)).click()')
  await cdp.waitFor('!!document.querySelector("[data-dsh-iui-style-panel]")', 'style panel via Display style')
  const route = await cdp.evaluate(`(() => { const b=document.querySelector('[data-dsh-iui-toggle]'); return { state:b.dataset.state, label:b.textContent.trim() } })()`)
  assert.equal(route.state, 'inherit', 'Display style must not change the enable scope')
  assert.match(route.label, /Follow global/, 'the chip must stay on Follow global')

  // Back goes one level up (scope menu), it does not dismiss every popup.
  await cdp.evaluate('document.querySelector(".dsh-iui-style-back").click()')
  await cdp.waitFor('!document.querySelector("[data-dsh-iui-style-panel]") && !!document.querySelector("[role=menu]")', 'back returned to the scope menu')
  const afterBack = await cdp.evaluate(`(() => {
    const chip = document.querySelector('[data-dsh-iui-toggle]')
    return {
      state: chip.dataset.state,
      label: chip.textContent.trim(),
      items: document.querySelectorAll('[role=menuitem]').length,
      focusBackOnStyle: document.activeElement?.getAttribute('data-style-entry') === 'true',
    }
  })()`)
  assert.equal(afterBack.state, 'inherit', 'back must not change the enable scope')
  assert.match(afterBack.label, /Follow global/)
  assert.ok(afterBack.items >= 4, 'back lands on the full scope menu')
  assert.equal(afterBack.focusBackOnStyle, true, 'back restores focus to the Display style row')
  await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(b => /Display style|显示样式/.test(b.textContent)).click()')
  await cdp.waitFor('!!document.querySelector("[data-dsh-iui-style-panel]")', 'style panel reopened from the menu')
  await cdp.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await cdp.waitFor('!document.querySelector("[data-dsh-iui-style-panel]")', 'style panel closed after route check')
  await cdp.evaluate('document.querySelector("[data-dsh-iui-toggle]").click()')
  await cdp.waitFor('!!document.querySelector("[role=menu]")', 'menu reopened')

  await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(b => b.textContent.includes("This session only")).click()')
  await cdp.waitFor('!!document.querySelector("[data-dsh-iui-style-panel]")', 'style panel')

  const panel = await cdp.evaluate(`(() => { const p=document.querySelector('[data-dsh-iui-style-panel]'); const r=p.getBoundingClientRect(); const a=document.activeElement; return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, vw:innerWidth, vh:innerHeight, focusInside:p.contains(a), focusTag:a?.tagName } })()`)
  assert.ok(panel.top >= 0 && panel.bottom <= panel.vh && panel.left >= 0 && panel.right <= panel.vw, 'panel must be inside the viewport')
  assert.equal(panel.focusInside, true, 'focus must move into the panel')

  // Drive the real range input through an input event + pointerup so a
  // multi-stop gesture commits only at the end.
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.dsh-iui-slider-input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '2')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await new Promise(resolve => setTimeout(resolve, 60))
  await cdp.evaluate(`document.querySelector('.dsh-iui-slider-input').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`)
  await cdp.waitFor('window.__calls.includes("style:article")', 'style slider command')
  assert.deepEqual(await cdp.evaluate('window.__calls'), ['enable:on', 'style:article'])

  await cdp.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await cdp.waitFor('!document.querySelector("[data-dsh-iui-style-panel]")', 'panel closed')
  const afterClose = await cdp.evaluate('document.activeElement?.dataset?.dshIuiToggle')
  assert.equal(afterClose, 'true', 'focus must return to the chip')
  await cdp.waitFor('getComputedStyle(document.querySelector(".dsh-iui-chevron")).transform === "none"', 'chevron rotation finished')
  const closedChevron = await cdp.evaluate('getComputedStyle(document.querySelector(".dsh-iui-chevron")).transform')
  assert.equal(closedChevron, 'none', 'the closed chip points its chevron down')

  // Switching Intelligent UI off keeps the Display style row visible but
  // disabled, and the divider still separates it from the scope rows.
  await cdp.evaluate('window.__setEnabled(false)')
  await cdp.waitFor('document.querySelector("[data-dsh-iui-toggle]").dataset.state === "off"', 'chip off')
  await cdp.evaluate('document.querySelector("[data-dsh-iui-toggle]").click()')
  await cdp.waitFor('!!document.querySelector("[role=menu]")', 'disabled menu')
  const disabled = await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[role=menuitem]')]
    const style = rows.find(row => /Display style|显示样式/.test(row.textContent))
    return {
      stylePresent: style !== undefined,
      disabled: style?.disabled === true,
      ariaDisabled: style?.getAttribute('aria-disabled') === 'true',
      dividers: document.querySelectorAll('.dsh-iui-menu-divider').length,
    }
  })()`)
  assert.equal(disabled.stylePresent, true, 'Display style stays visible while off')
  assert.equal(disabled.disabled, true, 'Display style is disabled while off')
  assert.equal(disabled.ariaDisabled, true, 'the disabled row is announced')
  assert.equal(disabled.dividers, 1, 'the divider remains above the disabled row')
  await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(b => /Display style|显示样式/.test(b.textContent)).click()')
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(await cdp.evaluate('!!document.querySelector("[data-dsh-iui-style-panel]")'), false, 'a disabled row cannot open the panel')
  console.log('style-panel E2E: OK')
} finally {
  await cleanup()
}

/** Static harness HTML with the DSH aliases the chrome needs. */
function html() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="./index.css">
<style>
  :root { color-scheme: dark; --dsw-alias-bg-layer-1:#1b1b1b; --dsw-alias-bg-layer-2:#242424;
    --dsw-alias-border-l1:#323232; --dsw-alias-border-l2:#3c3c3c; --dsw-alias-border-l3:#505050;
    --dsw-alias-label-primary:#f2f2f2; --dsw-alias-label-secondary:#b8b8b8; --dsw-alias-label-tertiary:#8b8b8b;
    --dsw-alias-label-dimmed:#666; --dsw-alias-label-primary-foreground:#111; --dsw-alias-interactive-bg-hover:#2e2e2e;
    --dsw-alias-state-business-primary:#6aa9ff; --dsw-alias-brand-primary:#6aa9ff; --dsw-alias-state-error-primary:#ff7b72;
    --dsw-radius-sm:6px; --dsw-radius-md:10px; --dsw-radius-lg:14px; --dsw-focus-ring-width:2px; --dsw-focus-ring-color:#6aa9ff; }
  html,body{margin:0;width:100%;height:100%;background:#111;color:#eee;font-family:system-ui,sans-serif}
  body{display:flex;align-items:flex-end} #root{position:fixed;right:24px;bottom:28px}
</style></head><body><div id="root"></div><script type="module" src="./bundle.js"></script></body></html>`
}

/** Stop Chrome and the static server, and remove the temp directory. */
async function cleanup() {
  try { cdp?.close() } catch { /* ignore */ }
  await browser?.cleanup()
  try { server?.close() } catch { /* ignore */ }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
