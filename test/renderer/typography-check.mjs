#!/usr/bin/env node
/**
 * Browser-level typography regression check for the DSH OpenUI Lang renderer.
 *
 * The component CSS carries display tracking, CJK glyphs, currency signs and
 * narrow chat cards — combinations that static checks cannot see. This check
 * renders a small fixture in headless Chrome and asserts the structural rules
 * that keep text readable:
 *
 *   - a leading currency sign keeps normal tracking inside a tracked title;
 *   - CJK titles and Markdown headings drop the Latin display tracking;
 *   - long badges and buttons wrap inside a 360px card instead of clipping;
 *   - an over-long chart category label is trimmed with an ellipsis and keeps
 *     the full label in its tooltip title;
 *   - CJK/Latin autospacing is inherited where the engine supports it;
 *   - the page never scrolls horizontally.
 *
 *   node test/renderer/typography-check.mjs
 *   CHROME_BIN=/path/to/chrome node test/renderer/typography-check.mjs
 *
 * Skips with exit code 0 when no Chrome binary is available.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'test/renderer/.build/typography-check')
const chrome = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = 9410 + Math.floor(Math.random() * 400)

async function chromeExists() {
  try {
    await readFile(chrome)
    return true
  } catch {
    return false
  }
}

if (!(await chromeExists())) {
  console.log(`typography-check: skipped (no Chrome at ${chrome}; set CHROME_BIN to run it)`)
  process.exit(0)
}

const wideProgram = `root = Col([currency, cjkTitle, cjkMarkdown, latinTitle, mixed, cardCjk, cardScale], 4)
currency = Title("¥3,000", "lg")
cjkTitle = Title("手冲咖啡配方计算器", "2xl")
cjkMarkdown = Markdown("### 中文标题 English 混排")
latinTitle = Title("Latin display title", "lg")
mixed = Text("中文与 English 混排，数字 3,000 与标点。（括号）", "md")
cardCjk = Card([Title("卡片里的中文标题", "lg")], "outline")
cardScale = Card([Title("Scale lg", "lg"), Title("Scale xl", "xl"), Title("Scale 2xl", "2xl"), Title("Scale 3xl", "3xl")], "outline")`

const narrowProgram = `root = Col([badge, button, chart], 4)
badge = Badge("A very long badge label that should wrap inside the card boundary")
button = Button("Let the assistant adjust the whole plan for a family of four", @ToAssistant("adjust"), "solid")
chart = Chart("bar", [{label: "A very long category label for a narrow card", value: 42}, {label: "North", value: 26}], "label", ["value"], "number")`

await mkdir(outDir, { recursive: true })
const bundleDir = join(outDir, 'bundle')
await mkdir(bundleDir, { recursive: true })
const entry = join(outDir, 'entry.tsx')
await writeFile(entry, `
import { createRoot } from 'react-dom/client'
import { OpenUIRenderer } from ${JSON.stringify(join(root, 'src/lib/render.tsx'))}

const wide = ${JSON.stringify(wideProgram)}
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
<html lang="zh"><head><meta charset="utf-8"><title>typography check</title>
<style>${fixture}</style>
<link rel="stylesheet" href="app.css">
</head><body><div id="wide"></div><div id="narrow"></div><script type="module" src="app.js"></script></body></html>`)

const server = createServer(async (req, res) => {
  try {
    const path = join(bundleDir, decodeURIComponent(new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname))
    const body = await readFile(path)
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady))
const pageUrl = `http://127.0.0.1:${server.address().port}/`

const profile = await mkdtemp(join(tmpdir(), 'dsh-typography-check-'))
const { spawn } = await import('node:child_process')
const chromeProcess = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--disable-extensions',
  '--window-size=1200,1200',
  `--remote-debugging-port=${port}`,
  '--remote-allow-origins=*',
  `--user-data-dir=${profile}`,
  pageUrl,
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cleanup = async () => {
  chromeProcess.kill('SIGKILL')
  server.close()
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
process.on('exit', () => { try { chromeProcess.kill('SIGKILL') } catch {} })

let target
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find((entry) => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:'))
    if (target) break
  } catch {}
  await sleep(250)
}
if (!target) {
  await cleanup()
  console.error('typography-check: Chrome did not expose the page target')
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
await new Promise((resolveReady, reject) => { ws.addEventListener('open', resolveReady); ws.addEventListener('error', reject) })
const send = (method, params = {}) => new Promise((resolveReady) => { const id = ++seq; pending.set(id, resolveReady); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text ?? 'evaluate failed')
  return res.result?.result?.value
}

// Both renderers parse in effects; wait until the text is on screen.
let ready = false
for (let i = 0; i < 80; i++) {
  ready = await evaluate(`!!document.body && document.body.innerText.includes('手冲咖啡配方计算器') && document.body.innerText.includes('A very long badge label')`)
  if (ready) break
  await sleep(250)
}
if (!ready) { ws.close(); await cleanup(); console.error('typography-check: fixture did not render'); process.exit(1) }
await sleep(500)

const results = await evaluate(`(() => {
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })
  const wide = document.getElementById('wide')
  const narrow = document.getElementById('narrow')
  const text = (el) => (el?.textContent ?? '').trim()
  const css = (el, prop) => (el ? getComputedStyle(el) : null)?.getPropertyValue(prop) ?? ''

  if (document.querySelector('.dsh-iui-fallback') !== null) {
    check('fixture renders', false, 'renderer fallback shown: ' + document.querySelector('.dsh-iui-fallback').innerText.slice(0, 160))
    return checks
  }

  const currencyTitle = [...wide.querySelectorAll('.iui-title')].find((el) => text(el) === '¥3,000')
  const currencySpan = currencyTitle?.firstElementChild
  check('currency sign is wrapped', currencySpan?.className === 'iui-currency-prefix', String(currencySpan?.className))
  check('currency sign keeps normal tracking', css(currencySpan, 'letter-spacing') === 'normal', css(currencySpan, 'letter-spacing'))
  check('currency title still carries display tracking', css(currencyTitle, 'letter-spacing') === '-0.55px', css(currencyTitle, 'letter-spacing'))

  const cjkTitle = [...wide.querySelectorAll('.iui-title')].find((el) => text(el) === '手冲咖啡配方计算器')
  check('CJK title is flagged', cjkTitle?.classList.contains('iui-title-cjk'), String(cjkTitle?.className))
  check('CJK title drops display tracking', css(cjkTitle, 'letter-spacing') === 'normal', css(cjkTitle, 'letter-spacing'))
  check('CJK title keeps its display size', css(cjkTitle, 'font-size') === '32px', css(cjkTitle, 'font-size'))

  const latinTitle = [...wide.querySelectorAll('.iui-title')].find((el) => text(el) === 'Latin display title')
  check('Latin title keeps display tracking', !latinTitle?.classList.contains('iui-title-cjk') && css(latinTitle, 'letter-spacing') === '-0.55px', css(latinTitle, 'letter-spacing'))

  const cjkHeading = [...wide.querySelectorAll('.iui-md-h')].find((el) => text(el).includes('中文标题'))
  check('CJK Markdown heading drops display tracking', cjkHeading?.classList.contains('iui-title-cjk') && css(cjkHeading, 'letter-spacing') === 'normal', css(cjkHeading, 'letter-spacing'))

  const cardCjk = [...wide.querySelectorAll('.iui-card .iui-title-cjk')].find((el) => text(el) === '卡片里的中文标题')
  check('CJK title inside a card drops the card-scoped tracking', cardCjk !== undefined && css(cardCjk, 'letter-spacing') === 'normal', css(cardCjk, 'letter-spacing'))

  const inCard = Object.fromEntries([...wide.querySelectorAll('.iui-card > .iui-title')].filter((el) => text(el).startsWith('Scale ')).map((el) => [text(el).slice(6), css(el, 'font-size')]))
  check('in-card lg keeps the card section size (18px)', inCard.lg === '18px', String(inCard.lg))
  check('in-card xl keeps hierarchy (22px)', inCard.xl === '22px', String(inCard.xl))
  check('in-card 2xl keeps hierarchy (26px)', inCard['2xl'] === '26px', String(inCard['2xl']))
  check('in-card 3xl keeps hierarchy (30px)', inCard['3xl'] === '30px', String(inCard['3xl']))

  if (CSS.supports('text-autospace', 'normal')) {
    const mixed = [...wide.querySelectorAll('.iui-text')].find((el) => text(el).includes('English'))
    check('CJK/Latin autospacing is inherited', css(mixed, 'text-autospace') === 'normal', css(mixed, 'text-autospace'))
  }

  const badge = narrow.querySelector('.iui-badge')
  const badgeRect = badge?.getBoundingClientRect()
  const narrowRect = narrow.getBoundingClientRect()
  check('long badge stays inside the card', badgeRect !== undefined && badgeRect.right <= narrowRect.right + 1, badgeRect ? String(badgeRect.right - narrowRect.right) : 'missing')
  check('long badge wraps to more than one line', badgeRect !== undefined && badgeRect.height > 26, badgeRect ? String(badgeRect.height) : 'missing')

  const button = narrow.querySelector('.iui-button')
  const buttonRect = button?.getBoundingClientRect()
  check('long button stays inside the card', buttonRect !== undefined && buttonRect.right <= narrowRect.right + 1, buttonRect ? String(buttonRect.right - narrowRect.right) : 'missing')
  check('long button label wraps', buttonRect !== undefined && buttonRect.height > 36, buttonRect ? String(buttonRect.height) : 'missing')

  const chart = narrow.querySelector('.iui-chart-plot')
  const chartLabels = [...narrow.querySelectorAll('.iui-chart-category')]
  const truncated = chartLabels.find((el) => [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').endsWith('…')))
  check('long chart label is trimmed with an ellipsis', truncated !== undefined, chartLabels.map((el) => text(el)).join(' | '))
  check('trimmed chart label keeps the full text as title', truncated?.querySelector('title')?.textContent === 'A very long category label for a narrow card', truncated?.querySelector('title')?.textContent ?? 'missing')
  const labelRect = truncated?.getBoundingClientRect()
  const plotRect = chart?.getBoundingClientRect()
  const narrowBox = narrow.getBoundingClientRect()
  check('trimmed chart label stays inside the card', labelRect !== undefined && labelRect.left >= narrowBox.left - 1 && labelRect.right <= narrowBox.right + 1, labelRect ? String(Math.max(narrowBox.left - labelRect.left, labelRect.right - narrowBox.right)) : 'missing')

  check('page does not scroll horizontally', document.documentElement.scrollWidth <= innerWidth, document.documentElement.scrollWidth + ' > ' + innerWidth)
  return checks
})()`)

let failed = 0
for (const result of results) {
  console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.name}${result.ok ? '' : ` — ${result.detail}`}`)
  if (!result.ok) failed++
}
console.log(`typography-check: ${results.length - failed}/${results.length} checks passed`)
ws.close()
await cleanup()
if (failed > 0) process.exit(1)
