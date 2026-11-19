/**
 * Anchored overlay placement under pinch zoom.
 *
 * The live GUI pass showed a tall style panel clipped above the visual viewport
 * after a 1.5x pinch. This fixture pins the shared useAnchoredPopup clamp so the
 * regression cannot return unnoticed.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

import { chromeExists, connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

if (!(await chromeExists())) {
  console.log('anchored-overlay E2E: skipped (Chrome not installed)')
  process.exit(0)
}

const root = process.cwd()
const temp = await mkdtemp(join(tmpdir(), 'iui-anchored-'))
let server
let browser
let cdp
try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/anchored-entry.tsx')],
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
  await writeFile(join(temp, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="./bundle.js"></script></body></html>')
  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url, width: 1400, height: 1000 })
  assert.ok(browser, 'Chrome is required for the anchored-overlay check')
  cdp = await connectCdp(browser.port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.waitFor('!!document.querySelector("[data-fixture=trigger]")', 'trigger')
  await cdp.evaluate('document.querySelector("[data-fixture=trigger]").click()')
  await cdp.waitFor('!!document.querySelector("[data-fixture=panel]")', 'panel')

  const before = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-fixture=panel]').getBoundingClientRect()
    return { top: panel.top, bottom: panel.bottom, vvTop: visualViewport.offsetTop, vvBottom: visualViewport.offsetTop + visualViewport.height }
  })()`)
  assert.ok(before.top >= before.vvTop - 1 && before.bottom <= before.vvBottom + 1, 'the panel is visible at 100%')

  const center = await cdp.evaluate(`(() => {
    const rect = document.querySelector('[data-fixture=trigger]').getBoundingClientRect()
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
  })()`)
  await cdp.send('Input.synthesizePinchGesture', { x: center.x, y: center.y, scaleFactor: 1.5, relativeSpeed: 800 })
  await new Promise(resolve => setTimeout(resolve, 1000))

  const after = await cdp.evaluate(`(() => {
    const panel = document.querySelector('[data-fixture=panel]').getBoundingClientRect()
    return {
      top: panel.top, bottom: panel.bottom, height: panel.height,
      vvTop: visualViewport.offsetTop, vvBottom: visualViewport.offsetTop + visualViewport.height,
      maxHeight: getComputedStyle(document.querySelector('[data-fixture=panel]')).maxHeight,
    }
  })()`)
  assert.ok(after.vvTop > before.vvTop, 'the pinch gesture moved the visual viewport')
  assert.ok(after.top >= after.vvTop - 1, 'the panel top stays inside the visual viewport')
  assert.ok(after.bottom <= after.vvBottom + 1, 'the panel bottom stays inside the visual viewport')
  assert.notEqual(after.maxHeight, 'none', 'the visible height caps the panel')
  console.log(`anchored-overlay E2E: OK (1.5x pinch: panel ${Math.round(after.top)}..${Math.round(after.bottom)} inside ${Math.round(after.vvTop)}..${Math.round(after.vvBottom)})`)
} finally {
  cdp?.close()
  await browser?.cleanup()
  server?.close()
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
