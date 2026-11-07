#!/usr/bin/env node
/**
 * Capture one deterministic README screenshot of the artifact editor.
 *
 * Uses the artifact-edit browser harness (production card/editor components,
 * fake Host responses) and crops the card + docked panel at 2x. No real model.
 *
 *   node scripts/capture-editor-screenshot.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromeExists, connectCdp, launchChrome, startStaticServer } from '../test/support/browser.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lang = process.argv.includes('--en') ? 'en' : 'zh'
const out = join(root, lang === 'en' ? 'assets/intelligent-ui-editing-en.webp' : 'assets/intelligent-ui-editing-zh.webp')
const ENGLISH_PROGRAM = `root = Col([head, summary, focus, actions])
head = Title("A calmer weekly review", "2xl")
summary = Text("One view of what matters, with space to think.", "md", "muted")
focus = Card([Title("3 priorities", "lg"), Text("Ship the draft · Review feedback · Plan the next step", "sm")], "outline")
actions = Card([Title("Next steps", "lg"), Text("Keep the scope small and review evidence before the next milestone.", "sm")], "outline")`
const temp = await mkdtemp(join(tmpdir(), 'iui-editor-shot-'))
let server, browser, cdp

const PRIMITIVES_STUB = `
import { createElement } from 'react'
export const IconChevronDownOutlineRegular = () => null
export const IconSparkleRegular = () => null
export const IconCloseOutlineRegular = () => null
export const IconEditOutlineRegular = () => null
export const IconTrashOutlineRegular = () => null
export const IconPlusOutlineRegular = () => null
export const IconArrowLeftOutlineRegular = () => null
export const DisclosureRow = () => null
export function ReferenceChip({ label, title }) {
  return createElement('span', { 'data-reference-chip': 'true', title }, label)
}
`

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="bundle.css"><style>
:root { color-scheme:light;
  --dsw-alias-bg-base:#fff; --dsw-alias-bg-layer-1:#fff; --dsw-alias-bg-layer-2:#f5f6f7; --dsw-alias-bg-layer-3:#eceef1;
  --dsw-alias-bg-module-platform:#f5f6f7; --dsw-alias-label-primary:#171717; --dsw-alias-label-secondary:#555;
  --dsw-alias-label-tertiary:#888; --dsw-alias-label-caption:#999;
  --dsw-alias-border-l1:#e4e4e4; --dsw-alias-border-l2:#d4d4d4; --dsw-alias-border-l3:#c4c4c4;
  --dsw-alias-interactive-bg-hover:#eee; --dsw-alias-interactive-bg-hover-solid:#e8e8e8;
  --dsw-alias-state-business-primary:#1265bb; --dsw-alias-state-error-primary:#b42318; --dsw-alias-state-warn-primary:#b54708;
  --dsw-alias-button-floating-fill:#fff; --dsw-alias-button-floating-hover:#f2f2f2;
  --dsw-specific-menu:#fff; --dsw-specific-bubble:#eef2f7; --dsw-specific-input-major:#fff;
  --dsw-radius-sm:6px; --dsw-radius-md:10px; --dsw-radius-lg:14px; --dsw-radius-xl:18px;
  --dsw-focus-ring-color:#1265bb; --dsw-focus-ring-width:2px; --dsw-font-family:system-ui;
  --dsw-elevation-panel:0 6px 24px rgb(0 0 0 / 12%); --dsw-elevation-prominent:0 10px 36px rgb(0 0 0 / 16%);
  --dsh-chat-content-width:748px; --dsh-composer-side-clearance:0px; --dsh-content-font-size:14px;
}
body { margin:0; background:#fff; color:var(--dsw-alias-label-primary); font:14px/1.5 var(--dsw-font-family); }
main { margin:24px auto; max-width:var(--dsh-chat-content-width); }
*:focus, *:focus-visible { outline:none !important; }
</style></head><body><div id="root"></div><script type="module" src="bundle.js"></script></body></html>`

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/artifact-edit-entry.tsx')], outfile: join(temp, 'bundle.js'),
    bundle: true, platform: 'browser', format: 'esm', target: 'chrome120', jsx: 'automatic', absWorkingDir: root,
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    plugins: [{
      name: 'platform-stubs',
      setup(build) {
        build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: PRIMITIVES_STUB, resolveDir: root }))
      },
    }],
  })
  await writeFile(join(temp, 'index.html'), HTML)
  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url, width: 1500, height: 1100 })
  assert.ok(browser, 'Chrome required')
  cdp = await connectCdp(browser.port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  const read = (expression) => cdp.evaluate(expression)
  const wait = (expression, label) => cdp.waitFor(expression, label, { timeout: 10000 })
  await wait('!!document.querySelector("[data-dsh-iui-edit-entry]")', 'edit entry')
  if (lang === 'en') {
    await read(`window.__language('en')`)
    await read(`window.__resetCards()`)
    await read(`window.__addCard('editor-shot', 'A calmer weekly review', ${JSON.stringify(ENGLISH_PROGRAM)})`)
    await wait(`!!document.querySelector('[data-dsh-iui-call-id="editor-shot"] [data-dsh-iui-edit-entry]')`, 'english card')
    await read(`document.querySelector('[data-dsh-iui-call-id="editor-shot"] [data-dsh-iui-edit-entry]').click()`)
  } else {
    await read(`document.querySelector('[data-dsh-iui-edit-entry]').click()`)
  }
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'edit view')
  await sleep(600)
  await read(`document.querySelector('[data-dsh-iui-edit-row-menu]')?.click()`)
  await wait('!!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'row menu')
  await sleep(200)
  const rect = await read(`(() => {
    const card = document.querySelector('.dsh-iui-card');
    const panel = document.querySelector('.dsh-iui-edit-panel');
    const a = card.getBoundingClientRect();
    const b = panel.getBoundingClientRect();
    const left = Math.max(0, Math.min(a.left, b.left) - 16);
    const top = Math.max(0, Math.min(a.top, b.top) - 16);
    const right = Math.min(window.innerWidth, Math.max(a.right, b.right) + 16);
    const bottom = Math.min(window.innerHeight, Math.max(a.bottom, b.bottom) + 16);
    return { x: left, y: top, width: right - left, height: bottom - top };
  })()`)
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'webp', quality: 92,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 },
  })
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(out, Buffer.from(shot.data, 'base64'))
  console.log(`editor screenshot: ${out.replace(root + '/', '')} (${rect.width}x${rect.height} @2x)`)
} finally {
  cdp?.close()
  await browser?.cleanup()
  server?.close()
  await rm(temp, { recursive: true, force: true })
}
