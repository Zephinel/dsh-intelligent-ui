#!/usr/bin/env node
/**
 * Browser E2E for the update prompt.
 *
 *   node test/browser/update-prompt.e2e.mjs
 *
 * Drives the production trigger path: the real composer chip (ToggleControl →
 * `noteExplicitOpen` → controller) and the deployment-wide settings watcher,
 * with a stubbed Host route and real browser storage. Covers the
 * record-then-ask cycle, the follow-global enable path and the already-enabled
 * no-retrigger rule, cross-reload persistence, the per-version later counter
 * and its "do not remind" action, details expansion, Escape/outside close, the
 * update navigation guard, default-open starts, the no-update page and the
 * English copy/variant.
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
<style>html,body{margin:0;background:#111;color:#eee;font-family:system-ui}#root{width:100vw;height:100vh;padding:24px;box-sizing:border-box}</style>
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
      await wait('document.readyState === "complete" && !!document.querySelector("[data-dsh-iui-toggle]")', 'page loaded')
    }
    const card = '!!document.querySelector("[data-dsh-iui-update-prompt]")'
    const waitCard = () => wait(card, 'update prompt appears')
    const noCard = async () => { await sleep(350); check(await read(card), false, 'no prompt is shown') }
    const chip = '[data-dsh-iui-toggle]'
    const chipEnabled = () => read(`document.querySelector(${JSON.stringify(chip)})?.dataset.enabled ?? null`)
    // React may still hold the previous menu's `open` state for a frame after a
    // scope click, so a single synthetic click can toggle it closed. Retry once
    // the popup has settled instead of depending on a fixed delay.
    const openScopeMenu = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await click(chip)
        await sleep(150)
        if (await read('!!document.querySelector("[data-dsh-iui-menu]")')) return
      }
      throw new Error('scope menu did not open')
    }
    const selectScope = async (index, enabled) => {
      await openScopeMenu()
      const clicked = await read(`(() => { const rows = [...document.querySelectorAll('[data-dsh-iui-menu] [role="menuitem"]')]; const row = rows[${index}]; if (!row) return false; row.click(); return true })()`)
      if (!clicked) throw new Error(`missing scope row ${index}`)
      await wait(`document.querySelector(${JSON.stringify(chip)})?.dataset.enabled === '${enabled ? 'true' : 'false'}'`, `chip ${enabled ? 'enabled' : 'disabled'}`)
      // Let the menu finish unmounting before the next chip click; clicking while
      // React still holds `open = true` would toggle it closed instead of open.
      await wait('!document.querySelector("[data-dsh-iui-menu]")', 'scope menu closed')
    }
    const enable = () => selectScope(1, true)
    const disable = () => selectScope(0, false)
    const promptState = () => read('window.__promptState()')

    await goto('?fresh=1')
    check(await chipEnabled(), 'false', 'the chip starts disabled')
    await enable()
    await noCard()
    check((await promptState()).pendingVersion, '0.6.1', 'the first explicit enable only records the version')

    await disable()
    await enable()
    await waitCard()
    check((await read('document.querySelector(".dsh-iui-update-prompt-title").textContent')).includes('dsh-intelligent-ui 有新版本可用'), true, 'the Chinese title is rendered')
    check(await read('document.querySelector("[data-dsh-iui-update-versions]").textContent'), '0.5.0 → 0.6.1', 'the version line shows current to latest')
    check(await read('document.querySelector("[data-dsh-iui-update-action=update]").textContent'), '更新', 'the update action is rendered')
    check(await read('document.querySelector("[data-dsh-iui-update-action=later]").textContent'), '下次再说', 'the later action is rendered')
    check(await read('!!document.querySelector("[data-dsh-iui-update-action=dont-remind]")'), false, 'do not remind stays hidden before three later clicks')
    const geometry = await read(`(() => {
      const rect = document.querySelector('[data-dsh-iui-update-prompt]').getBoundingClientRect()
      return { right: rect.right, bottom: rect.bottom, width: rect.width, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }
    })()`)
    check(geometry.right <= geometry.viewportWidth - 19.5, true, 'the prompt keeps the right gutter')
    check(geometry.bottom <= geometry.viewportHeight - 19.5, true, 'the prompt keeps the bottom gutter')
    check(geometry.width >= 300, true, 'the prompt keeps a readable width')

    await click('[data-dsh-iui-update-action=details]')
    await wait('!!document.querySelector("[data-dsh-iui-update-details]")', 'details expand')
    check(await read('document.querySelectorAll(".dsh-iui-update-prompt-points li").length'), 3, 'the details list the recorded highlights')
    check(await read('document.querySelector(".dsh-iui-update-prompt-points li").textContent'), '提示等到下一次打开才出现', 'the Chinese highlights are shown')
    await click('[data-dsh-iui-update-action=details]')
    check(await read('!!document.querySelector("[data-dsh-iui-update-details]")'), false, 'the details collapse again')

    // Later closes, counts one click and the next explicit enable asks again.
    await click('[data-dsh-iui-update-action=later]')
    check(await read(card), false, 'later closes the prompt')
    check((await promptState()).laterClicks, 1, 'later records one click')
    await disable()
    await enable()
    await waitCard()
    await click('[data-dsh-iui-update-action=later]')
    await disable()
    await enable()
    await waitCard()
    await click('[data-dsh-iui-update-action=later]')
    check((await promptState()).laterClicks, 3, 'three later clicks are recorded')
    await disable()
    await enable()
    await waitCard()
    await wait('!!document.querySelector(\'[data-dsh-iui-update-action="dont-remind"]\')', 'silence action')
    check(await read('document.querySelector("[data-dsh-iui-update-action=dont-remind]").textContent'), '不再提醒', 'the silence action is rendered after three later clicks')
    await click('[data-dsh-iui-update-action=dont-remind]')
    check(await read(card), false, 'do not remind closes the prompt')
    check((await promptState()).silencedVersion, '0.6.1', 'do not remind records the silenced version')
    await disable()
    await enable()
    await noCard()

    // The update action closes only when navigation started; the next enable asks again.
    await goto('?fresh=1')
    await enable()
    await disable()
    await enable()
    await waitCard()
    await click('[data-dsh-iui-update-action=update]')
    check(await read(card), false, 'update closes the prompt')
    check(await read('window.__opened'), 1, 'update opens the plugin detail page')
    await disable()
    await enable()
    await waitCard()

    // Without the Plugins panel the prompt stays open instead of closing silently.
    await goto('?fresh=1&nonav=1')
    await enable()
    await disable()
    await enable()
    await waitCard()
    await click('[data-dsh-iui-update-action=update]')
    check(await read(card), true, 'update keeps the prompt when navigation is unavailable')
    check(await read('window.__opened'), 0, 'no navigation was attempted')

    // Escape and an outside click both settle like Later.
    await goto('?fresh=1')
    await enable()
    await disable()
    await enable()
    await waitCard()
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await wait(`!(${card})`, 'escape closes the prompt')
    check((await promptState()).laterClicks, 1, 'Escape counts like later')
    await disable()
    await enable()
    await waitCard()
    await read(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
    await wait(`!(${card})`, 'outside click closes the prompt')
    check((await promptState()).laterClicks, 2, 'an outside click counts like later')

    // A default-open page start asks on the first check; a mid-session flip waits for the next start.
    await goto('?fresh=1')
    await read('window.__setGlobal(true)')
    await sleep(350)
    check(await read(card), false, 'a mid-session global enable waits for the next page start')
    await goto('?fresh=1&global=1')
    await waitCard()

    // "Follow global" while the global switch is on counts as an explicit open;
    // an already-enabled scope change must not.
    await goto('?fresh=1')
    // The follow-global enable below only resolves enabled if this patch
    // actually re-rendered the chip, so it doubles as the re-render proof.
    await read(`window.__setProjection({ sessionEnable: 'off', globalEnabled: true, enabled: false })`)
    await selectScope(2, true)
    check(await read('window.__opens'), 1, 'follow-global enable triggers the update check')
    await noCard()
    await selectScope(0, false)
    await selectScope(2, true)
    await waitCard()
    const opensBefore = await read('window.__opens')
    await selectScope(1, true)
    check(await read('window.__opens'), opensBefore, 'an already-enabled scope change does not re-trigger')

    // The recorded cycle survives a page reload.
    await goto('?fresh=1')
    await enable()
    await noCard()
    await goto('')
    await enable()
    await waitCard()

    // No newer version means no prompt and no recorded cycle.
    await goto('?fresh=1&update=0')
    await enable()
    await disable()
    await enable()
    await noCard()
    check((await promptState()).pendingVersion, undefined, 'an up-to-date check records nothing')

    // English copy and the English notes variant.
    await goto('?fresh=1&lang=en')
    await enable()
    await disable()
    await enable()
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
