#!/usr/bin/env node
/**
 * Browser E2E for the sidebar update card.
 *
 *   node test/browser/sidebar-update.e2e.mjs
 *
 * Covers: insertion between New Session and the panel nav inside the sidebar
 * width, the split click targets (the label opens the highlights popover; the
 * rest of the card navigates), the always-right arrow, Escape/outside close,
 * collapsed-rail hiding, the Chinese/English notes variants, and the no-update
 * page staying empty.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-sidebar-update-e2e-'))
let server
let browser
let cdp
let checks = 0
const check = (value, expected, message) => { assert.deepEqual(value, expected, message); checks += 1 }

const TOKENS = `:root{color-scheme:dark;
--dsw-alias-bg-base:#151517;--dsw-alias-bg-layer-1:#232324;--dsw-alias-bg-layer-2:#2c2c2e;--dsw-alias-bg-layer-3:#353638;
--dsw-alias-label-primary:#f9fafb;--dsw-alias-label-secondary:#cfd3d6;--dsw-alias-label-tertiary:#adb2b8;
--dsw-alias-border-l1:#ffffff0f;--dsw-alias-border-l2:#ffffff1f;--dsw-alias-border-l3:#ffffff29;
--dsw-alias-interactive-bg-hover:#ffffff14;--dsw-alias-state-business-primary:#7aaaff;--dsw-alias-label-primary-foreground:#0f1115;
--dsw-radius-sm:6px;--dsw-radius-md:10px;--dsw-radius-lg:14px;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#7aaaff;
--dsw-font-family:system-ui}`

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/sidebar-update-entry.tsx')],
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
  const css = await readFile(join(root, 'src/client/index.css'), 'utf8')
  await writeFile(join(temp, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>${TOKENS}</style><style>${css}</style>
<style>html,body{margin:0;background:#111;color:#eee;font-family:system-ui}#root{width:280px;height:900px}</style>
</head><body><div id="root"></div><script type="module" src="./bundle.js"></script></body></html>`)

  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url + 'index.html', width: 900, height: 1000 })
  if (browser === null) {
    console.log('sidebar-update E2E: skipped (Chrome not found; set CHROME_BIN)')
    process.exitCode = 0
  } else {
    cdp = await connectCdp(browser.port)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    const read = expression => cdp.evaluate(expression)
    const wait = (expression, label, options) => cdp.waitFor(expression, label, options)
    const click = selector => read(`document.querySelector(${JSON.stringify(selector)}).click()`)
    const goto = async query => {
      await cdp.send('Page.navigate', { url: server.url + `index.html${query}` })
      await wait('document.readyState === "complete"', 'page loaded')
    }

    await wait('!!document.querySelector("[data-dsh-iui-sidebar-update]")', 'update card')
    const rect = selector => read(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } })()`)
    const geometry = {
      sidebar: await rect('#sidebar'),
      card: await rect('[data-dsh-iui-sidebar-update]'),
      nav: await rect('nav'),
      newSession: await rect('.newSession'),
    }
    check(geometry.card.right <= geometry.sidebar.right + 0.5, true, 'the card stays inside the sidebar column')
    check(geometry.card.top >= geometry.newSession.bottom - 0.5, true, 'the card starts below New Session')
    check(geometry.card.bottom <= geometry.nav.top + 0.5, true, 'the card ends before the panel nav (no overlap)')
    check(await read('document.querySelector(".dsh-iui-sidebar-update-host")?.nextElementSibling?.tagName'), 'NAV', 'the card host sits directly before the panel nav')
    check((await read('document.querySelector(".dsh-iui-sidebar-update-title").textContent')).includes('dsh-intelligent-ui 有更新可用'), true, 'the Chinese title is rendered')
    check(await read('document.querySelector("[data-dsh-iui-update-card-details]")?.textContent'), '点击查看详情', 'the label is the popover trigger')
    check(await read(`getComputedStyle(document.querySelector('.dsh-iui-sidebar-update-chevron')).transform`), 'none', 'the arrow has no disclosure rotation')

    await click('[data-dsh-iui-update-card-details]')
    await wait('!!document.querySelector("[data-dsh-iui-update-popover]")', 'highlights popover')
    check(await read('document.querySelectorAll(".dsh-iui-update-popover-points li").length'), 3, 'the popover lists the notes points')
    check(await read('document.querySelector("[data-dsh-iui-update-popover]").textContent.includes("侧栏卡片位于 New Session 下方")'), true, 'the Chinese highlights are shown')
    check(await read('!!document.querySelector(".dsh-iui-update-popover-arrow")'), false, 'the popover has no arrow of its own')
    const popoverGeometry = await read(`(() => {
      const popover = document.querySelector('[data-dsh-iui-update-popover]').getBoundingClientRect()
      const card = document.querySelector('[data-dsh-iui-sidebar-update]').getBoundingClientRect()
      return { popoverLeft: popover.left, popoverRight: popover.right, cardRight: card.right, viewport: window.innerWidth }
    })()`)
    check(popoverGeometry.popoverLeft >= popoverGeometry.cardRight, true, 'the popover opens beside the card')
    check(popoverGeometry.popoverRight <= popoverGeometry.viewport, true, 'the popover stays inside the viewport')
    check(await read(`getComputedStyle(document.querySelector('.dsh-iui-sidebar-update-chevron')).transform`), 'none', 'the arrow stays right-pointing while the popover is open')

    await click('[data-dsh-iui-update-card-open]')
    check(await read('window.__opened'), 1, 'clicking the card body opens the plugin detail page')
    check(await read('!!document.querySelector("[data-dsh-iui-update-popover]")'), false, 'navigating closes the popover')

    await click('[data-dsh-iui-update-card-details]')
    await wait('!!document.querySelector("[data-dsh-iui-update-popover]")', 'popover reopened')
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    check(await read('!!document.querySelector("[data-dsh-iui-update-popover]")'), false, 'Escape closes the popover')

    await read(`document.querySelector('#frame').setAttribute('data-sidebar-collapsed','true')`)
    check(await read(`getComputedStyle(document.querySelector('.dsh-iui-sidebar-update-host')).display`), 'none', 'the card hides in the collapsed rail')
    await read(`document.querySelector('#frame').setAttribute('data-sidebar-collapsed','false')`)
    check(await read(`getComputedStyle(document.querySelector('.dsh-iui-sidebar-update-host')).display`), 'contents', 'the card returns when the sidebar expands')

    await goto('?lang=en')
    await wait('!!document.querySelector("[data-dsh-iui-sidebar-update]")', 'English card')
    check((await read('document.querySelector(".dsh-iui-sidebar-update-title").textContent')).includes('Update available for dsh-intelligent-ui'), true, 'the English title is rendered')
    check(await read('window.__fetches.some(url => url.includes("lang=en"))'), true, 'the card asks the Host for the English notes')
    await click('[data-dsh-iui-update-card-details]')
    await wait('!!document.querySelector("[data-dsh-iui-update-popover]")', 'English popover')
    check(await read('document.querySelector(".dsh-iui-update-popover-points li").textContent'), 'Card sits under New Session', 'the English highlights are shown')
    check(await read('document.querySelector(".dsh-iui-update-popover-titles strong").textContent'), "What's new", 'the English popover title is shown')

    await goto('?empty=1')
    await new Promise(resolve => setTimeout(resolve, 700))
    check(await read('!!document.querySelector("[data-dsh-iui-sidebar-update]")'), false, 'no card is inserted when no update is available')

    console.log(`sidebar-update e2e: ${checks} checks passed`)
  }
} finally {
  if (cdp) cdp.close?.()
  if (browser) { try { browser.process.kill('SIGKILL') } catch { /* gone */ } await browser.cleanup?.() }
  if (server) server.close()
  await rm(temp, { recursive: true, force: true })
}
