#!/usr/bin/env node
/**
 * Browser E2E for Article layout spacing (component level).
 *
 * Builds `test/browser/harness/article-entry.tsx` and drives it in headless
 * Chrome + CDP. The regression this guards: Section bodies used to render their
 * blocks without a flow container (adjacent blocks touched), while the article
 * root combined a flex `gap` with the margin-based flow spacing (large blank
 * bands before sections).
 *
 *   npm run test:browser
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-article-e2e-'))
let server
let browser
let cdp

const TOKENS = `:root{color-scheme:light;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f6f6;--dsw-alias-bg-module-platform:#f5f6f7;--dsw-alias-border-l1:#e6e6e6;--dsw-alias-border-l2:#d9d9d9;--dsw-alias-border-l3:#c9c9c9;--dsw-alias-label-primary:#111;--dsw-alias-label-secondary:#555;--dsw-alias-label-tertiary:#888;--dsw-alias-label-caption:#8a8a8a;--dsw-alias-label-dimmed:#bbb;--dsw-alias-label-primary-foreground:#fff;--dsw-alias-interactive-bg-hover:#eee;--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#d33;--dsw-brand-primary:#111;--dsw-radius-xs:4px;--dsw-radius-sm:6px;--dsw-radius-md:10px;--dsw-radius-lg:14px;--dsw-radius-xl:18px;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#4176e6;--dsw-font-family:system-ui,-apple-system,"PingFang SC",sans-serif}`

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/article-entry.tsx')],
    outfile: join(temp, 'bundle.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
    jsx: 'automatic',
    absWorkingDir: root,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  await writeFile(join(temp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
<style>${TOKENS}</style><link rel="stylesheet" href="./bundle.css">
<style>html,body{margin:0;background:#fff;color:#111;font-family:var(--dsw-font-family)}
#root{width:860px;margin:0 auto;padding:32px 0 80px}</style></head>
<body><div id="root"></div><script type="module" src="./bundle.js"></script></body></html>`)

  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url + 'index.html', width: 1000, height: 1400 })
  if (browser === null) {
    console.log('article-layout E2E: skipped (Chrome not found; set CHROME_BIN)')
    process.exitCode = 0
    await cleanup()
    process.exit()
  }
  cdp = await connectCdp(browser.port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.waitFor('document.readyState === "complete"', 'load', { timeout: 60000 })
  await cdp.waitFor('document.querySelectorAll(".iui-section").length === 2', 'article sections', { timeout: 60000 })

  const metrics = await cdp.evaluate(`(() => {
    const root = document.querySelector('.dsh-iui-article .iui-flow')
    const sections = [...document.querySelectorAll('.iui-section')]
    const firstBody = sections[0].querySelector('.iui-section-body')
    const children = [...firstBody.children]
    const gapBetween = (a, b) => Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom)
    return {
      rootGap: getComputedStyle(root).gap,
      rootDisplay: getComputedStyle(root).display,
      sectionGap: gapBetween(sections[0], sections[1]),
      bodyDisplay: getComputedStyle(firstBody).display,
      bodyMargins: children.slice(1).map(child => Math.round(Number.parseFloat(getComputedStyle(child).marginTop))),
      bodyGaps: children.slice(1).map((child, index) => gapBetween(children[index], child)),
    }
  })()`)

  assert.equal(metrics.rootDisplay, 'flex')
  assert.notEqual(metrics.rootGap, '18px', 'the article flow must not add a second flex gap')
  assert.equal(metrics.bodyDisplay, 'flex', 'each Section body is its own flow container')
  assert.deepEqual(metrics.bodyMargins, [16, 16, 12, 16], 'Section body blocks use the group rhythm, title to next block is tighter')
  assert.deepEqual(metrics.bodyGaps, [16, 16, 12, 16], 'Section body blocks no longer touch')
  assert.ok(metrics.sectionGap >= 20 && metrics.sectionGap <= 28, 'sections keep one page-level gap, not a doubled blank band')
  console.log('article-layout E2E: OK')
} finally {
  await cleanup()
}

/** Stop Chrome and the static server, and remove the temp directory. */
async function cleanup() {
  try { cdp?.close() } catch { /* ignore */ }
  await browser?.cleanup()
  try { server?.close() } catch { /* ignore */ }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
