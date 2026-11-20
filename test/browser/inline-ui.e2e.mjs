#!/usr/bin/env node
/** In-message UI fence rendering: settled, streaming and invalid programs, plus the inline surface. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-inline-e2e-'))
let server
let browser
let cdp

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/inline-entry.tsx')], outfile: join(temp, 'bundle.js'),
    bundle: true, platform: 'browser', format: 'esm', target: 'chrome120', jsx: 'automatic', absWorkingDir: root,
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    plugins: [{ name: 'shell-icons', setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'icons', namespace: 'fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const IconChevronDownOutlineRegular = () => null; export const IconSparkleRegular = () => null; export const ReferenceChip = () => null; export const IconCloseOutlineRegular = () => null; export const IconTrashOutlineRegular = () => null; ' }))
    } }],
  })
  await writeFile(join(temp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="./bundle.css"><style>
:root { --dsw-alias-bg-layer-1:#ffffff; --dsw-alias-bg-module-platform:#f5f6f7; --dsw-alias-label-primary:#111111; --dsw-alias-border-l2:#e5e7eb; --dsw-radius-md:12px; --dsw-font-family:Arial,sans-serif; }
body { margin:20px; } #root { max-width:700px; }
</style></head><body><div id="root"></div><script type="module" src="./bundle.js"></script></body></html>`)
  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url, width: 900, height: 900 })
  assert.ok(browser, 'Chrome is required for the in-message UI check')
  cdp = await connectCdp(browser.port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.waitFor('document.querySelectorAll(".dsh-iui-inline-ui").length === 9 && document.querySelector("pre[data-fixture=streaming-code]") !== null', 'inline fixtures')
  await cdp.waitFor('document.querySelectorAll(".dsh-iui-inline-ui")[1]?.querySelector(".dsh-iui-fallback") !== null', 'invalid program fallback')
  await cdp.waitFor('document.querySelectorAll(".dsh-iui-inline-ui")[3]?.querySelector(".dsh-iui-warning") !== null', 'partial program warning')
  await cdp.evaluate('document.querySelector(\'[data-fixture=switch-program]\')?.click()')
  await cdp.waitFor('document.querySelectorAll(".dsh-iui-inline-ui")[7]?.querySelector(".dsh-iui-fallback") !== null', 'program switch fallback')

  const report = await cdp.evaluate(`(() => {
    const inline = [...document.querySelectorAll('.dsh-iui-inline-ui')]
    const first = inline[0], second = inline[1], third = inline[2], fourth = inline[3], fifth = inline[4], sixth = inline[5], seventh = inline[6], eighth = inline[7], ninth = inline[8]
    const streaming = document.querySelector('pre[data-fixture=streaming-code]')
    const firstHost = first?.querySelector('.dsh-iui-host')
    const css = first === undefined ? null : getComputedStyle(first)
    const collapsedCard = ninth?.querySelector('.iui-card')
    const collapsedCardCss = collapsedCard === null || collapsedCard === undefined ? null : getComputedStyle(collapsedCard)
    return {
      inlineCount: inline.length,
      firstFlag: first?.getAttribute('data-dsh-iui-inline'),
      firstText: first?.innerText ?? '',
      firstHasHost: firstHost !== null && firstHost !== undefined,
      firstHasProgram: (first?.innerText ?? '').includes('Inline fixture'),
      firstBackground: css?.backgroundColor,
      firstBorder: css?.borderTopWidth,
      firstWidth: first?.getBoundingClientRect().width ?? 0,
      streamingVisible: streaming !== null && streaming.getBoundingClientRect().height > 0,
      streamingHasSurface: streaming?.closest('.dsh-iui-inline-ui') !== null,
      secondFallback: second?.querySelector('.dsh-iui-fallback') !== null,
      secondFallbackText: second?.innerText ?? '',
      thirdFallback: third?.querySelector('.dsh-iui-fallback') !== null,
      thirdWarning: third?.querySelector('.dsh-iui-warning') !== null,
      thirdRendered: (third?.innerText ?? '').includes('Extra args fixture'),
      thirdHasSvg: third?.querySelector('.iui-svg') !== null,
      fourthFallback: fourth?.querySelector('.dsh-iui-fallback') !== null,
      fourthWarning: fourth?.querySelector('.dsh-iui-warning') !== null,
      fourthRendered: (fourth?.innerText ?? '').includes('Partial fixture'),
      fifthFallback: fifth?.querySelector('.dsh-iui-fallback') !== null,
      fifthFallbackText: fifth?.innerText ?? '',
      sixthFallback: sixth?.querySelector('.dsh-iui-fallback') !== null,
      sixthFallbackText: sixth?.innerText ?? '',
      seventhFallback: seventh?.querySelector('.dsh-iui-fallback') !== null,
      seventhFallbackText: seventh?.innerText ?? '',
      eighthFallback: eighth?.querySelector('.dsh-iui-fallback') !== null,
      eighthFallbackText: eighth?.innerText ?? '',
      collapsedCardBorder: collapsedCardCss?.borderTopWidth,
      collapsedCardPadding: collapsedCardCss?.paddingTop,
      scrollOverflow: document.documentElement.scrollWidth <= innerWidth,
    }
  })()`)
  assert.equal(report.inlineCount, 9, 'settled fences render one inline surface each; the streaming fence stays code')
  assert.equal(report.firstFlag, 'true')
  assert.equal(report.firstHasHost, true, 'the settled fence mounts the production renderer')
  assert.equal(report.firstHasProgram, true, 'the settled fence renders the program content')
  assert.notEqual(report.firstBackground, 'rgba(0, 0, 0, 0)', 'the inline surface keeps the layer background')
  assert.equal(report.firstBorder, '1px')
  assert.ok(report.firstWidth > 200, 'the inline surface keeps a readable width')
  assert.equal(report.streamingVisible, true, 'the streaming fence keeps the plain code block')
  assert.equal(report.streamingHasSurface, false, 'the streaming fence is not wrapped in the inline surface')
  assert.equal(report.secondFallback, true, 'an invalid program falls back instead of breaking the message')
  assert.match(report.secondFallbackText, /could not be rendered/, 'the fallback names the failure')
  assert.equal(report.thirdFallback, false, 'recoverable excess args do not add a contradictory fallback')
  assert.equal(report.thirdWarning, false, 'excess args change nothing the user sees, so they add no warning')
  assert.equal(report.thirdRendered, true, 'recoverable excess args still render the program')
  assert.equal(report.thirdHasSvg, true, 'the permissive parser keeps the component that carried the extra arg')
  assert.equal(report.fourthFallback, false, 'a partial program keeps its usable page')
  assert.equal(report.fourthWarning, true, 'a partial program adds a compact warning instead of the full fallback')
  assert.equal(report.fourthRendered, true, 'the usable root content of the partial program still renders')
  assert.equal(report.fifthFallback, true, 'an invalid program still gets the full fallback')
  assert.match(report.fifthFallbackText, /无法渲染/, 'the locale seat localizes the fallback copy')
  assert.equal(report.sixthFallback, true, 'an empty settled fence shows the no-program fallback')
  assert.match(report.sixthFallbackText, /No program was provided/, 'the no-program fallback is explicit')
  assert.equal(report.seventhFallback, true, 'a non-component root gets the full fallback')
  assert.match(report.seventhFallbackText, /root does not evaluate to a component/, 'the fatal fallback carries its diagnostic')
  assert.equal(report.eighthFallback, true, 'changing to a program with the same diagnostic still gets a fallback')
  assert.ok(report.eighthFallbackText.trim().length > 0, 'the switched program is not left blank')
  assert.equal(report.collapsedCardBorder, '0px', 'a single root outline Card collapses its border inside the inline surface')
  assert.equal(report.collapsedCardPadding, '0px', 'a single root outline Card collapses its padding inside the inline surface')
  assert.equal(report.scrollOverflow, true, 'the inline surface never scrolls the message horizontally')
  console.log('inline-ui E2E: OK (settled inline, streaming code, invalid fallback, excess args silent, partial warning, localized/empty/fatal fallbacks, switch remount)')
} finally {
  cdp?.close()
  await browser?.cleanup()
  server?.close()
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
