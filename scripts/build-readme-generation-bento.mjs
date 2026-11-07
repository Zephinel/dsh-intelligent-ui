#!/usr/bin/env node
/**
 * Compose the README generation gallery from real DSH session captures.
 *
 * The inputs are the committed 2x card captures in assets/ taken from live DSH
 * model sessions (see docs/screenshots/real-generation.md for provenance). Real
 * model sessions cannot be replayed on demand, so this script is deliberately
 * kept out of `npm run capture:readme`; it only re-composes the two language
 * composites deterministically at 1600px from the committed captures.
 *
 *   node scripts/build-readme-generation-bento.mjs
 *   node scripts/build-readme-generation-bento.mjs --lang=en
 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromeExists, connectCdp, launchChrome, startStaticServer } from '../test/support/browser.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const temp = await mkdtemp(join(tmpdir(), 'iui-generation-bento-'))
let server, browser, cdp

const langArg = process.argv.find(arg => arg.startsWith('--lang='))
const languages = langArg === undefined ? ['zh', 'en'] : [langArg.slice('--lang='.length)]

// One tall itinerary card on the left, dashboard and quiz stacked on the right.
// A 2x capture keeps the function text of the cards readable at README width.
const width = 1600
const height = 1130
const cells = [
  { file: 'intelligent-ui-real-itinerary', col: '1 / 2', row: '1 / 3' },
  { file: 'intelligent-ui-real-dashboard', col: '2 / 3', row: '1 / 2' },
  { file: 'intelligent-ui-real-quiz', col: '2 / 3', row: '2 / 3' },
]

const dataUri = async (file) => {
  const bytes = await readFile(join(root, 'assets', file))
  return `data:image/webp;base64,${bytes.toString('base64')}`
}

try {
  assert.ok(await chromeExists(), 'Chrome required')
  for (const lang of languages) {
    const cards = []
    for (const cell of cells) {
      const uri = await dataUri(`${cell.file}-${lang}.webp`)
      cards.push(`<figure style="grid-column:${cell.col};grid-row:${cell.row}"><img src="${uri}" alt=""></figure>`)
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#f4f3f0;color:#171717;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#frame{width:${width}px;height:${height}px;box-sizing:border-box;padding:28px;display:grid;grid-template-columns:816px 710px;grid-template-rows:496px 560px;gap:18px}
figure{margin:0;min-width:0;min-height:0;overflow:hidden;border-radius:18px;background:#fff;box-shadow:0 10px 26px rgb(0 0 0 / 8%);display:flex;align-items:center;justify-content:center;}
img{display:block;width:100%;height:100%;object-fit:contain;}
</style></head><body><div id="frame">${cards.join('')}</div></body></html>`
    await writeFile(join(temp, 'index.html'), html)
    if (!server) {
      server = await startStaticServer(temp)
      browser = await launchChrome({ url: server.url, width, height })
      assert.ok(browser, 'Chrome required')
      cdp = await connectCdp(browser.port)
      await cdp.send('Page.enable')
      await cdp.send('Runtime.enable')
      // The headless window is taller than its viewport, so pin the exact
      // viewport before measuring the frame; otherwise the capture clips the
      // bottom row and adds scrollbars.
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    } else {
      await cdp.send('Page.navigate', { url: server.url })
    }
    await cdp.waitFor('document.readyState === "complete"', 'bento ready', { timeout: 10000 })
    await new Promise(resolve => setTimeout(resolve, 250))
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'webp', quality: 90,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    })
    const out = `assets/intelligent-ui-readme-generation-${lang}.webp`
    await writeFile(join(root, out), Buffer.from(shot.data, 'base64'))
    console.log(`bento: ${out}`)
  }
} finally {
  cdp?.close()
  await browser?.cleanup()
  server?.close()
  await rm(temp, { recursive: true, force: true })
}
