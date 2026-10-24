#!/usr/bin/env node
/**
 * Browser E2E for the custom export background picker.
 *
 *   npm run test:browser
 */
import nodeAssert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-settings-e2e-'))
let server
let browser
let cdp
let assertions = 0
const assert = new Proxy(nodeAssert, { get(target, key) {
  const value = target[key]
  return typeof value === 'function' ? (...args) => { assertions += 1; return value(...args) } : value
} })

const TOKENS = `:root{color-scheme:dark;--dsw-alias-bg-layer-1:#1b1b1b;--dsw-alias-bg-layer-2:#242424;--dsw-alias-bg-layer-3:#2e2e2e;--dsw-alias-border-l1:#323232;--dsw-alias-border-l2:#3c3c3c;--dsw-alias-border-l3:#505050;--dsw-alias-label-primary:#f2f2f2;--dsw-alias-label-secondary:#b8b8b8;--dsw-alias-label-tertiary:#8b8b8b;--dsw-alias-label-caption:#8a8a8a;--dsw-alias-label-dimmed:#666;--dsw-alias-label-primary-foreground:#111;--dsw-alias-interactive-bg-hover:#2e2e2e;--dsw-alias-state-business-primary:#6aa9ff;--dsw-alias-brand-primary:#6aa9ff;--dsw-alias-state-error-primary:#ff7b72;--dsw-radius-xs:4px;--dsw-radius-sm:6px;--dsw-radius-md:10px;--dsw-radius-lg:14px;--dsw-radius-xl:18px;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:#6aa9ff;--dsw-font-family:system-ui,-apple-system,"PingFang SC",sans-serif}`

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/settings-entry.tsx')],
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
  await writeFile(join(temp, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>${TOKENS}</style><link rel="stylesheet" href="./bundle.css">
<style>html,body{margin:0;background:#111;color:#eee;font-family:system-ui}#root{width:760px;margin:0 auto;padding:32px 0}</style>
</head><body><div id="root"></div><script type="module" src="./bundle.js"></script></body></html>`)

  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url + 'index.html', width: 900, height: 1200 })
  if (browser === null) {
    console.log('settings-picker E2E: skipped (Chrome not found; set CHROME_BIN)')
    process.exitCode = 0
    await cleanup()
    process.exit()
  }
  cdp = await connectCdp(browser.port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.waitFor('document.readyState === "complete"', 'load', { timeout: 60000 })
  await cdp.waitFor('!!document.querySelector("[data-dsh-iui-export-background]")', 'background trigger', { timeout: 60000 })

  const before = await cdp.evaluate(`(() => ({
    text: document.querySelector('[data-dsh-iui-export-background]').textContent.trim(),
    native: document.querySelectorAll('input[type=color]').length,
  }))()`)
  assert.equal(before.text, '#ffffff')
  assert.equal(before.native, 0, 'the native color dialog is gone')

  await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-color-panel")', 'color panel')
  const panel = await cdp.evaluate(`(() => ({
    options: document.querySelectorAll('.dsh-iui-color-option').length,
    swatch: document.querySelector('.dsh-iui-color-panel .dsh-iui-color-option[aria-pressed="true"]')?.getAttribute('aria-label'),
    controlled: document.querySelector('[data-dsh-iui-export-background]').getAttribute('aria-controls'),
    panelId: document.querySelector('.dsh-iui-color-panel').id,
    focusInHex: document.activeElement === document.querySelector('.dsh-iui-color-hex-input'),
  }))()`)
  assert.equal(panel.options, 12, 'the preset palette is rendered')
  assert.equal(panel.swatch, '#ffffff')
  assert.equal(panel.controlled, panel.panelId, 'the trigger points at the dialog panel')
  assert.equal(panel.focusInHex, true, 'opening the picker focuses the hex field')

  await cdp.evaluate('document.querySelector(".dsh-iui-color-option[aria-label=\\"#111827\\"]").click()')
  await cdp.waitFor('window.__calls.length === 1', 'preset commit')
  const preset = await cdp.evaluate('window.__calls[0]')
  assert.equal(preset.field, 'exportBackground')
  assert.equal(preset.value, '#111827')
  await cdp.waitFor('!document.querySelector(".dsh-iui-color-panel")', 'panel closes after preset')
  assert.equal(await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").textContent.trim()'), '#111827')

  await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-color-panel")', 'color panel reopened')
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.dsh-iui-color-hex-input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '#123456')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })()`)
  await cdp.waitFor('window.__calls.length === 2', 'hex commit')
  const hex = await cdp.evaluate('window.__calls[1]')
  assert.equal(hex.field, 'exportBackground')
  assert.equal(hex.value, '#123456')
  await cdp.waitFor('!document.querySelector(".dsh-iui-color-panel")', 'panel closes after Enter')

  // A real mouse click on a preset while the hex field has focus must save the
  // preset, not the stale draft. This covers blur-before-click ordering.
  await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-color-panel")', 'color panel for mouse preset')
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.dsh-iui-color-hex-input')
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '#abcdef')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const presetPoint = await cdp.evaluate(`(() => {
    const element = document.querySelector('.dsh-iui-color-option[aria-label="#111827"]')
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: presetPoint.x, y: presetPoint.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: presetPoint.x, y: presetPoint.y, button: 'left', clickCount: 1 })
  await cdp.waitFor('window.__calls.length === 3', 'mouse preset commit')
  assert.equal((await cdp.evaluate('window.__calls[2].value')), '#111827', 'the preset wins over the focused hex draft')
  await cdp.waitFor('!document.querySelector(".dsh-iui-color-panel")', 'panel closes after mouse preset')

  // Clicking outside while the hex field holds a valid draft commits it
  // instead of discarding it with the unmounted panel.
  await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-color-panel")', 'color panel for outside commit')
  await cdp.evaluate(`(() => {
    const input = document.querySelector('.dsh-iui-color-hex-input')
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '#00aa00')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const outsidePoint = await cdp.evaluate(`(() => {
    const rect = document.querySelector('.dsh-iui-settings-title').getBoundingClientRect()
    return { x: rect.left + 4, y: rect.top + rect.height / 2 }
  })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: outsidePoint.x, y: outsidePoint.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: outsidePoint.x, y: outsidePoint.y, button: 'left', clickCount: 1 })
  await cdp.waitFor('window.__calls.length === 4', 'outside click commits the draft')
  assert.equal((await cdp.evaluate('window.__calls[3].value')), '#00aa00')
  await cdp.waitFor('!document.querySelector(".dsh-iui-color-panel")', 'panel closes after outside commit')

  // Escape closes the dialog and returns focus to its trigger.
  await cdp.evaluate('document.querySelector("[data-dsh-iui-export-background]").click()')
  await cdp.waitFor('!!document.querySelector(".dsh-iui-color-panel")', 'color panel for Escape')
  await cdp.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await cdp.waitFor('!document.querySelector(".dsh-iui-color-panel")', 'panel closes on Escape')
  assert.equal(await cdp.evaluate('document.activeElement.hasAttribute("data-dsh-iui-export-background")'), true, 'focus returns to the trigger')

  // The settings picker persists saved global ids, and filters session-only templates.
  await cdp.waitFor(`document.querySelectorAll('.dsh-iui-custom-card').length === 3`, 'global styles catalog')
  assert.equal(await cdp.evaluate(`document.querySelector('[data-style-id="cs_session3"]') === null`), true)
  await cdp.waitFor(`!document.querySelector('[data-style-id="cs_ocean01"]').disabled`, 'settings picker enabled')
  await cdp.evaluate(`document.querySelector('[data-style-id="cs_ocean01"]').click()`)
  await cdp.waitFor(`document.querySelector('[data-style-id="cs_ocean01"]').getAttribute('aria-pressed') === 'true'`, 'custom global default saved')
  assert.deepEqual(await cdp.evaluate('window.__calls.at(-1)'), { field: 'answerStyle', value: 'cs_ocean01' })
  await cdp.waitFor(`!document.querySelector('[data-style-id="article"]').disabled`, 'custom write settled')
  await cdp.evaluate(`document.querySelector('[data-style-id="article"]').click()`)
  await cdp.waitFor(`document.querySelector('[data-style-id="article"]').getAttribute('aria-pressed') === 'true'`, 'built-in global default saved')
  assert.deepEqual(await cdp.evaluate('window.__calls.at(-1)'), { field: 'answerStyle', value: 'article' })

  await cdp.waitFor(`!document.querySelector('[data-style-id="cs_free004"]').disabled`, 'free picker enabled')
  await cdp.evaluate(`document.querySelector('[data-style-id="cs_free004"]').click()`)
  await cdp.waitFor(`document.querySelector('[data-style-id="cs_free004"]').getAttribute('aria-pressed') === 'true'`, 'free global default saved')
  assert.deepEqual(await cdp.evaluate('window.__calls.at(-1)'), { field: 'answerStyle', value: 'cs_free004' })
  assert.match(await cdp.evaluate('document.querySelector("[data-style-id=cs_free004]").textContent'), /Free layout/)

  // Settings has management only, global templates only, and shares the composer menus.
  const read = expression => cdp.evaluate(expression)
  const wait = expression => cdp.waitFor(expression, expression)
  const click = selector => read(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const dialog = '.dsh-iui-style-popover[role=dialog]'
  const popupButton = label => read(`[...document.querySelectorAll('.dsh-iui-style-popover button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`)
  const setField = (selector, value) => read(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  const manage = '[data-dsh-iui-manage=cs_ocean01]'
  const menu = async () => { await read(`document.querySelector('${manage}').scrollIntoView({block:'center'})`); await click(manage); await wait('!!document.querySelector(".dsh-iui-template-menu")') }
  assert.equal(await read('!!document.querySelector("[data-dsh-iui-on-demand-entry], [data-dsh-iui-save-result]")'), false, 'no generation workbench')
  await read('window.__readonly(true)')
  await wait(`document.querySelector('${manage}').disabled`)
  assert.equal(await read('document.querySelectorAll("[data-dsh-iui-manage]:not(:disabled)").length'), 0)
  await read('window.__readonly(false)'); await wait(`!document.querySelector('${manage}').disabled`)
  await menu(); await popupButton('Use as global default')
  await wait('document.querySelector("[data-style-id=cs_ocean01]").getAttribute("aria-pressed")==="true"')
  assert.deepEqual(await read('window.__calls.at(-1)'), { field: 'answerStyle', value: 'cs_ocean01' })
  await menu(); await popupButton('Rename'); await wait(`!!document.querySelector('${dialog} input')`)
  await setField(`${dialog} input`, 'Ocean renamed')
  await read('window.__styleError="duplicate_name"')
  await popupButton('Save'); await wait(`!!document.querySelector('${dialog} [role=alert]')`)
  assert.match(await read(`document.querySelector('${dialog} [role=alert]').textContent`), /already exists/)
  await read('window.__styleError=""')
  await popupButton('Save'); await wait(`!document.querySelector('${dialog}')`)
  assert.equal(await read('document.querySelector("[data-style-id=cs_ocean01]").getAttribute("aria-pressed")'), 'true')
  assert.match(await read('document.querySelector("[data-style-id=cs_ocean01]").textContent'), /Ocean renamed/)
  await menu(); await popupButton('Edit preferences'); await wait(`!!document.querySelector('${dialog} textarea')`)
  await setField(`${dialog} textarea`, 'Updated description')
  await setField(`${dialog} textarea[maxlength="2000"]`, 'Prefer readable hierarchy.')
  await popupButton('Save'); await wait(`!document.querySelector('${dialog}')`)
  assert.deepEqual(await read('window.__stylePosts.at(-1)'), { op: 'update', id: 'cs_ocean01', patch: { description: 'Updated description', directives: 'Prefer readable hierarchy.' } })
  await read(`window.__downloads=[];window.__blobs=[];URL.createObjectURL=blob=>{window.__blobs.push(blob);return 'blob:template'};
    HTMLAnchorElement.prototype.click=function(){window.__downloads.push({name:this.download,rel:this.rel,attached:this.isConnected})}`)
  await menu(); await popupButton('Export file'); await wait(`!!document.querySelector('${dialog}')`)
  assert.deepEqual(await read('window.__downloads'), [], 'confirmation comes before download')
  assert.match(await read(`document.querySelector('${dialog}').textContent`), /sensitive text/)
  await popupButton('Cancel'); await wait(`!document.querySelector('${dialog}')`)
  assert.deepEqual(await read('window.__downloads'), [])
  await menu(); await popupButton('Export file'); await popupButton('Download')
  assert.deepEqual(await read('window.__downloads'), [{ name: 'Ocean-renamed.iui-style.json', rel: 'noopener', attached: true }])
  assert.equal(await read('document.querySelectorAll("a[download]").length'), 0)
  const exported = await read('window.__blobs[0].text().then(JSON.parse)')
  assert.deepEqual(Object.keys(exported), ['kind', 'schemaVersion', 'template'])
  assert.equal(exported.kind, 'dsh-intelligent-ui/style-template')
  assert.equal(exported.schemaVersion, 1)
  assert.equal(exported.template.name, 'Ocean renamed')
  assert.equal(exported.template.directives, 'Prefer readable hierarchy.')
  assert.equal(exported.template.theme.light.canvas, '#edf7ff')
  assert.deepEqual(Object.keys(exported.template), ['name', 'description', 'baseLayout', 'directives', 'theme'])
  for (const key of ['id', 'scope', 'sessionId', 'createdAt', 'updatedAt']) assert.equal(key in exported.template, false)

  await click('[data-dsh-iui-manage=cs_free004]'); await popupButton('Export file'); await popupButton('Download')
  const freeExport = await read('window.__blobs[1].text().then(JSON.parse)')
  assert.equal(freeExport.template.baseLayout, 'free')
  assert.match(await read('window.__downloads[1].name'), /\.iui-style\.json$/)

  // Import errors are local and never send a POST. File size is checked before reading.
  const startImport = async () => {
    await click('[data-dsh-iui-import]')
    await wait(`!!document.querySelector('${dialog} textarea')`)
  }
  const postsBefore = await read('window.__stylePosts.length')
  await startImport()
  assert.equal(await read(`document.activeElement.textContent`), 'Choose file', 'hidden input does not take initial focus')
  await setField(`${dialog} textarea`, JSON.stringify({ ...exported, schemaVersion: 2 }))
  await popupButton('Preview'); await wait(`!!document.querySelector('${dialog} [role=alert]')`)
  assert.match(await read(`document.querySelector('${dialog} [role=alert]').textContent`), /version is unsupported/)
  assert.equal(await read('window.__stylePosts.length'), postsBefore)
  await setField(`${dialog} textarea`, '中'.repeat(10923))
  await popupButton('Preview'); await wait(`document.querySelector('${dialog} [role=alert]')?.textContent.includes('32 KiB')`)
  assert.equal(await read('window.__stylePosts.length'), postsBefore)
  await read(`(() => {
    window.__fileReads=0;window.__originalFileText=File.prototype.text;
    File.prototype.text=function(){window.__fileReads++;return window.__originalFileText.call(this)};
    const data=new DataTransfer();data.items.add(new File(['x'.repeat(32769)],'too-big.iui-style.json',{type:'application/json'}));
    const input=document.querySelector('[data-dsh-iui-import-file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await wait(`document.querySelector('${dialog} [role=alert]')?.textContent.includes('32 KiB')`)
  assert.equal(await read('window.__fileReads'), 0)
  assert.match(await read(`document.querySelector('${dialog}').textContent`), /too-big.iui-style.json/)
  await popupButton('Cancel'); await wait(`!document.querySelector('${dialog}')`)

  // Paste -> preview -> review/edit -> acknowledge -> save. It must not select the new style.
  await startImport()
  const shared = { ...exported, template: { ...exported.template, baseLayout: 'free',
    description: '<img src=x onerror=alert(1)>', directives: 'External text: <script>window.__injected=true</script>\nKeep full text visible.' } }
  await setField(`${dialog} textarea`, JSON.stringify(shared))
  await popupButton('Preview'); await wait(`!!document.querySelector('${dialog} input[maxlength="30"]')`)
  assert.equal(await read(`document.querySelector('${dialog} input[maxlength="30"]').value`), 'Ocean renamed (Imported)')
  assert.match(await read(`document.querySelector('${dialog}').textContent`), /suffix was suggested/)
  assert.match(await read(`document.querySelector('${dialog}').textContent`), /Free layout/)
  assert.equal(await read(`document.querySelectorAll('${dialog} .dsh-iui-template-swatch').length`), 6)
  assert.equal(await read(`document.querySelector('${dialog} pre').textContent`), shared.template.directives)
  assert.equal(await read(`document.querySelector('${dialog} script, ${dialog} img') === null && !window.__injected`), true)
  const importDisabled = () => read(`[...document.querySelectorAll('${dialog} button')].find(b=>b.textContent==='Import template').disabled`)
  assert.equal(await importDisabled(), true, 'nonempty external preferences need acknowledgement')
  await click(`${dialog} input[type=checkbox]`)
  assert.equal(await importDisabled(), false)
  await setField(`${dialog} input[maxlength="30"]`, 'Ocean renamed (Imported) X')
  assert.equal(await importDisabled(), true, 'editing the prompt-bearing name resets the acknowledgement')
  await click(`${dialog} input[type=checkbox]`)
  await setField(`${dialog} input[maxlength="30"]`, 'Ocean renamed (Imported)')
  assert.equal(await importDisabled(), true, 'restoring the name still needs a fresh acknowledgement')
  await click(`${dialog} input[type=checkbox]`)
  assert.equal(await read(`!!document.querySelector('${dialog} input[maxlength="100"]') && !document.querySelector('${dialog} textarea[maxlength="100"]')`), true, 'description is a single-line field')
  await popupButton('Edit display preferences')
  await setField(`${dialog} textarea[maxlength="2000"]`, 'Edited external text')
  assert.equal(await importDisabled(), true, 'editing clears prior acknowledgement')
  await popupButton('Clear display preferences')
  assert.equal(await read(`!!document.querySelector('${dialog} input[type=checkbox]')`), true)
  assert.equal(await importDisabled(), true, 'clearing preferences resets the acknowledgement')
  await click(`${dialog} input[type=checkbox]`)
  assert.equal(await importDisabled(), false)
  await setField(`${dialog} textarea[maxlength="2000"]`, shared.template.directives)
  await popupButton('Finish editing')
  await click(`${dialog} input[type=checkbox]`)
  await read('window.__styleError="duplicate_name"')
  await popupButton('Import template'); await wait(`!!document.querySelector('${dialog} [role=alert]')`)
  assert.match(await read(`document.querySelector('${dialog} [role=alert]').textContent`), /already exists/)
  assert.equal(await read(`document.querySelector('${dialog} pre').textContent`), shared.template.directives)
  await read('window.__styleError="limit_reached"')
  await popupButton('Import template'); await wait(`document.querySelector('${dialog} [role=alert]')?.textContent.includes('limit')`)
  assert.match(await read(`document.querySelector('${dialog} [role=alert]').textContent`), /template limit/)
  await read('window.__styleError="";window.__holdStyleSave=true')
  const beforeSave = await read('window.__stylePosts.length')
  const defaultsBefore = await read('window.__calls.length')
  await read(`(() => {const b=[...document.querySelectorAll('${dialog} button')].find(b=>b.textContent==='Import template');b.click();b.click()})()`)
  await wait('!!window.__releaseStyleSave')
  assert.equal(await read('window.__stylePosts.length'), beforeSave + 1, 'busy submission cannot double POST')
  assert.equal(await read(`document.querySelector('${dialog} input[maxlength="30"]').disabled`), true)
  await read('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
  assert.equal(await read(`!!document.querySelector('${dialog}')`), true, 'Escape cannot dismiss an in-flight import')
  assert.equal(await read(`document.querySelector('${dialog}').contains(document.activeElement)`), true, 'focus stays in the in-flight import dialog')
  await read('window.__readonly(true)')
  await wait('document.querySelector("[data-dsh-iui-import]").disabled === true')
  assert.equal(await read(`!!document.querySelector('${dialog}')`), true, 'settings disable cannot dismiss an in-flight import')
  await read('window.__readonly(false)')
  await read('window.__holdStyleSave=false;window.__releaseStyleSave()')
  await wait(`!document.querySelector('${dialog}')`)
  await wait('document.querySelectorAll(".dsh-iui-custom-card").length===4')

  const savedImport = await read('window.__stylePosts.at(-1)')
  assert.deepEqual(savedImport, { op: 'save', template: { ...shared.template, name: 'Ocean renamed (Imported)' }, scope: 'global' })
  assert.equal(await read('window.__calls.length'), defaultsBefore, 'import does not write settings')
  assert.equal(await read('document.querySelector("[data-style-id=cs_ocean01]").getAttribute("aria-pressed")'), 'true')
  assert.match(await read('document.querySelector(".dsh-iui-template-import-entry [role=status]").textContent'), /Imported “Ocean renamed \(Imported\)”/)
  // A failure injected after the held save keeps its error beside the trigger when the parent stays disabled.
  await startImport()
  await setField(`${dialog} textarea`, JSON.stringify(freeExport))
  await popupButton('Preview'); await wait(`!!document.querySelector('${dialog} input[maxlength="30"]')`)
  await click(`${dialog} input[type=checkbox]`)
  await read('window.__holdStyleSave=true')
  await popupButton('Import template')
  await wait('!!window.__releaseStyleSave')
  await read('window.__styleError="duplicate_name";window.__readonly(true)')
  await read('window.__releaseStyleSave()')
  await wait(`!document.querySelector('${dialog}')`)
  await wait(`!!document.querySelector('.dsh-iui-template-import-entry [role=alert]')`)
  assert.match(await read(`document.querySelector('.dsh-iui-template-import-entry [role=alert]').textContent`), /already exists/)
  await read('window.__styleError="";window.__holdStyleSave=false;window.__readonly(false)')

  // File input ignores MIME/name; empty preferences still need the external-content acknowledgement.
  await startImport()
  const fileEnvelope = { ...freeExport, template: { ...freeExport.template, name: 'File free', directives: '' } }
  const weirdName = 'file\u2028name.txt'
  await read(`(() => {
    const data=new DataTransfer();data.items.add(new File([${JSON.stringify(JSON.stringify(fileEnvelope))}],${JSON.stringify(weirdName)},{type:'text/plain'}));
    const input=document.querySelector('[data-dsh-iui-import-file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await wait(`document.querySelector('${dialog} textarea').value.includes('File free')`)
  await popupButton('Preview'); await wait(`!!document.querySelector('${dialog} input[maxlength="30"]')`)
  assert.match(await read(`document.querySelector('${dialog}').textContent`), /file name\.txt/)
  assert.equal(await read(`document.querySelector('${dialog}').textContent.includes('\u2028')`), false, 'selected file name cannot break the line')
  assert.equal(await importDisabled(), true, 'empty preferences still need external-content acknowledgement')
  await click(`${dialog} input[type=checkbox]`)
  assert.equal(await importDisabled(), false)
  await popupButton('Import template'); await wait(`!document.querySelector('${dialog}')`)
  assert.deepEqual(await read('window.__stylePosts.at(-1)'), { op: 'save', template: { ...fileEnvelope.template, name: 'File free' }, scope: 'global' })
  // Imported templates retain every ordinary management action.
  const fileId = await read(`[...document.querySelectorAll('.dsh-iui-custom-item')].find(el=>el.textContent.includes('File free')).querySelector('[data-dsh-iui-manage]').getAttribute('data-dsh-iui-manage')`)
  const fileMenu = async () => { await click(`[data-dsh-iui-manage=${fileId}]`); await wait('!!document.querySelector(".dsh-iui-template-menu")') }
  await fileMenu(); await popupButton('Use as global default')
  await wait(`document.querySelector('[data-style-id=${fileId}]').getAttribute('aria-pressed')==='true'`)
  await fileMenu(); await popupButton('Rename'); await setField(`${dialog} input`, 'Imported renamed'); await popupButton('Save')
  await wait(`!document.querySelector('${dialog}')`)
  assert.match(await read(`document.querySelector('[data-style-id=${fileId}]').textContent`), /Imported renamed/)
  await fileMenu(); await popupButton('Edit preferences'); await setField(`${dialog} textarea[maxlength="2000"]`, 'Locally edited')
  await popupButton('Save'); await wait(`!document.querySelector('${dialog}')`)
  await fileMenu(); await popupButton('Export file'); await popupButton('Download')
  const reexported = await read('window.__blobs.at(-1).text().then(JSON.parse)')
  assert.deepEqual(reexported.template, { ...freeExport.template, name: 'Imported renamed', directives: 'Locally edited' })
  await fileMenu(); await popupButton('Delete'); await popupButton('Delete')
  await wait(`!document.querySelector('[data-style-id=${fileId}]')`)
  assert.equal(await read('window.__calls.at(-1).value'), 'auto')
  await click('[data-style-id=cs_ocean01]')
  await wait('document.querySelector("[data-style-id=cs_ocean01]").getAttribute("aria-pressed")==="true"')
  await startImport()
  await read('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
  await wait(`!document.querySelector('${dialog}')`)
  assert.equal(await read('document.activeElement.hasAttribute("data-dsh-iui-import")'), true)
  await menu(); await popupButton('Delete'); await wait(`!!document.querySelector('${dialog}')`)
  await popupButton('Cancel'); await wait(`!document.querySelector('${dialog}')`)
  assert.equal(await read('!!document.querySelector("[data-style-id=cs_ocean01]")'), true)
  await menu(); await popupButton('Delete'); await wait(`!!document.querySelector('${dialog}')`)
  await read('window.__settingsFail=true')
  await popupButton('Delete'); await wait(`!!document.querySelector('${dialog} [role=alert]')`)
  const deleteCount = await read('window.__stylePosts.filter(p=>p.op==="delete").length')
  await read('window.__settingsFail=false')
  await popupButton('Delete'); await wait('!document.querySelector("[data-style-id=cs_ocean01]")')
  assert.equal(await read('window.__stylePosts.filter(p=>p.op==="delete").length'), deleteCount)
  assert.deepEqual(await read('window.__calls.at(-1)'), { field: 'answerStyle', value: 'auto' })
  assert.match(await read('document.querySelector(".dsh-iui-settings").textContent'), /global default is now Auto/)
  // At the global quota, preview remains inspectable but cannot be imported.
  const quotaBase = { ...freeExport.template, id: 'cs_quota000', name: 'Quota 0', scope: 'global', createdAt: 1, updatedAt: 2 }
  const quotaTemplates = Array.from({ length: 40 }, (_, index) => ({ ...quotaBase, id: `cs_quota${String(index).padStart(3, '0')}`, name: `Quota ${index}`, createdAt: 1 + index, updatedAt: 2 + index }))
  await read(`window.__setTemplates(${JSON.stringify(quotaTemplates)})`)
  await wait('document.querySelectorAll(".dsh-iui-custom-card").length===40')
  await startImport(); await setField(`${dialog} textarea`, JSON.stringify(freeExport)); await popupButton('Preview')
  await wait(`!!document.querySelector('${dialog} input[maxlength="30"]')`)
  await click(`${dialog} input[type=checkbox]`)
  assert.equal(await importDisabled(), true)
  assert.match(await read(`document.querySelector('${dialog} [role=alert]').textContent`), /40 templates/)
  await popupButton('Cancel')
  // Localized errors, narrow viewport placement and keyboard focus stay usable.
  await read('window.__setTemplates([]);window.__setLocale("zh")')
  await wait('document.querySelector("[data-dsh-iui-import]").textContent==="导入模板"')
  await startImport(); await setField(`${dialog} textarea`, JSON.stringify({ ...freeExport, schemaVersion: 2 }))
  await popupButton('预览'); await wait(`!!document.querySelector('${dialog} [role=alert]')`)
  assert.match(await read(`document.querySelector('${dialog} [role=alert]').textContent`), /不支持此交换格式版本/)
  await setField(`${dialog} textarea`, JSON.stringify({ ...freeExport, template: { ...freeExport.template, directives: 'External preferences. '.repeat(90) } })); await popupButton('预览')
  await wait(`!!document.querySelector('${dialog} input[maxlength="30"]')`)
  assert.equal(await read(`document.activeElement===document.querySelector('${dialog} input[maxlength="30"]')`), true)
  assert.match(await read(`document.querySelector('${dialog}').textContent`), /我已阅读并理解上述风险/)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: false })
  await cdp.waitFor(`document.querySelector('${dialog}').getBoundingClientRect().right<=390`, 'narrow dialog layout')
  const bounds = await read(`(() => {const el=document.querySelector('${dialog}');const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,scroll:el.scrollHeight>el.clientHeight}})()`)
  assert.equal(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= 390 && bounds.bottom <= 700, true)
  assert.equal(bounds.scroll, true, 'long preview scrolls without clipping the dialog')
  await read(`(() => {const buttons=[...document.querySelectorAll('${dialog} button:not(:disabled)')];buttons.at(-1).focus()})()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  assert.equal(await read(`document.activeElement===document.querySelector('${dialog} input[maxlength="30"]')`), true, 'Tab loops inside the dialog')
  await read('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
  await wait(`!document.querySelector('${dialog}')`)
  await read('window.__unavailable()')
  await wait('document.querySelectorAll("[data-dsh-iui-manage]:not(:disabled)").length===0')
  await wait('document.querySelector("[data-dsh-iui-import]").disabled')
  assert.equal(await read('document.querySelector("[data-dsh-iui-import]").disabled'), true)

  console.log(`settings-picker E2E: OK (${assertions} assertions)`)
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
