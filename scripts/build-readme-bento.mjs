#!/usr/bin/env node
/**
 * Compose the README screenshot groups into fixed bento grids.
 *
 * Sources stay in assets/ (so the raw captures remain available); each output
 * is a deterministic 2x WebP generated from local images. No network.
 *
 *   node scripts/build-readme-bento.mjs
 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromeExists, connectCdp, launchChrome, startStaticServer } from '../test/support/browser.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const temp = await mkdtemp(join(tmpdir(), 'iui-readme-bento-'))
let server, browser, cdp

const groups = [
  ...['zh', 'en'].map(lang => ({
    out: `assets/intelligent-ui-readme-overview-${lang}.webp`,
    width: 1600, height: 1000, columns: 2, rowTemplate: '1.4fr 1fr',
    cells: [
      { file: `intelligent-ui-itinerary-${lang}.webp`, col: '1 / 2', row: '1 / 3' },
      { file: `intelligent-ui-editing-${lang}.webp`, col: '2 / 3', row: '1 / 2' },
      { file: 'intelligent-ui-settings.webp', col: '2 / 3', row: '2 / 3' },
    ],
  })),
  ...['zh', 'en'].map(lang => ({
    out: `assets/intelligent-ui-readme-generation-${lang}.webp`,
    width: 1600, height: 720, columns: 3, rows: 1, fit: 'contain',
    cells: [
      { file: `intelligent-ui-itinerary-${lang}.webp`, col: '1 / 2', row: '1 / 2' },
      { file: `intelligent-ui-dashboard-${lang}.webp`, col: '2 / 3', row: '1 / 2' },
      { file: `intelligent-ui-quiz-${lang}.webp`, col: '3 / 4', row: '1 / 2' },
    ],
  })),
  {
    out: 'assets/intelligent-ui-readme-components.webp',
    width: 1600, height: 960,
    cells: [
      { file: 'intelligent-ui-components-layout.webp', col: '1 / 2', row: '1 / 2' },
      { file: 'intelligent-ui-components-inputs.webp', col: '2 / 3', row: '1 / 2' },
      { file: 'intelligent-ui-components-drawing.webp', col: '3 / 4', row: '1 / 2' },
      { file: 'intelligent-ui-example-dashboard.webp', col: '1 / 2', row: '2 / 3' },
      { file: 'intelligent-ui-example-quiz.webp', col: '2 / 3', row: '2 / 3' },
      { file: 'intelligent-ui-responsive.webp', col: '3 / 4', row: '2 / 3' },
    ],
  },
  {
    out: 'assets/intelligent-ui-readme-controls.webp',
    width: 1600, height: 920, columns: 2, fit: 'contain',
    cells: [
      { file: 'intelligent-ui-style-panel.webp', col: '1 / 2', row: '1 / 3' },
      { file: 'intelligent-ui-toggle.png', col: '2 / 3', row: '1 / 2', fit: 'cover', position: 'right bottom' },
      { file: 'intelligent-ui-on-demand-hint.webp', col: '2 / 3', row: '2 / 3' },
    ],
  },
  {
    out: 'assets/intelligent-ui-readme-temporary.webp',
    width: 1600, height: 560, columns: 2, rows: 1, fit: 'contain',
    cells: [
      { file: 'intelligent-ui-temporary-result.webp', col: '1 / 2', row: '1 / 2' },
      { file: 'intelligent-ui-temporary-result-dark.webp', col: '2 / 3', row: '1 / 2' },
    ],
  },
]

const dataUri = async (file) => {
  const bytes = await readFile(join(root, 'assets', file))
  return `data:image/webp;base64,${bytes.toString('base64')}`
}

try {
  assert.ok(await chromeExists(), 'Chrome required')
  for (const group of groups) {
    const cards = []
    for (const cell of group.cells) {
      cards.push(`<figure style="grid-column:${cell.col};grid-row:${cell.row}"><img src="${await dataUri(cell.file)}" alt="" style="object-fit:${cell.fit ?? group.fit ?? 'cover'};object-position:${cell.position ?? 'top center'}"></figure>`)
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#f4f3f0;color:#171717;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#frame{width:${group.width}px;height:${group.height}px;box-sizing:border-box;padding:28px;display:grid;grid-template-columns:repeat(${group.columns ?? 3},1fr);grid-template-rows:${group.rowTemplate ?? `repeat(${group.rows ?? 2},1fr)`};gap:18px}
figure{margin:0;min-width:0;min-height:0;overflow:hidden;border-radius:18px;background:#fff;box-shadow:0 10px 26px rgb(0 0 0 / 8%);display:flex;align-items:center;justify-content:center;}
img{display:block;width:100%;height:100%;}
</style></head><body><div id="frame">${cards.join('')}</div></body></html>`
    await writeFile(join(temp, 'index.html'), html)
    if (!server) {
      server = await startStaticServer(temp)
      browser = await launchChrome({ url: server.url, width: group.width, height: group.height })
      assert.ok(browser, 'Chrome required')
      cdp = await connectCdp(browser.port)
      await cdp.send('Page.enable')
      await cdp.send('Runtime.enable')
    } else {
      await cdp.send('Page.navigate', { url: server.url })
    }
    await cdp.waitFor('document.readyState === "complete"', 'bento ready', { timeout: 10000 })
    await new Promise(resolve => setTimeout(resolve, 250))
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'webp', quality: 90,
      clip: { x: 0, y: 0, width: group.width, height: group.height, scale: 1 },
    })
    await writeFile(join(root, group.out), Buffer.from(shot.data, 'base64'))
    console.log(`bento: ${group.out}`)
  }
} finally {
  cdp?.close()
  await browser?.cleanup()
  server?.close()
  await rm(temp, { recursive: true, force: true })
}
