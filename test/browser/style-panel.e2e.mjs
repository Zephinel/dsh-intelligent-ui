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
  assert.match(initial.label, /UI: All sessions/)
  assert.equal(initial.aria, 'Intelligent UI: all sessions')

  await cdp.evaluate('document.querySelector("[data-dsh-iui-toggle]").click()')
  await cdp.waitFor('!!document.querySelector("[role=menu]")', 'menu')
  // Let the chip's chevron rotation finish before measuring it.
  await cdp.waitFor(`(() => {
    const matrix = new DOMMatrix(getComputedStyle(document.querySelector('.dsh-iui-chevron')).transform)
    return Math.abs(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI) > 170
  })()`, 'chevron rotated up')
  const menu = await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].map(b => b.textContent.trim())')
  assert.ok(menu.some(item => /All sessions|全部会话/.test(item)), 'All sessions represents the existing inherit scope')
  assert.ok(menu.some(item => /Display style|显示样式/.test(item)), 'Display style entry must exist')

  await cdp.waitFor(`getComputedStyle(document.querySelector('[data-dsh-iui-toggle]')).backgroundColor === 'rgb(46, 46, 46)'`, 'chip hover transition settled')
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
  // All sessions (inherit); this is the route that does not require an `on` override.
  await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(b => /Display style|显示样式/.test(b.textContent)).click()')
  await cdp.waitFor('!!document.querySelector("[data-dsh-iui-style-panel]")', 'style panel via Display style')
  const route = await cdp.evaluate(`(() => { const b=document.querySelector('[data-dsh-iui-toggle]'); return { state:b.dataset.state, label:b.textContent.trim() } })()`)
  assert.equal(route.state, 'inherit', 'Display style must not change the enable scope')
  assert.match(route.label, /All sessions/, 'the chip must stay on All sessions')

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
  assert.match(afterBack.label, /All sessions/)
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
  const alignment = await cdp.evaluate(`(() => { const p=document.querySelector('[data-dsh-iui-style-panel]'); const c=document.querySelector('[data-dsh-iui-toggle]'); return { panelRight: p.getBoundingClientRect().right, chipRight: c.getBoundingClientRect().right } })()`)
  assert.ok(alignment.panelRight <= alignment.chipRight + 1, 'panel must not extend past the chip right edge')
  assert.ok(alignment.chipRight - alignment.panelRight <= 12, 'panel should be right-aligned with the chip')

  assert.equal(await cdp.evaluate('document.querySelectorAll("input[type=range], .dsh-iui-slider").length'), 0, 'the slider is removed')
  const picker = await cdp.evaluate(`(() => {
    const p = document.querySelector('[data-dsh-iui-style-panel]')
    return { width: p.getBoundingClientRect().width, title: p.querySelector('.dsh-iui-style-panel-title').textContent,
      scope: p.querySelector('.dsh-iui-style-panel-scope').textContent, builtins: p.querySelectorAll('.dsh-iui-style-previews button').length,
      custom: p.querySelectorAll('.dsh-iui-custom-card').length }
  })()`)
  assert.ok(picker.width >= 340 && picker.width <= 460)
  assert.equal(picker.title, 'Display style')
  assert.equal(picker.scope, 'This session only')
  assert.equal(picker.builtins, 3)
  assert.equal(picker.custom, 4)
  assert.equal(await cdp.evaluate('!!document.querySelector("[data-style-id=cs_free004] .dsh-iui-preview-art-free")'), true)
  assert.match(await cdp.evaluate('document.querySelector("[data-style-id=cs_free004]").textContent'), /Free layout/)

  // Composer exposes the same exchange surface as settings: global-only import,
  // plus portable export for both global and session-scoped templates.
  assert.equal(await cdp.evaluate('!!document.querySelector("[data-dsh-iui-style-panel] [data-dsh-iui-import]")'), true, 'composer import entry')
  await cdp.evaluate('document.querySelector("[data-dsh-iui-style-panel] [data-dsh-iui-import]").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-style-popover[role=dialog] textarea")', 'composer import dialog')
  await cdp.evaluate('[...document.querySelectorAll(".dsh-iui-style-popover[role=dialog] button")].find(b => b.textContent === "Cancel").click()')
  await cdp.waitFor('!document.querySelector(".dsh-iui-style-popover[role=dialog]") && !!document.querySelector("[data-dsh-iui-style-panel]")', 'composer import closed with panel retained')

  for (const id of ['cs_ocean01', 'cs_session3']) {
    await cdp.evaluate(`document.querySelector('[data-dsh-iui-manage=${id}]').click()`)
    await cdp.waitFor('!!document.querySelector(".dsh-iui-template-menu")', 'template menu')
    const items = await cdp.evaluate('[...document.querySelectorAll(".dsh-iui-template-menu [role=menuitem]")].map(b => b.textContent.trim())')
    assert.ok(items.includes('Export file'), 'export available for ' + id)
    await cdp.evaluate('[...document.querySelectorAll(".dsh-iui-template-menu [role=menuitem]")].find(b => b.textContent.trim() === "Export file").click()')
    await cdp.waitFor('!!document.querySelector(".dsh-iui-style-popover[role=dialog]")', 'export confirmation')
    assert.match(await cdp.evaluate('document.querySelector(".dsh-iui-style-popover[role=dialog]").textContent'), /sensitive text/)
    await cdp.evaluate('[...document.querySelectorAll(".dsh-iui-style-popover[role=dialog] button")].find(b => b.textContent === "Cancel").click()')
    await cdp.waitFor('!document.querySelector(".dsh-iui-style-popover[role=dialog]") && !!document.querySelector("[data-dsh-iui-style-panel]")', 'export cancelled with panel retained')
  }

  for (const value of ['article', 'auto', 'card', 'cs_ocean01', 'cs_field02', 'cs_free004']) {
    await cdp.waitFor(`!document.querySelector('[data-style-id="${value}"]').disabled`, 'picker enabled')
    await cdp.evaluate(`document.querySelector('[data-style-id="${value}"]').click()`)
    await cdp.waitFor(`document.querySelector('[data-style-id="${value}"]').getAttribute('aria-pressed') === 'true'`, 'selection settled')
  }
  await cdp.waitFor(`!document.querySelector('[role=switch]').disabled`, 'follow switch enabled')
  await cdp.evaluate(`document.querySelector('[role=switch]').click()`)
  await cdp.waitFor(`document.querySelector('[role=switch]').getAttribute('aria-checked') === 'true'`, 'following global')
  assert.equal(await cdp.evaluate(`document.querySelector('[data-style-id="auto"]').getAttribute('aria-pressed')`), 'true')
  await cdp.evaluate(`document.querySelector('[role=switch]').click()`)
  await cdp.waitFor(`document.querySelector('[role=switch]').getAttribute('aria-checked') === 'false'`, 'explicit global style')
  assert.deepEqual(await cdp.evaluate('window.__calls'), ['enable:on', 'style:article', 'style:auto', 'style:card', 'style:cs_ocean01', 'style:cs_field02', 'style:cs_free004', 'style:inherit', 'style:auto'])

  // Real keyboard activation must reach a saved template and show its focus ring.
  await cdp.waitFor(`!document.querySelector('[data-style-id="cs_session3"]').disabled`, 'custom enabled')
  await cdp.evaluate(`document.querySelector('[data-style-id="cs_session3"]').focus()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await cdp.waitFor(`window.__calls.at(-1) === 'style:cs_session3'`, 'keyboard custom selection')
  const focus = await cdp.evaluate(`(() => { const b = document.querySelector('[data-style-id="cs_session3"]'); return { focus: b === document.activeElement, outline: getComputedStyle(b).outlineStyle } })()`)
  assert.equal(focus.focus, true)
  assert.notEqual(focus.outline, 'none')

  // A short, narrow viewport scrolls the body while retaining the header and back button.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 400, deviceScaleFactor: 1, mobile: false })
  await cdp.waitFor(`document.querySelector('[data-dsh-iui-style-panel]').getBoundingClientRect().width <= 336`, 'narrow panel')
  await cdp.waitFor(`(() => { const r = document.querySelector('[data-dsh-iui-style-panel]').getBoundingClientRect(); return r.left >= 0 && r.right <= 360 && r.top >= 0 && r.bottom <= 400 })()`, 'narrow placement settled')
  const narrow = await cdp.evaluate(`(() => {
    const p = document.querySelector('[data-dsh-iui-style-panel]'), body = p.querySelector('.dsh-iui-style-panel-body'), r = p.getBoundingClientRect()
    body.scrollTop = body.scrollHeight
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scroll: body.scrollTop, overflow: getComputedStyle(body).overflowY,
      columns: getComputedStyle(p.querySelector('.dsh-iui-custom-grid')).gridTemplateColumns.split(' ').length }
  })()`)
  assert.ok(narrow.left >= 0 && narrow.right <= 360 && narrow.top >= 0 && narrow.bottom <= 400)
  assert.ok(narrow.scroll > 0, 'panel body scrolls')
  assert.equal(narrow.overflow, 'auto')
  assert.equal(narrow.columns, 2)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 260, deviceScaleFactor: 1, mobile: false })
  await cdp.waitFor(`(() => { const r = document.querySelector('[data-dsh-iui-style-panel]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= 260 })()`, 'short viewport height clamp')
  await cdp.send('Emulation.clearDeviceMetricsOverride')

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
<link rel="stylesheet" href="./bundle.css"><link rel="stylesheet" href="./index.css">
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
