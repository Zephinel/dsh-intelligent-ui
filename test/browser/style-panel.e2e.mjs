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
  const menu = await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].map(b => b.textContent.trim())')
  assert.ok(!menu.some(item => /All sessions|全部会话/.test(item)), 'All sessions must be absent')
  assert.ok(menu.some(item => /Display style|显示样式/.test(item)), 'Display style entry must exist')

  // The explicit Display style row must open the panel while the chip stays on
  // Follow global; this is the route that does not require an `on` override.
  await cdp.evaluate('[...document.querySelectorAll("[role=menuitem]")].find(b => /Display style|显示样式/.test(b.textContent)).click()')
  await cdp.waitFor('!!document.querySelector("[data-dsh-iui-style-panel]")', 'style panel via Display style')
  const route = await cdp.evaluate(`(() => { const b=document.querySelector('[data-dsh-iui-toggle]'); return { state:b.dataset.state, label:b.textContent.trim() } })()`)
  assert.equal(route.state, 'inherit', 'Display style must not change the enable scope')
  assert.match(route.label, /Follow global/, 'the chip must stay on Follow global')
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
  body{display:flex;align-items:flex-end} #root{position:fixed;left:24px;bottom:28px}
</style></head><body><div id="root"></div><script type="module" src="./bundle.js"></script></body></html>`
}

/** Stop Chrome and the static server, and remove the temp directory. */
async function cleanup() {
  try { cdp?.close() } catch { /* ignore */ }
  await browser?.cleanup()
  try { server?.close() } catch { /* ignore */ }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
