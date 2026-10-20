#!/usr/bin/env node
/**
 * Browser-level colour torture test for the DSH OpenUI Lang renderer.
 *
 * The helper-level contrast-check cannot catch CSS cascade bugs (a remapped
 * custom property, a container recolouring its own paint, a nested control
 * inheriting the wrong content colour). This check renders a page of hostile
 * token combinations in headless Chrome and asserts every piece of text keeps
 * a readable contrast ratio against the opaque fill behind it, in the light and
 * dark themes.
 *
 *   node test/renderer/theme-torture.mjs
 *   CHROME_BIN=/path/to/chrome node test/renderer/theme-torture.mjs
 *
 * Skips with exit code 0 when no Chrome binary is available (the check needs a
 * real layout engine for computed styles).
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'test/renderer/.build/theme-torture')
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
  console.log(`theme-torture: skipped (no Chrome at ${chrome}; set CHROME_BIN to run it)`)
  process.exit(0)
}

const program = `root = Col([inkTile, chartBox, svgBox], 3)
$seg = "sel A"
$radio = "pill one"
inkTile = Box([Col([Row([Text("ink text label", "md", "ink"), Icon("check", "sm", "ink")], 2), Text("surface label", "sm", "surface"), Row([Button("solid button", null, "solid"), Button("outline button", null, "outline")], 2), SegmentedControl($seg, ["sel A", "sel B"], true), Card([Title("card title", "sm"), Text("card body", "sm")], "outline", 3), List(["num one", "num two"], "number", false), RadioGroup($radio, ["pill one", "pill two"], null, "pills")], 3)], null, 3, 4, "ink", "lg")
chartBox = Box([Text("chart background label", "md")], null, null, 4, "chart1", "lg")
svgBox = Svg([SvgText("svg surface label", 8, 24, 14, "surface", "start")], "0 0 240 48")`

await mkdir(outDir, { recursive: true })
const entry = join(outDir, 'entry.tsx')
const bundleDir = join(outDir, 'bundle')
await mkdir(bundleDir, { recursive: true })
await writeFile(entry, `
import { createRoot } from 'react-dom/client'
import { OpenUIRenderer } from ${JSON.stringify(join(root, 'src/lib/render.tsx'))}

const program = ${JSON.stringify(program)}
createRoot(document.getElementById('root')).render(<OpenUIRenderer program={program} />)
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
  loader: { '.css': 'css' },
  logLevel: 'warning',
})

const themeFixture = `
  :root {
    color-scheme: light;
    --dsw-alias-label-primary: #0f1115;
    --dsw-alias-label-primary-foreground: #ffffff;
    --dsw-alias-label-secondary: rgb(15 17 21 / 60%);
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-font-family: -apple-system, "SF Pro Text", "Inter", sans-serif;
    --ds-font-family-code: ui-monospace, "SF Mono", Menlo, monospace;
  }
  body[data-ds-dark-theme] {
    color-scheme: dark;
    --dsw-alias-label-primary: #f9fafb;
    --dsw-alias-label-primary-foreground: #0f1115;
    --dsw-alias-label-secondary: rgb(249 250 251 / 64%);
    --dsw-alias-bg-layer-1: #0f1115;
  }
  html, body { margin: 0; padding: 0; }
  body { background: var(--dsw-alias-bg-layer-1); font-family: var(--dsw-font-family); }
  #root { width: 720px; padding: 16px; }
`

await writeFile(join(bundleDir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>theme torture</title>
<style>${themeFixture}</style>
<link rel="stylesheet" href="app.css">
</head><body><div id="root"></div><script type="module" src="app.js"></script></body></html>`)

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

const profile = await mkdtemp(join(tmpdir(), 'dsh-theme-torture-'))
const child = execFileSync  // placeholder to keep eslint quiet in plain node scripts
void child
const { spawn } = await import('node:child_process')
const chromeProcess = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--disable-extensions',
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
  console.error('theme-torture: Chrome did not expose the page target')
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
  if (res.result?.exceptionDetails) {
    const details = res.result.exceptionDetails
    throw new Error(details.exception?.description ?? details.text ?? 'evaluate failed')
  }
  return res.result?.result?.value
}

const auditExpression = `(() => {
  const parse = (value) => {
    if (typeof value !== 'string') return null
    let m = /^rgba?\\(([^)]+)\\)$/.exec(value)
    if (m) {
      const parts = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number)
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }
    }
    m = /^color\\(srgb ([^)]+)\\)$/.exec(value)
    if (m) {
      const parts = m[1].split(/[\\s/]+/).filter(Boolean)
      return { r: Number(parts[0]) * 255, g: Number(parts[1]) * 255, b: Number(parts[2]) * 255, a: parts[3] === undefined ? 1 : Number(parts[3]) }
    }
    return null
  }
  const luminance = ({ r, g, b }) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (fg, bg) => {
    const a = luminance(fg), b = luminance(bg)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }
  const opaque = (el) => {
    for (let node = el; node !== null; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor)
      if (color !== null && color.a >= 0.99) return color
    }
    return parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
  }
  const textNode = (label) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      if ((walker.currentNode.textContent ?? '').trim() === label) return walker.currentNode.parentElement
    }
    return null
  }
  const marker = document.querySelector('.iui-list-marker')
  const selectedSegment = [...document.querySelectorAll('.iui-segmented button.is-selected')][0]
  const targets = [
    ['ink tile text', textNode('ink text label')],
    ['surface token as text', textNode('surface label')],
    ['solid button in ink tile', textNode('solid button')],
    ['outline button in ink tile', textNode('outline button')],
    ['selected segment in ink tile', selectedSegment],
    ['number marker in ink tile', marker],
    ['card title in ink tile', textNode('card title')],
    ['card body in ink tile', textNode('card body')],
    ['chart1 background text', textNode('chart background label')],
    ['svg text with surface fill', [...document.querySelectorAll('text')].find((el) => (el.textContent ?? '').trim() === 'svg surface label')],
  ]
  const failures = []
  const rows = []
  for (const [name, el] of targets) {
    if (!el) { failures.push(\`\${name}: element missing\`); continue }
    const isSvgText = el instanceof SVGTextElement
    const fg = parse(isSvgText ? getComputedStyle(el).fill : getComputedStyle(el).color)
    const bg = opaque(el)
    if (fg === null) { failures.push(\`\${name}: unparsable foreground\`); continue }
    const blended = fg.a >= 0.99 ? fg : { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 }
    const value = ratio(blended, bg)
    rows.push({ name, ratio: Number(value.toFixed(2)) })
    if (value < 3) failures.push(\`\${name}: contrast \${value.toFixed(2)} < 3\`)
  }
  return { dark: document.body.hasAttribute('data-ds-dark-theme'), rows, failures }
})()`

// The renderer parses the program in effects; wait until the page is on screen.
let ready = false
for (let i = 0; i < 80; i++) {
  ready = await evaluate(`!!document.body && document.body.innerText.includes('ink text label')`)
  if (ready) break
  await sleep(250)
}
if (!ready) {
  console.error('theme-torture: the torture page did not render; body text follows:')
  console.error(await evaluate('document.body.innerText.slice(0, 1200)'))
  console.error(await evaluate('document.body.innerHTML.slice(0, 600)'))
  ws.close()
  await cleanup()
  process.exit(1)
}

let failed = 0
for (const dark of [false, true]) {
  await evaluate(`document.body.toggleAttribute('data-ds-dark-theme', ${dark ? 'true' : 'false'}); 'theme'`)
  await sleep(150)
  const result = await evaluate(auditExpression)
  console.log(`theme-torture: ${dark ? 'dark' : 'light'} — ${result.rows.length} target(s)`)
  for (const row of result.rows) console.log(`  ${row.name}: ${row.ratio}:1`)
  if (result.failures.length > 0) {
    failed += result.failures.length
    for (const failure of result.failures) console.error(`  FAIL ${failure}`)
  }
}

ws.close()
await cleanup()
if (failed > 0) {
  console.error(`theme-torture: ${failed} contrast failure(s)`)
  process.exit(1)
}
console.log('theme-torture: all targets readable in light and dark themes')
