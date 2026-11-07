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
| `assets/intelligent-ui-real-itinerary-zh.webp` | 1904×2384 |
| `assets/intelligent-ui-real-dashboard-zh.webp` | 1904×1749 |
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
