#!/usr/bin/env node
/**
 * Browser-level layout check for photos in a `Row`.
 *
 * The media-row default is a 120-200px, 4:3 photo beside copy. It used to be
 * enforced with `!important` overrides, so a program that sized a thumbnail
 * itself (`Box(width: 44)` + `SearchImage(..., aspectRatio)`) was still
 * inflated into a 200px block: ranked lists turned into screens of tall rows
 * while the program asked for compact ones. These checks keep that failure
 * class fixed: a program's explicit width, aspectRatio, gap and align must win,
 * and the media-row defaults must still apply when the program leaves them out.
 *
 *   node test/renderer/media-row-check.mjs
 *   CHROME_BIN=/path/to/chrome node test/renderer/media-row-check.mjs
 *
 * Skips with exit code 0 when no Chrome binary is available.
 */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeExists, connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'test/renderer/.build/media-row-check')
if (!(await chromeExists())) {
  console.log(`media-row-check: skipped (no Chrome at ${process.env.CHROME_BIN ?? 'the default path'}; set CHROME_BIN to run it)`)
  process.exit(0)
}

// Each row carries a unique text marker so the checks can find it by content.
const program = `root = Col([plain, compact, media, boxed, sized, thumb])
compact = Row([Text("2", "sm"), Box([SearchImage("blossom", 0.7)], null, null, null, null, null, null, 44), Box([Text("Compact title")], "col", 1, null, null, null, null, null, null, 1), Text("8.4", "md")], 3, "start")
media = Row([SearchImage("mountain lake"), Text("Media copy")])
boxed = Row([Box([SearchImage("boxed photo")]), Text("Boxed copy")])
sized = Row([Box([SearchImage("forest", 1.5)], null, null, null, null, null, null, 120), Text("Sized copy")])
thumb = Row([Box([SearchImage("thumb aspect default")], null, null, null, null, null, null, 48), Text("Thumb copy")])
plain = SearchImage("Plain block photo")`

// A narrow card: the same media row must fall back to the 120px minimum.
const narrowProgram = `root = Row([SearchImage("narrow photo"), Text("Narrow copy")])`

await mkdir(outDir, { recursive: true })
const bundleDir = join(outDir, 'bundle')
await mkdir(bundleDir, { recursive: true })
const entry = join(outDir, 'entry.tsx')
await writeFile(entry, `
import { createRoot } from 'react-dom/client'
import { OpenUIRenderer } from ${JSON.stringify(join(root, 'src/lib/render.tsx'))}

const wide = ${JSON.stringify(program)}
const narrow = ${JSON.stringify(narrowProgram)}
createRoot(document.getElementById('wide')).render(<OpenUIRenderer program={wide} />)
createRoot(document.getElementById('narrow')).render(<OpenUIRenderer program={narrow} />)
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
  #wide { width: 760px; padding: 16px; box-sizing: border-box; }
  #narrow { width: 360px; padding: 16px; box-sizing: border-box; }
`
await writeFile(join(bundleDir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>media row check</title>
<style>${fixture}</style>
<link rel="stylesheet" href="app.css">
</head><body><div id="wide"></div><div id="narrow"></div><script type="module" src="app.js"></script></body></html>`)

const server = await startStaticServer(bundleDir)
const sleep = (ms) => new Promise((resolveReady) => setTimeout(resolveReady, ms))
const browser = await launchChrome({ url: server.url, width: 1200, height: 1200 })
if (browser === null) {
  console.log('media-row-check: skipped (Chrome not found; set CHROME_BIN)')
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
  ready = await cdp.evaluate(`!!document.body && document.body.innerText.includes('Compact title') && document.body.innerText.includes('Narrow copy')`)
  if (ready) break
  await sleep(250)
}
if (!ready) { await cleanup(); console.error('media-row-check: fixture did not render'); process.exit(1) }
await sleep(600)

const results = await cdp.evaluate(`(() => {
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })
  const wide = document.getElementById('wide')
  const narrow = document.getElementById('narrow')
  if (wide === null || narrow === null) { check('fixture renders', false, 'missing container'); return checks }
  const fallback = wide.querySelector('.dsh-iui-fallback')
  if (fallback !== null) { check('fixture renders', false, 'renderer fallback: ' + fallback.innerText.slice(0, 160)); return checks }

  const css = (el, prop) => (el ? getComputedStyle(el) : null)?.getPropertyValue(prop) ?? ''
  const width = (el) => el?.getBoundingClientRect().width ?? 0
  const ratio = (el) => {
    const value = css(el, 'aspect-ratio')
    const parts = value.split('/').map((part) => Number(part.trim()))
    return parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : NaN
  }
  const rowOf = (root, marker) => [...root.querySelectorAll('.iui-row')].find((row) => row.textContent.includes(marker))
  const imageOf = (row) => row?.querySelector('.iui-image') ?? null
  const near = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance

  const compact = rowOf(wide, 'Compact title')
  const compactImage = imageOf(compact)
  check('explicit thumbnail keeps its 44px width', near(width(compactImage), 44, 1.5), width(compactImage) + 'px')
  check('explicit thumbnail keeps its 0.7 aspect ratio', near(ratio(compactImage), 0.7, 0.02), css(compactImage, 'aspect-ratio'))
  check('compact thumbnail row stays short', (compact?.getBoundingClientRect().height ?? 999) < 100, (compact?.getBoundingClientRect().height ?? 'missing') + 'px')
  check('program Row gap is not overridden', css(compact, 'gap') === '12px', css(compact, 'gap'))
  check('program Row align is not overridden', css(compact, 'align-items') === 'flex-start', css(compact, 'align-items'))

  const media = rowOf(wide, 'Media copy')
  const mediaImage = imageOf(media)
  check('unsized media-row photo keeps a 120-200px slot', width(mediaImage) >= 119 && width(mediaImage) <= 201, width(mediaImage) + 'px')
  check('unsized media-row photo defaults to 4:3', near(ratio(mediaImage), 4 / 3, 0.02), css(mediaImage, 'aspect-ratio'))
  check('unsized media row keeps the group gap default', css(media, 'gap') === '16px', css(media, 'gap'))

  const boxed = rowOf(wide, 'Boxed copy')
  const boxedImage = imageOf(boxed)
  check('unsized Box media row keeps the 120-200px slot', width(boxedImage) >= 119 && width(boxedImage) <= 201, width(boxedImage) + 'px')
  check('unsized Box media row defaults to 4:3', near(ratio(boxedImage), 4 / 3, 0.02), css(boxedImage, 'aspect-ratio'))
  check('unsized Box media row is top-aligned with the group gap', css(boxed, 'gap') === '16px' && css(boxed, 'align-items') === 'flex-start', css(boxed, 'gap') + ' / ' + css(boxed, 'align-items'))

  const sized = rowOf(wide, 'Sized copy')
  const sizedImage = imageOf(sized)
  check('explicit 120px image box is honored', near(width(sizedImage), 120, 1.5), width(sizedImage) + 'px')
  check('explicit image aspect is honored', near(ratio(sizedImage), 1.5, 0.02), css(sizedImage, 'aspect-ratio'))

  const thumb = rowOf(wide, 'Thumb copy')
  check('explicit width without aspect keeps the media default ratio', near(ratio(imageOf(thumb)), 4 / 3, 0.02), css(imageOf(thumb), 'aspect-ratio'))

  const plain = wide.querySelector('.iui-image')
  const plainRow = plain?.closest('.iui-row')
  check('a block photo keeps the 3:2 default', plainRow === null && near(ratio(plain), 1.5, 0.02), css(plain, 'aspect-ratio'))

  const narrowImage = narrow.querySelector('.iui-image')
  check('narrow media row falls back to the 120px minimum', near(width(narrowImage), 120, 1.5), width(narrowImage) + 'px')

  check('page does not scroll horizontally', document.documentElement.scrollWidth <= innerWidth, document.documentElement.scrollWidth + ' > ' + innerWidth)
  return checks
})()`)

let failed = 0
for (const result of results) {
  console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.name}${result.ok ? '' : ` — ${result.detail}`}`)
  if (!result.ok) failed++
}
console.log(`media-row-check: ${results.length - failed}/${results.length} checks passed`)
await cleanup()
if (failed > 0) process.exit(1)
