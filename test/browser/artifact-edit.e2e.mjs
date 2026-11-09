#!/usr/bin/env node
/**
 * Browser check for Artifact block arrangement and editing.
 *
 * Covers the structure list, conditional request list, per-block popovers,
 * keyboard and pointer reordering, batch selection/toolbar/order and batch
 * duplicate preview + apply, reset order, the combined order + edit envelope,
 * Host-normalized revision replay, hover request cards, composer chip label
 * shapes and the narrow/light-dark chrome. No real model is called.
 *
 *   node test/browser/artifact-edit.e2e.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'
import { DST_PROGRAM } from './fixtures/dst-artifact.ts'
import { NESTED_PROGRAM } from './fixtures/nested-artifact.ts'
import { PROPS_LEGACY_AUTO_TITLE, PROPS_PROGRAM, PROPS_PROGRAM_APPLIED } from './fixtures/props-artifact.ts'
import { extractArtifactBlocks, reorderProgramToTargetOrder } from '../../src/shared/artifact-blocks.ts'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-artifact-edit-e2e-'))
let server, browser, cdp
let checks = 0
const check = (value, expected, message) => { assert.deepEqual(value, expected, message); checks += 1 }

/** Edited revision returned by the model: digital clock block + first-year column. */
const DIGITAL_PROGRAM = DST_PROGRAM
  .replace(/^clockCard = .*$/m, 'clockCard = Card([Title("同一时刻，两个读数", "sm"), Text("选一个状态，看同一时刻的数字时间。", "sm", "muted"), SegmentedControl($clock, ["冬令时", "夏令时"], true), Col([Title($clock == "夏令时" ? "08:00" : "07:00", "2xl"), Text("2026-11-04", "sm", "muted")], 1)])')
  .replace(/^rulesTable = .*$/m, 'rulesTable = Table(["地区", "首次实施年份", "切换规则", "状态"], [["欧盟", "1980", "3 月最后一个周日 → 10 月最后一个周日", "实行"], ["中国", "1986", "1986–1991 年实行，1992 年起取消", "不实行"]])')
const ARTICLE_PROGRAM = 'root = Col([toc, section])\ntoc = Toc(["Intro"])\nsection = Section("Intro", [Markdown("Body.")])'

/** Platform primitives stub: the shell seeds the real module at runtime. */
const PRIMITIVES_STUB = `
import { createElement } from 'react'
export const IconChevronDownOutlineRegular = () => null
export const IconSparkleRegular = () => null
export const IconCloseOutlineRegular = () => null
export const IconEditOutlineRegular = () => null
export const IconTrashOutlineRegular = () => null
export const IconPlusOutlineRegular = () => null
export const IconArrowLeftOutlineRegular = () => null
export const DisclosureRow = () => null
export function ReferenceChip({ label, title }) {
  return createElement('span', { 'data-reference-chip': 'true', title }, label)
}
`

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/artifact-edit-entry.tsx')], outfile: join(temp, 'bundle.js'),
    bundle: true, platform: 'browser', format: 'esm', target: 'chrome120', jsx: 'automatic', absWorkingDir: root,
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    plugins: [{
      name: 'platform-stubs',
      setup(build) {
        build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: PRIMITIVES_STUB, resolveDir: root }))
      },
    }],
  })
  await writeFile(join(temp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="bundle.css"><style>
:root { color-scheme:light;
  --dsw-alias-bg-base:#fff; --dsw-alias-bg-layer-1:#fff; --dsw-alias-bg-layer-2:#f5f6f7; --dsw-alias-bg-layer-3:#eceef1;
  --dsw-alias-bg-module-platform:#f5f6f7; --dsw-alias-label-primary:#171717; --dsw-alias-label-secondary:#555;
  --dsw-alias-label-tertiary:#888; --dsw-alias-label-caption:#999;
  --dsw-alias-border-l1:#e4e4e4; --dsw-alias-border-l2:#d4d4d4; --dsw-alias-border-l3:#c4c4c4;
  --dsw-alias-interactive-bg-hover:#eee; --dsw-alias-interactive-bg-hover-solid:#e8e8e8;
  --dsw-alias-state-business-primary:#1265bb; --dsw-alias-state-error-primary:#b42318; --dsw-alias-state-warn-primary:#b54708;
  --dsw-alias-button-floating-fill:#fff; --dsw-alias-button-floating-hover:#f2f2f2;
  --dsw-specific-menu:#fff; --dsw-specific-bubble:#eef2f7; --dsw-specific-input-major:#fff;
  --dsw-radius-sm:6px; --dsw-radius-md:10px; --dsw-radius-lg:14px; --dsw-radius-xl:18px;
  --dsw-focus-ring-color:#1265bb; --dsw-focus-ring-width:2px; --dsw-font-family:system-ui;
  --dsw-elevation-panel:0 6px 24px rgb(0 0 0 / 12%); --dsw-elevation-prominent:0 10px 36px rgb(0 0 0 / 16%);
  --dsh-chat-content-width:748px; --dsh-composer-side-clearance:0px; --dsh-content-font-size:14px;
}
body[data-ds-dark-theme] { color-scheme:dark;
  --dsw-alias-bg-base:#111; --dsw-alias-bg-layer-1:#1b1b1b; --dsw-alias-bg-layer-2:#242424; --dsw-alias-bg-layer-3:#2e2e2e;
  --dsw-alias-bg-module-platform:#353638; --dsw-alias-label-primary:#f2f2f2; --dsw-alias-label-secondary:#b8b8b8;
  --dsw-alias-label-tertiary:#8a8a8a; --dsw-alias-label-caption:#777;
  --dsw-alias-border-l1:#323232; --dsw-alias-border-l2:#3c3c3c; --dsw-alias-border-l3:#4a4a4a;
  --dsw-alias-interactive-bg-hover:#2e2e2e; --dsw-alias-interactive-bg-hover-solid:#333;
  --dsw-specific-menu:#242424; --dsw-specific-bubble:#2b3440; --dsw-specific-input-major:#1f1f1f;
}
html { scrollbar-width:none; } ::-webkit-scrollbar { width:0; height:0; }
body { margin:0; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:14px/1.5 var(--dsw-font-family); }
main { margin:24px auto; max-width:var(--dsh-chat-content-width); }
[data-composer-card] { position:fixed; bottom:16px; left:16px; right:16px; max-width:748px; margin:auto; border:1px solid var(--dsw-alias-border-l2); border-radius:14px; background:var(--dsw-alias-bg-layer-1); padding:8px 12px; }
[data-composer-draft] { min-height:20px; white-space:pre-wrap; color:var(--dsw-alias-label-secondary); font-size:13px; }
[data-composer-chips] { display:flex; gap:6px; }
[data-chip] { border:1px solid var(--dsw-alias-border-l2); border-radius:6px; padding:1px 6px; font-size:12px; color:var(--dsw-alias-label-primary); }
[data-sent-summary] { margin-top:6px; }
</style></head><body><div id="root"></div><script type="module" src="bundle.js"></script></body></html>`)
  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url, width: 1500, height: 1000 })
  assert.ok(browser, 'Chrome required')
  cdp = await connectCdp(browser.port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  const read = expression => cdp.evaluate(expression)
  const wait = (expression, message = expression, options) => cdp.waitFor(expression, message, options)
  const click = selector => read(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const hover = async selector => {
    const rect = await read(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
  }
  const pressTab = async (shift = false) => {
    const modifiers = shift ? 8 : 0
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers })
  }
  const text = selector => read(`(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '')`)
  const count = selector => read(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  const report = join(root, '.tmp-report')
  await mkdir(report, { recursive: true })
  const shot = async name => {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(report, name), Buffer.from(result.data, 'base64'))
  }
  const typeInto = async (selector, value) => {
    await read(`(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)
  }
  const arrangementOrder = () => read(`[...document.querySelectorAll('[data-dsh-iui-edit-arrangement-row]')].map(row => row.getAttribute('data-block-id'))`)
  const clickBlock = async (blockId) => {
    await wait(`!!document.querySelector('[data-dsh-iui-block-hit="${blockId}"]')`, `hit target ${blockId}`)
    await click(`[data-dsh-iui-block-hit="${blockId}"]`)
  }
  const chipLabel = () => read(`document.querySelector('[data-chip="artifact-edit"]')?.getAttribute('data-chip-label') ?? null`)
  const arrangementSelector = id => `[data-dsh-iui-edit-arrangement-row][data-block-id="${id}"]`
  const rowMenu = async selector => {
    if (await count('[data-dsh-iui-edit-row-menu-panel]')) return
    await click(`${selector} [data-dsh-iui-edit-row-menu]`)
    await wait('!!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'row action menu')
  }
  const openArrangementEditor = async id => {
    await wait(`!document.querySelector('[data-dsh-iui-edit-panel][data-closing="true"]')`, 'previous editor settled')
    await rowMenu(arrangementSelector(id))
    await click('[data-dsh-iui-edit-structure-edit]')
  }
  const saveInstruction = async value => {
    await typeInto('[data-dsh-iui-edit-instruction]', value)
    await click('[data-dsh-iui-edit-save]')
    await wait('!document.querySelector("[data-dsh-iui-edit-popover]")', 'popover closed')
  }
  const moveWithKeyboard = (id, key, times) => read(`(() => {
    const grip = document.querySelector('${arrangementSelector(id)} [data-dsh-iui-edit-grip]');
    grip.focus();
    for (let index = 0; index < ${times}; index += 1) grip.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
  })()`)
  const dragRowToTop = id => read(`(() => {
    const rows = [...document.querySelectorAll('[data-dsh-iui-edit-arrangement-row]')];
    const row = rows.find(item => item.getAttribute('data-block-id') === ${JSON.stringify(id)});
    const grip = row.querySelector('[data-dsh-iui-edit-grip]');
    const rect = grip.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, pointerType: 'mouse', button: 0, clientX: rect.left + 4, clientY: rect.top + 4 };
    const fire = (target, type, extra) => target.dispatchEvent(new PointerEvent(type, { ...base, ...extra }));
    try { grip.setPointerCapture(7) } catch { /* synthetic pointer */ }
    fire(grip, 'pointerdown', { buttons: 1 });
    const first = rows[0].getBoundingClientRect();
    fire(document, 'pointermove', { buttons: 1, clientY: first.top + 2 });
    fire(document, 'pointerup', { buttons: 0, clientY: first.top + 2 });
  })()`)

  // 1. Card entry.
  await wait('!!document.querySelector("[data-dsh-iui-edit-entry]")', 'edit entry')
  check(await count('[data-dsh-iui-block]'), 0, 'no edit wrappers before editing')
  check(await text('[data-dsh-iui-edit-entry]'), '编辑', 'edit entry label')

  // 1b. Draft persistence: an unsent draft survives a page reload.
  await click('[data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'persistence editor')
  await openArrangementEditor('b3')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'persistence popover')
  await saveInstruction('persist-me across reload')
  await new Promise(resolve => setTimeout(resolve, 500))
  const storedDraft = await read(`(() => {
    const keys = Object.keys(sessionStorage).filter(key => key.startsWith('dsh-iui-edit-draft:v1:'));
    return { keys, sample: keys.length === 0 ? null : sessionStorage.getItem(keys[0]) };
  })()`)
  check(storedDraft.keys.length >= 1, true, 'edit draft persisted in sessionStorage')
  check((storedDraft.sample ?? '').includes('persist-me across reload'), true, 'persisted draft keeps its instruction')
  await cdp.send('Page.reload', { ignoreCache: true })
  await wait('document.readyState === "complete"', 'page reloaded')
  await wait('!!document.querySelector("[data-dsh-iui-edit-entry]")', 'harness ready after reload')
  await wait(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].length >= 1`, 'restored draft chip')
  await click('[data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'restored draft editor')
  check((await text('[data-dsh-iui-edit-request-list]')).includes('persist-me across reload'), true, 'reloaded draft shows its saved request')
  check((await text('[data-dsh-iui-edit-draft-switcher]')).includes('待提交编辑'), true, 'reloaded draft stays in the pending list')
  check(await read(`document.querySelector('[data-dsh-iui-edit-panel] [data-dsh-iui-edit-draft-switcher]') === null`), true, 'draft switcher is not inside the edit panel')
  check(await read(`!!document.querySelector('[data-composer-card] [data-dsh-iui-edit-draft-switcher]')`), true, 'draft dock lives inside the composer card')
  const dockGeometry = await read(`(() => {
    const dock = document.querySelector('[data-dsh-iui-edit-draft-switcher]');
    const card = document.querySelector('[data-composer-card]');
    const dr = dock.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const after = getComputedStyle(dock, '::after');
    return { insideLeft: dr.left >= cr.left - 0.5, insideRight: dr.right <= cr.right + 0.5, lineLeft: after.left, lineRight: after.right };
  })()`)
  check(dockGeometry.insideLeft && dockGeometry.insideRight, true, 'draft dock stays within the composer card')
  check(dockGeometry.lineLeft === '12px' && dockGeometry.lineRight === '12px', true, 'divider is inset from both card edges')
  const dockCenter = await read(`(() => {
    const card = document.querySelector('[data-composer-card]');
    const dock = document.querySelector('[data-dsh-iui-edit-draft-switcher]');
    const row = dock.querySelector('[data-dsh-iui-edit-draft-row]');
    const head = dock.querySelector('.dsh-iui-draft-dock-head');
    const cr = card.getBoundingClientRect();
    const dr = dock.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const hr = head.getBoundingClientRect();
    const contentCenter = (rr.top + rr.bottom + hr.top + hr.bottom) / 4;
    const bandCenter = (cr.top + dr.bottom) / 2;
    return { contentCenter, bandCenter, diff: Math.abs(contentCenter - bandCenter) };
  })()`)
  check(dockCenter.diff <= 1.5, true, 'draft row is vertically centered in the card-top band')
  await shot('harness-m3-draft-restored.png')
  // Clean the persisted draft, then restart from the pristine harness state.
  await read('sessionStorage.clear()')
  await cdp.send('Page.reload', { ignoreCache: true })
  await wait('document.readyState === "complete"', 'clean reload')
  await wait('!!document.querySelector("[data-dsh-iui-edit-entry]")', 'pristine harness ready')

  // 2. Edit mode: no request list, arrangement always complete, summary empty.
  await click('[data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'edit view')
  await wait('document.querySelectorAll("[data-dsh-iui-block]").length === 9', 'nine blocks')
  check(await count('[data-dsh-iui-block]'), 9, 'all top-level blocks recognized')
  check(await count('[data-dsh-iui-edit-exit-panel]'), 1, 'edit panel offers an exit control')
  check(await read(`(() => { const toolbar = document.querySelector('.dsh-iui-edit-toolbar').getBoundingClientRect(); const canvas = document.querySelector('.dsh-iui-edit-canvas').getBoundingClientRect(); return canvas.top - toolbar.bottom >= 16; })()`), true, 'the toolbar leaves room for the first block orbit glow')
  await read(`document.querySelector('[data-dsh-iui-edit-global]').focus()`)
  await wait('!!document.querySelector("[data-dsh-iui-input-orbit]")', 'input focus orbit')
  check(await read(`(() => { const input = document.querySelector('[data-dsh-iui-edit-global]'); const orbit = document.querySelector('[data-dsh-iui-input-orbit]'); const a = input.getBoundingClientRect(); const b = orbit.getBoundingClientRect(); return Math.abs(a.left - b.left - 5) < 1 && Math.abs(a.top - b.top - 5) < 1; })()`), true, 'the orbit sits five pixels outside the field')
  await new Promise(resolve => setTimeout(resolve, 350))
  await shot('harness-input-orbit.png')
  check(await read(`getComputedStyle(document.querySelector('[data-dsh-iui-edit-global]')).outlineStyle`), 'none', 'the field focus outline is replaced by the orbit')
  check(await read(`getComputedStyle(document.querySelector('[data-dsh-iui-input-orbit]'), '::before').display`), 'none', 'normal motion keeps the orbit as the only focus ring')
  await read(`(() => { const marker = document.createElement('div'); marker.id = 'orbit-reflow-marker'; marker.style.height = '40px'; document.querySelector('[data-dsh-iui-edit-view]').prepend(marker); return true; })()`)
  await wait(`(() => { const input = document.querySelector('[data-dsh-iui-edit-global]'); const orbit = document.querySelector('[data-dsh-iui-input-orbit]'); return Math.abs(parseFloat(orbit.style.top) - (input.getBoundingClientRect().top - 5)) < 1.5; })()`, 'orbit follows a layout shift')
  check(await read(`(() => { const input = document.querySelector('[data-dsh-iui-edit-global]'); const orbit = document.querySelector('[data-dsh-iui-input-orbit]'); return Math.abs(parseFloat(orbit.style.top) - (input.getBoundingClientRect().top - 5)) < 1.5; })()`), true, 'orbit follows a position-only layout shift')
  await read(`document.getElementById('orbit-reflow-marker').remove()`)
  await wait(`(() => { const input = document.querySelector('[data-dsh-iui-edit-global]'); const orbit = document.querySelector('[data-dsh-iui-input-orbit]'); return Math.abs(parseFloat(orbit.style.top) - (input.getBoundingClientRect().top - 5)) < 1.5; })()`, 'orbit returns after reflow')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await new Promise(resolve => setTimeout(resolve, 120))
  check(await read(`getComputedStyle(document.querySelector('[data-dsh-iui-input-orbit]'), '::before').display`), 'block', 'reduced motion restores a static focus ring')
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  await new Promise(resolve => setTimeout(resolve, 120))
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
  await wait('getComputedStyle(document.querySelector("[data-dsh-iui-input-orbit]")).display === "none"', 'forced-colors hides the painted orbit')
  check(await read(`getComputedStyle(document.querySelector('[data-dsh-iui-edit-global]')).outlineStyle`), 'solid', 'forced-colors restores a system focus outline')
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  await read(`document.querySelector('[data-dsh-iui-edit-global]').blur()`)
  await wait('!document.querySelector("[data-dsh-iui-input-orbit]")', 'input focus orbit clears')
  check(await read(`getComputedStyle(document.querySelector('.dsh-iui-edit-panel')).borderTopWidth`), '0px', 'the floating edit panel has no outer border')
  check(await count('.dsh-iui-edit-divider'), 1, 'the panel uses one explicit separator before the global instruction')
  check(await read(`getComputedStyle(document.querySelector('.dsh-iui-edit-global')).borderTopWidth`), '0px', 'the global section does not paint a second separator')
  check(await count('.dsh-iui-edit-exit'), 2, 'card and panel headers share the exit style')
  check(await count('[data-dsh-iui-edit-view] .dsh-iui-edit-button.dsh-iui-edit-exit'), 0, 'the redundant toolbar exit is gone')
  const headerExitStyle = await read(`(() => { const el = document.querySelector('[data-dsh-iui-edit-entry]'); const cs = getComputedStyle(el); return { border: cs.borderTopColor, color: cs.color }; })()`)
  check(headerExitStyle.border.includes('18, 101, 187'), false, 'the header exit is not painted with the pressed accent')
  await hover('[data-dsh-iui-info-tip="nested"]')
  await wait('!!document.querySelector("[data-dsh-iui-info-tooltip]")', 'nested info tooltip')
  check((await text('[data-dsh-iui-info-tooltip]')).includes('嵌套'), true, 'the nested-mode tooltip explains the two levels')
  await new Promise(resolve => setTimeout(resolve, 420))
  await shot('harness-toolbar-tooltip.png')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
  await wait('!document.querySelector("[data-dsh-iui-info-tooltip]")', 'nested tooltip closes')
  await hover('[data-dsh-iui-info-tip="strict"]')
  await wait('!!document.querySelector("[data-dsh-iui-info-tooltip]")', 'strict info tooltip')
  check((await text('[data-dsh-iui-info-tooltip]')).includes('未选中'), true, 'the strict-protection tooltip explains the rejection rule')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
  await wait('!document.querySelector("[data-dsh-iui-info-tooltip]")', 'strict tooltip closes')
  await hover('[data-dsh-iui-info-tip="nested"]')
  await wait('!!document.querySelector("[data-dsh-iui-info-tooltip]")', 'nested tooltip before click')
  await click('[data-dsh-iui-info-tip="nested"]')
  check(await count('[data-dsh-iui-info-tooltip]'), 1, 'clicking the info trigger keeps the tooltip open')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
  await new Promise(resolve => setTimeout(resolve, 250))
  check(await count('[data-dsh-iui-info-tooltip]'), 1, 'a pinned tooltip survives pointer leave')
  await click('[data-dsh-iui-info-tip="nested"]')
  await wait('!document.querySelector("[data-dsh-iui-info-tooltip]")', 'second click closes the pinned tooltip')
  await hover('[data-dsh-iui-info-tip="nested"]')
  await wait('!!document.querySelector("[data-dsh-iui-info-tooltip]")', 'tooltip reopened for outside-click check')
  await click('[data-dsh-iui-info-tip="nested"]')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
  await new Promise(resolve => setTimeout(resolve, 250))
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: 2, y: 2 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: 2, y: 2 })
  await wait('!document.querySelector("[data-dsh-iui-info-tooltip]")', 'outside pointerdown closes the pinned tooltip')
  const editableHint = await read(`(() => {
    const marquees = [...document.querySelectorAll('.dsh-iui-block-marquee')];
    const first = marquees[0];
    const body = document.querySelector('[data-dsh-iui-block="b3"] .dsh-iui-block-body');
    const items = [...document.querySelectorAll('.dsh-iui-block-overlay-item')];
    const style = first === undefined ? null : getComputedStyle(first);
    return {
      bodyAnimation: getComputedStyle(body).animationName,
      marqueeCount: marquees.length,
      marqueeAnimation: style?.animationName ?? null,
      marqueeIteration: style?.animationIterationCount ?? null,
      marqueeBackground: style?.backgroundImage ?? '',
      marqueeMask: style?.maskImage ?? '',
      marqueeOpacity: style === null ? 0 : parseFloat(style.opacity),
      stagger: items.map(item => getComputedStyle(item).getPropertyValue('--dsh-iui-stagger').trim()),
    };
  })()`)
  check(editableHint.bodyAnimation.includes('dsh-iui-block-breathe'), false, 'the block body no longer breathes')
  check(editableHint.marqueeCount, 9, 'every root block draws one orbit glow')
  check(editableHint.marqueeAnimation.includes('dsh-iui-block-orbit'), true, 'editable blocks run a light orbit glow around their edge')
  check(editableHint.marqueeIteration, 'infinite', 'the orbit glow keeps traveling while the canvas idles')
  check(editableHint.marqueeBackground.includes('conic-gradient'), true, 'the orbit glow is a rotating conic light')
  check(editableHint.marqueeMask.includes('linear-gradient'), true, 'the light is masked to the rounded block edge')
  check(editableHint.marqueeOpacity > 0.8, true, 'the orbit glow is visible at rest')
  check(new Set(editableHint.stagger).size, 9, 'the orbit glow travels at a staggered phase per block')
  const tones = await read(`(() => {
    const first = getComputedStyle(document.querySelector('.dsh-iui-block-overlay-item[data-dsh-iui-block-hit-item="b1"] .dsh-iui-block-marquee')).backgroundImage;
    const second = getComputedStyle(document.querySelector('.dsh-iui-block-overlay-item[data-dsh-iui-block-hit-item="b2"] .dsh-iui-block-marquee')).backgroundImage;
    return { both: first.includes('conic-gradient') && second.includes('conic-gradient'), distinct: first !== second };
  })()`)
  check(tones.both, true, 'each editable block paints its own conic orbit glow')
  check(tones.distinct, true, 'neighbouring blocks orbit in different pastel tones')
  const orbitGaps = await read(`(() => {
    const orbits = [...document.querySelectorAll('.dsh-iui-block-orbit')].map(el => el.getBoundingClientRect());
    return orbits.every((orbit, index) => index === 0 || orbit.top + 0.5 >= orbits[index - 1].bottom);
  })()`)
  check(orbitGaps, true, 'neighbouring orbit halos do not overlap')
  await hover('[data-dsh-iui-block-hit="b3"]')
  await new Promise(resolve => setTimeout(resolve, 220))
  check(await read(`getComputedStyle(document.querySelector('.dsh-iui-block-overlay-item[data-dsh-iui-block-hit-item="b3"] .dsh-iui-block-marquee')).opacity`), '1', 'hover brightens the orbit glow')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
  await new Promise(resolve => setTimeout(resolve, 260))
  check(await read(`getComputedStyle(document.querySelector('.dsh-iui-block-overlay-item[data-dsh-iui-block-hit-item="b3"] .dsh-iui-block-marquee')).opacity`), '0.9', 'the orbit glow settles back when the pointer leaves')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await new Promise(resolve => setTimeout(resolve, 120))
  const reducedMotion = await read(`(() => {
    const marquee = document.querySelector('.dsh-iui-block-overlay-item[data-dsh-iui-block-hit-item="b3"] .dsh-iui-block-marquee');
    return { orbit: getComputedStyle(marquee).animationName, rest: getComputedStyle(marquee).opacity };
  })()`)
  check(reducedMotion.orbit, 'none', 'reduced motion stops the orbit')
  check(parseFloat(reducedMotion.rest) >= 0.4, true, 'reduced motion keeps a still glow as the affordance')
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  await new Promise(resolve => setTimeout(resolve, 120))
  await shot('harness-block-marquee.png')
  await read(`(() => { for (const animation of document.getAnimations()) if (animation.effect?.pseudoElement === '::after') animation.play(); })()`)
  await shot('harness-arrangement-empty.png')

  // 3. Opening a popover does not create a request.
  await clickBlock('b3')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'popover opened')
  await wait(`document.querySelectorAll('.dsh-iui-block-scrim').length === 8`, 'focus scrim outside the edited block')
  check(await count('.dsh-iui-block-orbit'), 0, 'editing a block hides every other orbit glow')
  check(await count('.dsh-iui-block-overlay-item[data-dsh-iui-block-hit-item="b3"] .dsh-iui-block-frame.is-active'), 1, 'the edited block keeps the focus frame')
  check(await count('.dsh-iui-block-overlay-item[data-dsh-iui-block-hit-item="b3"] .dsh-iui-block-scrim'), 0, 'the edited block is not dimmed')
  await shot('harness-focus-mode.png')
  check(await count('[data-dsh-iui-edit-request-list]'), 0, 'draft popover creates no request')
  await click('[data-dsh-iui-edit-cancel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-popover]")', 'draft popover closed')
  check(await count('.dsh-iui-block-scrim'), 0, 'closing the editor clears the focus scrim')
  check(await count('.dsh-iui-block-marquee'), 9, 'closing the editor restores every orbit glow')
  check(await count('[data-dsh-iui-edit-request-list]'), 0, 'still no request after cancel')

  // 4. Saving a block instruction creates the request entry, number and colour.
  await openArrangementEditor('b3')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'popover from arrangement')
  check((await text('[data-dsh-iui-edit-popover]')).includes('同一时刻，两个读数'), true, 'popover shows block name')
  await saveInstruction('把模拟时钟改为数字时钟，并显示当前日期')
  await wait('!!document.querySelector("[data-dsh-iui-edit-request-list]")', 'request list appears')
  check(await count('[data-dsh-iui-edit-request-row]'), 1, 'one request row')
  check(await read('document.querySelector("[data-dsh-iui-edit-request-row]").getAttribute("data-block-id")'), 'b3', 'request row binds b3')
  check((await text('[data-dsh-iui-edit-request-row]')).includes('把模拟时钟改为数字时钟'), true, 'request row shows instruction')
  check(await read('document.querySelector("[data-dsh-iui-block=\\"b3\\"]").getAttribute("data-dsh-iui-block-order")'), '1', 'canvas badge number 1')
  const selectedVisual = await read(`(() => {
    const item = document.querySelector('.dsh-iui-block-overlay-item[data-dsh-iui-block-hit-item="b3"]');
    const pending = item?.querySelector('.dsh-iui-block-pending');
    const frame = item?.querySelector('.dsh-iui-block-frame');
    const marquee = item?.querySelector('.dsh-iui-block-marquee');
    const pageIndex = item?.querySelector('.dsh-iui-block-page-index');
    const hit = item?.querySelector('.dsh-iui-block-hit');
    return {
      pending: pending !== null && pending !== undefined,
      pendingNumber: pending?.querySelector('.dsh-iui-block-pending-number')?.textContent ?? null,
      pendingDot: pending?.querySelector('.dsh-iui-block-pending-dot') !== null,
      frame: frame !== null && frame !== undefined,
      marqueePending: marquee?.classList.contains('is-pending') ?? false,
      marqueeDuration: marquee === null || marquee === undefined ? '' : getComputedStyle(marquee).animationDuration,
      marqueeOpacity: marquee === null || marquee === undefined ? 1 : parseFloat(getComputedStyle(marquee).opacity),
      pageIndex: pageIndex?.textContent ?? null,
      hitLabel: hit?.getAttribute('aria-label') ?? null,
      hitPressed: hit?.getAttribute('aria-pressed') ?? null,
    };
  })()`)
  check(selectedVisual.pending, true, 'saving an instruction turns the selection into a quiet pending marker')
  check(selectedVisual.pendingNumber, '1', 'the pending marker keeps the request number')
  check(selectedVisual.pendingDot, true, 'the pending marker carries a coloured dot')
  check(selectedVisual.frame, false, 'a saved block no longer shows the big selected frame')
  check(selectedVisual.marqueePending, true, 'a pending root block keeps a quieter orbit glow')
  check(selectedVisual.marqueeDuration, '5.2s', 'the pending orbit glow is slower')
  check(selectedVisual.marqueeOpacity < 0.5, true, 'the pending orbit glow is dimmer')
  check(selectedVisual.pageIndex, null, 'the pending canvas marker replaces the page-order badge')
  check(selectedVisual.hitLabel !== null && selectedVisual.hitLabel !== '', true, 'the hit target is labelled for screen readers')
  check(selectedVisual.hitPressed, 'true', 'the hit target reports its pressed state')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
  await new Promise(resolve => setTimeout(resolve, 180))
  await shot('harness-pending-block.png')
  await rowMenu(arrangementSelector('b3'))
  const pencilPaths = await read(`(() => {
    const row = document.querySelector('[data-dsh-iui-edit-structure-edit] svg path')?.getAttribute('d') ?? null;
    const requestRow = document.querySelector('[data-dsh-iui-edit-request-edit] svg path')?.getAttribute('d') ?? null;
    return { row, requestRow };
  })()`)
  await click(`${arrangementSelector('b3')} [data-dsh-iui-edit-row-menu]`)
  check(pencilPaths.requestRow, pencilPaths.row, 'request row edit glyph matches the arrangement row pencil')
  check(await read(`document.querySelector('${arrangementSelector('b3')} .dsh-iui-edit-badge')?.textContent ?? null`), '1', 'arrangement badge keeps the request number 1')
  check(await read(`document.querySelector('${arrangementSelector('b3')} .dsh-iui-edit-page-index')?.textContent ?? null`), '3', 'a pending row keeps its page-order number')
  check(await read(`document.querySelector('${arrangementSelector('b3')} .dsh-iui-edit-badge')?.title ?? null`), '请求 1', 'the request badge labels its numbering as a request')
  check(await read(`document.querySelector('${arrangementSelector('b2')} .dsh-iui-edit-page-index')?.textContent ?? null`), '2', 'untouched rows show the page-order index')
  check(await read(`document.querySelector('${arrangementSelector('b3')} .dsh-iui-edit-tag')?.textContent ?? null`), '已编辑', 'arrangement edited tag')
  check(await chipLabel(), '编辑 夏令时与冬令时 · 修订 1 · 1 项修改', 'chip shows one edit')
  check(await count('[data-dsh-iui-edit-clear-all]'), 1, 'clear-all control appears')

  // 5. A second request.
  await clickBlock('b5')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'second popover')
  await saveInstruction('增加首次实施年份')
  await wait('document.querySelectorAll("[data-dsh-iui-edit-request-row]").length === 2', 'two request rows')
  check(await read('document.querySelector("[data-dsh-iui-block=\\"b5\\"]").getAttribute("data-dsh-iui-block-order")'), '2', 'canvas badge number 2')
  check(await chipLabel(), '编辑 夏令时与冬令时 · 修订 1 · 2 项修改', 'chip shows two edits')
  check(await count('[data-dsh-iui-edit-arrangement-row] .dsh-iui-edit-tag'), 2, 'two edited tags')
  await shot('harness-arrangement-requests.png')

  // 6. Hovering an edited row shows the compact request card.
  await read(`(() => {
    const row = document.querySelector('${arrangementSelector('b3')}');
    row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
  })()`)
  await wait('!!document.querySelector("[data-dsh-iui-edit-hover-card]")', 'hover card', { timeout: 5000 })
  check((await text('[data-dsh-iui-edit-hover-card]')).includes('把模拟时钟改为数字时钟'), true, 'hover card shows the request')
  check(await count('[data-dsh-iui-edit-hover-card] .dsh-iui-edit-card-action'), 0, 'hover card is read-only (row owns the actions)')
  await shot('harness-arrangement-hover.png')
  await read(`document.querySelector('${arrangementSelector('b3')}').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }))`)
  await wait('!document.querySelector("[data-dsh-iui-edit-hover-card]")', 'hover card hides', { timeout: 3000 }).catch(() => undefined)

  // 7. Keyboard reordering moves b5 to the top; edit numbers/colours stay.
  await moveWithKeyboard('b5', 'ArrowUp', 4)
  await wait(`document.querySelector('[data-dsh-iui-edit-arrangement-row]').getAttribute('data-block-id') === 'b5'`, 'keyboard reorder')
  check((await arrangementOrder()).indexOf('b5'), 0, 'b5 moved to the top')
  check(await chipLabel(), '编辑 夏令时与冬令时 · 修订 1 · 2 项修改 + 排序', 'chip reports order + edits')
  check(await read('document.querySelector("[data-dsh-iui-block=\\"b3\\"]").getAttribute("data-dsh-iui-block-order")'), '1', 'b3 keeps number 1 after reorder')
  check(await read('document.querySelector("[data-dsh-iui-block=\\"b5\\"]").getAttribute("data-dsh-iui-block-order")'), '2', 'b5 keeps number 2 after reorder')
  check(await read(`document.querySelector('[data-dsh-iui-block]').getAttribute('data-dsh-iui-block')`), 'b5', 'edit canvas previews the target order')
  check(await count('[data-dsh-iui-edit-preview]'), 1, 'preview marker visible')
  check((await text('[data-dsh-iui-edit-send-info]')).includes('已调整'), true, 'summary reports adjusted order')
  await shot('harness-arrangement-reordered.png')

  // 8. Pointer drag also reorders; arrangement body locates without opening a popover.
  await dragRowToTop('b2')
  await wait(`document.querySelector('[data-dsh-iui-edit-arrangement-row]').getAttribute('data-block-id') === 'b2'`, 'pointer drag reorder', { timeout: 4000 })
  check(await read(`document.querySelector('[data-dsh-iui-edit-arrangement-row]').getAttribute('data-block-id')`), 'b2', 'pointer drag moves b2 to the top')
  await read(`document.querySelector('${arrangementSelector('b3')} [data-dsh-iui-edit-arrangement-body]').click()`)
  check(await count('[data-dsh-iui-edit-popover]'), 0, 'arrangement body click does not open the popover')

  // 9. Reset restores page order but keeps edits, numbers and global note.
  await click('[data-dsh-iui-edit-reset-order]')
  await wait(`document.querySelector('[data-dsh-iui-edit-arrangement-row]').getAttribute('data-block-id') === 'b1'`, 'reset order')
  check(await arrangementOrder(), ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'], 'reset restores page order')
  check(await chipLabel(), '编辑 夏令时与冬令时 · 修订 1 · 2 项修改', 'reset removes the reorder chip part')
  check(await count('[data-dsh-iui-edit-request-row]'), 2, 'reset keeps saved requests')
  check(await read('document.querySelector("[data-dsh-iui-block=\\"b3\\"]").getAttribute("data-dsh-iui-block-order")'), '1', 'reset keeps numbering')
  check(await read(`document.querySelector('[data-dsh-iui-block]').getAttribute('data-dsh-iui-block')`), 'b1', 'reset restores the canvas preview order')
  await typeInto('[data-dsh-iui-edit-global]', '保持页面其余内容不变')
  check((await text('[data-dsh-iui-edit-send-info]')).includes('已填写'), true, 'summary reports the global instruction')

  // 10. Reorder again and send edits + order + global in one envelope.
  await moveWithKeyboard('b5', 'ArrowUp', 4)
  await wait(`document.querySelector('[data-dsh-iui-edit-arrangement-row]').getAttribute('data-block-id') === 'b5'`, 'second reorder')
  await read('window.__appendDraft("请突出这两项修改的差异，保持其他内容和交互不变。")')
  const envelope = await read('window.__serializeChip()')
  check(envelope.includes('"blockId":"b3"'), true, 'envelope carries the b3 edit')
  check(envelope.includes('"blockId":"b5"'), true, 'envelope carries the b5 edit')
  check(envelope.includes('"targetOrder":["b5","b1","b2","b3","b4","b6","b7","b8","b9"]'), true, 'envelope carries the target order')
  check(envelope.includes('"orderChanged":true'), true, 'envelope flags the reorder')
  check(envelope.includes('保持页面其余内容不变'), true, 'envelope carries the global instruction')
  check(envelope.includes('root = Col('), true, 'envelope carries the original program')
  check(envelope.includes('edit_ui_blocks'), true, 'content-edit envelope targets the block tool')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'edit mode ended after send')
  check(await count('[data-dsh-iui-edit-view]'), 0, 'edit mode ends after send')
  await wait('document.querySelector("[data-chip=\\"artifact-edit\\"]") === null', 'chip removed after send')
  await wait('!!document.querySelector("[data-sent-summary] [data-reference-chip]")', 'sent summary chip')
  check((await text('[data-sent-summary]')).includes('2 项修改 + 排序 + 整体说明'), true, 'sent chip reports edits + order + global')
  check(await read('window.__input().draft'), '', 'draft cleared after send')

  // 11. Host-normalized revision: edited content in the target order.
  const targetOrder = ['b5', 'b2', 'b1', 'b3', 'b4', 'b6', 'b7', 'b8', 'b9']
  const baseExtraction = extractArtifactBlocks(DST_PROGRAM)
  const normalized = reorderProgramToTargetOrder(DIGITAL_PROGRAM, targetOrder, baseExtraction)
  assert.ok(normalized, 'fixture reorder computes')
  await read(`window.__applyBlockEditRevision(${JSON.stringify({ program: normalized, editedBlockIds: ['b3', 'b5'] })})`)
  await wait('document.querySelectorAll("[data-dsh-intelligent-ui=card]").length === 2', 'edited revision card')
  check(await count('[data-dsh-iui-revision]'), 1, 'revision badge on the edited card')
  check(await text('[data-dsh-iui-revision]'), '修订 2', 'revision number')
  const revisedText = await text('[data-dsh-intelligent-ui-list] [data-dsh-intelligent-ui="card"]:last-of-type')
  check(revisedText.includes('首次实施年份'), true, 'edited block content renders')
  check(revisedText.indexOf('首次实施年份') < revisedText.indexOf('同一时刻'), true, 'normalized program puts the rules table first')
  await shot('harness-arrangement-revision-2.png')

  // 12. Pure order-only request: request list stays hidden, chip is order-only.
  await click('[data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'edit mode again')
  check(await count('[data-dsh-iui-edit-request-list]'), 0, 'fresh session has no requests')
  await moveWithKeyboard('b2', 'ArrowUp', 1)
  await wait(`document.querySelector('[data-dsh-iui-edit-arrangement-row]').getAttribute('data-block-id') === 'b2'`, 'order-only reorder')
  check(await chipLabel(), '编辑 夏令时与冬令时 · 修订 1 · 调整区块顺序', 'order-only chip label')
  await read('window.__appendDraft("只调整顺序，内容保持不变。")')
  const orderEnvelope = await read('window.__serializeChip()')
  check(orderEnvelope.includes('"edits":[]'), true, 'order-only envelope has no block edits')
  check(orderEnvelope.includes('"targetOrder":["b2","b1"'), true, 'order-only envelope carries the target order')
  check(orderEnvelope.includes('"orderChanged":true'), true, 'order-only envelope flags the reorder')
  check(orderEnvelope.includes('render_ui'), true, 'order-only envelope keeps the full-program render_ui path')
  await wait('document.querySelector("[data-chip=\\"artifact-edit\\"]") === null', 'order-only chip removed after send')
  check((await text('[data-sent-summary]')).includes('调整区块顺序'), true, 'sent chip reports the order-only request')

  // 13. Conflict still blocks the send after arrangement work.
  await click('[data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'edit mode for conflict')
  await openArrangementEditor('b6')
  await saveInstruction('补充一个例子')
  await wait('!!document.querySelector("[data-chip=\\"artifact-edit\\"]")', 'chip before conflict')
  await read('window.__conflict = true')
  // A background probe (window focus) surfaces the conflict before sending.
  await read('window.dispatchEvent(new Event("focus"))')
  await wait('!!document.querySelector("[data-dsh-iui-edit-conflict]")', 'background conflict banner')
  const conflictText = await text('[data-dsh-iui-edit-conflict]')
  check(conflictText.includes('最新版本是修订'), true, 'background probe shows the conflict banner')
  check(conflictText.includes('不会覆盖修订'), true, 'conflict banner explains the non-destructive branch action')
  check(conflictText.includes('修订 1') && conflictText.includes('修订 3'), true, 'conflict banner names both revisions')
  const conflict = await read('window.__serializeChip().then(() => null, error => String(error))')
  check(conflict.includes('Artifact 在编辑期间更新了'), true, 'conflict blocks the send')
  check(await count('[data-dsh-iui-edit-view]'), 1, 'edit mode stays after a blocked send')
  await read('window.__conflict = false')
  await click('[data-dsh-iui-edit-retry]')
  await wait('!document.querySelector("[data-dsh-iui-edit-conflict]")', 'retry clears the conflict')
  check(await count('[data-dsh-iui-edit-conflict]'), 0, 'retry clears the conflict banner')

  // 14. Dark scheme and narrow drawer.
  await read('document.body.setAttribute("data-ds-dark-theme", "")')
  check(await read('getComputedStyle(document.querySelector("[data-dsh-iui-edit-panel]")).backgroundColor !== "rgba(0, 0, 0, 0)"'), true, 'panel surface in dark scheme')
  await shot('harness-arrangement-dark.png')
  await read('document.body.removeAttribute("data-ds-dark-theme")')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false })
  check(await read('getComputedStyle(document.querySelector("[data-dsh-iui-edit-panel]")).display'), 'none', 'desktop rail hidden on narrow')
  await click('[data-dsh-iui-edit-drawer-toggle]')
  await wait('document.querySelector("[data-dsh-iui-edit-panel]").getAttribute("data-open") === "true"', 'drawer open')
  await shot('harness-arrangement-drawer.png')
  await cdp.send('Emulation.clearDeviceMetricsOverride')

  // 15. Below 720px block editing is unavailable: an explanation replaces the
  // editor, and the card explains the limit before entering.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await wait('!!document.querySelector("[data-dsh-iui-edit-narrow]")', 'narrow editor notice')
  check(await count('[data-dsh-iui-edit-view]'), 0, 'editor hidden below the minimum width')
  check((await text('[data-dsh-iui-edit-narrow]')).includes('720'), true, 'narrow notice names the minimum width')
  await shot('harness-edit-too-narrow.png')
  await click('[data-dsh-iui-edit-narrow-exit]')
  await wait('!document.querySelector("[data-dsh-iui-edit-narrow]")', 'left narrow edit mode')
  check(await count('[data-dsh-iui-edit-view]'), 0, 'edit mode closed after the notice')
  await click('[data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-narrow-notice]")', 'card narrow notice')
  check(await read(`document.querySelector('.dsh-iui-edit-narrow-dismiss').getBoundingClientRect().height >= 24`), true, 'narrow-notice dismiss is a 24px target')
  check(await count('[data-dsh-iui-edit-view]'), 0, 'tiny viewport never opens the editor')
  check((await text('[data-dsh-iui-edit-narrow-notice]')).includes('720'), true, 'card notice names the minimum width')
  await click('.dsh-iui-edit-narrow-dismiss')
  await wait('!document.querySelector("[data-dsh-iui-edit-narrow-notice]")', 'card notice dismissed')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  await read('window.dispatchEvent(new Event("resize"))')
  await click('[data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'wide viewport reopens the editor')
  check(await count('[data-dsh-iui-edit-narrow]'), 0, 'no narrow notice on a wide viewport')
  await click('[data-dsh-iui-edit-exit]')
  await cdp.send('Emulation.clearDeviceMetricsOverride')

  // 16. Multi-card drafts: two cards, two chips, one batch submit.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  const cardsBefore = await count('[data-dsh-intelligent-ui="card"]')
  const nodesBefore = await read('window.__nodeCount()')
  await read('window.__addCard("dst-call-9", "第二张卡片")')
  check(await read('window.__nodeCount()'), nodesBefore + 1, 'second card node appended')
  check(await count('[data-dsh-intelligent-ui="card"]'), cardsBefore + 1, 'second card rendered')
  // Edit the first card and leave its draft.
  await click('[data-dsh-iui-call-id="dst-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'first card edit')
  await openArrangementEditor('b3')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'first card popover')
  await saveInstruction('第一张卡片：改成数字时钟')
  check(await count('[data-dsh-iui-edit-draft-row]'), 1, 'draft switcher lists one draft')
  console.log('DOCK CENTER', await read(`(() => {
    const dock = document.querySelector('[data-dsh-iui-edit-draft-switcher]');
    const head = dock.querySelector('.dsh-iui-draft-dock-head');
    const row = dock.querySelector('[data-dsh-iui-edit-draft-row]');
    const r = el => el.getBoundingClientRect().toJSON();
    const cs = getComputedStyle(dock);
    return JSON.stringify({ dock: r(dock), head: r(head), row: r(row), padding: cs.padding, align: cs.alignItems, height: cs.height, lineHeight: cs.lineHeight });
  })()`))
  await shot('harness-draft-dock.png')
  check(await count('[data-chip="artifact-edit"]'), 1, 'first draft has one chip')
  await click('[data-dsh-iui-edit-exit]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'first card edit closed')
  check(await count('[data-dsh-iui-draft-badge]'), 1, 'closed draft shows a card badge')
  // Edit the second card; the first draft must survive.
  await click('[data-dsh-iui-call-id="dst-call-9"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'second card edit')
  await openArrangementEditor('b5')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'second card popover')
  await saveInstruction('第二张卡片：增加首次实施年份')
  await wait('document.querySelectorAll("[data-dsh-iui-edit-draft-row]").length === 2', 'two drafts')
  check(await text('[data-dsh-iui-edit-draft-switcher]').then(t => t.includes('(2/6)')), true, 'draft switcher shows two of six')
  check(await count('[data-chip="artifact-edit"]'), 2, 'two composer chips')
  check(await count('[data-dsh-iui-call-id="dst-call-1"] [data-dsh-iui-draft-badge]'), 1, 'inactive draft keeps its badge')
  // Switch back to the first draft through the switcher.
  await read(`(() => {
    const rows = [...document.querySelectorAll('[data-dsh-iui-edit-draft-row]')];
    const first = rows.find(row => row.getAttribute('data-key') === 'e2e-session:dst-call-1');
    first.querySelector('[data-dsh-iui-edit-draft-activate]').click();
  })()`)
  await wait(`document.querySelector('[data-dsh-iui-call-id="dst-call-1"]').getAttribute('data-dsh-iui-editing') === 'true'`, 'first draft active again')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-draft-row][data-active="true"]').length === 1 && !document.querySelector('[data-dsh-iui-edit-panel][data-closing="true"]')`, 'one active draft after close animation')
  check(await count('[data-dsh-iui-edit-draft-row][data-active="true"]'), 1, 'exactly one active draft')
  // Delete the second chip; the draft must survive as detached, then re-attach.
  const refs = await read('window.__input().occurrences.filter(item => item.source === "artifact-edit").map(item => item.ref)')
  check(refs.length, 2, 'two chip references')
  await read(`window.__deleteChip(${JSON.stringify(refs[1])})`)
  await wait(`document.querySelectorAll('[data-chip="artifact-edit"]').length === 1`, 'one chip after delete')
  await new Promise(resolve => setTimeout(resolve, 1100))
  check(await count('[data-dsh-iui-call-id="dst-call-9"] [data-dsh-iui-draft-badge][data-state="detached"]'), 1, 'deleted chip detaches its draft badge')
  check(await count('[data-dsh-iui-edit-draft-row][data-attached="false"]'), 1, 'switcher marks the detached draft')
  await click('[data-dsh-iui-edit-draft-row][data-attached="false"] [data-dsh-iui-edit-draft-attach]')
  await wait(`document.querySelectorAll('[data-chip="artifact-edit"]').length === 2`, 'chip re-attached')
  // One composed message carries both envelopes.
  const composed = await read('window.__serializeChips().then(result => result.composed)')
  check((composed.match(/<artifact-edit-request>/g) ?? []).length, 2, 'one message carries two envelopes')
  check((composed.match(/"requestId":"req_[A-Za-z0-9_-]+"/g) ?? []).length, 2, 'each envelope carries its request id')
  check(composed.includes('"artifactId":"dst-call-1"'), true, 'first envelope names its artifact')
  check(composed.includes('"artifactId":"dst-call-9"'), true, 'second envelope names its artifact')
  check((composed.match(/"targetOrder"/g) ?? []).length, 2, 'each envelope carries its order')
  check(await count('[data-sent-summary] [data-reference-chip]'), 2, 'sent summary shows one chip per request')
  // Two independent block-edit revisions land as two cards, each carrying its request id.
  const envelopeMap = composed.split('<artifact-edit-request>').slice(1).reduce((map, segment) => {
    const requestId = /"requestId":"([^"]+)"/.exec(segment)?.[1]
    const artifactId = /"artifactId":"([^"]+)"/.exec(segment)?.[1]
    if (requestId !== undefined && artifactId !== undefined) map[artifactId] = requestId
    return map
  }, {})
  check(Object.keys(envelopeMap).length, 2, 'composed message names two request/artifact pairs')
  const badgesBefore = await count('[data-dsh-iui-revision]')
  await read(`window.__applyBlockEditRevision(${JSON.stringify({ artifactId: 'dst-call-1', revisionId: 'dst-call-2', baseRevisionId: 'dst-call-1', revision: 2, requestId: envelopeMap['dst-call-1'], editedBlockIds: ['b3'], program: DIGITAL_PROGRAM, title: '夏令时与冬令时' })}, 'dst-call-2')`)
  await read(`window.__applyBlockEditRevision(${JSON.stringify({ artifactId: 'dst-call-9', revisionId: 'dst-call-10', baseRevisionId: 'dst-call-9', revision: 2, requestId: envelopeMap['dst-call-9'], editedBlockIds: ['b5'], program: DST_PROGRAM, title: '第二张卡片' })}, 'dst-call-10')`)
  await wait(`document.querySelectorAll('[data-dsh-intelligent-ui="card"]').length === ${cardsBefore + 3}`, 'two revision cards')
  check(await count('[data-dsh-iui-revision]'), badgesBefore + 2, 'two new revision badges')
  // 17. Turn close reconciles both fulfilled drafts away.
  await read('window.__closeTurn()')
  await wait('!document.querySelector("[data-dsh-iui-draft-badge]")', 'fulfilled drafts reconciled')
  check(await count('[data-dsh-iui-edit-draft-switcher]'), 0, 'no draft switcher after all requests fulfilled')
  check(await count('[data-dsh-iui-draft-badge]'), 0, 'no failed badges after all requests fulfilled')
  await shot('harness-m3-batch-reconciled.png')
  // 18. A partially fulfilled batch returns the untouched draft as failed.
  await read('window.__nextTurn()')
  await click('[data-dsh-iui-call-id="dst-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'failure draft one')
  await openArrangementEditor('b3')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'failure popover one')
  await saveInstruction('第三次尝试：只改这一张')
  await click('[data-dsh-iui-edit-exit]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'failure draft one closed')
  await click('[data-dsh-iui-call-id="dst-call-9"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'failure draft two')
  await openArrangementEditor('b5')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'failure popover two')
  await saveInstruction('第三次尝试：这一张不会被完成')
  await wait(`document.querySelectorAll('[data-chip="artifact-edit"]').length === 2`, 'two failure chips')
  const partial = await read('window.__serializeChips().then(result => result.composed)')
  const partialIds = partial.split('<artifact-edit-request>').slice(1).reduce((map, segment) => {
    const requestId = /"requestId":"([^"]+)"/.exec(segment)?.[1]
    const artifactId = /"artifactId":"([^"]+)"/.exec(segment)?.[1]
    if (requestId !== undefined && artifactId !== undefined) map[artifactId] = requestId
    return map
  }, {})
  await read(`window.__applyBlockEditRevision(${JSON.stringify({ artifactId: 'dst-call-1', revisionId: 'dst-call-12', baseRevisionId: 'dst-call-1', revision: 3, requestId: partialIds['dst-call-1'], editedBlockIds: ['b3'], program: DIGITAL_PROGRAM, title: '夏令时与冬令时' })}, 'dst-call-12')`)
  await read('window.__closeTurn()')
  await wait(`document.querySelectorAll('[data-dsh-iui-draft-badge][data-state="failed"]').length === 1`, 'failed draft restored')
  check(await count('[data-dsh-iui-call-id="dst-call-9"] [data-dsh-iui-draft-badge][data-state="failed"]'), 1, 'unfulfilled draft shows the failed badge')
  check((await text('[data-dsh-iui-draft-badge][data-state="failed"]')).includes('未完成'), true, 'failed card badge explains the draft was kept')
  check(await count('[data-dsh-iui-draft-attach]'), 1, 'failed draft can be re-attached')
  await shot('harness-m3-reconcile-failed.png')
  await click('[data-dsh-iui-draft-attach]')
  await wait(`document.querySelectorAll('[data-chip="artifact-edit"]').length === 1`, 'failed draft re-attached')
  // Clean the composer before the branch scenario: detach the retried draft again.
  await read(`(() => {
    const occurrence = window.__input().occurrences.find(item => item.source === 'artifact-edit');
    window.__deleteChip(occurrence.ref);
  })()`)
  await wait(`document.querySelectorAll('[data-chip="artifact-edit"]').length === 0`, 'composer cleaned before branch scenario')
  // 19. Zero-model restore: the old revision becomes a local revision card.
  await read(`window.__latestMap['dst-call-1'] = { revisionId: 'dst-call-12', revision: 3 }`)
  await read('window.__remount()')
  await wait('!!document.querySelector(`[data-dsh-iui-call-id="dst-call-2"] [data-dsh-iui-restore]`)', 'restore entry on old revision')
  const cardsBeforeRestore = await count('[data-dsh-intelligent-ui="card"]')
  await click('[data-dsh-iui-call-id="dst-call-2"] [data-dsh-iui-restore]')
  await wait(`document.querySelectorAll('[data-dsh-intelligent-ui="card"]').length === ${cardsBeforeRestore + 1}`, 'restored local revision card')
  check(await count('[data-dsh-iui-local-revision]'), 1, 'restored card is marked local')
  check((await text('[data-dsh-iui-restore-done]')).includes('4'), true, 'restore reports the new revision number')
  check((await text('[data-dsh-intelligent-ui="card"]:last-of-type')).includes('夏令时与冬令时'), true, 'restored card renders the old program')

  // 20. Per-artifact revision history dialog from the revision badge.
  await click('[data-dsh-iui-call-id="dst-call-2"] [data-dsh-iui-history-open][data-history-trigger="badge"]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'history dialog')
  await read(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))`)
  check(await read(`document.querySelector('[data-dsh-iui-history]')?.contains(document.activeElement) === true`), true, 'Shift+Tab wraps inside the history dialog')
  check(await count('[data-dsh-iui-history-revision]'), 3, 'history lists this artifact revisions')
  check(await read(`document.querySelector('[data-dsh-iui-history-revision="restore_local1"]')?.getAttribute('data-current')`), 'true', 'history marks the current revision')
  check((await text('[data-dsh-iui-history]')).includes('初始生成'), true, 'history includes the initial revision')
  check((await text('[data-dsh-iui-history]')).includes('自定义样式'), true, 'history describes a custom style with copy, not its id')
  check((await text('[data-dsh-iui-history]')).includes('cs_e2e123'), false, 'history never exposes the raw style id')
  check((await text('[data-dsh-iui-history-subtitle]')).includes('call_'), false, 'history does not expose the raw artifact id as a subtitle')
  check(await count('[data-dsh-iui-history-revision="restore_local1"] [data-dsh-iui-history-restore]'), 0, 'history offers no restore for unavailable content')
  check(await count('[data-dsh-iui-history-revision="dst-call-1"] [data-dsh-iui-history-restore]'), 1, 'history offers restore for retained old revisions')
  check(await count('[data-dsh-iui-history-revision="dst-call-2"] [data-dsh-iui-history-restore]'), 1, 'history offers restore for edited old revisions')
  check(await count('[data-dsh-iui-history-revision="dst-call-2"] [data-dsh-iui-history-delete]'), 0, 'the card rendered revision cannot be deleted from its own history')
  check(await count('[data-dsh-iui-history-revision="dst-call-1"] [data-dsh-iui-history-delete]'), 0, 'the initial revision has no delete action')
  // Deletion: delete the current local restore revision (not referenced by any
  // newer one); its local card is removed together with the history row.
  await click('[data-dsh-iui-history-revision="restore_local1"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'delete confirmation')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-history-delete-cancel') === true`, 'delete confirmation focuses Cancel')
  check(await read(`document.querySelector('[data-dsh-iui-history-delete-warning]').getAttribute('role')`), 'status', 'delete warning is announced')
  await click('[data-dsh-iui-history-delete-cancel]')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-history-delete') === true`, 'cancelling returns focus to Delete')
  await click('[data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'delete confirmation again')
  // Simulate a lost delete response: the Host has already removed it, so the
  // retry answers revision_missing and the UI must converge, not stay stale.
  await read('window.__deleteMissing = true')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait('!document.querySelector(\'[data-dsh-iui-history-revision="restore_local1"]\')', 'deleted history row')
  check(await count('[data-dsh-iui-local-revision]'), 0, 'deleting a history revision removes its local card')
  check(await count('[data-dsh-iui-history-delete-error]'), 0, 'a missing revision converges without an error banner')
  await wait(`document.querySelector('[data-dsh-iui-history]')?.contains(document.activeElement) === true`, 'focus stays inside the open history after deletion')
  await shot('harness-history.png')
  await read(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'history dialog closed')
  await shot('harness-m3-local-revision.png')
  // 20. Branch editing from an old revision: conflict banner offers a branch,
  // and the envelope carries branch:true.
  await click('[data-dsh-iui-call-id="dst-call-2"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-conflict]")', 'conflict banner on old revision')
  check((await count('[data-dsh-iui-edit-branch]')) >= 1, true, 'conflict banner offers a branch edit')
  await click('[data-dsh-iui-edit-branch]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-branch-note]")', 'branch note')
  check(await count('[data-dsh-iui-edit-conflict]'), 0, 'branch note replaces the conflict banner')
  const branchText = await text('[data-dsh-iui-edit-branch-note]')
  check(branchText.includes('修订 2'), true, 'branch note names the base revision')
  check(branchText.includes('不会覆盖修订'), true, 'branch note names the latest revision it will not overwrite')
  await openArrangementEditor('b3')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'branch popover')
  await saveInstruction('分支修改：把时钟改成数字读数')
  check(await read(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('分支'))`), true, 'chip label marks the branch')
  const branchEnvelope = await read('window.__serializeChipMatching("分支")')
  check(branchEnvelope.includes('"branch":true'), true, 'branch request carries branch:true')
  check(branchEnvelope.includes('"baseRevisionId":"dst-call-2"'), true, 'branch request keeps the old base revision')
  await cdp.send('Emulation.clearDeviceMetricsOverride')

  // 22. Temporary-style results support block content edits only.
  const tempBefore = await count('[data-dsh-intelligent-ui="card"]')
  await read('window.__addTempCard("temp-call-1", "临时卡片")')
  await wait(`document.querySelectorAll('[data-dsh-intelligent-ui="card"]').length === ${tempBefore + 1}`, 'temporary-style card')
  check(await read(`document.querySelector('[data-dsh-iui-call-id="temp-call-1"]').getAttribute('data-dsh-iui-temp-style')`), 'true', 'temporary-style card is marked')
  await click('[data-dsh-iui-call-id="temp-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'temporary-style editor')
  await openArrangementEditor('b3')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'temporary-style popover')
  await saveInstruction('临时样式内容修改')
  const tempEnvelope = await read('window.__serializeChipMatching("临时卡片")')
  check(tempEnvelope.includes('"temporaryStyle"'), true, 'temporary-style envelope carries the snapshot')
  check(tempEnvelope.includes('"directives":"keep the card compact and calm"'), true, 'temporary-style envelope carries the directives')
  check(tempEnvelope.includes('"styleId"'), false, 'temporary-style envelope has no style id')
  // Simulate the Host's composed revision with the snapshot in meta.
  await read(`window.__applyBlockEditRevision(${JSON.stringify({ artifactId: 'temp-call-1', revisionId: 'temp-call-2', baseRevisionId: 'temp-call-1', revision: 2, editedBlockIds: ['b3'], program: DIGITAL_PROGRAM, title: '临时卡片', style: 'card', temporaryStyle: { schemaVersion: 1, baseLayout: 'card', directives: 'keep the card compact and calm' } })}, 'temp-call-2')`)
  await wait(`document.querySelectorAll('[data-dsh-iui-temp-style="true"]').length >= 2`, 'temporary-style revision card')
  check(await count('[data-dsh-intelligent-ui="card"]'), tempBefore + 2, 'temporary-style revision card rendered')
  // A temp draft with order/global only is blocked with a clear message.
  await read('window.__nextTurn()')
  await click('[data-dsh-iui-call-id="temp-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'temporary order editor')
  await moveWithKeyboard('b2', 'ArrowUp', 1)
  const tempOrderError = await read('window.__serializeChipMatching("临时卡片").then(() => null, error => String(error))')
  check(tempOrderError.includes('临时样式结果只支持区块内容修改'), true, 'temporary order-only draft is blocked with guidance')
  await cdp.send('Emulation.clearDeviceMetricsOverride')

  // 23. Nested edit mode: toggle, select a nested block, send identity fields.
  const nestedBefore = await count('[data-dsh-intelligent-ui="card"]')
  await read('window.__addNestedCard()')
  await wait(`document.querySelectorAll('[data-dsh-intelligent-ui="card"]').length === ${nestedBefore + 1}`, 'nested card')
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'nested editor')
  check(await count('[data-dsh-iui-edit-nested]'), 1, 'nested mode toggle is offered')
  await click('[data-dsh-iui-edit-nested]')
  await wait(`document.querySelectorAll('[data-dsh-iui-block-node]').length >= 8`, 'nested block wrappers')
  check(await count('[data-dsh-iui-block="b1.2.1"]'), 1, 'nested block has its display id')
  check((await text('[data-dsh-iui-edit-mode-state]')).includes('嵌套'), true, 'the toolbar states the current level')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 1000, deviceScaleFactor: 1, mobile: false })
  await new Promise(resolve => setTimeout(resolve, 420))
  check(await read(`document.querySelector('[data-dsh-iui-edit-nested-row] .dsh-iui-edit-arrangement-title').getBoundingClientRect().width > 20`), true, 'nested titles retain readable width at 1180px')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  await new Promise(resolve => setTimeout(resolve, 320))
  await read(`document.querySelector('[data-dsh-iui-edit-nested-row][data-block-id="b1.2.1"]').scrollIntoView({ block: 'center' })`)
  await new Promise(resolve => setTimeout(resolve, 200))
  await hover('[data-dsh-iui-edit-nested-row][data-block-id="b1.2.1"]')
  await wait(`document.querySelector('.dsh-iui-block-overlay-item[data-dsh-iui-block-hit-item="b1.2.1"]')?.getAttribute('data-hovered') === 'true'`, 'nested row hover reaches the canvas')
  check(await count('.dsh-iui-block-overlay-item[data-dsh-iui-block-hit-item="b1.2.1"] .dsh-iui-block-hover-frame'), 1, 'nested row hover frames the nested block')
  check(await read(`document.querySelector('.dsh-iui-block-overlay-item[data-dsh-iui-block-hit-item="b1.2.1"] .dsh-iui-block-page-index')?.textContent ?? null`), '1.2.1', 'nested blocks show their page-order address on hover')
  check(await read(`document.querySelector('[data-dsh-iui-edit-nested-row][data-block-id="b1.2.1"]').getAttribute('data-hover-linked')`), 'true', 'nested row is linked back to the hovered canvas block')
  await rowMenu('[data-dsh-iui-edit-nested-row][data-block-id="b1.2.1"]')
  check(await read(`document.querySelector('[data-dsh-iui-edit-locate] svg path')?.getAttribute('d')?.length > 0`), true, 'the row menu carries the locate glyph')
  await click('[data-dsh-iui-edit-locate]')
  await wait(`!!document.querySelector('[data-dsh-iui-block-hit="b1.2.1"][data-dsh-iui-block-flash="true"]')`, 'nested locate flash')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
  await clickBlock('b1.2.1')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'nested popover')
  await saveInstruction('nested text change')
  check((await text('[data-dsh-iui-edit-request-list]')).includes('nested text change'), true, 'nested request saved')
  const nestedEnvelope = await read('window.__serializeChipMatching("嵌套区块样例")')
  check(nestedEnvelope.includes('"blockId":"b1.2.1"'), true, 'envelope carries the nested display id')
  check(nestedEnvelope.includes('"nodeId"'), true, 'envelope carries the CST node id')
  check(nestedEnvelope.includes('"sourceDigest"'), true, 'envelope carries the source digest')
  await shot('harness-m4-nested-edit.png')

  // 24. Nested arrangement: reorder children inside one container group.
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'nested arrangement editor')
  await click('[data-dsh-iui-edit-nested]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-nested-arrangement]")', 'nested arrangement section')
  check((await count('[data-dsh-iui-edit-nested-group]')) >= 1, true, 'nested group with multiple children')
  check(await count('[data-dsh-iui-edit-nested-list]'), await count('[data-dsh-iui-edit-nested-group]'), 'one list per nested parent')
  const nestedGroup = '[data-dsh-iui-edit-nested-group][data-parent-id="b1.2"]'
  check(await count(`${nestedGroup} [data-dsh-iui-edit-nested-row]`), 3, 'multi-child nested group is present')
  check(await count('[data-dsh-iui-edit-nested-group][data-parent-id="b1"] [data-dsh-iui-edit-nested-row]'), 2, 'the card group lists its Title and Col')
  const nestedFirst = await read(`document.querySelector('${nestedGroup} [data-dsh-iui-edit-nested-row]').getAttribute('data-block-id')`)
  const nestedRowsBefore = await read(`[...document.querySelectorAll('${nestedGroup} [data-dsh-iui-edit-nested-row]')].map(row => row.getAttribute('data-block-id'))`)
  await read(`(() => {
    const grip = document.querySelector('${nestedGroup} [data-dsh-iui-edit-nested-grip]');
    grip.focus();
    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  })()`)
  await new Promise(resolve => setTimeout(resolve, 400))
  const nestedRowsAfter = await read(`[...document.querySelectorAll('${nestedGroup} [data-dsh-iui-edit-nested-row]')].map(row => row.getAttribute('data-block-id'))`)
  check(nestedRowsBefore.length >= 2, true, 'nested group has rows to reorder')
  check(nestedRowsAfter[0], nestedRowsBefore[1], 'nested child moved down inside its parent')
  check(nestedRowsAfter[1], nestedFirst, 'nested child order is a permutation')
  await wait(`document.querySelector('[data-dsh-iui-edit-live]')?.textContent.includes('第 2 位')`, 'nested reorder announcement')
  check((await text('[data-dsh-iui-edit-live]')).includes('第 2 位'), true, 'nested reorder is announced')
  check(await read(`document.querySelector('[data-dsh-iui-edit-nested-grip]')?.getAttribute('aria-describedby') === document.querySelector('[data-dsh-iui-edit-a11y-hint]')?.id`), true, 'nested grip references the keyboard hint')
  check(await read(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('调整区块顺序'))`), true, 'chip reports the nested reorder')
  check(await read(`document.querySelector('[data-dsh-iui-edit-reset-nested]').disabled`), false, 'nested reset is enabled after a change')
  const nestedOrderEnvelope = await read('window.__serializeChipMatching("嵌套区块样例")')
  check(nestedOrderEnvelope.includes('"orderByParent"'), true, 'envelope carries the hierarchical order')
  check(nestedOrderEnvelope.includes('"targetOrder"'), true, 'envelope keeps the legacy root target order')

  // 25. Deterministic structure operation: duplicate a block, local revision card.
  await read(`(() => {
    window.__structureCalls = [];
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      if (url.includes('/api/intelligent-ui/artifact-structure')) {
        const body = JSON.parse(init.body);
        window.__structureCalls.push(body);
        if (body.preview === true) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, preview: { program: ${JSON.stringify(NESTED_PROGRAM + '\nmockPreview = Text("preview", "sm")')}, operations: body.operations, changedBlockIds: ['b1'], touched: [{ nodeId: body.operations[0].nodeId, nodePath: 'root/children[0]', op: body.operations[0].op }] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        const result = {
          artifactId: 'nested-call-1',
          revisionId: 'struct_e2e_duplicate',
          baseRevisionId: JSON.parse(init.body).baseRevisionId,
          revision: 2,
          operationId: JSON.parse(init.body).operationId,
          program: ${JSON.stringify(NESTED_PROGRAM)},
          style: 'card',
          title: '嵌套区块样例',
        };
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), { status: 201, headers: { 'content-type': 'application/json' } }));
      }
      return original(input, init);
    };
  })()`)
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'structure editor')
  await rowMenu('[data-dsh-iui-edit-arrangement-row]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-preview-confirm]")', 'structure preview dialog')
  check(await read(`document.querySelector('[data-dsh-iui-edit-structure-preview]').getAttribute('aria-modal')`), 'true', 'preview dialog is modal')
  await wait(`document.activeElement?.getAttribute('data-dsh-iui-edit-preview-cancel') !== null`, 'preview initial focus')
  check(await read(`document.activeElement?.getAttribute('data-dsh-iui-edit-preview-cancel') !== null`), true, 'initial focus is on cancel')
  check((await count('[data-dsh-iui-edit-preview-diff] [data-diff="add"]')) > 0, true, 'preview shows added diff rows')
  await click('[data-dsh-iui-edit-preview-confirm]')
  await wait('!!document.querySelector("[data-dsh-iui-local-revision]")', 'local structural revision card')
  const structureCalls = await read('window.__structureCalls')
  check(structureCalls.length, 2, 'preview then apply requests were sent')
  check(structureCalls[0].preview, true, 'first request is the dry-run preview')
  check(structureCalls[1].preview === undefined, true, 'second request is the real apply')
  check(structureCalls[0].operations[0].op, 'duplicate', 'duplicate operation previewed')
  check(typeof structureCalls[0].operations[0].nodeId, 'string', 'duplicate carries the CST node id')
  check(typeof structureCalls[0].operations[0].sourceDigest, 'string', 'duplicate carries the source digest')
  check(structureCalls[0].operations[0].toIndex, 1, 'duplicate inserts after the source block')
  check((await text('[data-dsh-iui-local-revision]')).includes('结构操作修订'), true, 'local card is labelled as a structural revision')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'editor closed after the structural revision')
  check(await read('!!document.querySelector("[data-dsh-iui-edit-view]")'), false, 'editor closes after the structural revision')

  // 25b. Batch arrangement mode: selection controls, toolbar order ops, batch duplicate.
  await read(`(() => {
    window.__batchPreviousFetch = window.fetch;
    window.__batchStructureCalls = [];
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      if (url.includes('/api/intelligent-ui/artifact-structure')) {
        const body = JSON.parse(init.body);
        window.__batchStructureCalls.push(body);
        if (body.preview === true) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, preview: { program: ${JSON.stringify(NESTED_PROGRAM + '\nbatchPreview = Text("preview", "sm")')}, operations: body.operations, changedBlockIds: ['b1', 'b2'], touched: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        const result = {
          artifactId: 'nested-call-1',
          revisionId: 'struct_e2e_batch',
          baseRevisionId: body.baseRevisionId,
          revision: 2,
          operationId: body.operationId,
          program: ${JSON.stringify(NESTED_PROGRAM)},
          style: 'card',
          title: '嵌套区块样例',
        };
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), { status: 201, headers: { 'content-type': 'application/json' } }));
      }
      return window.__batchPreviousFetch(input, init);
    };
  })()`)
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'batch editor')
  await wait('!!document.querySelector("[data-dsh-iui-edit-batch-toggle]")', 'batch toggle')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-toggle]').getAttribute('aria-pressed')`), 'false', 'batch mode is off by default')
  check(await text('[data-dsh-iui-edit-batch-toggle]'), '批量操作', 'the toggle carries icon and copy')
  await click('[data-dsh-iui-edit-batch-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-batch-bar]")', 'batch toolbar')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-toggle]').getAttribute('aria-pressed')`), 'true', 'the toggle exposes its pressed state')
  check(await read(`!!document.querySelector('.dsh-iui-edit-arrangement')`), true, 'batch mode keeps the arrangement section')
  check(await count('[data-dsh-iui-edit-grip]'), 0, 'batch mode replaces the drag grips')
  check(await count('[data-dsh-iui-edit-row-menu]'), 0, 'batch mode hides the per-row structure menu')
  check(await count('[data-dsh-iui-edit-batch-check]'), 2, 'every row shows a selection control')
  check((await text('[data-dsh-iui-edit-batch-count]')).includes('已选 0 个区块'), true, 'the live status starts at zero')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-duplicate]').disabled`), true, 'structure actions are disabled without a selection')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-duplicate]').getAttribute('title')`), '请先选择区块', 'the disabled structure action explains why')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-order="up"]').disabled`), true, 'order actions are disabled without a selection')
  await shot('harness-batch-empty.png')

  // Select one row from its control and another from the row body.
  await click(`${arrangementSelector('b1')} [data-dsh-iui-edit-batch-check]`)
  await wait(`document.querySelector('${arrangementSelector('b1')}').getAttribute('data-batch-selected') === 'true'`, 'b1 batch selection')
  check(await read(`document.querySelector('${arrangementSelector('b1')} [data-dsh-iui-edit-batch-check]').getAttribute('aria-checked')`), 'true', 'the selection control reports the checked state')
  await click(`${arrangementSelector('b2')} [data-dsh-iui-edit-arrangement-body]`)
  await wait(`document.querySelector('${arrangementSelector('b2')}').getAttribute('data-batch-selected') === 'true'`, 'b2 batch selection')
  check((await text('[data-dsh-iui-edit-batch-count]')).includes('已选 2 个区块'), true, 'the live status follows the selection')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-order="up"]').disabled`), true, 'up is disabled when both selected blocks already lead the list')
  await shot('harness-batch-selected.png')

  // One selected block moves down, then back to the top through the toolbar.
  await click(`${arrangementSelector('b2')} [data-dsh-iui-edit-batch-check]`)
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-batch-check][aria-checked="true"]').length === 1`, 'single batch selection')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-order="down"]').disabled`), false, 'a selected block with an unselected neighbour can move down')
  await click('[data-dsh-iui-edit-batch-order="down"]')
  await wait(`document.querySelector('[data-dsh-iui-edit-arrangement-row]').getAttribute('data-block-id') === 'b2'`, 'batch down reorder')
  check((await arrangementOrder()).slice(0, 2), ['b2', 'b1'], 'the selected block moved down one slot')
  check(await read(`document.querySelector('${arrangementSelector('b1')}').getAttribute('data-batch-selected')`), 'true', 'the selection follows the reordered row')
  await wait(`document.querySelector('[data-dsh-iui-edit-live]')?.textContent.includes('已批量调整区块顺序')`, 'batch reorder announcement')
  check((await text('[data-dsh-iui-edit-live]')).includes('已批量调整区块顺序'), true, 'batch reordering is announced')
  const batchChip = `[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('调整区块顺序'))`
  await wait(batchChip, 'batch chip label')
  check(await read(batchChip), true, 'the composer chip reports the batch reorder')
  await click('[data-dsh-iui-edit-batch-order="top"]')
  await wait(`document.querySelector('[data-dsh-iui-edit-arrangement-row]').getAttribute('data-block-id') === 'b1'`, 'batch top reorder')
  check((await arrangementOrder()).slice(0, 2), ['b1', 'b2'], 'top restores the selected block to the front')

  // The docked rail at 1180px is the narrowest panel: the batch toolbar wraps.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false })
  await new Promise(resolve => setTimeout(resolve, 200))
  const batchLayout = await read(`(() => {
    const section = document.querySelector('.dsh-iui-edit-arrangement');
    const bar = document.querySelector('[data-dsh-iui-edit-batch-bar]');
    const sr = section.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    return {
      sectionOverflow: section.scrollWidth - section.clientWidth,
      barOverflow: bar.scrollWidth - bar.clientWidth,
      inside: br.left >= sr.left - 1 && br.right <= sr.right + 1,
      headInside: document.querySelector('.dsh-iui-edit-arrangement .dsh-iui-edit-section-head').scrollWidth <= section.clientWidth + 1,
    };
  })()`)
  check(batchLayout.sectionOverflow <= 1, true, 'batch mode does not overflow the narrow rail')
  check(batchLayout.barOverflow <= 1 && batchLayout.inside, true, 'the batch toolbar wraps inside the rail')
  check(batchLayout.headInside, true, 'the arrangement section head still fits the narrow rail')
  await shot('harness-batch-narrow.png')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  await new Promise(resolve => setTimeout(resolve, 200))

  // Select every block and duplicate the batch: one preview, one apply, one revision.
  await click('[data-dsh-iui-edit-batch-select-all]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-batch-check][aria-checked="true"]').length === 2`, 'select all blocks')
  check((await text('[data-dsh-iui-edit-batch-count]')).includes('已选 2 个区块'), true, 'select all updates the live status')
  const localBeforeBatch = await count('[data-dsh-iui-local-revision]')
  await click('[data-dsh-iui-edit-batch-duplicate]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-preview-confirm]")', 'batch preview dialog')
  check(await read(`!!document.querySelector('[data-dsh-iui-edit-structure-preview]')`), true, 'batch preview uses the existing preview dialog shell')
  check((await text('.dsh-iui-edit-preview-title')), '预览批量结构修改', 'the dialog says it is a batch preview')
  check((await text('.dsh-iui-edit-preview-operation')), '复制所选', 'the batch operation label is explicit')
  check((await text('[data-dsh-iui-edit-preview-block-count]')), '已选 2 个区块', 'the dialog names the batch size')
  check(await count('[data-dsh-iui-edit-preview-blocks] [data-dsh-iui-edit-preview-batch-item]'), 2, 'the dialog lists the involved blocks')
  check((await text('[data-dsh-iui-edit-preview-blocks]')).includes('外层卡片'), true, 'the involved-block list carries the titles')
  check((await count('[data-dsh-iui-edit-preview-diff] [data-diff="add"]')) > 0, true, 'the batch preview keeps the shared diff list')
  await shot('harness-batch-preview.png')
  await click('[data-dsh-iui-edit-preview-confirm]')
  await wait(`document.querySelectorAll('[data-dsh-iui-local-revision]').length === ${localBeforeBatch + 1}`, 'batch structural revision card')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'editor closed after the batch revision')
  const batchCalls = await read('window.__batchStructureCalls')
  check(batchCalls.length, 2, 'the batch sends a preview and one real apply')
  check(batchCalls[0].preview, true, 'the first batch request is the dry run')
  check(batchCalls[1].preview === undefined, true, 'the second batch request is the apply')
  check(batchCalls[0].operations.length, 2, 'the preview carries both operations')
  check(batchCalls[1].operations.length, 2, 'the apply carries both operations')
  check(batchCalls[0].operations.map(operation => operation.op), ['duplicate', 'duplicate'], 'both operations duplicate')
  check(batchCalls[0].operations.map(operation => operation.toIndex), [2, 1], 'duplicates are sent in descending page order for stable placement')
  check((await count('[data-dsh-iui-local-revision]')), localBeforeBatch + 1, 'the batch produces exactly one local revision card')
  check((await read(`[...document.querySelectorAll('[data-dsh-iui-local-revision]')].at(-1).textContent`)).includes('结构操作修订'), true, 'the batch revision card is labelled as a structural revision')
  check(await read('!!document.querySelector("[data-dsh-iui-edit-view]")'), false, 'the editor closes after a batch structural revision')
  await read('window.fetch = window.__batchPreviousFetch; delete window.__batchPreviousFetch')

  // 25c. Escape exits batch mode and returns focus to the toggle.
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'batch escape editor')
  await click('[data-dsh-iui-edit-batch-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-batch-bar]")', 'batch escape toolbar')
  await click(`${arrangementSelector('b1')} [data-dsh-iui-edit-batch-check]`)
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-batch-check][aria-checked="true"]').length === 1`, 'batch escape selection')
  await read(`(() => {
    const toggle = document.querySelector('[data-dsh-iui-edit-batch-toggle]');
    toggle.focus();
    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  })()`)
  await wait('!document.querySelector("[data-dsh-iui-edit-batch-bar]")', 'Escape leaves batch mode')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-toggle]').getAttribute('aria-pressed')`), 'false', 'Escape clears the pressed state')
  check(await read(`document.activeElement?.hasAttribute('data-dsh-iui-edit-batch-toggle')`), true, 'Escape returns focus to the batch toggle')
  check(await count('[data-dsh-iui-edit-batch-check]'), 0, 'leaving batch mode restores the grips')
  await wait(`document.querySelector('[data-dsh-iui-edit-live]')?.textContent.includes('已退出批量操作模式')`, 'batch exit announcement')
  check((await text('[data-dsh-iui-edit-live]')).includes('已退出批量操作模式'), true, 'leaving batch mode is announced')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'batch scenario closed')

  // 26. Container expansion: Box/Grid/Section/Carousel children are selectable.
  await read('window.__addNestedContainersCard()')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="nested-containers-call-1"]\')', 'nested containers card')
  await click('[data-dsh-iui-call-id="nested-containers-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'nested containers editor')
  await click('[data-dsh-iui-edit-nested]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-nested-arrangement]")', 'nested containers arrangement')
  check((await count('[data-dsh-iui-edit-nested-group]')) >= 4, true, 'Box/Grid/Section/Carousel groups appear')
  check(await count('[data-dsh-iui-block="b1.2.1"]'), 1, 'Box child is selectable')
  check(await count('[data-dsh-iui-block="b2.2.1"]'), 1, 'Grid child is selectable')
  check(await count('[data-dsh-iui-block="b3.1"]'), 1, 'Section child is selectable')
  check(await count('[data-dsh-iui-block="b4.2.1"]'), 1, 'Carousel child is selectable')
  await clickBlock('b2.2.1')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'grid nested popover')
  await saveInstruction('grid nested change')
  const expandedEnvelope = await read('window.__serializeChipMatching("嵌套容器样例")')
  check(expandedEnvelope.includes('"blockId":"b2.2.1"'), true, 'container expansion envelope carries the Grid child id')

  // 27. Model addition request and cross-container move request.
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'addition editor')
  await click('[data-dsh-iui-edit-nested]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-add]")', 'add-block button')
  const addParent = await read(`document.querySelector('[data-dsh-iui-edit-add]').getAttribute('data-parent-id')`)
  await click(`[data-dsh-iui-edit-add][data-parent-id="${addParent}"]`)
  await wait('!!document.querySelector("[data-dsh-iui-edit-add-input]")', 'add-block form')
  await read(`(() => {
    const input = document.querySelector('[data-dsh-iui-edit-add-input]');
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, 'add a small note below');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await wait(`!document.querySelector('[data-dsh-iui-edit-add-save]').disabled`, 'add save enabled')
  await click('[data-dsh-iui-edit-add-save]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-addition]")', 'addition row')
  check((await text('[data-dsh-iui-edit-addition]')).includes('add a small note below'), true, 'addition instruction appears in its group')
  await wait(`document.querySelector('[data-dsh-iui-edit-live]')?.textContent.includes('已添加待新增区块')`, 'addition announcement')
  check((await text('[data-dsh-iui-edit-live]')).includes('已添加待新增区块'), true, 'addition is announced')
  check(await count('[data-dsh-iui-edit-addition-remove]'), 1, 'addition can be removed')
  const additionEnvelope = await read('window.__serializeChipMatching("嵌套区块样例")')
  check(additionEnvelope.includes('"additions"'), true, 'envelope carries the model addition')
  check(additionEnvelope.includes('"parentBlockId":"' + addParent + '"'), true, 'addition names its parent block')
  check(additionEnvelope.includes('"instruction":"add a small note below"'), true, 'addition carries the instruction')

  await read('window.__structureCalls = []')
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'move editor')
  await click('[data-dsh-iui-edit-nested]')
  await rowMenu('[data-dsh-iui-edit-nested-row][data-block-id="b1.2.1"]')
  await click('[data-dsh-iui-edit-move]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-move-menu]")', 'move menu')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-edit-move-target')`, 'move menu focus')
  check(await read(`document.activeElement?.hasAttribute('data-dsh-iui-edit-move-target')`), true, 'move menu focuses the first target')
  const moveTargets = await read(`[...document.querySelectorAll('[data-dsh-iui-edit-move-target]')].map(el => el.getAttribute('data-target-id'))`)
  const firstFocused = await read(`document.activeElement.getAttribute('data-target-id')`)
  await read(`document.querySelector('[data-dsh-iui-edit-move-menu]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))`)
  await new Promise(resolve => setTimeout(resolve, 200))
  const afterArrow = await read(`document.activeElement.getAttribute('data-target-id')`)
  check(afterArrow !== firstFocused, true, 'arrow keys move focus between targets')
  check(moveTargets.includes('root'), false, 'move menu does not offer the root target')
  check(moveTargets.includes('b1.2'), false, 'move menu excludes the current parent')
  check(moveTargets.includes('b1'), false, 'move menu excludes ancestors')
  check(moveTargets.length > 0, true, 'move menu offers a valid container')
  const moveTarget = moveTargets[0]
  await click(`[data-dsh-iui-edit-move-target][data-target-id="${moveTarget}"]`)
  await wait('!!document.querySelector("[data-dsh-iui-edit-preview-confirm]")', 'move preview dialog')
  await click('[data-dsh-iui-edit-preview-confirm]')
  await wait('!!document.querySelector("[data-dsh-iui-local-revision]")', 'local move revision card')
  const moveCalls = await read('window.__structureCalls')
  check(moveCalls.length, 2, 'move preview then apply requests were sent')
  check(moveCalls[0].preview, true, 'move preview is a dry run')
  check(moveCalls[1].operations[0].op, 'move', 'move operation sent')
  check(typeof moveCalls[1].operations[0].toParentNodeId, 'string', 'move carries the target parent node id')
  check(typeof moveCalls[1].operations[0].toIndex, 'number', 'move carries the target index')

  // 28. Strict mode toggle is part of the sent envelope.
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'strict editor')
  await wait('!!document.querySelector("[data-dsh-iui-edit-strict]")', 'strict toggle')
  check(await read(`document.querySelector('[data-dsh-iui-edit-strict]').getAttribute('aria-pressed')`), 'false', 'strict mode is off by default')
  await click('[data-dsh-iui-edit-strict]')
  await wait(`document.querySelector('[data-dsh-iui-edit-strict]').getAttribute('aria-pressed') === 'true'`, 'strict enabled')
  await click('[data-dsh-iui-edit-nested]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-nested-row]")', 'strict nested rows')
  await rowMenu('[data-dsh-iui-edit-nested-row][data-block-id="b1.2.1"]')
  await click('[data-dsh-iui-edit-structure-edit]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'strict popover')
  await saveInstruction('strict protection edit')
  const strictEnvelope = await read('window.__serializeChipMatching("嵌套区块样例")')
  check(strictEnvelope.includes('"strict":true'), true, 'envelope carries strict mode')
  check(strictEnvelope.includes('"instruction":"strict protection edit"'), true, 'strict edit instruction is sent')

  // 29. B2-6: runtime $state survives a new revision card.
  const originalCard = '[data-dsh-iui-call-id="dst-call-1"]'
  await read(`(() => {
    const card = document.querySelector('${originalCard}');
    const option = [...card.querySelectorAll('[role="radio"]')].find(button => button.textContent.trim() === '夏令时');
    option.click();
  })()`)
  await wait(`document.querySelector('${originalCard}').innerText.includes('钟表被拨快 1 小时')`, 'runtime state changed')
  const runtimeCardsBefore = await read('document.querySelectorAll(\'[data-dsh-intelligent-ui="card"]\').length')
  await read(`window.__applyRevision(${JSON.stringify(DST_PROGRAM)})`)
  await wait(`document.querySelectorAll('[data-dsh-intelligent-ui="card"]').length === ${runtimeCardsBefore + 1}`, 'revision card appended')
  await wait(`document.querySelectorAll('[data-dsh-iui-call-id="dst-call-2"]').length >= 1`, 'new revision card present')
  const revisionState = await read(`[...document.querySelectorAll('[data-dsh-iui-call-id="dst-call-2"]')].at(-1).innerText`)
  check(revisionState.includes('钟表被拨快 1 小时'), true, 'new revision inherits the runtime $state')
  check(await read(`[...document.querySelectorAll('[data-dsh-iui-call-id="dst-call-2"]')].at(-1).querySelector('[role="radio"][aria-checked="true"]')?.textContent`), '夏令时', 'new revision keeps the selected state')
  await shot('harness-b26-runtime-state.png')

  // 30. Editing auto-fits the chat content width and the old expand button is gone.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  // Normalize any leftover editor from the previous scenarios before measuring.
  await read(`(() => { if (document.querySelector('[data-dsh-iui-edit-view]')) document.querySelector('[data-dsh-iui-edit-exit]')?.click(); })()`)
  await wait(`!document.querySelector('[data-dsh-iui-edit-view]') && !document.querySelector('[data-dsh-iui-edit-panel][data-closing="true"]')`, 'editor settled before width test')
  await read(`(() => {
    const shell = document.createElement('div');
    shell.setAttribute('data-conversation-content', '');
    shell.setAttribute('data-conversation-region', 'chat');
    shell.style.setProperty('--dsh-chat-content-width', '900px');
    document.body.appendChild(shell);
    window.__shellWidthEl = shell;
  })()`)
  await read(`(() => {
    window.__widthSamples = [];
    new MutationObserver(() => {
      const value = parseFloat(window.__shellWidthEl.style.getPropertyValue('--dsh-chat-content-width'));
      if (Number.isFinite(value)) window.__widthSamples.push(value);
    }).observe(window.__shellWidthEl, { attributes: true, attributeFilter: ['style'] });
  })()`)
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'auto width editor')
  await wait(`(() => { const w = parseFloat(window.__shellWidthEl.style.getPropertyValue('--dsh-chat-content-width')); return w >= 650 && w <= 780 })()`, 'chat width fitted')
  await new Promise(resolve => setTimeout(resolve, 300))
  const fittedWidth = await read(`parseFloat(window.__shellWidthEl.style.getPropertyValue('--dsh-chat-content-width'))`)
  check(fittedWidth >= 680 && fittedWidth <= 780, true, 'editing narrows the chat content width to a non-overlapping value')
  check(await read(`window.__widthSamples.some(w => w > 720 && w < 890)`), true, 'content width animates through intermediate values while the panel enters')
  const composerMax = await read(`parseFloat(getComputedStyle(document.querySelector('[data-composer-card]')).maxWidth)`)
  check(composerMax, fittedWidth + 32, 'composer width follows the fitted content width (+32px)')
  check(await count('[data-dsh-iui-edit-expand]'), 0, 'expand button has been removed')
  await read('window.__widthSamples = []')
  await click('[data-dsh-iui-edit-exit]')
  await wait(`!!document.querySelector('[data-dsh-iui-edit-panel][data-closing="true"]')`, 'panel closing with width animation')
  await new Promise(resolve => setTimeout(resolve, 300))
  check(await read(`window.__widthSamples.some(w => w > 720 && w < 890)`), true, 'content width animates back while the panel exits')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'auto width editor closed')
  await wait('window.__shellWidthEl.style.getPropertyValue("--dsh-chat-content-width") === "900px"', 'chat width restored')
  check(await read('window.__shellWidthEl.style.getPropertyValue("--dsh-chat-content-width")'), '900px', 'closing the editor restores the user width')
  check(await read(`parseFloat(getComputedStyle(document.querySelector('[data-composer-card]')).maxWidth)`), 748, 'composer max-width is restored with the content width')
  await read(`window.__shellWidthEl.remove()`)

  // 31. The fitted width follows the shell width preference while editing.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false })
  await read(`(() => {
    const wrapper = document.createElement('div');
    wrapper.id = 'e2e-width-wrapper';
    wrapper.style.setProperty('--dsh-chat-user-width', '1200px');
    const content = document.createElement('div');
    content.setAttribute('data-conversation-content', '');
    content.setAttribute('data-conversation-region', 'chat');
    content.style.setProperty('--dsh-chat-content-width', 'var(--dsh-chat-user-width, 748px)');
    wrapper.appendChild(content);
    document.body.appendChild(wrapper);
    window.__widthWrapper = wrapper;
    window.__widthContent = content;
  })()`)
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'dynamic width editor')
  await wait(`(() => { const w = parseFloat(window.__widthContent.style.getPropertyValue('--dsh-chat-content-width')); return Number.isFinite(w) && w >= 1000 && w <= 1040 })()`, 'dynamic width fitted')
  const firstFit = await read(`parseFloat(window.__widthContent.style.getPropertyValue('--dsh-chat-content-width'))`)
  check(firstFit > 990 && firstFit < 1040, true, 'preference 1200 yields a narrower fitted content width')
  await read(`window.__widthWrapper.style.setProperty('--dsh-chat-user-width', '900px')`)
  await wait(`getComputedStyle(window.__widthContent).getPropertyValue('--dsh-chat-content-width').trim() === '900px'`, 'dynamic width follows preference')
  check(await read(`window.__widthContent.style.getPropertyValue('--dsh-chat-content-width') !== '1023px'`), true, 'a smaller preference drops the fitted override')
  await click('[data-dsh-iui-edit-exit]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'dynamic width editor closed')
  check(await read('window.__widthWrapper.style.getPropertyValue("--dsh-chat-user-width")'), '900px', 'user width preference is preserved')
  await read('window.__widthWrapper.remove()')

  // 32. Block popover stays fully inside the viewport when the anchor scrolls away.
  await read(`window.scrollTo(0, document.documentElement.scrollHeight)`)
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'popover clamp editor')
  await wait('!!document.querySelector("[data-dsh-iui-edit-arrangement-row]")', 'popover clamp rows')
  await read(`window.scrollTo(0, 0)`)
  await new Promise(resolve => setTimeout(resolve, 300))
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b2"]')
  await click('[data-dsh-iui-edit-structure-edit]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'clamped popover')
  await new Promise(resolve => setTimeout(resolve, 250))
  const popRect = await read(`(() => {
    const pop = document.querySelector('[data-dsh-iui-edit-popover]');
    const r = pop.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight };
  })()`)
  check(popRect.top >= 12, true, 'popover top is clamped inside the viewport')
  check(popRect.bottom <= popRect.height - 12 + 0.5, true, 'popover bottom is clamped inside the viewport')
  check(popRect.left >= 12, true, 'popover left is clamped inside the viewport')
  check(popRect.right <= popRect.width - 12 + 0.5, true, 'popover right is clamped inside the viewport')

  // 33. Rounded panel animation + persistent compact delete confirmation.
  await read(`(() => {
    if (document.querySelector('[data-dsh-iui-edit-popover]')) document.querySelector('[data-dsh-iui-edit-instruction]')?.blur();
    if (document.querySelector('[data-dsh-iui-edit-view]')) document.querySelector('[data-dsh-iui-edit-exit]')?.click();
  })()`)
  await wait(`!document.querySelector('[data-dsh-iui-edit-view]') && !document.querySelector('[data-dsh-iui-edit-panel][data-closing="true"]')`, 'editor settled before polish test')
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'polish editor')
  await wait('!!document.querySelector("[data-dsh-iui-edit-panel]")', 'polish panel')
  const panelStyle = await read(`(() => {
    const panel = document.querySelector('[data-dsh-iui-edit-panel]');
    const cs = getComputedStyle(panel);
    return { radius: parseFloat(cs.borderTopLeftRadius), top: parseFloat(cs.top), right: parseFloat(cs.right), bottom: parseFloat(cs.bottom), overflow: cs.overflow, animation: cs.animationName };
  })()`)
  check(panelStyle.radius >= 15, true, 'editor panel uses the rounded card radius')
  check(panelStyle.top, 64, 'rounded panel keeps the top inset')
  check(panelStyle.right, 12, 'rounded panel keeps the right inset')
  check(panelStyle.bottom, 12, 'rounded panel keeps the bottom inset')
  check(panelStyle.overflow.includes('hidden'), true, 'rounded panel clips its contents')
  check(panelStyle.animation.includes('in-desktop'), true, 'editor panel plays the enter animation')
  check(await read(`getComputedStyle(document.querySelector('.dsh-iui-edit-toolbar')).animationName.includes('dsh-iui-edit-toolbar-in')`), true, 'edit toolbar fades/slides in with the editor')
  await click('[data-dsh-iui-edit-exit]')
  await wait(`!!document.querySelector('[data-dsh-iui-edit-panel][data-closing="true"]')`, 'closing panel animation')
  check(await read(`getComputedStyle(document.querySelector('[data-dsh-iui-edit-panel][data-closing="true"]')).animationName.includes('out-desktop')`), true, 'editor panel plays the exit animation')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'editor removed after exit animation')

  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'delete confirm editor')
  await wait('!!document.querySelector("[data-dsh-iui-edit-arrangement-row]")', 'delete confirm rows')
  const actionRow = '[data-dsh-iui-edit-arrangement-row][data-block-id="b2"]'
  const menuTrigger = `${actionRow} [data-dsh-iui-edit-row-menu]`
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  await new Promise(resolve => setTimeout(resolve, 200))
  check(await count(menuTrigger), 1, 'each row exposes one overflow trigger')
  check(await read(`Math.round(document.querySelector(${JSON.stringify(menuTrigger)}).getBoundingClientRect().width)`), 24, 'the row overflow trigger is a 24px target')
  check(await read(`(() => { const row = document.querySelector(${JSON.stringify(actionRow)}); const body = row.querySelector('.dsh-iui-edit-arrangement-body'); const trigger = row.querySelector('[data-dsh-iui-edit-row-menu]'); return body.getBoundingClientRect().right <= trigger.getBoundingClientRect().left; })()`), true, 'row text stops before the overflow trigger')
  await click(menuTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'row action menu')
  await new Promise(resolve => setTimeout(resolve, 180))
  await shot('harness-row-menu.png')
  check(await read(`document.querySelector('[data-dsh-iui-edit-row-menu-panel]').getAttribute('role')`), 'menu', 'the row actions use a menu')
  check(await count('[data-dsh-iui-edit-row-menu-panel] [role="menuitem"]'), 5, 'the menu carries locate/edit/duplicate/move/delete')
  check(await count('[data-dsh-iui-edit-row-menu-panel] [data-dsh-iui-edit-locate]'), 1, 'locate is in the menu')
  check(await count('[data-dsh-iui-edit-row-menu-panel] [data-dsh-iui-edit-structure-duplicate]'), 1, 'duplicate is in the menu')
  check(await read(`(() => { const r = document.querySelector('[data-dsh-iui-edit-row-menu-panel]').getBoundingClientRect(); return r.left >= 8 && r.top >= 8 && r.right <= window.innerWidth - 8 && r.bottom <= window.innerHeight - 8; })()`), true, 'the row menu stays inside the viewport')
  check(await wait(`document.activeElement?.hasAttribute('data-dsh-iui-edit-locate') === true`, 'menu first-item focus').then(() => true), true, 'the menu focuses its first item')
  check(await read(`getComputedStyle(document.activeElement).outlineStyle`), 'solid', 'menu items show the project focus ring')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] })
  await new Promise(resolve => setTimeout(resolve, 120))
  check(await read(`getComputedStyle(document.activeElement).outlineStyle`), 'solid', 'menu focus survives forced colors')
  await cdp.send('Emulation.setEmulatedMedia', { features: [] })
  await new Promise(resolve => setTimeout(resolve, 120))
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await wait('!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'Escape closes the row menu')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-edit-row-menu') === true`, 'Escape returns focus to the row trigger')
  await click(menuTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'row menu reopened after Escape')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-edit-locate') === true`, 'menu focus after Escape reopen')
  await pressTab()
  await wait('!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'Tab closes the row menu')
  check(await read(`document.activeElement === document.body || document.activeElement?.classList.contains('dsh-iui-header')`), false, 'Tab keeps focus on a real row/panel control')
  await click(menuTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'row menu reopened after Tab')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-edit-locate') === true`, 'menu first-item focus after reopen')
  await click('[data-dsh-iui-edit-structure-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-structure-confirm]")', 'delete confirmation in menu')
  check(await read(`document.querySelector('[data-dsh-iui-edit-row-menu-panel]').getAttribute('role')`), 'dialog', 'the confirmation step exposes dialog semantics')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-edit-structure-cancel') === true`, 'delete confirmation focus')
  check(await read(`document.activeElement?.hasAttribute('data-dsh-iui-edit-structure-cancel')`), true, 'delete confirmation focuses Cancel')
  await new Promise(resolve => setTimeout(resolve, 3600))
  check(await count('[data-dsh-iui-edit-structure-confirm]'), 1, 'delete confirmation persists without a timeout')
  await pressTab()
  check(await read(`document.activeElement?.hasAttribute('data-dsh-iui-edit-structure-confirm-delete') === true`), true, 'Tab reaches Delete inside the confirmation')
  check(await count('[data-dsh-iui-edit-row-menu-panel]'), 1, 'confirmation stays open while tabbing between its actions')
  await pressTab()
  await wait('!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'Tab leaves the confirmation')
  check(await read(`document.querySelector('[data-structure-confirming]') === null`), true, 'leaving by Tab clears the parent confirmation state')
  await click(menuTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'row menu reopened')
  await click('[data-dsh-iui-edit-structure-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-structure-confirm-delete]")', 'delete confirmation reopened')
  await click('[data-dsh-iui-edit-structure-confirm-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-preview-confirm]")', 'delete preview opened')
  check(await count('[data-dsh-iui-edit-row-menu-panel]'), 0, 'confirming delete closes the row menu')
  await click('[data-dsh-iui-edit-preview-cancel]')
  await new Promise(resolve => setTimeout(resolve, 200))
  await shot('harness-polish-delete-confirm.png')
  const scrollBeforeLocate = await read('window.scrollY')
  await click(menuTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'row menu before locate')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-edit-locate') === true`, 'menu first-item focus before locate')
  await click('[data-dsh-iui-edit-locate]')
  await wait('!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'locate closes the row menu')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-edit-row-menu') === true`, 'locate returns focus to the row trigger')
  check(await read(`document.activeElement?.hasAttribute('data-dsh-iui-edit-row-menu')`), true, 'locate returns focus to the row trigger')
  await read(`window.scrollTo(0, ${scrollBeforeLocate})`)
  await new Promise(resolve => setTimeout(resolve, 260))
  // Textarea focus ring has room inside the popover scroll container.
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b2"]')
  await click('[data-dsh-iui-edit-structure-edit]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'focus ring popover')
  await read(`(() => { const ta = document.querySelector('[data-dsh-iui-edit-instruction]'); ta.focus(); return true; })()`)
  await new Promise(resolve => setTimeout(resolve, 100))
  const focusRoom = await read(`(() => {
    const ta = document.querySelector('[data-dsh-iui-edit-instruction]');
    const scroll = document.querySelector('.dsh-iui-edit-popover-scroll');
    const cs = getComputedStyle(ta);
    const scrollCs = getComputedStyle(scroll);
    return {
      room: ta.getBoundingClientRect().left - scroll.getBoundingClientRect().left,
      bottomRoom: scroll.getBoundingClientRect().bottom - ta.getBoundingClientRect().bottom,
      scrollPaddingBottom: scrollCs.paddingBottom,
      marginLeft: cs.marginLeft,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      focused: document.activeElement === ta,
    };
  })()`)
  check(focusRoom.room >= 3, true, 'textarea leaves room for its focus orbit on the left')
  check(focusRoom.bottomRoom >= 3, true, 'textarea leaves room for its focus orbit at the bottom')
  check(parseFloat(focusRoom.scrollPaddingBottom) >= 3, true, 'the popover scroll box reserves the bottom orbit space')
  check(focusRoom.marginLeft, '3px', 'textarea reserves a 3px margin')
  check(focusRoom.outlineStyle, 'none', 'the textarea focus outline is replaced by the orbit')
  check(await count('[data-dsh-iui-input-orbit]'), 1, 'the focused textarea shows the orbit cue')
  check(focusRoom.focused, true, 'textarea is focused for the focus-ring check')
  await click('[data-dsh-iui-edit-cancel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-popover]")', 'focus ring popover closed')
  // The panel exit closes the editor, not instantly.
  await click('[data-dsh-iui-edit-exit]')
  await wait(`!!document.querySelector('[data-dsh-iui-edit-panel][data-closing="true"]')`, 'closing toolbar editor')
  check(await read(`getComputedStyle(document.querySelector('.dsh-iui-edit-toolbar')).animationName.includes('dsh-iui-edit-toolbar-out')`), true, 'edit toolbar fades/slides out with the editor')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'toolbar editor closed')
  // The panel itself can exit editing, not only the toolbar.
  await click('[data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'panel exit editor')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'panel exit closes the editor')

  // 30. Divider/Spacer quick adjust: canvas preview + deterministic property revision.
  await read('window.__addPropsCard()')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="props-call-1"]\')', 'props card')
  const propGeometry = `(() => {
    const card = document.querySelector('[data-dsh-iui-call-id="props-call-1"]');
    const title = card.querySelector('.iui-title');
    const hr = card.querySelector('hr.iui-divider');
    return { gap: +(hr.getBoundingClientRect().top - title.getBoundingClientRect().bottom).toFixed(2), width: +hr.getBoundingClientRect().width.toFixed(1), margin: getComputedStyle(hr).marginTop };
  })()`
  const propsNormalGeometry = await read(propGeometry)
  await click('[data-dsh-iui-call-id="props-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'props editor')
  await wait('document.querySelectorAll("[data-dsh-iui-block]").length === 4', 'four prop blocks')
  const propsEditGeometry = await read(propGeometry)
  check(propsEditGeometry.gap, propsNormalGeometry.gap, 'edit canvas keeps the title-to-divider rhythm')
  check(propsEditGeometry.width, propsNormalGeometry.width, 'edit canvas keeps the divider width')
  check(propsEditGeometry.margin, propsNormalGeometry.margin, 'edit canvas keeps the divider margin')
  await clickBlock('b2')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props]")', 'quick props panel')
  check(await read(`document.querySelector('[data-dsh-iui-edit-props]').getAttribute('data-component')`), 'Divider', 'Divider blocks show the quick-adjust panel')
  await wait(`document.activeElement?.closest('[data-dsh-iui-edit-props]') !== null`, 'quick panel focus')
  check(await read(`document.activeElement?.closest('[data-dsh-iui-edit-props]') !== null`), true, 'the first quick-adjust control receives focus')
  check(await count('[data-dsh-iui-edit-instruction]'), 0, 'quick-adjust blocks do not show the model textarea')
  check(await read(`document.querySelector('[data-dsh-iui-edit-props-apply]').disabled`), true, 'apply stays disabled until a value changes')
  const chooseQuickOption = async (rowSelector, value) => {
    await read(`document.querySelector(${JSON.stringify(`${rowSelector} [data-dsh-iui-quick-select]`)}).click()`)
    await wait('!!document.querySelector("[data-dsh-iui-quick-menu]")', 'quick menu open')
    await wait('!document.querySelector("[data-dsh-iui-input-orbit]")', 'dropdown focus clears the input orbit')
    check(await count('[data-dsh-iui-input-orbit]'), 0, 'dropdown triggers keep their menu focus, not the input orbit')
    await read(`(() => {
      const option = [...document.querySelectorAll('[data-dsh-iui-quick-menu] [data-value]')]
        .find(el => el.getAttribute('data-value') === ${JSON.stringify(value)});
      if (option === undefined) throw new Error('quick option missing: ' + ${JSON.stringify(value)});
      option.click();
      return true;
    })()`)
    await wait('!document.querySelector("[data-dsh-iui-quick-menu]")', 'quick menu closed')
  }
  const setInputValue = async (selector, value) => read(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  const unitOptionsOf = async (rowSelector) => {
    await read(`document.querySelector(${JSON.stringify(`${rowSelector} [data-dsh-iui-quick-select]`)}).click()`)
    await wait('!!document.querySelector("[data-dsh-iui-quick-menu]")', 'unit menu open')
    const menuBox = await read(`(() => {
      const menu = document.querySelector('[data-dsh-iui-quick-menu]');
      const items = [...menu.querySelectorAll('[role="option"]')];
      const menuRect = menu.getBoundingClientRect();
      return {
        fits: menu.scrollHeight <= menu.clientHeight,
        lastVisible: items.at(-1).getBoundingClientRect().bottom <= menuRect.bottom + 1,
      };
    })()`)
    check(menuBox.fits, true, 'the described unit menu is not clipped')
    check(menuBox.lastVisible, true, 'the last described unit option stays fully visible')
    const options = await read(`[...document.querySelectorAll('[data-dsh-iui-quick-menu] [role="option"]')].map(option => {
      const desc = option.querySelector('.dsh-iui-quick-option-desc');
      const rect = desc?.getBoundingClientRect();
      return {
        value: option.getAttribute('data-value'),
        label: option.querySelector('.dsh-iui-quick-option-label')?.textContent ?? '',
        description: desc?.textContent ?? '',
        descriptionVisible: rect !== undefined && rect.width > 0 && rect.height > 0,
      };
    })`)
    await read(`document.querySelector(${JSON.stringify(`${rowSelector} [data-dsh-iui-quick-select]`)}).click()`)
    await wait('!document.querySelector("[data-dsh-iui-quick-menu]")', 'unit menu closed')
    return options
  }
  check(await count('[data-dsh-iui-edit-props] select'), 0, 'quick adjust uses no native select widgets')
  const dividerWidthUnits = await unitOptionsOf('[data-dsh-iui-edit-prop="width"]')
  check(dividerWidthUnits.map(option => option.value), ['', 'px', '%'], 'Divider width offers exactly Default/px/%')
  check(dividerWidthUnits.every(option => option.description.length > 0), true, 'every Divider width unit option carries a description')
  check(dividerWidthUnits.every(option => option.descriptionVisible), true, 'every Divider width unit description is rendered')
  check(dividerWidthUnits[0].description.includes('分割线撑满'), true, 'the Divider width Default option explains the column span')
  check(dividerWidthUnits[1].description.includes('固定像素值'), true, 'the px option explains the fixed pixel size')
  check(dividerWidthUnits[2].description.includes('相对容器'), true, 'the % option explains the container share')
  check((await text('[data-dsh-iui-edit-prop="width"] [data-dsh-iui-edit-props-desc]')).includes('分割线撑满'), true, 'the Divider width row explains the Default column span')
  const widthDescBox = await read(`(() => {
    const row = document.querySelector('[data-dsh-iui-edit-prop="width"] .dsh-iui-edit-props-row').getBoundingClientRect();
    const desc = document.querySelector('[data-dsh-iui-edit-prop="width"] [data-dsh-iui-edit-props-desc]').getBoundingClientRect();
    return { below: desc.top >= row.bottom - 1, height: desc.height };
  })()`)
  check(widthDescBox.below, true, 'the Divider width unit explanation sits under its row')
  check(widthDescBox.height > 0, true, 'the Divider width unit explanation is visible')
  await read(`document.querySelector('[data-dsh-iui-edit-prop="color"] [data-dsh-iui-quick-select]').click()`)
  await wait('!!document.querySelector("[data-dsh-iui-quick-menu]")', 'custom colour menu')
  check(await count('[data-dsh-iui-quick-menu] [role="option"]'), 22, 'the colour menu renders every theme token plus custom')
  await read(`[...document.querySelectorAll('[data-dsh-iui-quick-menu] [data-value]')].find(el => el.getAttribute('data-value') === 'info').click()`)
  await wait('!document.querySelector("[data-dsh-iui-quick-menu]")', 'colour menu closed')
  await wait(`document.querySelector('[data-dsh-iui-edit-props-apply]').disabled === false`, 'apply enabled after edit')
  const popoverBeforePreview = await read(`document.querySelector('[data-dsh-iui-edit-popover]').getBoundingClientRect().toJSON()`)
  await chooseQuickOption('[data-dsh-iui-edit-prop="width"]', '%')
  check((await text('[data-dsh-iui-edit-prop="width"] [data-dsh-iui-edit-props-desc]')).includes('相对容器'), true, 'the Divider width row explanation follows the selected % unit')
  await setInputValue('[data-dsh-iui-edit-prop="width"] input', '60')
  await setInputValue('[data-dsh-iui-edit-prop="thickness"] input', '2')
  await wait(`document.querySelector('[data-dsh-iui-block="b2"] hr')?.getAttribute('style')?.includes('60%')`, 'divider preview width')
  check(await count('[data-dsh-iui-edit-prop="thickness"] [data-dsh-iui-quick-slider] [role="slider"]'), 1, 'thickness exposes a custom slider')
  await read(`(() => {
    const slider = document.querySelector('[data-dsh-iui-edit-prop="thickness"] [role="slider"]');
    slider.focus();
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return true;
  })()`)
    await wait(`document.querySelector('[data-dsh-iui-block="b2"] hr')?.getAttribute('style')?.includes('2.5px')`, 'slider updates the preview immediately')
  await read(`(() => {
    const slider = document.querySelector('[data-dsh-iui-edit-prop="thickness"] [role="slider"]');
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    return true;
  })()`)
  await wait(`document.querySelector('[data-dsh-iui-block="b2"] hr')?.getAttribute('style')?.includes('border-top-width: 2px')`, 'slider settles back')
  check(await read(`document.querySelector('[data-dsh-iui-edit-prop="thickness"] [role="slider"]').getAttribute('aria-valuenow')`), '2', 'the custom slider reports its value')
  check(await read(`document.querySelector('[data-dsh-iui-edit-view]').getAttribute('data-dsh-iui-edit-props-preview')`), 'b2', 'the canvas reports the previewed block')
  const popoverAfterPreview = await read(`document.querySelector('[data-dsh-iui-edit-popover]').getBoundingClientRect().toJSON()`)
  check(Math.abs(popoverAfterPreview.left - popoverBeforePreview.left) <= 0.5, true, 'the popover does not follow the narrowing block')
  check(Math.abs(popoverAfterPreview.top - popoverBeforePreview.top) <= 0.5, true, 'the popover keeps its vertical anchor while previewing')
  await chooseQuickOption('[data-dsh-iui-edit-prop="width"]', 'px')
  await wait(`document.querySelector('[data-dsh-iui-block="b2"] hr')?.getAttribute('style')?.includes('60px')`, 'width unit switched to px')
  check((await text('[data-dsh-iui-edit-prop="width"] [data-dsh-iui-edit-props-desc]')).includes('固定像素值'), true, 'the Divider width row explanation follows the selected px unit')
  const popoverAfterUnit = await read(`document.querySelector('[data-dsh-iui-edit-popover]').getBoundingClientRect().toJSON()`)
  check(Math.abs(popoverAfterUnit.left - popoverBeforePreview.left) <= 0.5, true, 'switching the width unit does not move the popover horizontally')
  check(Math.abs(popoverAfterUnit.top - popoverBeforePreview.top) <= 0.5, true, 'switching the width unit does not move the popover vertically')
  await chooseQuickOption('[data-dsh-iui-edit-prop="width"]', '%')
  const dividerPreview = await read(`(() => {
    const hr = document.querySelector('[data-dsh-iui-block="b2"] hr');
    const cs = getComputedStyle(hr);
    return { border: cs.borderTopWidth, style: hr.getAttribute('style') ?? '' };
  })()`)
  check(dividerPreview.border, '2px', 'the canvas preview paints the new divider thickness')
  check(dividerPreview.style.includes('var(--iui-info)'), true, 'the canvas preview keeps the theme token colour')
  await shot('harness-quick-props.png')
  await read(`(() => {
    window.__propCalls = [];
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      if (url.includes('/api/intelligent-ui/artifact-structure')) {
        const body = JSON.parse(init.body);
        window.__propCalls.push(body);
        const revision = window.__propCalls.length + 1;
        const result = {
          artifactId: 'props-call-1',
          revisionId: 'struct_props_' + revision,
          baseRevisionId: body.baseRevisionId,
          revision,
          operationId: body.operationId,
          program: ${JSON.stringify(PROPS_PROGRAM_APPLIED)},
          title: '属性调整样例',
          style: 'card',
        };
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), { status: 201, headers: { 'content-type': 'application/json' } }));
      }
      return original(input, init);
    };
    return true;
  })()`)
  const localBefore = await count('[data-dsh-iui-local-revision]')
  await click('[data-dsh-iui-edit-props-apply]')
  await wait(`document.querySelectorAll('[data-dsh-iui-local-revision]').length === ${localBefore + 1}`, 'property revision card')
  check((await read(`[...document.querySelectorAll('[data-dsh-iui-local-revision]')].at(-1).textContent`)).includes('属性调整修订'), true, 'the local card is labelled as a property revision')
  const propCalls = await read('window.__propCalls')
  check(propCalls.length, 1, 'one deterministic property request was sent')
  check(propCalls[0].operations[0].op, 'props', 'the request carries a props operation')
  check(typeof propCalls[0].operations[0].nodeId, 'string', 'the request carries the CST node id')
  check(propCalls[0].operations[0].props.color, 'info', 'the request carries the chosen colour')
  check(propCalls[0].operations[0].props.width, '60%', 'the request carries the width')
  check(propCalls[0].operations[0].props.thickness, 2, 'the request carries the thickness')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'editor closed after applying properties')

  // Spacer width/height through the same quick-adjust panel.
  await click('[data-dsh-iui-call-id="props-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'spacer editor')
  await wait('document.querySelectorAll("[data-dsh-iui-block]").length === 4', 'spacer blocks')
  await clickBlock('b3')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props]")', 'spacer quick props')
  check(await read(`document.querySelector('[data-dsh-iui-edit-props]').getAttribute('data-component')`), 'Spacer', 'Spacer blocks show width and height controls')
  const spacerWidthUnits = await unitOptionsOf('[data-dsh-iui-edit-prop="width"]')
  check(spacerWidthUnits.map(option => option.value), ['', 'px', '%'], 'Spacer width offers exactly Default/px/%')
  check(spacerWidthUnits.every(option => option.descriptionVisible), true, 'every Spacer width unit option carries a visible description')
  check(spacerWidthUnits[0].description.includes('自动填满剩余空间'), true, 'the Spacer width Default option keeps the Row free-space copy')
  check((await text('[data-dsh-iui-edit-prop="width"] [data-dsh-iui-edit-props-desc]')).includes('自动填满剩余空间'), true, 'the Spacer width row explains the Default Row free space')
  // The English Spacer width Default copy is the longest, so its unit menu is
  // the worst case for the described-menu height calculation.
  const originalLanguage = await read('window.__lang')
  await read('window.__language("en")')
  await wait(`document.querySelector('[data-dsh-iui-edit-prop="width"] [data-dsh-iui-edit-props-desc]').textContent.includes('No explicit length')`, 'English quick props copy')
  const enSpacerWidthUnits = await unitOptionsOf('[data-dsh-iui-edit-prop="width"]')
  check(enSpacerWidthUnits.map(option => option.value), ['', 'px', '%'], 'the English Spacer width menu keeps exactly Default/px/%')
  check(enSpacerWidthUnits.every(option => option.description.length > 0 && option.descriptionVisible), true, 'every English Spacer width unit option carries a visible description')
  check(enSpacerWidthUnits[0].description.includes('usually collapses'), true, 'the English Spacer width Default keeps its Row free-space copy')
  await read(`window.__language(${JSON.stringify(originalLanguage)})`)
  await wait(`document.querySelector('[data-dsh-iui-edit-prop="width"] [data-dsh-iui-edit-props-desc]').textContent.includes('不设置长度')`, 'quick props copy restored')
  const spacerHeightUnits = await unitOptionsOf('[data-dsh-iui-edit-prop="height"]')
  check(spacerHeightUnits.map(option => option.value), ['', 'px', '%'], 'Spacer height offers exactly Default/px/%')
  check(spacerHeightUnits.every(option => option.descriptionVisible), true, 'every Spacer height unit option carries a visible description')
  check(spacerHeightUnits[0].description.includes('Spacer 高度通常为 0'), true, 'the Spacer height Default option uses its own copy')
  check((await text('[data-dsh-iui-edit-prop="height"] [data-dsh-iui-edit-props-desc]')).includes('固定像素值'), true, 'the Spacer height row explains its initial px height')
  await chooseQuickOption('[data-dsh-iui-edit-prop="height"]', '')
  check((await text('[data-dsh-iui-edit-prop="height"] [data-dsh-iui-edit-props-desc]')).includes('Spacer 高度通常为 0'), true, 'the Spacer height row explains the Default collapse')
  await chooseQuickOption('[data-dsh-iui-edit-prop="width"]', 'px')
  await setInputValue('[data-dsh-iui-edit-prop="width"] input', '12')
  await chooseQuickOption('[data-dsh-iui-edit-prop="height"]', '%')
  check((await text('[data-dsh-iui-edit-prop="height"] [data-dsh-iui-edit-props-desc]')).includes('相对容器'), true, 'the Spacer height row explanation follows the selected % unit')
  await setInputValue('[data-dsh-iui-edit-prop="height"] input', '50')
  await wait(`document.querySelector('[data-dsh-iui-block="b3"] .iui-spacer')?.getAttribute('style')?.includes('12px')`, 'spacer preview width')
  await wait(`document.querySelector('[data-dsh-iui-block="b3"] .iui-spacer')?.getAttribute('style')?.includes('50%')`, 'spacer preview height')
  const spacerPreview = await read(`(() => {
    const spacer = document.querySelector('[data-dsh-iui-block="b3"] .iui-spacer');
    return { width: getComputedStyle(spacer).width, style: spacer.getAttribute('style') ?? '' };
  })()`)
  check(spacerPreview.width, '12px', 'the canvas preview paints the new spacer width')
  check(spacerPreview.style.includes('50%'), true, 'the canvas preview paints the new spacer height')
  const localBeforeSpacer = await count('[data-dsh-iui-local-revision]')
  await click('[data-dsh-iui-edit-props-apply]')
  await wait(`document.querySelectorAll('[data-dsh-iui-local-revision]').length === ${localBeforeSpacer + 1}`, 'second property revision card')
  const propCallsAfter = await read('window.__propCalls')
  check(propCallsAfter.length, 2, 'the spacer request was sent too')
  check(propCallsAfter[1].operations[0].props.width, 12, 'the spacer request carries the px width')
  check(propCallsAfter[1].operations[0].props.height, '50%', 'the spacer request carries the percentage height')
  await shot('harness-quick-props-applied.png')

  // 30b. A legacy Spacer(…, "auto") still opens as Default and writes by omission.
  await read('window.__addPropsLegacyAutoCard()')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="props-legacy-auto-call-1"]\')', 'legacy auto props card')
  await click('[data-dsh-iui-call-id="props-legacy-auto-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'legacy auto editor')
  await wait('document.querySelectorAll("[data-dsh-iui-block]").length === 4', 'legacy auto blocks')
  await clickBlock('b3')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props]")', 'legacy auto quick props')
  check(await read(`document.querySelector('[data-dsh-iui-edit-props]').getAttribute('data-component')`), 'Spacer', 'a legacy auto Spacer still opens the quick-adjust panel')
  check(await text('[data-dsh-iui-edit-prop="height"] .dsh-iui-quick-select-value'), '默认', 'the legacy auto height is shown as Default')
  check(await read(`document.querySelector('[data-dsh-iui-edit-props-apply]').disabled`), true, 'the untouched legacy auto value leaves Apply disabled')
  check(await read(`document.querySelector('[data-dsh-iui-edit-prop="height"] input').value`), '', 'Default leaves the height number empty')
  await chooseQuickOption('[data-dsh-iui-edit-prop="width"]', 'px')
  await setInputValue('[data-dsh-iui-edit-prop="width"] input', '12')
  await wait(`document.querySelector('[data-dsh-iui-edit-props-apply]').disabled === false`, 'legacy auto Apply enabled after a real edit')
  await read(`(() => {
    window.__legacyPropCalls = [];
    window.__legacySavedFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      if (url.includes('/api/intelligent-ui/artifact-structure')) {
        const body = JSON.parse(init.body);
        window.__legacyPropCalls.push(body);
        const result = {
          artifactId: 'props-legacy-auto-call-1',
          revisionId: 'struct_legacy_1',
          baseRevisionId: body.baseRevisionId,
          revision: 2,
          operationId: body.operationId,
          program: ${JSON.stringify(PROPS_PROGRAM_APPLIED)},
          title: ${JSON.stringify(PROPS_LEGACY_AUTO_TITLE)},
          style: 'card',
        };
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), { status: 201, headers: { 'content-type': 'application/json' } }));
      }
      return window.__legacySavedFetch(input, init);
    };
    return true;
  })()`)
  const localBeforeLegacyAuto = await count('[data-dsh-iui-local-revision]')
  await click('[data-dsh-iui-edit-props-apply]')
  await wait(`document.querySelectorAll('[data-dsh-iui-local-revision]').length === ${localBeforeLegacyAuto + 1}`, 'legacy auto property revision card')
  const legacyPropCalls = await read('window.__legacyPropCalls')
  check(legacyPropCalls.length, 1, 'the legacy auto edit sends one deterministic request')
  check(legacyPropCalls[0].operations[0].op, 'props', 'the legacy auto request carries a props operation')
  check(legacyPropCalls[0].operations[0].props, { width: 12 }, 'Default writes by omission: the auto height is not resubmitted')
  await read('window.fetch = window.__legacySavedFetch')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'legacy auto editor closed')

  // 31. A pending block instruction blocks the property apply with inline copy.
  await read('window.__addPropsCard("props-call-2", "属性调整样例 2")')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="props-call-2"]\')', 'dirty props card')
  await click('[data-dsh-iui-call-id="props-call-2"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'dirty editor')
  await wait('document.querySelectorAll("[data-dsh-iui-block]").length === 4', 'dirty blocks')
  await clickBlock('b1')
  await wait('!!document.querySelector("[data-dsh-iui-edit-instruction]")', 'instruction editor')
  await read(`(() => {
    const area = document.querySelector('[data-dsh-iui-edit-instruction]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, '把标题改短');
    area.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await click('[data-dsh-iui-edit-save]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-request-row]")', 'saved instruction row')
  await clickBlock('b2')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props]")', 'quick props with pending instruction')
  await chooseQuickOption('[data-dsh-iui-edit-prop="color"]', 'danger')
  await click('[data-dsh-iui-edit-props-apply]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props-error]")', 'dirty guard error')
  check((await text('[data-dsh-iui-edit-props-error]')).includes('请先发送'), true, 'a pending instruction is reported before applying properties')
  await click('[data-dsh-iui-edit-cancel]')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'dirty editor closed')

  // 32. Nested Divider quick adjust previews on the nested canvas.
  await read('window.__addNestedPropsCard()')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="nested-props-call-1"]\')', 'nested props card')
  await click('[data-dsh-iui-call-id="nested-props-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'nested props editor')
  await click('[data-dsh-iui-edit-nested]')
  await wait('document.querySelector("[data-dsh-iui-edit-nested]").getAttribute("aria-pressed") === "true"', 'nested mode on')
  await wait('!!document.querySelector(\'[data-dsh-iui-block-hit="b1.2"]\')', 'nested divider hit target')
  await clickBlock('b1.2')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props]")', 'nested quick props')
  check(await read(`document.querySelector('[data-dsh-iui-edit-props]').getAttribute('data-component')`), 'Divider', 'nested Divider shows quick adjust')
  await chooseQuickOption('[data-dsh-iui-edit-prop="width"]', '%')
  await setInputValue('[data-dsh-iui-edit-prop="width"] input', '30')
  await wait(`document.querySelector('[data-dsh-iui-block="b1.2"] hr')?.getAttribute('style')?.includes('30%')`, 'nested divider preview')
  check(await read(`document.querySelector('[data-dsh-iui-edit-view]').getAttribute('data-dsh-iui-edit-props-preview')`), 'b1.2', 'the nested canvas reports the previewed block')
  await click('[data-dsh-iui-edit-cancel]')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'nested props editor closed')

  // 33. Centered root Col keeps Divider geometry in the edit canvas.
  await read('window.__addPropsCenterCard()')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="props-center-call-1"]\')', 'center props card')
  const centerGeometry = `(() => {
    const card = document.querySelector('[data-dsh-iui-call-id="props-center-call-1"]');
    const hr = card.querySelector('hr.iui-divider');
    return { width: +hr.getBoundingClientRect().width.toFixed(1), margin: getComputedStyle(hr).marginTop };
  })()`
  const centerNormal = await read(centerGeometry)
  await click('[data-dsh-iui-call-id="props-center-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'center editor')
  await wait('document.querySelectorAll("[data-dsh-iui-block]").length === 2', 'center blocks')
  const centerEdit = await read(centerGeometry)
  check(centerEdit.width, centerNormal.width, 'edit canvas keeps a centered divider width')
  check(centerEdit.margin, centerNormal.margin, 'edit canvas keeps a centered divider margin')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'center editor closed')

  // 34. Dynamic or out-of-domain props fall back to the instruction editor.
  await read('window.__addPropsDynamicCard()')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="props-dynamic-call-1"]\')', 'dynamic props card')
  await click('[data-dsh-iui-call-id="props-dynamic-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'dynamic editor')
  await wait(`!!document.querySelector('[data-dsh-iui-block-hit="b1"]')`, 'dynamic hit target')
  await clickBlock('b1')
  await wait('!!document.querySelector("[data-dsh-iui-edit-instruction]")', 'instruction fallback')
  check(await count('[data-dsh-iui-edit-props]'), 0, 'dynamic props do not open the quick controls')
  check((await text('[data-dsh-iui-edit-props-fallback]')).includes('动态绑定'), true, 'the fallback explains the dynamic binding instead of rewriting it')
  await click('[data-dsh-iui-edit-cancel]')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'dynamic editor closed')

  // 35. Pages above the old 60-node budget keep nested blocks and quick adjust.
  await read('window.__addLargePageCard()')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="large-page-call-1"]\')', 'large page card')
  await click('[data-dsh-iui-call-id="large-page-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'large page editor')
  await wait('document.querySelectorAll("[data-dsh-iui-block]").length === 3', 'large page root blocks')
  check(await count('[data-dsh-iui-edit-nested]'), 1, 'a >60-node page still offers nested editing')
  await clickBlock('b2')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props]")', 'large page root divider quick props')
  check(await read(`document.querySelector('[data-dsh-iui-edit-props]').getAttribute('data-component')`), 'Divider', 'root Divider stays quick-adjustable on a large page')
  await click('[data-dsh-iui-edit-cancel]')
  await click('[data-dsh-iui-edit-nested]')
  await wait('document.querySelector("[data-dsh-iui-edit-nested]").getAttribute("aria-pressed") === "true"', 'large page nested mode')
  await wait(`!!document.querySelector('[data-dsh-iui-block-hit="b3.2"]')`, 'large page nested spacer hit')
  await clickBlock('b3.2')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props]")', 'nested spacer quick props')
  check(await read(`document.querySelector('[data-dsh-iui-edit-props]').getAttribute('data-component')`), 'Spacer', 'the nested Spacer is reachable on a large page')
  await chooseQuickOption('[data-dsh-iui-edit-prop="height"]', 'px')
  await setInputValue('[data-dsh-iui-edit-prop="height"] input', '24')
  await wait(`document.querySelector('[data-dsh-iui-block="b3.2"] .iui-spacer')?.getAttribute('style')?.includes('24px')`, 'large page spacer preview')
  await click('[data-dsh-iui-edit-cancel]')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'large page editor closed')

  // 36. Legacy page without an authoritative base registers on first open and
  // degrades to instructions when the old Host has no registration route.
  await read('window.__addPropsCard("props-call-3", "旧页面属性样例")')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="props-call-3"]\')', 'legacy props card')
  await read(`(() => {
    window.__artifactBaseCalls = [];
    window.__structureCalls = [];
    window.__fetchSeq = 0;
    window.__savedFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      window.__fetchSeq += 1;
      if (url.includes('/api/intelligent-ui/artifact-base')) {
        const body = JSON.parse(init.body);
        const status = window.__artifactBaseMode === 404 ? 404 : 200;
        window.__artifactBaseCalls.push({ ...body, seq: window.__fetchSeq, status });
        if (status === 404) {
          return Promise.resolve(new Response(JSON.stringify({ error: { code: 'not_found', message: 'missing' } }), { status: 404, headers: { 'content-type': 'application/json' } }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true, registered: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (url.includes('/api/intelligent-ui/artifact-structure')) {
        window.__structureCalls.push({ ...JSON.parse(init.body), seq: window.__fetchSeq });
        return Promise.resolve(new Response(JSON.stringify({ error: { code: window.__structureMissingCode ?? 'base_missing', message: 'missing' } }), { status: 404, headers: { 'content-type': 'application/json' } }));
      }
      return window.__savedFetch(input, init);
    };
    return true;
  })()`)
  await click('[data-dsh-iui-call-id="props-call-3"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'legacy editor')
  await wait('document.querySelectorAll("[data-dsh-iui-block]").length === 4', 'legacy blocks')
  await wait('window.__artifactBaseCalls.length === 1', 'legacy card registers its base once')
  const baseCalls = await read('window.__artifactBaseCalls')
  check(baseCalls.length, 1, 'opening the legacy card editor registers exactly one base')
  check(baseCalls[0].schemaVersion, 1, 'the registration carries the base schema version')
  check(baseCalls[0].artifactId, 'props-call-3', 'the registration names the card artifact')
  check(baseCalls[0].revisionId, 'props-call-3', 'the initial revision identity is the render call id')
  check(baseCalls[0].program, PROPS_PROGRAM, 'the registration posts the program the card rendered')
  await clickBlock('b2')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props]")', 'legacy quick props')
  await chooseQuickOption('[data-dsh-iui-edit-prop="color"]', 'info')
  await click('[data-dsh-iui-edit-props-apply]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props-fallback]")', 'legacy fallback note')
  const legacyStructureCalls = await read('window.__structureCalls')
  check(legacyStructureCalls.length, 1, 'the quick-adjust apply reached the structure route')
  check(legacyStructureCalls[0].seq > baseCalls[0].seq, true, 'the base registration precedes the first structure request')
  check((await text('[data-dsh-iui-edit-props-fallback]')).includes('权威程序记录'), true, 'legacy pages explain the missing authoritative program record')
  check((await text('[data-dsh-iui-edit-props-fallback]')).includes('重新渲染'), true, 'the fallback offers the re-render path')
  check(await count('[data-dsh-iui-edit-instruction]'), 1, 'legacy pages fall back to the instruction editor')
  await click('[data-dsh-iui-edit-cancel]')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b2"]')
  await click('[data-dsh-iui-edit-structure-edit]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props]")', 'reopened legacy quick props')
  check(await count('[data-dsh-iui-edit-props-fallback]'), 0, 'reopening clears the previous missing-base fallback')
  await read(`window.__structureMissingCode = 'artifact_missing'`)
  await chooseQuickOption('[data-dsh-iui-edit-prop="color"]', 'info')
  await click('[data-dsh-iui-edit-props-apply]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props-fallback]")', 'missing-artifact fallback note')
  check((await text('[data-dsh-iui-edit-props-fallback]')).includes('找不到这张卡片的记录'), true, 'artifact_missing gets its own explanation')
  await click('[data-dsh-iui-edit-cancel]')
  // A duplicate preview failure now preserves the Host error code: the dialog
  // explains the missing authoritative program instead of a generic failure.
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b2"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-preview-failed]")', 'legacy duplicate preview failed')
  check((await text('[data-dsh-iui-edit-preview-failed]')).includes('权威程序记录'), true, 'the duplicate preview explains the missing authoritative program')
  check((await text('[data-dsh-iui-edit-preview-failed]')).includes('重新渲染'), true, 'the duplicate preview offers the re-render fallback')
  await click('[data-dsh-iui-edit-preview-cancel]')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'legacy editor closed')
  // Old Host without the registration route: the card degrades without blocking,
  // and its duplicate preview still explains the missing base.
  await read(`window.__artifactBaseMode = 404`)
  await read('window.__addPropsCard("props-call-4", "旧 Host 属性样例")')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="props-call-4"]\')', 'old-host props card')
  await click('[data-dsh-iui-call-id="props-call-4"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'old-host editor')
  await wait(`window.__artifactBaseCalls.filter(call => call.artifactId === 'props-call-4').length === 1`, 'old-host card probed the registration route once')
  // F2: every base_missing/artifact_missing answer invalidates the cached base,
  // so the next authoritative operation re-registers. props-call-3 is failed
  // and retried twice (initial open + two retries); the old Host's 404 for
  // props-call-4 is cached as unsupported, so it is probed only once.
  const oldHostBaseCalls = await read('window.__artifactBaseCalls')
  const oldHostStructureCalls = await read('window.__structureCalls')
  const baseCallsFor3 = oldHostBaseCalls.filter(call => call.artifactId === 'props-call-3')
  const baseCallsFor4 = oldHostBaseCalls.filter(call => call.artifactId === 'props-call-4')
  const structureCallsFor3 = oldHostStructureCalls.filter(call => call.artifactId === 'props-call-3')
  check(baseCallsFor3.length, 3, 'the invalidated legacy card re-registers for the initial open and both retries')
  check(baseCallsFor3.map(call => call.status), [200, 200, 200], 'every legacy re-registration succeeds on the current Host')
  check(baseCallsFor4.length, 1, 'the old-host card probes the registration route once')
  check(baseCallsFor4[0].artifactId, 'props-call-4', 'the old-host probe names its card')
  check(baseCallsFor4[0].status, 404, 'the old Host answered the registration route with 404')
  check(structureCallsFor3.length, 3, 'the legacy card retried its authoritative requests after each failure')
  check(baseCallsFor3.every((call, index) => call.seq < structureCallsFor3[index].seq), true, 'each legacy re-registration precedes the authoritative request it enables')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b2"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-preview-failed]")', 'old-host duplicate preview failed')
  check((await text('[data-dsh-iui-edit-preview-failed]')).includes('权威程序记录'), true, 'the old-Host preview still explains the missing base')
  await click('[data-dsh-iui-edit-preview-cancel]')
  const structureCallsFor4 = (await read('window.__structureCalls')).filter(call => call.artifactId === 'props-call-4')
  check(structureCallsFor4.length, 1, 'the old-host card sent its duplicate preview request')
  check(baseCallsFor4[0].seq < structureCallsFor4[0].seq, true, 'the old-host registration precedes its duplicate preview request')
  const baseCallsAfterPreview = await read('window.__artifactBaseCalls')
  check(baseCallsAfterPreview.filter(call => call.artifactId === 'props-call-4').length, 1, 'a failed registration is not re-probed for the same revision')
  await read('window.fetch = window.__savedFetch')
  await read('delete window.__artifactBaseMode')
  await read('delete window.__structureMissingCode')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'old-host editor closed')

  // 37. Real shell width fit at 1180px: wrap main in the shell chat-content
  // element so applyEditChatContentWidth can run, then check panel/content/card.
  await read(`(() => {
    const main = document.querySelector('main');
    const wrap = document.createElement('div');
    wrap.setAttribute('data-conversation-content', '');
    wrap.setAttribute('data-conversation-region', 'chat');
    wrap.style.setProperty('--dsh-chat-content-width', '900px');
    main.parentNode.insertBefore(wrap, main);
    wrap.appendChild(main);
    return true;
  })()`)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 1000, deviceScaleFactor: 1, mobile: false })
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'shell-fit editor')
  await click('[data-dsh-iui-edit-nested]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-nested-row]")', 'shell-fit nested rows')
  await new Promise(resolve => setTimeout(resolve, 750))
  const shellFit = await read(`(() => {
    const content = document.querySelector('[data-conversation-content]');
    const panel = document.querySelector('.dsh-iui-edit-panel');
    const card = document.querySelector('[data-dsh-iui-call-id="nested-call-1"]');
    return {
      contentWidth: parseFloat(content.style.getPropertyValue('--dsh-chat-content-width')),
      panelWidth: panel.getBoundingClientRect().width,
      panelLeft: panel.getBoundingClientRect().left,
      cardRight: card.getBoundingClientRect().right,
      titleWidth: document.querySelector('[data-dsh-iui-edit-nested-row] .dsh-iui-edit-arrangement-title').getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  })()`)
  check(shellFit.contentWidth >= 300 && shellFit.contentWidth <= 500, true, 'real 1180 fit narrows the chat content')
  check(shellFit.panelWidth >= 300, true, 'real 1180 fit docks a usable panel')
  check(shellFit.cardRight <= shellFit.panelLeft - 20, true, 'real 1180 card does not overlap the panel')
  check(shellFit.titleWidth > 20, true, 'real 1180 nested titles remain readable')
  check(shellFit.overflow, false, 'real 1180 shell fit has no horizontal overflow')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'shell-fit editor closed')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  await read(`(() => { const wrap = document.querySelector('[data-conversation-content]'); const main = wrap.querySelector('main'); wrap.replaceWith(main); return true; })()`)
  await read('window.dispatchEvent(new Event("resize"))')

  // 38. Touch/coarse-pointer affordances, last because CDP touch emulation can
  // suppress later mouse hover events in Chrome.
  await read(`document.querySelector('[data-dsh-iui-edit-entry]').click()`)
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'touch editor')
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await new Promise(resolve => setTimeout(resolve, 160))
  check(await read(`matchMedia('(pointer: coarse)').matches`), true, 'touch emulation exposes a coarse pointer')
  check(await read(`Math.round(document.querySelector('[data-dsh-iui-edit-arrangement-row] [data-dsh-iui-edit-row-menu]').getBoundingClientRect().width)`), 24, 'the row menu trigger meets the 24px touch target')
  const touchMenu = await read(`document.querySelector('[data-dsh-iui-edit-arrangement-row] [data-dsh-iui-edit-row-menu]').getBoundingClientRect().toJSON()`)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchMenu.x + touchMenu.width / 2, y: touchMenu.y + touchMenu.height / 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait('!!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'touch tap opens the row menu')
  check(await read(`document.querySelector('[data-dsh-iui-edit-row-menu-panel]').getAttribute('role')`), 'menu', 'the row menu exposes menu semantics')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 2, y: 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait('!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'touch outside closes the row menu')
  const touchTip = await read(`document.querySelector('[data-dsh-iui-info-tip="nested"]').getBoundingClientRect().toJSON()`)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchTip.x + touchTip.width / 2, y: touchTip.y + touchTip.height / 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait('!!document.querySelector("[data-dsh-iui-info-tooltip]")', 'touch tap opens the tooltip')
  check(await count('[data-dsh-iui-info-tooltip]'), 1, 'touch tap opens the info tooltip once')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 2, y: 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait('!document.querySelector("[data-dsh-iui-info-tooltip]")', 'touch outside tap closes the tooltip')
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'touch editor closed')

  // 39. B1 style editing: capability section, focus/Escape/clear, mixed guard,
  // style chip + envelope, mocked style revision card and footer fallbacks.
  // A themed temporary snapshot gives the revision card a real Save action.
  const STYLE_SNAPSHOT = {
    schemaVersion: 1, baseLayout: 'card', directives: 'Cool editorial palette.',
    theme: {
      light: { canvas: '#f5f7fb', ink: '#1c2430', accent: '#3b6fd4' },
      dark: { canvas: '#111820', ink: '#e8eef7', accent: '#7aa7ff' },
      font: 'sans', radius: 'soft', density: 'comfortable', shadow: 'soft',
    },
  }
  await read('window.__project({ styleEdit: true })')
  await click('[data-dsh-iui-call-id="props-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'style editor')
  await wait('!!document.querySelector("[data-dsh-iui-edit-style-section]")', 'style section with the capability')
  const styleCurrent = await text('[data-dsh-iui-edit-style-current]')
  check(styleCurrent.includes('内置'), true, 'style section names the recorded built-in skin')
  check(styleCurrent.includes('卡片'), true, 'style section names the recorded layout')
  check(await read(`document.querySelector('[data-dsh-iui-edit-style-toggle]').getAttribute('aria-expanded')`), 'false', 'style section starts collapsed')
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait(`document.querySelector('[data-dsh-iui-edit-style-toggle]').getAttribute('aria-expanded') === 'true'`, 'style section expands')
  await wait(`document.activeElement === document.querySelector('[data-dsh-iui-edit-style]')`, 'expanded style instruction focused')
  check(await read(`document.querySelector('[data-dsh-iui-edit-style]').maxLength`), 2000, 'style instruction uses the contract char cap')

  // Typing updates the draft; Escape collapses and returns focus to the
  // disclosure button without dropping the text.
  await typeInto('[data-dsh-iui-edit-style]', '换成更冷静的配色，收紧间距。')
  check((await text('[data-dsh-iui-edit-style-note]')).length > 0, true, 'style section explains that applying creates a new revision')
  await read(`document.querySelector('[data-dsh-iui-edit-style]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
  await wait(`document.querySelector('[data-dsh-iui-edit-style-toggle]').getAttribute('aria-expanded') === 'false'`, 'style section collapses on Escape')
  check(await read(`document.activeElement === document.querySelector('[data-dsh-iui-edit-style-toggle]')`), true, 'Escape returns focus to the style disclosure')
  check(await read(`document.querySelector('[data-dsh-iui-edit-style-toggle]').getAttribute('aria-controls') === document.querySelector('[data-dsh-iui-edit-style-panel]')?.id`), false, 'the collapsed panel is unmounted (aria-controls target absent)')

  // Clear drops the instruction, announces on the existing live region, then
  // type it again for the send.
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait(`document.activeElement === document.querySelector('[data-dsh-iui-edit-style]')`, 're-expanded style instruction focused')
  // Earlier checks leave the 3-attachment batch cap full, so this fresh draft
  // started detached. Two older drafts were never sent: sending them frees the
  // batch, then the style draft attaches.
  await read('window.__serializeChipMatching("第二张卡片")')
  await read('window.__serializeChipMatching("属性调整样例 2")')
  const styleAttach = '[data-dsh-iui-call-id="props-call-1"] [data-dsh-iui-draft-attach]'
  await wait(`document.querySelector(${JSON.stringify(styleAttach)})?.disabled === false`, 'style draft can attach')
  await click(styleAttach)
  await wait(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('调整样式'))`, 'style chip label')
  await click('[data-dsh-iui-edit-style-clear]')
  await wait(`document.querySelector('[data-dsh-iui-edit-style]').value === ''`, 'style clear empties the field')
  await wait(`document.querySelector('[data-dsh-iui-edit-live]').textContent.includes('已清除样式调整')`, 'style clear announces on the live region')
  await typeInto('[data-dsh-iui-edit-style]', '换成更冷静的配色，收紧间距。')

  // Mixed content: a saved block instruction shows the inline warning and the
  // send is refused with the section copy.
  await openArrangementEditor('b4')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'mixed block popover')
  await saveInstruction('把说明文字改短')
  await wait('!!document.querySelector("[data-dsh-iui-edit-style-mixed]")', 'style mixed warning')
  check((await text('[data-dsh-iui-edit-style-mixed]')).includes('不能与区块修改同时发送'), true, 'style section explains the mixed-content guard')
  check(await read(`document.querySelector('[data-dsh-iui-edit-style-mixed]').getAttribute('role')`), 'status', 'the mixed warning is non-alert status copy')
  const mixedStyleError = await read('window.__serializeChipMatching("调整样式").then(() => null, error => String(error))')
  check(String(mixedStyleError).includes('不能与区块修改同时发送'), true, 'a mixed style send is blocked with the section copy')
  await click('[data-dsh-iui-edit-clear-all]')
  await wait('!document.querySelector("[data-dsh-iui-edit-style-mixed]")', 'mixed warning clears with block edits')

  // Style-only send: the envelope carries kind/styleInstruction and no block
  // fields; drop the remaining unrelated chip so the send picks the style one.
  await read(`(() => {
    const refs = window.__input().occurrences
      .filter(occurrence => occurrence.source === 'artifact-edit' && !occurrence.label.includes('调整样式'))
      .map(occurrence => occurrence.ref);
    for (const ref of refs) window.__deleteChip(ref);
    return refs.length;
  })()`)
  const styleEnvelope = await read('window.__serializeChip()')
  check(styleEnvelope.includes('"kind":"style"'), true, 'style envelope carries the kind discriminator')
  check(styleEnvelope.includes('"styleInstruction":"换成更冷静的配色，收紧间距。"'), true, 'style envelope carries the style instruction')
  check(styleEnvelope.includes('"edits"'), false, 'style envelope has no block edits')
  check(styleEnvelope.includes('"targetOrder"'), false, 'style envelope has no target order')
  check(styleEnvelope.includes('editRequestId'), true, 'style envelope asks the model for editRequestId')
  const stylePassLine = styleEnvelope.split('\n').find(line => line.startsWith('Pass editRequestId:')) ?? ''
  check(stylePassLine.includes('editRequestId'), true, 'the pass line names editRequestId')
  check(stylePassLine.includes('artifactId'), false, 'the pass line never mentions artifactId (render_ui has no such argument)')
  check(styleEnvelope.includes('COMPLETE temporaryStyle'), true, 'style envelope instructs a complete result-owned temporaryStyle')
  check(styleEnvelope.includes('never pass styleId or artifactId'), true, 'style envelope forbids the saved-template identity arguments')
  check(styleEnvelope.includes('Tool-call contract: pass style: "card"'), true, 'style envelope instructs the recorded style argument')
  check(styleEnvelope.includes('warns when blocks change'), true, 'style envelope tells the model the Host warns about changed blocks')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'style send closes the editor')
  await wait('!!document.querySelector("[data-sent-summary] [data-reference-chip]")', 'style sent summary chip')
  check((await text('[data-sent-summary]')).includes('编辑 Artifact · 调整样式'), true, 'sent chip reports the style request')
  check((await read('window.__input().draft')), '', 'style send clears the composer draft')

  // Mocked Host apply: the model returns the page with the requested skin as
  // revision 2, carrying the themed temporary snapshot.
  await read(`window.__applyBlockEditRevision(${JSON.stringify({
    artifactId: 'props-call-1', revisionId: 'props-style-2', baseRevisionId: 'props-call-1', revision: 2,
    editedBlockIds: [], program: PROPS_PROGRAM_APPLIED, title: '属性调整样例', style: 'card', temporaryStyle: STYLE_SNAPSHOT,
  })}, 'props-style-2')`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="props-style-2"] [data-dsh-iui-revision]\')', 'style revision card')
  check((await text('[data-dsh-iui-call-id="props-style-2"] [data-dsh-iui-revision]')).includes('修订 2'), true, 'style revision card shows its revision number')
  check(await count('[data-dsh-iui-call-id="props-style-2"] [data-dsh-iui-save-result]'), 1, 'style revision card keeps the Save action')
  check(await count('[data-dsh-iui-call-id="props-style-2"] .dsh-iui-result-actions button:not([data-dsh-iui-save-result])'), 0, 'editable + capability hides the legacy adjust action')
  // Save stays a working action on the new style revision card.
  await click('[data-dsh-iui-call-id="props-style-2"] [data-dsh-iui-save-result]')
  await wait(`!!document.querySelector('.dsh-iui-style-popover[role="dialog"]')`, 'save dialog opens from the style revision card')
  check(await read(`document.querySelector('.dsh-iui-style-popover[role="dialog"] input') !== null`), true, 'save dialog offers a template name field')
  await read(`[...document.querySelectorAll('.dsh-iui-style-popover[role="dialog"] button')].find(button => button.textContent === ${JSON.stringify('取消')}).click()`)
  await wait(`!document.querySelector('.dsh-iui-style-popover[role="dialog"]')`, 'save dialog cancels')

  // Capability off: the section disappears and the legacy footer fallback returns.
  await read('window.__project({ styleEdit: false })')
  await click('[data-dsh-iui-call-id="props-style-2"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'legacy style editor')
  check(await count('[data-dsh-iui-edit-style-section]'), 0, 'capability-off hides the style section')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'legacy style editor closed')
  check(await count('[data-dsh-iui-call-id="props-style-2"] .dsh-iui-result-actions button:not([data-dsh-iui-save-result])'), 1, 'capability-off keeps the legacy adjust action')


  // 40. B2 deterministic style switching: durable target picker, zero-POST
  // preview, explicit Apply -> one style revision (no composer envelope),
  // dirty/temporary/failure paths and the B1 regression without the capability.
  await read('window.__project({ styleEdit: true, styleSwitch: true })')
  await read(`(() => {
    window.__styleSwitchCalls = [];
    window.__styleCatalogFetches = [];
    window.__styleSwitchFail = undefined;
    window.__styleSwitchRevisionId = undefined;
    window.__styleSwitchOriginalFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      if (url.includes('/api/intelligent-ui/styles')) window.__styleCatalogFetches.push(url);
      if (url.includes('/api/intelligent-ui/artifact-structure')) {
        const body = JSON.parse(init.body);
        window.__styleSwitchCalls.push(body);
        if (window.__styleSwitchFail !== undefined) {
          const fail = window.__styleSwitchFail;
          return Promise.resolve(new Response(JSON.stringify({ error: { code: fail.code, message: 'host failure' } }), { status: fail.status, headers: { 'content-type': 'application/json' } }));
        }
        const target = body.targetStyle;
        const result = {
          artifactId: body.artifactId,
          revisionId: window.__styleSwitchRevisionId ?? 'style-switch-rev-2',
          baseRevisionId: body.baseRevisionId,
          revision: 2,
          operationId: body.operationId,
          program: ${JSON.stringify(ARTICLE_PROGRAM)},
          title: '样式切换卡片',
          style: target.kind === 'builtin' ? target.layout : 'card',
          ...target.kind === 'template' ? { styleId: target.styleId } : {},
        };
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), { status: 201, headers: { 'content-type': 'application/json' } }));
      }
      return window.__styleSwitchOriginalFetch(input, init);
    };
    return true;
  })()`)
  await read(`window.__addCard("style-switch-call-1", "样式切换卡片", ${JSON.stringify(ARTICLE_PROGRAM)})`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="style-switch-call-1"]\')', 'style switch card')
  check(await count('[data-dsh-iui-call-id="style-switch-call-1"] [data-dsh-iui-save-result]'), 0, 'a built-in style result offers no Save entry')
  await click('[data-dsh-iui-call-id="style-switch-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'style switch editor')
  await wait('!!document.querySelector("[data-dsh-iui-edit-style-toggle]")', 'style switch section')
  check((await text('[data-dsh-iui-edit-style-current]')).includes('内置'), true, 'current style row keeps the built-in skin identity')
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-style-switch]")', 'style switch group with capability')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-edit-style-target') === true`, 'switch expansion focuses a radio')
  check(await read(`document.activeElement.getAttribute('data-target-layout')`), 'card', 'the first built-in radio receives focus by default')
  check(await count('[data-dsh-iui-edit-style-target]'), 6, 'two built-ins and four visible saved templates are offered')
  check(await count('[data-dsh-iui-edit-style-current-badge]'), 1, 'the current built-in style carries the current badge')
  check(await read(`getComputedStyle(document.querySelector('.dsh-iui-edit-style-radio')).width`), '16px', 'the style radio is 16px')
  check(await read(`getComputedStyle(document.querySelector('.dsh-iui-edit-style-radio')).borderRadius`), '999px', 'the style radio is a true circle')
  check(await read(`getComputedStyle(document.querySelector('.dsh-iui-edit-style-swatch')).borderRadius`), '0px', 'the style swatch keeps square corners')
  check(await read(`getComputedStyle(document.querySelector('.dsh-iui-edit-style-swatch')).backgroundOrigin`), 'border-box', 'the swatch gradient fills its border box')
  check((await text('[data-dsh-iui-edit-style-saved-group]')), '已保存样式', 'saved templates sit in their own group')
  check(await read(`document.querySelector('[data-dsh-iui-edit-style-apply]').disabled`), true, 'Apply stays disabled until a target is selected')
  check((await text('[data-dsh-iui-edit-style-status]')).includes('选择一个样式目标'), true, 'the single status line asks for a target')

  // Preview on focus swaps the edit-canvas skin with no request at all.
  const editRootStyle = () => read(`(() => {
    const card = document.querySelector('[data-dsh-iui-call-id="style-switch-call-1"]');
    const wrapper = card.querySelector('[data-dsh-iui-edit-view]')?.parentElement;
    const root = card.querySelector('[data-dsh-iui-edit-view] .dsh-iui-root');
    return { article: wrapper?.classList.contains('dsh-iui-article') === true, accent: root?.style.getPropertyValue('--iui-chart-1') ?? '' };
  })()`)
  check((await editRootStyle()).article, false, 'the edit canvas starts in the recorded card layout')
  await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-style-id="cs_field02"]').focus()`)
  await wait(`document.querySelector('[data-dsh-iui-call-id="style-switch-call-1"] [data-dsh-iui-edit-view]')?.parentElement?.classList.contains('dsh-iui-article') === true`, 'article preview wrapper')
  // The themed accent follows the active light/dark scheme.
  await wait(`['#237744', '#66cc99'].includes(document.querySelector('[data-dsh-iui-call-id="style-switch-call-1"] [data-dsh-iui-edit-view] .dsh-iui-root')?.style.getPropertyValue('--iui-chart-1'))`, 'template preview theme vars')
  check(['#237744', '#66cc99'].includes((await editRootStyle()).accent), true, 'a focused saved template previews its own accent')
  check(await read('window.__styleSwitchCalls.length'), 0, 'previewing never posts a structure request')

  // Selecting a target arms Apply; Escape collapses and returns focus.
  await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-style-id="cs_field02"]').click()`)
  await wait(`document.querySelector('[data-dsh-iui-edit-style-apply]').disabled === false`, 'Apply armed after selecting a target')
  check(await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-style-id="cs_field02"]').checked`), true, 'the selected radio is checked')
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await wait(`document.querySelector('[data-dsh-iui-edit-style-toggle]').getAttribute('aria-expanded') === 'false'`, 'Escape collapses the style section')
  check(await read(`document.activeElement === document.querySelector('[data-dsh-iui-edit-style-toggle]')`), true, 'Escape returns focus to the disclosure button')

  // Reopen, switch to a saved card template and apply: exactly one empty-operation POST.
  // (Article targets on this DST program are rejected by the real Host's article predicate, so the E2E applies a reachable card template.)
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait(`document.activeElement?.getAttribute('data-target-style-id') === 'cs_field02'`, 'the checked radio regains focus')
  await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-style-id="cs_ocean01"]').click()`)
  await wait(`document.querySelector('[data-dsh-iui-edit-style-apply]').disabled === false`, 'Apply armed for the saved card template')
  check(await read('window.__styleSwitchCalls.length'), 0, 'arming Apply never posts')
  const chipCountBeforeSwitch = await count('[data-chip="artifact-edit"]')
  const draftBeforeSwitch = await read('window.__input().draft')
  await click('[data-dsh-iui-edit-style-apply]')
  await wait('window.__styleSwitchCalls.length === 1', 'one switch request')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'switch closes the editor')
  const switchBody = await read('window.__styleSwitchCalls[0]')
  check(switchBody.operations, [], 'the switch posts an empty operation list')
  check(switchBody.targetStyle, { kind: 'template', styleId: 'cs_ocean01' }, 'the switch posts the reachable saved template target')
  check(switchBody.sessionStyleScope, 'e2e-session', 'the switch posts the chat scope for session templates')
  check(switchBody.baseRevisionId, 'style-switch-call-1', 'the switch names the base revision')
  check(switchBody.style, 'card', 'the switch carries the base style identity claim')
  check(typeof switchBody.operationId === 'string' && /^req_/.test(switchBody.operationId), true, 'the switch carries a fresh operation id')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="style-switch-rev-2"]\')', 'style revision card')
  check((await text('[data-dsh-iui-call-id="style-switch-rev-2"] [data-dsh-iui-local-revision]')), '样式修订', 'the local card is labelled as a style revision')
  check((await text('[data-dsh-iui-call-id="style-switch-rev-2"]')).includes('Intro'), true, 'the switch revision keeps the base program')
  check(await count('[data-dsh-iui-call-id="style-switch-rev-2"] [data-dsh-iui-save-result]'), 0, 'a saved-template switch result offers no Save entry')
  check(await read(`document.querySelector('[data-dsh-iui-call-id="style-switch-rev-2"]').getAttribute('data-dsh-iui-style')`), 'card', 'the style revision card keeps the reachable saved template layout')
  check(await count('[data-chip="artifact-edit"]'), chipCountBeforeSwitch, 'a style switch never creates a composer chip')
  check((await read('window.__input().draft')), draftBeforeSwitch, 'a style switch never writes the composer draft')

  // A valid Article target applies when the article program satisfies the predicate.
  await read(`window.__styleSwitchRevisionId = 'style-switch-rev-3'`)
  await click('[data-dsh-iui-call-id="style-switch-rev-2"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'article switch editor')
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-style-switch]")', 'article switch group')
  await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-layout="article"][data-target-kind="builtin"]').click()`)
  await wait(`document.querySelector('[data-dsh-iui-edit-style-apply]').disabled === false`, 'article target arms Apply')
  const callsBeforeArticle = await read('window.__styleSwitchCalls.length')
  await click('[data-dsh-iui-edit-style-apply]')
  await wait(`window.__styleSwitchCalls.length === ${callsBeforeArticle + 1}`, 'article switch request')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="style-switch-rev-3"]\')', 'article style revision')
  check(await read(`document.querySelector('[data-dsh-iui-call-id="style-switch-rev-3"]').getAttribute('data-dsh-iui-style')`), 'article', 'the article switch records the article layout')
  check((await text('[data-dsh-iui-call-id="style-switch-rev-3"]')).includes('Intro'), true, 'the article switch keeps the article program')

  // Dirty block content refuses the switch with inline copy and zero POSTs.
  await click('[data-dsh-iui-call-id="style-switch-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'dirty switch editor')
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-style-switch]")', 'dirty switch group')
  await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-style-id="cs_ocean01"]').click()`)
  await openArrangementEditor('b2')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'dirty block popover')
  await saveInstruction('把时钟换成数字读数')
  const postsBeforeDirtyApply = await read('window.__styleSwitchCalls.length')
  check(await read('document.querySelector("[data-dsh-iui-edit-style-apply]").disabled'), true, 'a dirty draft disables Apply before any click')
  check((await text('[data-dsh-iui-edit-style-status]')).includes('先发送或清除'), true, 'the status line explains the block-change guard')
  check(await read('window.__styleSwitchCalls.length'), postsBeforeDirtyApply, 'a dirty draft never posts the switch')
  await click('[data-dsh-iui-edit-clear-all]')

  // A temporary-style base has no current row; applying drops the temporary badge.
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'dirty switch editor closed')
  await read(`window.__styleSwitchRevisionId = 'style-switch-temp-rev-2'`)
  await read('window.__addTempCard("style-switch-temp-call", "样式切换临时卡片")')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="style-switch-temp-call"]\')', 'temporary switch card')
  check(await count('[data-dsh-iui-call-id="style-switch-temp-call"] [data-dsh-iui-save-result]'), 0, 'a theme-less temporary style offers no Save entry')
  await click('[data-dsh-iui-call-id="style-switch-temp-call"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'temporary switch editor')
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-style-switch]")', 'temporary switch group')
  check(await count('[data-dsh-iui-edit-style-current-badge]'), 0, 'a temporary base never matches a durable current style')
  await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-style-id="cs_ocean01"]').click()`)
  check((await text('[data-dsh-iui-edit-style-status]')).includes('临时样式'), true, 'the status explains that the switch replaces the temporary skin')
  await click('[data-dsh-iui-edit-style-apply]')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="style-switch-temp-rev-2"]\')', 'temporary switch revision card')
  check(await count('[data-dsh-iui-call-id="style-switch-temp-rev-2"] .dsh-iui-temporary-badge'), 0, 'the switch revision drops the temporary badge')
  check(await count('[data-dsh-iui-call-id="style-switch-temp-call"] .dsh-iui-temporary-badge'), 1, 'the original temporary card keeps its badge')

  // Opening the section on a template/Article base must not preview the first
  // (built-in Card) radio: the recorded canvas stays until the user interacts.
  await read(`window.__applyBlockEditRevision(${JSON.stringify({
    artifactId: 'style-article-call', revisionId: 'style-article-rev', baseRevisionId: 'style-article-call', revision: 2,
    editedBlockIds: ['b2'], program: ARTICLE_PROGRAM, title: '文章底版卡片', style: 'article',
  })}, 'style-article-call')`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="style-article-call"]\')', 'article base card')
  check(await read(`document.querySelector('[data-dsh-iui-call-id="style-article-call"]').getAttribute('data-dsh-iui-style')`), 'article', 'the article-base card records the article layout')
  await click('[data-dsh-iui-call-id="style-article-call"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'article base editor')
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait(`document.activeElement?.getAttribute('data-target-layout') === 'article'`, 'the current article radio receives the open focus')
  await wait(`document.querySelector('[data-dsh-iui-call-id="style-article-call"] [data-dsh-iui-edit-view]')?.parentElement?.classList.contains('dsh-iui-article') === true`, 'the article canvas stays during the open focus')
  check(await read(`document.querySelector('[data-dsh-iui-call-id="style-article-call"] [data-dsh-iui-edit-view] .dsh-iui-root')?.style.getPropertyValue('--iui-chart-1')`), '', 'the open focus does not apply a template preview')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'article base editor closed')

  await read(`window.__applyBlockEditRevision(${JSON.stringify({
    artifactId: 'style-template-call', revisionId: 'style-template-rev', baseRevisionId: 'style-template-call', revision: 2,
    editedBlockIds: ['b3'], program: DST_PROGRAM, title: '模板底版卡片', style: 'card', styleId: 'cs_ocean01',
  })}, 'style-template-call')`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="style-template-call"]\')', 'template base card')
  await click('[data-dsh-iui-call-id="style-template-call"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'template base editor')
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait(`document.activeElement?.getAttribute('data-target-kind') === 'template'`, 'the current saved-template radio receives the open focus')
  check(['#3366cc', '#66aaff'].includes(await read(`document.querySelector('[data-dsh-iui-call-id="style-template-call"] [data-dsh-iui-edit-view] .dsh-iui-root')?.style.getPropertyValue('--iui-chart-1')`)), true, 'the open focus keeps the recorded template theme')
  check(await read(`document.querySelector('[data-dsh-iui-call-id="style-template-call"] [data-dsh-iui-edit-view]')?.parentElement?.classList.contains('dsh-iui-article')`), false, 'the open focus keeps the recorded layout')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'template base editor closed')

  // Article targets are disabled client-side; the mocked Host failures cover
  // style_missing (catalog refresh) and the 409 identity-mismatch copy.
  await read(`window.__styleSwitchRevisionId = undefined`)
  await read(`window.__addCard("style-switch-fail-call", "样式切换失败卡片", ${JSON.stringify(DST_PROGRAM)})`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="style-switch-fail-call"]\')', 'switch failure card')
  await click('[data-dsh-iui-call-id="style-switch-fail-call"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'switch failure editor')
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-style-switch]")', 'failure switch group')
  check(await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-layout="article"][data-target-kind="builtin"]').disabled`), true, 'Article is disabled before selection when the program cannot be an article')
  check((await text('[data-dsh-iui-edit-style-article-note]')).includes('目录和章节'), true, 'one note explains why Article targets are disabled')
  await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-style-id="cs_ocean01"]').click()`)
  const catalogFetchesBefore = await read('window.__styleCatalogFetches.length')
  await read(`window.__styleSwitchFail = { code: 'style_missing', status: 404 }`)
  await click('[data-dsh-iui-edit-style-apply]')
  await wait(`document.querySelector('[data-dsh-iui-edit-style-switch-error]')?.textContent.includes('已不存在') === true`, 'style missing copy')
  await wait(`window.__styleCatalogFetches.length > ${catalogFetchesBefore}`, 'style_missing refreshes the catalog')
  check(await read('window.__styleCatalogFetches.length > 0'), true, 'a missing style retriggers the visible style catalog load')
  // The vanished target is cleared after the refresh: Apply is not repeatable.
  check(await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-style-id="cs_ocean01"]').checked`), false, 'style_missing clears the vanished selection')
  check(await read(`document.querySelector('[data-dsh-iui-edit-style-apply]').disabled`), true, 'Apply waits for a new selection after style_missing')
  await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-style-id="cs_ocean01"]').click()`)
  await wait(`document.querySelector('[data-dsh-iui-edit-style-apply]').disabled === false`, 'reselecting re-arms Apply')

  // A pending natural-language style instruction disables the deterministic
  // Apply with an accessible reason instead of failing after the click.
  await typeInto('[data-dsh-iui-edit-style]', '换成更冷静的配色')
  await wait(`document.querySelector('[data-dsh-iui-edit-style-apply]').disabled === true`, 'a pending NL style instruction disables Apply')
  check((await text('[data-dsh-iui-edit-style-status]')).includes('样式说明'), true, 'the status line explains the pending style instruction')
  check((await text('[data-dsh-iui-edit-style-pending-note]')).includes('样式说明待发送'), true, 'the collapsed style row flags the pending style description')
  check((await text('[data-dsh-iui-edit-summary-style]')).includes('样式说明'), true, 'the send summary lists the style description')
  check((await read(`document.querySelector('[data-dsh-iui-edit-style-apply]').getAttribute('aria-describedby') ?? ''`)).length > 0, true, 'the Apply button names the blocked reason')
  await typeInto('[data-dsh-iui-edit-style]', '')
  await wait(`document.querySelector('[data-dsh-iui-edit-style-apply]').disabled === false`, 'clearing the NL instruction re-arms Apply')
  check(await count('[data-dsh-iui-edit-style-pending-note]'), 0, 'clearing the instruction removes the row flag')
  check(await count('[data-dsh-iui-edit-summary-style]'), 0, 'clearing the instruction removes the summary row')

  await read(`window.__styleSwitchFail = { code: 'base_style_mismatch', status: 409 }`)
  await click('[data-dsh-iui-edit-style-apply]')
  await wait(`document.querySelector('[data-dsh-iui-edit-style-switch-error]')?.textContent.includes('不一致') === true`, 'stale identity copy')
  check(await read(`document.querySelector('[data-dsh-iui-edit-style-target][data-target-style-id="cs_ocean01"]').checked`), true, 'a failed switch keeps the selection for retry')
  await read('window.__styleSwitchFail = undefined')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'failure editor closed')

  // Keyboard radios, forced colors, and the B1 regression without the switch bit.
  await read(`window.__styleSwitchRevisionId = 'style-switch-rev-3'`)
  await click('[data-dsh-iui-call-id="style-switch-fail-call"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'keyboard switch editor')
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-edit-style-target') === true`, 'keyboard radio focus')
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await wait(`document.activeElement?.getAttribute('data-target-style-id') === 'cs_ocean01'`, 'arrow keys skip the disabled Article and move to the next saved target')
  check(await read(`document.activeElement.getAttribute('data-target-kind')`), 'template', 'native radios keep one tab stop and arrow navigation')
  await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'forced-colors', value: 'active' }] })
  await wait(`matchMedia('(forced-colors: active)').matches`, 'forced colors emulation')
  check(await read(`getComputedStyle(document.querySelector('[data-dsh-iui-edit-style-target]:checked').closest('.dsh-iui-edit-style-target')).outlineStyle`), 'solid', 'forced colors keeps a visible checked-row outline')
  check(await read(`getComputedStyle(document.activeElement.closest('.dsh-iui-edit-style-target')).outlineStyle`), 'solid', 'forced colors keeps a visible keyboard focus ring')
  check(await read(`getComputedStyle(document.activeElement.closest('.dsh-iui-edit-style-target')).outlineWidth`), '2px', 'forced colors focus ring is the 2px rule, not the checked-row outline')
  await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'forced-colors', value: 'none' }] })
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'keyboard switch editor closed')

  // Without the switch bit the B1 natural-language field keeps the whole section.
  await read('window.__project({ styleEdit: true, styleSwitch: false })')
  await click('[data-dsh-iui-call-id="style-switch-fail-call"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'nl regression editor')
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-style]")', 'nl regression field')
  check(await count('[data-dsh-iui-edit-style-switch]'), 0, 'without the switch bit no picker is rendered')
  await wait(`document.activeElement === document.querySelector('[data-dsh-iui-edit-style]')`, 'NL field focused without the switch bit')
  check(await read(`document.activeElement === document.querySelector('[data-dsh-iui-edit-style]')`), true, 'without the switch bit expansion focuses the NL textarea')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'nl regression editor closed')
  await read('window.fetch = window.__styleSwitchOriginalFetch')
  await read('delete window.__styleSwitchFail; delete window.__styleSwitchRevisionId; delete window.__styleSwitchCalls; delete window.__styleCatalogFetches; delete window.__styleSwitchOriginalFetch')
  await read('window.__project({ styleEdit: false, styleSwitch: false })')

  console.log(`artifact-edit e2e: ${checks} checks passed`)
} finally {
  try { cdp?.close() } catch { /* already closed */ }
  await browser?.cleanup()
  server?.close()
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
