#!/usr/bin/env node
/**
 * Browser-level layout check for the Pressable selected state.
 *
 * A selected tile used to paint an 18px corner check badge on every Pressable
 * that is not a checklist row. On a compact text chip (a tab of two CJK
 * characters, ~44px wide) that badge covers the label, so the selected tab read
 * as broken. The badge is now reserved for content without text (photo tiles,
 * swatches); text-bearing selections use a stronger inset ring instead.
 *
 *   node test/renderer/pressable-select-check.mjs
 *   CHROME_BIN=/path/to/chrome node test/renderer/pressable-select-check.mjs
 *
 * Skips with exit code 0 when no Chrome binary is available.
 */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeExists, connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'test/renderer/.build/pressable-select-check')
if (!(await chromeExists())) {
  console.log(`pressable-select-check: skipped (no Chrome at ${process.env.CHROME_BIN ?? 'the default path'}; set CHROME_BIN to run it)`)
  process.exit(0)
}

const program = `root = Col([tabs, textTile, photoTile, swatch])
$tab = "电影"
tabs = Row([Pressable([Text("电影", "sm", null, "semibold")], @Set($tab, "电影"), $tab == "电影", 2, "surface", "full"), Pressable([Text("剧集", "sm", null, "semibold")], @Set($tab, "剧集"), $tab == "剧集", 2, "surface", "full"), Pressable([Text("类型", "sm", null, "semibold")], @Set($tab, "类型"), $tab == "类型", 2, "surface", "full")], 1, "start", null, true)
textTile = Pressable([Col([Title("Option A", "sm"), Text("Description copy", "xs", "muted")], 1)], null, true, 2)
photoTile = Pressable([SearchImage("photo tile", 1.5, "md")], null, true, 0)
swatch = Pressable([Box([], "col", null, 14, "chart1", "md", null, 40, 40)], null, true)`

await mkdir(outDir, { recursive: true })
const bundleDir = join(outDir, 'bundle')
await mkdir(bundleDir, { recursive: true })
const entry = join(outDir, 'entry.tsx')
await writeFile(entry, `
import { createRoot } from 'react-dom/client'
import { OpenUIRenderer } from ${JSON.stringify(join(root, 'src/lib/render.tsx'))}
const program = ${JSON.stringify(program)}
createRoot(document.getElementById('card')).render(<OpenUIRenderer program={program} />)
`)

await build({
  entryPoints: [entry],
  outdir: bundleDir,
  entryNames: 'app',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome120',
  jsx: 'automatic',
  jsxImportSource: 'react',
  loader: { '.css': 'css', '.json': 'json', '.png': 'dataurl', '.svg': 'dataurl' },
  logLevel: 'warning',
})

const fixture = `
  :root {
    color-scheme: light;
    --dsw-alias-label-primary: #0f1115;
    --dsw-alias-label-primary-foreground: #ffffff;
    --dsw-alias-label-secondary: rgb(15 17 21 / 60%);
    --dsw-alias-label-tertiary: rgb(15 17 21 / 45%);
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    --ds-font-family-code: ui-monospace, "SF Mono", Menlo, monospace;
  }
  html, body { margin: 0; padding: 0; background: #fff; font-family: var(--dsw-font-family); }
  #card { width: 760px; padding: 16px; box-sizing: border-box; }
`
await writeFile(join(bundleDir, 'index.html'), `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>pressable select check</title>
<style>${fixture}</style>
<link rel="stylesheet" href="app.css">
</head><body><div id="card"></div><script type="module" src="app.js"></script></body></html>`)

const server = await startStaticServer(bundleDir)
const sleep = (ms) => new Promise((resolveReady) => setTimeout(resolveReady, ms))
const browser = await launchChrome({ url: server.url, width: 1200, height: 1200 })
if (browser === null) {
  console.log('pressable-select-check: skipped (Chrome not found; set CHROME_BIN)')
  server.close()
  process.exit(0)
}
const cdp = await connectCdp(browser.port)
const cleanup = async () => {
  cdp.close()
  await browser.cleanup()
  server.close()
}
process.on('exit', () => { try { browser.process.kill('SIGKILL') } catch { /* ignore */ } })

let ready = false
for (let i = 0; i < 80; i++) {
  ready = await cdp.evaluate(`!!document.body && document.body.innerText.includes('Option A') && document.body.innerText.includes('剧集')`)
  if (ready) break
  await sleep(250)
}
if (!ready) { await cleanup(); console.error('pressable-select-check: fixture did not render'); process.exit(1) }
await sleep(400)

const results = await cdp.evaluate(`(() => {
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })
  const card = document.getElementById('card')
  if (card === null) { check('fixture renders', false, 'missing card'); return checks }
  const fallback = card.querySelector('.dsh-iui-fallback')
  if (fallback !== null) { check('fixture renders', false, 'renderer fallback: ' + fallback.innerText.slice(0, 160)); return checks }

  const before = (el) => getComputedStyle(el, '::before')
  const badges = (el) => before(el).content !== 'none' && before(el).width !== 'auto'
  const pressables = [...card.querySelectorAll('.iui-pressable')]
  const selectedChip = pressables.find((el) => el.textContent.includes('电影') && el.classList.contains('is-selected'))
  const unselectedChip = pressables.find((el) => el.textContent.includes('剧集'))
  const textTile = pressables.find((el) => el.textContent.includes('Option A'))
  const photoTile = pressables.find((el) => el.querySelector('.iui-image') !== null)
  const swatchTile = pressables.find((el) => el.querySelector('.iui-box') !== null)

  check('selected text chip exists', selectedChip !== undefined, String(selectedChip?.className))
  check('selected text chip paints no corner badge', selectedChip !== undefined && !badges(selectedChip), before(selectedChip)?.content ?? 'missing')
  check('selected text chip keeps a visible inset ring', selectedChip !== undefined && getComputedStyle(selectedChip).boxShadow.includes('inset'), getComputedStyle(selectedChip).boxShadow)
  check('unselected chip paints no badge', unselectedChip !== undefined && !badges(unselectedChip), before(unselectedChip)?.content ?? 'missing')
  check('selected text tile paints no corner badge', textTile !== undefined && !badges(textTile), before(textTile)?.content ?? 'missing')
  check('selected photo tile keeps its corner badge', photoTile !== undefined && badges(photoTile), before(photoTile)?.content ?? 'missing')
  check('selected swatch keeps its corner badge', swatchTile !== undefined && badges(swatchTile), before(swatchTile)?.content ?? 'missing')

  const text = selectedChip?.querySelector('.iui-text')
  const chipRect = selectedChip?.getBoundingClientRect()
  const textRect = text?.getBoundingClientRect()
  check('chip label stays inside the chip', chipRect !== undefined && textRect !== undefined && textRect.right <= chipRect.right + 1 && textRect.left >= chipRect.left - 1, chipRect && textRect ? String(Math.round(textRect.right - chipRect.right)) : 'missing')
  check('chip is compact enough that a badge would cover it', chipRect !== undefined && chipRect.height <= 42, chipRect ? String(Math.round(chipRect.height)) + 'px' : 'missing')
  return checks
})()`)

let failed = 0
for (const result of results) {
  console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.name}${result.ok ? '' : ` — ${result.detail}`}`)
  if (!result.ok) failed++
}
console.log(`pressable-select-check: ${results.length - failed}/${results.length} checks passed`)
await cleanup()
if (failed > 0) process.exit(1)
