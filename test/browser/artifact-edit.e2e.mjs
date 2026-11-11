#!/usr/bin/env node
/**
 * Browser check for Artifact block arrangement and editing.
 *
 * Covers the structure list, conditional request list, per-block popovers,
 * keyboard and pointer reordering, root and nested batch selection/toolbar/
 * per-parent order and batch duplicate preview + apply (including the unsent-
 * draft warning), reset order, the combined order + edit envelope,
 * Host-normalized revision replay, hover request cards, composer chip label
 * shapes and the narrow/light-dark chrome. No real model is called.
 *
 *   node test/browser/artifact-edit.e2e.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'
import { DST_PROGRAM, DST_TITLE } from './fixtures/dst-artifact.ts'
import { NESTED_PROGRAM } from './fixtures/nested-artifact.ts'
import { DEEP_DASHBOARD_PROGRAM, DEEP_DASHBOARD_TITLE, VERY_DEEP_PROGRAM, VERY_DEEP_TITLE } from './fixtures/deep-artifact.ts'
import { PROPS_LEGACY_AUTO_TITLE, PROPS_PROGRAM, PROPS_PROGRAM_APPLIED } from './fixtures/props-artifact.ts'
import { extractArtifactBlocks, reorderProgramToTargetOrder } from '../../src/shared/artifact-blocks.ts'
import { applyStructureBatch } from '../../src/host/artifact-structure.ts'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-artifact-edit-e2e-'))
const structureBridge = await startStructureBridge()
let server, browser, cdp
let checks = 0
const check = (value, expected, message) => { assert.deepEqual(value, expected, message); checks += 1 }

/** Edited revision returned by the model: digital clock block + first-year column. */
const DIGITAL_PROGRAM = DST_PROGRAM
  .replace(/^clockCard = .*$/m, 'clockCard = Card([Title("同一时刻，两个读数", "sm"), Text("选一个状态，看同一时刻的数字时间。", "sm", "muted"), SegmentedControl($clock, ["冬令时", "夏令时"], true), Col([Title($clock == "夏令时" ? "08:00" : "07:00", "2xl"), Text("2026-11-04", "sm", "muted")], 1)])')
  .replace(/^rulesTable = .*$/m, 'rulesTable = Table(["地区", "首次实施年份", "切换规则", "状态"], [["欧盟", "1980", "3 月最后一个周日 → 10 月最后一个周日", "实行"], ["中国", "1986", "1986–1991 年实行，1992 年起取消", "不实行"]])')
const ARTICLE_PROGRAM = 'root = Col([toc, section])\ntoc = Toc(["Intro"])\nsection = Section("Intro", [Markdown("Body.")])'

/**
 * Local bridge that answers the mocked structure route with the real Host batch
 * engine (`applyStructureBatch`), so the preview program and the applied program
 * are byte-identical to what the Host would produce for the posted operations.
 * The page mocks POST the draft base program plus the wire operations here.
 * @returns the bridge URL and its close hook.
 */
async function startStructureBridge() {
  const server = createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'content-type')
    response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    try {
      const { program, operations } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(applyStructureBatch(program, operations)))
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: false, message: String(error) }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() }
}

/**
 * Page-side structure-route mock whose preview and apply answers come from the
 * real batch engine, so the client-side remap validation runs against exactly
 * the structure the Host would return. Request bodies are still recorded on the
 * named window array for the existing call-count assertions.
 * @param bridgeUrl - Node bridge URL from `startStructureBridge`.
 * @param options - call log name, optional chained fetch name, base program and
 *   the revision identity the fake Host records.
 * @returns a script string for `read(...)`.
 */
function structureMockScript(bridgeUrl, options) {
  const { calls, chain, program, artifactId, title, revisionId, revision = '2' } = options
  const capture = chain === undefined
    ? 'const original = window.fetch.bind(window);'
    : `window.${chain} = window.fetch;\n    const original = window.${chain};`
  return `(() => {
    window.${calls} = [];
    ${capture}
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      if (url.includes('/api/intelligent-ui/artifact-structure')) {
        const body = JSON.parse(init.body);
        window.${calls}.push(body);
        return window.__nativeFetch(${JSON.stringify(bridgeUrl)}, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ program: ${JSON.stringify(program)}, operations: body.operations }),
        }).then(async response => {
          const applied = await response.json();
          if (applied.ok !== true) {
            return new Response(JSON.stringify({ error: { code: 'operation_conflict', message: applied.message ?? 'structure batch failed' } }), { status: 400, headers: { 'content-type': 'application/json' } });
          }
          if (body.preview === true) {
            return new Response(JSON.stringify({ ok: true, preview: { program: applied.program, operations: body.operations, changedBlockIds: applied.affectedRootBlockIds, touched: applied.touched } }), { status: 200, headers: { 'content-type': 'application/json' } });
          }
          const seq = (window.__mockStructureApplySeq = (window.__mockStructureApplySeq ?? 0) + 1);
          return new Response(JSON.stringify({ ok: true, result: {
            artifactId: ${JSON.stringify(artifactId)},
            revisionId: ${JSON.stringify(revisionId)} + '_' + seq,
            baseRevisionId: body.baseRevisionId,
            revision: ${revision},
            operationId: body.operationId,
            program: applied.program,
            title: ${JSON.stringify(title)},
            style: 'card',
          } }), { status: 201, headers: { 'content-type': 'application/json' } });
        });
      }
      return original(input, init);
    };
    return true;
  })()`
}

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
    // A panel that is closing after a previous action can swallow the toggle
    // click. Close any open panel first (Escape), then open this row's menu with
    // a short retry so the helper never races the React commit.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (await count('[data-dsh-iui-edit-row-menu-panel]')) {
        await read(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
        try { await wait('!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'previous row menu closed', { timeout: 1000 }) } catch { /* retry */ }
        continue
      }
      await click(`${selector} [data-dsh-iui-edit-row-menu]`)
      try {
        await wait('!!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'row action menu', { timeout: 1000 })
        return
      } catch { /* retry the toggle */ }
    }
    await wait('!!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'row action menu')
  }
  const applyPreviewOpen = async (label = 'total apply preview') => {
    await click('[data-dsh-iui-edit-apply]')
    await wait('!!document.querySelector("[data-dsh-iui-edit-apply-preview]")', label)
    // A structure dry-run goes through the real Host batch engine in the mock, so
    // the dialog settles asynchronously; wait for its final state before reading
    // operations/conflicts.
    await wait(`document.querySelector('[data-dsh-iui-edit-apply-preview]')?.getAttribute('data-status') !== 'loading'`, `${label} settled`)
  }
  const applyPreviewConfirm = async () => {
    await wait('!!document.querySelector("[data-dsh-iui-edit-apply-preview-confirm]")', 'apply preview confirm')
    await click('[data-dsh-iui-edit-apply-preview-confirm]')
  }
  const applyPreviewCancel = async () => {
    await click('[data-dsh-iui-edit-apply-preview-cancel]')
    await wait('!document.querySelector("[data-dsh-iui-edit-apply-preview]")', 'apply preview closed')
  }
  const pendingOpLabels = () => read(`[...document.querySelectorAll('[data-dsh-iui-edit-pending-op]')].map(row => row.textContent.trim())`)
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
  const orbitGeometry = `(() => { const input = document.querySelector('[data-dsh-iui-edit-global]'); const orbit = document.querySelector('[data-dsh-iui-input-orbit]'); const a = input.getBoundingClientRect(); const b = orbit.getBoundingClientRect(); return Math.abs(a.left - b.left - 5) < 1 && Math.abs(a.top - b.top - 5) < 1; })()`
  // The measured orbit position can trail one layout frame after focus; wait
  // for the settled geometry instead of failing the whole suite on that frame.
  await wait(orbitGeometry, 'orbit sits five pixels outside the field')
  // The 320ms panel width animation can still be settling when the expression
  // first matches; sample again after it finishes so the assertion is stable.
  await new Promise(resolve => setTimeout(resolve, 400))
  check(await read(orbitGeometry), true, 'the orbit sits five pixels outside the field')
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
  check((await text('[data-dsh-iui-edit-global-state]')).includes('未保存'), true, 'typing the global instruction marks it unsaved')
  check((await text('[data-dsh-iui-edit-send-info]')).includes('未保存'), true, 'the summary waits for the explicit save')
  await click('[data-dsh-iui-edit-global-save]')
  await wait(`document.querySelector('[data-dsh-iui-edit-global-state]').getAttribute('data-state') === 'saved'`, 'global instruction saved')
  check((await text('[data-dsh-iui-edit-global-state]')).includes('已保存'), true, 'saving the global instruction flips its state')
  check((await text('[data-dsh-iui-edit-send-info]')).includes('已填写'), true, 'summary reports the saved global instruction')
  await wait(`document.querySelector('[data-chip="artifact-edit"]')?.getAttribute('data-chip-label')?.includes('整体说明') === true`, 'chip reports the global instruction')

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
  check(await count('[data-dsh-iui-revision]'), 0, 'no standalone revision badge remains')
  check(await count('[data-dsh-iui-history-count]'), 1, 'revision count on the edited card')
  check(await text('[data-dsh-iui-history-count]'), '2', 'revision number')
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
  const dockConflictText = await text('[data-dsh-iui-edit-draft-switcher]')
  check(dockConflictText.includes('旧版本冲突'), true, 'the draft dock conflict tag uses the short badge copy')
  check(dockConflictText.includes('{n}'), false, 'the draft dock conflict tag has no unformatted placeholder')
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
  const badgesBefore = await count('[data-dsh-iui-history-count]')
  await read(`window.__applyBlockEditRevision(${JSON.stringify({ artifactId: 'dst-call-1', revisionId: 'dst-call-2', baseRevisionId: 'dst-call-1', revision: 2, requestId: envelopeMap['dst-call-1'], editedBlockIds: ['b3'], program: DIGITAL_PROGRAM, title: '夏令时与冬令时' })}, 'dst-call-2')`)
  await read(`window.__applyBlockEditRevision(${JSON.stringify({ artifactId: 'dst-call-9', revisionId: 'dst-call-10', baseRevisionId: 'dst-call-9', revision: 2, requestId: envelopeMap['dst-call-9'], editedBlockIds: ['b5'], program: DST_PROGRAM, title: '第二张卡片' })}, 'dst-call-10')`)
  await wait(`document.querySelectorAll('[data-dsh-intelligent-ui="card"]').length === ${cardsBefore + 3}`, 'two revision cards')
  check(await count('[data-dsh-iui-history-count]'), badgesBefore + 2, 'two new revision counts')
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

  // 20. Per-artifact revision history dialog from the single history icon.
  await click('[data-dsh-iui-call-id="dst-call-2"] [data-dsh-iui-history-open][data-history-trigger="icon"]')
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
  // The restore revision is based on dst-call-2, so the Host marks it
  // referenced and the client hides Delete; scenario 41 covers deleting a
  // rendered revision through the real rollback flow.
  check(await count('[data-dsh-iui-history-revision="dst-call-2"] [data-dsh-iui-history-delete]'), 0, 'a revision used as another revision base hides Delete')
  check(await count('[data-dsh-iui-history-revision="dst-call-2"] [data-dsh-iui-history-referenced-lock]'), 1, 'the referenced row explains why Delete is unavailable')
  check(await count('[data-dsh-iui-history-revision="dst-call-1"] [data-dsh-iui-history-delete]'), 0, 'the initial revision has no delete action')
  // Deletion: delete the current local restore revision (not referenced by any
  // newer one); its local card is removed together with the history row.
  await click('[data-dsh-iui-history-revision="restore_local1"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'delete confirmation')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-history-delete-cancel') === true`, 'delete confirmation focuses Cancel')
  check(await read(`document.querySelector('[data-dsh-iui-history-delete-warning]').getAttribute('role')`), 'status', 'delete warning is announced')
  await click('[data-dsh-iui-history-revision="restore_local1"] [data-dsh-iui-history-delete-cancel]')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-history-delete') === true`, 'cancelling returns focus to Delete')
  await click('[data-dsh-iui-history-revision="restore_local1"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'delete confirmation again')
  // Simulate a lost delete response: the Host has already removed it, so the
  // retry answers revision_missing and the UI must converge, not stay stale.
  await read('window.__deleteMissing = true')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait('!document.querySelector(\'[data-dsh-iui-history-revision="restore_local1"]\')', 'deleted history row')
  check(await count('[data-dsh-iui-local-revision]'), 0, 'deleting a history revision removes its local card')
  check(await read(`(JSON.parse(localStorage.getItem('dsh-intelligent-ui-revision-fallbacks:v1:e2e-session') ?? '[]')).some(item => item.deletedRevisionId === 'restore_local1')`), false, 'deleting a local-card revision records no rollback fallback')
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

  // 25. Deterministic structure operation: the row menu queues a duplicate and
  // the total Apply preview turns it into one local revision card.
  await read(structureMockScript(structureBridge.url, {
    calls: '__structureCalls', program: NESTED_PROGRAM,
    artifactId: 'nested-call-1', title: '嵌套区块样例', revisionId: 'struct_e2e_duplicate',
  }))
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'structure editor')
  await rowMenu('[data-dsh-iui-edit-arrangement-row]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  // Queueing is local: no Host request, no dialog and no editor close.
  await wait('document.querySelectorAll("[data-dsh-iui-edit-pending-op]").length === 1', 'queued duplicate row')
  check((await pendingOpLabels())[0].includes('复制'), true, 'the queued row names the operation and its block')
  check((await read('window.__structureCalls')).length, 0, 'queueing a structure operation sends no Host request')
  check(await read('!!document.querySelector("[data-dsh-iui-edit-view]")'), true, 'queueing keeps the editor open')
  await wait(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('结构操作 1 项'))`, 'chip queue summary')
  check(await read(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('结构操作 1 项'))`), true, 'the composer chip reports the queued structure operation')
  await wait(`document.querySelector('[data-dsh-iui-edit-draft-switcher]')?.textContent?.includes('结构操作 1 项') === true`, 'draft dock queue summary')
  check((await text('[data-dsh-iui-edit-draft-switcher]')).includes('结构操作 1 项'), true, 'the draft dock reports the queued structure operation')
  await applyPreviewOpen()
  check(await read(`document.querySelector('[data-dsh-iui-edit-apply-preview]').getAttribute('role')`), 'dialog', 'the total Apply preview is a dialog')
  check(await read(`document.querySelector('[data-dsh-iui-edit-apply-preview]').getAttribute('aria-modal')`), 'true', 'the total Apply preview is modal')
  await wait(`document.activeElement?.getAttribute('data-dsh-iui-edit-apply-preview-cancel') !== null`, 'apply preview initial focus')
  check(await read(`document.activeElement?.getAttribute('data-dsh-iui-edit-apply-preview-cancel') !== null`), true, 'initial focus is on cancel')
  check(await count('[data-dsh-iui-edit-apply-op]'), 1, 'the preview lists the queued operation')
  check(await count('[data-dsh-iui-edit-apply-diff] [data-diff="add"]') > 0, true, 'the preview shows added diff rows')
  check((await text('[data-dsh-iui-edit-apply-preview-confirm]')), '应用', 'a pure structure Apply keeps the short confirm label')
  await shot('harness-apply-preview.png')
  await applyPreviewConfirm()
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
  check(await read('!!document.querySelector("[data-dsh-iui-edit-view]")'), false, 'editor closes after a pure structural revision')

  // 25b. Batch arrangement mode: selection controls, toolbar order ops, and a
  // panel-local structure draft that only "保存批量操作" turns into queue items.
  await read(structureMockScript(structureBridge.url, {
    calls: '__batchStructureCalls', chain: '__batchPreviousFetch', program: NESTED_PROGRAM,
    artifactId: 'nested-call-1', title: '嵌套区块样例', revisionId: 'struct_e2e_batch',
  }))
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

  // Selecting a row and batch-duplicating keeps the op in the panel draft.
  await click(`${arrangementSelector('b1')} [data-dsh-iui-edit-batch-check]`)
  await wait(`document.querySelector('${arrangementSelector('b1')}').getAttribute('data-batch-selected') === 'true'`, 'batch draft selection')
  await click('[data-dsh-iui-edit-batch-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-batch-pending-item]').length === 1`, 'batch draft pending row')
  check((await text('[data-dsh-iui-edit-batch-pending]')).includes('待保存结构操作 1 项'), true, 'the batch draft counts the unsaved operation')
  check((await text('[data-dsh-iui-edit-batch-pending]')).includes('复制'), true, 'the batch draft names the operation')
  check((await read('window.__batchStructureCalls')).length, 0, 'queueing a batch draft operation sends no Host request')
  check(await read(`!!document.querySelector('[data-dsh-iui-edit-batch-pending] [data-dsh-iui-edit-batch-pending-remove]')`), true, 'the batch draft operation can be removed before saving')
  await click('[data-dsh-iui-edit-batch-pending-remove]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-batch-pending-item]').length === 0`, 'batch draft op removed')
  await click('[data-dsh-iui-edit-batch-clear]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-batch-check][aria-checked="true"]').length === 0`, 'clean selection cleared')

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
  const batchDraftChip = `(() => { const ref = window.__activeDraftReference(); return [...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => el.getAttribute('data-chip-ref') === ref && (el.getAttribute('data-chip-label') ?? '').includes('调整区块顺序')) })()`
  await wait(batchDraftChip, 'batch chip label')
  check(await read(batchDraftChip), true, 'the composer chip reports the batch reorder')
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
      saveInside: (() => { const save = document.querySelector('[data-dsh-iui-edit-batch-save]').getBoundingClientRect(); return save.left >= sr.left - 1 && save.right <= sr.right + 1; })(),
      apply: (() => {
        const bar = document.querySelector('[data-dsh-iui-edit-apply-bar]');
        const button = document.querySelector('[data-dsh-iui-edit-apply]');
        const br = bar.getBoundingClientRect();
        const ab = button.getBoundingClientRect();
        return {
          overflow: bar.scrollWidth - bar.clientWidth,
          inside: br.left >= window.innerWidth - 1 - 292 && br.right <= window.innerWidth - 1,
          buttonInside: ab.left >= br.left - 1 && ab.right <= br.right + 1 && ab.bottom <= br.bottom + 1,
        };
      })(),
    };
  })()`)
  check(batchLayout.sectionOverflow <= 1, true, 'batch mode does not overflow the narrow rail')
  check(batchLayout.barOverflow <= 1 && batchLayout.inside, true, 'the batch toolbar wraps inside the rail')
  check(batchLayout.headInside, true, 'the arrangement section head still fits the narrow rail')
  check(batchLayout.saveInside, true, 'the batch save action fits the narrow rail')
  check(batchLayout.apply.overflow <= 1, true, 'the fixed Apply bar does not overflow the narrow rail')
  check(batchLayout.apply.buttonInside, true, 'the Apply button stays inside the narrow Apply bar')
  await shot('harness-batch-narrow.png')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  await new Promise(resolve => setTimeout(resolve, 200))

  // Cancelling the batch restores the order snapshot captured on entry.
  await click('[data-dsh-iui-edit-batch-order="down"]')
  await wait(`document.querySelector('[data-dsh-iui-edit-arrangement-row]').getAttribute('data-block-id') === 'b2'`, 'dirty batch reorder')
  await click('[data-dsh-iui-edit-batch-cancel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-batch-bar]")', 'cancel leaves batch mode')
  check((await arrangementOrder()).slice(0, 2), ['b1', 'b2'], 'cancel restores the order snapshot')
  // The composer chip label comes from an async draft-store subscription; the
  // negative assertion must wait for the re-render of this draft's chip instead
  // of sampling once (two-run flake at this point, review MAJOR-2). Earlier
  // scenarios leave their own chips in the one chat, so the wait is scoped to
  // the chip this assertion reads.
  // Scope the negative assertion to this draft's own chip: earlier scenarios
  // leave unrelated chips in the one chat, and the first chip may not be ours.
  const noBatchReorderChip = `(() => { const ref = window.__activeDraftReference(); return ![...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => el.getAttribute('data-chip-ref') === ref && (el.getAttribute('data-chip-label') ?? '').includes('调整区块顺序')) })()`
  await wait(noBatchReorderChip, 'cancel drops the unsent reorder from the chip', { timeout: 5000 })
  check(await read(noBatchReorderChip), true, 'cancel drops the unsent reorder from the chip')
  await wait(`document.querySelector('[data-dsh-iui-edit-live]')?.textContent.includes('已取消批量操作并恢复原顺序')`, 'batch cancel announcement')
  check((await text('[data-dsh-iui-edit-live]')).includes('已取消批量操作并恢复原顺序'), true, 'cancelling the batch is announced')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-toggle]').getAttribute('aria-pressed')`), 'false', 'cancel clears the pressed state')

  // Saving the batch queues both operations; Apply then runs one atomic revision.
  await click('[data-dsh-iui-edit-batch-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-batch-bar]")', 'batch editor again')
  await click('[data-dsh-iui-edit-batch-select-all]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-batch-check][aria-checked="true"]').length === 2`, 'select all blocks')
  check((await text('[data-dsh-iui-edit-batch-count]')).includes('已选 2 个区块'), true, 'select all updates the live status')
  const localBeforeBatch = await count('[data-dsh-iui-local-revision]')
  await click('[data-dsh-iui-edit-batch-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-batch-pending-item]').length === 2`, 'two batch draft rows')
  await click('[data-dsh-iui-edit-batch-save]')
  await wait('!document.querySelector("[data-dsh-iui-edit-batch-bar]")', 'save leaves batch mode')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 2`, 'two queued operations')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-toggle]').getAttribute('aria-pressed')`), 'false', 'save clears the pressed state')
  await wait(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('结构操作 2 项'))`, 'batch chip queue summary')
  check(await read(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('结构操作 2 项'))`), true, 'the chip reports the saved batch queue')
  check(await count('[data-dsh-iui-local-revision]'), localBeforeBatch, 'saving the batch creates no revision')
  check((await read('window.__batchStructureCalls')).length, 0, 'saving the batch sends no Host request')
  await applyPreviewOpen()
  check((await text('.dsh-iui-edit-preview-title')), '应用本轮修改', 'the total preview titles the Apply round')
  check(await count('[data-dsh-iui-edit-apply-op]'), 2, 'the preview lists both queued operations')
  check((await text('[data-dsh-iui-edit-apply-ops-count]')), '2 项结构操作', 'the preview names the structure batch size')
  check(await count('[data-dsh-iui-edit-apply-diff] [data-diff="add"]') > 0, true, 'the preview keeps the shared diff list')
  check((await text('[data-dsh-iui-edit-apply-model-requests]')).includes('未填写'), true, 'the preview reports no model edit requests')
  await shot('harness-batch-apply-preview.png')
  await applyPreviewConfirm()
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
  check(await read('!!document.querySelector("[data-dsh-iui-edit-view]")'), false, 'the editor closes after a pure batch structural revision')
  await read('window.fetch = window.__batchPreviousFetch; delete window.__batchPreviousFetch')

  // 25c. Escape cancels batch mode, restores the captured order and returns focus.
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'batch escape editor')
  await click('[data-dsh-iui-edit-batch-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-batch-bar]")', 'batch escape toolbar')
  await click(`${arrangementSelector('b1')} [data-dsh-iui-edit-batch-check]`)
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-batch-check][aria-checked="true"]').length === 1`, 'batch escape selection')
  await click('[data-dsh-iui-edit-batch-order="down"]')
  await wait(`document.querySelector('[data-dsh-iui-edit-arrangement-row]').getAttribute('data-block-id') === 'b2'`, 'batch escape reorder')
  await click('[data-dsh-iui-edit-batch-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-batch-pending-item]').length === 1`, 'batch escape local op')
  await read(`(() => {
    const toggle = document.querySelector('[data-dsh-iui-edit-batch-toggle]');
    toggle.focus();
    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  })()`)
  await wait('!document.querySelector("[data-dsh-iui-edit-batch-bar]")', 'Escape leaves batch mode')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-toggle]').getAttribute('aria-pressed')`), 'false', 'Escape clears the pressed state')
  check(await read(`document.activeElement?.hasAttribute('data-dsh-iui-edit-batch-toggle')`), true, 'Escape returns focus to the batch toggle')
  check(await count('[data-dsh-iui-edit-batch-check]'), 0, 'leaving batch mode restores the grips')
  check((await arrangementOrder()).slice(0, 2), ['b1', 'b2'], 'Escape restores the order snapshot')
  check(await count('[data-dsh-iui-edit-pending-op]'), 0, 'Escape drops the unsaved batch operations')
  await wait(`document.querySelector('[data-dsh-iui-edit-live]')?.textContent.includes('已取消批量操作并恢复原顺序')`, 'batch escape announcement')
  check((await text('[data-dsh-iui-edit-live]')).includes('已取消批量操作并恢复原顺序'), true, 'leaving batch mode is announced')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'batch scenario closed')

  // 25d. Nested arrangement batch mode: per-parent order moves and a nested batch
  // draft that is saved into the queue and applied as one revision.
  await read(structureMockScript(structureBridge.url, {
    calls: '__nestedBatchStructureCalls', chain: '__nestedBatchPreviousFetch', program: NESTED_PROGRAM,
    artifactId: 'nested-call-1', title: '嵌套区块样例', revisionId: 'struct_e2e_nested_batch',
  }))
  await click('[data-dsh-iui-call-id="nested-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'nested batch editor')
  await click('[data-dsh-iui-edit-nested]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-nested-arrangement]")', 'nested batch section')
  const nestedRowsOf = parentId => read(`[...document.querySelectorAll('[data-dsh-iui-edit-nested-group][data-parent-id="${parentId}"] [data-dsh-iui-edit-nested-row]')].map(row => row.getAttribute('data-block-id'))`)
  check(await read(`document.querySelector('[data-dsh-iui-edit-nested-batch-toggle]').getAttribute('aria-pressed')`), 'false', 'nested batch mode is off by default')

  // The root and nested batch modes are mutually exclusive.
  await click('[data-dsh-iui-edit-batch-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-batch-bar]")', 'root batch toolbar in nested mode')
  await click('[data-dsh-iui-edit-nested-batch-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-nested-batch-bar]")', 'nested batch toolbar')
  check(await read(`document.querySelector('[data-dsh-iui-edit-batch-toggle]').getAttribute('aria-pressed')`), 'false', 'entering nested batch leaves root batch mode')
  check(await count('[data-dsh-iui-edit-batch-bar]'), 0, 'the root batch toolbar closes')
  await click('[data-dsh-iui-edit-batch-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-batch-bar]")', 'root batch toolbar again')
  check(await read(`document.querySelector('[data-dsh-iui-edit-nested-batch-toggle]').getAttribute('aria-pressed')`), 'false', 'entering root batch leaves nested batch mode')
  check(await count('[data-dsh-iui-edit-nested-batch-bar]'), 0, 'the nested batch toolbar closes')
  await click('[data-dsh-iui-edit-nested-batch-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-nested-batch-bar]")', 'nested batch toolbar again')
  check(await count('[data-dsh-iui-edit-nested-grip]'), 0, 'nested batch replaces the nested grips')
  check(await count('[data-dsh-iui-edit-grip]'), 2, 'root grips stay because root batch mode is off')
  check(await count('[data-dsh-iui-edit-nested-row] [data-dsh-iui-edit-row-menu]'), 0, 'nested batch hides the per-row nested menus')
  check((await text('[data-dsh-iui-edit-nested-batch-count]')).includes('已选 0 个区块'), true, 'the nested live status starts at zero')
  await shot('harness-nested-batch-empty.png')

  // Per-parent order moves: each selected child moves inside its own group only.
  const selectNestedRow = blockId => click(`[data-dsh-iui-edit-nested-row][data-block-id="${blockId}"] [data-dsh-iui-edit-nested-batch-check]`)
  await selectNestedRow('b1.2.1')
  await selectNestedRow('b2.2.1')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-nested-batch-check][aria-checked="true"]').length === 2`, 'nested cross-parent selection')
  await click('[data-dsh-iui-edit-nested-batch-order="down"]')
  await wait(`document.querySelector('[data-dsh-iui-edit-nested-group][data-parent-id="b1.2"] [data-dsh-iui-edit-nested-row]').getAttribute('data-block-id') === 'b1.2.2'`, 'nested batch down reorder')
  check(await nestedRowsOf('b1.2'), ['b1.2.2', 'b1.2.1', 'b1.2.3'], 'the first parent group moves down one slot')
  check(await nestedRowsOf('b2.2'), ['b2.2.2', 'b2.2.1'], 'the second parent group moves independently')
  check(await nestedRowsOf('b1'), ['b1.1', 'b1.2'], 'an unselected group keeps its order')
  await wait(`document.querySelector('[data-dsh-iui-edit-live]')?.textContent.includes('已批量调整区块顺序')`, 'nested batch reorder announcement')
  check((await text('[data-dsh-iui-edit-live]')).includes('已批量调整区块顺序'), true, 'nested batch reordering is announced')
  check(await read(`document.querySelector('[data-dsh-iui-edit-reset-nested]').disabled`), false, 'nested reset is enabled after a batch reorder')
  await click('[data-dsh-iui-edit-nested-batch-order="top"]')
  await wait(`document.querySelector('[data-dsh-iui-edit-nested-group][data-parent-id="b1.2"] [data-dsh-iui-edit-nested-row]').getAttribute('data-block-id') === 'b1.2.1'`, 'nested batch top reorder')
  check(await nestedRowsOf('b1.2'), ['b1.2.1', 'b1.2.2', 'b1.2.3'], 'top restores the selected child to its group front')
  check(await nestedRowsOf('b2.2'), ['b2.2.1', 'b2.2.2'], 'top restores the other group too')
  await shot('harness-nested-batch-reordered.png')

  // Escape cancels the nested batch and restores every group's order.
  await click('[data-dsh-iui-edit-nested-batch-order="down"]')
  await read(`(() => {
    const toggle = document.querySelector('[data-dsh-iui-edit-nested-batch-toggle]');
    toggle.focus();
    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  })()`)
  await wait('!document.querySelector("[data-dsh-iui-edit-nested-batch-bar]")', 'Escape leaves nested batch mode')
  check(await read(`document.querySelector('[data-dsh-iui-edit-nested-batch-toggle]').getAttribute('aria-pressed')`), 'false', 'Escape clears the nested pressed state')
  check(await read(`document.activeElement?.hasAttribute('data-dsh-iui-edit-nested-batch-toggle')`), true, 'Escape returns focus to the nested batch toggle')
  check(await nestedRowsOf('b1.2'), ['b1.2.1', 'b1.2.2', 'b1.2.3'], 'Escape restores the nested order snapshot')
  check(await nestedRowsOf('b2.2'), ['b2.2.1', 'b2.2.2'], 'Escape restores every nested group')
  await wait(`document.querySelector('[data-dsh-iui-edit-live]')?.textContent.includes('已取消批量操作并恢复原顺序')`, 'nested batch cancel announcement')
  check((await text('[data-dsh-iui-edit-live]')).includes('已取消批量操作并恢复原顺序'), true, 'cancelling the nested batch is announced')

  // A valid nested selection is saved into the queue and applied as one revision.
  await click('[data-dsh-iui-edit-nested-batch-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-nested-batch-bar]")', 'nested batch toolbar for duplicate')
  await selectNestedRow('b1.2.1')
  await selectNestedRow('b2.2.1')
  await click('[data-dsh-iui-edit-nested-batch-order="down"]')
  await wait(`document.querySelector('[data-dsh-iui-edit-nested-group][data-parent-id="b1.2"] [data-dsh-iui-edit-nested-row]').getAttribute('data-block-id') === 'b1.2.2'`, 'nested dirty reorder')
  await click('[data-dsh-iui-edit-nested-batch-select-all]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-nested-batch-check][aria-checked="true"]').length === 9`, 'nested select all')
  check((await text('[data-dsh-iui-edit-nested-batch-count]')).includes('已选 9 个区块'), true, 'nested select all updates the live status')
  check(await read(`document.querySelector('[data-dsh-iui-edit-nested-batch-duplicate]').disabled`), true, 'an overlapping container selection disables the nested structure action')
  check(
    (await read(`document.querySelector('[data-dsh-iui-edit-nested-batch-duplicate]').getAttribute('title')`)).includes('容器'),
    true,
    'the nested structure action explains the overlap',
  )
  await click('[data-dsh-iui-edit-nested-batch-clear]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-nested-batch-check][aria-checked="true"]').length === 0`, 'nested selection cleared')
  for (const blockId of ['b1.1', 'b1.2.1', 'b1.2.3', 'b2.1', 'b2.2.1']) await selectNestedRow(blockId)
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-nested-batch-check][aria-checked="true"]').length === 5`, 'nested non-overlapping selection')
  check(await read(`document.querySelector('[data-dsh-iui-edit-nested-batch-duplicate]').disabled`), false, 'a valid nested selection enables the structure action')
  const localBeforeNestedBatch = await count('[data-dsh-iui-local-revision]')
  await click('[data-dsh-iui-edit-nested-batch-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-nested-batch-pending-item]').length === 5`, 'nested batch draft rows')
  check((await text('[data-dsh-iui-edit-nested-batch-pending]')).includes('待保存结构操作 5 项'), true, 'the nested batch draft counts its operations')
  await click('[data-dsh-iui-edit-nested-batch-save]')
  await wait('!document.querySelector("[data-dsh-iui-edit-nested-batch-bar]")', 'nested batch saved')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 5`, 'nested queued operations')
  check(await count('[data-dsh-iui-local-revision]'), localBeforeNestedBatch, 'saving the nested batch creates no revision')
  // Keep this Apply pure: the exploratory per-parent reorder is reset first.
  await click('[data-dsh-iui-edit-reset-nested]')
  await wait(`document.querySelector('[data-dsh-iui-edit-reset-nested]').disabled === true`, 'nested order reset before apply')
  await applyPreviewOpen()
  check((await text('.dsh-iui-edit-preview-title')), '应用本轮修改', 'the nested batch preview titles the Apply round')
  check((await text('[data-dsh-iui-edit-apply-ops-count]')), '5 项结构操作', 'the nested preview names the batch size')
  check(await count('[data-dsh-iui-edit-apply-op]'), 5, 'the nested preview lists every operation')
  await shot('harness-nested-batch-apply-preview.png')
  await applyPreviewConfirm()
  await wait(`document.querySelectorAll('[data-dsh-iui-local-revision]').length === ${localBeforeNestedBatch + 1}`, 'nested batch structural revision card')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'editor closed after the nested batch revision')
  const nestedBatchCalls = await read('window.__nestedBatchStructureCalls')
  check(nestedBatchCalls.length, 2, 'the nested batch sends a preview and one real apply')
  check(nestedBatchCalls[0].preview, true, 'the first nested batch request is the dry run')
  check(nestedBatchCalls[1].preview === undefined, true, 'the second nested batch request is the apply')
  check(nestedBatchCalls[0].operations.length, 5, 'the nested preview carries every operation')
  check(nestedBatchCalls[1].operations.map(operation => operation.op), ['duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate'], 'every nested operation duplicates')
  check(nestedBatchCalls[1].operations.map(operation => operation.toIndex), [1, 3, 1, 1, 1], 'each parent group keeps its own descending index base')
  check((await count('[data-dsh-iui-local-revision]')), localBeforeNestedBatch + 1, 'the nested batch produces exactly one local revision card')
  check((await read(`[...document.querySelectorAll('[data-dsh-iui-local-revision]')].at(-1).textContent`)).includes('结构操作修订'), true, 'the nested batch revision card is labelled as a structural revision')
  check(await read('!!document.querySelector("[data-dsh-iui-edit-view]")'), false, 'the editor closes after a pure nested batch structural revision')
  await read('window.fetch = window.__nestedBatchPreviousFetch; delete window.__nestedBatchPreviousFetch')

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
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'move queued row')
  check((await pendingOpLabels())[0].includes('移动'), true, 'the queued move row names the operation')
  await applyPreviewOpen()
  check(await count('[data-dsh-iui-edit-apply-op]'), 1, 'the total preview lists the move operation')
  const localBeforeMove = await count('[data-dsh-iui-local-revision]')
  await applyPreviewConfirm()
  await wait(`document.querySelectorAll('[data-dsh-iui-local-revision]').length === ${localBeforeMove + 1}`, 'local move revision card')
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
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'delete queued instead of applied')
  check(await count('[data-dsh-iui-edit-row-menu-panel]'), 0, 'confirming delete closes the row menu')
  check((await pendingOpLabels())[0].includes('删除'), true, 'the queued delete row names the operation')
  await wait(`document.activeElement?.hasAttribute('data-dsh-iui-edit-row-menu') === true`, 'delete focus returns to the row trigger')
  check(await read(`document.activeElement?.hasAttribute('data-dsh-iui-edit-row-menu')`), true, 'queueing returns focus to the row trigger')
  check(await read('!!document.querySelector("[data-dsh-iui-edit-view]")'), true, 'queueing a delete keeps the editor open')
  await click('[data-dsh-iui-edit-pending-op-remove]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 0`, 'queued delete removed')
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

  // 31. A saved block instruction no longer blocks a property apply: the props
  // revision rekeys the draft and keeps both the instruction and the queue.
  await read('window.__addPropsCard("props-call-2", "属性调整样例 2")')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="props-call-2"]\')', 'dirty props card')
  await read(`(() => {
    window.__dirtyPropCalls = [];
    window.__dirtySavedFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      if (url.includes('/api/intelligent-ui/artifact-structure')) {
        const body = JSON.parse(init.body);
        window.__dirtyPropCalls.push(body);
        const result = {
          artifactId: 'props-call-2',
          revisionId: 'struct_dirty_props_1',
          baseRevisionId: body.baseRevisionId,
          revision: 2,
          operationId: body.operationId,
          program: ${JSON.stringify(PROPS_PROGRAM_APPLIED)},
          title: '属性调整样例 2',
          style: 'card',
        };
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), { status: 201, headers: { 'content-type': 'application/json' } }));
      }
      return window.__dirtySavedFetch(input, init);
    };
  })()`)
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
  // A queued operation must survive the props revision as well.
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b1"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'props scenario queued op')
  await clickBlock('b2')
  await wait('!!document.querySelector("[data-dsh-iui-edit-props]")', 'quick props with pending instruction')
  await chooseQuickOption('[data-dsh-iui-edit-prop="color"]', 'danger')
  const localBeforeDirtyProps = await count('[data-dsh-iui-local-revision]')
  await click('[data-dsh-iui-edit-props-apply]')
  await wait(`document.querySelectorAll('[data-dsh-iui-local-revision]').length === ${localBeforeDirtyProps + 1}`, 'props rebase revision card')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'props revision keeps the editor open')
  const dirtyProps = await read('window.__dirtyPropCalls')
  check(dirtyProps.length, 1, 'the property revision sends one deterministic request')
  check(dirtyProps[0].operations[0].op, 'props', 'the property revision carries a props operation')
  check(await count('[data-dsh-iui-edit-props-error]'), 0, 'a saved instruction no longer blocks the property apply')
  await wait('!!document.querySelector("[data-dsh-iui-edit-request-row]")', 'request list after the props rebase')
  check(await count('[data-dsh-iui-edit-request-row]'), 1, 'the saved block instruction survives the props revision')
  check((await text('[data-dsh-iui-edit-request-row]')).includes('把标题改短'), true, 'the rekeyed draft keeps the saved instruction')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'queued op survives the props rebase')
  await wait(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('结构操作 1 项'))`, 'props rebase chip queue summary')
  check(await read(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('结构操作 1 项'))`), true, 'the chip still reports the queued operation after the rebase')
  await click('[data-dsh-iui-edit-pending-op-remove]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 0`, 'props scenario queue cleared')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'dirty editor closed')
  await read('window.fetch = window.__dirtySavedFetch; delete window.__dirtySavedFetch')

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
  // A queued duplicate meets the total Apply preview: the dry-run failure keeps
  // the Host error code in the dialog instead of a generic failure.
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b2"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'legacy queued duplicate')
  await applyPreviewOpen()
  await wait('!!document.querySelector("[data-dsh-iui-edit-apply-preview-failed]")', 'legacy duplicate preview failed')
  check((await text('[data-dsh-iui-edit-apply-preview-failed]')).includes('权威程序记录'), true, 'the duplicate preview explains the missing authoritative program')
  check((await text('[data-dsh-iui-edit-apply-preview-failed]')).includes('重新渲染'), true, 'the duplicate preview offers the re-render fallback')
  await applyPreviewCancel()
  await click('[data-dsh-iui-edit-pending-op-remove]')
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
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'old-host queued duplicate')
  await applyPreviewOpen()
  await wait('!!document.querySelector("[data-dsh-iui-edit-apply-preview-failed]")', 'old-host duplicate preview failed')
  check((await text('[data-dsh-iui-edit-apply-preview-failed]')).includes('权威程序记录'), true, 'the old-Host preview still explains the missing base')
  await applyPreviewCancel()
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
  // The edit round can add local revision cards above the canvas; bring the
  // header hint into view before computing touch coordinates.
  await read(`document.querySelector('[data-dsh-iui-info-tip="nested"]').scrollIntoView({ block: 'center' })`)
  await new Promise(resolve => setTimeout(resolve, 120))
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

  // Style-only Apply: the bar summary names the style change instead of
  // reporting zero edit requests, and the preview lists the style instruction.
  check((await text('[data-dsh-iui-edit-apply-summary]')), '样式调整', 'the Apply bar names a style-only draft')
  await applyPreviewOpen()
  check((await text('[data-dsh-iui-edit-apply-model-count]')), '0 项编辑需求', 'the style-only preview reports no block requests')
  check((await text('[data-dsh-iui-edit-apply-model-style]')).includes('换成更冷静的配色'), true, 'the style-only preview shows the style instruction')
  check((await text('[data-dsh-iui-edit-apply-preview-confirm]')), '发送修改', 'a style-only Apply sends the model request')
  await applyPreviewCancel()

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
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="props-style-2"] [data-dsh-iui-history-count]\')', 'style revision card')
  check((await text('[data-dsh-iui-call-id="props-style-2"] [data-dsh-iui-history-count]')).includes('2'), true, 'style revision card shows its revision number')
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

  // 41. Deleting the revision a card renders rolls that card back to the newest
  // older revision with a retained program, and the rollback survives rerenders.
  const ROLL_INITIAL = 'root = Col([Title("回退测试"), Text("初始内容")])'
  const ROLL_EDITED = 'root = Col([Title("回退测试"), Text("编辑后内容")])'
  await read('window.__forgetDeletedRevisions()')
  await read(`window.__addCard('roll-call-1', '回退测试', ${JSON.stringify(ROLL_INITIAL)})`)
  await read(`window.__applyBlockEditRevision(${JSON.stringify({
    artifactId: 'roll-call-1', revisionId: 'roll-call-2', baseRevisionId: 'roll-call-1',
    revision: 2, editedBlockIds: ['b1'], program: ROLL_EDITED, title: '回退测试',
  })}, 'roll-call-2')`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="roll-call-2"] [data-dsh-iui-history-count]\')', 'rollback card revision count')
  check((await text('[data-dsh-iui-call-id="roll-call-2"]')).includes('编辑后内容'), true, 'edited revision renders before rollback')
  await read(`window.__setHistory('roll-call-1', [
    { revisionId: 'roll-call-2', revision: 2, baseRevisionId: 'roll-call-1', title: '回退测试', style: 'card', createdAt: 1762500000000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'] },
    { revisionId: 'roll-call-1', revision: 1, title: '回退测试', style: 'card', createdAt: 1762490000000, source: 'initial', hasProgram: true },
  ], { 'roll-call-1': ${JSON.stringify(ROLL_INITIAL)} })`)
  await click('[data-dsh-iui-call-id="roll-call-2"] [data-dsh-iui-history-open]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'rollback history dialog')
  check(await count('[data-dsh-iui-history-revision="roll-call-2"] [data-dsh-iui-history-delete]'), 1, 'rendered revision offers delete with a rollback target')
  check(await count('[data-dsh-iui-history-revision="roll-call-1"] [data-dsh-iui-history-delete]'), 0, 'initial revision still has no delete')
  await click('[data-dsh-iui-history-revision="roll-call-2"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'rollback confirmation')
  check((await text('[data-dsh-iui-history-delete-warning]')).includes('回退到修订 1'), true, 'confirmation names the rollback revision')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait('!document.querySelector(\'[data-dsh-iui-history-revision="roll-call-2"]\')', 'deleted rendered revision row')
  await wait('!document.querySelector(\'[data-dsh-iui-call-id="roll-call-2"] [data-dsh-iui-history-count]\')', 'rolled-back card drops its revision count')
  const rolledText = await text('[data-dsh-iui-call-id="roll-call-2"]')
  check(rolledText.includes('初始内容'), true, 'card renders the fallback revision content')
  check(rolledText.includes('编辑后内容'), false, 'deleted revision content is gone')
  check(await count('[data-dsh-iui-call-id="roll-call-2"] [data-dsh-iui-edit-entry]'), 0, 'a rolled-back card is read-only')
  await read('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'rollback history closed')
  await read('window.__remount()')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="roll-call-2"]\')', 'card after remount')
  check((await text('[data-dsh-iui-call-id="roll-call-2"]')).includes('初始内容'), true, 'rollback survives a rerender')
  // Opening the native fallback revision's editor must not mount a second canvas
  // on the redirected card that shares its revision identity.
  await click('[data-dsh-iui-call-id="roll-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="roll-call-1"] [data-dsh-iui-edit-view]\')', 'native fallback editor')
  check(await count('[data-dsh-iui-call-id="roll-call-2"] [data-dsh-iui-edit-view]'), 0, 'a redirected card never mounts the shared edit canvas')
  check(await count('[data-dsh-iui-call-id="roll-call-2"] [data-dsh-iui-draft-badge]'), 0, 'a redirected card shows no draft chrome from the shared session')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector(\'[data-dsh-iui-call-id="roll-call-1"] [data-dsh-iui-edit-view]\')', 'native fallback editor closed')
  await read("window.__clearHistory('roll-call-1')")

  // A rendered revision without a retained older program cannot be deleted: the
  // card could not roll back, so no delete action is offered.
  const NOFALL_PROGRAM = 'root = Col([Title("无回退")])'
  await read(`window.__addCard('nofall-call-1', '无回退', ${JSON.stringify(NOFALL_PROGRAM)})`)
  await read(`window.__applyBlockEditRevision(${JSON.stringify({
    artifactId: 'nofall-call-1', revisionId: 'nofall-call-2', baseRevisionId: 'nofall-call-1',
    revision: 2, editedBlockIds: ['b1'], program: 'root = Col([Title("无回退编辑"), Text("内容")])', title: '无回退',
  })}, 'nofall-call-2')`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="nofall-call-2"] [data-dsh-iui-history-count]\')', 'no-fallback card revision count')
  await read(`window.__setHistory('nofall-call-1', [
    { revisionId: 'nofall-call-2', revision: 2, baseRevisionId: 'nofall-call-1', title: '无回退', style: 'card', createdAt: 1762600000000, source: 'edit', hasProgram: true },
    { revisionId: 'nofall-call-1', revision: 1, title: '无回退', style: 'card', createdAt: 1762590000000, source: 'initial', hasProgram: false },
  ])`)
  await click('[data-dsh-iui-call-id="nofall-call-2"] [data-dsh-iui-history-open]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'no-fallback history dialog')
  check(await count('[data-dsh-iui-history-revision="nofall-call-2"] [data-dsh-iui-history-delete]'), 0, 'rendered revision without a retained fallback offers no delete')
  check(await count('[data-dsh-iui-history-revision="nofall-call-1"] [data-dsh-iui-history-delete]'), 0, 'the initial revision stays undeletable')
  await read('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'no-fallback history closed')
  await read("window.__clearHistory('nofall-call-1'); window.__forgetDeletedRevisions()")

  // 42. Image sources: local workspace files, http(s), inline data, Markdown
  // images, and explicit failures that must not fall back to a searched photo.
  const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  await writeFile(join(temp, 'pixel.png'), Buffer.from(TINY_PNG, 'base64'))
  await read(`window.__workspaceImages = {}; window.__workspaceImages['figures/att01.png'] = Uint8Array.from(atob(${JSON.stringify(TINY_PNG)}), c => c.charCodeAt(0)); window.__workspaceImages['figures/with space.png'] = window.__workspaceImages['figures/att01.png']; window.__workspaceImages['/virtual/att02.png'] = window.__workspaceImages['figures/att01.png']`)
  await read(`window.__searches = []; window.__origFetch = window.fetch; window.fetch = (url, opts) => { const text = String(url); if (text.includes('wikipedia.org') || text.includes('commons.wikimedia.org')) window.__searches.push(text); return window.__origFetch(url, opts) }`)
  const httpImage = `${server.url}pixel.png`
  const brokenHttp = `${server.url}missing.png`
  // A 24-byte PNG header claiming 10000x10000 pixels; the header pre-check must
  // reject it before <img> tries to decode a decompression bomb.
  const PIXEL_BOMB = (() => {
    const bytes = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
    bytes.writeUInt32BE(10000, 16)
    bytes.writeUInt32BE(10000, 20)
    return bytes.toString('base64')
  })()
  const imageProgram = [
    'root = Col([Title("图片来源")',
    'Image("figures/att01.png", "Local file")',
    'Image("/virtual/att02.png", "Absolute file")',
    'Image("  figures/att01.png  ", "Padded path")',
    `Image(${JSON.stringify(httpImage)}, "HTTP file")`,
    `Image("data:image/png;base64,${TINY_PNG}", "Inline pixel")`,
    'Image("figures/missing.png", "Missing local")',
    `Image(${JSON.stringify(brokenHttp)}, "Broken HTTP")`,
    'Image("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "SVG source")',
    'Image("figures/../escape.png", "Escape attempt")',
    'Image("", "Empty source")',
    'Image("   ", "Whitespace source")',
    `Image("data:image/png;base64,${PIXEL_BOMB}", "Huge inline")`,
    'Markdown("Inline image: ![local](figures/att01.png)")',
    'Markdown("Angle destination: ![spaced](<figures/with space.png>)")',
    '])',
  ].join(', ')
  await read(`window.__addCard('image-call-1', '图片来源', ${JSON.stringify(imageProgram)})`)
  await wait(`!!document.querySelector('[data-dsh-iui-call-id="image-call-1"]')`, 'image card')
  await read(`document.querySelector('[data-dsh-iui-call-id="image-call-1"]').scrollIntoView({ block: 'start' })`)
  // The card is taller than the viewport with ten sources; force the lazy images
  // to load so their error placeholders appear without scrolling each one in.
  await read(`[...document.querySelectorAll('[data-dsh-iui-call-id="image-call-1"] img')].forEach(img => { img.loading = 'eager' })`)
  await wait(`document.querySelectorAll('[data-dsh-iui-call-id="image-call-1"] .iui-image.is-loaded img').length >= 5`, 'local, absolute, padded, http and inline images loaded')
  check(await count(`[data-dsh-iui-call-id="image-call-1"] .iui-image img[data-iui-image-src="figures/att01.png"][alt="Local file"]`), 1, 'a workspace-relative image renders from its blob URL')
  check(await read(`(document.querySelector('[data-dsh-iui-call-id="image-call-1"] .iui-image img[data-iui-image-src="figures/att01.png"][alt="Local file"]')?.getAttribute('src') ?? '').startsWith('blob:')`), true, 'the local image is a same-origin blob URL')
  check(await count(`[data-dsh-iui-call-id="image-call-1"] .iui-image img[data-iui-image-src="/virtual/att02.png"]`), 1, 'an absolute path resolves through the same session authority')
  check(await count(`[data-dsh-iui-call-id="image-call-1"] .iui-image img[data-iui-image-src="figures/att01.png"][alt="Padded path"]`), 1, 'a padded path is canonicalized before render/export')
  await wait(`document.querySelectorAll('[data-dsh-iui-call-id="image-call-1"] [data-iui-image-error]').length >= 7`, 'seven image error placeholders')
  check(await count(`[data-dsh-iui-call-id="image-call-1"] [data-iui-image-error="unavailable"]`), 1, 'a missing local image shows the unavailable placeholder')
  check(await count(`[data-dsh-iui-call-id="image-call-1"] [data-iui-image-error="load-failed"]`), 1, 'a broken http image shows the load placeholder')
  check(await count(`[data-dsh-iui-call-id="image-call-1"] [data-iui-image-error="svg-unsupported"]`), 1, 'SVG sources are rejected explicitly')
  check(await count(`[data-dsh-iui-call-id="image-call-1"] [data-iui-image-error="path-escape"]`), 1, 'a parent-segment path is rejected before any read')
  check(await count(`[data-dsh-iui-call-id="image-call-1"] [data-iui-image-error="path-invalid"]`), 2, 'empty and whitespace sources are invalid explicit sources, not searches')
  check(await count(`[data-dsh-iui-call-id="image-call-1"] [data-iui-image-error="too-large"]`), 1, 'an inline pixel bomb is rejected from its header before decode')
  check(await read(`document.querySelector('[data-dsh-iui-call-id="image-call-1"] [data-iui-image-error="unavailable"]').getAttribute('aria-label')`), 'Missing local: 本地图片无法读取', 'the error placeholder accessible name carries the alt and the reason')
  check(await count(`[data-dsh-iui-call-id="image-call-1"] .iui-markdown-image[data-iui-image-src="figures/att01.png"]`), 1, 'a Markdown image uses the same resolver')
  await wait(`!!document.querySelector('[data-dsh-iui-call-id="image-call-1"] .iui-markdown-image[data-iui-image-src="figures/with space.png"]')`, 'angle-bracket Markdown path resolves')
  check(await read(`document.querySelectorAll('[data-dsh-iui-call-id="image-call-1"] [data-iui-image-pending]').length`), 0, 'no image source stays pending after resolution')
  const assets = await read('window.__collectImageAssets("image-call-1")')
  check(Object.keys(assets), ['image-call-1'], 'HTML export groups collected assets per card')
  check(Object.keys(assets['image-call-1']).sort(), ['/virtual/att02.png', 'figures/att01.png', 'figures/with space.png'], 'HTML export collects only the mounted local image sources')
  check(assets['image-call-1']['figures/att01.png'].startsWith('data:image/png;base64,'), true, 'the collected local image is inlined as a data URL')
  check(await read('(window.__searches ?? []).length'), 0, 'explicit image sources never search Wikipedia for a substitute')
  await read('window.fetch = window.__origFetch; delete window.__origFetch')
  await shot('harness-image-sources.png')

  // 43. A card with an open edit draft cannot delete the revision it renders.
  const LOCK_INITIAL = 'root = Col([Title("草稿锁"), Text("第一段"), Text("第二段")])'
  const LOCK_EDITED = 'root = Col([Title("草稿锁"), Text("第一段（改）"), Text("第二段")])'
  await read(`window.__addCard('lock-call-1', '草稿锁', ${JSON.stringify(LOCK_INITIAL)})`)
  await read(`window.__applyBlockEditRevision(${JSON.stringify({
    artifactId: 'lock-call-1', revisionId: 'lock-call-2', baseRevisionId: 'lock-call-1',
    revision: 2, editedBlockIds: ['b2'], program: LOCK_EDITED, title: '草稿锁',
  })}, 'lock-call-2')`)
  await read(`window.__setHistory('lock-call-1', [
    { revisionId: 'lock-call-2', revision: 2, baseRevisionId: 'lock-call-1', title: '草稿锁', style: 'card', createdAt: 1762700000000, source: 'edit', hasProgram: true, editedBlockIds: ['b2'] },
    { revisionId: 'lock-call-1', revision: 1, title: '草稿锁', style: 'card', createdAt: 1762690000000, source: 'initial', hasProgram: true },
  ])`)
  await wait(`!!document.querySelector('[data-dsh-iui-call-id="lock-call-2"] [data-dsh-iui-history-count]')`, 'draft-lock card')
  await click('[data-dsh-iui-call-id="lock-call-2"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'draft-lock editor')
  await moveWithKeyboard('b3', 'ArrowUp', 1)
  await wait(`!!document.querySelector('[data-dsh-iui-edit-arrangement-row] [data-dsh-iui-edit-grip]')`, 'draft lock arrangement')
  check(await read(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(chip => (chip.getAttribute('data-chip-label') ?? '').includes('草稿锁'))`), true, 'the open editor has a real draft')
  // Open the history from the bird's-eye card (a different card): a draft owned
  // by lock-call-2 must still make its base revision undeletable.
  await click('[data-dsh-iui-call-id="lock-call-1"] [data-dsh-iui-history-open]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'cross-card draft-lock history dialog')
  check(await count('[data-dsh-iui-history-revision="lock-call-2"] [data-dsh-iui-history-delete]'), 0, 'another card\'s unsent draft makes the base revision undeletable')
  check((await text('[data-dsh-iui-history-draft-lock]')).includes('未发送'), true, 'the dialog explains the cross-card draft lock')
  await read('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'draft-lock history closed')
  await read("window.__clearHistory('lock-call-1')")

  // 44. A revision still used as another revision's base is not deletable: the
  // Host would answer 409, so the row hides Delete and explains the reference.
  await read(`window.__addCard('ref-call-1', '引用锁', 'root = Col([Title("引用锁")])')`)
  await read(`window.__applyBlockEditRevision(${JSON.stringify({
    artifactId: 'ref-call-1', revisionId: 'ref-call-2', baseRevisionId: 'ref-call-1',
    revision: 2, editedBlockIds: ['b1'], program: 'root = Col([Title("引用锁二")])', title: '引用锁',
  })}, 'ref-call-2')`)
  await read(`window.__applyBlockEditRevision(${JSON.stringify({
    artifactId: 'ref-call-1', revisionId: 'ref-call-3', baseRevisionId: 'ref-call-2',
    revision: 3, editedBlockIds: ['b1'], program: 'root = Col([Title("引用锁三")])', title: '引用锁',
  })}, 'ref-call-3')`)
  await read(`window.__setHistory('ref-call-1', [
    { revisionId: 'ref-call-3', revision: 3, baseRevisionId: 'ref-call-2', title: '引用锁', style: 'card', createdAt: 1762800000000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'], referenced: false },
    { revisionId: 'ref-call-2', revision: 2, baseRevisionId: 'ref-call-1', title: '引用锁', style: 'card', createdAt: 1762790000000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'], referenced: true },
    { revisionId: 'ref-call-1', revision: 1, title: '引用锁', style: 'card', createdAt: 1762780000000, source: 'initial', hasProgram: true, referenced: true },
  ])`)
  await wait(`!!document.querySelector('[data-dsh-iui-call-id="ref-call-3"] [data-dsh-iui-history-count]')`, 'referenced-lock card')
  await click('[data-dsh-iui-call-id="ref-call-3"] [data-dsh-iui-history-open]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'referenced-lock history dialog')
  check(await count('[data-dsh-iui-history-revision="ref-call-3"] [data-dsh-iui-history-delete]'), 1, 'the latest unreferenced revision stays deletable')
  check(await count('[data-dsh-iui-history-revision="ref-call-2"] [data-dsh-iui-history-delete]'), 0, 'a referenced base revision hides its delete action')
  check(await count('[data-dsh-iui-history-referenced-lock]'), 1, 'the referenced row explains why delete is unavailable')
  await read('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'referenced-lock history closed')
  await read("window.__clearHistory('ref-call-1')")

  // 45. The HTML page export waits only for local readers: a pending local file
  // must settle, while an outstanding image search must not add the 12.5s wait.
  await read(`window.__workspaceImages['figures/slow.png'] = window.__workspaceImages['figures/att01.png']; window.__workspaceImageDelayPaths['figures/slow.png'] = 1200`)
  const slowProgram = 'root = Col([Title("慢速本地图"), Image("figures/slow.png", "Slow local"), SearchImage("slow search photo", 1.2)])'
  await read(`window.__addCard('slow-call-1', '慢速本地图', ${JSON.stringify(slowProgram)})`)
  await wait(`!!document.querySelector('[data-dsh-iui-call-id="slow-call-1"] [data-iui-image-pending]')`, 'slow local image pending')
  const settleMs = await read(`(async () => {
    const start = performance.now()
    await window.__settleLocalImages('slow-call-1')
    return performance.now() - start
  })()`)
  check(settleMs >= 450, true, 'the local-image settle waits for the outstanding local read')
  check(settleMs < 2800, true, 'the local-image settle ignores the outstanding image search instead of the full deadline')
  check(await count('[data-dsh-iui-call-id="slow-call-1"] .iui-image img[data-iui-image-src="figures/slow.png"]'), 1, 'the waited local image resolved to a blob URL')
  await read('delete window.__workspaceImageDelayPaths["figures/slow.png"]')

  // 46. Falling back to the initial revision borrows its temporary style for
  // rendering, but Save/Adjust need a real result snapshot and stay hidden.
  const TEMPFALL_INITIAL = 'root = Col([Title("回退样式"), Text("初始样式内容")])'
  const TEMPFALL_EDITED = 'root = Col([Title("回退样式"), Text("编辑后样式内容")])'
  await read(`window.__addCard('tempfall-call-1', '回退样式', ${JSON.stringify(TEMPFALL_INITIAL)})`)
  await read(`window.__applyBlockEditRevision(${JSON.stringify({
    artifactId: 'tempfall-call-1', revisionId: 'tempfall-call-2', baseRevisionId: 'tempfall-call-1',
    revision: 2, editedBlockIds: ['b1'], program: TEMPFALL_EDITED, title: '回退样式',
  })}, 'tempfall-call-2')`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="tempfall-call-2"] [data-dsh-iui-history-count]\')', 'temp-fallback card')
  await read(`window.__setHistory('tempfall-call-1', [
    { revisionId: 'tempfall-call-2', revision: 2, baseRevisionId: 'tempfall-call-1', title: '回退样式', style: 'card', createdAt: 1762900000000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'] },
    { revisionId: 'tempfall-call-1', revision: 1, title: '回退样式', style: 'card', createdAt: 1762890000000, source: 'initial', hasProgram: true, temporaryStyle: ${JSON.stringify(STYLE_SNAPSHOT)} },
  ], { 'tempfall-call-1': ${JSON.stringify(TEMPFALL_INITIAL)} })`)
  await click('[data-dsh-iui-call-id="tempfall-call-2"] [data-dsh-iui-history-open]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'temp-fallback history')
  await click('[data-dsh-iui-history-revision="tempfall-call-2"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'temp-fallback confirmation')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait(`document.querySelector('[data-dsh-iui-call-id="tempfall-call-2"]')?.textContent.includes('初始样式内容') === true`, 'temp-fallback card content')
  check(await count('[data-dsh-iui-call-id="tempfall-call-2"] [data-dsh-iui-save-result]'), 0, 'a redirected card offers no Save for a borrowed style snapshot')
  check(await count('[data-dsh-iui-call-id="tempfall-call-2"] .dsh-iui-result-actions button'), 0, 'a redirected card offers no Adjust for a borrowed style snapshot')
  await read('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'temp-fallback history closed')
  await read("window.__clearHistory('tempfall-call-1')")

  // 47. A revision that a card rolls back to cannot be deleted when no older
  // fallback exists; once one exists, deleting it retargets the older fallback.
  const DEP_ONE = 'root = Col([Title("依赖锁"), Text("第一版内容")])'
  const DEP_TWO = 'root = Col([Title("依赖锁"), Text("第二版内容")])'
  const DEP_THREE = 'root = Col([Title("依赖锁"), Text("第三版内容")])'
  await read(`window.__addCard('dep-call-1', '依赖锁', ${JSON.stringify(DEP_ONE)})`)
  await read(`window.__applyBlockEditRevision(${JSON.stringify({
    artifactId: 'dep-call-1', revisionId: 'dep-call-2', baseRevisionId: 'dep-call-1',
    revision: 2, editedBlockIds: ['b1'], program: DEP_TWO, title: '依赖锁',
  })}, 'dep-call-2')`)
  await read(`window.__applyBlockEditRevision(${JSON.stringify({
    artifactId: 'dep-call-1', revisionId: 'dep-call-3', baseRevisionId: 'dep-call-2',
    revision: 3, editedBlockIds: ['b1'], program: DEP_THREE, title: '依赖锁',
  })}, 'dep-call-3')`)
  const depRows = (initialHasProgram) => [
    { revisionId: 'dep-call-3', revision: 3, baseRevisionId: 'dep-call-2', title: '依赖锁', style: 'card', createdAt: 1763000000000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'] },
    { revisionId: 'dep-call-2', revision: 2, baseRevisionId: 'dep-call-1', title: '依赖锁', style: 'card', createdAt: 1762990000000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'] },
    { revisionId: 'dep-call-1', revision: 1, title: '依赖锁', style: 'card', createdAt: 1762980000000, source: 'initial', hasProgram: initialHasProgram },
  ]
  await read(`window.__setHistory('dep-call-1', ${JSON.stringify(depRows(false))}, { 'dep-call-2': ${JSON.stringify(DEP_TWO)} })`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="dep-call-3"] [data-dsh-iui-history-count]\')', 'dependency card')
  // Delete R3 first: records R3→R2, so R2 becomes a live fallback target.
  await click('[data-dsh-iui-call-id="dep-call-3"] [data-dsh-iui-history-open]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'dependency history')
  await click('[data-dsh-iui-history-revision="dep-call-3"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'dependency deletion confirmation')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait(`document.querySelector('[data-dsh-iui-call-id="dep-call-3"]')?.textContent.includes('第二版内容') === true`, 'dependency fallback content')
  await read('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'dependency history closed')
  // R1 is not retained, so deleting R2 would strand the redirected card: the
  // row hides Delete and explains the dependency.
  await click('[data-dsh-iui-call-id="dep-call-1"] [data-dsh-iui-history-open]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'dependency lock history')
  check(await count('[data-dsh-iui-history-revision="dep-call-2"] [data-dsh-iui-history-delete]'), 0, 'a fallback target with no older fallback cannot be deleted')
  check(await count('[data-dsh-iui-history-dependency-lock]'), 1, 'the dependency lock is explained')
  await read('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'dependency lock history closed')
  // Once R1 is retained, deleting R2 is allowed and retargets R3→R1.
  await read(`window.__setHistory('dep-call-1', ${JSON.stringify(depRows(true))}, { 'dep-call-1': ${JSON.stringify(DEP_ONE)} })`)
  await click('[data-dsh-iui-call-id="dep-call-1"] [data-dsh-iui-history-open]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'chain history')
  check(await count('[data-dsh-iui-history-revision="dep-call-2"] [data-dsh-iui-history-delete]'), 1, 'the fallback target is deletable once an older fallback exists')
  await click('[data-dsh-iui-history-revision="dep-call-2"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'chain deletion confirmation')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait('!document.querySelector(\'[data-dsh-iui-history-revision="dep-call-2"]\')', 'chain row removed')
  await wait(`document.querySelector('[data-dsh-iui-call-id="dep-call-3"]')?.textContent.includes('第一版内容') === true`, 'chained fallback content')
  check(await count('[data-dsh-iui-call-id="dep-call-3"] [data-dsh-iui-edit-view]'), 0, 'the redirected card stays read-only after a chained delete')
  await read('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'chain history closed')
  await read("window.__clearHistory('dep-call-1')")

  // 48. M1 revision stage: the visible stage updates in place (no new card), the
  // newer revision becomes a notice row; an invisible stage hands over to a new
  // stage card with a hint on the frozen one; a remount converges back to the
  // latest loaded revision; local revisions obey the same suppression rule.
  // Scenarios 1-47 ran with the harness stage switch off (pre-M1 semantics).
  await read('window.__resetStageHarness()')
  await read('window.__setArtifactStageEnabled(true)')
  await read('window.__remount()')
  await wait('!!document.querySelector("[data-dsh-iui-stage-card]")', 'M1 stage card')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-stage-visible') === 'true'`, 'stage viewport visibility reported')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-call-id')`), 'stage-call-1', 'the stage keeps the card DOM identity')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-artifact-id')`), 'stage-call-1', 'the stage names its artifact')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card] [data-dsh-iui-title]').textContent`), DST_TITLE, 'the stage renders the latest revision card')
  check(await count('[data-dsh-iui-revision-notice]'), 0, 'no notice row before a newer revision exists')

  // Visible stage: the new revision renders in place, only a notice row appears.
  const STAGE_V2 = 'root = Col([Card([Title("第二版标题", "sm"), Text("可见舞台原位更新", "sm")])])'
  await read(`window.__appendRevision('stage-call-2', ${JSON.stringify(STAGE_V2)}, { artifactId: 'stage-call-1', revisionId: 'stage-call-2', baseRevisionId: 'stage-call-1', revision: 2, editedBlockIds: ['b1'], title: '夏令时与冬令时' })`)
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('可见舞台原位更新')`, 'stage re-renders the new revision in place')
  check(await count('[data-dsh-intelligent-ui="card"]'), 1, 'no extra full card is created while the stage is visible')
  check(await count('[data-dsh-iui-call-id="stage-call-2"]'), 0, 'the suppressed revision has no card of its own')
  check(await count('[data-dsh-iui-revision-notice]'), 1, 'the newer revision becomes one compact notice row')
  check((await text('[data-dsh-iui-revision-notice]')).includes('修订 2 已更新到上方卡片'), true, 'the notice names the revision and the stage')
  check(await read(`document.querySelector('[data-dsh-iui-revision-notice]').getAttribute('data-dsh-iui-revision-id')`), 'stage-call-2', 'the notice carries the suppressed revision id')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card] [data-dsh-iui-history-count]')?.textContent`), '2', 'the stage header reports the selected revision')
  check(await read(`window.__artifactVersionState('stage-call-1').selected`), 'stage-call-2', 'the stage selects the new revision (its own edit result)')
  await click('[data-dsh-iui-revision-notice]')
  check(await read(`document.activeElement?.hasAttribute('data-dsh-iui-stage-card')`), true, 'clicking the notice focuses the stage card')
  await click('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'stage editor opens on the selected revision')
  check(await read(`document.querySelector('[data-dsh-iui-edit-panel]') !== null`), true, 'the stage edit canvas is available')
  await click('[data-dsh-iui-edit-exit]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'stage editor closed')

  // Invisible stage: scroll it far above, then a newer revision promotes its own card.
  await read(`(() => { const filler = document.createElement('div'); filler.id = 'm1-stage-filler'; filler.style.height = '2600px'; document.body.appendChild(filler); window.scrollTo(0, document.body.scrollHeight); return true })()`)
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-stage-visible') === 'false'`, 'the stage is scrolled out of view')
  const STAGE_V3 = 'root = Col([Card([Title("第三版标题", "sm"), Text("不可见舞台回落新卡", "sm")])])'
  await read(`window.__appendRevision('stage-call-3', ${JSON.stringify(STAGE_V3)}, { artifactId: 'stage-call-1', revisionId: 'stage-call-3', baseRevisionId: 'stage-call-2', revision: 3, editedBlockIds: ['b1'], title: '夏令时与冬令时' })`)
  await wait(`document.querySelector('[data-dsh-iui-stage-card]')?.getAttribute('data-dsh-iui-call-id') === 'stage-call-3'`, 'the new card promotes to stage when the old stage is invisible')
  check(await read(`window.__artifactVersionState('stage-call-1').selected`), 'stage-call-3', 'the promoted stage selects the latest revision')
  check(await count('[data-dsh-intelligent-ui="card"]'), 3, 'every older revision becomes a frozen full card')
  check(await count('[data-dsh-iui-stage-stale-hint]'), 2, 'each frozen card explains where the latest revision is')
  check((await text('[data-dsh-iui-stage-stale-hint]')), '最新修订已移到下方', 'the frozen hint is explicit')
  check(await count('[data-dsh-iui-revision-notice]'), 0, 'the promoted revision is not suppressed')
  check(await read(`document.querySelector('[data-dsh-iui-call-id="stage-call-2"] [data-dsh-iui-history-count]')?.textContent ?? null`), '2', 'a frozen card keeps its own revision badge')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card] [data-dsh-iui-history-count]')?.textContent ?? null`), '3', 'the stage header reports the promoted revision')
  await click('[data-dsh-iui-stage-stale-hint]')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]')?.matches(':focus') === true`, 'the frozen hint focuses the stage')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-call-id')`), 'stage-call-3', 'the hint points at the active stage')

  // Remount (reload/window rebuild): the newest loaded card becomes the stage and
  // the selection returns to the latest revision (D6).
  await read('window.__remount()')
  await wait(`document.querySelectorAll('[data-dsh-iui-stage-card]').length === 1`, 'one stage after the remount')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]')?.getAttribute('data-dsh-iui-call-id') === 'stage-call-3'`, 'the remount converges on the newest loaded revision')
  check(await read(`window.__artifactVersionState('stage-call-1').selected`), 'stage-call-3', 'D6: a remount selects the latest revision')
  check(await count('[data-dsh-intelligent-ui="card"]'), 3, 'the remount still renders all loaded revision cards')

  // Selecting an older revision only changes what the stage displays; the stage
  // stays read-only while its revision is natively owned by a frozen card.
  await read(`window.__selectArtifactRevision('stage-call-1', 'stage-call-1')`)
  await wait(`document.querySelector('[data-dsh-iui-stage-card] [data-dsh-iui-title]').textContent === ${JSON.stringify(DST_TITLE)} && document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('春天把钟拨快')`, 'the stage switches to the selected revision')
  check(await read(`window.__artifactVersionState('stage-call-1').selected`), 'stage-call-1', 'selection is stored without a Host write')
  check(await count('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]'), 1, 'the stage is the single editing surface for the selected revision')
  check(await count('[data-dsh-iui-call-id="stage-call-1"] [data-dsh-iui-edit-entry]'), 0, 'the frozen native card goes read-only while the stage shows its revision')
  await read(`window.__selectArtifactRevision('stage-call-1', 'stage-call-3')`)
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('不可见舞台回落新卡')`, 'the stage switches back to the latest revision')

  // A client-local revision (structure/restore) is suppressed the same way when
  // the stage is visible; a remount promotes the persisted local revision card.
  await read(`document.getElementById('m1-stage-filler')?.remove()`)
  await read(`document.querySelector('[data-dsh-iui-stage-card]').scrollIntoView({ block: 'center' })`)
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-stage-visible') === 'true'`, 'the stage is visible again')
  const LOCAL_V4 = 'root = Col([Card([Title("本地修订标题", "sm"), Text("本地修订内容", "sm")])])'
  await read(`window.__appendLocalRevision({ artifactId: 'stage-call-1', sourceRevisionId: 'stage-call-3', revisionId: 'local-rev-4', revision: 4, kind: 'structure', program: ${JSON.stringify(LOCAL_V4)}, title: '夏令时与冬令时' })`)
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('本地修订内容')`, 'the local revision renders on the stage')
  check(await read(`window.__artifactVersionState('stage-call-1').selected`), 'local-rev-4', 'the local revision becomes the selected/latest revision')
  check(await count('[data-dsh-iui-call-id="local-rev-4"]'), 0, 'the suppressed local revision has no card of its own')
  check(await count('[data-dsh-iui-revision-notice]'), 1, 'the local revision becomes a notice row')
  check((await text('[data-dsh-iui-revision-notice]')).includes('修订 4'), true, 'the notice names the local revision number')
  check(await count('[data-dsh-iui-stage-card] [data-dsh-iui-local-revision]'), 1, 'the stage keeps the local revision badge')
  await read('window.__remount()')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]')?.getAttribute('data-dsh-iui-call-id') === 'local-rev-4'`, 'the persisted local revision becomes the stage after a remount')
  check(await read(`window.__artifactVersionState('stage-call-1').selected`), 'local-rev-4', 'D6 still selects the latest local revision')
  check(await count('[data-dsh-intelligent-ui="card"]'), 4, 'transcript and local revision cards all render as frozen cards')

  // 49. M2 version bar: recent-task thumbnails, keyboard, on-demand select with
  // FLIP, draft markers, lazy capture, reduced motion, the Details entry and a
  // stage-on deletion rollback. The M1 stage stays enabled from scenario 48.
  await read(`window.__setHistory('stage-call-1', [
    { revisionId: 'local-rev-4', revision: 4, baseRevisionId: 'stage-call-3', title: '夏令时与冬令时', style: 'card', createdAt: 1763200004000, source: 'restore', hasProgram: false },
    { revisionId: 'stage-call-3', revision: 3, baseRevisionId: 'stage-call-2', title: '夏令时与冬令时', style: 'card', createdAt: 1763200003000, source: 'structure', hasProgram: true, editedBlockIds: [] },
    { revisionId: 'stage-call-2', revision: 2, baseRevisionId: 'stage-call-1', title: '夏令时与冬令时', style: 'card', createdAt: 1763200002000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'] },
    { revisionId: 'stage-call-1', revision: 1, title: '夏令时与冬令时', style: 'card', createdAt: 1763200001000, source: 'initial', hasProgram: true },
  ])`)
  await read(`(() => {
    window.__m2Fetch = [];
    window.__m2PreviousFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      window.__m2Fetch.push({ url, method: init?.method ?? 'GET' });
      return window.__m2PreviousFetch(input, init);
    };
    return true;
  })()`)
  const versionTrigger = '[data-dsh-iui-stage-card] [data-dsh-iui-history-open][data-dsh-iui-version-open="true"]'
  const versionItem = revision => `[data-dsh-iui-version-item][data-revision="${revision}"]`
  await click(versionTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'version bar')
  // Host history is fetched asynchronously; wait for the merged items, not just the shell.
  await wait(`document.querySelectorAll('[data-dsh-iui-version-item]').length === 4`, 'version items ready')
  check(await count('[data-dsh-iui-version-item]'), 4, 'the version bar lists the recent revisions')
  check(await read(`document.querySelector('${versionItem(4)}').getAttribute('data-current')`), 'true', 'the bar marks the displayed revision as current')
  check((await text(versionItem(1))).includes('初始生成'), true, 'the initial revision carries its source label')
  check((await text(versionItem(2))).includes('区块编辑'), true, 'an edited revision carries its source label')
  check((await text(versionItem(3))).includes('结构操作'), true, 'a structure revision carries its source label')
  check((await text(versionItem(4))).includes('恢复'), true, 'the local restore revision is merged into the bar')
  check(await count('[data-dsh-iui-version-item] [data-dsh-iui-version-thumb]'), 4, 'every item owns a thumbnail slot')
  await wait(`document.activeElement?.getAttribute('data-revision') === '4'`, 'initial focus is the current revision')
  check(await read(`document.activeElement?.getAttribute('data-revision')`), '4', 'initial focus is the current revision')
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`)
  await wait(`document.activeElement?.getAttribute('data-revision') === '3'`, 'ArrowRight focus')
  check(await read(`document.activeElement?.getAttribute('data-revision')`), '3', 'ArrowRight moves to the next (older) revision')
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))`)
  await wait(`document.activeElement?.getAttribute('data-revision') === '1'`, 'End focus')
  check(await read(`document.activeElement?.getAttribute('data-revision')`), '1', 'End focuses the oldest revision')
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))`)
  await wait(`document.activeElement?.getAttribute('data-revision') === '4'`, 'Home focus')
  check(await read(`document.activeElement?.getAttribute('data-revision')`), '4', 'Home returns to the newest revision')
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))`)
  await wait(`document.activeElement?.getAttribute('data-revision') === '3'`, 'Tab focus')
  check(await read(`document.activeElement?.getAttribute('data-revision')`), '3', 'Tab moves to the next revision')
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))`)
  await wait(`document.activeElement?.getAttribute('data-revision') === '4'`, 'Shift+Tab focus')
  check(await read(`document.activeElement?.getAttribute('data-revision')`), '4', 'Shift+Tab returns to the previous revision')
  await shot('harness-m2-version-bar.png')
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
  await wait('!document.querySelector("[data-dsh-iui-version-bar]")', 'Escape closes the version bar')
  await wait(`document.activeElement?.getAttribute('data-dsh-iui-version-open') === 'true'`, 'focus returned to the history icon')
  check(await read(`document.activeElement?.getAttribute('data-dsh-iui-version-open')`), 'true', 'Escape returns focus to the history trigger')

  // Pending-draft marker: an unsent draft on the stage's displayed revision is flagged in the bar.
  await click('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'draft editor')
  await typeInto('[data-dsh-iui-edit-global]', 'draft for the stage revision')
  await click('[data-dsh-iui-edit-global-save]')
  await wait(`document.querySelector('[data-dsh-iui-edit-global-state]').getAttribute('data-state') === 'saved'`, 'stage draft global saved')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'draft editor closed')
  await click(versionTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'version bar for draft marker')
  await wait(`document.querySelector('${versionItem(4)}').getAttribute('data-draft') === 'true'`, 'draft marker on the stage revision')
  check((await text(versionItem(4))).includes('待发送草稿'), true, 'the drafted revision shows its pending-draft label')
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
  await wait('!document.querySelector("[data-dsh-iui-version-bar]")', 'draft bar closed')
  // Clear the draft so later stages are clean: empty global instruction discards it.
  await click('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'draft cleanup editor')
  await typeInto('[data-dsh-iui-edit-global]', '')
  await click('[data-dsh-iui-edit-global-save]')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'draft cleanup closed')

  // An auto-captured thumbnail becomes a real image; older items lazy-capture.
  await click(versionTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'version bar for thumbnails')
  await wait(`document.querySelector('${versionItem(4)} [data-dsh-iui-version-thumb]')?.getAttribute('data-thumb-status') === 'ready'`, 'stage thumbnail captured')
  check(await count(`${versionItem(4)} [data-dsh-iui-version-thumb] img`), 1, 'the captured thumbnail renders as an image')

  // Selecting a historical revision switches the stage without writing the Host.
  await wait(`document.querySelector('${versionItem(3)} [data-dsh-iui-version-thumb]')?.getAttribute('data-thumb-status') === 'ready'`, 'revision 3 thumbnail ready')
  await click(versionItem(3))
  await wait('!document.querySelector("[data-dsh-iui-version-bar]")', 'selection closes the version bar')
  await wait('!!document.querySelector("[data-dsh-iui-stage-flip]")', 'FLIP thumbnail overlay', { timeout: 3000, step: 20 })
  await wait('!document.querySelector("[data-dsh-iui-stage-flip]")', 'FLIP overlay finished', { timeout: 3000, step: 20 })
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('不可见舞台回落新卡')`, 'stage switched to revision 3')
  check(await read(`window.__artifactVersionState('stage-call-1').selected`), 'stage-call-3', 'the selection moved to revision 3')
  check(await count('[data-dsh-intelligent-ui="card"]'), 4, 'switching a revision creates no new card')
  const writesWhileSwitching = await read(`window.__m2Fetch.filter(call => !call.url.includes('/api/intelligent-ui/artifact-base') && call.method !== 'GET').map(call => call.method + ' ' + call.url)`)
  check(writesWhileSwitching.length, 0, 'switching a revision never writes the Host')
  check(await read(`document.activeElement?.hasAttribute('data-dsh-iui-stage-card')`), true, 'focus lands on the stage after the switch')

  // Reduced motion switches directly with no FLIP overlay.
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await click(versionTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'reduced-motion bar')
  await wait(`!!document.querySelector('${versionItem(2)}')`, 'reduced-motion item ready')
  await click(versionItem(2))
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('可见舞台原位更新')`, 'reduced-motion stage switch')
  await new Promise(resolve => setTimeout(resolve, 160))
  check(await count('[data-dsh-iui-stage-flip]'), 0, 'reduced motion skips the FLIP overlay')
  await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [] })
  await click(versionTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'bar before lazy capture')
  await wait(`!!document.querySelector('${versionItem(3)}')`, 'lazy-capture item ready')
  await click(versionItem(3))
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('不可见舞台回落新卡')`, 'stage back on revision 3')

  // Lazy capture: with the cache cleared, opening the bar renders older items
  // off-screen and captures them without blocking the bar.
  await read(`window.__clearArtifactThumbnails('stage-call-1')`)
  await wait('!document.querySelector("[data-dsh-iui-stage-flip]")', 'flip settled before lazy capture', { timeout: 3000, step: 20 })
  await click(versionTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'lazy capture bar')
  await wait(`document.querySelector('${versionItem(1)} [data-dsh-iui-version-thumb]')?.getAttribute('data-thumb-status') === 'ready'`, 'lazy off-screen thumbnail', { timeout: 10000, step: 120 })
  check(await count(`${versionItem(1)} [data-dsh-iui-version-thumb] img`), 1, 'the lazy capture renders an off-screen image')

  // Details entry keeps the metadata management dialog.
  await click('[data-dsh-iui-version-details]')
  await wait('!document.querySelector("[data-dsh-iui-version-bar]")', 'details closes the bar')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'details dialog')
  // The dialog loads its rows from the Host after opening; wait for the list.
  await wait('!!document.querySelector("[data-dsh-iui-history-list]")', 'details history rows')
  check((await text('[data-dsh-iui-history]')).includes('修订 4'), true, 'the details dialog lists revisions')
  await click('[data-dsh-iui-history-close]')
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'details dialog closed')

  // Stage-on deletion: deleting the local revision currently displayed in the
  // frozen local card hands the stage over to the newest remaining card.
  await click(versionTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'bar before deletion')
  await click('[data-dsh-iui-version-details]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'deletion history dialog')
  // Wait for the target row and its deletable action, not just the dialog shell.
  await wait('!!document.querySelector(\'[data-dsh-iui-history-revision="local-rev-4"] [data-dsh-iui-history-delete]\')', 'deletable local revision row')
  await click('[data-dsh-iui-history-revision="local-rev-4"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'deletion confirmation')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]')?.getAttribute('data-dsh-iui-call-id') === 'stage-call-3'`, 'stage hands over after the deletion')
  check(await read(`window.__artifactVersionState('stage-call-1').latest`), 'stage-call-3', 'the deleted local revision leaves a live stage revision')
  check(await read(`window.__artifactVersionState('stage-call-1').selected`), 'stage-call-3', 'the stage selection repoints to a live revision')
  check(await count('[data-dsh-intelligent-ui="card"]'), 3, 'the deleted local revision card is gone')
  check(await read('!!document.querySelector("[data-dsh-iui-history]")'), false, 'the dialog closes with the removed card')
  check((await text('[data-dsh-iui-stage-card]')).includes('不可见舞台回落新卡'), true, 'the promoted stage renders its own revision')

  await read('window.fetch = window.__m2PreviousFetch; delete window.__m2PreviousFetch; delete window.__m2Fetch')
  await read('window.__setArtifactStageEnabled(false)')

  // 50. D5: every revision keeps one thumbnail per scheme. The live stage
  // captures the current scheme, the other scheme is rendered off-screen with
  // its own theme; both are stored and the bar reads the requested scheme first.
  await read('window.__setArtifactStageEnabled(true)')
  await read('window.__remount()')
  await wait('!!document.querySelector("[data-dsh-iui-stage-card]")', 'D5 stage card')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]')?.getAttribute('data-dsh-iui-call-id') === 'stage-call-3'`, 'D5 stage converges on revision 3')
  await wait(`window.__thumbnailStates('stage-call-1', 'stage-call-3').light === 'ready'`, 'light thumbnail captured', { timeout: 10000 })
  await wait(`window.__thumbnailStates('stage-call-1', 'stage-call-3').dark === 'ready'`, 'dark thumbnail captured off-screen', { timeout: 12000 })
  check(await read(`window.__thumbnailStates('stage-call-1', 'stage-call-3').light`), 'ready', 'the live stage captures the current scheme')
  check(await read(`window.__thumbnailStates('stage-call-1', 'stage-call-3').dark`), 'ready', 'the same revision also stores the other scheme')
  check(await read(`(() => { const state = window.__thumbnailStates('stage-call-1', 'stage-call-3'); return state.lightUrl !== null && state.darkUrl !== null && state.lightUrl !== state.darkUrl })()`), true, 'light and dark are two independent captures with distinct object URLs')
  const dualTrigger = '[data-dsh-iui-stage-card] [data-dsh-iui-history-open][data-dsh-iui-version-open="true"]'
  const dualItem = '[data-dsh-iui-version-item][data-revision="3"] [data-dsh-iui-version-thumb]'
  await click(dualTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'D5 version bar')
  await wait(`document.querySelector('${dualItem}')?.getAttribute('data-thumb-status') === 'ready'`, 'D5 bar thumbnail ready')
  check(await read(`document.querySelector('${dualItem}').getAttribute('data-thumb-scheme')`), 'current', 'the light scheme uses its own thumbnail')
  // Switching the page scheme must keep both copies and read the dark one.
  await read(`document.body.setAttribute('data-ds-dark-theme', '')`)
  await wait(`window.__thumbnailStates('stage-call-1', 'stage-call-3').dark === 'ready'`, 'dark thumbnail after the scheme switch', { timeout: 8000 })
  await wait(`document.querySelector('${dualItem}')?.getAttribute('data-thumb-scheme') === 'current'`, 'dark bar thumbnail ready')
  check(await read(`document.querySelector('${dualItem}').getAttribute('data-thumb-scheme')`), 'current', 'the dark scheme uses its own thumbnail')
  check(await read(`window.__thumbnailStates('stage-call-1', 'stage-call-3').light`), 'ready', 'the light copy survives the scheme switch')
  await read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
  await wait('!document.querySelector("[data-dsh-iui-version-bar]")', 'D5 bar closed')
  await read(`document.body.removeAttribute('data-ds-dark-theme')`)
  await new Promise(resolve => setTimeout(resolve, 240))
  await shot('harness-m2-dual-scheme.png')
  await read('window.__setArtifactStageEnabled(false)')

  // 51. D10: selecting an old revision on the stage keeps the existing
  // conflict-banner --> branch flow, and the request keeps the selected base.
  await read('window.__setArtifactStageEnabled(true)')
  const HISTORY_V2 = 'root = Col([Card([Title("第二版标题", "sm"), Text("可见舞台原位更新", "sm")])])'
  const HISTORY_V3 = 'root = Col([Card([Title("第三版标题", "sm"), Text("不可见舞台回落新卡", "sm")])])'
  await read(`window.__setHistory('stage-call-1', [
    { revisionId: 'stage-call-3', revision: 3, baseRevisionId: 'stage-call-2', title: '夏令时与冬令时', style: 'card', createdAt: 1763200003000, source: 'structure', hasProgram: true, editedBlockIds: [] },
    { revisionId: 'stage-call-2', revision: 2, baseRevisionId: 'stage-call-1', title: '夏令时与冬令时', style: 'card', createdAt: 1763200002000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'] },
    { revisionId: 'stage-call-1', revision: 1, title: '夏令时与冬令时', style: 'card', createdAt: 1763200001000, source: 'initial', hasProgram: true },
  ], { 'stage-call-2': ${JSON.stringify(HISTORY_V2)}, 'stage-call-3': ${JSON.stringify(HISTORY_V3)} })`)
  await read('window.__remount()')
  await wait('!!document.querySelector("[data-dsh-iui-stage-card]")', 'branch stage card')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]')?.getAttribute('data-dsh-iui-call-id') === 'stage-call-3'`, 'branch stage converged')
  const branchTrigger = '[data-dsh-iui-stage-card] [data-dsh-iui-history-open][data-dsh-iui-version-open="true"]'
  const branchItem = revision => `[data-dsh-iui-version-item][data-revision="${revision}"]`
  await click(branchTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'branch version bar')
  await wait(`!!document.querySelector('${branchItem(2)}')`, 'branch revision item')
  await click(branchItem(2))
  await wait('!document.querySelector("[data-dsh-iui-version-bar]")', 'branch bar closed')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('可见舞台原位更新')`, 'stage switched to the old revision')
  check(await read(`window.__artifactVersionState('stage-call-1').selected`), 'stage-call-2', 'the old revision is selected')
  await click('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'old-revision editor')
  await openArrangementEditor('b1')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'old-revision popover')
  await saveInstruction('旧版本继续编辑')
  await wait('!!document.querySelector("[data-chip=\\"artifact-edit\\"]")', 'old-revision chip')
  await read('window.__conflict = true')
  await read('window.dispatchEvent(new Event("focus"))')
  await wait('!!document.querySelector("[data-dsh-iui-edit-conflict]")', 'old-revision conflict banner')
  const branchConflictText = await text('[data-dsh-iui-edit-conflict]')
  check(branchConflictText.includes('修订 2'), true, 'the conflict banner names the selected base revision')
  await click('[data-dsh-iui-edit-branch]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-branch-note]")', 'old-revision branch note')
  check((await text('[data-dsh-iui-edit-branch-note]')).includes('修订 2'), true, 'the branch note keeps the selected base')
  await wait(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('分支'))`, 'old-revision branch chip label')
  const stageBranchEnvelope = await read('window.__serializeChipMatching("分支")')
  check(stageBranchEnvelope.includes('"branch":true'), true, 'the old-revision request carries branch:true')
  check(stageBranchEnvelope.includes('"baseRevisionId":"stage-call-2"'), true, 'the request base is the selected revision')
  check(stageBranchEnvelope.includes('"artifactId":"stage-call-1"'), true, 'the request keeps the artifact identity')
  await read('window.__conflict = false')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'old-revision editor closed')
  check(await count('[data-dsh-intelligent-ui="card"]'), 3, 'old-revision editing creates no extra card')
  // Best-effort chip cleanup; the leftover detached draft is harmless here and
  // the suite does not depend on the composer after this scenario.
  await read(`(() => { const occurrence = window.__input().occurrences.find(item => item.source === 'artifact-edit'); if (occurrence) window.__deleteChip(occurrence.ref); return true })()`)

  // 52. D3: deleting the displayed transcript revision rolls the stage back
  // through the existing revision-fallback path (no dangling stage).
  await click(branchTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'deletion version bar')
  await wait(`!!document.querySelector('${branchItem(3)}')`, 'deletion revision item')
  await click(branchItem(3))
  await wait('!document.querySelector("[data-dsh-iui-version-bar]")', 'deletion bar closed')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('不可见舞台回落新卡')`, 'stage shows revision 3 before deletion')
  const cardsBeforeTranscriptDelete = await count('[data-dsh-intelligent-ui="card"]')
  const stageCardBeforeDelete = await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-call-id')`)
  check(stageCardBeforeDelete, 'stage-call-3', 'the stage card identity is pinned before the deletion')
  check(await count('[data-dsh-iui-stage-card]'), 1, 'exactly one stage card before the deletion')
  check(await count('[data-dsh-iui-stage-card][data-artifact-id="stage-call-1"]'), 1, 'the single stage belongs to the deleted artifact')
  await click(branchTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'deletion details bar')
  await click('[data-dsh-iui-version-details]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'deletion details dialog')
  await wait('!!document.querySelector(`[data-dsh-iui-history-revision="stage-call-3"] [data-dsh-iui-history-delete]`)', 'deletion row ready')
  await click('[data-dsh-iui-history-revision="stage-call-3"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'transcript deletion confirmation')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('可见舞台原位更新')`, 'stage rolled back to revision 2')
  const transcriptDeleteState = await read(`window.__artifactVersionState('stage-call-1')`)
  check(transcriptDeleteState.latest, 'stage-call-2', 'the deleted transcript revision is no longer latest')
  check(transcriptDeleteState.selected, 'stage-call-2', 'the stage selection repoints at a live revision')
  check(transcriptDeleteState.revisions.includes('stage-call-3'), false, 'the deleted revision is forgotten by the store')
  check(await count('[data-dsh-iui-stage-card]'), 1, 'exactly one stage card remains after the rollback')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-call-id')`), stageCardBeforeDelete, 'M2 gate wiring: the fallback keeps the same stage card (no unregister/re-register handover)')
  check(await count('[data-dsh-iui-stage-card][data-artifact-id="stage-call-1"]'), 1, 'the surviving stage still belongs to the fallback artifact')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-artifact-id')`), 'stage-call-1', 'the stage keeps its artifact identity')
  check(await count('[data-dsh-intelligent-ui="card"]'), cardsBeforeTranscriptDelete, 'the card count is unchanged by the rollback')
  check(await count('[data-dsh-iui-history-revision="stage-call-3"]'), 0, 'the deleted revision row is gone')
  await read(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'deletion details closed')
  await read('window.__setArtifactStageEnabled(false)')

  // 53. F1/F2: with a single mounted card (trimmed Turn window / refresh), deleting
  // the revision the card itself displays redirects it in place; the fallback card
  // must stay read-only (its program carries fallbackFrom) without losing the stage.
  await read('window.__setArtifactStageEnabled(true)')
  await read('window.__resetCards()')
  await wait('!document.querySelector("[data-dsh-iui-stage-card]")', 'solo stage cleared')
  const SOLO_V1 = 'root = Col([Card([Title("单卡回退旧版", "sm")])])'
  const SOLO_V2 = 'root = Col([Card([Title("单卡当前版", "sm")])])'
  await read(`window.__setHistory('solo-call', [
    { revisionId: 'solo-call', revision: 2, baseRevisionId: 'solo-rev-1', title: '单卡样例', style: 'card', createdAt: 1763200005000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'] },
    { revisionId: 'solo-rev-1', revision: 1, title: '单卡样例', style: 'card', createdAt: 1763200004000, source: 'initial', hasProgram: true },
  ], { 'solo-rev-1': ${JSON.stringify(SOLO_V1)} })`)
  await read(`window.__appendRevision('solo-call', ${JSON.stringify(SOLO_V2)}, { artifactId: 'solo-call', revisionId: 'solo-call', revision: 2, baseRevisionId: 'solo-rev-1', editedBlockIds: ['b1'] }, '单卡样例')`)
  await wait('!!document.querySelector("[data-dsh-iui-stage-card][data-artifact-id=\\"solo-call\\"]")', 'solo stage card')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('单卡当前版')`, 'solo stage shows its own revision')
  check(await count('[data-dsh-intelligent-ui="card"]'), 1, 'the stage is the only mounted card')
  check(await count('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]'), 1, 'the live stage card is editable before the deletion')
  const soloTrigger = '[data-dsh-iui-stage-card] [data-dsh-iui-history-open][data-dsh-iui-version-open="true"]'
  await click(soloTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'solo version bar')
  await click('[data-dsh-iui-version-details]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'solo details dialog')
  await wait('!!document.querySelector(`[data-dsh-iui-history-revision="solo-call"] [data-dsh-iui-history-delete]`)', 'solo delete row ready')
  await click('[data-dsh-iui-history-revision="solo-call"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'solo deletion confirmation')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('单卡回退旧版')`, 'solo stage follows the fallback')
  const soloState = await read(`window.__artifactVersionState('solo-call')`)
  check(soloState.latest, 'solo-rev-1', 'the fallback revision becomes latest')
  check(soloState.selected, 'solo-rev-1', 'the fallback revision becomes selected')
  check(soloState.stage, 'solo-call', 'the same single card keeps the stage')
  check(await count('[data-dsh-intelligent-ui="card"]'), 1, 'the fallback keeps exactly one card')
  await wait('!document.querySelector("[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]")', 'fallback stage card is read-only')
  check(await count('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]'), 0, 'F1: the fallback stage card is read-only')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-call-id')`), 'solo-call', 'the fallback stage keeps its identity')
  await read(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'solo details closed')
  await read('window.__setArtifactStageEnabled(false)')

  // 54. H1 real-GUI residual: a single stage card owns rev-1 but displays a
  // revision fetched from Host history (rev-2). Deleting that displayed fetched
  // revision must redirect the stage through redirectedFrom and keep it read-only.
  await read('window.__setArtifactStageEnabled(true)')
  await read('window.__resetCards()')
  await wait('!document.querySelector("[data-dsh-iui-stage-card]")', 'fetched stage cleared')
  const FETCHED_V1 = 'root = Col([Card([Title("拉取修订旧版", "sm")])])'
  const FETCHED_V2 = 'root = Col([Card([Title("拉取修订当前版", "sm")])])'
  await read(`window.__setHistory('solo2', [
    { revisionId: 'solo2-rev-2', revision: 2, baseRevisionId: 'solo2-rev-1', title: '单卡历史样例', style: 'card', createdAt: 1763200007000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'] },
    { revisionId: 'solo2-rev-1', revision: 1, title: '单卡历史样例', style: 'card', createdAt: 1763200006000, source: 'initial', hasProgram: true },
  ], { 'solo2-rev-1': ${JSON.stringify(FETCHED_V1)}, 'solo2-rev-2': ${JSON.stringify(FETCHED_V2)} })`)
  await read(`window.__appendRevision('solo2', ${JSON.stringify(FETCHED_V1)}, { artifactId: 'solo2', revisionId: 'solo2-rev-1', revision: 1 }, '单卡历史样例')`)
  await wait('!!document.querySelector("[data-dsh-iui-stage-card][data-artifact-id=\\"solo2\\"]")', 'fetched stage card')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('拉取修订旧版')`, 'stage shows its own rev1')
  check(await count('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]'), 1, 'the own-revision stage is editable before the fetched revision is displayed')
  const fetchedTrigger = '[data-dsh-iui-stage-card] [data-dsh-iui-history-open][data-dsh-iui-version-open="true"]'
  await click(fetchedTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'fetched version bar')
  await wait('!!document.querySelector(\'[data-dsh-iui-version-item][data-revision="2"]\')', 'fetched revision 2 item')
  await click('[data-dsh-iui-version-item][data-revision="2"]')
  await wait('!document.querySelector("[data-dsh-iui-version-bar]")', 'fetched bar closed')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('拉取修订当前版')`, 'stage displays the fetched revision 2')
  check(await read(`window.__artifactVersionState('solo2').selected`), 'solo2-rev-2', 'the fetched revision is selected')
  await click(fetchedTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'fetched details bar')
  await click('[data-dsh-iui-version-details]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'fetched details dialog')
  await wait('!!document.querySelector(`[data-dsh-iui-history-revision="solo2-rev-2"] [data-dsh-iui-history-delete]`)', 'fetched delete row ready')
  await click('[data-dsh-iui-history-revision="solo2-rev-2"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'fetched deletion confirmation')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('拉取修订旧版')`, 'fetched stage follows the fallback')
  const fetchedState = await read(`window.__artifactVersionState('solo2')`)
  check(fetchedState.latest, 'solo2-rev-1', 'the fallback revision becomes latest')
  check(fetchedState.selected, 'solo2-rev-1', 'the fallback revision becomes selected')
  check(fetchedState.stage, 'solo2', 'the same single card keeps the stage')
  check(fetchedState.redirected['solo2-rev-1'], 'solo2-rev-2', 'the fallback record remembers the deleted fetched revision')
  check(await count('[data-dsh-intelligent-ui="card"]'), 1, 'the fallback keeps exactly one card')
  await wait('!document.querySelector("[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]")', 'fetched fallback stage is read-only')
  check(await count('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]'), 0, 'H1 residual: the stage displaying a deleted fetched revision is read-only after the fallback')
  await read(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'fetched details closed before the bar check')
  await click(fetchedTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'bar after the fetched fallback')
  await wait('!!document.querySelector(\'[data-dsh-iui-version-item][data-revision="1"]\')', 'bar shows revision 1 after the deletion')
  check(await read(`document.querySelector('[data-dsh-iui-version-item][data-revision="1"]').getAttribute('data-current')`), 'true', 'the bar marks the fallback revision as current')
  check(await count('[data-dsh-iui-version-item]'), 1, 'the deleted fetched revision is gone from the bar')
  await read(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)
  await wait('!document.querySelector("[data-dsh-iui-version-bar]")', 'bar after the fetched fallback closed')
  await read(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'fetched details closed')
  await read('window.__setArtifactStageEnabled(false)')

  // 55. H1 last variant: the stage displays a client-local revision while its own
  // program is the initial transcript revision. Deleting that displayed local
  // revision must still write a fallback (transcript-card semantics): the stage
  // stays the same card, becomes read-only and the revision badge disappears.
  await read('window.__setArtifactStageEnabled(true)')
  await read('window.__resetCards()')
  await wait('!document.querySelector("[data-dsh-iui-stage-card]")', 'local revision stage cleared')
  const LOCAL_V1 = 'root = Col([Card([Title("本地修订前旧版", "sm")])])'
  const LOCAL_V2 = 'root = Col([Card([Title("本地修订当前版", "sm")])])'
  await read(`window.__setHistory('solo3', [
    { revisionId: 'local-struct-2', revision: 2, baseRevisionId: 'solo3-rev-1', title: '单卡本地修订', style: 'card', createdAt: 1763200009000, source: 'structure', hasProgram: false },
    { revisionId: 'solo3-rev-1', revision: 1, title: '单卡本地修订', style: 'card', createdAt: 1763200008000, source: 'initial', hasProgram: true },
  ], { 'solo3-rev-1': ${JSON.stringify(LOCAL_V1)} })`)
  await read(`window.__appendRevision('solo3', ${JSON.stringify(LOCAL_V1)}, { artifactId: 'solo3', revisionId: 'solo3-rev-1', revision: 1 }, '单卡本地修订')`)
  // The local revision is known to the store but its local card is not mounted
  // (trimmed Turn window), so the transcript card stays the stage.
  await read(`window.__registerLocalRevision('solo3', { revisionId: 'local-struct-2', revision: 2, program: ${JSON.stringify(LOCAL_V2)}, title: '单卡本地修订', kind: 'structure', sourceRevisionId: 'solo3-rev-1' })`)
  await wait('!!document.querySelector("[data-dsh-iui-stage-card][data-artifact-id=\\"solo3\\"]")', 'local revision stage card')
  await wait(`document.querySelectorAll('[data-dsh-intelligent-ui="card"]').length === 1`, 'only the transcript stage card is mounted')
  const localStageCallId = await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-call-id')`)
  check(localStageCallId, 'solo3', 'the stage card identity is pinned before the local revision deletion')
  check(await count('[data-dsh-iui-stage-card]'), 1, 'exactly one stage card before the local revision deletion')
  const localTrigger = '[data-dsh-iui-stage-card] [data-dsh-iui-history-open][data-dsh-iui-version-open="true"]'
  await click(localTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'local revision version bar')
  await wait('!!document.querySelector(\'[data-dsh-iui-version-item][data-revision="2"]\')', 'local revision item')
  await click('[data-dsh-iui-version-item][data-revision="2"]')
  await wait('!document.querySelector("[data-dsh-iui-version-bar]")', 'local revision bar closed')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('本地修订当前版')`, 'stage displays the displayed local revision')
  check(await read(`window.__artifactVersionState('solo3').selected`), 'local-struct-2', 'the local revision is selected')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-call-id')`), localStageCallId, 'selection keeps the stage card identity')
  check(await text('[data-dsh-iui-history-count]'), '2', 'the stage badge shows the local revision number')
  await click(localTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'local revision details bar')
  await click('[data-dsh-iui-version-details]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'local revision details dialog')
  await wait('!!document.querySelector(`[data-dsh-iui-history-revision="local-struct-2"] [data-dsh-iui-history-delete]`)', 'local revision delete row ready')
  check(await count('[data-dsh-iui-history-delete-error]'), 0, 'the displayed local revision offers a working delete')
  await click('[data-dsh-iui-history-revision="local-struct-2"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'local revision deletion confirmation')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('本地修订前旧版')`, 'stage follows the fallback to the older revision')
  const localState = await read(`window.__artifactVersionState('solo3')`)
  check(localState.latest, 'solo3-rev-1', 'the fallback revision becomes latest')
  check(localState.selected, 'solo3-rev-1', 'the fallback revision becomes selected')
  check(localState.stage, 'solo3', 'the same stage card survives the fallback')
  check(localState.redirected['solo3-rev-1'], 'local-struct-2', 'the fallback record remembers the deleted local revision')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-call-id')`), localStageCallId, 'M2 gate wiring: the local-revision fallback keeps the same stage card')
  check(await count('[data-dsh-iui-stage-card]'), 1, 'exactly one stage card remains after the local revision fallback')
  check(await count('[data-dsh-intelligent-ui="card"]'), 1, 'the stage card count is unchanged (no local card was mounted)')
  await wait('!document.querySelector("[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]")', 'local-revision fallback stage is read-only')
  check(await count('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]'), 0, 'the stage is read-only after the local revision fallback')
  await wait('!document.querySelector("[data-dsh-iui-history-count]")', 'the revision badge disappears after the fallback')
  check(await count('[data-dsh-iui-history-count]'), 0, 'the badge falls back to the initial revision (no number)')
  await read(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'local revision details closed')
  await read('window.__setArtifactStageEnabled(false)')

  // 56. Regression lock for renderedRevisionLocal. Unlike scenario 55, this local
  // revision is ALSO persisted in localStorage (so localRevisionIds contains it)
  // while its local card lives in an unrendered Turn (999). The stage displays it,
  // so treating the stage program as a local card would skip the fallback and leave
  // the redirected stage editable. Only the `callId === revisionId` formula passes.
  await read('window.__setArtifactStageEnabled(true)')
  await read('window.__resetCards()')
  await wait('!document.querySelector("[data-dsh-iui-stage-card]")', 'render-local stage cleared')
  await read('window.__forgetDeletedRevisions()')
  const RL_V1 = 'root = Col([Card([Title("存储本地修订旧版", "sm")])])'
  const RL_V2 = 'root = Col([Card([Title("存储本地修订当前版", "sm")])])'
  await read(`window.__setHistory('solo5', [
    { revisionId: 'local-struct-2', revision: 2, baseRevisionId: 'solo5-rev-1', title: '单卡存储本地修订', style: 'card', createdAt: 1763200011000, source: 'structure', hasProgram: true },
    { revisionId: 'solo5-rev-1', revision: 1, title: '单卡存储本地修订', style: 'card', createdAt: 1763200010000, source: 'initial', hasProgram: true },
  ], { 'solo5-rev-1': ${JSON.stringify(RL_V1)} })`)
  await read(`window.__appendRevision('solo5', ${JSON.stringify(RL_V1)}, { artifactId: 'solo5', revisionId: 'solo5-rev-1', revision: 1 }, '单卡存储本地修订')`)
  await read(`window.__appendLocalRevision({ artifactId: 'solo5', sourceRevisionId: 'solo5-rev-1', revisionId: 'local-struct-2', revision: 2, program: ${JSON.stringify(RL_V2)}, title: '单卡存储本地修订', kind: 'structure', turn: 999, registerStore: true })`)
  await wait('!!document.querySelector("[data-dsh-iui-stage-card][data-artifact-id=\\"solo5\\"]")', 'render-local stage card')
  await wait(`document.querySelectorAll('[data-dsh-intelligent-ui="card"]').length === 1`, 'the stored local revision has no mounted card (unrendered Turn)')
  check(await read(`(JSON.parse(localStorage.getItem('dsh-intelligent-ui-local-revisions:v1:e2e-session') ?? '[]')).some(item => item.revisionId === 'local-struct-2')`), true, 'the deleted revision is also stored in localStorage (localRevisionIds contains it)')
  await read(`window.__selectArtifactRevision('solo5', 'local-struct-2')`)
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('存储本地修订当前版')`, 'stage displays the stored local revision')
  check(await read(`window.__artifactVersionState('solo5').selected`), 'local-struct-2', 'the stored local revision is selected on the stage')
  const renderLocalStageCallId = await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-call-id')`)
  check(renderLocalStageCallId, 'solo5', 'the stage card identity is pinned before the stored local revision deletion')
  check(await text('[data-dsh-iui-history-count]'), '2', 'the stage badge shows the stored local revision number')
  const renderLocalTrigger = '[data-dsh-iui-stage-card] [data-dsh-iui-history-open][data-dsh-iui-version-open="true"]'
  await click(renderLocalTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'stored local revision details bar')
  await click('[data-dsh-iui-version-details]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'stored local revision details dialog')
  await wait('!!document.querySelector(`[data-dsh-iui-history-revision="local-struct-2"] [data-dsh-iui-history-delete]`)', 'stored local revision delete row ready')
  check(await count('[data-dsh-iui-history-delete-error]'), 0, 'the displayed stored local revision offers a working delete')
  await click('[data-dsh-iui-history-revision="local-struct-2"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'stored local revision deletion confirmation')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('存储本地修订旧版')`, 'stage follows the stored local revision fallback')
  const renderLocalState = await read(`window.__artifactVersionState('solo5')`)
  check(renderLocalState.latest, 'solo5-rev-1', 'the fallback revision becomes latest')
  check(renderLocalState.selected, 'solo5-rev-1', 'the fallback revision becomes selected')
  check(renderLocalState.stage, 'solo5', 'the same stage card survives the stored local revision fallback')
  check(renderLocalState.redirected['solo5-rev-1'], 'local-struct-2', 'the fallback record remembers the deleted stored local revision')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-call-id')`), renderLocalStageCallId, 'the stored local revision fallback keeps the same stage card')
  check(await count('[data-dsh-intelligent-ui="card"]'), 1, 'the card count is unchanged (no local card was mounted)')
  await wait('!document.querySelector("[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]")', 'stored local revision fallback stage is read-only')
  check(await count('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]'), 0, 'renderedRevisionLocal: the stage displaying a stored local revision stays read-only after the fallback')
  await wait('!document.querySelector("[data-dsh-iui-history-count]")', 'the stored local revision badge disappears after the fallback')
  check(await count('[data-dsh-iui-history-count]'), 0, 'the badge falls back to the initial revision (no number)')
  check(await read(`(JSON.parse(localStorage.getItem('dsh-intelligent-ui-local-revisions:v1:e2e-session') ?? '[]')).some(item => item.revisionId === 'local-struct-2')`), false, 'the stored local revision is removed with the deletion')
  await read(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait('!document.querySelector("[data-dsh-iui-history]")', 'stored local revision details closed')
  await read('window.__setArtifactStageEnabled(false)')

  // 57. Apply round with a queued structure operation, saved block requests and a
  // saved global instruction: one structure revision, then the remapped model
  // request is auto-submitted with new block ids.
  await read('window.__resetCards()')
  await wait('!document.querySelector("[data-dsh-intelligent-ui=\\"card\\"]")', 'cards cleared for the apply round')
  // Earlier scenarios leave detached drafts/chips in this chat; a real Send would
  // refuse those stale chips, so this scenario starts from a clean composer.
  await read('window.__clearEditDrafts()')
  await wait(`window.__input().occurrences.length === 0`, 'composer cleared before the pipeline scenario')
  const PIPE_PROGRAM = 'root = Col([Title("流水线样例", "md"), Text("第一段", "sm"), Text("第二段", "sm"), Divider(), Text("结尾", "sm")])'
  const PIPE_PROGRAM_AFTER = 'root = Col([Title("流水线样例", "md"), Text("第二段", "sm"), Divider(), Text("结尾", "sm")])'
  await read(`window.__addCard('pipeline-call-1', '流水线样例', ${JSON.stringify(PIPE_PROGRAM)})`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="pipeline-call-1"]\')', 'pipeline card')
  await read(`(() => {
    window.__pipelineCalls = [];
    window.__pipelineSavedFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      if (url.includes('/api/intelligent-ui/artifact-structure')) {
        const body = JSON.parse(init.body);
        window.__pipelineCalls.push(body);
        if (body.preview === true) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, preview: { program: ${JSON.stringify('root = Col([Title("流水线样例", "md"), Text("第二段", "sm"), Divider(), Text("结尾", "sm")])')}, operations: body.operations, changedBlockIds: ['b2'], touched: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        const result = {
          artifactId: 'pipeline-call-1',
          revisionId: 'pipeline-rev-2',
          baseRevisionId: body.baseRevisionId,
          revision: 2,
          operationId: body.operationId,
          program: ${JSON.stringify('root = Col([Title("流水线样例", "md"), Text("第二段", "sm"), Divider(), Text("结尾", "sm")])')},
          title: '流水线样例',
          style: 'card',
        };
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), { status: 201, headers: { 'content-type': 'application/json' } }));
      }
      return window.__pipelineSavedFetch(input, init);
    };
  })()`)
  await click('[data-dsh-iui-call-id="pipeline-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'pipeline editor')
  await clickBlock('b3')
  await wait('!!document.querySelector("[data-dsh-iui-edit-instruction]")', 'pipeline second-text editor')
  await saveInstruction('把第二段改短')
  await clickBlock('b5')
  await saveInstruction('结尾更简洁')
  await typeInto('[data-dsh-iui-edit-global]', '保持风格统一')
  await click('[data-dsh-iui-edit-global-save]')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b2"]')
  await click('[data-dsh-iui-edit-structure-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-structure-confirm-delete]")', 'pipeline delete confirmation')
  await click('[data-dsh-iui-edit-structure-confirm-delete]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'pipeline queued delete')
  const submitsBefore = await read('window.__submits ?? 0')
  const localBeforePipeline = await count('[data-dsh-iui-local-revision]')
  await applyPreviewOpen()
  check(await count('[data-dsh-iui-edit-apply-op]'), 1, 'pipeline preview lists the queued delete')
  check((await text('[data-dsh-iui-edit-apply-model-count]')), '2 项编辑需求', 'pipeline preview names the model edit requests')
  check((await text('[data-dsh-iui-edit-apply-model-global]')).includes('保持风格统一'), true, 'pipeline preview shows the saved global instruction')
  check((await text('[data-dsh-iui-edit-apply-preview-confirm]')), '应用并生成', 'a mixed Apply labels its confirm as apply-and-generate')
  await read('window.__sent = false; window.__sentText = ""')
  await applyPreviewConfirm()
  await wait(`document.querySelectorAll('[data-dsh-iui-local-revision]').length === ${localBeforePipeline + 1}`, 'pipeline structure revision card')
  await wait(`(window.__submits ?? 0) === ${submitsBefore + 1}`, 'model request auto-submitted')
  await wait(`document.querySelectorAll('[data-dsh-iui-local-revision]').length === ${localBeforePipeline + 1}`, 'pipeline structure revision card')
  await wait(`document.querySelector('[data-dsh-iui-edit-apply-notice]')?.getAttribute('data-notice') === 'submitted'`, 'auto-submit notice on the rekeyed draft')
  check((await text('[data-dsh-iui-edit-apply-notice]')).includes('已发送'), true, 'the notice reports the automatic send')
  check(await count('[data-dsh-iui-edit-pending-op]'), 0, 'the applied structure batch leaves the queue empty')
  // Phase A MAJOR-5: the send is only reported after the send path confirmed it,
  // so the consumed chip is gone and the actual sent text carries the remapped
  // request against the new revision.
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'pipeline editor closed after the confirmed send')
  await wait(`![...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('流水线样例'))`, 'consumed chip removed from the composer')
  check(await read('window.__sent'), true, 'the send path really ran for the auto-submitted request')
  const pipelineSent = await read('window.__sentText ?? ""')
  check(pipelineSent.includes('"baseRevisionId":"pipeline-rev-2"'), true, 'the sent request targets the new revision')
  check(pipelineSent.includes('"blockId":"b2"'), true, 'the first saved request was remapped onto the new block id')
  check(pipelineSent.includes('"blockId":"b4"'), true, 'the second saved request was remapped onto the new block id')
  check(pipelineSent.includes('"blockId":"b3"'), false, 'no saved request keeps its stale block id')
  check(pipelineSent.includes('保持风格统一'), true, 'the global instruction survives the rebase')
  check(pipelineSent.includes('Text("第二段", "sm")'), true, 'the request carries the post-structure program')
  check((await read('window.__pipelineCalls')).length, 2, 'the round sends exactly one dry-run and one apply, never a replay')
  await click('[data-dsh-iui-edit-apply-notice-dismiss]')
  await wait('!document.querySelector("[data-dsh-iui-edit-apply-notice]")', 'pipeline notice dismissed')
  await read('window.fetch = window.__pipelineSavedFetch; delete window.__pipelineSavedFetch')

  // 58. User prose in the composer keeps the model request manual: the chip and
  // the text stay in the composer and the panel explains what to do.
  await read(`window.__addCard('pipeline-call-2', '流水线手动样例', ${JSON.stringify(PIPE_PROGRAM)})`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="pipeline-call-2"]\')', 'manual pipeline card')
  await read(`(() => {
    window.__manualCalls = [];
    window.__manualSavedFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      if (url.includes('/api/intelligent-ui/artifact-structure')) {
        const body = JSON.parse(init.body);
        window.__manualCalls.push(body);
        if (body.preview === true) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, preview: { program: ${JSON.stringify('root = Col([Title("流水线样例", "md"), Text("第二段", "sm"), Divider(), Text("结尾", "sm")])')}, operations: body.operations, changedBlockIds: ['b2'], touched: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        const result = {
          artifactId: 'pipeline-call-2',
          revisionId: 'pipeline2-rev-2',
          baseRevisionId: body.baseRevisionId,
          revision: 2,
          operationId: body.operationId,
          program: ${JSON.stringify('root = Col([Title("流水线样例", "md"), Text("第二段", "sm"), Divider(), Text("结尾", "sm")])')},
          title: '流水线手动样例',
          style: 'card',
        };
        return Promise.resolve(new Response(JSON.stringify({ ok: true, result }), { status: 201, headers: { 'content-type': 'application/json' } }));
      }
      return window.__manualSavedFetch(input, init);
    };
  })()`)
  await click('[data-dsh-iui-call-id="pipeline-call-2"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'manual pipeline editor')
  await clickBlock('b3')
  await saveInstruction('第二段更短')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b2"]')
  await click('[data-dsh-iui-edit-structure-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-structure-confirm-delete]")', 'manual delete confirmation')
  await click('[data-dsh-iui-edit-structure-confirm-delete]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'manual queued delete')
  const manualSubmitsBefore = await read('window.__submits ?? 0')
  await applyPreviewOpen()
  await read(`window.__setDraft('请同时解释这次删改的原因')`)
  await applyPreviewConfirm()
  await wait(`document.querySelector('[data-dsh-iui-edit-apply-notice]')?.getAttribute('data-notice') === 'extraText'`, 'manual-send notice')
  check((await read('window.__submits ?? 0')), manualSubmitsBefore, 'user prose prevents the automatic send')
  check((await text('[data-dsh-iui-edit-apply-notice]')).includes('请手动发送'), true, 'the manual notice explains the fallback')
  check((await read('window.__input().draft')).includes('请同时解释这次删改的原因'), true, 'the user prose stays in the composer')
  check(await read(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('流水线手动样例 · 修订 2'))`), true, 'the rekeyed chip stays in the composer')
  await click('[data-dsh-iui-edit-apply-notice-dismiss]')
  await wait('!document.querySelector("[data-dsh-iui-edit-apply-notice]")', 'manual notice dismissed')
  check(await count('[data-dsh-iui-edit-apply-notice]'), 0, 'dismissing removes the manual notice')
  const manualEnvelope = await read(`window.__serializeChipMatching('流水线手动样例')`)
  check(manualEnvelope.includes('"baseRevisionId":"pipeline2-rev-2"'), true, 'the manual chip still serializes against the new revision')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'manual pipeline editor closed at send')
  await read('window.fetch = window.__manualSavedFetch; delete window.__manualSavedFetch')

  // 59. Queued structure operations survive a reload (persisted draft record).
  await read('sessionStorage.clear()')
  await cdp.send('Page.reload', { ignoreCache: true })
  await wait('document.readyState === "complete"', 'queue persistence reload')
  await wait('!!document.querySelector("[data-dsh-iui-edit-entry]")', 'queue persistence harness ready')
  await click('[data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'queue persistence editor')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b1"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'queue persistence op')
  await new Promise(resolve => setTimeout(resolve, 500))
  await cdp.send('Page.reload', { ignoreCache: true })
  await wait('document.readyState === "complete"', 'queue persistence reloaded')
  await wait('!!document.querySelector("[data-dsh-iui-edit-entry]")', 'queue persistence ready again')
  await wait(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].length >= 1`, 'queue persistence chip')
  await click('[data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'queue persistence editor restored')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'queued op restored after reload')
  check((await pendingOpLabels())[0].includes('复制'), true, 'the restored queue row keeps its operation')
  check((await text('[data-dsh-iui-edit-pending-count]')).includes('1'), true, 'the restored pending section counts the operation')
  await click('[data-dsh-iui-edit-pending-op-remove]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 0`, 'queue persistence op removed')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'queue persistence editor closed')

  // 60. Conflicts block Apply before any Host request: a delete that would remove
  // a still-referenced block, a duplicated queue entry, and mixed style+structure.
  await read('window.__resetCards()')
  await read(`window.__addCard('conflict-call-1', '冲突样例', ${JSON.stringify('root = Col([Title("冲突样例", "md"), Text("第一段", "sm"), Text("第二段", "sm")])')})`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="conflict-call-1"]\')', 'conflict card')
  await read(`(() => {
    window.__conflictCalls = [];
    window.__conflictSavedFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      if (url.includes('/api/intelligent-ui/artifact-structure')) window.__conflictCalls.push(JSON.parse(init.body));
      return window.__conflictSavedFetch(input, init);
    };
  })()`)
  await click('[data-dsh-iui-call-id="conflict-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'conflict editor')
  await clickBlock('b2')
  await saveInstruction('保留这段的编辑')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b2"]')
  await click('[data-dsh-iui-edit-structure-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-structure-confirm-delete]")', 'conflict delete confirmation')
  await click('[data-dsh-iui-edit-structure-confirm-delete]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'conflict queued delete')
  await applyPreviewOpen()
  await wait('!!document.querySelector("[data-dsh-iui-edit-apply-conflicts]")', 'selection conflict list')
  check(await count('[data-dsh-iui-edit-apply-conflict]') >= 1, true, 'the preview lists the blocking selection conflict')
  check((await text('[data-dsh-iui-edit-apply-conflicts]')).includes('编辑需求'), true, 'the conflict explains the saved edit request')
  check(await read(`document.querySelector('[data-dsh-iui-edit-apply-preview-confirm]').disabled`), true, 'conflicts disable the Apply confirm')
  check((await text('[data-dsh-iui-edit-apply-preview-confirm]')), '存在冲突，暂时不能应用', 'the disabled confirm explains the block')
  check((await read('window.__conflictCalls')).length, 0, 'a conflicting round sends no Host request')
  await applyPreviewCancel()
  await click('[data-dsh-iui-edit-pending-op-remove]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 0`, 'conflict queue cleared')
  // Duplicate queue entries are rejected the same way.
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b1"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b1"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 2`, 'duplicated queue entries')
  await applyPreviewOpen()
  await wait('!!document.querySelector("[data-dsh-iui-edit-apply-conflicts]")', 'duplicate conflict list')
  check(await count('[data-dsh-iui-edit-apply-conflict]') >= 1, true, 'the duplicate conflict uses the shared conflict list')
  check(await read(`[...document.querySelectorAll('[data-dsh-iui-edit-apply-conflict]')].some(el => el.getAttribute('data-kind') === 'duplicate')`), true, 'the duplicate queue entry is reported as a conflict')
  await applyPreviewCancel()
  await click('[data-dsh-iui-edit-pending-clear]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 0`, 'duplicate queue cleared')
  // A style instruction cannot be mixed with structure operations.
  await read('window.__project({ styleEdit: true })')
  await wait('!!document.querySelector("[data-dsh-iui-edit-style-toggle]")', 'conflict style section')
  await click('[data-dsh-iui-edit-style-toggle]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-style]")', 'conflict style field')
  // The style disclosure moves focus into its field on the next frame; let that
  // settle so it cannot steal focus from the row menu opened right after.
  await wait('document.activeElement?.hasAttribute("data-dsh-iui-edit-style") === true', 'conflict style focus settled')
  await typeInto('[data-dsh-iui-edit-style]', '整体更简洁')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b1"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'style mixed queued op')
  await applyPreviewOpen()
  await wait('!!document.querySelector("[data-dsh-iui-edit-apply-conflicts]")', 'style conflict list')
  check(await read(`[...document.querySelectorAll('[data-dsh-iui-edit-apply-conflict]')].some(el => el.getAttribute('data-kind') === 'styleMixed')`), true, 'the mixed style instruction is reported as a conflict')
  await applyPreviewCancel()
  await click('[data-dsh-iui-edit-style-clear]')
  await click('[data-dsh-iui-edit-pending-op-remove]')
  await read('window.__project({ styleEdit: false })')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'conflict editor closed')
  await read('window.fetch = window.__conflictSavedFetch; delete window.__conflictSavedFetch')

  // 61. Deep dashboard page (depth 6, 83 CST nodes, the shape of the real page
  // that used to be rejected by MAX_CST_DEPTH=4): the root batch previews
  // without conflicts and applies as exactly one structure revision.
  await read('window.__resetCards()')
  await read('window.__addDeepDashboardCard()')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="deep-call-1"]\')', 'deep dashboard card')
  await read(structureMockScript(structureBridge.url, {
    calls: '__deepCalls', chain: '__deepPreviousFetch', program: DEEP_DASHBOARD_PROGRAM,
    artifactId: 'deep-call-1', title: DEEP_DASHBOARD_TITLE, revisionId: 'struct_deep_1',
  }))
  await click('[data-dsh-iui-call-id="deep-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'deep dashboard editor')
  check(await count('[data-dsh-iui-edit-arrangement-row]'), 7, 'the deep page lists its seven root blocks')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b3"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'deep page queued duplicate')
  const localBeforeDeep = await count('[data-dsh-iui-local-revision]')
  await applyPreviewOpen()
  check(await count('[data-dsh-iui-edit-apply-conflict]'), 0, 'the deep page preview has no conflict')
  check(await count('[data-dsh-iui-edit-apply-op]'), 1, 'the deep page preview lists the duplicate')
  await shot('harness-deep-page-preview.png')
  await applyPreviewConfirm()
  await wait(`document.querySelectorAll('[data-dsh-iui-local-revision]').length === ${localBeforeDeep + 1}`, 'deep page structural revision')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'deep page editor closed')
  const deepCalls = await read('window.__deepCalls')
  check(deepCalls.length, 2, 'the deep page sends one dry-run and one apply')
  check(deepCalls[0].preview, true, 'the deep page first request is the dry run')
  check(deepCalls[1].preview === undefined, true, 'the deep page second request is the apply')
  check(deepCalls[1].operations[0].op, 'duplicate', 'the deep page applies the root duplicate')
  await read('window.fetch = window.__deepPreviousFetch; delete window.__deepPreviousFetch; delete window.__deepCalls')

  // 62. A page nested past the supported depth (11 levels) must report an
  // accurate depth conflict, not the misleading "no longer in this revision",
  // and must never send a Host request. Nested moves get their own copy.
  await read('window.__resetCards()')
  await read('window.__addVeryDeepCard()')
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="very-deep-call-1"]\')', 'very deep card')
  await read(`(() => {
    window.__veryDeepCalls = [];
    window.__veryDeepSavedFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : String(input?.url ?? '');
      if (url.includes('/api/intelligent-ui/artifact-structure')) window.__veryDeepCalls.push(JSON.parse(init.body));
      return window.__veryDeepSavedFetch(input, init);
    };
  })()`)
  await click('[data-dsh-iui-call-id="very-deep-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'very deep editor')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b1"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'very deep queued duplicate')
  await applyPreviewOpen()
  await wait('!!document.querySelector("[data-dsh-iui-edit-apply-conflicts]")', 'very deep depth conflict')
  check(await read(`[...document.querySelectorAll('[data-dsh-iui-edit-apply-conflict]')].some(el => el.getAttribute('data-kind') === 'depth')`), true, 'the very deep page reports a depth conflict')
  check((await text('[data-dsh-iui-edit-apply-conflicts]')).includes('层级过深'), true, 'the depth conflict explains the nesting limit')
  check((await text('[data-dsh-iui-edit-apply-conflicts]')).includes('已不在当前修订中'), false, 'the conflict is not the misleading missing-block copy')
  check(await read(`document.querySelector('[data-dsh-iui-edit-apply-preview-confirm]').disabled`), true, 'the depth conflict disables Apply')
  check((await read('window.__veryDeepCalls')).length, 0, 'the depth conflict sends no Host request')
  await applyPreviewCancel()
  await click('[data-dsh-iui-edit-pending-op-remove]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 0`, 'very deep queue cleared')
  await read(`window.__queueStructureOp('very-deep-call-1', { op: 'move', blockId: 'b1', targetParentBlockId: 'b2' })`)
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'very deep queued nested move')
  await applyPreviewOpen()
  await wait('!!document.querySelector("[data-dsh-iui-edit-apply-conflicts]")', 'very deep nested-target conflict')
  check(await read(`[...document.querySelectorAll('[data-dsh-iui-edit-apply-conflict]')].some(el => el.getAttribute('data-kind') === 'nestedTarget')`), true, 'the nested move reports the nested-target conflict')
  check((await text('[data-dsh-iui-edit-apply-conflicts]')).includes('暂不支持移动到嵌套容器'), true, 'the nested-target conflict explains the depth limitation')
  check(await read(`document.querySelector('[data-dsh-iui-edit-apply-preview-confirm]').disabled`), true, 'the nested-target conflict disables Apply')
  check((await read('window.__veryDeepCalls')).length, 0, 'the nested-target conflict sends no Host request')
  await applyPreviewCancel()
  await click('[data-dsh-iui-edit-pending-op-remove]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 0`, 'very deep move queue cleared')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'very deep editor closed')
  await read('window.fetch = window.__veryDeepSavedFetch; delete window.__veryDeepSavedFetch; delete window.__veryDeepCalls')

  // 63. MAJOR-1 end-to-end: two identical untitled Text blocks; duplicate the
  // first while a saved request sits on the second. The remapped request must
  // stay on the original second block (b3), never on the inserted copy (b2).
  await read('window.__resetCards()')
  await read('window.__clearEditDrafts()')
  await wait(`window.__input().occurrences.length === 0`, 'composer cleared before the identical-duplicate scenario')
  const IDENTICAL_PROGRAM = 'root = Col([Text("x"), Text("x")])'
  await read(`window.__addCard('identical-call-1', '同签名样例', ${JSON.stringify(IDENTICAL_PROGRAM)})`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="identical-call-1"]\')', 'identical blocks card')
  await read(structureMockScript(structureBridge.url, {
    calls: '__identicalCalls', chain: '__identicalPreviousFetch', program: IDENTICAL_PROGRAM,
    artifactId: 'identical-call-1', title: '同签名样例', revisionId: 'struct_identical_1',
  }))
  await click('[data-dsh-iui-call-id="identical-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'identical blocks editor')
  await clickBlock('b2')
  await saveInstruction('第二块的需求')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b1"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'identical duplicate queued')
  const identicalSubmitsBefore = await read('window.__submits ?? 0')
  await applyPreviewOpen()
  check(await count('[data-dsh-iui-edit-apply-conflict]'), 0, 'the identical-text duplicate maps reliably')
  await read('window.__sent = false; window.__sentText = ""')
  await applyPreviewConfirm()
  await wait(`(window.__submits ?? 0) === ${identicalSubmitsBefore + 1}`, 'identical duplicate auto-submits the model request')
  const identicalEnvelope = await read('window.__sentText ?? ""')
  check(identicalEnvelope.includes('"blockId":"b3"'), true, 'the saved request follows the original second block')
  check(identicalEnvelope.includes('"blockId":"b2"'), false, 'the saved request never lands on the duplicated copy')
  check(identicalEnvelope.includes('第二块的需求'), true, 'the request keeps its instruction')
  await wait(`document.querySelector('[data-dsh-iui-edit-apply-notice]')?.getAttribute('data-notice') === 'submitted'`, 'identical duplicate reports the confirmed send')
  check(await read('window.__sent'), true, 'the identical duplicate send path really ran')
  await read('window.fetch = window.__identicalPreviousFetch; delete window.__identicalPreviousFetch; delete window.__identicalCalls')

  // 64. MAJOR-2 end-to-end: the 21st queued operation is refused with visible
  // copy; the queue and the saved model content are untouched.
  await read('window.__resetCards()')
  const LIMIT_PROGRAM = 'root = Col([Title("队列上限", "md"), Text("一", "sm"), Text("二", "sm")])'
  await read(`window.__addCard('limit-call-1', '队列上限样例', ${JSON.stringify(LIMIT_PROGRAM)})`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="limit-call-1"]\')', 'queue limit card')
  await click('[data-dsh-iui-call-id="limit-call-1"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'queue limit editor')
  await clickBlock('b2')
  await saveInstruction('保留的编辑需求')
  await typeInto('[data-dsh-iui-edit-global]', '保留整体说明')
  await click('[data-dsh-iui-edit-global-save]')
  for (let index = 0; index < 20; index += 1) {
    await read(`window.__queueStructureOp('limit-call-1', { op: 'delete', blockId: 'b1' })`)
  }
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 20`, 'twenty queued operations')
  await rowMenu('[data-dsh-iui-edit-arrangement-row][data-block-id="b1"]')
  await click('[data-dsh-iui-edit-structure-duplicate]')
  await wait(`document.querySelector('[data-dsh-iui-edit-apply-error]')?.textContent.includes('20') === true`, 'queue limit copy shown')
  check(await count('[data-dsh-iui-edit-pending-op]'), 20, 'the refused 21st operation is not queued')
  check((await text('[data-dsh-iui-edit-apply-error]')).includes('最多 20 项'), true, 'the inline error explains the cap')
  await wait(`document.querySelector('[data-dsh-iui-edit-live]')?.textContent.includes('最多 20 项') === true`, 'queue limit announced')
  check(await read(`document.querySelector('[data-dsh-iui-edit-live]')?.textContent.includes('最多 20 项') === true`), true, 'the cap is announced through the live region')
  check((await text('[data-dsh-iui-edit-request-list]')).includes('保留的编辑需求'), true, 'the saved block request survives the refusal')
  check((await read(`document.querySelector('[data-dsh-iui-edit-global]')?.value ?? ''`)).includes('保留整体说明'), true, 'the saved global instruction survives the refusal')
  check((await text('[data-dsh-iui-edit-global-state]')).includes('已保存'), true, 'the global instruction stays saved after the refusal')
  await click('[data-dsh-iui-edit-pending-clear]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 0`, 'queue limit queue cleared')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'queue limit editor closed')

  // 65. Phase A BLOCKER-1: a nested-mode draft survives a structure Apply with
  // its nested table/order, and the remapped nested request stays serializable.
  await read('window.__clearEditDrafts()')
  await read('window.__resetCards()')
  const NESTED_APPLY_PROGRAM_E2E = `root = Col([a, b])
a = Card([Title("A", "sm"), Text("one", "sm")])
b = Card([Title("B", "sm"), Text("two", "sm")])`
  await read(`window.__addCard('nested-apply-e2e', '嵌套应用样例', ${JSON.stringify(NESTED_APPLY_PROGRAM_E2E)})`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="nested-apply-e2e"]\')', 'nested apply card')
  await read(structureMockScript(structureBridge.url, {
    calls: '__nestedApplyCalls', chain: '__nestedApplyPreviousFetch', program: NESTED_APPLY_PROGRAM_E2E,
    artifactId: 'nested-apply-e2e', title: '嵌套应用样例', revisionId: 'nested-apply-rev-2',
  }))
  await click('[data-dsh-iui-call-id="nested-apply-e2e"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'nested apply editor')
  await click('[data-dsh-iui-edit-nested]')
  await wait(`!!document.querySelector('[data-dsh-iui-edit-nested-row][data-block-id="b1.2"]')`, 'nested rows after the mode toggle')
  await clickBlock('b1.1')
  await wait('!!document.querySelector("[data-dsh-iui-edit-popover]")', 'nested instruction popover')
  await saveInstruction('嵌套请求保留')
  await rowMenu('[data-dsh-iui-edit-nested-row][data-block-id="b1.2"]')
  await click('[data-dsh-iui-edit-structure-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-structure-confirm-delete]")', 'nested delete confirmation')
  await click('[data-dsh-iui-edit-structure-confirm-delete]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'nested delete queued')
  const nestedSubmitsBefore = await read('window.__submits ?? 0')
  // Composer prose keeps the remapped nested request manual, so the rekeyed
  // draft and its nested panel stay inspectable.
  await read(`window.__appendDraft('先保留这条嵌套说明')`)
  await applyPreviewOpen('nested apply preview')
  check(await count('[data-dsh-iui-edit-apply-op]'), 1, 'the nested preview lists the queued delete')
  await applyPreviewConfirm()
  await wait('!!document.querySelector("[data-dsh-iui-local-revision]")', 'nested apply revision card')
  await wait(`document.querySelector('[data-dsh-iui-edit-apply-notice]')?.getAttribute('data-notice') === 'extraText'`, 'nested apply manual notice')
  check(await read('window.__submits ?? 0'), nestedSubmitsBefore, 'user prose keeps the nested request manual')
  check(await count('[data-dsh-iui-edit-request-list]'), 1, 'the nested panel remounts on the rekeyed draft')
  check((await text('[data-dsh-iui-edit-mode-state]')).includes('嵌套'), true, 'nested mode survives the rebase')
  check(await count('[data-dsh-iui-edit-nested-row][data-block-id="b1.1"]'), 1, 'the remapped nested selection stays in the nested table')
  check(await count('[data-dsh-iui-edit-nested-row][data-block-id="b1.2"]'), 0, 'the deleted nested child is gone')
  check(await count('[data-dsh-iui-edit-nested-row][data-block-id="b2.2"]'), 1, 'an unchanged nested group keeps all of its rows')
  check((await text('[data-dsh-iui-edit-request-list]')).includes('嵌套请求保留'), true, 'the remapped nested request is listed')
  const nestedApplyEnvelope = await read(`window.__serializeChipMatching('嵌套应用样例').then(text => text, error => String(error))`)
  check(nestedApplyEnvelope.includes('"blockId":"b1.1"'), true, 'the nested envelope carries the remapped display id')
  check(nestedApplyEnvelope.includes('"nodeId"'), true, 'the nested envelope carries the nested CST node id')
  check(nestedApplyEnvelope.includes('"parentBlockId":"b1"'), true, 'the nested envelope carries its parent block id')
  check(nestedApplyEnvelope.includes('嵌套请求保留'), true, 'the nested envelope keeps the instruction')
  check(nestedApplyEnvelope.includes('"baseRevisionId":"nested-apply-rev-2'), true, 'the nested envelope targets the new revision')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'nested editor closed after the manual send')
  await read(`document.querySelector('[data-dsh-iui-edit-apply-notice-dismiss]')?.click()`)
  await read('window.fetch = window.__nestedApplyPreviousFetch; delete window.__nestedApplyPreviousFetch; delete window.__nestedApplyCalls')

  // 66. Phase A MAJOR-2: a normal Send never silently drops an unapplied queue.
  await read('window.__clearEditDrafts()')
  await read('window.__resetCards()')
  const SEND_QUEUE_PROGRAM_E2E = 'root = Col([Title("队列发送样例", "md"), Text("一", "sm"), Text("二", "sm")])'
  await read(`window.__addCard('send-queue-e2e', '队列发送样例', ${JSON.stringify(SEND_QUEUE_PROGRAM_E2E)})`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="send-queue-e2e"]\')', 'send queue card')
  await click('[data-dsh-iui-call-id="send-queue-e2e"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'send queue editor')
  await clickBlock('b2')
  await saveInstruction('保留的发送修改')
  await rowMenu(arrangementSelector('b3'))
  await click('[data-dsh-iui-edit-structure-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-structure-confirm-delete]")', 'send queue delete confirmation')
  await click('[data-dsh-iui-edit-structure-confirm-delete]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'send queue delete queued')
  const queueSendSubmitsBefore = await read('window.__submits ?? 0')
  const blockedSend = await read(`window.__serializeChip().then(() => null, error => String(error))`)
  check(blockedSend.includes('还有未应用的结构操作'), true, 'a normal Send is refused while the queue is pending')
  check(await read('window.__submits ?? 0'), queueSendSubmitsBefore, 'the refused Send never reaches the send path')
  check(await count('[data-dsh-iui-edit-pending-op]'), 1, 'the queue survives the refused Send')
  check((await text('[data-dsh-iui-edit-draft-switcher]')).includes('结构操作 1 项'), true, 'the dock still reports the queued operation')
  check((await text('[data-chip="artifact-edit"]')).includes('队列发送样例'), true, 'the chip stays in the composer')
  await click('[data-dsh-iui-edit-pending-clear]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 0`, 'send queue cleared')
  const queueClearedSend = await read('window.__serializeChip()')
  check(queueClearedSend.includes('"blockId":"b2"'), true, 'the cleared draft serializes its saved request')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'send closes after the queue is cleared')

  // 67. Phase A MAJOR-3: Apply preserves a detached draft (no chip, no send).
  await read('window.__clearEditDrafts()')
  await read('window.__resetCards()')
  const DETACH_APPLY_PROGRAM_E2E = 'root = Col([Title("分离应用样例", "md"), Text("一", "sm"), Text("二", "sm")])'
  await read(`window.__addCard('detach-apply-e2e', '分离应用样例', ${JSON.stringify(DETACH_APPLY_PROGRAM_E2E)})`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="detach-apply-e2e"]\')', 'detached apply card')
  await read(structureMockScript(structureBridge.url, {
    calls: '__detachApplyCalls', chain: '__detachApplyPreviousFetch', program: DETACH_APPLY_PROGRAM_E2E,
    artifactId: 'detach-apply-e2e', title: '分离应用样例', revisionId: 'detach-apply-rev-2',
  }))
  await click('[data-dsh-iui-call-id="detach-apply-e2e"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'detached apply editor')
  await clickBlock('b2')
  await saveInstruction('分离后仍保留')
  await wait(`[...document.querySelectorAll('[data-chip="artifact-edit"]')].some(el => (el.getAttribute('data-chip-label') ?? '').includes('分离应用样例'))`, 'detached apply chip')
  await read(`(() => { const item = window.__input().occurrences.find(entry => entry.source === 'artifact-edit' && entry.label.includes('分离应用样例')); if (item) window.__deleteChip(item.ref); return true })()`)
  await wait('!!document.querySelector("[data-dsh-iui-draft-detached]")', 'detached notice after deleting the chip')
  await rowMenu(arrangementSelector('b3'))
  await click('[data-dsh-iui-edit-structure-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-structure-confirm-delete]")', 'detached delete confirmation')
  await click('[data-dsh-iui-edit-structure-confirm-delete]')
  await wait(`document.querySelectorAll('[data-dsh-iui-edit-pending-op]').length === 1`, 'detached delete queued')
  const detachSubmitsBefore = await read('window.__submits ?? 0')
  await applyPreviewOpen('detached apply preview')
  await applyPreviewConfirm()
  await wait('!!document.querySelector("[data-dsh-iui-local-revision]")', 'detached apply revision card')
  await wait(`document.querySelector('[data-dsh-iui-edit-apply-notice]')?.getAttribute('data-notice') === 'detached'`, 'detached notice for the rekeyed draft')
  check(await read('window.__submits ?? 0'), detachSubmitsBefore, 'a detached draft never auto-sends')
  check(await count('[data-chip="artifact-edit"]'), 0, 'no chip is re-inserted for the detached draft')
  await wait(`!!document.querySelector('[data-dsh-iui-edit-draft-row][data-attached="false"]')`, 'detached draft row in the dock')
  check((await text('[data-dsh-iui-edit-request-list]')).includes('分离后仍保留'), true, 'the request survived the rebase')
  await click('[data-dsh-iui-edit-draft-row][data-attached="false"] [data-dsh-iui-edit-draft-attach]')
  await wait('!!document.querySelector(\'[data-chip="artifact-edit"]\')', 'chip returns after the explicit attach')
  const detachedEnvelope = await read(`window.__serializeChipMatching('分离应用样例')`)
  check(detachedEnvelope.includes('"baseRevisionId":"detach-apply-rev-2'), true, 'the attached request targets the new revision')
  check(detachedEnvelope.includes('分离后仍保留'), true, 'the attached request keeps its instruction')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'detached editor closes after the manual send')
  await read('window.fetch = window.__detachApplyPreviousFetch; delete window.__detachApplyPreviousFetch; delete window.__detachApplyCalls')

  // 68. Phase A MAJOR-5: a zero-op Apply preview validates the model contract
  // and disables confirm for a stale base; branch mode clears the blocker.
  await read('window.__clearEditDrafts()')
  await read('window.__resetCards()')
  await read(`window.__addCard('conflict-preview-e2e', '冲突预览样例')`)
  await wait('!!document.querySelector(\'[data-dsh-iui-call-id="conflict-preview-e2e"]\')', 'conflict preview card')
  await click('[data-dsh-iui-call-id="conflict-preview-e2e"] [data-dsh-iui-edit-entry]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'conflict preview editor')
  // Save the model request while the draft is editable, then move the base head
  // so the same draft becomes a stale conflict.
  await openArrangementEditor('b3')
  await saveInstruction('冲突下的修改')
  await read('window.__conflict = true; window.dispatchEvent(new Event("focus"))')
  await wait('!!document.querySelector("[data-dsh-iui-edit-conflict]")', 'conflict banner before the preview')
  await applyPreviewOpen('conflict apply preview')
  check(await read(`[...document.querySelectorAll('[data-dsh-iui-edit-apply-conflict]')].some(el => el.getAttribute('data-kind') === 'stale')`), true, 'the zero-op preview reports the stale base')
  check(await read(`document.querySelector('[data-dsh-iui-edit-apply-preview-confirm]').disabled`), true, 'the stale conflict disables the confirm button')
  await applyPreviewCancel()
  await click('[data-dsh-iui-edit-branch]')
  await wait('!!document.querySelector("[data-dsh-iui-edit-branch-note]")', 'branch note after turning the conflict into a branch')
  await applyPreviewOpen('branch apply preview')
  check(await count('[data-dsh-iui-edit-apply-conflict]'), 0, 'a branch draft has no stale conflict in the preview')
  await applyPreviewCancel()
  await read('window.__conflict = false')
  await click('[data-dsh-iui-edit-exit-panel]')
  await wait('!document.querySelector("[data-dsh-iui-edit-view]")', 'conflict preview editor closed')
  await read('window.__clearEditDrafts()')

  // 69. Phase B MAJOR-4: deleting the displayed old revision selects the
  // rollback target named by the confirmation (not the newer latest revision),
  // the stage is read-only while it displays that fallback target, and selecting
  // another revision restores editing instead of keeping the card read-only.
  await read('window.__setArtifactStageEnabled(true)')
  await read('window.__resetCards()')
  await wait('!document.querySelector("[data-dsh-iui-stage-card]")', 'fallback-selection stage cleared')
  await read('window.scrollTo(0, 0)')
  const FS_V1 = 'root = Col([Card([Title("回退选择旧版", "sm")])])'
  const FS_V2 = 'root = Col([Card([Title("回退选择当前版", "sm")])])'
  const FS_V3 = 'root = Col([Card([Title("回退选择更新版", "sm")])])'
  await read(`window.__setHistory('fallback-select', [
    { revisionId: 'fallback-select-rev-3', revision: 3, baseRevisionId: 'fallback-select-rev-1', title: '回退选择样例', style: 'card', createdAt: 1763200023000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'] },
    { revisionId: 'fallback-select-rev-2', revision: 2, baseRevisionId: 'fallback-select-rev-1', title: '回退选择样例', style: 'card', createdAt: 1763200022000, source: 'edit', hasProgram: true, editedBlockIds: ['b1'] },
    { revisionId: 'fallback-select-rev-1', revision: 1, title: '回退选择样例', style: 'card', createdAt: 1763200021000, source: 'initial', hasProgram: true },
  ], { 'fallback-select-rev-1': ${JSON.stringify(FS_V1)}, 'fallback-select-rev-2': ${JSON.stringify(FS_V2)} })`)
  // The revision-2 card becomes the stage; the revision-3 card stays a notice so
  // the stage card itself owns the revision this scenario displays and deletes.
  await read(`window.__appendRevision('fallback-select-call-2', ${JSON.stringify(FS_V2)}, { artifactId: 'fallback-select', revisionId: 'fallback-select-rev-2', revision: 2, baseRevisionId: 'fallback-select-rev-1', editedBlockIds: ['b1'] }, '回退选择样例')`)
  await wait('!!document.querySelector("[data-dsh-iui-stage-card][data-artifact-id=\\"fallback-select\\"]")', 'fallback selection stage card')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-stage-visible') === 'true'`, 'fallback selection stage visible')
  await read(`window.__appendRevision('fallback-select-call-3', ${JSON.stringify(FS_V3)}, { artifactId: 'fallback-select', revisionId: 'fallback-select-rev-3', revision: 3, baseRevisionId: 'fallback-select-rev-1', editedBlockIds: ['b1'] }, '回退选择样例')`)
  await wait(`window.__artifactVersionState('fallback-select').selected === 'fallback-select-rev-3'`, 'newer revision selected after registration')
  check(await read(`document.querySelector('[data-dsh-iui-stage-card]').getAttribute('data-dsh-iui-call-id')`), 'fallback-select-call-2', 'the revision-2 card keeps the stage while a newer revision is a notice')
  check(await count('[data-dsh-iui-revision-notice]'), 1, 'the newer revision is one notice row')
  // Display the old revision 2 through the version bar, then delete it.
  const fallbackSelectTrigger = '[data-dsh-iui-stage-card] [data-dsh-iui-history-open][data-dsh-iui-version-open="true"]'
  await click(fallbackSelectTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'fallback selection version bar')
  await wait('!!document.querySelector(\'[data-dsh-iui-version-item][data-revision="2"]\')', 'fallback selection revision-2 item')
  await click('[data-dsh-iui-version-item][data-revision="2"]')
  await wait('!document.querySelector("[data-dsh-iui-version-bar]")', 'fallback selection bar closed')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('回退选择当前版')`, 'stage displays the old revision 2')
  check(await read(`window.__artifactVersionState('fallback-select').selected`), 'fallback-select-rev-2', 'revision 2 is selected on the stage')
  await click(fallbackSelectTrigger)
  await wait('!!document.querySelector("[data-dsh-iui-version-bar]")', 'fallback selection details bar')
  await click('[data-dsh-iui-version-details]')
  await wait('!!document.querySelector("[data-dsh-iui-history]")', 'fallback selection details dialog')
  await wait('!!document.querySelector(`[data-dsh-iui-history-revision="fallback-select-rev-2"] [data-dsh-iui-history-delete]`)', 'fallback selection delete row ready')
  await click('[data-dsh-iui-history-revision="fallback-select-rev-2"] [data-dsh-iui-history-delete]')
  await wait('!!document.querySelector("[data-dsh-iui-history-delete-warning]")', 'fallback selection deletion confirmation')
  check((await text('[data-dsh-iui-history-delete-warning]')).includes('回退到修订 1'), true, 'the confirmation names revision 1 as the rollback target')
  await click('[data-dsh-iui-history-delete-confirm]')
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('回退选择旧版')`, 'stage follows the documented fallback to revision 1')
  const fallbackSelectionState = await read(`window.__artifactVersionState('fallback-select')`)
  check(fallbackSelectionState.selected, 'fallback-select-rev-1', 'MAJOR-4: the deleted displayed revision selects the rollback target, not latest revision 3')
  check(fallbackSelectionState.latest, 'fallback-select-rev-3', 'the newer revision stays latest')
  check(fallbackSelectionState.redirected['fallback-select-rev-1'], 'fallback-select-rev-2', 'the fallback record remembers the deleted revision')
  check(await count('[data-dsh-iui-stage-card]'), 1, 'the fallback keeps exactly one stage card')
  await wait('!document.querySelector("[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]")', 'fallback target display is read-only')
  check(await count('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]'), 0, 'the stage displaying the fallback target is read-only')
  // Selecting another revision restores the edit entry: the fallback marker only
  // belongs to the revision the card actually fell back to.
  await read(`window.__selectArtifactRevision('fallback-select', 'fallback-select-rev-3')`)
  await wait(`document.querySelector('[data-dsh-iui-stage-card]').textContent.includes('回退选择更新版')`, 'stage switches back to the newer revision')
  await wait('!!document.querySelector("[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]")', 'selecting another revision restores the edit entry')
  check(await count('[data-dsh-iui-stage-card] [data-dsh-iui-edit-entry]'), 1, 'MAJOR-4: selecting another revision restores editability (no permanent read-only fallback)')
  check(await read(`window.__artifactVersionState('fallback-select').stage`), 'fallback-select-call-2', 'the redirected stage card keeps its identity')
  await read('window.__setArtifactStageEnabled(false)')

  console.log(`artifact-edit e2e: ${checks} checks passed`)
} finally {
  try { cdp?.close() } catch { /* already closed */ }
  await browser?.cleanup()
  server?.close()
  structureBridge.close()
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
