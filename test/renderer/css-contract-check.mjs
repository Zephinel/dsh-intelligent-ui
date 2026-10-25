#!/usr/bin/env node
/**
 * Browser-level contract check for the renderer CSS defaults that used to
 * override or corrupt valid program props (`.tmp-audit/css.md` findings
 * CSS-A1, CSS-A3, CSS-A4, CSS-B3, CSS-B8, CSS-C3).
 *
 * The invariant, same as the media-row calibration fix: a stylesheet default
 * only fills in what the program left out. A program-chosen type size, colour,
 * alignment, photo width or carousel width must win, and a renderer default
 * must never paint over content it does not own.
 *
 *   node test/renderer/css-contract-check.mjs
 *   CHROME_BIN=/path/to/chrome node test/renderer/css-contract-check.mjs
 *
 * Skips with exit code 0 when no Chrome binary is available.
 */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeExists, connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'test/renderer/.build/css-contract-check')
if (!(await chromeExists())) {
  console.log(`css-contract-check: skipped (no Chrome at ${process.env.CHROME_BIN ?? 'the default path'}; set CHROME_BIN to run it)`)
  process.exit(0)
}

// One mount per finding: a card whose body must keep its own type, a nested
// card block, the two media-row shapes that used to be caption-driven or 0x0,
// explicit alignments, a long list marker, two carousels, one control fixture
// rendered into a light and a dark renderer host, and the structural in-card
// type caps (direct child vs Row-wrapped vs page level).
const programs = {
  card: `root = Col([bodyCard, captionCard])
bodyCard = Card([Title("CARDHEAD", "md"), Text("CARDBODYTEXT", "lg")], "outline")
captionCard = Card([Title("CAPHEAD", "md"), Caption("CAPSUBTEXT")], "outline")`,
  nested: `root = Card([Row([Box([Title("BOXEDTITLE", "md"), Text("BOXEDBODY", "md")])])], "outline")`,
  typeCard: `root = Col([directCard, rowCard, nestedCard, textCard])
directCard = Card([Title("DIRECT2XL", "2xl")], "outline")
rowCard = Card([Row([Title("ROW2XL", "2xl")])], "outline")
nestedCard = Card([Card([Row([Title("NESTED2XL", "2xl")])])], "outline")
textCard = Card([Row([Text("CARDROWMD", "md")])], "outline")`,
  typePage: `root = Col([pageTitle, pageRowTitle, pageText])
pageTitle = Title("PAGE2XL", "2xl")
pageRowTitle = Row([Title("PAGEROW2XL", "2xl")])
pageText = Text("PAGETEXTMD", "md")`,
  typeContainers: `root = Col([gridHolder, carouselHolder])
gridHolder = Grid([Col([Row([Title("GRID2XL", "2xl")])])])
carouselHolder = Carousel([Col([Row([Title("CAR2XL", "2xl")])])])`,
  mediaShort: `root = Row([Box([SearchImage("mountain meadow"), Caption("CAP")]), Text("MEDIACOPY")])`,
  mediaLong: `root = Row([Box([SearchImage("mountain meadow"), Caption("A much longer caption that used to widen the photo to the width of its own text")]), Text("MEDIACOPY")])`,
  mediaPressable: `root = Row([Pressable([SearchImage("pressable lake")]), Text("PRESSCOPY")])`,
  align: `root = Col([centered, endCol, endRow])
centered = Col([centerBadge, centerButton], null, "center")
centerBadge = Badge("CENTERED")
centerButton = Button("CENTERBTN")
endCol = Col([endColBadge], null, "end")
endColBadge = Badge("COLENDBADGE")
endRow = Row([endRowBadge, endRowCopy], null, "end")
endRowBadge = Badge("ROWENDBADGE")
endRowCopy = Text("ROWEND copy that has to wrap onto several lines so the row is clearly taller than the badge sitting beside it, which is the only way the cross-axis end alignment can be observed at all in this fixture")`,
  list: `root = List([first, second])
first = ListItem("Opening keynote session", null, "08:30 – 10:00")
second = ListItem("Closing keynote session", null, "08:30 – 13:45 (local)")`,
  carouselExplicit: `root = Carousel([cardA, cardB], 600)
cardA = Box([Text("CAROUSEL A", "md")], null, 2)
cardB = Box([Text("CAROUSEL B", "md")], null, 2)`,
  carouselDefault: `root = Carousel([defA, defB])
defA = Box([Text("DEFAULT A", "md")], null, 2)
defB = Box([Text("DEFAULT B", "md")], null, 2)`,
  schemeProbe: `$choice = "a"
root = Col([pick, dangerBtn, successBtn, selectedTile])
pick = Select($choice, ["a", "b"], "SCHEMEPICK")
dangerBtn = Button("DANGERBTN", null, "solid", "danger")
successBtn = Button("SUCCESSBTN", null, "solid", "success")
selectedTile = Pressable([Box([], "col", null, 14, "chart1", "md", null, 40, 40)], null, true, 0)`,
}

const mounts = {
  card: { program: programs.card },
  nested: { program: programs.nested },
  'type-card': { program: programs.typeCard },
  'type-page': { program: programs.typePage },
  'type-containers': { program: programs.typeContainers },
  'media-short': { program: programs.mediaShort },
  'media-long': { program: programs.mediaLong },
  'media-pressable': { program: programs.mediaPressable },
  align: { program: programs.align },
  list: { program: programs.list },
  'carousel-explicit': { program: programs.carouselExplicit },
  'carousel-default': { program: programs.carouselDefault },
  'host-light': { program: programs.schemeProbe, scheme: 'light' },
  'host-dark': { program: programs.schemeProbe, scheme: 'dark' },
}

await mkdir(outDir, { recursive: true })
const bundleDir = join(outDir, 'bundle')
await mkdir(bundleDir, { recursive: true })
const entry = join(outDir, 'entry.tsx')
await writeFile(entry, `
import { createRoot } from 'react-dom/client'
import { OpenUIRenderer } from ${JSON.stringify(join(root, 'src/lib/render.tsx'))}
// The standalone page chrome is asserted as computed style, so its sheet is part
// of the bundle (it only styles .dsh-iui-standalone-* and the page html/body).
import ${JSON.stringify(join(root, 'src/standalone/standalone.css'))}

const mounts = ${JSON.stringify(mounts)}
for (const [id, { program, scheme }] of Object.entries(mounts)) {
  createRoot(document.getElementById(id)).render(<OpenUIRenderer program={program} scheme={scheme} />)
}
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
  .mount { width: 760px; padding: 16px; box-sizing: border-box; }
  .mount.narrow { width: 360px; }
  .mount.carousel { width: 640px; }
`
await writeFile(join(bundleDir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>css contract check</title>
<style>${fixture}</style>
<link rel="stylesheet" href="app.css">
</head><body>
<div class="mount" id="card"></div>
<div class="mount" id="nested"></div>
<div class="mount" id="type-card"></div>
<div class="mount" id="type-page"></div>
<div class="mount" id="type-containers"></div>
<div class="mount" id="media-short"></div>
<div class="mount" id="media-long"></div>
<div class="mount" id="media-pressable"></div>
<div class="mount" id="align"></div>
<div class="mount" id="list"></div>
<div class="mount carousel" id="carousel-explicit"></div>
<div class="mount carousel" id="carousel-default"></div>
<div class="mount" id="host-light"></div>
<div class="mount" id="host-dark"></div>
<!-- The standalone export's list wrapper, rendered from the real bundled sheet. -->
<div class="dsh-iui-standalone-page">
  <div class="dsh-iui-cards dsh-iui-standalone-cards" id="standalone-cards">
    <div class="dsh-iui-standalone-card">exported card one</div>
    <div class="dsh-iui-standalone-card">exported card two</div>
  </div>
</div>
<script type="module" src="app.js"></script></body></html>`)

const server = await startStaticServer(bundleDir)
const sleep = (ms) => new Promise((resolveReady) => setTimeout(resolveReady, ms))
const browser = await launchChrome({ url: server.url, width: 1200, height: 1400 })
if (browser === null) {
  console.log('css-contract-check: skipped (Chrome not found; set CHROME_BIN)')
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

// Wait until every mount has parsed and mounted; the renderers parse in effects.
let ready = false
for (let i = 0; i < 80; i++) {
  ready = await cdp.evaluate(`!!document.body
    && document.body.innerText.includes('CARDBODYTEXT')
    && document.body.innerText.includes('ROWENDBADGE')
    && document.body.innerText.includes('Opening keynote session')
    && document.body.innerText.includes('CAROUSEL A')
    && document.body.innerText.includes('DANGERBTN')
    && document.body.innerText.includes('DIRECT2XL')
    && document.body.innerText.includes('PAGE2XL')
    && document.body.innerText.includes('CAR2XL')
    && document.querySelectorAll('.iui-image').length >= 3`)
  if (ready) break
  await sleep(250)
}
if (!ready) { await cleanup(); console.error('css-contract-check: fixture did not render'); process.exit(1) }
await sleep(600)

const wideResults = await cdp.evaluate(`(() => {
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })
  const css = (el, prop) => (el ? getComputedStyle(el) : null)?.getPropertyValue(prop) ?? ''
  const rect = (el) => (el ? el.getBoundingClientRect() : null)
  const width = (el) => rect(el)?.width ?? 0
  const near = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance
  const ratio = (el) => {
    const value = css(el, 'aspect-ratio')
    const parts = value.split('/').map((part) => Number(part.trim()))
    return parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : NaN
  }
  const byText = (el, selector, text) => [...(el?.querySelectorAll(selector) ?? [])].find((node) => (node.textContent ?? '').trim() === text)
  // A nowrap marker paints its text past the 76px lane while its own box stays in
  // the column, so overlap is measured on the text range (what the reader sees).
  const textRect = (el) => {
    if (el === null) return null
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getBoundingClientRect()
  }
  const beforeImage = (el) => (el === null || el === undefined ? '' : getComputedStyle(el, '::before').backgroundImage)

  const fallback = document.querySelector('.dsh-iui-fallback')
  if (fallback !== null) { check('fixture renders', false, 'renderer fallback: ' + fallback.innerText.slice(0, 160)); return checks }

  // CSS-A1: a card title heuristic may not restyle the paragraph that follows it.
  const card = document.getElementById('card')
  const cardTitle = byText(card, '.iui-title', 'CARDHEAD')
  const cardBody = byText(card, '.iui-text', 'CARDBODYTEXT')
  check('card title still reads as a 14px card title', css(cardTitle, 'font-size') === '14px', css(cardTitle, 'font-size'))
  check('card body Text keeps the requested 18px size', css(cardBody, 'font-size') === '18px', css(cardBody, 'font-size'))
  check('card body Text keeps the full-ink colour', css(cardBody, 'color') === 'rgb(15, 17, 21)', css(cardBody, 'color'))
  const cardCaption = byText(card, '.iui-caption', 'CAPSUBTEXT')
  check('a direct caption under the card title keeps the 13px subtitle treatment', cardCaption !== undefined && css(cardCaption, 'font-size') === '13px' && css(cardCaption, 'color') === 'rgba(15, 17, 21, 0.6)', css(cardCaption, 'font-size') + ' / ' + css(cardCaption, 'color'))

  const nested = document.getElementById('nested')
  const nestedTitle = byText(nested, '.iui-title', 'BOXEDTITLE')
  const nestedBody = byText(nested, '.iui-text', 'BOXEDBODY')
  check('a Box nested in a card header row keeps its 17px title', css(nestedTitle, 'font-size') === '17px', css(nestedTitle, 'font-size'))
  // CSS-B7 makes the card text scale structural: a Text(md) nested in a Row now
  // takes the same 15px card scale a direct child always had (the A1 bug was 13px muted).
  check('a Box nested in a card header row follows the 15px card text scale', css(nestedBody, 'font-size') === '15px', css(nestedBody, 'font-size'))
  check('a Box nested in a card header row keeps the full-ink colour', css(nestedBody, 'color') === 'rgb(15, 17, 21)', css(nestedBody, 'color'))

  // CSS-B7: the in-card display cap is structural, not tied to direct children:
  // a Row between the card and the heading must not bring the page size back,
  // a nested card reuses the same value, and page-level titles keep the page scale.
  const typeCard = document.getElementById('type-card')
  const cardType = (name) => css(byText(typeCard, '.iui-title, .iui-text', name), 'font-size')
  check('2xl title as a card direct child is capped at 26px', cardType('DIRECT2XL') === '26px', cardType('DIRECT2XL'))
  check('2xl title inside a Row in a card is capped at 26px', cardType('ROW2XL') === '26px', cardType('ROW2XL'))
  check('2xl title in a card nested in a card does not shrink again (26px)', cardType('NESTED2XL') === '26px', cardType('NESTED2XL'))
  check('Text(md) inside a Row in a card gets the 15px card scale', cardType('CARDROWMD') === '15px', cardType('CARDROWMD'))
  const typePage = document.getElementById('type-page')
  const pageType = (name) => css(byText(typePage, '.iui-title, .iui-text', name), 'font-size')
  check('page-level 2xl title keeps the page scale (32px)', pageType('PAGE2XL') === '32px', pageType('PAGE2XL'))
  check('page-level 2xl title in a Row keeps the page scale (32px)', pageType('PAGEROW2XL') === '32px', pageType('PAGEROW2XL'))
  check('page-level Text(md) keeps 16px', pageType('PAGETEXTMD') === '16px', pageType('PAGETEXTMD'))
  const typeContainers = document.getElementById('type-containers')
  check('2xl title inside a grid cell Row is capped at 26px', css(byText(typeContainers, '.iui-title', 'GRID2XL'), 'font-size') === '26px', css(byText(typeContainers, '.iui-title', 'GRID2XL'), 'font-size'))
  check('2xl title inside a carousel item Row is capped at 26px', css(byText(typeContainers, '.iui-title', 'CAR2XL'), 'font-size') === '26px', css(byText(typeContainers, '.iui-title', 'CAR2XL'), 'font-size'))

  // L7: the exported standalone page keeps the live 12px card column rhythm.
  const standaloneCards = document.getElementById('standalone-cards')
  check('standalone card column uses the live 12px gap', css(standaloneCards, 'gap') === '12px', css(standaloneCards, 'gap'))

  // CSS-A3: a photo in a Box keeps the media slot no matter the caption length,
  // and a photo inside a Pressable tile in a Row must never collapse to 0x0.
  const shortImage = document.querySelector('#media-short .iui-image')
  const longImage = document.querySelector('#media-long .iui-image')
  const shortWidth = width(shortImage)
  const longWidth = width(longImage)
  check('captioned media Box photos keep the 120-200px slot', shortWidth >= 119 && shortWidth <= 201 && longWidth >= 119 && longWidth <= 201, shortWidth + 'px / ' + longWidth + 'px')
  check('photo width does not follow the caption text length', near(shortWidth, longWidth, 1), shortWidth + 'px vs ' + longWidth + 'px')
  check('captioned media Box photo keeps the 4:3 default', near(ratio(shortImage), 4 / 3, 0.02), css(shortImage, 'aspect-ratio'))
  const pressableImage = document.querySelector('#media-pressable .iui-image')
  check('Pressable media photo in a Row is not collapsed', width(pressableImage) >= 119, width(pressableImage) + 'px')
  check('Pressable media photo keeps the 4:3 default', near(ratio(pressableImage), 4 / 3, 0.02), css(pressableImage, 'aspect-ratio'))

  // CSS-B3: an explicit align= on Row/Col must beat the renderer's align-self defaults.
  const align = document.getElementById('align')
  const centerBadge = byText(align, '.iui-badge', 'CENTERED')
  const centerButton = byText(align, '.iui-button', 'CENTERBTN')
  const centeredCol = centerBadge?.closest('.iui-col') ?? null
  const centeredRect = rect(centeredCol)
  const centerDelta = (el) => {
    const itemRect = rect(el)
    if (itemRect === null || centeredRect === null) return NaN
    return Math.abs((itemRect.left + itemRect.right) / 2 - (centeredRect.left + centeredRect.right) / 2)
  }
  check('Col(align=center) centers a badge', centerDelta(centerBadge) <= 1, centerDelta(centerBadge).toFixed(2) + 'px off')
  check('Col(align=center) centers a button', centerDelta(centerButton) <= 1, centerDelta(centerButton).toFixed(2) + 'px off')
  const colEndBadge = byText(align, '.iui-badge', 'COLENDBADGE')
  const endCol = colEndBadge?.closest('.iui-col') ?? null
  check('Col(align=end) pushes a badge to the right', endCol !== null && Math.abs(rect(colEndBadge).right - rect(endCol).right) <= 1, endCol === null ? 'missing' : (rect(endCol).right - rect(colEndBadge).right).toFixed(2) + 'px gap')
  const rowEndBadge = byText(align, '.iui-badge', 'ROWENDBADGE')
  const endRow = rowEndBadge?.closest('.iui-row') ?? null
  const rowEndRect = rect(endRow)
  const rowEndBadgeRect = rect(rowEndBadge)
  check('Row(align=end) fixture is taller than the badge', rowEndRect !== null && rowEndBadgeRect !== null && rowEndRect.height > rowEndBadgeRect.height + 20, rowEndRect === null ? 'missing' : rowEndRect.height.toFixed(1) + 'px row / ' + rowEndBadgeRect.height.toFixed(1) + 'px badge')
  check('Row(align=end) moves a badge to the row end', rowEndRect !== null && rowEndBadgeRect !== null && Math.abs(rowEndBadgeRect.bottom - rowEndRect.bottom) <= 1, rowEndRect === null ? 'missing' : (rowEndRect.bottom - rowEndBadgeRect.bottom).toFixed(2) + 'px off')

  // CSS-A4: a long ListItem marker wraps inside the fixed lane instead of painting over the title.
  const list = document.getElementById('list')
  const listItems = [...(list?.querySelectorAll('.iui-list > li') ?? [])]
  check('list fixture renders both items', listItems.length === 2, String(listItems.length))
  for (const item of listItems) {
    const marker = item.querySelector('.iui-list-marker')
    const title = item.querySelector('.iui-list-title')
    const markerRect = textRect(marker)
    const titleRect = rect(title)
    const itemRect = rect(item)
    const label = (title?.textContent ?? '').trim()
    check('marker does not overlap the title (' + label + ')', markerRect !== null && titleRect !== null && markerRect.right <= titleRect.left + 1, markerRect === null || titleRect === null ? 'missing' : (markerRect.right - titleRect.left).toFixed(2) + 'px')
    check('list keeps the 76px marker column (' + label + ')', itemRect !== null && titleRect !== null && near(titleRect.left - itemRect.left, 92, 1), itemRect === null || titleRect === null ? 'missing' : (titleRect.left - itemRect.left).toFixed(2) + 'px lane+gap')
  }
  const longMarker = listItems[1]?.querySelector('.iui-list-marker') ?? null
  check('a time marker wraps inside its lane', css(longMarker, 'white-space') === 'normal' && rect(longMarker) !== null && rect(longMarker).height > 24, css(longMarker, 'white-space') + ' / ' + (rect(longMarker)?.height ?? 0).toFixed(1) + 'px')

  // CSS-C3: an explicit itemWidth wins; only an item without an inline width is peek-capped.
  const explicitCarousel = document.getElementById('carousel-explicit')
  const explicitItems = [...(explicitCarousel?.querySelectorAll('.iui-carousel-item') ?? [])]
  check('explicit itemWidth 600 is rendered at 600px', explicitItems.length === 2 && explicitItems.every((item) => width(item) >= 599), explicitItems.map((item) => width(item).toFixed(1)).join(' / '))
  const defaultCarousel = document.getElementById('carousel-default')
  const defaultTrack = defaultCarousel?.querySelector('.iui-carousel-track') ?? null
  const defaultItems = [...(defaultCarousel?.querySelectorAll('.iui-carousel-item') ?? [])]
  const trackWidth = width(defaultTrack)
  check('default carousel item leaves the next item peeking', defaultItems.length > 0 && trackWidth > 0 && defaultItems.every((item) => width(item) > 0 && width(item) <= trackWidth * 0.85 + 1), defaultItems.map((item) => width(item).toFixed(1)).join(' / ') + ' on a ' + trackWidth.toFixed(1) + 'px track')
  // The Carousel component currently writes an inline width for both paths, so the
  // 85% rule is probed on its own: an item without an inline width is capped, an
  // item with one (the explicit itemWidth path) escapes the cap.
  const probeTrack = document.createElement('div')
  probeTrack.className = 'iui-carousel-track'
  probeTrack.style.cssText = 'display: flex; width: 400px;'
  const probeItem = document.createElement('div')
  probeItem.className = 'iui-carousel-item'
  probeTrack.appendChild(probeItem)
  document.body.appendChild(probeTrack)
  const capWithoutWidth = css(probeItem, 'max-width')
  probeItem.style.width = '600px'
  const capWithWidth = css(probeItem, 'max-width')
  check('an unsized carousel item keeps the 85% peek cap', capWithoutWidth === '85%', capWithoutWidth)
  check('a carousel item with an inline width is not capped', capWithWidth === 'none', capWithWidth)

  // CSS-B8: a host-scoped dark scheme gets the same colour rules as body[data-ds-dark-theme].
  const hostLight = document.getElementById('host-light')
  const hostDark = document.getElementById('host-dark')
  check('dark host carries data-iui-scheme="dark"', hostDark?.querySelector('.dsh-iui-host[data-iui-scheme="dark"]') !== null, String(hostDark?.querySelector('.dsh-iui-host')?.getAttribute('data-iui-scheme')))
  const lightSelect = hostLight?.querySelector('.iui-select') ?? null
  const darkSelect = hostDark?.querySelector('.iui-select') ?? null
  check('dark host select uses the light-on-dark arrow', css(darkSelect, 'background-image').includes('ababab'), css(darkSelect, 'background-image').slice(0, 60))
  check('light host select keeps the dark-on-light arrow', css(lightSelect, 'background-image').includes('676767'), css(lightSelect, 'background-image').slice(0, 60))
  const darkDanger = byText(hostDark, '.iui-button', 'DANGERBTN')
  const darkSuccess = byText(hostDark, '.iui-button', 'SUCCESSBTN')
  const lightDanger = byText(hostLight, '.iui-button', 'DANGERBTN')
  check('dark host solid danger button text flips to ink', css(darkDanger, 'color') === 'rgb(18, 18, 18)', css(darkDanger, 'color'))
  check('dark host solid success button text flips to ink', css(darkSuccess, 'color') === 'rgb(18, 18, 18)', css(darkSuccess, 'color'))
  check('light host solid danger button text stays white', css(lightDanger, 'color') === 'rgb(255, 255, 255)', css(lightDanger, 'color'))
  const darkTile = hostDark?.querySelector('.iui-pressable.is-selected') ?? null
  const lightTile = hostLight?.querySelector('.iui-pressable.is-selected') ?? null
  check('dark host selected tile check glyph flips to ink', beforeImage(darkTile).includes('23171717'), beforeImage(darkTile).slice(0, 80))
  check('light host selected tile keeps the white check glyph', lightTile !== null && getComputedStyle(lightTile, '::before').content !== 'none' && !beforeImage(lightTile).includes('23171717'), beforeImage(lightTile).slice(0, 60))

  return checks
})()`)

// The responsive list lane: at a <=640px viewport the marker column is 64px + 20px
// gap, and the long marker still may not overlap the title.
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 1400, deviceScaleFactor: 1, mobile: false })
await sleep(400)
const narrowResults = await cdp.evaluate(`(() => {
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })
  const rect = (el) => (el ? el.getBoundingClientRect() : null)
  const textRect = (el) => {
    if (el === null) return null
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getBoundingClientRect()
  }
  const near = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance
  const list = document.getElementById('list')
  check('narrow viewport matches the responsive breakpoint', innerWidth <= 640, String(innerWidth))
  const listItems = [...(list?.querySelectorAll('.iui-list > li') ?? [])]
  for (const item of listItems) {
    const marker = item.querySelector('.iui-list-marker')
    const title = item.querySelector('.iui-list-title')
    const markerRect = textRect(marker)
    const titleRect = rect(title)
    const itemRect = rect(item)
    const label = (title?.textContent ?? '').trim()
    check('narrow viewport: marker does not overlap the title (' + label + ')', markerRect !== null && titleRect !== null && markerRect.right <= titleRect.left + 1, markerRect === null || titleRect === null ? 'missing' : (markerRect.right - titleRect.left).toFixed(2) + 'px')
    check('narrow viewport: list keeps the 64px marker column (' + label + ')', itemRect !== null && titleRect !== null && near(titleRect.left - itemRect.left, 84, 1), itemRect === null || titleRect === null ? 'missing' : (titleRect.left - itemRect.left).toFixed(2) + 'px lane+gap')
  }
  return checks
})()`)

const results = [...wideResults, ...narrowResults]
let failed = 0
for (const result of results) {
  console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.name}${result.ok ? '' : ` — ${result.detail}`}`)
  if (!result.ok) failed++
}
console.log(`css-contract-check: ${results.length - failed}/${results.length} checks passed`)
await cleanup()
if (failed > 0) process.exit(1)
