#!/usr/bin/env node
/**
 * Re-capture the two README screenshots owned by the design-system harness:
 *
 *   assets/intelligent-ui-components-layout.webp  — the component-tour card
 *   assets/intelligent-ui-settings.webp           — the Plugin detail page form
 *
 * Both are rendered at 2x from the real renderer / settings component and the
 * extension's own CSS, with a fixed light-theme token set (the subset of DSH
 * `--dsw-*` aliases those two surfaces read), so the images are reproducible
 * without a running DSH instance. They are English-UI captures by design: the
 * settings harness passes `fallbackT`, and the card header is authored here.
 *
 *   node scripts/capture-screenshots.mjs              # both
 *   node scripts/capture-screenshots.mjs settings     # just the settings form
 *
 * Requires the devDependencies (esbuild, react) and a local Chrome; set
 * CHROME_BIN to point at another binary. Exits 0 with a skip message when no
 * Chrome is found, matching the browser tests.
 *
 * Update the program / header title / expected strings below when the component
 * vocabulary or the Plugin detail page changes, then re-run. Never hand-edit
 * the WebP assets: the other eight README screenshots come from the answer
 * renderer and are captured from real sessions.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromeExists, startStaticServer, launchChrome, connectCdp } from '../test/support/browser.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const assets = join(root, 'assets')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Light-theme DSH aliases read by the renderer CSS, the extension chrome and
 * the settings form. Values mirror the DSH light theme; a token added to those
 * styles later must be added here too, otherwise the capture renders it
 * transparent.
 */
const THEME = `:root{
  color-scheme: light;
  --dsw-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --dsw-alias-bg-base: #fff;
  --dsw-alias-bg-layer-1: #fff;
  --dsw-alias-bg-layer-2: #fff;
  --dsw-alias-bg-layer-3: #fff;
  --dsw-alias-border-l1: #0000000a;
  --dsw-alias-border-l2: #0000001a;
  --dsw-alias-border-l3: #0000001f;
  --dsw-alias-brand-primary: #0f1115;
  --dsw-alias-interactive-bg-hover: #2631480f;
  --dsw-alias-label-primary: #0f1115;
  --dsw-alias-label-secondary: #61666b;
  --dsw-alias-label-tertiary: #81858c;
  --dsw-alias-label-caption: #adb2b8;
  --dsw-alias-label-dimmed: #e1e5ee;
  --dsw-alias-label-primary-foreground: #fff;
  --dsw-alias-state-business-primary: #4176e6;
  --dsw-alias-state-error-primary: #ec1313;
  --dsw-alias-switch-thumb: #fff;
  --dsw-focus-ring-width: 2px;
  --dsw-focus-ring-color: #4176e6;
  --dsw-radius-sm: 8px;
  --dsw-radius-md: 12px;
  --dsw-radius-lg: 16px;
}`

/** The component-tour program. Counts and group members must match the current vocabulary. */
const LAYOUT_PROGRAM = String.raw`
root = Col([head, badges, Divider(), layoutHead, layoutCopy, layoutGrid, layoutGrid2, Divider(), textHead, textCopy, textGrid], 3)
head = Row([Col([Title("Everything you can render", "2xl"), Text("An answer is not a wall of text. The model writes OpenUI Lang; the browser turns it into a real page. Every component on this card is live, and all state stays in the browser.", "md", "muted")], 2)], 1)
badges = Row([Badge("57 components"), Badge("73 functions"), Badge("5 actions"), Badge("0 extra requests", "success")], 2, null, null, true)
layoutHead = Title("Layout", "lg")
layoutCopy = Text("11 components · Col, Row, Box, Grid, Card, Carousel, Popover, Divider, Spacer, Section, Toc", "sm", "muted")
layoutGrid = Grid([colCard, rowCard, gridCard, boxCard, carouselCard, popoverCard, dividerCard, cardCard, spacerCard], 3, 200, 4)
colCard = Card([Title("Col", "sm"), Caption("vertical stack"), Box([], null, null, null, "surface", "sm", null, 120, 8), Box([], null, null, null, "surface", "sm", null, 96, 8), Box([], null, null, null, "surface", "sm", null, 72, 8)], "outline", null, 3)
rowCard = Card([Title("Row", "sm"), Caption("side by side"), Row([Box([], null, null, null, "info", "full", null, 22, 22), Box([], null, null, null, "success", "full", null, 22, 22), Box([], null, null, null, "warning", "full", null, 22, 22)], 2)], "outline", null, 3)
gridCard = Card([Title("Grid", "sm"), Caption("equal columns"), Grid([Badge("1"), Badge("2"), Badge("3"), Badge("4")], 2, 70, 2)], "outline", null, 3)
boxCard = Card([Title("Box", "sm"), Caption("flex primitive"), Box([Text("Padded fill", "sm")], null, null, 2, "surface", "sm")], "outline", null, 3)
carouselCard = Card([Title("Carousel", "sm"), Caption("snap scrolling"), Carousel([Box([Text("One", "xs")], null, null, 2, "info", "sm"), Box([Text("Two", "xs")], null, null, 2, "success", "sm"), Box([Text("Three", "xs")], null, null, 2, "warning", "sm")])], "outline", null, 3)
popoverCard = Card([Title("Popover", "sm"), Caption("details on click"), Popover("How does it work?", [Text("A small panel appears next to the trigger.", "sm")])], "outline", null, 3)
dividerCard = Card([Title("Divider", "sm"), Row([Text("left"), Spacer(), Text("right")], 3), Divider(), Caption("Spacer pushes the sides apart.")], "outline", null, 3)
cardCard = Card([Title("Card", "sm"), Caption("outline and soft"), Row([Card([Text("soft", "sm")], "soft"), Card([Text("outline", "sm")], "outline")], 2)], "outline", null, 3)
spacerCard = Card([Title("Spacer", "sm"), Caption("pushes to the edge"), Row([Text("row start"), Spacer(), Badge("end")], 3)], "outline", null, 3)
layoutGrid2 = Grid([articleCard], 1)
articleCard = Card([Row([Col([Title("Section & Toc", "sm"), Caption("article reading layout")], 2), Toc(["Background", "Evidence"], ["background", "evidence"])], 3), Section("Background", [Markdown("A collapsible section with a real prose body. The TOC targets the stable anchor, not the display title.")], "background"), Section("Evidence", [Markdown("Both sections start open; the reader can collapse them.")], "evidence")], "outline", null, 3)
textHead = Title("Text", "lg")
textCopy = Text("12 components · Title, Text, Caption, Label, Badge, Link, List, ListItem, Markdown, Quote, Code, Math", "sm", "muted")
textGrid = Grid([titleText, listItemCard, badgeLinkCard, proseCard], 2, 260, 4)
titleText = Card([Caption("Title & Text"), Title("2xl heading", "2xl"), Title("lg heading", "lg"), Text("Body copy with **bold**, *italic*, inline code and a [link](https://openui.com)."), Caption("Caption for units and footnotes"), Label("Label above a field")], "outline", null, 3)
listItemCard = Card([Title("List & ListItem", "sm"), List(["Bullet one", "Bullet two"]), ListItem("The Bund", "Walk from the bridge to Shiliupu.", "08:30"), ListItem("Yu Garden", "Cross the zigzag bridge before lunch.", "11:30")], "outline", null, 3)
badgeLinkCard = Card([Title("Badge & Link", "sm"), Row([Badge("Neutral"), Badge("Info", "info"), Badge("Success", "success"), Badge("Warning", "warning"), Badge("Danger", "danger"), Badge("Purple", "purple"), Badge("Pink", "pink")], 2, null, null, true), Link("OpenUI Lang", "https://openui.com"), Link("DeepSeek Harness", "https://github.com/deepseek-ai")], "outline", null, 3)
proseCard = Card([Title("Markdown, Quote, Code, Math", "sm"), Markdown("**Markdown** with a list:\n- headings, lists and emphasis\n- tables and code fences"), Quote("The page is the answer.", "OpenUI"), Code("ts", "answer = program.render()"), Math("E = mc^2")], "outline", null, 3)
`

/** Card header title used by the real turn-tail chrome. */
const LAYOUT_TITLE = 'Layout and typography — 23 components'

const LAYOUT_ENTRY = `
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { OpenUIRenderer } from ${JSON.stringify(join(root, 'src/lib/render.tsx'))}
import ${JSON.stringify(join(root, 'src/client/index.css'))}
import 'katex/dist/katex.min.css'

const program = ${JSON.stringify(LAYOUT_PROGRAM)}

const sparkle = createElement('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, createElement('path', { d: 'm12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z' }))
const chevron = createElement('svg', { viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, createElement('path', { d: 'm6 9 6 6 6-6' }))

function Shot() {
  return createElement('section', { className: 'dsh-iui-card' },
    createElement('button', { type: 'button', className: 'dsh-iui-header', 'aria-expanded': 'true' },
      createElement('span', { className: 'dsh-iui-icon', 'aria-hidden': 'true' }, sparkle),
      createElement('span', { className: 'dsh-iui-title' }, ${JSON.stringify(LAYOUT_TITLE)}),
      createElement('span', { className: 'dsh-iui-chevron', 'aria-hidden': 'true' }, chevron)),
    createElement('div', { className: 'dsh-iui-body' },
      createElement(OpenUIRenderer, { program, scopeId: 'layout-screenshot' })))
}

createRoot(document.getElementById('shot-root')!).render(createElement(Shot))
`

const ERROR_PROBE = `<script>window.__errors=[];addEventListener('error',(event)=>window.__errors.push(String(event.message)));addEventListener('unhandledrejection',(event)=>window.__errors.push(String(event.reason)))</script>`

const LAYOUT_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>${THEME}</style>
<style>
html, body { margin: 0; padding: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); }
#shot-frame { display: flex; justify-content: center; padding: 24px; box-sizing: border-box; }
#shot-root { width: 760px; min-width: 0; }
</style>
<link rel="stylesheet" href="./layout.css">
</head><body>${ERROR_PROBE}<div id="shot-frame"><div id="shot-root"></div></div><script type="module" src="./layout.js"></script></body></html>`

const SETTINGS_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>${THEME}</style>
<style>
html, body { margin: 0; background: #eef1f4; color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); -webkit-font-smoothing: antialiased; }
::-webkit-scrollbar { display: none; }
#root { width: 620px; margin: 24px auto; }
</style>
<link rel="stylesheet" href="./settings.css">
</head><body>${ERROR_PROBE}<div id="root"></div><script type="module" src="./settings.js"></script></body></html>`

const SHOTS = [
  {
    name: 'layout',
    html: 'layout.html',
    bundle: 'layout.js',
    width: 808,
    heightExpr: 'Math.ceil(document.documentElement.scrollHeight)',
    wait: '!!document.querySelector(".dsh-iui-body") && document.querySelector(".dsh-iui-body").innerText.length > 400',
    expect: ['57 components', 'Section & Toc', '12 components'],
    out: join(assets, 'intelligent-ui-components-layout.webp'),
  },
  {
    name: 'settings',
    html: 'settings.html',
    bundle: 'settings.js',
    width: 668,
    heightExpr: "Math.ceil(document.getElementById('root').getBoundingClientRect().bottom + 24)",
    wait: '!!document.querySelector("[data-dsh-iui-export-background]") && document.querySelectorAll(".dsh-iui-settings-row").length >= 4',
    expect: ['Global defaults', 'Remove follow-up actions', '#ffffff'],
    out: join(assets, 'intelligent-ui-settings.webp'),
  },
]

const requested = process.argv.slice(2).filter((argument) => !argument.startsWith('-'))
const jobs = requested.length === 0 ? SHOTS : SHOTS.filter((shot) => requested.includes(shot.name))
assert.equal(jobs.length, requested.length || SHOTS.length, `unknown screenshot name: ${requested.join(', ')}`)

if (!(await chromeExists())) {
  console.log('capture-screenshots: skipped (no Chrome found; set CHROME_BIN to run it)')
  process.exit(0)
}

const temp = await mkdtemp(join(tmpdir(), 'iui-screenshots-'))
let server
try {
  await writeFile(join(temp, 'layout-entry.tsx'), LAYOUT_ENTRY)
  await writeFile(join(temp, 'layout.html'), LAYOUT_HTML)
  await writeFile(join(temp, 'settings.html'), SETTINGS_HTML)

  const common = {
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
    jsx: 'automatic',
    absWorkingDir: root,
    nodePaths: [join(root, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
    logLevel: 'silent',
  }
  await build({ ...common, entryPoints: [join(temp, 'layout-entry.tsx')], outfile: join(temp, 'layout.js') })
  await build({ ...common, entryPoints: [join(root, 'test/browser/harness/settings-entry.tsx')], outfile: join(temp, 'settings.js') })

  server = await startStaticServer(temp)
  for (const shot of jobs) {
    const url = server.url + shot.html
    const browser = await launchChrome({ url, width: shot.width + 200, height: 1200 })
    assert.ok(browser, 'Chrome failed to launch')
    const cdp = await connectCdp(browser.port)
    try {
      await cdp.send('Page.enable')
      await cdp.send('Runtime.enable')
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: 1200, deviceScaleFactor: 2, mobile: false })
      await cdp.send('Page.navigate', { url })
      await cdp.waitFor('document.readyState === "complete"', `${shot.name} load`, { timeout: 30000 })
      await cdp.waitFor(shot.wait, `${shot.name} content`, { timeout: 30000 })
      await cdp.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true')
      await sleep(1200)

      const errors = await cdp.evaluate('window.__errors ?? []')
      assert.deepEqual(errors, [], `${shot.name} page reported errors`)
      const text = await cdp.evaluate('document.body.innerText')
      for (const expected of shot.expect) assert.ok(text.includes(expected), `${shot.name} is missing "${expected}"`)

      const first = await cdp.evaluate(shot.heightExpr)
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: shot.width, height: first, deviceScaleFactor: 2, mobile: false })
      await sleep(800)
      const height = await cdp.evaluate(shot.heightExpr)
      assert.ok(height > 400, `${shot.name} rendered too little content (${height}px)`)
      const shotResult = await cdp.send('Page.captureScreenshot', {
        format: 'webp',
        quality: 90,
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: shot.width, height, scale: 1 },
      })
      await writeFile(shot.out, Buffer.from(shotResult.data, 'base64'))
      console.log(`${shot.name}: ${shot.width * 2}x${height * 2} → ${shot.out.slice(root.length + 1)}`)
    } finally {
      cdp.close()
      await browser.cleanup()
    }
  }
} finally {
  server?.close()
  await rm(temp, { recursive: true, force: true })
}
