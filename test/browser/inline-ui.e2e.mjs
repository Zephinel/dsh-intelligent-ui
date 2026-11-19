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
  await cdp.waitFor('document.querySelectorAll(".dsh-iui-inline-ui").length === 3 && document.querySelector("pre[data-fixture=streaming-code]") !== null', 'inline fixtures')
  await cdp.waitFor('document.querySelectorAll(".dsh-iui-inline-ui")[1]?.querySelector(".dsh-iui-fallback") !== null', 'invalid program fallback')

  const report = await cdp.evaluate(`(() => {
    const inline = [...document.querySelectorAll('.dsh-iui-inline-ui')]
    const first = inline[0], second = inline[1], third = inline[2]
    const streaming = document.querySelector('pre[data-fixture=streaming-code]')
    const firstHost = first?.querySelector('.dsh-iui-host')
    const css = first === undefined ? null : getComputedStyle(first)
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
      thirdRendered: (third?.innerText ?? '').includes('Extra args fixture'),
      thirdHasSvg: third?.querySelector('.iui-svg') !== null,
      scrollOverflow: document.documentElement.scrollWidth <= innerWidth,
    }
  })()`)
  assert.equal(report.inlineCount, 3, 'settled fences render one inline surface each; the streaming fence stays code')
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
  assert.equal(report.thirdRendered, true, 'recoverable excess args still render the program')
  assert.equal(report.thirdHasSvg, true, 'the permissive parser keeps the component that carried the extra arg')
  assert.equal(report.scrollOverflow, true, 'the inline surface never scrolls the message horizontally')
  console.log('inline-ui E2E: OK (settled program renders inline, streaming fence keeps code, invalid program falls back, excess args render without a false fallback)')
} finally {
  cdp?.close()
  await browser?.cleanup()
  server?.close()
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
