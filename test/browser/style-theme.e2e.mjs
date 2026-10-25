#!/usr/bin/env node
/** Real recorded-card theming, late catalog subscription, and live DSH/system scheme changes. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-theme-e2e-'))
let server
let browser
let cdp

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/theme-entry.tsx')], outfile: join(temp, 'bundle.js'),
    bundle: true, platform: 'browser', format: 'esm', target: 'chrome120', jsx: 'automatic', absWorkingDir: root,
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    // Only shell icons are replaced; cards, renderer, CSS and theme hooks are production code.
    plugins: [{ name: 'shell-icons', setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'icons', namespace: 'fixture' }))
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const IconChevronDownOutlineRegular = () => null; export const IconSparkleRegular = () => null' }))
    } }],
  })
  await writeFile(join(temp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="./bundle.css"><style>
:root { --dsw-alias-bg-layer-1:#ffffff; --dsw-alias-bg-module-platform:#f5f6f7; --dsw-alias-label-primary:#111111; --dsw-font-family:Arial,sans-serif; }
body[data-ds-dark-theme] { --dsw-alias-bg-layer-1:#181818; --dsw-alias-bg-module-platform:#353638; --dsw-alias-label-primary:#eeeeee; }
body { margin:20px; } #root { max-width:700px; }
</style></head><body><div id="root"></div><script>if (location.search.includes("dsh")) window.__DSH_BOOT__ = {}</script><script type="module" src="./bundle.js"></script></body></html>`)
  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url, width: 900, height: 900 })
  assert.ok(browser, 'Chrome is required for the custom-theme browser check')
  cdp = await connectCdp(browser.port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await cdp.waitFor('document.querySelectorAll(".dsh-iui-host").length === 4', 'recorded cards')

  const read = id => cdp.evaluate(`(() => {
    const card = document.querySelector('[data-dsh-iui-call-id="${id}"]'), host = card.querySelector('.dsh-iui-host'), css = getComputedStyle(host)
    return { styleId: card.getAttribute('data-dsh-iui-style-id'), inline: host.getAttribute('style'),
      canvas: css.getPropertyValue('--iui-canvas').trim(), font: css.getPropertyValue('--iui-font').trim(),
      radius: css.getPropertyValue('--iui-radius-md').trim(), scheme: css.colorScheme,
      chart2: css.getPropertyValue('--iui-chart-2').trim(), success: css.getPropertyValue('--iui-success').trim() }
  })()`)
  const original = await read('default')
  assert.equal((await read('temporary')).canvas, '#edf7ff', 'recorded snapshot renders before any catalog response')
  assert.equal(await cdp.evaluate('document.querySelector("[data-dsh-iui-call-id=temporary]").dataset.dshIuiTempStyle'), 'true')
  assert.equal((await read('temporary')).styleId, null)
  assert.equal((await read('custom')).inline, null, 'catalog is still pending: render with the default')
  assert.equal(original.inline, null)
  assert.equal(original.canvas, '#ffffff')
  assert.equal(original.radius, '10px')
  assert.equal((await read('missing')).inline, null)

  await cdp.evaluate('window.__loadStyles()')
  await cdp.waitFor(`document.querySelector('[data-dsh-iui-call-id="custom"] .dsh-iui-host').style.getPropertyValue('--iui-canvas') === '#edf7ff'`, 'late catalog applied')
  const custom = await read('custom')
  assert.equal(custom.styleId, 'cs_ocean01')
  assert.equal(custom.canvas, '#edf7ff')
  assert.match(custom.font, /Georgia/)
  assert.equal(custom.radius, '14px')
  assert.equal(custom.scheme, 'light')
  assert.equal(custom.chart2, '#00a67d')
  assert.equal(custom.success, '#00805d')
  assert.deepEqual(await read('default'), original, 'no styleId keeps the exact default theme')
  assert.equal((await read('missing')).inline, null, 'missing templates keep the default theme')

  await cdp.evaluate(`document.body.setAttribute('data-ds-dark-theme', '')`)
  await cdp.waitFor(`document.querySelector('[data-dsh-iui-call-id="custom"] .dsh-iui-host').style.colorScheme === 'dark'`, 'DSH attribute mutation')
  const dark = await read('custom')
  assert.equal((await read('temporary')).canvas, '#102030', 'replayed snapshot follows the dark scheme')
  assert.equal(dark.canvas, '#102030')
  assert.equal(dark.chart2, '#22bf91', 'semantic CSS dark overrides remain authoritative')
  assert.equal(dark.success, '#5bcf9c')
  assert.equal((await read('default')).inline, null)
  assert.equal((await read('default')).canvas, '#181818')

  await cdp.evaluate(`document.body.removeAttribute('data-ds-dark-theme')`)
  await cdp.waitFor(`document.querySelector('[data-dsh-iui-call-id="custom"] .dsh-iui-host').style.colorScheme === 'light'`, 'DSH attribute removed')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await cdp.waitFor(`document.querySelector('[data-dsh-iui-call-id="custom"] .dsh-iui-host').style.colorScheme === 'dark'`, 'system fallback changed')
  assert.equal((await read('custom')).canvas, '#102030')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await cdp.waitFor(`document.querySelector('[data-dsh-iui-call-id="custom"] .dsh-iui-host').style.colorScheme === 'light'`, 'system fallback restored')
  await cdp.evaluate('window.__refreshStyles(true)')
  await cdp.waitFor(`document.querySelector('[data-dsh-iui-call-id="custom"] .dsh-iui-host').style.length === 0`, 'unavailable catalog falls back')
  assert.equal((await read('custom')).canvas, original.canvas)
  assert.equal((await read('temporary')).canvas, '#edf7ff', 'inline theme survives catalog failure')
  await cdp.evaluate('window.__refreshStyles(false)')
  await cdp.waitFor(`document.querySelector('[data-dsh-iui-call-id="custom"] .dsh-iui-host').style.colorScheme === 'light'`, 'catalog recovered')
  assert.equal((await read('custom')).canvas, '#edf7ff')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await cdp.send('Page.navigate', { url: `${server.url}?dsh` })
  await cdp.waitFor('!!window.__DSH_BOOT__ && document.querySelectorAll(".dsh-iui-host").length === 4', 'DSH boot fixture')
  assert.equal((await read('temporary')).canvas, '#edf7ff', 'fresh replay uses the snapshot with the catalog still pending')
  await cdp.evaluate('window.__loadStyles()')
  await cdp.waitFor(`document.querySelector('[data-dsh-iui-call-id="custom"] .dsh-iui-host').style.colorScheme === 'light'`, 'DSH light ignores dark system preference')
  assert.equal((await read('custom')).canvas, '#edf7ff')
  await cdp.evaluate(`document.body.setAttribute('data-ds-dark-theme', '')`)
  await cdp.waitFor(`document.querySelector('[data-dsh-iui-call-id="custom"] .dsh-iui-host').dataset.iuiScheme === 'dark'`, 'explicit live-card scheme')
  assert.equal((await read('custom')).canvas, '#102030')
  assert.equal((await read('temporary')).canvas, '#102030')
  await cdp.evaluate(`document.body.removeAttribute('data-ds-dark-theme')`)
  await cdp.waitFor(`document.querySelector('[data-dsh-iui-call-id="custom"] .dsh-iui-host').style.colorScheme === 'light'`, 'DSH absent attribute is authoritative light')
  console.log('style-theme E2E: OK (4 recorded cards; inline replay without catalog, light/dark, late/missing/unavailable catalog and recovery)')
} finally {
  cdp?.close()
  await browser?.cleanup()
  server?.close()
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
