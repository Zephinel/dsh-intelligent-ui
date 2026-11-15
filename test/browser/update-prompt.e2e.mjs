#!/usr/bin/env node
/**
 * Browser E2E for the update prompt.
 *
 *   node test/browser/update-prompt.e2e.mjs
 *
 * Covers the two plugin-open signals (the composer chip's explicit enable and a
 * deployment-wide default-open start), the record-then-ask cycle, the per-version
 * later counter and its "do not remind" action, the details expansion, the
 * update action, the English copy/variant, the no-update page, bottom-right
 * placement, and the persisted state document.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-update-prompt-e2e-'))
let server
let browser
let cdp
let checks = 0
const check = (value, expected, message) => { assert.deepEqual(value, expected, message); checks += 1 }
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const TOKENS = `:root{color-scheme:dark;
--dsw-alias-bg-base:#151517;--dsw-alias-bg-layer-1:#232324;--dsw-alias-bg-layer-2:#2c2c2e;--dsw-alias-bg-layer-3:#353638;
--dsw-alias-label-primary:#f9fafb;--dsw-alias-label-secondary:#cfd3d6;--dsw-alias-label-tertiary:#adb2b8;
--dsw-alias-border-l1:#ffffff0f;--dsw-alias-border-l2:#ffffff1f;--dsw-alias-border-l3:#ffffff29;
--dsw-alias-interactive-bg-hover:#ffffff14;--dsw-alias-state-business-primary:#7aaaff;--dsw-alias-label-primary-foreground:#0f1115;
--dsw-radius-sm:6px;--dsw-radius-md:10px;--dsw-radius-lg:14px;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#7aaaff;
--dsw-font-family:system-ui}`

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/update-prompt-entry.tsx')],
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
<style>html,body{margin:0;background:#111;color:#eee;font-family:system-ui}#root{width:100vw;height:100vh}</style>
</head><body><div id="root"></div><script type="module" src="./bundle.js"></script></body></html>`)

  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url + 'index.html', width: 900, height: 1000 })
  if (browser === null) {
    console.log('update-prompt E2E: skipped (Chrome not found; set CHROME_BIN)')
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
      await wait('document.readyState === "complete" && !!window.__controller', 'page loaded')
    }
    const open = kind => read(`window.__controller.noteOpen(${JSON.stringify(kind)})`)
    const card = '!!document.querySelector("[data-dsh-iui-update-prompt]")'
    const waitCard = () => wait(card, 'update prompt appears')
    const noCard = async () => { await sleep(300); check(await read(card), false, 'no prompt is shown') }

    await goto('')
    // The first explicit open only records the newer version.
    await open('explicit-enable')
    await noCard()
    check(await read('window.__promptState().pendingVersion'), '0.6.2', 'the first explicit open records the version')
    check(await read('window.__promptState().laterClicks'), undefined, 'recording does not start the later counter')

    // The second explicit open asks.
    await open('explicit-enable')
    await waitCard()
    check((await read('document.querySelector(".dsh-iui-update-prompt-title").textContent')).includes('dsh-intelligent-ui 有新版本可用'), true, 'the Chinese title is rendered')
    check(await read('document.querySelector("[data-dsh-iui-update-versions]").textContent'), '0.6.1 → 0.6.2', 'the version line shows current to latest')
    check(await read('document.querySelector("[data-dsh-iui-update-action=update]").textContent'), '更新', 'the update action is rendered')
    check(await read('document.querySelector("[data-dsh-iui-update-action=later]").textContent'), '下次再说', 'the later action is rendered')
    check(await read('document.querySelector("[data-dsh-iui-update-action=details]").textContent'), '查看详情', 'the details action is rendered')
    check(await read('!!document.querySelector("[data-dsh-iui-update-action=dont-remind]")'), false, 'do not remind stays hidden before three later clicks')
    const geometry = await read(`(() => {
      const rect = document.querySelector('[data-dsh-iui-update-prompt]').getBoundingClientRect()
      return { right: rect.right, bottom: rect.bottom, width: rect.width, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }
    })()`)
    check(geometry.right <= geometry.viewportWidth - 19.5, true, 'the prompt keeps the right gutter')
    check(geometry.bottom <= geometry.viewportHeight - 19.5, true, 'the prompt keeps the bottom gutter')
    check(geometry.width >= 300, true, 'the prompt keeps a readable width')
    check(await read('window.__fetches.length'), 2, 'each explicit open asks the Host once')

    // Details expand and collapse in place.
    await click('[data-dsh-iui-update-action=details]')
    await wait('!!document.querySelector("[data-dsh-iui-update-details]")', 'details expand')
    check(await read('document.querySelectorAll(".dsh-iui-update-prompt-points li").length'), 3, 'the details list the recorded highlights')
    check(await read('document.querySelector(".dsh-iui-update-prompt-points li").textContent'), '提示等到下一次打开才出现', 'the Chinese highlights are shown')
    check(await read('document.querySelector("[data-dsh-iui-update-action=details]").getAttribute("aria-expanded")'), 'true', 'the details toggle reports the expansion')
    check(await read('document.querySelector("[data-dsh-iui-update-action=details]").textContent'), '收起详情', 'the details action flips its label')
    await click('[data-dsh-iui-update-action=details]')
    check(await read('!!document.querySelector("[data-dsh-iui-update-details]")'), false, 'the details collapse again')

    // "Later" closes the prompt and counts one click for this version.
    await click('[data-dsh-iui-update-action=later]')
    check(await read(card), false, 'later closes the prompt')
    check(await read('window.__promptState().laterClicks'), 1, 'later records one click')
    await open('explicit-enable')
    await waitCard()
    check(await read('!!document.querySelector("[data-dsh-iui-update-action=dont-remind]")'), false, 'the second later click is not enough for silence')
    await click('[data-dsh-iui-update-action=later]')
    await open('explicit-enable')
    await waitCard()
    await click('[data-dsh-iui-update-action=later]')
    check(await read('window.__promptState().laterClicks'), 3, 'three later clicks are recorded')
    await open('explicit-enable')
    await waitCard()
    await wait('!!document.querySelector("[data-dsh-iui-update-action=dont-remind]")', 'do not remind appears')
    check(await read('document.querySelector("[data-dsh-iui-update-action=dont-remind]").textContent'), '不再提醒', 'the silence action is rendered after three later clicks')

    // Silence suppresses this exact version only.
    await click('[data-dsh-iui-update-action=dont-remind]')
    check(await read(card), false, 'do not remind closes the prompt')
    check(await read('window.__promptState().silencedVersion'), '0.6.2', 'do not remind records the silenced version')
    await open('explicit-enable')
    await noCard()

    // The update action only closes this prompt; the next explicit open asks again.
    await goto('')
    await open('explicit-enable')
    await open('explicit-enable')
    await waitCard()
    await click('[data-dsh-iui-update-action=update]')
    check(await read(card), false, 'update closes the prompt')
    check(await read('window.__opened'), 1, 'update opens the plugin detail page')
    await open('explicit-enable')
    await waitCard()

    // A default-open start asks on the first check instead of waiting for a second open.
    await goto('')
    await open('default-open')
    await waitCard()
    check(await read('window.__promptState().pendingVersion'), '0.6.2', 'a default-open prompt records the version too')
    await click('[data-dsh-iui-update-action=later]')
    await open('default-open')
    await waitCard()

    // No newer version means no prompt and no recorded cycle.
    await goto('?update=0')
    await open('explicit-enable')
    await open('explicit-enable')
    await noCard()
    check(await read('window.__promptState().pendingVersion'), undefined, 'an up-to-date check records nothing')

    // English copy comes from the same prompt and the check requests the English notes.
    await goto('?lang=en')
    await open('explicit-enable')
    await open('explicit-enable')
    await waitCard()
    check((await read('document.querySelector(".dsh-iui-update-prompt-title").textContent')).includes('A new version of dsh-intelligent-ui is available'), true, 'the English title is rendered')
    check(await read('document.querySelector("[data-dsh-iui-update-action=update]").textContent'), 'Update', 'the English update action is rendered')
    check(await read('document.querySelector("[data-dsh-iui-update-action=later]").textContent'), 'Later', 'the English later action is rendered')
    check(await read('window.__fetches.some(url => url.includes("lang=en"))'), true, 'the check asks for the English notes variant')
    await click('[data-dsh-iui-update-action=details]')
    await wait('!!document.querySelector("[data-dsh-iui-update-details]")', 'English details')
    check(await read('document.querySelector(".dsh-iui-update-prompt-points li").textContent'), 'The prompt waits for the next open', 'the English highlights are shown')

    console.log(`update-prompt e2e: ${checks} checks passed`)
  }
} finally {
  if (cdp) cdp.close?.()
  if (browser) { try { browser.process.kill('SIGKILL') } catch { /* gone */ } await browser.cleanup?.() }
  if (server) server.close()
  await rm(temp, { recursive: true, force: true })
}
