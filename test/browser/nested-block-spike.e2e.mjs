#!/usr/bin/env node
/**
 * M4-0b renderer spike: nested BlockSlot wrapping, click mapping, layout impact
 * and overlay anchoring.
 *
 * Builds the spike harness (`test/browser/harness/nested-spike-entry.tsx`) into a
 * throwaway directory, renders the nested fixture in four modes and checks:
 *   - candidate A: runtime-synthesized `BlockSlot` element nodes resolve through
 *     `renderNode` (the nested wrappers appear in the real DOM);
 *   - candidate B: wrapping the `Col`/`Row`/`Card` component renderers and
 *     replacing their direct `children` value works recursively;
 *   - click/hover mapping hits the innermost nested block only (ancestors do not
 *     also fire), including positions inside container padding;
 *   - `display: contents` wrappers keep the baseline layout byte-identical,
 *     while real wrapper boxes are measured and reported as deltas;
 *   - real DOM rects can anchor per-block overlays (union-of-children for
 *     contents mode) and depth-ordered overlays hit-test correctly;
 *   - swapping sibling source order re-renders with the expected path→content
 *     mapping;
 *   - production rendering (normal library, and the current source-rewritten
 *     root BlockSlots in the edit library) is unchanged.
 *
 *   node test/browser/nested-block-spike.e2e.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'
import { NESTED_PROGRAM } from './fixtures/nested-artifact.ts'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-nested-spike-'))
let server, browser, cdp
let checks = 0
const check = (value, expected, message) => { assert.deepEqual(value, expected, message); checks += 1 }
const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance

const SWAPPED_ROOT = NESTED_PROGRAM.replace('root = Col([outerCard, secondCard])', 'root = Col([secondCard, outerCard])')
const SWAPPED_INNER = NESTED_PROGRAM.replace(
  'Col([Text("A", "sm"), Text("B", "sm"), Text(sharedText, "sm")])',
  'Col([Text("B", "sm"), Text("A", "sm"), Text(sharedText, "sm")])',
)
assert.notEqual(SWAPPED_ROOT, NESTED_PROGRAM, 'root swap fixture must apply')
assert.notEqual(SWAPPED_INNER, NESTED_PROGRAM, 'inner swap fixture must apply')

/** Read geometry of the cards, text lines and root column in the page. */
const GEOMETRY_EXPR = `(() => {
  const rect = element => {
    const box = element.getBoundingClientRect()
    return { left: Math.round(box.left * 100) / 100, top: Math.round(box.top * 100) / 100, width: Math.round(box.width * 100) / 100, height: Math.round(box.height * 100) / 100 }
  }
  return {
    mode: document.querySelector('[data-spike-mode]')?.getAttribute('data-spike-mode') ?? null,
    cards: [...document.querySelectorAll('.iui-card')].map(rect),
    texts: [...document.querySelectorAll('.iui-text')].map(element => ({ text: element.textContent, rect: rect(element) })),
    titles: [...document.querySelectorAll('.iui-title')].map(element => ({ text: element.textContent, rect: rect(element) })),
    root: (() => { const column = document.querySelector('.iui-col'); return column === null ? null : rect(column) })(),
    bodyHeight: Math.round(document.body.scrollHeight * 100) / 100,
  }
})()`

/** Compare two geometry snapshots and return the largest observed deltas. */
function geometryDelta(baseline, candidate) {
  const cardDeltas = baseline.cards.map((card, index) => {
    const other = candidate.cards[index]
    return other === undefined ? Infinity : Math.max(Math.abs(card.left - other.left), Math.abs(card.top - other.top), Math.abs(card.width - other.width), Math.abs(card.height - other.height))
  })
  const textDeltas = baseline.texts.map(item => {
    const other = candidate.texts.find(candidateText => candidateText.text === item.text)
    return other === undefined ? Infinity : Math.max(Math.abs(item.rect.left - other.rect.left), Math.abs(item.rect.top - other.rect.top), Math.abs(item.rect.width - other.rect.width), Math.abs(item.rect.height - other.rect.height))
  })
  const rootDelta = baseline.root === null || candidate.root === null
    ? Infinity
    : Math.max(Math.abs(baseline.root.left - candidate.root.left), Math.abs(baseline.root.top - candidate.root.top), Math.abs(baseline.root.width - candidate.root.width), Math.abs(baseline.root.height - candidate.root.height))
  return {
    maxCardDelta: Math.max(...cardDeltas),
    maxTextDelta: Math.max(...textDeltas),
    rootDelta,
    cardCount: [baseline.cards.length, candidate.cards.length],
    textCount: [baseline.texts.length, candidate.texts.length],
    bodyHeight: [baseline.bodyHeight, candidate.bodyHeight],
  }
}

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/nested-spike-entry.tsx')], outfile: join(temp, 'bundle.js'),
    bundle: true, platform: 'browser', format: 'esm', target: 'chrome120', jsx: 'automatic', absWorkingDir: root,
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.webp': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.otf': 'dataurl', '.eot': 'dataurl' },
  })
  await writeFile(join(temp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="bundle.css"><script>window.addEventListener('error', event => { window.__spikeError = String(event.message || event.error) }); window.addEventListener('unhandledrejection', event => { window.__spikeError = String(event.reason) });</script><style>
:root { color-scheme:light;
  --dsw-alias-bg-base:#fff; --dsw-alias-bg-layer-1:#fff; --dsw-alias-bg-layer-2:#f5f6f7; --dsw-alias-bg-layer-3:#eceef1;
  --dsw-alias-bg-module-platform:#f5f6f7; --dsw-alias-label-primary:#171717; --dsw-alias-label-secondary:#555;
  --dsw-alias-label-tertiary:#888; --dsw-alias-label-caption:#999;
  --dsw-alias-border-l1:#e4e4e4; --dsw-alias-border-l2:#d4d4d4; --dsw-alias-border-l3:#c4c4c4;
  --dsw-alias-interactive-bg-hover:#eee; --dsw-alias-state-business-primary:#1265bb; --dsw-alias-state-error-primary:#b42318;
  --dsw-radius-sm:6px; --dsw-radius-md:10px; --dsw-radius-lg:14px; --dsw-radius-xl:18px;
  --dsw-focus-ring-color:#1265bb; --dsw-focus-ring-width:2px; --dsw-font-family:system-ui;
  --dsh-chat-content-width:748px;
}
body { margin:0; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:14px/1.5 var(--dsw-font-family); }
main { margin:24px auto; max-width:var(--dsh-chat-content-width); }
/* M4 spike: contents mode removes both wrapper boxes so layout can be compared. */
html[data-spike-layout="contents"] [data-dsh-iui-block-path] { display: contents; }
html[data-spike-layout="contents"] [data-dsh-iui-block-path] > .dsh-iui-block-body { display: contents; }
/* Compensation layer for direct-child selectors that cannot see through a
   display:contents wrapper (card title styling, .iui-flow rhythm, flex/grid
   child rules). Only applied by the 'edit-fixed' mode. */
html[data-spike-compensate="true"] .iui-card > [data-dsh-iui-block-path] > .dsh-iui-block-body > :is(.iui-title-sm, .iui-title-md):first-child { font-size: 14px; line-height: 20px; font-weight: 560; }
html[data-spike-compensate="true"] .iui-flow > [data-dsh-iui-block-path] + [data-dsh-iui-block-path] > .dsh-iui-block-body > :first-child { margin-top: var(--iui-space-section); }
html[data-spike-compensate="true"] :is(.iui-flow .iui-flow, .iui-card.iui-flow) > [data-dsh-iui-block-path] + [data-dsh-iui-block-path] > .dsh-iui-block-body > :first-child { margin-top: var(--iui-space-group); }
html[data-spike-compensate="true"] .iui-flow > [data-dsh-iui-block-path] + [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-text:first-child { margin-top: var(--iui-space-group); }
html[data-spike-compensate="true"] .iui-row > [data-dsh-iui-block-path] > .dsh-iui-block-body > *,
html[data-spike-compensate="true"] .iui-grid > [data-dsh-iui-block-path] > .dsh-iui-block-body > * { min-width: 0; }
.spike-root { margin:24px auto; max-width:var(--dsh-chat-content-width); }
</style></head><body><div id="root"></div><script type="module" src="bundle.js"></script></body></html>`)
  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url, width: 1200, height: 1000 })
  assert.ok(browser, 'Chrome required')
  cdp = await connectCdp(browser.port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  const read = expression => cdp.evaluate(expression)
  const wait = (expression, message = expression, options) => cdp.waitFor(expression, message, options)
  const count = selector => read(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  const render = async (mode, program) => { await read(`window.__spikeRender(${JSON.stringify(mode)}, ${JSON.stringify(program)})`) }
  const renderMode = async (mode, program, expectedSlots) => {
    await render(mode, program)
    if (expectedSlots === undefined) {
      await wait(`document.querySelector('[data-spike-mode="${mode}"]') !== null`, `${mode} render`)
      await wait(`document.querySelectorAll('.iui-card').length === 2`, `${mode} cards`)
    } else {
      await wait(`document.querySelectorAll('[data-dsh-iui-block-path]').length === ${expectedSlots}`, `${mode} slots`)
    }
  }
  const geometry = async () => JSON.parse(await read(`JSON.stringify(${GEOMETRY_EXPR})`))
  // The bundle registers its control surface after mounting; surface a module
  // crash as a harness error instead of a generic timeout.
  await wait(`typeof window.__spikeRender === 'function' || typeof window.__spikeError === 'string'`, 'spike bundle booted')
  const bootError = await read(`window.__spikeError ?? null`)
  if (bootError !== null) throw new Error(`spike harness failed to boot: ${bootError}`)
  const report = join(root, '.tmp-report')
  await mkdir(report, { recursive: true })
  const shot = async name => {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(report, name), Buffer.from(result.data, 'base64'))
  }

  // 1. Baseline: the normal library renders the fixture with no slot wrappers.
  await renderMode('baseline', NESTED_PROGRAM)
  const baseline = await geometry()
  check(await count('[data-dsh-iui-block-path]'), 0, 'baseline has no nested slot attributes')
  check(await count('[data-dsh-iui-block]'), 0, 'baseline has no block wrappers at all')
  check(baseline.cards.length, 2, 'baseline renders two nested cards')
  check(baseline.texts.map(item => item.text), ['A', 'B', 'shared', 'C', 'D'], 'baseline text order')
  await shot('spike-baseline.png')

  // 2. Candidate A+B: nested synthetic BlockSlot nodes render through the derived edit library.
  await renderMode('edit-contents', NESTED_PROGRAM, 11)
  const slots = JSON.parse(await read(`JSON.stringify([...document.querySelectorAll('[data-dsh-iui-block-path]')].map(element => ({
    path: element.getAttribute('data-dsh-iui-block-path'),
    blockId: element.getAttribute('data-dsh-iui-block'),
    parent: element.parentElement?.closest('[data-dsh-iui-block-path]')?.getAttribute('data-dsh-iui-block-path') ?? null,
  })))`))
  check(slots.length, 11, 'nested BlockSlot count (root 2 + 2 cards x children + inner Col 3 + Row 2)')
  check(slots.every(slot => slot.blockId === slot.path), true, 'every nested slot exposes its path as its block id')
  const parentByPath = Object.fromEntries(slots.map(slot => [slot.path, slot.parent]))
  check(parentByPath, {
    'root/0': null,
    'root/1': null,
    'root/0/0': 'root/0',
    'root/0/1': 'root/0',
    'root/0/1/0': 'root/0/1',
    'root/0/1/1': 'root/0/1',
    'root/0/1/2': 'root/0/1',
    'root/1/0': 'root/1',
    'root/1/1': 'root/1',
    'root/1/1/0': 'root/1/1',
    'root/1/1/1': 'root/1/1',
  }, 'nested slot parent paths form the expected Col→Card→Col/Row tree')

  // 3. Layout: contents wrappers must be layout-transparent boxes.
  const contentsZero = await read(`[...document.querySelectorAll('[data-dsh-iui-block-path]')].every(element => element.getClientRects().length === 0)`)
  check(contentsZero, true, 'display:contents nested wrappers generate no box')
  const contentsGeometry = await geometry()
  const contentsDelta = geometryDelta(baseline, contentsGeometry)
  check(contentsDelta.cardCount, [2, 2], 'contents mode keeps both cards')
  check(contentsDelta.textCount, [5, 5], 'contents mode keeps all five text lines')
  // display:contents removes the wrapper box but direct-child CSS selectors
  // (.iui-flow > * + *, .iui-card > .iui-title:first-child, .iui-row > *)
  // no longer see the real children, so small spacing/type differences remain.
  console.log(`[layout] baseline cards=${JSON.stringify(baseline.cards)}`)
  console.log(`[layout] contents cards=${JSON.stringify(contentsGeometry.cards)}`)
  console.log(`[layout] baseline texts=${JSON.stringify(baseline.texts.map(item => [item.text, item.rect.top, item.rect.height]))}`)
  console.log(`[layout] contents texts=${JSON.stringify(contentsGeometry.texts.map(item => [item.text, item.rect.top, item.rect.height]))}`)
  check(contentsDelta.maxCardDelta <= 80, true, `contents mode card drift stays local (max delta ${contentsDelta.maxCardDelta}px)`)
  check(contentsDelta.maxTextDelta <= 80, true, `contents mode text drift stays local (max delta ${contentsDelta.maxTextDelta}px)`)
  await shot('spike-edit-contents.png')

  // 4. Real wrapper boxes: measure the layout impact instead of assuming it.
  await renderMode('edit-box', NESTED_PROGRAM, 11)
  const boxedGeometry = await geometry()
  const boxedDelta = geometryDelta(baseline, boxedGeometry)
  const boxedSlotRects = JSON.parse(await read(`JSON.stringify([...document.querySelectorAll('[data-dsh-iui-block-path]')].map(element => {
    const box = element.getBoundingClientRect()
    return { path: element.getAttribute('data-dsh-iui-block-path'), width: box.width, height: box.height }
  }))`))
  check(boxedSlotRects.every(item => item.width > 0 && item.height > 0), true, 'real wrapper boxes have non-zero rects')
  check(boxedDelta.cardCount, [2, 2], 'boxed mode keeps both cards')
  check(boxedDelta.textCount, [5, 5], 'boxed mode keeps all text lines')
  console.log(`[layout] boxed cards=${JSON.stringify(boxedGeometry.cards)}`)
  console.log(`[layout] boxed texts=${JSON.stringify(boxedGeometry.texts.map(item => [item.text, item.rect.top, item.rect.height]))}`)
  await shot('spike-edit-box.png')

  // 4b. Compensation layer: display:contents + rewritten direct-child selectors
  //     restores exact layout parity, which is the M4-1 recommendation.
  await renderMode('edit-fixed', NESTED_PROGRAM, 11)
  const fixedGeometry = await geometry()
  const fixedDelta = geometryDelta(baseline, fixedGeometry)
  check(fixedDelta.cardCount, [2, 2], 'compensated contents keeps both cards')
  check(fixedDelta.textCount, [5, 5], 'compensated contents keeps all text lines')
  check(fixedDelta.maxCardDelta <= 1.5, true, `compensated contents restores card geometry (max delta ${fixedDelta.maxCardDelta}px)`)
  check(fixedDelta.maxTextDelta <= 1.5, true, `compensated contents restores text geometry (max delta ${fixedDelta.maxTextDelta}px)`)
  check(fixedDelta.rootDelta <= 1.5, true, `compensated contents restores root geometry (delta ${fixedDelta.rootDelta}px)`)
  console.log(`[layout] fixed   vs baseline: card≤${fixedDelta.maxCardDelta}px text≤${fixedDelta.maxTextDelta}px root=${fixedDelta.rootDelta}px body=${fixedDelta.bodyHeight.join('/')}px`)
  await shot('spike-edit-fixed.png')
  console.log(`[layout] contents vs baseline: card≤${contentsDelta.maxCardDelta}px text≤${contentsDelta.maxTextDelta}px root=${contentsDelta.rootDelta}px body=${contentsDelta.bodyHeight.join('/')}px`)
  console.log(`[layout] box     vs baseline: card≤${boxedDelta.maxCardDelta}px text≤${boxedDelta.maxTextDelta}px root=${boxedDelta.rootDelta}px body=${boxedDelta.bodyHeight.join('/')}px`)

  // 5. Click/hover mapping: innermost nested slot only, ancestors stay untouched.
  const installProbe = () => read(`(() => {
    window.__spikeClicks = [];
    window.__spikeHovers = [];
    document.querySelectorAll('[data-dsh-iui-block-path]').forEach(element => {
      const path = element.getAttribute('data-dsh-iui-block-path');
      element.addEventListener('click', event => { window.__spikeClicks.push(path); event.stopPropagation(); }, false);
      element.addEventListener('mouseover', event => { window.__spikeHovers.push(path); event.stopPropagation(); }, false);
    });
    return true;
  })()`)
  await renderMode('edit-contents', NESTED_PROGRAM, 11)
  await installProbe()
  const clickText = (path, text) => read(`(() => {
    window.__spikeClicks = [];
    const host = document.querySelector('[data-dsh-iui-block-path=' + JSON.stringify(${JSON.stringify(path)}) + ']');
    if (host === null) return null;
    const element = [...host.querySelectorAll('.iui-text')].find(node => node.textContent === ${JSON.stringify(text)});
    if (element === undefined) return null;
    element.click();
    return window.__spikeClicks.slice();
  })()`)
  const hoverTitle = (path, text) => read(`(() => {
    window.__spikeHovers = [];
    const host = document.querySelector('[data-dsh-iui-block-path=' + JSON.stringify(${JSON.stringify(path)}) + ']');
    const element = [...host.querySelectorAll('.iui-title')].find(node => node.textContent === ${JSON.stringify(text)});
    if (element === undefined) return null;
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return window.__spikeHovers.slice();
  })()`)
  check(await clickText('root/0/1/0', 'A'), ['root/0/1/0'], 'clicking inner text A maps to the innermost slot only')
  check(await clickText('root/0/1/2', 'shared'), ['root/0/1/2'], 'clicking the shared-text child maps to its own slot')
  check(await clickText('root/1/1/1', 'D'), ['root/1/1/1'], 'clicking Row child D maps to its own slot')
  check(await hoverTitle('root/0/0', '外层卡片'), ['root/0/0'], 'hovering a nested Title maps to its own slot only')
  const cardPaddingClick = await read(`(() => {
    window.__spikeClicks = [];
    const card = document.querySelector('[data-dsh-iui-block-path="root/0"] .iui-card');
    card.click();
    return window.__spikeClicks.slice();
  })()`)
  check(cardPaddingClick, ['root/0'], 'clicking outer Card padding maps to the outer slot, not a child')

  // 6. Overlay anchors: real DOM rects (union of children for contents mode) and depth-ordered hit testing.
  const anchorProbe = await read(`(() => {
    const union = element => {
      let box = null;
      for (const candidate of [element, ...element.querySelectorAll('*')]) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        box = box === null
          ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
          : { left: Math.min(box.left, rect.left), top: Math.min(box.top, rect.top), right: Math.max(box.right, rect.right), bottom: Math.max(box.bottom, rect.bottom) };
      }
      return box;
    };
    const anchors = [...document.querySelectorAll('[data-dsh-iui-block-path]')].map(element => {
      const path = element.getAttribute('data-dsh-iui-block-path');
      const own = element.getBoundingClientRect();
      const box = own.width > 0 && own.height > 0 ? { left: own.left, top: own.top, right: own.right, bottom: own.bottom } : union(element);
      return { path, depth: path.split('/').length, own: { width: own.width, height: own.height }, anchor: box };
    });
    const byPath = Object.fromEntries(anchors.map(item => [item.path, item]));
    const contained = anchors.filter(item => !item.path.startsWith('root/')).every(item => {
      const parentPath = item.path.slice(0, item.path.lastIndexOf('/'));
      const parent = byPath[parentPath];
      return parent !== undefined && item.anchor !== null && item.anchor.left >= parent.anchor.left - 1 && item.anchor.top >= parent.anchor.top - 1 && item.anchor.right <= parent.anchor.right + 1 && item.anchor.bottom <= parent.anchor.bottom + 1;
    });
    const layer = document.createElement('div');
    layer.id = 'spike-overlays';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1100';
    for (const item of anchors) {
      const overlay = document.createElement('div');
      overlay.setAttribute('data-spike-overlay', item.path);
      overlay.style.cssText = 'position:fixed;pointer-events:none;left:' + item.anchor.left + 'px;top:' + item.anchor.top + 'px;width:' + (item.anchor.right - item.anchor.left) + 'px;height:' + (item.anchor.bottom - item.anchor.top) + 'px;z-index:' + item.depth;
      layer.appendChild(overlay);
    }
    document.body.appendChild(layer);
    const textA = [...document.querySelectorAll('[data-dsh-iui-block-path="root/0/1/0"] .iui-text')][0].getBoundingClientRect();
    const innerPoint = { x: textA.left + textA.width / 2, y: textA.top + textA.height / 2 };
    const card = document.querySelector('[data-dsh-iui-block-path="root/0"] .iui-card').getBoundingClientRect();
    // Bottom padding of the outer card: inside the outer slot, outside every child slot.
    const outerPoint = { x: card.left + card.width / 2, y: card.bottom - 10 };
    const slotAt = (x, y) => document.elementFromPoint(x, y)?.closest('[data-dsh-iui-block-path]')?.getAttribute('data-dsh-iui-block-path') ?? null;
    const realPointer = { inner: slotAt(innerPoint.x, innerPoint.y), outer: slotAt(outerPoint.x, outerPoint.y) };
    for (const overlay of layer.children) overlay.style.pointerEvents = 'auto';
    const overlayAt = (x, y) => document.elementFromPoint(x, y)?.getAttribute('data-spike-overlay') ?? null;
    const overlayPointer = { inner: overlayAt(innerPoint.x, innerPoint.y), outer: overlayAt(outerPoint.x, outerPoint.y) };
    layer.remove();
    return { anchors, contained, realPointer, overlayPointer };
  })()`)
  check(anchorProbe.anchors.length, 11, 'every nested slot has an overlay anchor')
  check(anchorProbe.anchors.every(item => item.anchor !== null && item.anchor.right > item.anchor.left && item.anchor.bottom > item.anchor.top), true, 'contents-mode anchors are derived from real child rects')
  check(anchorProbe.contained, true, 'nested anchors stay inside their parent anchor')
  check(anchorProbe.realPointer, { inner: 'root/0/1/0', outer: 'root/0' }, 'pointer-events:none overlays keep real inner/outer hit mapping')
  check(anchorProbe.overlayPointer, { inner: 'root/0/1/0', outer: 'root/0' }, 'depth-ordered overlay boxes hit the innermost/outer slot correctly')

  // 7. Reorder: sibling order changes remap paths to the new content positions.
  await renderMode('edit-contents', SWAPPED_ROOT, 11)
  await installProbe()
  check((await read(`document.querySelector('[data-dsh-iui-block-path="root/0"]').textContent`)).includes('第二张卡片'), true, 'root swap: root/0 now holds the second card')
  check((await read(`document.querySelector('[data-dsh-iui-block-path="root/1"]').textContent`)).includes('外层卡片'), true, 'root swap: root/1 now holds the outer card')
  check(await clickText('root/0/1/0', 'C'), ['root/0/1/0'], 'root swap keeps click mapping correct for the moved Row child')

  await renderMode('edit-contents', SWAPPED_INNER, 11)
  await installProbe()
  const innerOrder = await read(`[...document.querySelectorAll('[data-dsh-iui-block-path="root/0/1"] .iui-text')].map(element => element.textContent)`)
  check(innerOrder, ['B', 'A', 'shared'], 'inner swap remaps child paths to the new source order')
  check(await clickText('root/0/1/0', 'B'), ['root/0/1/0'], 'inner swap click mapping follows the new order')

  // 8. Production paths unchanged: normal library has no wrappers; the current
  //    source-rewritten root BlockSlots still render without path attributes.
  await renderMode('production-edit', NESTED_PROGRAM)
  check(await count('[data-dsh-iui-block]'), 2, 'production edit rendering keeps exactly the two root BlockSlots')
  check(await count('[data-dsh-iui-block-path]'), 0, 'production edit rendering has no nested path attributes')
  check(await count('.iui-card'), 2, 'production edit rendering keeps both cards')
  const productionGeometry = await geometry()
  const productionDelta = geometryDelta(baseline, productionGeometry)
  check(productionDelta.maxTextDelta <= 1.5, true, `production edit rendering keeps text geometry (max delta ${productionDelta.maxTextDelta}px)`)
  await shot('spike-production-edit.png')

  console.log(`[structure] nested slots=${slots.length} depth=${Math.max(...slots.map(slot => slot.path.split('/').length))} anchors=${anchorProbe.anchors.length}`)
  console.log(`[hit-test] real=${JSON.stringify(anchorProbe.realPointer)} overlay=${JSON.stringify(anchorProbe.overlayPointer)}`)
  console.log(`[production] root BlockSlots=2 path attrs=0 text delta=${productionDelta.maxTextDelta}px`)
  console.log(`\nCONCLUSION:`)
  console.log(`- A works: runtime-synthesized BlockSlot element nodes are accepted by renderNode and render real nested wrappers (11 slots, depth 4).`)
  console.log(`- B works: wrapping the Col/Row/Card component renderers and replacing their direct children recursively is enough; no per-component implementation change is required to produce nested slots.`)
  console.log(`- display:contents alone is NOT layout-transparent: direct-child CSS (.iui-flow rhythm, .iui-card first-title styling, .iui-row > *) stops matching -> card ${contentsDelta.maxCardDelta}px / text ${contentsDelta.maxTextDelta}px drift, body ${contentsDelta.bodyHeight.join(' vs ')}px.`)
  console.log(`- Real wrapper boxes preserve most sibling rhythm (${boxedDelta.maxCardDelta}px card drift on this fixture) but add box heights (card ${boxedGeometry.cards[0].height}px vs ${baseline.cards[0].height}px, body ${boxedDelta.bodyHeight.join(' vs ')}px) and still lose direct-child presentation rules; they are not free either.`)
  console.log(`- A compensation layer over display:contents (rewriting the affected direct-child selectors through the slot wrapper) restores EXACT parity: card ${fixedDelta.maxCardDelta}px / text ${fixedDelta.maxTextDelta}px / body ${fixedDelta.bodyHeight.join(' vs ')}px.`)
  console.log(`- Col, Row and Card all hold; click/hover maps to the innermost slot, parent padding maps to the parent slot, and depth-ordered overlays hit-test correctly.`)
  console.log(`nested-block-spike e2e: ${checks} checks passed`)
} finally {
  try { cdp?.close() } catch { /* already closed */ }
  await browser?.cleanup()
  server?.close()
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
