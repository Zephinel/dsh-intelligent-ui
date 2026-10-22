#!/usr/bin/env node
/**
 * Browser E2E for the custom export background picker.
 *
 *   npm run test:browser
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-settings-e2e-'))
let server
let browser
let cdp

const TOKENS = `:root{color-scheme:dark;--dsw-alias-bg-layer-1:#1b1b1b;--dsw-alias-bg-layer-2:#242424;--dsw-alias-bg-layer-3:#2e2e2e;--dsw-alias-border-l1:#323232;--dsw-alias-border-l2:#3c3c3c;--dsw-alias-border-l3:#505050;--dsw-alias-label-primary:#f2f2f2;--dsw-alias-label-secondary:#b8b8b8;--dsw-alias-label-tertiary:#8b8b8b;--dsw-alias-label-caption:#8a8a8a;--dsw-alias-label-dimmed:#666;--dsw-alias-label-primary-foreground:#111;--dsw-alias-interactive-bg-hover:#2e2e2e;--dsw-alias-state-business-primary:#6aa9ff;--dsw-alias-brand-primary:#6aa9ff;--dsw-alias-state-error-primary:#ff7b72;--dsw-radius-xs:4px;--dsw-radius-sm:6px;--dsw-radius-md:10px;--dsw-radius-lg:14px;--dsw-radius-xl:18px;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#6aa9ff;--dsw-font-family:system-ui,-apple-system,"PingFang SC",sans-serif}`

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/settings-entry.tsx')],
    outfile: join(temp, 'bundle.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
    jsx: 'automatic',
    absWorkingDir: root,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  await writeFile(join(temp, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>${TOKENS}</style><link rel="stylesheet" href="./bundle.css">
<style>html,body{margin:0;background:#111;color:#eee;font-family:system-ui}#root{width:760px;margin:0 auto;padding:32px 0}</style>
</head><body><div id="root"></div><script type="module" src="./bundle.js"></script></body></html>`)

  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url + 'index.html', width: 900, height: 1200 })
  if (browser === null) {
    console.log('settings-picker E2E: skipped (Chrome not found; set CHROME_BIN)')
    process.exitCode = 0
    await cleanup()
    process.exit()
  }
  cdp = await connectCdp(browser.port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.waitFor('document.readyState === "complete"', 'load', { timeout: 60000 })
  await cdp.waitFor('!!document.querySelector("[data-dsh-iui-export-background]")', 'background trigger', { timeout: 60000 })

  const before = await cdp.evaluate(`(() => ({
    text: document.querySelector('[data-dsh-iui-export-background]').textContent.trim(),
    native: document.querySelectorAll('input[type=color]').length,
  }))()`)
  assert.equal(before.text, '#ffffff')
  assert.equal(before.native, 0, 'the native color dialog is gone')

  await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-color-panel")', 'color panel')
  const panel = await cdp.evaluate(`(() => ({
    options: document.querySelectorAll('.dsh-iui-color-option').length,
    swatch: document.querySelector('.dsh-iui-color-panel .dsh-iui-color-option[aria-pressed="true"]')?.getAttribute('aria-label'),
    controlled: document.querySelector('[data-dsh-iui-export-background]').getAttribute('aria-controls'),
    panelId: document.querySelector('.dsh-iui-color-panel').id,
    focusInHex: document.activeElement === document.querySelector('.dsh-iui-color-hex-input'),
  }))()`)
  assert.equal(panel.options, 12, 'the preset palette is rendered')
  assert.equal(panel.swatch, '#ffffff')
  assert.equal(panel.controlled, panel.panelId, 'the trigger points at the dialog panel')
  assert.equal(panel.focusInHex, true, 'opening the picker focuses the hex field')

  await cdp.evaluate('document.querySelector(".dsh-iui-color-option[aria-label=\\"#111827\\"]").click()')
  await cdp.waitFor('window.__calls.length === 1', 'preset commit')
  const preset = await cdp.evaluate('window.__calls[0]')
  assert.equal(preset.field, 'exportBackground')
  assert.equal(preset.value, '#111827')
  await cdp.waitFor('!document.querySelector(".dsh-iui-color-panel")', 'panel closes after preset')
  assert.equal(await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").textContent.trim()'), '#111827')

  await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-color-panel")', 'color panel reopened')
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.dsh-iui-color-hex-input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '#123456')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })()`)
  await cdp.waitFor('window.__calls.length === 2', 'hex commit')
  const hex = await cdp.evaluate('window.__calls[1]')
  assert.equal(hex.field, 'exportBackground')
  assert.equal(hex.value, '#123456')
  await cdp.waitFor('!document.querySelector(".dsh-iui-color-panel")', 'panel closes after Enter')

  // A real mouse click on a preset while the hex field has focus must save the
  // preset, not the stale draft. This covers blur-before-click ordering.
  await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-color-panel")', 'color panel for mouse preset')
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.dsh-iui-color-hex-input')
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '#abcdef')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const presetPoint = await cdp.evaluate(`(() => {
    const element = document.querySelector('.dsh-iui-color-option[aria-label="#111827"]')
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: presetPoint.x, y: presetPoint.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: presetPoint.x, y: presetPoint.y, button: 'left', clickCount: 1 })
  await cdp.waitFor('window.__calls.length === 3', 'mouse preset commit')
  assert.equal((await cdp.evaluate('window.__calls[2].value')), '#111827', 'the preset wins over the focused hex draft')
  await cdp.waitFor('!document.querySelector(".dsh-iui-color-panel")', 'panel closes after mouse preset')

  // Clicking outside while the hex field holds a valid draft commits it
  // instead of discarding it with the unmounted panel.
  await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-color-panel")', 'color panel for outside commit')
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.dsh-iui-color-hex-input')
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '#00aa00')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const outsidePoint = await cdp.evaluate(`(() => {
    const rect = document.querySelector('.dsh-iui-settings-title').getBoundingClientRect()
    return { x: rect.left + 4, y: rect.top + rect.height / 2 }
  })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: outsidePoint.x, y: outsidePoint.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: outsidePoint.x, y: outsidePoint.y, button: 'left', clickCount: 1 })
  await cdp.waitFor('window.__calls.length === 4', 'outside click commits the draft')
  assert.equal((await cdp.evaluate('window.__calls[3].value')), '#00aa00')
  await cdp.waitFor('!document.querySelector(".dsh-iui-color-panel")', 'panel closes after outside commit')

  // Escape closes the dialog and returns focus to its trigger.
  await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-color-panel")', 'color panel for Escape')
  await cdp.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await cdp.waitFor('!document.querySelector(".dsh-iui-color-panel")', 'panel closes on Escape')
  assert.equal(await cdp.evaluate('document.activeElement.hasAttribute("data-dsh-iui-export-background")'), true, 'focus returns to the trigger')

  console.log('settings-picker E2E: OK')
} finally {
  await cleanup()
}

/** Stop Chrome and the static server, and remove the temp directory. */
async function cleanup() {
  try { cdp?.close() } catch { /* ignore */ }
  await browser?.cleanup()
  try { server?.close() } catch { /* ignore */ }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
