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
  { program: 'root = Col([Card([Title("Standalone harness", "xl"), Text("Interactive page body"), Row([Button("Continue")])])], 2)', title: 'First card', style: 'card', callId: 'call-1' },
  { program: 'root = Col([Text("Root follow-up body"), Button("Continue")], 2)', title: 'Second card', style: 'card', callId: 'call-2' },
  { program: 'root = Card([Title("Action card"), Button("Open docs", @OpenUrl("https://example.com"))])', title: 'Third card', style: 'card', callId: 'call-3' },
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
    removeFollowUps: false,
  })
  assert.ok(!/<script[^>]+src=/i.test(html), 'the page has no external script')
  assert.ok(!/<link[^>]+rel=["']?stylesheet/i.test(html), 'the page has no external stylesheet')
  assert.ok(Buffer.byteLength(html) > 3.4 * 1024 * 1024, 'the page inlines the full renderer (>= 3.4 MB)')
  await writeFile(join(temp, 'index.html'), html)
  const hiddenHtml = buildStandaloneHtml({
    cards,
    js,
    css,
    tokens: PAGE_TOKENS,
    colorScheme: 'light',
    title: 'Standalone harness',
    lang: 'en',
    removeFollowUps: true,
  })
  await writeFile(join(temp, 'hidden.html'), hiddenHtml)

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
  await cdp.waitFor('document.querySelectorAll(".dsh-iui-standalone-card").length === 3', 'exported cards', { timeout: 60000 })

  const mounted = await cdp.evaluate(`(() => {
    return {
      cards: document.querySelectorAll('.dsh-iui-standalone-card').length,
      headers: document.querySelectorAll('.dsh-iui-header').length,
      text: document.body.innerText,
      background: getComputedStyle(document.body).backgroundColor,
    }
  })()`)
  assert.equal(mounted.cards, 3, 'all recorded cards render')
  assert.equal(mounted.headers, 0, 'the exported page drops the collapsible card header')
  assert.match(mounted.text, /Standalone harness/)
  assert.match(mounted.text, /Root follow-up body/)
  assert.match(mounted.text, /Action card/)
  assert.equal(mounted.background, 'rgb(255, 255, 255)', 'the inlined theme sets the page background')

  // A bare Button sends its label to the assistant; the standalone page must
  // copy it and toast instead of calling a DSH host.
  await cdp.evaluate('[...document.querySelectorAll("button")].find(button => button.textContent.trim() === "Continue").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-standalone-toast")', 'copy toast', { timeout: 5000 })
  const toast = await cdp.evaluate('document.querySelector(".dsh-iui-standalone-toast").textContent')
  assert.match(toast, /Copied|paste it back/i, 'the @ToAssistant fallback reports a copied message')

  await cdp.send('Page.navigate', { url: server.url + 'hidden.html' })
  await cdp.waitFor('document.readyState === "complete"', 'hidden page load', { timeout: 60000 })
  await cdp.waitFor('document.querySelectorAll(".dsh-iui-standalone-card").length === 3', 'hidden page cards', { timeout: 60000 })
  const hidden = await cdp.evaluate(`(() => ({
    blocks: document.querySelectorAll('[data-iui-followup-hidden]').length,
    htmlHidden: document.documentElement.hasAttribute('data-iui-followup-hidden'),
    visibleButtons: [...document.querySelectorAll('button')].filter(button => button.getClientRects().length > 0).length,
    text: document.body.innerText,
  }))()`)
  assert.equal(hidden.blocks, 2, 'the follow-up card and the root-level control are hidden')
  assert.equal(hidden.htmlHidden, false, 'the helper never hides the document element')
  assert.equal(hidden.visibleButtons, 1, 'the non-follow-up action button remains visible')
  assert.doesNotMatch(hidden.text, /Standalone harness/, 'the hidden card contributes no text')
  assert.match(hidden.text, /Root follow-up body/, 'prose next to a root-level follow-up is preserved')
  assert.match(hidden.text, /Action card/, 'the normal action card stays visible')
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
