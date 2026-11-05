#!/usr/bin/env node
/**
 * M4-1 renderer E2E: production `OpenUIRenderer` with `nestedBlockSlots`.
 *
 * Verifies the shipped nested edit-mode rendering (not the M4-0b spike harness):
 *   - nested BlockSlots for Col/Row/Card direct children with `root/children/N`
 *     paths, resolver-provided `data-dsh-iui-block`/`-node` ids and parent tree;
 *   - clipping/mapping: innermost click + hover mapping, parent padding mapping,
 *     no parent/child crosstalk;
 *   - layout: normal vs nested render geometry is identical (CSS compensation);
 *     a torture program (flow rhythm, card title/caption, row badge/button) is
 *     also 0px-different;
 *   - overlay anchors: contents wrappers have zero own rect -> union of real
 *     child rects; nested anchors are contained in parents; depth-ordered
 *     overlay boxes hit the innermost/outer slot correctly;
 *   - reorder: swapping source children remaps paths and resolver ids;
 *   - previous top-level edit rendering (`blockSlots` only) is unchanged.
 *
 *   node test/browser/nested-edit-renderer.e2e.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { connectCdp, launchChrome, startStaticServer } from '../support/browser.mjs'
import { NESTED_PROGRAM } from './fixtures/nested-artifact.ts'
import { NESTED_CONTAINERS_PROGRAM } from './fixtures/nested-containers.ts'
import { extractArtifactBlocks, wrapProgramForBlockEditing } from '../../src/shared/artifact-blocks.ts'

const root = new URL('../../', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'iui-nested-render-'))
let server, browser, cdp
let checks = 0
const check = (value, expected, message) => { assert.deepEqual(value, expected, message); checks += 1 }
const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance

const SWAPPED_ROOT = NESTED_PROGRAM.replace('root = Col([outerCard, secondCard])', 'root = Col([secondCard, outerCard])')
const SWAPPED_INNER = NESTED_PROGRAM.replace(
  'Col([Text("A", "sm"), Text("B", "sm"), Text(sharedText, "sm")])',
  'Col([Text("B", "sm"), Text("A", "sm"), Text(sharedText, "sm")])',
)
assert.notEqual(SWAPPED_ROOT, NESTED_PROGRAM, 'root swap must apply')
assert.notEqual(SWAPPED_INNER, NESTED_PROGRAM, 'inner swap must apply')

/** Flow rhythm + card title/caption + row badge/button torture fixture. */
const TORTURE_PROGRAM = `root = Col([intro, panel, rowBlock])
intro = Col([Title("Intro", "md"), Text("first paragraph", "sm"), Caption("a caption"), Text("second paragraph", "sm")], 2)
panel = Card([Title("Panel title", "sm"), Caption("panel caption"), Text("body text", "sm"), Row([Badge("tag"), Button("Go")])])
rowBlock = Row([Text("left", "sm"), Badge("info", "info"), Text("right", "sm")])`

/** Carousel that overflows its track, so scrolling and nav controls are real. */
const CAROUSEL_SCROLL_PROGRAM = `root = Col([slides])
slides = Carousel([Text("slide one", "sm"), Text("slide two", "sm"), Text("slide three", "sm")], 400)`

/** Flow containers inside Grid/Carousel exercise the scoped typography caps. */
const CONTAINER_TYPO_PROGRAM = `root = Col([gridBlock, carouselBlock])
gridBlock = Grid([Col([Title("Grid heading", "lg"), Text("grid body", "md")]), Col([Title("Second", "lg")], 2)])
carouselBlock = Carousel([Col([Title("Carousel heading", "lg"), Text("carousel body", "md")]), Col([Title("Other", "lg")], 2)], 400)`

/** DFS DOM order of the container fixture's nested slots (18 total). */
const CONTAINER_PATHS = [
  'root/children/0',
  'root/children/0/children/0',
  'root/children/0/children/1',
  'root/children/0/children/1/children/0',
  'root/children/0/children/1/children/1',
  'root/children/1',
  'root/children/1/children/0',
  'root/children/1/children/1',
  'root/children/1/children/1/children/0',
  'root/children/1/children/1/children/1',
  'root/children/2',
  'root/children/2/children/0',
  'root/children/2/children/1',
  'root/children/3',
  'root/children/3/children/0',
  'root/children/3/children/1',
  'root/children/3/children/1/children/0',
  'root/children/3/children/1/children/1',
]

/** Production source-level wrapping (previous top-level edit path). */
const TOPLEVEL_PROGRAM = wrapProgramForBlockEditing(NESTED_PROGRAM, extractArtifactBlocks(NESTED_PROGRAM)) ?? NESTED_PROGRAM

/** DOM order is depth-first: a parent slot appears before its nested slots. */
const EXPECTED_PATHS = [
  'root/children/0',
  'root/children/0/children/0',
  'root/children/0/children/1',
  'root/children/0/children/1/children/0',
  'root/children/0/children/1/children/1',
  'root/children/0/children/1/children/2',
  'root/children/1',
  'root/children/1/children/0',
  'root/children/1/children/1',
  'root/children/1/children/1/children/0',
  'root/children/1/children/1/children/1',
]

const GEOMETRY_EXPR = `(() => {
  const rect = element => {
    const box = element.getBoundingClientRect()
    return { left: Math.round(box.left * 100) / 100, top: Math.round(box.top * 100) / 100, width: Math.round(box.width * 100) / 100, height: Math.round(box.height * 100) / 100 }
  }
  const texts = [...document.querySelectorAll('.iui-text, .iui-title, .iui-caption')]
  return {
    mode: document.querySelector('[data-render-mode]')?.getAttribute('data-render-mode') ?? null,
    cards: [...document.querySelectorAll('.iui-card')].map(rect),
    texts: texts.map(element => ({ text: element.textContent, rect: rect(element) })),
    root: (() => { const column = document.querySelector('.iui-col'); return column === null ? null : rect(column) })(),
    bodyHeight: Math.round(document.body.scrollHeight * 100) / 100,
  }
})()`

/** Largest geometry drift between two snapshots (by card index / text label). */
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
    maxCardDelta: cardDeltas.length === 0 ? 0 : Math.max(...cardDeltas),
    maxTextDelta: textDeltas.length === 0 ? 0 : Math.max(...textDeltas),
    rootDelta,
  }
}

try {
  await build({
    entryPoints: [join(root, 'test/browser/harness/nested-render-entry.tsx')], outfile: join(temp, 'bundle.js'),
    bundle: true, platform: 'browser', format: 'esm', target: 'chrome120', jsx: 'automatic', absWorkingDir: root,
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.webp': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.otf': 'dataurl', '.eot': 'dataurl' },
  })
  await writeFile(join(temp, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="bundle.css"><script>window.addEventListener('error', event => { window.__renderError = String(event.message || event.error) }); window.addEventListener('unhandledrejection', event => { window.__renderError = String(event.reason) });</script><style>
:root { color-scheme:light;
  --dsw-alias-bg-base:#fff; --dsw-alias-bg-layer-1:#fff; --dsw-alias-bg-layer-2:#f5f6f7; --dsw-alias-bg-layer-3:#eceef1;
  --dsw-alias-bg-module-platform:#f5f6f7; --dsw-alias-label-primary:#171717; --dsw-alias-label-secondary:#555;
  --dsw-alias-label-tertiary:#888; --dsw-alias-label-caption:#999; --dsw-alias-label-primary-foreground:#fff;
  --dsw-alias-border-l1:#e4e4e4; --dsw-alias-border-l2:#d4d4d4; --dsw-alias-border-l3:#c4c4c4;
  --dsw-alias-interactive-bg-hover:#eee; --dsw-alias-state-business-primary:#1265bb; --dsw-alias-state-error-primary:#b42318;
  --dsw-radius-sm:6px; --dsw-radius-md:10px; --dsw-radius-lg:14px; --dsw-radius-xl:18px;
  --dsw-focus-ring-color:#1265bb; --dsw-focus-ring-width:2px; --dsw-font-family:system-ui;
  --dsh-chat-content-width:748px;
}
body { margin:0; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font:14px/1.5 var(--dsw-font-family); }
.dsh-iui-surface { margin:24px auto; max-width:var(--dsh-chat-content-width); }
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
  const renderMode = async (mode, program, expectSlots) => {
    await read(`window.__renderNested(${JSON.stringify(mode)}, ${JSON.stringify(program)})`)
    await wait(`document.querySelector('[data-render-mode="${mode}"]') !== null`, `${mode} render`)
    if (expectSlots === undefined) await wait(`document.querySelectorAll('.iui-card, .iui-title, .iui-text, .iui-col').length > 0`, `${mode} content`)
    else await wait(`document.querySelectorAll('[data-dsh-iui-block-path]').length === ${expectSlots}`, `${mode} slots`)
  }
  const geometry = async () => JSON.parse(await read(`JSON.stringify(${GEOMETRY_EXPR})`))
  const report = join(root, '.tmp-report')
  await mkdir(report, { recursive: true })
  const shot = async name => {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(report, name), Buffer.from(result.data, 'base64'))
  }
  const bootError = async () => {
    await wait(`typeof window.__renderNested === 'function' || typeof window.__renderError === 'string'`, 'harness booted')
    return read(`window.__renderError ?? null`)
  }
  const error = await bootError()
  if (error !== null) throw new Error(`nested renderer harness failed to boot: ${error}`)

  // 1. Baseline: the ordinary renderer emits no nested slot/node attributes.
  await renderMode('baseline', NESTED_PROGRAM)
  const baseline = await geometry()
  check(await count('[data-dsh-iui-block-path]'), 0, 'baseline has no nested path attributes')
  check(await count('[data-dsh-iui-block-node]'), 0, 'baseline has no node attributes')
  check(baseline.cards.length, 2, 'baseline renders two cards')
  check(baseline.texts.map(item => item.text), ['外层卡片', 'A', 'B', 'shared', '第二张卡片', 'C', 'D'], 'baseline title/text order')
  await shot('nested-render-baseline.png')

  // 2. Nested rendering with the client resolver.
  await renderMode('nested', NESTED_PROGRAM, 11)
  const slots = JSON.parse(await read(`JSON.stringify([...document.querySelectorAll('[data-dsh-iui-block-path]')].map(element => ({
    path: element.getAttribute('data-dsh-iui-block-path'),
    blockId: element.getAttribute('data-dsh-iui-block'),
    nodeId: element.getAttribute('data-dsh-iui-block-node'),
    index: element.getAttribute('data-dsh-iui-block-index'),
    parent: element.parentElement?.closest('[data-dsh-iui-block-path]')?.getAttribute('data-dsh-iui-block-path') ?? null,
  })))`))
  check(slots.map(slot => slot.path), EXPECTED_PATHS, 'nested paths follow root/children/N')
  check(slots.length, 11, 'nested BlockSlots: root 2 + cards/rows/cols 9')
  const resolverExpected = path => {
    const dotted = path.replaceAll('/children/', '.')
    const last = Number(path.split('/children/').at(-1))
    return { blockId: `b-${dotted}`, nodeId: `n-${dotted}`, index: String(last + 1) }
  }
  check(slots.every(slot => slot.blockId === resolverExpected(slot.path).blockId), true, 'resolver supplies data-dsh-iui-block')
  check(slots.every(slot => slot.nodeId === resolverExpected(slot.path).nodeId), true, 'resolver supplies data-dsh-iui-block-node')
  check(slots.every(slot => slot.index === resolverExpected(slot.path).index), true, 'resolver supplies the 1-based sibling index')
  const parentByPath = Object.fromEntries(slots.map(slot => [slot.path, slot.parent]))
  check(parentByPath['root/children/0/children/1/children/2'], 'root/children/0/children/1', 'nested tree parent chain is correct')
  check(parentByPath['root/children/0'], null, 'root-level slots have no block parent')
  const zeroRects = await read(`[...document.querySelectorAll('[data-dsh-iui-block-path]')].every(element => element.getClientRects().length === 0)`)
  check(zeroRects, true, 'nested wrappers are layout-transparent (display:contents, zero rect)')

  // 3. Layout parity: production CSS compensation keeps geometry identical.
  const nestedGeometry = await geometry()
  const nestedDelta = geometryDelta(baseline, nestedGeometry)
  check(nestedDelta.maxCardDelta <= 1.5, true, `nested cards keep geometry (max delta ${nestedDelta.maxCardDelta}px)`)
  check(nestedDelta.maxTextDelta <= 1.5, true, `nested text keeps geometry (max delta ${nestedDelta.maxTextDelta}px)`)
  check(nestedDelta.rootDelta <= 1.5, true, `nested root keeps geometry (delta ${nestedDelta.rootDelta}px)`)
  check(near(baseline.bodyHeight, nestedGeometry.bodyHeight, 1.5), true, `nested document height unchanged (${baseline.bodyHeight} vs ${nestedGeometry.bodyHeight})`)
  await shot('nested-render-nested.png')

  // 3b. Torture fixture: flow rhythm / card title+caption / row badge+button.
  await renderMode('baseline', TORTURE_PROGRAM)
  const tortureBaseline = await geometry()
  await renderMode('nested', TORTURE_PROGRAM)
  await wait(`document.querySelectorAll('[data-dsh-iui-block-path]').length > 0`, 'torture nested slots')
  const tortureNested = await geometry()
  const tortureDelta = geometryDelta(tortureBaseline, tortureNested)
  check(tortureBaseline.cards.length, 1, 'torture fixture renders its card')
  check(tortureDelta.maxCardDelta <= 1.5, true, `torture card geometry unchanged (max delta ${tortureDelta.maxCardDelta}px)`)
  check(tortureDelta.maxTextDelta <= 1.5, true, `torture text/flow geometry unchanged (max delta ${tortureDelta.maxTextDelta}px)`)
  check(near(tortureBaseline.bodyHeight, tortureNested.bodyHeight, 1.5), true, 'torture document height unchanged')

  // 4. Click/hover mapping: innermost only, parent padding maps to parent.
  await renderMode('nested', NESTED_PROGRAM, 11)
  await read(`(() => {
    window.__clicks = [];
    window.__hovers = [];
    document.querySelectorAll('[data-dsh-iui-block-path]').forEach(element => {
      const path = element.getAttribute('data-dsh-iui-block-path');
      element.addEventListener('click', event => { window.__clicks.push(path); event.stopPropagation(); }, false);
      element.addEventListener('mouseover', event => { window.__hovers.push(path); event.stopPropagation(); }, false);
    });
    return true;
  })()`)
  const clickText = (path, text) => read(`(() => {
    window.__clicks = [];
    const host = document.querySelector('[data-dsh-iui-block-path=${JSON.stringify(path)}]');
    if (host === null) return null;
    const element = [...host.querySelectorAll('.iui-text')].find(node => node.textContent === ${JSON.stringify(text)});
    if (element === undefined) return null;
    element.click();
    return window.__clicks.slice();
  })()`)
  check(await clickText('root/children/0/children/1/children/0', 'A'), ['root/children/0/children/1/children/0'], 'clicking inner text A maps to the innermost slot')
  check(await clickText('root/children/0/children/1/children/2', 'shared'), ['root/children/0/children/1/children/2'], 'clicking the shared text maps to its own slot')
  check(await clickText('root/children/1/children/1/children/1', 'D'), ['root/children/1/children/1/children/1'], 'clicking Row child D maps to its own slot')
  check(await read(`(() => {
    window.__hovers = [];
    const title = [...document.querySelectorAll('[data-dsh-iui-block-path="root/children/0/children/0"] .iui-title')][0];
    title.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return window.__hovers.slice();
  })()`), ['root/children/0/children/0'], 'hovering a nested Title maps to its own slot')
  check(await read(`(() => {
    window.__clicks = [];
    const card = document.querySelector('[data-dsh-iui-block-path="root/children/0"] .iui-card');
    card.click();
    return window.__clicks.slice();
  })()`), ['root/children/0'], 'clicking outer Card padding maps to the outer slot only')

  // 5. Overlay anchors: union-of-children rects + depth-ordered hit testing.
  const overlay = await read(`(() => {
    const union = element => {
      let box = null;
      for (const candidate of [element, ...element.querySelectorAll('*')]) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        box = box === null ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : { left: Math.min(box.left, rect.left), top: Math.min(box.top, rect.top), right: Math.max(box.right, rect.right), bottom: Math.max(box.bottom, rect.bottom) };
      }
      return box;
    };
    const anchors = [...document.querySelectorAll('[data-dsh-iui-block-path]')].map(element => {
      const path = element.getAttribute('data-dsh-iui-block-path');
      const own = element.getBoundingClientRect();
      return { path, depth: path.split('/children/').length, anchor: own.width > 0 ? { left: own.left, top: own.top, right: own.right, bottom: own.bottom } : union(element) };
    });
    const byPath = Object.fromEntries(anchors.map(item => [item.path, item]));
    // Root-level slots (a single children segment) have no block parent.
    const contained = anchors.filter(item => item.path.split('/children/').length > 2).every(item => {
      const parentPath = item.path.slice(0, item.path.lastIndexOf('/children/'));
      const parent = byPath[parentPath];
      return parent !== undefined && item.anchor.left >= parent.anchor.left - 1 && item.anchor.top >= parent.anchor.top - 1 && item.anchor.right <= parent.anchor.right + 1 && item.anchor.bottom <= parent.anchor.bottom + 1;
    });
    const layer = document.createElement('div');
    layer.id = 'overlays';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1100';
    for (const item of anchors) {
      const box = document.createElement('div');
      box.setAttribute('data-overlay-path', item.path);
      box.style.cssText = 'position:fixed;pointer-events:none;left:' + item.anchor.left + 'px;top:' + item.anchor.top + 'px;width:' + (item.anchor.right - item.anchor.left) + 'px;height:' + (item.anchor.bottom - item.anchor.top) + 'px;z-index:' + item.depth;
      layer.appendChild(box);
    }
    document.body.appendChild(layer);
    const textA = [...document.querySelectorAll('[data-dsh-iui-block-path="root/children/0/children/1/children/0"] .iui-text')][0].getBoundingClientRect();
    const innerPoint = { x: textA.left + textA.width / 2, y: textA.top + textA.height / 2 };
    const card = document.querySelector('[data-dsh-iui-block-path="root/children/0"] .iui-card').getBoundingClientRect();
    const outerPoint = { x: card.left + card.width / 2, y: card.bottom - 10 };
    const slotAt = (x, y) => document.elementFromPoint(x, y)?.closest('[data-dsh-iui-block-path]')?.getAttribute('data-dsh-iui-block-path') ?? null;
    const realPointer = { inner: slotAt(innerPoint.x, innerPoint.y), outer: slotAt(outerPoint.x, outerPoint.y) };
    for (const box of layer.children) box.style.pointerEvents = 'auto';
    const overlayAt = (x, y) => document.elementFromPoint(x, y)?.getAttribute('data-overlay-path') ?? null;
    const overlayPointer = { inner: overlayAt(innerPoint.x, innerPoint.y), outer: overlayAt(outerPoint.x, outerPoint.y) };
    layer.remove();
    return { anchors, contained, realPointer, overlayPointer };
  })()`)
  check(overlay.anchors.length, 11, 'every nested slot has an overlay anchor')
  check(overlay.anchors.every(item => item.anchor !== null && item.anchor.right > item.anchor.left && item.anchor.bottom > item.anchor.top), true, 'contents anchors are derived from real child rects')
  check(overlay.contained, true, 'nested overlay anchors stay inside their parent anchor')
  check(overlay.realPointer, { inner: 'root/children/0/children/1/children/0', outer: 'root/children/0' }, 'real hit-testing maps inner/outer slots correctly')
  check(overlay.overlayPointer, { inner: 'root/children/0/children/1/children/0', outer: 'root/children/0' }, 'depth-ordered overlay boxes hit the innermost/outer slot')

  // 6. Reorder remaps paths and resolver ids to the new source positions.
  await renderMode('nested', SWAPPED_ROOT, 11)
  check((await read(`document.querySelector('[data-dsh-iui-block-path="root/children/0"]').textContent`)).includes('第二张卡片'), true, 'root swap: first root slot now holds the second card')
  check((await read(`document.querySelector('[data-dsh-iui-block-path="root/children/1"]').textContent`)).includes('外层卡片'), true, 'root swap: second root slot now holds the outer card')
  check(await read(`document.querySelector('[data-dsh-iui-block-path="root/children/0/children/1/children/0"]').getAttribute('data-dsh-iui-block')`), `b-${'root/children/0/children/1/children/0'.replaceAll('/children/', '.')}`, 'resolver ids follow the reordered path')
  await renderMode('nested', SWAPPED_INNER, 11)
  check(await read(`[...document.querySelectorAll('[data-dsh-iui-block-path="root/children/0/children/1"] .iui-text')].map(element => element.textContent)`), ['B', 'A', 'shared'], 'inner swap remaps child paths to the new order')

  // 7. Fallback identity without a resolver, and previous top-level edit rendering.
  await renderMode('nested-fallback', NESTED_PROGRAM, 11)
  check(await read(`document.querySelector('[data-dsh-iui-block-path="root/children/0/children/1/children/0"]').getAttribute('data-dsh-iui-block')`), 'root/children/0/children/1/children/0', 'fallback display id is the path')
  check(await read(`document.querySelector('[data-dsh-iui-block-path="root/children/0/children/1/children/0"]').getAttribute('data-dsh-iui-block-node')`), 'root/children/0/children/1/children/0', 'fallback node id is the path')

  await renderMode('toplevel', TOPLEVEL_PROGRAM)
  check(await count('[data-dsh-iui-block]'), 2, 'top-level edit rendering keeps the two root BlockSlots')
  check(await count('[data-dsh-iui-block-path]'), 0, 'top-level edit rendering has no nested path wrappers')
  check(await count('[data-dsh-iui-block-node]'), 0, 'top-level edit rendering has no node attributes')
  check(await count('.iui-card'), 2, 'top-level edit rendering keeps both cards')
  const toplevelGeometry = await geometry()
  const toplevelDelta = geometryDelta(baseline, toplevelGeometry)
  check(toplevelDelta.maxTextDelta <= 1.5, true, `top-level edit rendering keeps text geometry (max delta ${toplevelDelta.maxTextDelta}px)`)

  // 8. M4-4 container expansion: Box/Grid/Section/Carousel (+ Col/Row/Card).
  await renderMode('baseline', NESTED_CONTAINERS_PROGRAM)
  const containersBaseline = await geometry()
  check(containersBaseline.cards.length, 3, 'container fixture renders three cards plus a Section at baseline')
  await renderMode('nested', NESTED_CONTAINERS_PROGRAM, 18)
  const containerSlots = JSON.parse(await read(`JSON.stringify([...document.querySelectorAll('[data-dsh-iui-block-path]')].map(element => ({
    path: element.getAttribute('data-dsh-iui-block-path'),
    blockId: element.getAttribute('data-dsh-iui-block'),
    nodeId: element.getAttribute('data-dsh-iui-block-node'),
    parent: element.parentElement?.closest('[data-dsh-iui-block-path]')?.getAttribute('data-dsh-iui-block-path') ?? null,
    inBox: element.closest('.iui-box') !== null,
    inGrid: element.closest('.iui-grid') !== null,
    inSectionBody: element.closest('.iui-section-body') !== null,
    inCarouselItem: element.parentElement?.classList.contains('iui-carousel-item') === true,
    inCarouselTrack: element.closest('.iui-carousel-track') !== null,
  })))`))
  const containerPaths = containerSlots.map(slot => slot.path)
  check(containerPaths, CONTAINER_PATHS, 'all seven container types expose their direct-child slots (18, DFS order)')
  check(containerSlots.filter(slot => slot.inBox).length, 2, 'Box child slots are nested inside a Box')
  check(containerSlots.filter(slot => slot.inGrid).length, 2, 'Grid child slots are nested inside a Grid')
  check(containerSlots.filter(slot => slot.inSectionBody).length, 2, 'Section child slots are nested inside the Section body')
  check(containerSlots.filter(slot => slot.inCarouselItem).length, 2, 'Carousel child slots sit inside their carousel items')
  check(containerSlots.filter(slot => slot.inCarouselItem && slot.inCarouselTrack).length, 2, 'Carousel child slots stay inside the carousel track')
  check(containerSlots.every(slot => slot.blockId === resolverExpected(slot.path).blockId), true, 'container slots use resolver block ids')
  check(containerSlots.every(slot => slot.nodeId === resolverExpected(slot.path).nodeId), true, 'container slots use resolver node ids')
  const containerParents = Object.fromEntries(containerSlots.map(slot => [slot.path, slot.parent]))
  check(containerParents['root/children/0/children/1/children/1'], 'root/children/0/children/1', 'Box child parent chain')
  check(containerParents['root/children/1/children/1/children/1'], 'root/children/1/children/1', 'Grid child parent chain')
  check(containerParents['root/children/2/children/1'], 'root/children/2', 'Section child parent chain')
  check(containerParents['root/children/3/children/1/children/1'], 'root/children/3/children/1', 'Carousel child parent chain')
  const containersGeometry = await geometry()
  const containersDelta = geometryDelta(containersBaseline, containersGeometry)
  check(containersDelta.maxCardDelta <= 1.5, true, `container cards keep geometry (max delta ${containersDelta.maxCardDelta}px)`)
  check(containersDelta.maxTextDelta <= 1.5, true, `container texts keep geometry (max delta ${containersDelta.maxTextDelta}px)`)
  check(containersDelta.rootDelta <= 1.5, true, `container root keeps geometry (delta ${containersDelta.rootDelta}px)`)
  check(near(containersBaseline.bodyHeight, containersGeometry.bodyHeight, 1.5), true, `container document height unchanged (${containersBaseline.bodyHeight} vs ${containersGeometry.bodyHeight})`)
  const carouselItemDelta = await read(`JSON.stringify([...document.querySelectorAll('.iui-carousel-item')].map(item => {
    const box = item.getBoundingClientRect()
    return Math.round(box.width * 100) / 100
  }))`)
  check(JSON.parse(carouselItemDelta).every(width => width === 200), true, 'carousel items keep their 200px itemWidth')

  // 8b. Grid item placement and the grid/carousel flow typography caps.
  await renderMode('baseline', CONTAINER_TYPO_PROGRAM)
  const typoBaseline = await geometry()
  const baselineTypography = await read(`(() => {
    const find = (selector, text) => [...document.querySelectorAll(selector)].find(element => element.textContent === text);
    const probe = (selector, text) => { const element = find(selector, text); return element === undefined ? null : getComputedStyle(element).fontSize };
    return { gridTitle: probe('.iui-title', 'Grid heading'), gridText: probe('.iui-text', 'grid body'), carouselTitle: probe('.iui-title', 'Carousel heading'), carouselText: probe('.iui-text', 'carousel body') };
  })()`)
  await renderMode('nested', CONTAINER_TYPO_PROGRAM)
  await wait(`document.querySelectorAll('[data-dsh-iui-block-path]').length > 0`, 'typography nested slots')
  const typoNested = await geometry()
  const typoDelta = geometryDelta(typoBaseline, typoNested)
  const nestedTypography = await read(`(() => {
    const find = (selector, text) => [...document.querySelectorAll(selector)].find(element => element.textContent === text);
    const probe = (selector, text) => { const element = find(selector, text); return element === undefined ? null : getComputedStyle(element).fontSize };
    return { gridTitle: probe('.iui-title', 'Grid heading'), gridText: probe('.iui-text', 'grid body'), carouselTitle: probe('.iui-title', 'Carousel heading'), carouselText: probe('.iui-text', 'carousel body') };
  })()`)
  check(nestedTypography, baselineTypography, 'grid/carousel flow typography caps survive the wrapper')
  check(typoDelta.maxCardDelta <= 1.5, true, `typography fixture geometry unchanged (max text delta ${typoDelta.maxTextDelta}px)`)
  check(typoDelta.maxTextDelta <= 1.5, true, `typography text geometry unchanged (max delta ${typoDelta.maxTextDelta}px)`)

  // 8c. Container click mapping and carousel overlay anchors.
  await renderMode('nested', NESTED_CONTAINERS_PROGRAM, 18)
  await read(`(() => {
    window.__clicks = [];
    document.querySelectorAll('[data-dsh-iui-block-path]').forEach(element => {
      const path = element.getAttribute('data-dsh-iui-block-path');
      element.addEventListener('click', event => { window.__clicks.push(path); event.stopPropagation(); }, false);
    });
    return true;
  })()`)
  const clickContainerText = (path, text) => read(`(() => {
    window.__clicks = [];
    const host = document.querySelector('[data-dsh-iui-block-path=${JSON.stringify(path)}]');
    if (host === null) return null;
    const element = [...host.querySelectorAll('.iui-text')].find(node => node.textContent === ${JSON.stringify(text)});
    if (element === undefined) return null;
    element.click();
    return window.__clicks.slice();
  })()`)
  check(await clickContainerText('root/children/0/children/1/children/0', 'box one'), ['root/children/0/children/1/children/0'], 'Box child click maps to the innermost slot')
  check(await clickContainerText('root/children/1/children/1/children/1', 'grid two'), ['root/children/1/children/1/children/1'], 'Grid child click maps to the innermost slot')
  check(await clickContainerText('root/children/2/children/0', 'section one'), ['root/children/2/children/0'], 'Section child click maps to the innermost slot')
  check(await clickContainerText('root/children/3/children/1/children/0', 'carousel one'), ['root/children/3/children/1/children/0'], 'Carousel child click maps to the innermost slot')
  const carouselOverlay = await read(`(() => {
    const visible = document.querySelector('[data-dsh-iui-block-path="root/children/3/children/1/children/0"]');
    const item = visible.parentElement;
    const track = visible.closest('.iui-carousel-track');
    const text = visible.querySelector('.iui-text').getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1100';
    for (const element of document.querySelectorAll('[data-dsh-iui-block-path]')) {
      const path = element.getAttribute('data-dsh-iui-block-path');
      const rects = [...element.querySelectorAll('*')].map(child => child.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
      if (rects.length === 0) continue;
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const rect of rects) { left = Math.min(left, rect.left); top = Math.min(top, rect.top); right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom); }
      const box = document.createElement('div');
      box.setAttribute('data-overlay-path', path);
      box.style.cssText = 'position:fixed;pointer-events:auto;left:' + left + 'px;top:' + top + 'px;width:' + (right - left) + 'px;height:' + (bottom - top) + 'px;z-index:' + path.split('/children/').length;
      layer.appendChild(box);
    }
    document.body.appendChild(layer);
    const hit = document.elementFromPoint(text.left + text.width / 2, text.top + text.height / 2)?.getAttribute('data-overlay-path') ?? null;
    layer.remove();
    return {
      insideItem: text.left >= itemRect.left - 1 && text.right <= itemRect.right + 1 && text.top >= itemRect.top - 1 && text.bottom <= itemRect.bottom + 1,
      insideTrack: text.top >= trackRect.top - 1 && text.bottom <= trackRect.bottom + 1 && text.left >= trackRect.left - 1 && text.right <= trackRect.right + 1,
      hit,
    };
  })()`)
  check(carouselOverlay.insideItem, true, 'carousel child overlay rect stays inside its carousel item')
  check(carouselOverlay.insideTrack, true, 'visible carousel child overlay rect stays inside the track viewport')
  check(carouselOverlay.hit, 'root/children/3/children/1/children/0', 'depth-ordered overlay hits the visible carousel child')

  // 8d. Scrolling carousel: geometry parity and anchors follow the scroll.
  await renderMode('baseline', CAROUSEL_SCROLL_PROGRAM)
  const scrollBaseline = await geometry()
  await renderMode('nested', CAROUSEL_SCROLL_PROGRAM)
  await wait(`document.querySelectorAll('[data-dsh-iui-block-path]').length === 4`, 'carousel scroll nested slots')
  const scrollNested = await geometry()
  const scrollDelta = geometryDelta(scrollBaseline, scrollNested)
  check(scrollDelta.maxTextDelta <= 1.5, true, `scrolling carousel geometry unchanged (max delta ${scrollDelta.maxTextDelta}px)`)
  const scrollProbe = await read(`(async () => {
    const slot = path => document.querySelector('[data-dsh-iui-block-path="' + path + '"]');
    const union = element => {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const child of element.querySelectorAll('*')) {
        const rect = child.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        left = Math.min(left, rect.left); top = Math.min(top, rect.top); right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
      }
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    const track = document.querySelector('.iui-carousel-track');
    const before = union(slot('root/children/0/children/2')).left;
    const widthBefore = track.scrollWidth;
    track.scrollLeft = 250;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = union(slot('root/children/0/children/2')).left;
    const second = slot('root/children/0/children/1');
    const secondRect = union(second);
    const trackRect = track.getBoundingClientRect();
    const textRect = second.querySelector('.iui-text').getBoundingClientRect();
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1100';
    for (const element of document.querySelectorAll('[data-dsh-iui-block-path]')) {
      const path = element.getAttribute('data-dsh-iui-block-path');
      const rects = [...element.querySelectorAll('*')].map(child => child.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
      if (rects.length === 0) continue;
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const rect of rects) { left = Math.min(left, rect.left); top = Math.min(top, rect.top); right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom); }
      const box = document.createElement('div');
      box.setAttribute('data-overlay-path', path);
      box.style.cssText = 'position:fixed;pointer-events:auto;left:' + left + 'px;top:' + top + 'px;width:' + (right - left) + 'px;height:' + (bottom - top) + 'px;z-index:' + path.split('/children/').length;
      layer.appendChild(box);
    }
    document.body.appendChild(layer);
    const hit = document.elementFromPoint(textRect.left + textRect.width / 2, textRect.top + textRect.height / 2)?.getAttribute('data-overlay-path') ?? null;
    layer.remove();
    return {
      before, after, scrollLeft: track.scrollLeft, widthBefore, widthAfter: track.scrollWidth,
      visible: secondRect.left >= trackRect.left - 1 && secondRect.right <= trackRect.right + 1,
      hit,
    };
  })()`)
  check(scrollProbe.scrollLeft > 0, true, `carousel track scrolled (scrollLeft=${scrollProbe.scrollLeft})`)
  check(near(scrollProbe.before - scrollProbe.after, scrollProbe.scrollLeft, 6), true, `carousel slot anchors follow the scroll (${scrollProbe.before} -> ${scrollProbe.after}, scrollLeft=${scrollProbe.scrollLeft})`)
  check(scrollProbe.widthBefore, scrollProbe.widthAfter, 'scrolling carousel keeps the same scroll width')
  check(scrollProbe.visible, true, 'scrolled carousel item is inside the track viewport')
  check(scrollProbe.hit, 'root/children/0/children/1', 'overlay hits the visible carousel child after scrolling')

  console.log(`[layout] nested vs baseline: card≤${nestedDelta.maxCardDelta}px text≤${nestedDelta.maxTextDelta}px root=${nestedDelta.rootDelta}px body=${baseline.bodyHeight}/${nestedGeometry.bodyHeight}px`)
  console.log(`[layout] torture  vs baseline: card≤${tortureDelta.maxCardDelta}px text≤${tortureDelta.maxTextDelta}px body=${tortureBaseline.bodyHeight}/${tortureNested.bodyHeight}px`)
  console.log(`[layout] containers vs baseline: card≤${containersDelta.maxCardDelta}px text≤${containersDelta.maxTextDelta}px body=${containersBaseline.bodyHeight}/${containersGeometry.bodyHeight}px; carousel items=${JSON.parse(carouselItemDelta).length}`)
  console.log(`[layout] typography vs baseline: card≤${typoDelta.maxCardDelta}px text≤${typoDelta.maxTextDelta}px fonts=${JSON.stringify(nestedTypography)}`)
  console.log(`[carousel] scroll delta left=${scrollProbe.before}->${scrollProbe.after} scrollLeft=${scrollProbe.scrollLeft} width=${scrollProbe.widthBefore}/${scrollProbe.widthAfter} hit=${scrollProbe.hit}`)
  console.log(`[structure] slots=${slots.length} paths=${EXPECTED_PATHS.length} containerSlots=${containerPaths.length} resolver=on fallback=on toplevel-rootSlots=2`)
  console.log(`[hit-test] real=${JSON.stringify(overlay.realPointer)} overlay=${JSON.stringify(overlay.overlayPointer)}`)
  console.log(`\nCONCLUSION: nestedBlockSlots renders all seven allowlisted container types (Col/Row/Box/Grid/Card/Section/Carousel) as nested BlockSlots with resolver ids and exact layout parity; Grid/Carousel/Section click mapping and Carousel scroll anchors are correct; Carousel stays in the whitelist.`)
  console.log(`nested-edit-renderer e2e: ${checks} checks passed`)
} finally {
  try { cdp?.close() } catch { /* already closed */ }
  await browser?.cleanup()
  server?.close()
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
}
