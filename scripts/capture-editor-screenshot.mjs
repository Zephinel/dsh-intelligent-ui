#!/usr/bin/env node
/**
 * Capture one deterministic README screenshot of the artifact editor.
 *
 * Uses the artifact-edit browser harness (production card/editor components,
 * fake Host responses) and crops the card + docked panel at 2x. No real model.
 *
 *   node scripts/capture-editor-screenshot.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromeExists, connectCdp, launchChrome, startStaticServer } from '../test/support/browser.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lang = process.argv.includes('--en') ? 'en' : 'zh'
const cardArg = process.argv.find(arg => arg.startsWith('--card='))
const cardMode = cardArg !== undefined
const cardKind = cardMode ? cardArg.slice('--card='.length) : undefined
const out = join(root, cardMode
  ? `assets/intelligent-ui-${cardKind}-${lang}.webp`
  : lang === 'en' ? 'assets/intelligent-ui-editing-en.webp' : 'assets/intelligent-ui-editing-zh.webp')
const ENGLISH_PROGRAM = `root = Col([headline, intro, facts, routeCard, stayCard, dayCard, budgetCard, paceCard, note], 3)
headline = Title("Two days in Shanghai", "2xl")
intro = Text("Riverside on day one, plane trees and lilong lanes on day two. Tick places off as you go; the page updates in the browser.", "md", "muted")
facts = Row([Badge("2 days"), Badge("~12 km walk"), Badge("¥3,000 budget", "success"), Badge("Best in April–June", "info")], 2, null, null, true)
routeCard = Card([Row([Col([Title("The route", "lg"), Caption("pins in visit order")], 2), Badge("4 stops", "info")], 2, "center"), Divider(), List(["The Bund — 08:30", "Nanjing Road — 14:00", "Wukang Road — 09:30", "Yu Garden — 15:00"])], "outline")
stayCard = Card([Title("Where to stay", "lg"), Text("Jing'an, two blocks from the metro: quiet at night and close to the second-day walk.", "sm")], "outline")
dayCard = Card([Row([Title("Day two", "lg"), Badge("9:30 start", "warning")], 2, "center"), Checkbox($garden, "Yu Garden before lunch"), Checkbox($bund, "The Bund at sunset"), Caption("2 of 4 stops planned")], "outline")
budgetCard = Card([Title("Budget for two", "lg"), Table(["Item", "Amount"], [["Stay", "¥1,200"], ["Food", "¥900"], ["Transit", "¥300"], ["Tickets & coffee", "¥600"], ["Total", "¥3,000"]])], "outline")
paceCard = Card([Title("Re-plan at your pace", "lg"), SegmentedControl($pace, ["Relaxed", "Packed"])], "outline")
note = Text("Tap Edit to change any block, or drag rows to reorder the page. Nothing changes until you send.", "sm", "muted")
$pace = "Relaxed"
$garden = false
$bund = false`
const CHINESE_PROGRAM = `root = Col([headline, intro, facts, routeCard, stayCard, dayCard, budgetCard, paceCard, note], 3)
headline = Title("上海两日行程", "2xl")
intro = Text("第一天沿江，第二天梧桐区和里弄。勾选去过的地点，页面在浏览器里直接更新。", "md", "muted")
facts = Row([Badge("2 天"), Badge("约 12 km 步行"), Badge("¥3,000 预算", "success"), Badge("4–6 月最佳", "info")], 2, null, null, true)
routeCard = Card([Row([Col([Title("路线", "lg"), Caption("按到访顺序编号")], 2), Badge("4 站", "info")], 2, "center"), Divider(), List(["外滩 — 08:30", "南京路 — 14:00", "武康路 — 09:30", "豫园 — 15:00"])], "outline")
stayCard = Card([Title("住在哪里", "lg"), Text("静安，离地铁两个街区：晚上安静，第二天的步行路线也近。", "sm")], "outline")
dayCard = Card([Row([Title("第二天", "lg"), Badge("9:30 出发", "warning")], 2, "center"), Checkbox($garden, "午饭前去豫园"), Checkbox($bund, "日落时去外滩"), Caption("4 个地点中已计划 2 个")], "outline")
budgetCard = Card([Title("两人的预算", "lg"), Table(["项目", "金额"], [["住宿", "¥1,200"], ["餐饮", "¥900"], ["交通", "¥300"], ["门票与咖啡", "¥600"], ["总计", "¥3,000"]])], "outline")
paceCard = Card([Title("按你的节奏重排", "lg"), SegmentedControl($pace, ["轻松", "紧凑"])], "outline")
note = Text("点编辑可以改任意区块，或拖动行调整页面顺序；发送前不会改动原页面。", "sm", "muted")
$pace = "轻松"
$garden = false
$bund = false`
const DASHBOARD_EN = `root = Col([headline, intro, kpis, trend, breakdown, detail, note], 3)
headline = Title("Q3 revenue review", "2xl")
intro = Text("Revenue is up 18.5% over August. Change the region filter to see the detail update.", "md", "muted")
kpis = Grid([kpiRevenue, kpiOrders, kpiAov, kpiGrowth], 4, 150, 3)
kpiRevenue = Card([Caption("REVENUE"), Title("$11,830", "xl"), Caption("+18.5% vs August")], "soft")
kpiOrders = Card([Caption("ORDERS"), Title("16", "xl"), Caption("+2.4% vs August")], "soft")
kpiAov = Card([Caption("AVG ORDER"), Title("$739", "xl"), Caption("+15.7% vs August")], "soft")
kpiGrowth = Card([Caption("GROWTH"), Title("+18.5%", "xl"), Caption("August to July")], "soft")
trend = Card([Title("Revenue by week", "lg"), Chart("line", [{week: "W1", revenue: 3200}, {week: "W2", revenue: 4100}, {week: "W3", revenue: 3800}, {week: "W4", revenue: 4630}], "week", ["revenue"], "currency", "USD")], "outline")
breakdown = Card([Title("Share by region", "lg"), Chart("donut", [{region: "North", share: 42.1}, {region: "South", share: 26}, {region: "East", share: 31.9}], "region", ["share"], "percent")], "outline")
detail = Card([Title("Orders by region", "lg"), Table(["Region", "Orders", "Revenue"], [["North", "7", "$4,980"], ["South", "4", "$3,010"], ["East", "5", "$3,840"]])], "outline")
note = Text("All numbers update locally; no model round trip.", "sm", "muted")`
const DASHBOARD_ZH = `root = Col([headline, intro, kpis, trend, breakdown, detail, note], 3)
headline = Title("第三季度营收回顾", "2xl")
intro = Text("营收比八月增长 18.5%。切换地区筛选，明细会立即重算。", "md", "muted")
kpis = Grid([kpiRevenue, kpiOrders, kpiAov, kpiGrowth], 4, 150, 3)
kpiRevenue = Card([Caption("营收"), Title("$11,830", "xl"), Caption("比八月 +18.5%")], "soft")
kpiOrders = Card([Caption("订单"), Title("16", "xl"), Caption("比八月 +2.4%")], "soft")
kpiAov = Card([Caption("客单价"), Title("$739", "xl"), Caption("比八月 +15.7%")], "soft")
kpiGrowth = Card([Caption("增长"), Title("+18.5%", "xl"), Caption("八月对七月")], "soft")
trend = Card([Title("每周营收", "lg"), Chart("line", [{week: "W1", revenue: 3200}, {week: "W2", revenue: 4100}, {week: "W3", revenue: 3800}, {week: "W4", revenue: 4630}], "week", ["revenue"], "currency", "USD")], "outline")
breakdown = Card([Title("地区占比", "lg"), Chart("donut", [{region: "北部", share: 42.1}, {region: "南部", share: 26}, {region: "东部", share: 31.9}], "region", ["share"], "percent")], "outline")
detail = Card([Title("各地区订单", "lg"), Table(["地区", "订单", "营收"], [["北部", "7", "$4,980"], ["南部", "4", "$3,010"], ["东部", "5", "$3,840"]])], "outline")
note = Text("所有数字在本地重算，不产生模型请求。", "sm", "muted")`
const QUIZ_EN = `root = Col([headline, intro, q1, q2, score, note], 3)
headline = Title("Coffee brewing quiz", "2xl")
intro = Text("Three quick questions; feedback appears as you answer.", "md", "muted")
q1 = Card([Title("1. Brew ratio", "lg"), Text("20 g coffee, 300 g water — what ratio is that?", "sm"), RadioGroup($q1, ["1:10", "1:15", "1:18"], "Ratio"), Text($q1 == "1:15" ? "Correct — 300 ÷ 20 = 15." : "Try again: 300 ÷ 20 = 15.", "sm", $q1 == "" ? "muted" : "success")], "outline")
q2 = Card([Title("2. Water temperature", "lg"), Text("Which temperature is recommended for a light roast?", "sm"), RadioGroup($q2, ["82 °C", "92–94 °C", "100 °C"], "Temperature"), Text($q2 == "92–94 °C" ? "Correct — light roasts need hotter water." : "Try again: light roasts need hotter water.", "sm", $q2 == "" ? "muted" : "success")], "outline")
score = Card([Title("Score", "lg"), Text(($q1 == "1:15" ? 1 : 0) + ($q2 == "92–94 °C" ? 1 : 0) + " / 2"), Celebration($q1 == "1:15" && $q2 == "92–94 °C")], "soft")
note = Text("Every answer is checked in the browser; no model round trip.", "sm", "muted")
$q1 = ""
$q2 = ""`
const QUIZ_ZH = `root = Col([headline, intro, q1, q2, score, note], 3)
headline = Title("咖啡冲煮小测", "2xl")
intro = Text("三道快问快答；回答后立即显示反馈。", "md", "muted")
q1 = Card([Title("1. 冲煮比例", "lg"), Text("20 g 咖啡粉配 300 g 水，比例是多少？", "sm"), RadioGroup($q1, ["1:10", "1:15", "1:18"], "比例"), Text($q1 == "1:15" ? "正确 — 300 ÷ 20 = 15。" : "再试一次：300 ÷ 20 = 15。", "sm", $q1 == "" ? "muted" : "success")], "outline")
q2 = Card([Title("2. 水温", "lg"), Text("浅烘咖啡推荐用多少度的水？", "sm"), RadioGroup($q2, ["82 °C", "92–94 °C", "100 °C"], "水温"), Text($q2 == "92–94 °C" ? "正确 — 浅烘需要更高的水温。" : "再试一次：浅烘需要更高的水温。", "sm", $q2 == "" ? "muted" : "success")], "outline")
score = Card([Title("得分", "lg"), Text(($q1 == "1:15" ? 1 : 0) + ($q2 == "92–94 °C" ? 1 : 0) + " / 2"), Celebration($q1 == "1:15" && $q2 == "92–94 °C")], "soft")
note = Text("所有答案都在浏览器里判断，不产生模型请求。", "sm", "muted")
$q1 = ""
$q2 = ""`
const PROGRAMS = {
  itinerary: { title: { en: 'Two days in Shanghai', zh: '上海两日行程' }, program: { en: ENGLISH_PROGRAM, zh: CHINESE_PROGRAM } },
  dashboard: { title: { en: 'Q3 revenue review', zh: '第三季度营收回顾' }, program: { en: DASHBOARD_EN, zh: DASHBOARD_ZH } },
  quiz: { title: { en: 'Coffee brewing quiz', zh: '咖啡冲煮小测' }, program: { en: QUIZ_EN, zh: QUIZ_ZH } },
}
const temp = await mkdtemp(join(tmpdir(), 'iui-editor-shot-'))
let server, browser, cdp

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

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="bundle.css"><style>
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
body { margin:0; background:#fff; color:var(--dsw-alias-label-primary); font:14px/1.5 var(--dsw-font-family); }
main { margin:24px auto; max-width:var(--dsh-chat-content-width); }
*:focus, *:focus-visible { outline:none !important; }
</style></head><body><div id="root"></div><script type="module" src="bundle.js"></script></body></html>`

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
  await writeFile(join(temp, 'index.html'), HTML)
  server = await startStaticServer(temp)
  browser = await launchChrome({ url: server.url, width: 1500, height: 1100 })
  assert.ok(browser, 'Chrome required')
  cdp = await connectCdp(browser.port)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  const read = (expression) => cdp.evaluate(expression)
  const wait = (expression, label) => cdp.waitFor(expression, label, { timeout: 10000 })
  await wait('!!document.querySelector("[data-dsh-iui-edit-entry]")', 'edit entry')
  await read(`window.__language(${JSON.stringify(lang)})`)
  await read(`window.__resetCards()`)
  const spec = PROGRAMS[cardKind ?? 'itinerary']
  const program = spec.program[lang]
  const title = spec.title[lang]
  await read(`window.__addCard('editor-shot', ${JSON.stringify(title)}, ${JSON.stringify(program)})`)
  await wait(`!!document.querySelector('[data-dsh-iui-call-id="editor-shot"] [data-dsh-iui-edit-entry]')`, 'editor card')
  if (cardMode) {
    await sleep(900)
    const cardRect = await read(`(() => {
      const card = document.querySelector('.dsh-iui-card');
      const a = card.getBoundingClientRect();
      const body = card.querySelector('.dsh-iui-body');
      const children = body ? [...body.children] : [];
      const contentBottom = children.reduce((bottom, child) => {
        const rect = child.getBoundingClientRect();
        return rect.height > 0 ? Math.max(bottom, rect.bottom) : bottom;
      }, a.top + 48);
      const height = Math.min(window.innerHeight - a.top, contentBottom - a.top + 24);
      return { x: Math.max(0, a.left - 16), y: Math.max(0, a.top - 16), width: a.width + 32, height: Math.max(200, height) };
    })()`)
    const cardShot = await cdp.send('Page.captureScreenshot', {
      format: 'webp', quality: 92,
      clip: { x: cardRect.x, y: cardRect.y, width: cardRect.width, height: cardRect.height, scale: 2 },
    })
    await mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(out, Buffer.from(cardShot.data, 'base64'))
    console.log(`card screenshot: ${out.replace(root + '/', '')} (${cardRect.width}x${cardRect.height} @2x)`)
  } else {
  await read(`document.querySelector('[data-dsh-iui-call-id="editor-shot"] [data-dsh-iui-edit-entry]').click()`)
  await wait('!!document.querySelector("[data-dsh-iui-edit-view]")', 'edit view')
  await sleep(600)
  await read(`document.querySelector('[data-dsh-iui-edit-row-menu]')?.click()`)
  await wait('!!document.querySelector("[data-dsh-iui-edit-row-menu-panel]")', 'row menu')
  await sleep(200)
  const rect = await read(`(() => {
    const card = document.querySelector('.dsh-iui-card');
    const panel = document.querySelector('.dsh-iui-edit-panel');
    const a = card.getBoundingClientRect();
    const b = panel.getBoundingClientRect();
    const left = Math.max(0, Math.min(a.left, b.left) - 16);
    const top = Math.max(0, Math.min(a.top, b.top) - 16);
    const right = Math.min(window.innerWidth, Math.max(a.right, b.right) + 16);
    const bottom = Math.min(window.innerHeight, Math.max(a.bottom, b.bottom) + 16);
    return { x: left, y: top, width: right - left, height: bottom - top };
  })()`)
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'webp', quality: 92,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 },
  })
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(out, Buffer.from(shot.data, 'base64'))
  console.log(`editor screenshot: ${out.replace(root + '/', '')} (${rect.width}x${rect.height} @2x)`)
  }
} finally {
  cdp?.close()
  await browser?.cleanup()
  server?.close()
  await rm(temp, { recursive: true, force: true })
}
