#!/usr/bin/env node
/**
 * Browser E2E for the answer image export (component level).
 *
 * Builds `test/browser/harness/export-entry.tsx`, serves it from a temporary
 * directory, starts headless Chrome with CDP, flips a Flashcard, runs the real
 * `exportCardsImage` pipeline and asserts the DOM normalization SnapDOM
 * receives: the 3D flip is flattened to the visible face, transitions are
 * frozen, and a still-loading photo is waited for before the raster capture.
 *
 * Chrome is required; set CHROME_BIN to override the macOS default. The test is
 * intentionally outside `npm run check` so CI needs no browser.
 *
 *   npm run test:browser
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { chromeExists, connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-export-e2e-'))
const bundle = join(temp, 'bundle.js')
let server
let browser
let cdp

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/export-entry.tsx')],
    outfile: bundle,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
    jsx: 'automatic',
    absWorkingDir: root,
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'css' },
    logLevel: 'silent',
  })

  // A local photo keeps the test independent of the network while still going
  // through the live `<img>` settling path.
  await writeFile(join(temp, 'photo.svg'), [
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">',
    '<rect width="640" height="400" fill="#5b8def"/>',
    '<circle cx="320" cy="200" r="96" fill="#ffffff" opacity="0.9"/>',
    '</svg>',
  ].join(''), 'utf8')
  await writeFile(join(temp, 'index.html'), html(), 'utf8')
  server = await startStaticServer(temp)

  if (!(await chromeExists())) {
    console.log('export-image E2E: skipped (Chrome not found; set CHROME_BIN)')
    process.exitCode = 0
  } else {
    browser = await launchChrome({ url: `${server.url}index.html`, width: 900, height: 1200 })
    cdp = await connectCdp(browser.port)

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.waitFor('document.readyState === "complete"', 'load')
    await cdp.waitFor('!!document.querySelector(".iui-flashcard")', 'flashcard')
    await cdp.waitFor('!!document.querySelector(".iui-image img")', 'photo element')
    // Two ExportAction entries are mounted; only the one whose Chat selector
    // reports a rendered answer may add a button to the action strip.
    await cdp.waitFor('document.querySelectorAll("[data-dsh-iui-export]").length === 1', 'single export trigger')
    const trigger = await cdp.evaluate(`(() => {
      const button = document.querySelector('[data-dsh-iui-export]')
      const row = document.querySelector('.harness-actions')
      const rect = button.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      return {
        label: button.textContent.trim(),
        order: getComputedStyle(button).order,
        rightGap: Math.round(rowRect.right - rect.right),
        radius: getComputedStyle(button).borderRadius,
        borderWidth: getComputedStyle(button).borderTopWidth,
      }
    })()`)
    assert.match(trigger.label, /Export/, 'the trigger carries a visible label')
    assert.equal(trigger.order, '1', 'the export pill is ordered after the native action cluster')
    assert.ok(trigger.rightGap >= 0 && trigger.rightGap <= 1, 'the export pill sits at the far right of the action row')
    assert.equal(trigger.radius, '999px', 'the trigger uses the distinct pill treatment')
    assert.equal(trigger.borderWidth, '0px', 'the export pill is borderless')

    // Flip the card, open the real entry's menu and export immediately: the
    // capture must show the back face flat and wait for the still-loading photo.
    await cdp.evaluate('document.querySelector(".iui-flashcard").click()')
    await cdp.evaluate('document.querySelector("[data-dsh-iui-export]").click()')
    await cdp.waitFor('!!document.querySelector("[data-dsh-iui-export-menu]")', 'export menu')
    const frames = await cdp.evaluate('[...document.querySelectorAll("[data-export-style]")].map(b => b.dataset.exportStyle)')
    assert.deepEqual(frames, ['raw', 'rounded', 'card'], 'the menu offers the three beautification frames')

    const menuLayout = await cdp.evaluate(`(() => {
      const menu = document.querySelector('[data-dsh-iui-export-menu]')
      const button = document.querySelector('[data-dsh-iui-export]')
      const menuRect = menu.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      const rows = [...menu.querySelectorAll('.dsh-iui-menu-label, .dsh-iui-menu-hint')]
      return {
        rightGap: Math.round(buttonRect.right - menuRect.right),
        width: Math.round(menuRect.width),
        menuTop: Math.round(menuRect.top),
        buttonBottom: Math.round(buttonRect.bottom),
        wraps: rows.some(row => row.scrollWidth > row.clientWidth + 1),
      }
    })()`)
    assert.equal(menuLayout.rightGap, 0, 'the menu right edge aligns with the export pill')
    assert.ok(menuLayout.width > 0 && menuLayout.width < 320, 'the menu width follows its longest row')
    assert.ok(menuLayout.menuTop >= menuLayout.buttonBottom, 'a short top edge flips the menu below the trigger')
    assert.equal(menuLayout.wraps, false, 'menu labels and hints stay on one line')
    await cdp.evaluate('document.querySelector("[data-export-style=\\"raw\\"]").click()')
    await cdp.waitFor('window.downloads.length === 1', 'download', { timeout: 30000 })

    const downloads = await cdp.evaluate('window.downloads')
    assert.equal(downloads.length, 1, 'one PNG download is handed to the browser')
    assert.match(downloads[0], /^Export-harness-\d{8}-\d{6}\.png$/, 'the file name carries title and timestamp')

    const probes = await cdp.evaluate('window.captureProbes')
    assert.equal(probes.length, 1, 'the export rasterizes the card once')
    assert.equal(probes[0].flipFlattened, true, 'the flashcard flip is flattened for the capture')
    assert.equal(probes[0].frontHidden, true, 'a flipped card hides its front face')
    assert.equal(probes[0].backUnrotated, true, 'the visible back face is not rotated')
    assert.equal(probes[0].photoEager, true, 'lazy photos are asked to load before capture')
    assert.equal(probes[0].photoComplete, true, 'the capture waits until the photo has loaded')
    assert.equal(probes[0].transitionsFrozen, true, 'CSS transitions are frozen for the capture')
    assert.equal(probes[0].animationsFrozen, true, 'CSS animations are frozen for the capture')
    assert.equal(probes[0].expandedAtCapture, true, 'a collapsed card is expanded for the capture')
    assert.equal(probes[0].mapReadyAtCapture, true, 'the export waits for the map readiness signal')
    assert.equal(await cdp.evaluate('document.querySelector(".dsh-iui-body").hidden'), true, 'the collapsed card is restored after the export')

    const raw = await cdp.evaluate(`(async () => {
      const blob = window.exportedBlobs[0]
      const bitmap = await createImageBitmap(blob)
      return { type: blob.type, size: blob.size, width: bitmap.width, height: bitmap.height }
    })()`)
    assert.equal(raw.type, 'image/png', 'the download is a PNG')
    assert.ok(raw.size > 1000, 'the PNG carries pixels')
    assert.ok(raw.width > 0 && raw.height > 0, 'the PNG has dimensions')

    // A second export with the card frame must reserve room for the soft shadow
    // instead of painting the background edge-to-edge and clipping it.
    await cdp.waitFor('!document.querySelector("[data-dsh-iui-export-menu]")', 'menu closed')
    await cdp.evaluate('document.querySelector("[data-dsh-iui-export]").click()')
    await cdp.waitFor('!!document.querySelector("[data-dsh-iui-export-menu]")', 'export menu reopened')
    await cdp.evaluate('document.querySelector("[data-export-style=\\"card\\"]").click()')
    await cdp.waitFor('window.downloads.length === 2', 'card download', { timeout: 30000 })

    const card = await cdp.evaluate(`(async () => {
      const blob = window.exportedBlobs[1]
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      // At 1x the card frame is padding 32 + shadow bleed 34 per side.
      const expectedDelta = 2 * (32 + 34)
      const band = 34
      const pixels = context.getImageData(0, bitmap.height - band, bitmap.width, band).data
      let maxAlpha = 0
      for (let i = 3; i < pixels.length; i += 4) maxAlpha = Math.max(maxAlpha, pixels[i])
      return { width: bitmap.width, height: bitmap.height, expectedDelta, maxAlpha }
    })()`)
    assert.equal(card.width - raw.width, card.expectedDelta, 'card frame reserves the shadow bleed horizontally')
    assert.equal(card.height - raw.height, card.expectedDelta, 'card frame reserves the shadow bleed vertically')
    assert.ok(card.maxAlpha > 0, 'the card frame shadow is painted inside the canvas')

    // Third export: 2x rounded proves the scale path and the no-bleed frame.
    await cdp.evaluate('window.setExportScale("2x")')
    await cdp.waitFor('!document.querySelector("[data-dsh-iui-export-menu]")', 'menu closed again')
    await cdp.evaluate('document.querySelector("[data-dsh-iui-export]").click()')
    await cdp.waitFor('!!document.querySelector("[data-dsh-iui-export-menu]")', 'export menu for 2x')
    await cdp.evaluate('document.querySelector("[data-export-style=\\"rounded\\"]").click()')
    await cdp.waitFor('window.downloads.length === 3', '2x rounded download', { timeout: 30000 })
    const rounded = await cdp.evaluate(`(async () => {
      const blob = window.exportedBlobs[2]
      const bitmap = await createImageBitmap(blob)
      return { width: bitmap.width, height: bitmap.height }
    })()`)
    assert.equal(rounded.width, raw.width * 2 + 96, '2x rounded frame doubles the source and adds 2x padding')
    assert.equal(rounded.height, raw.height * 2 + 96, '2x rounded frame doubles the source and adds 2x padding')

    // The fourth entry builds the single-file interactive page: it must inline
    // the fetched renderer assets, the current theme and every recorded card.
    await cdp.evaluate('window.setExportScale("1x")')
    await cdp.waitFor('!document.querySelector("[data-dsh-iui-export-menu]")', 'menu closed before page export')
    await cdp.evaluate('document.querySelector("[data-dsh-iui-export]").click()')
    await cdp.waitFor('!!document.querySelector("[data-dsh-iui-export-menu]")', 'page export menu')
    assert.equal(await cdp.evaluate('!!document.querySelector("[data-export-page]")'), true, 'the menu offers the interactive page export')
    await cdp.evaluate('document.querySelector("[data-export-page]").click()')
    await cdp.waitFor('window.downloads.length === 4', 'page download', { timeout: 30000 })
    const page = await cdp.evaluate(`(async () => {
      const blob = window.exportedBlobs[3]
      return { type: blob.type, name: window.downloads[3], size: blob.size, text: await blob.text() }
    })()`)
    assert.match(page.name, /^Export-harness-\d{8}-\d{6}\.html$/, 'the page download carries title and timestamp')
    assert.match(page.type, /^text\/html/, 'the page download is HTML')
    assert.ok(page.size > 1000, 'the page carries the inlined renderer')
    assert.match(page.text, /<title>Export harness<\/title>/)
    assert.match(page.text, /--dsw-alias-bg-base/, 'the current theme tokens are inlined')
    assert.match(page.text, /window\.mountIUI/, 'the standalone mount call is inlined')
    assert.match(page.text, /--standalone-css:true/, 'the fetched stylesheet is inlined')
    assert.match(page.text, /"program":"root = Col/, 'the recorded card program is embedded')
    assert.match(page.text, /"callId":"call-1"/)
    assert.match(page.text, /hideToAssistant:false/, 'the exported page carries the ToAssistant visibility option')

    const probesAfterAll = await cdp.evaluate('window.captureProbes')
    assert.equal(probesAfterAll.length, 3, 'the three image exports rasterized the card')
    console.log(`export-image E2E: OK (${raw.width}x${raw.height} raw, ${card.width}x${card.height} card, ${rounded.width}x${rounded.height} rounded 2x, shadow alpha ${card.maxAlpha}, page ${Math.round(page.size / 1024)} kB)`)
  }
} finally {
  cdp?.close()
  await browser?.cleanup()
  try { server?.close() } catch { /* already closed */ }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}

/** Static harness HTML with the DSH aliases the card chrome needs. */
function html() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="./bundle.css">
<style>
  :root { color-scheme: light; --dsw-alias-bg-base:#fff; --dsw-alias-bg-layer-1:#fff; --dsw-alias-bg-layer-2:#f6f6f6;
    --dsw-alias-border-l1:#e6e6e6; --dsw-alias-border-l2:#d9d9d9; --dsw-alias-label-primary:#111;
    --dsw-alias-label-secondary:#555; --dsw-alias-label-tertiary:#777; --dsw-alias-label-caption:#8a8a8a;
    --dsw-alias-label-primary-foreground:#fff; --dsw-alias-interactive-bg-hover:#eee;
    --dsw-alias-switch-thumb:#fff; --dsw-alias-state-business-primary:#4176e6; --dsw-alias-state-error-primary:#d33;
    --dsw-brand-primary:#111; --dsw-radius-sm:6px; --dsw-radius-md:10px; --dsw-radius-lg:14px;
    --dsw-focus-ring-width:2px; --dsw-focus-ring-color:#4176e6;
    --dsw-font-family:system-ui, -apple-system, "PingFang SC", sans-serif; }
  html,body{margin:0;padding:0;background:#fff;color:#111;font-family:var(--dsw-font-family)}
  #app{width:760px;margin:24px}
</style></head><body><div id="app"></div><script type="module" src="./bundle.js"></script></body></html>`
}
