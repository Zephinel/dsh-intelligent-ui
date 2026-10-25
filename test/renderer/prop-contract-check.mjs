#!/usr/bin/env node
/**
 * Browser-level contract check for component props and @functions.
 *
 * The component docs promise behaviour the renderer must deliver for a
 * compliant program: surface/paint tokens work as SVG fills, a raw CSS color
 * background gets readable content, Carousel(itemWidth) is honored, Chart's
 * default series is every number key and its stacked bars keep negative values,
 * SearchImage takes any sane aspectRatio, Table shows the number the program
 * wrote, YouTube takes a /live/ URL, Length accepts CSS length expressions,
 * Slider shows/writes the bound value, canvas/on-ink stay paint-only, a
 * Flashcard may contain controls, a number Input reads a decimal comma, and
 * Markdown nests lists and renders h5/h6. The @functions docs promise domains
 * return null/"" instead of throwing: a throw inside a prop used to replace
 * the whole card with the renderer fallback, so both the value and the absence
 * of the fallback matter.
 *
 *   node test/renderer/prop-contract-check.mjs
 *   CHROME_BIN=/path/to/chrome node test/renderer/prop-contract-check.mjs
 *
 * Skips with exit code 0 when no Chrome binary is available.
 */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeExists, connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'test/renderer/.build/prop-contract-check')
if (!(await chromeExists())) {
  console.log(`prop-contract-check: skipped (no Chrome at ${process.env.CHROME_BIN ?? 'the default path'}; set CHROME_BIN to run it)`)
  process.exit(0)
}

// One program per container, so a rendering failure in one contract cannot mask
// the checks of another.
const MARKDOWN = [
  '- Top',
  '  - Nested one',
  '  - Nested two',
  '- Second',
  '  1. First step',
  '  2. Second step',
  '',
  '##### Five hashes',
  '###### Six hashes',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '> A quote',
  '',
  '```',
  'code line',
  '```',
].join('\n')

const PROGRAMS = {
  components: `root = Col([drawing, wash, named, deep, alphaHex, photos, gallery, chart, table, video])
drawing = Svg([borderRect, borderStroke, strongRect], "0 0 240 160")
borderRect = Rect(10, 10, 80, 60, "border")
borderStroke = Path("M10 120 L120 120", null, "border", 2)
strongRect = Rect(130, 20, 80, 60, "surface-strong")
wash = Box([washText], null, null, 2, "rgba(0,0,0,0.06)")
washText = Text("wash text")
named = Box([namedText], null, null, 2, "black")
namedText = Text("named text")
deep = Box([deepText], null, null, 2, "hsl(220 90% 20%)")
deepText = Text("deep text")
alphaHex = Box([alphaHexText], null, null, 2, "#101010ee")
alphaHexText = Text("alpha hex text")
photos = Col([tallPhoto, widePhoto])
tallPhoto = Box([SearchImage("tall poster", 0.1)], null, null, null, null, null, null, 80)
widePhoto = Box([SearchImage("wide mural", 6)], null, null, null, null, null, null, 80)
gallery = Carousel([Card([Text("C1")]), Card([Text("C2")])], 600)
chart = Chart("bar", [{m: "Jan", a: 1}, {m: "Feb", a: 3, b: 2}], "m")
table = Table(["Year"], [[2024]])
video = YouTube("https://www.youtube.com/live/abcdefghijk")`,

  functions: `root = Col([rootLine, powLine, percentLine, lerpLine])
rootLine = Text("Root: " + @Sqrt(-4))
powLine = Text("Pow: " + @Pow(-8, 1 / 3))
percentLine = Text("Percent: " + @Percent(3, 4))
lerpLine = Text("Lerp: " + @Lerp(0, 10, 0.25))`,

  dates: `root = Col([picker, dateLine, badLine, addLine, spanLine, startLine, goodLine, directLine])
$d = ""
picker = DatePicker($d, "Pick a date")
dateLine = Text("Date: " + @FormatDate($d))
badLine = Text("Bad: " + @FormatDate("soon"))
addLine = Text("Add: " + @AddDays($d, 1))
spanLine = Text("Span: " + @DaysBetween($d, "2026-01-01"))
startLine = Text("Start: " + @StartOf($d, "month"))
goodLine = Text("Good: " + @FormatDate("2026-10-09"))
directLine = Caption(@FormatDate($d))`,

  lengths: `root = Col([calcBox, halfBox, minBox, vwBox, urlBox])
calcBox = Box([Text("CALCBOX")], null, null, null, null, null, null, "calc(100% - 32px)")
halfBox = Box([Text("HALFBOX")], null, null, null, null, null, null, "50%")
minBox = Box([Text("MINBOX")], null, null, null, null, null, null, "min(50%, 200px)")
vwBox = Box([Text("VWBOX")], null, null, null, null, null, null, "50vw")
urlBox = Box([Text("URLBOX")], null, null, null, null, null, null, "url(x)")`,

  'row-width': `root = Row([strBox, copy], 2)
strBox = Box([Text("STRBOX")], null, null, null, null, null, null, "50%")
copy = Text("Long copy beside a half-width box that must keep its width and wrap underneath it")`,

  stacked: `root = Col([barChart, areaChart])
barChart = Chart("bar", [{m: "A", a: 5, b: -3}, {m: "B", a: 4, b: -2}], "m", ["a", "b"], "number", null, true)
areaChart = Chart("area", [{m: "A", a: 5, b: -3}, {m: "B", a: 4, b: -2}], "m", ["a", "b"], "number", null, true)`,

  tooltip: `root = Chart("bar", [{cat: "Category alpha one", alphaRevenueNorthAmerica: 1200, betaRevenueNorthAmerica: 800, gammaRevenueNorthAmerica: 400, deltaRevenueNorthAmerica: 200}, {cat: "Category beta two", alphaRevenueNorthAmerica: 900, betaRevenueNorthAmerica: 600, gammaRevenueNorthAmerica: 300, deltaRevenueNorthAmerica: 100}], "cat", ["alphaRevenueNorthAmerica", "betaRevenueNorthAmerica", "gammaRevenueNorthAmerica", "deltaRevenueNorthAmerica"], "number")`,

  slider: `root = Col([fineSlider, fineState, clampSlider, clampState])
$p = 0.1234
$v = 150
fineSlider = Slider($p, 0, 1, 0.001, "Precision", "%")
fineState = Text("Fine: " + $p)
clampSlider = Slider($v, 0, 100, 1, "Clamped", "%")
clampState = Text("Clamped: " + $v)`,

  tokens: `root = Col([canvasTitle, canvasText, onInkIcon, canvasRect])
canvasTitle = Title("CANVAS TITLE", "md", "canvas")
canvasText = Text("CANVAS TEXT", "md", "on-ink")
onInkIcon = Icon("star", "md", "on-ink")
canvasRect = Svg([Rect(0, 0, 40, 40, "canvas")], "0 0 80 80")`,

  flashcard: `root = Flashcard([playButton], "Back side", "Hint")
playButton = Button("PLAYBTN", null)`,

  input: `root = Col([amountInput, amountText])
$n = 0
amountInput = Input($n, "Amount", "number")
amountText = Text("Amount: " + $n)`,

  markdown: `root = Markdown(${JSON.stringify(MARKDOWN)})`,

  domains: `root = Col([randomLine, rangeLine, histLine, convertLine, mixLine, paymentLine, movingLine, chunkLine, allocateLine, rangeOk, mixOk, convertOk, paymentOk])
randomLine = Text("Random: " + @Random(0.2, 0.8, true))
rangeLine = Text("Range: " + @Range(0, 5, 0))
histLine = Text("Hist: " + @Histogram([1, 2, 3], 0))
convertLine = Text("Convert: " + @Convert(1, "kg", "m"))
mixLine = Text("Mix: " + @MixColor("black", "#ffffff", 0.5))
paymentLine = Text("Payment: " + @Payment(1000, 5, 0))
movingLine = Text("Moving: " + @MovingAvg([1, 2, 3], "", 0))
chunkLine = Text("Chunk: " + @Chunk([1, 2, 3], 0))
allocateLine = Text("Allocate: " + @Allocate(10, [-1, 2]))
rangeOk = Text("RangeOK: " + @Range(0, 3))
mixOk = Text("MixOK: " + @MixColor("#000000", "#ffffff", 0.5))
convertOk = Text("ConvertOK: " + @Convert(1, "km", "m"))
paymentOk = Text("PaymentOK: " + @Payment(1000, 0, 10))`,
}

await mkdir(outDir, { recursive: true })
const bundleDir = join(outDir, 'bundle')
await mkdir(bundleDir, { recursive: true })
const entry = join(outDir, 'entry.tsx')
await writeFile(
  entry,
  `
import { createRoot } from 'react-dom/client'
import { OpenUIRenderer } from ${JSON.stringify(join(root, 'src/lib/render.tsx'))}

const programs = ${JSON.stringify(PROGRAMS)}
for (const [id, program] of Object.entries(programs)) {
  createRoot(document.getElementById(id)).render(<OpenUIRenderer program={program} />)
}
`,
)

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
  #components, #functions, #dates, #lengths, #row-width, #stacked, #slider, #tokens, #flashcard, #input, #domains { width: 640px; padding: 16px; box-sizing: border-box; }
  #tooltip { width: 380px; padding: 16px; box-sizing: border-box; }
  #markdown { width: 700px; padding: 16px; box-sizing: border-box; }
`
const ids = Object.keys(PROGRAMS)
await writeFile(
  join(bundleDir, 'index.html'),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>prop contract check</title>
<style>${fixture}</style>
<link rel="stylesheet" href="app.css">
</head><body>${ids.map((id) => `<div id="${id}"></div>`).join('')}<script type="module" src="app.js"></script></body></html>`,
)

const server = await startStaticServer(bundleDir)
const sleep = (ms) => new Promise((ready) => setTimeout(ready, ms))
const browser = await launchChrome({ url: server.url, width: 1200, height: 1400 })
if (browser === null) {
  console.log('prop-contract-check: skipped (Chrome not found; set CHROME_BIN)')
  server.close()
  process.exit(0)
}
const cdp = await connectCdp(browser.port)
const cleanup = async () => {
  cdp.close()
  await browser.cleanup()
  server.close()
}
process.on('exit', () => {
  try {
    browser.process.kill('SIGKILL')
  } catch {
    /* ignore */
  }
})

let ready = false
for (let i = 0; i < 80; i++) {
  ready = await cdp.evaluate(
    `document.querySelectorAll('.dsh-iui-root').length === ${ids.length} && document.querySelectorAll('.iui-chart svg').length >= 2 && document.querySelectorAll('.iui-carousel-item').length > 0 && !!document.querySelector('#dates input')`,
  )
  if (ready) break
  await sleep(250)
}
if (!ready) {
  await cleanup()
  console.error('prop-contract-check: fixture did not render')
  process.exit(1)
}
await sleep(800)

/** Runs in the page; resolves [{ name, ok, detail }]. Self-contained by design. */
async function collectChecks() {
  const wait = (ms) => new Promise((done) => setTimeout(done, ms))
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: String(detail ?? '') })
  const css = (el, prop) => (el ? getComputedStyle(el).getPropertyValue(prop) : '') ?? ''
  const width = (el) => (el ? el.getBoundingClientRect().width : 0)
  const near = (actual, expected, tolerance) => Math.abs(actual - expected) <= tolerance
  const containers = ['components', 'functions', 'dates', 'lengths', 'row-width', 'stacked', 'tooltip', 'slider', 'tokens', 'flashcard', 'input', 'markdown', 'domains'].map((id) => document.getElementById(id))
  const [components, functions, dates, lengths, rowWidth, stacked, tooltip, slider, tokens, flashcard, input, markdown, domains] = containers
  if (containers.some((box) => box === null)) {
    check('fixtures render', false, 'missing container')
    return checks
  }
  const rootColor = css(components.querySelector('.dsh-iui-root'), 'color')
  const textOf = (container, prefix) => {
    const el = [...container.querySelectorAll('.iui-text')].find((node) => (node.textContent ?? '').trim().startsWith(prefix))
    return el ? el.textContent.trim() : null
  }
  const boxByText = (container, marker) => [...container.querySelectorAll('.iui-box')].find((el) => (el.textContent ?? '').includes(marker)) ?? null
  const tokenColorIn = (container, name) => {
    // The tokens are scoped to the renderer host, so the probe must live inside it.
    const host = container.querySelector('.dsh-iui-root')
    const probe = document.createElement('span')
    probe.style.cssText = `position: absolute; left: -9999px; color: var(${name})`
    host.appendChild(probe)
    const value = css(probe, 'color')
    probe.remove()
    return value
  }
  // getComputedStyle serializes an SVG paint and a CSS color differently for
  // color-mix() results, so compare both through the browser's own normalizer.
  const paintCtx = document.createElement('canvas').getContext('2d')
  const normalizePaint = (value) => {
    paintCtx.fillStyle = '#010203'
    paintCtx.fillStyle = value
    return paintCtx.fillStyle
  }
  const samePaint = (actual, expected) => actual !== 'none' && normalizePaint(actual) === normalizePaint(expected) && normalizePaint(actual) !== 'rgb(0, 0, 0)'

  // Render fallback: a prop-level @function throw replaces the whole card.
  const fallback = containers.map((box) => box.querySelector('.dsh-iui-fallback')).find((note) => note !== null) ?? null
  check('no part of the fixture hits the whole-card fallback', fallback === null, fallback ? fallback.innerText.slice(0, 160) : '')

  // --- C01: surface/paint tokens as SVG fills/strokes.
  const borderToken = tokenColorIn(components, '--iui-border')
  const strongToken = tokenColorIn(components, '--iui-surface-strong')
  const shapes = [...components.querySelectorAll('.iui-svg rect, .iui-svg path')]
  const borderRect = shapes[0] ?? null
  const borderStroke = shapes[1] ?? null
  const strongRect = shapes[2] ?? null
  const fillOf = (el) => css(el, 'fill')
  check('Svg Rect fill "border" paints the border token', borderRect !== null && samePaint(fillOf(borderRect), borderToken), `${fillOf(borderRect)} vs token ${borderToken}`)
  check('Svg Path stroke "border" paints the border token', borderStroke !== null && samePaint(css(borderStroke, 'stroke'), borderToken), `${css(borderStroke, 'stroke')} vs token ${borderToken}`)
  check(
    'Svg Rect fill "surface-strong" paints the surface-strong token',
    strongRect !== null && samePaint(fillOf(strongRect), strongToken),
    `${fillOf(strongRect)} vs token ${strongToken}`,
  )

  // --- C02: content colour on raw CSS backgrounds (alpha washes and named/hsl/8-digit colors).
  const parseRgb = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value)
    if (m === null) return null
    const parts = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number)
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
  }
  const linear = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const luminance = (c) => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b)
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  const overCanvas = (color) => ({ r: color.r * color.a + 255 * (1 - color.a), g: color.g * color.a + 255 * (1 - color.a), b: color.b * color.a + 255 * (1 - color.a), a: 1 })
  const boxCheck = (marker) => {
    const box = boxByText(components, marker)
    const text = box ? box.querySelector('.iui-text') : null
    const background = box ? parseRgb(css(box, 'background-color')) : null
    const content = text ? parseRgb(css(text, 'color')) : null
    if (box === null || text === null || background === null || content === null) return { box, text, background, content, ratio: 0 }
    return { box, text, background, content, ratio: contrast(overCanvas(background), content) }
  }
  const wash = boxCheck('wash text')
  const named = boxCheck('named text')
  const deep = boxCheck('deep text')
  const alphaHex = boxCheck('alpha hex text')
  const readable = (result) => result.ratio > 3
  const lightInk = (result) => result.content !== null && result.content.r > 200 && result.content.g > 200 && result.content.b > 200
  check('Box(rgba wash) keeps readable text', readable(wash), `contrast ${wash.ratio.toFixed(2)}:1`)
  check('Box(rgba wash) keeps the theme ink instead of forcing white', wash.content !== null && css(wash.text, 'color') === rootColor, `${css(wash.text, 'color')} vs ${rootColor}`)
  check('Box("black") flips its text to a readable light color', readable(named) && lightInk(named), `contrast ${named.ratio.toFixed(2)}:1, text ${css(named.text, 'color')}`)
  check('Box(hsl(...) dark) flips its text to a readable light color', readable(deep) && lightInk(deep), `contrast ${deep.ratio.toFixed(2)}:1, text ${css(deep.text, 'color')}`)
  check('Box(8-digit hex dark) flips its text to a readable light color', readable(alphaHex) && lightInk(alphaHex), `contrast ${alphaHex.ratio.toFixed(2)}:1, text ${css(alphaHex.text, 'color')}`)

  // --- C03 (JS half): Carousel itemWidth is honored (CSS cap is the other half).
  const item = components.querySelector('.iui-carousel-item')
  check('Carousel itemWidth 600 renders at 600px', item !== null && width(item) >= 599, `${width(item).toFixed(2)}px (the 85% CSS peek cap is the stylesheet half)`)

  // --- C04: default series = every numeric key across rows.
  const legend = components.querySelector('.iui-chart-legend')
  const legendItems = legend ? [...legend.querySelectorAll('span')] : []
  const legendNames = legendItems.map((span) => (span.textContent ?? '').trim())
  check('Chart default series includes a key that only later rows have', legendNames.length === 2 && legendNames.includes('a') && legendNames.includes('b'), legendNames.join(',') || 'no legend')

  // --- C11: aspectRatio accepts a wide sane range and stays inline.
  const ratioOf = (el) => {
    const parts = css(el, 'aspect-ratio')
      .split('/')
      .map((part) => Number(part.trim()))
    return parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : NaN
  }
  const images = [...components.querySelectorAll('.iui-image')]
  check('SearchImage aspectRatio 0.1 is honored', images[0] !== undefined && near(ratioOf(images[0]), 0.1, 0.005), images[0] ? css(images[0], 'aspect-ratio') : 'no image')
  check('SearchImage aspectRatio 6 is honored', images[1] !== undefined && near(ratioOf(images[1]), 6, 0.05), images[1] ? css(images[1], 'aspect-ratio') : 'no image')

  // --- C14: Table cells are the program's own numbers.
  const cells = [...components.querySelectorAll('.iui-table tbody td')]
  check('Table renders the raw program number (no locale regrouping)', cells.length === 1 && (cells[0].textContent ?? '').trim() === '2024', cells.map((td) => (td.textContent ?? '').trim()).join(',') || 'no cell')
  check('Table number column stays right aligned', cells.length === 1 && cells[0].classList.contains('is-numeric'), cells[0] ? cells[0].className : 'no cell')

  // --- C22: YouTube /live/ URL.
  const iframe = components.querySelector('.iui-video iframe')
  const src = iframe ? iframe.getAttribute('src') ?? '' : ''
  check('YouTube /live/ URL renders an embed', src.includes('embed/abcdefghijk'), src || 'no iframe')

  // --- F01: @Sqrt and @Pow domains are null, not a whole-card failure.
  check('@Sqrt(-4) renders nothing instead of failing the card', textOf(functions, 'Root:') === 'Root:', JSON.stringify(textOf(functions, 'Root:')))
  check('@Pow(-8, 1 / 3) renders nothing instead of failing the card', textOf(functions, 'Pow:') === 'Pow:', JSON.stringify(textOf(functions, 'Pow:')))
  check('@Percent in-domain value is unchanged', textOf(functions, 'Percent:') === 'Percent: 75', JSON.stringify(textOf(functions, 'Percent:')))
  check('@Lerp in-domain value is unchanged', textOf(functions, 'Lerp:') === 'Lerp: 2.5', JSON.stringify(textOf(functions, 'Lerp:')))

  // --- F02: an empty DatePicker value through the date functions.
  check('@FormatDate("") renders nothing instead of failing the card', textOf(dates, 'Date:') === 'Date:', JSON.stringify(textOf(dates, 'Date:')))
  check('@FormatDate("soon") renders nothing instead of failing the card', textOf(dates, 'Bad:') === 'Bad:', JSON.stringify(textOf(dates, 'Bad:')))
  check('@AddDays("") renders nothing instead of failing the card', textOf(dates, 'Add:') === 'Add:', JSON.stringify(textOf(dates, 'Add:')))
  check('@DaysBetween("") renders nothing instead of failing the card', textOf(dates, 'Span:') === 'Span:', JSON.stringify(textOf(dates, 'Span:')))
  check('@StartOf("") renders nothing instead of failing the card', textOf(dates, 'Start:') === 'Start:', JSON.stringify(textOf(dates, 'Start:')))
  check('@FormatDate in-domain value is unchanged', textOf(dates, 'Good:') === 'Good: Oct 9, 2026', JSON.stringify(textOf(dates, 'Good:')))
  check('@FormatDate("") passed straight to a string prop does not fail the card', dates.querySelector('.dsh-iui-fallback') === null && [...dates.querySelectorAll('.iui-caption')].length === 1, String([...dates.querySelectorAll('.iui-caption')].length) + ' caption(s), fallback ' + String(dates.querySelector('.dsh-iui-fallback') !== null))
  check('the selector itself still renders beside the empty value', dates.querySelector('input[type="date"]') !== null, 'no DatePicker input')

  // --- C05: stacked bars keep negative values (positive up, negative down).
  const stackedSvgs = [...stacked.querySelectorAll('.iui-chart svg')]
  const stackedSvg = stackedSvgs[0] ?? null
  const areaSvg = stackedSvgs[1] ?? null
  const stackedBars = stackedSvg ? [...stackedSvg.querySelectorAll('rect')].filter((rect) => !rect.classList.contains('iui-chart-hover')) : []
  const barBoxes = stackedBars.map((rect) => ({ y: Number(rect.getAttribute('y')), height: Number(rect.getAttribute('height')) }))
  check('stacked bars keep negative values visible', barBoxes.length === 4 && barBoxes.every((bar) => bar.height > 20), barBoxes.map((bar) => `y${bar.y.toFixed(1)}/h${bar.height.toFixed(1)}`).join(' '))
  check(
    'stacked negative bars stack below the zero line',
    barBoxes.length === 4 && [0, 2].every((i) => near(barBoxes[i].y + barBoxes[i].height, barBoxes[i + 1].y, 1.5) && barBoxes[i + 1].y > barBoxes[i].y),
    barBoxes.length === 4 ? `row0 zero ${(barBoxes[0].y + barBoxes[0].height).toFixed(1)} vs ${barBoxes[1].y.toFixed(1)}` : 'missing bars',
  )
  const stackedTicks = stackedSvg ? [...stackedSvg.querySelectorAll('.iui-chart-tick')].map((tick) => (tick.textContent ?? '').trim()) : []
  check('stacked chart axis covers the negative range', stackedTicks.some((tick) => tick.startsWith('-') || tick.startsWith('−')), stackedTicks.join(','))
  const zeroLine = areaSvg ? [...areaSvg.querySelectorAll('.iui-chart-grid')].find((line) => !line.getAttribute('stroke-dasharray')) ?? null : null
  const areaPoints = areaSvg ? [...areaSvg.querySelectorAll('circle')] : []
  const negativePoints = areaPoints.slice(2, 4)
  check(
    'stacked area points keep negative values below the zero line',
    zeroLine !== null && negativePoints.length === 2 && negativePoints.every((point) => Number(point.getAttribute('cy')) > Number(zeroLine.getAttribute('y1')) + 5),
    zeroLine ? `zero ${zeroLine.getAttribute('y1')}, negatives ${negativePoints.map((point) => point.getAttribute('cy')).join(',')}` : 'no zero grid line',
  )
  if (stackedSvg !== null) {
    const box = stackedSvg.getBoundingClientRect()
    stackedSvg.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + box.width * 0.3, clientY: box.top + 20, bubbles: true }))
    await wait(80)
    const tip = stacked.querySelector('.iui-chart-tooltip')
    check('stacked tooltip keeps the raw value of a negative series', tip !== null && (tip.textContent ?? '').includes('-3'), tip ? tip.textContent : 'no tooltip')
  } else {
    check('stacked tooltip keeps the raw value of a negative series', false, 'no chart svg')
  }

  // --- CSS-B5: the chart tooltip stays inside a narrow card.
  const tooltipSvg = tooltip.querySelector('.iui-chart svg')
  const tooltipFigure = tooltip.querySelector('.iui-chart')
  if (tooltipSvg !== null) {
    const box = tooltipSvg.getBoundingClientRect()
    tooltipSvg.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + box.width * 0.15, clientY: box.top + 30, bubbles: true }))
    await wait(80)
    const tip = tooltip.querySelector('.iui-chart-tooltip')
    const tipRect = tip ? tip.getBoundingClientRect() : null
    const figureRect = tooltipFigure ? tooltipFigure.getBoundingClientRect() : null
    check(
      'chart tooltip stays inside a 380px card',
      tipRect !== null && figureRect !== null && tipRect.left >= figureRect.left - 0.5 && tipRect.right <= figureRect.right + 0.5 && tipRect.left >= 0,
      tipRect === null ? 'no tooltip' : `tooltip ${tipRect.left.toFixed(1)}-${tipRect.right.toFixed(1)} vs figure ${figureRect.left.toFixed(1)}-${figureRect.right.toFixed(1)}`,
    )
  } else {
    check('chart tooltip stays inside a 380px card', false, 'no chart svg')
  }

  // --- C06: Length accepts safe CSS length expressions.
  const calcBox = boxByText(lengths, 'CALCBOX')
  const halfBox = boxByText(lengths, 'HALFBOX')
  const minBox = boxByText(lengths, 'MINBOX')
  const vwBox = boxByText(lengths, 'VWBOX')
  const urlBox = boxByText(lengths, 'URLBOX')
  check('Length "calc(100% - 32px)" resolves and stays inside its column', calcBox !== null && near(width(calcBox), 576, 1.5) && width(calcBox) < 608, calcBox ? `${width(calcBox).toFixed(1)}px` : 'missing box')
  check('Length "50%" still resolves', halfBox !== null && near(width(halfBox), 304, 1.5), halfBox ? `${width(halfBox).toFixed(1)}px` : 'missing box')
  check('Length "min(50%, 200px)" resolves', minBox !== null && near(width(minBox), 200, 1.5), minBox ? `${width(minBox).toFixed(1)}px` : 'missing box')
  check('Length "50vw" resolves with a viewport unit', vwBox !== null && near(width(vwBox), 600, 1.5), vwBox ? `${width(vwBox).toFixed(1)}px` : 'missing box')
  check('an unsafe Length "url(x)" is ignored', urlBox !== null && !urlBox.getAttribute('style')?.includes('width') && width(urlBox) > 500, urlBox ? `${width(urlBox).toFixed(1)}px, style ${urlBox.getAttribute('style')}` : 'missing box')

  // --- C07: a string width in a Row is not flex-shrunk.
  const row = rowWidth.querySelector('.iui-row')
  const strBox = boxByText(rowWidth, 'STRBOX')
  const rowContentWidth = row ? row.getBoundingClientRect().width : 0
  check('a string width is not flex-shrunk beside long copy', strBox !== null && rowContentWidth > 0 && near(width(strBox), rowContentWidth / 2, 3), `${width(strBox).toFixed(1)} of ${rowContentWidth.toFixed(1)}`)
  check('a string-width box keeps flex-shrink at 0', strBox !== null && css(strBox, 'flex-shrink') === '0', strBox ? css(strBox, 'flex-shrink') : 'missing box')

  // --- C18/C19: Slider shows the bound value and writes an out-of-range value back.
  const sliders = [...slider.querySelectorAll('.iui-slider')]
  const fineOutput = sliders[0] ? (sliders[0].querySelector('output')?.textContent ?? '') : ''
  const clampReadout = sliders[1] ? (sliders[1].querySelector('output')?.textContent ?? '') : ''
  const clampRange = sliders[1]?.querySelector('input[type="range"]') ?? null
  const clampState = textOf(slider, 'Clamped:')
  for (let i = 0; i < 40 && clampState !== null && !clampState.includes('100'); i++) await wait(25)
  const clampStateAfter = textOf(slider, 'Clamped:')
  check('Slider readout keeps the bound value precision', fineOutput === '0.1234%', fineOutput)
  check('Slider readout shows the clamped bound value', clampReadout === '100%' && clampRange?.value === '100', `${clampReadout} / range ${clampRange ? clampRange.value : 'none'}`)
  check('Slider writes an out-of-range bound value back to the state', clampStateAfter === 'Clamped: 100', JSON.stringify(clampStateAfter))

  // --- C23: canvas/on-ink are surface tokens, not text colors; SVG paint keeps them.
  const tokenRoot = tokens.querySelector('.dsh-iui-root')
  const tokenInk = css(tokenRoot, 'color')
  const canvasTitle = tokens.querySelector('.iui-title')
  const canvasText = [...tokens.querySelectorAll('.iui-text')].find((el) => (el.textContent ?? '').includes('CANVAS TEXT'))
  const onInkIcon = tokens.querySelector('.iui-icon')
  check('Title with the "canvas" token inherits the theme ink', canvasTitle !== null && css(canvasTitle, 'color') === tokenInk && css(canvasTitle, 'color') !== 'rgb(255, 255, 255)', `${css(canvasTitle, 'color')} vs ${tokenInk}`)
  check('Text with the "on-ink" token inherits the theme ink', canvasText !== undefined && css(canvasText, 'color') === tokenInk, `${css(canvasText, 'color')} vs ${tokenInk}`)
  check('Icon with the "on-ink" token inherits the theme ink', onInkIcon !== null && css(onInkIcon, 'color') === tokenInk, `${css(onInkIcon, 'color')} vs ${tokenInk}`)
  const canvasRect = tokens.querySelector('.iui-svg rect')
  check('"canvas" stays a valid SVG paint', canvasRect !== null && samePaint(css(canvasRect, 'fill'), tokenColorIn(tokens, '--iui-canvas')), canvasRect ? css(canvasRect, 'fill') : 'no rect')

  // --- C24: a Flashcard is a div with button semantics, so controls stay valid.
  const card = flashcard.querySelector('.iui-flashcard')
  const playButton = card ? card.querySelector('button') : null
  const cardInner = card ? card.querySelector('.iui-flashcard-inner') : null
  check('Flashcard is not a native button wrapping other controls', card !== null && card.tagName === 'DIV' && card.getAttribute('role') === 'button' && card.getAttribute('tabindex') === '0' && card.closest('button') === null && playButton !== null, card ? `${card.tagName} role=${card.getAttribute('role')} controls=${playButton !== null}` : 'no card')
  check('Flashcard keeps its flip animation', cardInner !== null && css(cardInner, 'transition-property').includes('transform'), cardInner ? css(cardInner, 'transition-property') : 'no inner')
  if (card !== null && playButton !== null) {
    playButton.click()
    await wait(60)
    check('a control inside the Flashcard does not flip it', !card.classList.contains('is-flipped') && card.getAttribute('aria-pressed') === 'false', card.className)
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await wait(60)
    check('Enter flips the Flashcard', card.classList.contains('is-flipped') && card.getAttribute('aria-pressed') === 'true', card.className)
    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    await wait(60)
    check('Space flips the Flashcard back', !card.classList.contains('is-flipped') && card.getAttribute('aria-pressed') === 'false', card.className)
  } else {
    check('a control inside the Flashcard does not flip it', false, 'no card')
    check('Enter flips the Flashcard', false, 'no card')
    check('Space flips the Flashcard back', false, 'no card')
  }

  // --- C25: a number Input reads a decimal comma, grouping otherwise.
  const amountInput = input.querySelector('input.iui-input')
  const setInput = (text) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(amountInput, text)
    amountInput.dispatchEvent(new Event('input', { bubbles: true }))
  }
  if (amountInput !== null) {
    setInput('1,5')
    await wait(80)
    check('number Input "1,5" stores 1.5', textOf(input, 'Amount:') === 'Amount: 1.5', JSON.stringify(textOf(input, 'Amount:')))
    setInput('1,000')
    await wait(80)
    check('number Input "1,000" stores 1000', textOf(input, 'Amount:') === 'Amount: 1000', JSON.stringify(textOf(input, 'Amount:')))
    setInput('1,234.5')
    await wait(80)
    check('number Input "1,234.5" stores 1234.5', textOf(input, 'Amount:') === 'Amount: 1234.5', JSON.stringify(textOf(input, 'Amount:')))
  } else {
    check('number Input "1,5" stores 1.5', false, 'no input')
    check('number Input "1,000" stores 1000', false, 'no input')
    check('number Input "1,234.5" stores 1234.5', false, 'no input')
  }

  // --- C21: Markdown keeps nested lists and renders h5/h6 at the h4 size.
  const mdRoot = markdown.querySelector('.iui-markdown')
  const topList = mdRoot ? mdRoot.querySelector(':scope > ul') : null
  const topItems = topList ? [...topList.children] : []
  const nestedBullets = topItems[0] ? [...topItems[0].querySelectorAll(':scope > ul > li')] : []
  const nestedNumbers = topItems[1] ? [...topItems[1].querySelectorAll(':scope > ol > li')] : []
  check('Markdown keeps a nested bullet list inside its item', topItems.length === 2 && nestedBullets.length === 2 && (nestedBullets[0].textContent ?? '').includes('Nested one'), `${topItems.length} top / ${nestedBullets.length} nested`)
  check('Markdown keeps a nested ordered list inside its item', nestedNumbers.length === 2 && (nestedNumbers[1].textContent ?? '').includes('Second step'), `${nestedNumbers.length} nested ordered items`)
  const headings = mdRoot ? [...mdRoot.querySelectorAll('.iui-md-h')] : []
  const headingTexts = headings.map((heading) => (heading.textContent ?? '').trim())
  check('Markdown renders h5 and h6 at the h4 size', headings.length === 2 && headings.every((heading) => heading.classList.contains('iui-md-h4')) && headingTexts.includes('Five hashes') && headingTexts.includes('Six hashes') && !(mdRoot.textContent ?? '').includes('#####'), headingTexts.join(' / '))
  check('Markdown tables, quotes and code blocks still render', mdRoot !== null && mdRoot.querySelectorAll('table tbody tr').length === 1 && (mdRoot.querySelector('blockquote')?.textContent ?? '').includes('A quote') && (mdRoot.querySelector('pre code')?.textContent ?? '').includes('code line'), 'table/quote/code')

  // --- F03: the remaining @function throw domains are null, not a fatal card.
  const throwLines = ['Random:', 'Range:', 'Hist:', 'Convert:', 'Mix:', 'Payment:', 'Moving:', 'Chunk:', 'Allocate:']
  const throwValues = throwLines.map((prefix) => textOf(domains, prefix))
  check(
    '@function out-of-domain inputs render nothing instead of failing the card',
    throwValues.every((value, i) => value === throwLines[i]),
    throwValues.map((value, i) => `${throwLines[i]} ${JSON.stringify(value)}`).join(' | '),
  )
  check(
    '@function in-domain values are unchanged',
    textOf(domains, 'RangeOK:') === 'RangeOK: 0,1,2' &&
      textOf(domains, 'MixOK:') === 'MixOK: #808080' &&
      textOf(domains, 'ConvertOK:') === 'ConvertOK: 1000' &&
      textOf(domains, 'PaymentOK:') === 'PaymentOK: 100',
    [textOf(domains, 'RangeOK:'), textOf(domains, 'MixOK:'), textOf(domains, 'ConvertOK:'), textOf(domains, 'PaymentOK:')].join(' | '),
  )

  check('page does not scroll horizontally', document.documentElement.scrollWidth <= innerWidth, `${document.documentElement.scrollWidth} > ${innerWidth}`)

  return checks
}

const results = await cdp.evaluate(`(${collectChecks.toString()})()`)

let failed = 0
for (const result of results) {
  console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.name}${result.ok ? '' : ` — ${result.detail}`}`)
  if (!result.ok) failed++
}
console.log(`prop-contract-check: ${results.length - failed}/${results.length} checks passed`)
await cleanup()
if (failed > 0) process.exit(1)
