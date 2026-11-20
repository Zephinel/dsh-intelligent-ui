# Inline UI screenshots

The two inline captures in the READMEs come from **real DSH model sessions**:
the assistant wrote the prose and the `openui` fence, and the extension's
production fence renderer drew the interactive stage browser in the message.
They are not fixture renders and were not composited.

## Environment

- Date: 2026-11-20 (local, America/New_York).
- DSH: **0.2.2-rc.5**, booted as a **throwaway isolated instance** with its own
  `DSH_HOME` and demo workspace, loading the working tree through a `link:`
  dependency. The daily DSH profile and the launchd service were not used.
- Model: **DeepSeek V4.1 Flash**, reasoning effort **High**.
- Scope: **This session only**, with display style **Auto**, both set from the
  composer chip before the first prompt. The global default stayed off.
- Appearance: **Light**, browser zoom **100 %**, **2× DPR**, captured through
  CDP in a disposable headless Chrome profile.

## Source sessions and prompts

| Lang | Session title | File | Dimensions |
| --- | --- | --- | --- |
| en | `Model and agent harness explained` | `assets/intelligent-ui-readme-inline-en.webp` | 1530×900 |
| zh | `Agent Harness 与 Model 协作流程` | `assets/intelligent-ui-readme-inline-zh.webp` | 1530×690 |

English prompt:

> Answer directly in English with no preamble: in two short paragraphs (under
> 140 words total), explain how a model and an agent harness work together.
> Between the two paragraphs, embed one compact interactive inline UI using an
> ```openui fenced code block: a SegmentedControl switching 4 stages ("1 Route",
> "2 Reason", "3 Tool", "4 Render") paired with a clean Svg flow diagram that
> highlights the active stage and shows a one-line caption. Do not wrap the root
> in a Card, do not call render_ui, light theme, no external images, and do not
> read files or run commands.

Chinese prompt:

> 请直接用中文回答，不要开场白：用两段简短文字（总共不超过 150 字）解释 Agent
> Harness 与 Model 的协作流程。在两段文字中间，用 ```openui 围栏代码块内嵌一个紧凑
> 的可交互阶段浏览器：顶部用 SegmentedControl 切换「1 路由 / 2 推理 / 3 工具 / 4
> 渲染」4 个阶段，下方配合一个简洁的 Svg 流程图高亮当前阶段，并显示一句当前阶段
> 说明。不要包外层 Card，不要调用 render_ui 生成轮末卡片，浅色主题，不要外部图片，
> 不要读写文件或运行命令。

Both sessions produced exactly one inline fence and no turn-tail card. Before
the capture the second stage was clicked for real (`2 推理` at (594, 484) CSS,
`2 Reason` at (614, 506) CSS) so the image shows live interaction state: the
selected pill moves to stage 2, the SVG highlight follows and the one-line
caption changes (`Harness 解析请求…` → `Model 在上下文里推理，决定下一步动作。`,
`Harness chooses the path.` → `Model weighs the next step.`).

The Chinese hero took three attempts for quality only: the first render painted
the active node label with `currentColor` on a dark fill (invisible label), the
second produced a 248 px-wide diagram inside a 687 px block, and the third is
the committed image. Neither language ever produced a renderer error banner.

## Capture method

The cropped region is the assistant Markdown container (prose + inline fence)
plus **24 px** on each side; the message's top status row/divider and the bottom
action bar sit outside the clip. At the 1400 px window this DSH build lays the
assistant column out at 717 CSS px, so the clip is 765 CSS px wide and the
committed WebP is **1530 px** wide at 2×. The chat sidebar, composer and session
chrome are outside the crop. No text or UI state was edited before capture.

## Reproducing

These are one-off real model turns, so they cannot be regenerated exactly. Keep
the committed captures and recapture from a live session if the inline renderer
or DSH message chrome changes; do not hand-edit the image.
