# Real generation screenshots

The generation gallery in the READMEs is built from screenshots of **real DSH
model sessions** — not from fixtures, harness renders, or image-generation
models. The model generated each artifact itself inside the running DeepSeek
Harness GUI; the captures below are the rendered turn-tail cards from those
sessions.

## Environment

- Date: 2026-11-07 (local, UTC−5), morning session.
- DSH GUI: `http://<LAN-IP>:3080`, `@deepseek-ai/dsh` 0.2.2-rc.1, running
  the extension at `HEAD 4472e6b` (`@zephinel/dsh-intelligent-ui` 0.5.0).
- Model: **DeepSeek V4.1 Flash**, reasoning effort **Max**. The model selector
  was left untouched for every session.
- Intelligent UI scope: **This session only** (composer switch), set explicitly
  for each session before the first prompt. Global default stayed off.
- GUI language: **English** for the `-en` captures, **Chinese** for the `-zh`
  captures. The Chinese set was captured with Settings → General → Language →
  中文 active: the zh itinerary card was generated while the UI was still
  English and re-captured after the switch, so the captured chrome is Chinese;
  the other zh cards were generated under the Chinese UI. The GUI was restored
  to English before finishing.
- Appearance: **Light** for capture. System appearance was rendering dark at
  capture time, so the GUI was temporarily set to Light; it was restored to
  **System** afterwards. `data-ds-theme` was additionally pinned to `light` for
  the shot and restored immediately after.

## Capture method

- Browser: ego-browser (Chromium), driving the real GUI page at 2560×1299 CSS
  (DPR 2). No page reload or mocks involved.
- Per card: expand the card, align its top with the chat scrollport, hide only
  fixed/sticky/absolute chat chrome that would overlap the crop (composer,
  back-to-bottom button) for the shot, then
  `CDP Page.captureScreenshot` with a clip of **card rect + 16 px padding** at
  `scale: 2`, `captureBeyondViewport: true`.
- Committed raws are the same crops downscaled to **2× (1904 px wide)** so the
  repository stays small; the full 4×-pixel captures remain in the untracked
  `.tmp-report/real-generation/` folder for this session.
- No compositing was done on the cards before committing them: content, chrome
  (title, revision history, Edit), and model-chosen layout are exactly what DSH
  rendered.

## Artifact types and source sessions

All English captures were taken with the English GUI; all Chinese captures
with the Chinese GUI (see the note on the zh itinerary above). Sessions were
created with the composer "New session" button.

| Lang | Artifact | Session title | Turns | Captured (local) |
| --- | --- | --- | --- | --- |
| en | Travel itinerary (Shanghai, portrait, vertical day-by-day) | Two-day Shanghai itinerary card | 1 | 08:59 |
| en | Data dashboard (KPIs, line chart, table) | Coffee Shop Analytics Dashboard UI | 2 | 07:31 |
| en | Interactive quiz (3 questions, score) | Use render_ui directly to answer | 1 | 07:31 |
| zh | 旅行行程（上海，竖版：逐日行程、清单、预算） | 请直接用 render_ui 工具回答 | 1 | 09:06 |
| zh | 数据仪表盘（KPI、折线图、表格） | 请直接用 render_ui 工具回答 | 3 | 08:23 |
| zh | 交互测验（3 题、即时反馈、计分） | 请直接用 render_ui 工具回答 | 1 | 07:50 |

Notes:

- The itineraries were replaced after the owner asked to avoid a Japan
  destination: both languages got a newly generated Shanghai card (one real
  turn each, same model/UI/capture method) and both composites were recomposed;
  the dashboard and quiz captures are unchanged. The README hero example and
  the screenshot now use the same city. This second round was captured in the
  same GUI/morning session.
- The English dashboard session's first turn failed with an upstream
  `RATE_LIMIT` error and was re-prompted; the second turn produced the card.
- The Chinese sessions were much slower: the upstream API rejected the first
  two turns of the itinerary and dashboard sessions with `overloaded`, so the
  prompts were resent in the same sessions until a real card rendered. The
  Chinese quiz took one turn (10 min 14 s). No output was substituted and no
  fixture was used.
- The current itinerary cards are 1339 (en) and 1159 (zh) CSS px tall. The
  English card is taller than the default 1299 px viewport, so its capture ran
  with the emulated viewport temporarily grown to 1464 px (override cleared
  after the shot); the Chinese card fits the default viewport, so it did not
  need the override. The card contents themselves were untouched.

## Prompts

English itinerary:

> Use render_ui directly and output exactly one OpenUI Lang page: a compact
> two-day Shanghai itinerary card, portrait single-column tall layout (height
> about 1.4x width), suitable for one README screenshot. Set the render_ui title
> to "Two Days in Shanghai". At most one short intro sentence. Do not
> investigate, do not read or write files, do not run commands, do not create
> DSH pages, do not call propose_action. Light theme (light background, dark
> text), no external image URLs. Content: a route overview (Puxi old town /
> Huangpu riverside then Pudong skyline), day-by-day schedule with times, a
> packing checklist, and a budget table. Checkboxes or segmented controls are
> welcome.

English dashboard:

> Use render_ui directly to answer with exactly one Intelligent UI page: a
> compact analytics dashboard card for a small coffee shop's last 30 days.
> Requirements: set the render_ui title parameter to "Coffee Shop · Last 30
> Days" so the card header names the artifact; at most one short intro
> sentence; do not investigate, do not run any files or commands, do not create
> DSH pages and do not call propose_action; keep the page compact enough to fit
> one screen, suitable for a README screenshot; clean light theme with light
> backgrounds and dark text; no external image URLs. Include 3-4 KPI tiles, one
> line or bar chart, and a small table of top products. Interactive filters or
> segmented controls are welcome.

English quiz:

> Use render_ui directly to answer with exactly one Intelligent UI page: a
> compact interactive quiz card about European capitals, 3 questions.
> Requirements: at most one short intro sentence; do not investigate, do not run
> any files or commands, do not create DSH pages and do not call propose_action;
> keep the page compact enough to fit one screen, suitable for a README
> screenshot; clean light theme with light backgrounds and dark text; no
> external image URLs. Each question needs multiple-choice options with
> immediate feedback and a score; interactive controls are welcome.

Chinese itinerary:

> 请直接用 render_ui 工具回答，只生成一个智能 UI 页面：一张紧凑的上海两日游行程
> 卡片，竖版单列长卡片（高度约为宽度的 1.4 倍），适合放进一张 README 截图。
> 把 render_ui 的标题参数设为「上海两日游」。最多一句简短的引言；不要调研、不要
> 读写文件、不要运行命令、不要创建 DSH 页面、不要调用 propose_action；浅色主题
> （浅底深字），不要使用外部图片地址。内容包含：路线概览（第一天浦西老城与江岸，
> 第二天浦东天际线）、逐日行程与时间安排、行前清单、预算表；可以有可勾选的清单或
> 分段控件。

Chinese dashboard:

> 请直接用 render_ui 工具回答，只生成一个智能 UI 页面：一张咖啡馆最近 30 天的
> 数据分析仪表盘卡片，紧凑到能放进一张 README 截图。要求：把 render_ui 的标题
> 参数设为「咖啡店 · 最近 30 天」；最多一句简短的引言；不要调研、不要读写文件、
> 不要运行命令、不要创建 DSH 页面、不要调用 propose_action；浅色主题（浅底深
> 字），不要使用外部图片地址。内容包含：3–4 个 KPI 指标、一个折线图或柱状图、
> 一张热销商品表格；可以有筛选或分段控件。

Chinese quiz:

> 请直接用 render_ui 工具回答，只生成一个智能 UI 页面：一张关于欧洲首都的交互
> 式测验卡片，3 道题，紧凑到能放进一张 README 截图。要求：把 render_ui 的标题
> 参数设为「欧洲首都小测」；最多一句简短的引言；不要调研、不要读写文件、不要运
> 行命令、不要创建 DSH 页面、不要调用 propose_action；浅色主题（浅底深字），不
> 要使用外部图片地址。每道题给出多个选项并即时反馈对错，带总分；可以有交互控件。

## Files

Card captures (2× crops, card + 16 px padding):

| File | Dimensions |
| --- | --- |
| `assets/intelligent-ui-real-itinerary-en.webp` | 1904×2743 |
| `assets/intelligent-ui-real-dashboard-en.webp` | 1904×1330 |
| `assets/intelligent-ui-real-quiz-en.webp` | 1904×1503 |
| `assets/intelligent-ui-real-itinerary-zh.webp` | 1904×2556 |
| `assets/intelligent-ui-real-dashboard-zh.webp` | 1904×1332 |
| `assets/intelligent-ui-real-quiz-zh.webp` | 1904×1278 |

README composites, composed by `scripts/build-readme-generation-bento.mjs`:

- `assets/intelligent-ui-readme-generation-en.webp` — 1600×1130
- `assets/intelligent-ui-readme-generation-zh.webp` — 1600×1130

Composite geometry (identical for both languages): 1600×1130 canvas, 28 px
padding, 18 px gap, 18 px figure radius, white figures on `#f4f3f0`. Left
column: the tall itinerary card (816×1074, two rows). Right column: dashboard
(710×496) above the quiz (710×560).

The Chinese cards came out with slightly different aspect ratios than the
English ones (shorter itinerary, taller dashboard). The compositor uses
`object-fit: contain` inside the fixed figures, so the real cards are centered
with white margins instead of being cropped; no generated content is cut. The
script also pins the exact 1600×1130 viewport with
`Emulation.setDeviceMetricsOverride` before capturing, because the headless
window is taller than its content viewport.


## 2026-11-20 — Chinese dashboard re-shoot

The Chinese dashboard card is the only card re-captured after the inline-UI
release work. It comes from a **throwaway isolated DSH 0.2.2-rc.5 instance**
(own `DSH_HOME`, own demo workspace, `link:` to this working tree), not from the
daily GUI:

- Model **DeepSeek V4.1 Flash**, reasoning effort **High**; scope **This session
  only**, display style **Auto**; light appearance, 100 % zoom, 2× DPR.
- Session title `咖啡店30天数据仪表盘`; one real turn, 1 m 58 s, no retry.
- Prompt (verbatim):

  > 请直接用 render_ui 工具回答，只生成一个智能 UI 页面：一张咖啡馆最近 30 天的
  > 数据分析仪表盘卡片，紧凑到能放进一张 README 截图。要求：把 render_ui 的 title
  > 参数设为「咖啡店 · 最近 30 天」；最多一句简短引言；不要调研、不要读写文件、
  > 不要运行命令；浅色主题，不要外部图片。包含：3–4 个 KPI 指标、一个带真实波动
  > 趋势（数据有高低起伏，例如 2,800 到 5,620 之间波动）的折线图或柱状图、一张
  > 热销商品小表，以及一个分段筛选控件。

The card rendered fully expanded (no internal scroll), and the chart is a real
30-point series the model labelled **峰值 CN¥5,620 · 谷值 CN¥2,840**. Only fixed
chat chrome that would overlap the card (composer dock) was hidden for the shot;
the card content and chrome were not touched. Clip = card frame + 16 px → 952
CSS px wide → **1904×1526**. The Chinese composite was then recomposed with
`node scripts/build-readme-generation-bento.mjs --lang=zh`.


## 2026-11-20 — Chinese gallery polish (itinerary + dashboard)

Both Chinese cards were re-shot once more on the same throwaway isolated
instance so the Chinese gallery matches the English one: every card header now
shows the **编辑** button, the itinerary has no stray floating button, and the
dashboard fills the top-right 710×496 slot instead of leaving wide side gutters.

- Environment: DSH `0.2.2-rc.5`, private `DSH_HOME`, demo workspace, the working
  tree loaded through a `link:`; DeepSeek V4.1 Flash at effort High, per-session
  `This session only` + `Auto`, light appearance, 100 % zoom, 2× DPR, CDP clips.
- **Itinerary** `上海两日游` (session `生成上海两日游行程卡片`): real `Checkbox`
  rows with the first two ticked and a `已备 2/5` counter, day-by-day timetable,
  budget table and a 经济/舒适 segmented control. Card `920×1246` CSS, clip =
  frame + 16 px → **1904×2556**. The composer dock and the floating
  back-to-bottom button were hidden / unmounted for the shot; a DOM scan for
  visible round floating buttons returned none.
- **Dashboard** `咖啡店 · 最近 30 天` (session `咖啡馆30天数据仪表盘`): one row of
  4 KPI tiles, then a two-column grid — daily-revenue line chart with a 7/30-day
  toggle on the left, five-row top-products table on the right. Series min
  **2,840** / max **5,620**. Card `920×634` CSS, clip = frame + 16 px →
  **1904×1332** (≈1.43:1, so it fills the 710×496 slot). A refinement turn
  removed a ~146 CSS px dead area under the chart axis (now 13 px from the last
  content) and un-duplicated the title (body heading `近 30 天经营概览`).
- Prompt (itinerary):

  > 请直接用 render_ui 工具回答，只生成一个智能 UI 页面：一张紧凑的上海两日游行程卡片，竖版单列长卡片（高度约为宽度的 1.4 倍），适合放进一张 README 截图。把 render_ui 的 title 设为「上海两日游」。最多一句简短引言；不要调研、不要读写文件、不要运行命令；浅色主题，不要外部图片。包含：路线概览（第一天浦西老城与江岸，第二天浦东天际线）、逐日时间表、使用真实 Checkbox 组件的 4–5 项行前清单（默认勾选前 2 项并显示已备计数）、简洁预算表与经济/舒适分段控件。

- Prompt (dashboard):

  > 请直接用 render_ui 工具回答，只生成一个智能 UI 页面：一张横向紧凑布局的咖啡馆最近 30 天数据分析仪表盘，宽高比约 1.4:1（横向宽卡片，不要竖向堆得很长），适合放进 README 右上角网格。把 render_ui 的 title 设为「咖啡店 · 最近 30 天」；最多一句简短引言；不要调研、不要读写文件、不要运行命令；浅色主题，不要外部图片。结构严格紧凑：顶部 4 个横排 KPI 指标；下方用 2 列 Grid 并排摆放——左列是带真实高低起伏（例如 2,840 到 5,620 波动）的每日营业额折线图加「7 天 / 30 天」切换，右列是 5 行热销商品表格。

The Chinese composite was then recomposed with
`node scripts/build-readme-generation-bento.mjs --lang=zh`; the quiz card and
the English set are untouched.

## Reproducing the composites

The cards come from one-off real model turns and cannot be regenerated exactly,
so the compositor is deliberately **not** part of `npm run capture:readme`
(which stays deterministic and fixture-based). It only re-composes the
committed captures:

```bash
node scripts/build-readme-generation-bento.mjs          # both languages
node scripts/build-readme-generation-bento.mjs --lang=zh
```

The script needs the same Chrome that the other README capture scripts use.

Inline UI captures from separate real sessions are documented in [inline-ui.md](inline-ui.md).
