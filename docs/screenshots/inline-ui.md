# Inline UI screenshots

The two inline captures in the READMEs come from **real DSH model sessions**:
the assistant wrote the prose and the `openui` fence, and the extension's
production fence renderer drew the comparison table in the message. They are
not fixture renders and were not composited.

## Environment

- Date: 2026-11-19 (local, Asia/Shanghai).
- DSH: **0.2.2-rc.5**, running the extension at the current working tree.
- Model: **DeepSeek V4.1 Flash**, reasoning effort **Max**.
- Scope: **This session only**, set from the composer UI control before the
  first prompt. Global default stayed off.
- Appearance: **Light**.

## Source sessions and prompts

| Lang | Session title | File | Dimensions |
| --- | --- | --- | --- |
| en | `Answer in English in a` | `assets/intelligent-ui-readme-inline-en.webp` | 1456×1270 |
| zh | `请直接用中文回答，不要开场` | `assets/intelligent-ui-readme-inline-zh.webp` | 1456×1090 |

English prompt:

> Answer directly in English, with no preamble: explain the difference between
> a model and a harness in three short paragraphs (under 180 words). In the
> middle, embed one compact comparison table as inline UI using an ```openui
> fenced code block; do not call render_ui and do not create a turn-end card.
> Use a light theme and no external images. Do not use tools, read files, or
> run commands.

Chinese prompt:

> 请直接用中文回答，不要开场白：用三段简短文字（不超过 180 字）解释 model 和
> harness 的区别，并在中间内嵌一个紧凑的对比表 UI，使用 ```openui 围栏代码块；
> 不要调用 render_ui，不要生成轮末卡片。浅色主题，不要外部图片；不要使用工具、
> 读文件或运行命令。

Both sessions produced exactly one inline fence and no turn-tail card. The
English capture crops from the second paragraph onward because the model opened
with an unrelated sentence; the Chinese capture starts at the answer body. The
cropped region is the assistant Markdown container plus 24 px on each side,
captured at 2× through CDP. The chat sidebar, composer and session chrome are
outside the crop. No text or table state was edited before capture.

## Reproducing

These are one-off real model turns, so they cannot be regenerated exactly. Keep
the committed captures and recapture from a live session if the inline renderer
or DSH message chrome changes; do not hand-edit the image.
