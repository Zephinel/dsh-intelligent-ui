#!/usr/bin/env node
/**
 * Browser E2E for the single-file interactive HTML export.
 *
 * Builds a real page from `lib/standalone.js`/`.css` and a recorded program,
 * serves it, then drives the exported document with headless Chrome + CDP:
 * cards render, the collapsible chrome works, the inline theme applies, and an
 * @ToAssistant button copies + toasts instead of calling a DSH host.
 *
 *   npm run test:browser
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildStandaloneHtml } from '../../src/client/export-html-plan.ts'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-page-e2e-'))
let server
let browser
let cdp

const PAGE_TOKENS = `:root{color-scheme:light;--dsw-alias-bg-base:#ffffff;--dsw-alias-bg-layer-1:#ffffff;--dsw-alias-bg-layer-2:#f6f6f6;--dsw-alias-border-l1:#e6e6e6;--dsw-alias-border-l2:#d9d9d9;--dsw-alias-label-primary:#111111;--dsw-alias-label-secondary:#555555;--dsw-alias-label-tertiary:#888888;--dsw-alias-label-caption:#8a8a8a;--dsw-alias-label-primary-foreground:#ffffff;--dsw-alias-interactive-bg-hover:#eeeeee;--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#d93333;--dsw-brand-primary:#111111;--dsw-radius-sm:6px;--dsw-radius-md:10px;--dsw-radius-lg:14px;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#4176e6;--dsw-font-family:system-ui,-apple-system,"PingFang SC",sans-serif}`
const cards = [
  { program: 'root = Col([Title("Standalone harness", "xl"), Text("Interactive page body"), Button("Continue")], 2)', title: 'First card', style: 'card', callId: 'call-1' },
  { program: 'root = Title("Second card body")', title: 'Second card', style: 'card', callId: 'call-2' },
]

try {
  const js = await readFile(join(root, 'lib/standalone.js'), 'utf8')
  const css = await readFile(join(root, 'lib/standalone.css'), 'utf8')
  const html = buildStandaloneHtml({
    cards,
    js,
    css,
    tokens: PAGE_TOKENS,
    colorScheme: 'light',
    title: 'Standalone harness',
    lang: 'en',
  })
  assert.ok(!/<script[^>]+src=/i.test(html), 'the page has no external script')
  assert.ok(!/<link[^>]+rel=["']?stylesheet/i.test(html), 'the page has no external stylesheet')
  assert.ok(Buffer.byteLength(html) > 3.4 * 1024 * 1024, 'the page inlines the full renderer (>= 3.4 MB)')
  await writeFile(join(temp, 'index.html'), html)

  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url + 'index.html', width: 900, height: 1200 })
  if (browser === null) {
    console.log('standalone-page E2E: skipped (Chrome not found; set CHROME_BIN)')
    process.exitCode = 0
    await cleanup()
    process.exit()
  }
  cdp = await connectCdp(browser.port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  try {
    await cdp.send('Browser.grantPermissions', {
      origin: server.url.replace(/\/$/, ''),
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    })
  } catch {
    // Older Chrome: the copy path still has its selection fallback.
  }
  await cdp.waitFor('document.readyState === "complete"', 'load', { timeout: 60000 })
  await cdp.waitFor('document.querySelectorAll(".dsh-iui-standalone-card").length === 2', 'exported cards', { timeout: 60000 })

  const mounted = await cdp.evaluate(`(() => {
    return {
      cards: document.querySelectorAll('.dsh-iui-standalone-card').length,
      headers: document.querySelectorAll('.dsh-iui-header').length,
      text: document.body.innerText,
      background: getComputedStyle(document.body).backgroundColor,
    }
  })()`)
  assert.equal(mounted.cards, 2, 'both recorded cards render')
  assert.equal(mounted.headers, 0, 'the exported page drops the collapsible card header')
  assert.match(mounted.text, /Standalone harness/)
  assert.match(mounted.text, /Second card body/)
  assert.equal(mounted.background, 'rgb(255, 255, 255)', 'the inlined theme sets the page background')

  // A bare Button sends its label to the assistant; the standalone page must
  // copy it and toast instead of calling a DSH host.
  await cdp.evaluate('[...document.querySelectorAll("button")].find(button => button.textContent.trim() === "Continue").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-standalone-toast")', 'copy toast', { timeout: 5000 })
  const toast = await cdp.evaluate('document.querySelector(".dsh-iui-standalone-toast").textContent')
  assert.match(toast, /Copied|paste it back/i, 'the @ToAssistant fallback reports a copied message')

  console.log('standalone-page E2E: OK')
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
