# dsh-intelligent-ui

[中文](README.md) | English

[![npm version](https://img.shields.io/npm/v/@zephinel/dsh-intelligent-ui?label=npm)](https://www.npmjs.com/package/@zephinel/dsh-intelligent-ui)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.1-4f46e5)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![publish](https://github.com/Zephinel/dsh-intelligent-ui/actions/workflows/publish.yml/badge.svg)](https://github.com/Zephinel/dsh-intelligent-ui/actions/workflows/publish.yml)

**Turn a model answer into a page you can actually use.** The model calls the `render_ui` tool and writes its answer as an [OpenUI Lang 1.0](https://openui.com) program; at the end of the turn, DSH renders it into an interactive page — maps, photos, charts, checklists, forms, SVG drawings and mini-games are all real components, not screenshots.

Ported from [Open Intelligent UI](https://github.com/thesysdev/open-intelligent-ui) (MIT), with an Agent Skill (`intelligent-ui`) that the plugin registers automatically.

> [!NOTE]
> **Current status**: published on GitHub and npm as **`@zephinel/dsh-intelligent-ui@0.2.2-26-10-21`** (`latest`).

## What it looks like

![Two days in Shanghai: photos, map, timeline, checklist, budget and interactive controls all rendered by OpenUI Lang](assets/intelligent-ui-itinerary.webp)

- When the user asks "plan two days in Shanghai", the model no longer replies with just a paragraph: it renders an itinerary page (map + photos + timeline + checklist + budget) at the end of the answer that can be clicked, checked off and dragged.
- The `$variables`, `@Set` and `@functions` inside the card all execute locally in the browser: checkboxes, sliders, steppers, timers and budget allocation never require another model request.
- Only actions that genuinely need to continue the conversation (`@ToAssistant`, such as a form submission) put a short message back into the composer and send it.

## Component tour

The renderer is not a chat bubble around a paragraph — it is a full component library: **57 components, 73 functions, 5 action steps**. The three cards below are real renders from the extension: same renderer, same DSH theme tokens, no mockups:

![Layout and typography: the 57-component tour, Col, Row, Box, Grid, Card, Carousel, Popover, Divider, Spacer, Section, Toc and 12 text components](assets/intelligent-ui-components-layout.webp)

![Inputs, media and data: 13 form controls plus photos, tables, charts, maps and YouTube](assets/intelligent-ui-components-inputs.webp)

![Play and drawing: flip cards, the confetti trigger, ten SVG shape primitives and a sandboxed iframe game](assets/intelligent-ui-components-drawing.webp)

## More examples

![Sales dashboard: KPIs, line chart, donut and detail table all recompute when the region filter changes](assets/intelligent-ui-example-dashboard.webp)

![Coffee brewing quiz: flip cards, per-answer feedback, score bar and a sandboxed mini-game](assets/intelligent-ui-example-quiz.webp)

On a narrow screen (about 380 px) the card switches to a single column, and maps and charts fit the card width; over-long chart category labels are trimmed instead of overflowing:

![The pour-over coffee calculator on a narrow screen: single-column cards, no horizontal overflow](assets/intelligent-ui-responsive.webp)

## Capabilities

| Capability | What it gives you |
|---|---|
| Interactive pages | Maps, photos, charts, checklists, forms, SVG drawings and mini-games are real components, not screenshots |
| Image export | The labeled export pill at the right of an answer's action strip saves the rendered result as one PNG with a raw, rounded or card frame; background color and 1x/2x live on the Plugin detail page |
| Interactive-page export | The same menu saves every card from the turn as a **single-file HTML** page (renderer and current theme inlined, about 3.4–4.9 MB); open it locally to keep interacting, and `@ToAssistant` copies its message plus a paste-back-into-DSH hint |
| Local execution | `$variables`, `@Set` and `@functions` run in the browser; only `@ToAssistant` writes a message back |
| Switch and style | Global defaults on the Plugin detail page; the composer UI control overrides per session; Auto / Card / Article |
| Bilingual UI | Follows DSH's UI language; dictionaries live in `src/shared/locales.ts` |
| Agent Skill | Registers `intelligent-ui` with the plugin so the model can load syntax, examples and troubleshooting on demand |
| Plugin detail page | Plugins → Intelligent UI detail page: Availability (global enable), Answer style (Auto / Card / Article), Composition (Free-form layout) and Image export (background color, resolution) |
| Replayable | The generated program enters the session log as a tool argument and replays with history |

## Getting the code

Clone the repository from GitHub:

```bash
git clone https://github.com/Zephinel/dsh-intelligent-ui.git
cd dsh-intelligent-ui
```

You can also install it from npm without a checkout (next section).

## Prerequisites

- **DSH 0.2.1** (the [`dsh` CLI](https://www.npmjs.com/package/@deepseek-ai/dsh)): the Host/Client halves and plugin protocol are developed against this version; the verified version is `0.2.1-rc.2`, and later versions are unverified. Install with `npm install -g @deepseek-ai/dsh`.
- **[Node.js 24](https://nodejs.org/en/download)**: build, tests and `npm pack` are verified on Node 24; the Host bundle targets Node 22 (`target: 'node22'`), and the repository has no `engines` or `.nvmrc` pin, so verify a lower version yourself before using one.
- **`@deepseek-ai/dsh-client-locale`**: the browser half requires a deployment that composes it; DSH Web 0.2.1 includes it by default, and without it the switch and card do not mount (the Host tool and prompt keep working).

Confirm the tools are present:

```bash
node --version   # v24.x
dsh --version    # 0.2.1 or 0.2.1-rc.2
```

The restart examples cover a foreground `dsh web`, macOS launchd and Linux systemd; for other supervisors restart the corresponding service. Verified platforms: macOS (Web + DSH Desktop) and Windows (DSH Desktop); Linux is unverified.

## Quick start

Install from npm (prerequisites are in the previous section):

```bash
dsh plugin --profile web add @zephinel/dsh-intelligent-ui

# pin the current version
dsh plugin --profile web add @zephinel/dsh-intelligent-ui@0.2.2-26-10-21

# or install from GitHub
dsh plugin --profile web add github:Zephinel/dsh-intelligent-ui
```

Restart the DSH process that serves the Web UI (foreground `dsh web`: Ctrl+C, then run it again; launchd/systemd: restart the service), open the URL it prints, and look for the **UI** control on the right side of the composer.

**DSH Desktop** needs no terminal command — install it inside the app:

1. Open **Plugins** in the sidebar → **Add plugin** (or the arrow → **Install a third-party plugin**).
2. Enter `@zephinel/dsh-intelligent-ui@0.2.2-26-10-21` (or just the package name for the latest), then click **Install**.
3. When the install finishes, click **Enable now**; if the **UI** control does not appear, quit and reopen DSH Desktop.

The desktop profile is owned by the Electron app, so `dsh plugin --profile desktop` is rejected. A mainland-China mirror can lag behind the official npm registry for a fresh release; switch the install source back to npm if the version is not found.

For local development, install from a checkout. The extension has **no development server of its own** — it runs inside DSH. The loop is: build → install into the profile → restart DSH Web → open the URL it prints; the **UI** control appears when it worked. There is no watch mode: rebuild with `npm run build` and restart per the cache note below.

```bash
cd /path/to/dsh-intelligent-ui
npm install && npm run build
node scripts/install.mjs  # writes $DSH_HOME/profiles/web/cordis.patch.yml (automatic backup)
```

> [!IMPORTANT]
> After renaming the package or rebuilding `lib/client.js`, a page refresh may keep the old revision; restart the DSH process that serves the Web UI, then reopen the page.

Then click the **UI** control, choose "This session only" (or `/iui on`), set the session Auto / Card / Article style in the same panel if needed, and ask, for example:

```text
Plan two days in Shanghai, with checkboxes and adjustments
```

See [Development and deployment](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.en.md) for uninstall, development and troubleshooting.

## Switch and answer style

![The composer UI control: Off / This session only / Follow global, plus Display style below an inset divider](assets/intelligent-ui-toggle.png)

![The This-session style panel: Auto / Card / Article for this session, or follow the global choice](assets/intelligent-ui-style-panel.webp)

- **Global defaults:** the Plugin detail page's **Enable in all sessions** decides whether new sessions start on; the **Display style** control under **Answer style** sets the default Auto / Card / Article.
- **Session overrides:** the composer **UI** control changes only the current session; choosing **This session only** opens the style panel. `/iui on|off|inherit` and `/iui style auto|card|article|inherit` are equivalent.
- **Auto** lets the model choose: compact Card for interactive/structured answers, Article for detailed/in-depth/long-form ones. Article pages need a `Toc`, collapsible `Section`s and substantive prose, not a skeleton.
- Session state is written atomically to `<DSH_HOME>/dsh-intelligent-ui.json` and survives a refresh or DSH restart; see [Architecture and behavior](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.en.md) for the full semantics.

## Usage

With the switch on, just ask in natural language, for example:

- "Plan two days in Shanghai, with checkboxes and adjustments"
- "Build a gear-shifting simulator for a 7-speed bicycle"
- "Turn these tables into a sales dashboard I can filter"
- "Introduce Chinese history, expandable by dynasty"

Once enabled, **any answer with structure defaults to a card** — including explanations, introductions, timelines, stages, comparisons and things to explore; Markdown is reserved for a single fact, a one- or two-sentence reply, an explicit request for text/document/code, or repeated render failures. When the switch is off the model cannot see `render_ui` and answers in plain text — that is not a failure; turn the switch on and ask again.

To guarantee a card (or when the model still replies in text), invoke the skill explicitly with `/intelligent-ui` in a session where the switch is on; explicit invocation is treated as a direct instruction. You can also say "read the intelligent-ui skill and then build ... with render_ui".

![Plugin detail page: availability, answer style, composition and image export](assets/intelligent-ui-settings.webp)

The Plugin detail page groups its settings into **Availability**, **Answer style**, **Composition** and **Image export**. Global values are the defaults for new sessions; a session override in the composer wins. **Free-form layout** only changes how strongly the design guidance is advisory; it is orthogonal to the answer style. **Image export** stores the default background color and 1x/2x resolution for exported images.

Once an answer has rendered, a labeled **export pill** appears at the **far right** of the message action strip (visually distinct from the native copy / like / branch icons); only answers rendered by the extension have it. It offers a beautification frame — **Raw** (the answer alone), **Rounded** (background color and rounded padding) or **Card** (padding, rounded corners and a soft shadow) — and saves every card rendered by that turn as one PNG. Collapsed cards are expanded for the capture and restored afterwards; the image contains the rendered cards only, not the Markdown text around them and not the export control itself.

The menu also offers **Interactive page** at the bottom: it saves every card from that turn as one HTML file (renderer, current theme and card programs inlined; about 3.4–4.9 MB). Open it in a browser to keep using maps, forms, sliders and the other components; `@ToAssistant` does not call DSH but copies the message and shows “Copied — paste it back into DSH to continue.” The file needs no DSH or extra scripts, though networked components such as maps and photos still need the network.

## Build, test and deploy

```bash
npm run build       # build the prompt, Host and Client bundle
npm run check       # build + Host/Client/packaging tests + renderer checks
npm run pack:check  # inspect the final npm pack file list
npm run test:browser # optional: real-browser E2E (style panel + image export + interactive page + Article spacing; Chrome required)
```

- The typography check inside `npm run check` needs a local Chrome; without one that check is skipped and the remaining tests still run.

The published artifact is a DSH bundle; deploying means installing the plugin into the target DSH profile. See [Development and deployment](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.en.md) for uninstall, local development and version notes.

## Contributing

- Questions and feature requests: use [GitHub Issues](https://github.com/Zephinel/dsh-intelligent-ui/issues).
- Run `npm run check` before submitting; there is no PR CI, so the local command is the gate. Releases are published by the GitHub Actions Trusted Publishing workflow (push a `v*` tag that matches `package.json`).
- When behavior, copy or counts change, update the Chinese and English READMEs, `CHANGELOG.md`, and the matching documents under `docs/`; the sync rules live in `.agents/skills/sync-iui-docs/SKILL.md` (development-only, not shipped in the npm package).
- Repository maintenance skills and doc-sync rules live under `.agents/skills/` (not shipped); AI coding agents also use `npm run check` as the pre-submit gate.

## Known limitations

- The card appears **at the end** of the turn; during generation the process area shows one "Interactive answer" line (交互式回答 in a Chinese UI).
- The model occasionally generates invalid OpenUI Lang; Host validation returns precise errors, and it usually repairs them within the same turn (1–2 attempts in testing).
- The map basemap relies on OpenFreeMap tiles, routes on the OSRM demo, and photos on Wikipedia/Wikimedia; when offline, maps degrade to a list of places and photos to placeholder blocks.
- KaTeX uses global styles already loaded by the DSH shell; if those styles are removed, the Math component degrades to plain text.
- The generation prompt is about 8.5K tokens and is **sent only when the switch covers that session** (global on, or the session explicitly on); when off, that cost is zero (the tool schema is absent too). Article mode produces longer pages, so output tokens and render time increase accordingly.
- The extension's UI copy follows DSH's UI language; the `/iui` Host replies, the command palette's command description and the README screenshots stay in English (the first two are DSH platform behavior).
- Image export does not capture sandboxed iframes (`HtmlView` mini-games), so that region is missing from the image; maps are captured through the preserved WebGL drawing buffer, and a browser without WebGL falls back to the map's own place-list presentation.
- Every card rendered by one turn is combined into one image; the image captures **what is currently rendered**, so it includes the interaction state at export time (checked items, active filters and so on). The export waits for in-card photos and image searches to settle (at most about 12.5 seconds); offline or still-pending photos are recorded from the placeholder state shown on the page.
- The interactive-page export inlines the renderer, the current theme and every card into one HTML file (about 3.4–4.9 MB), so it is large but install-free; maps, photos and other components still need the network. `@ToAssistant` in that page tries the clipboard and shows a toast; when the clipboard is unavailable the toast keeps the message for manual copying.
- The browser half requires a deployment that composes `dsh-client-locale` (included by default in DSH Web 0.2.1); a minimal custom profile without it will not mount the switch or the card, while the Host tool and prompt keep working.
- The configuration on the Plugin detail page requires the DSH settings services: a minimal custom profile without `dsh-settings` / `dsh-client-ui-settings` does not show it, and a Host/Client version mismatch can leave the switch unavailable. Global enable/style and free-form layout only change the prompt and page shape; no model is guaranteed to follow them perfectly, and session style overrides still rely on the Host-injected prompt.

## Documentation

- [Architecture and behavior](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.en.md): Host/Client component tree, the full switch and answer-style semantics, UI language, image and interactive-page export flows, and the Agent Skill.
- [Development and deployment](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.en.md): install and uninstall, development commands, the restart tip after renaming/rebuilding, Host/Client version mismatch and the release layout.
- [Verification record](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/verification.en.md): end-to-end verification, test and packaging results (historical).
- [Changelog](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/CHANGELOG.md): additions, changes and fixes per release.

## License

This project is [MIT](LICENSE). It is based on Open Intelligent UI (MIT, Copyright (c) 2026 Thesys Inc.) and the OpenUI ecosystem; the browser bundle contains lucide-react (ISC), KaTeX (MIT), MapLibre GL JS (BSD-3-Clause), zod (MIT) and SnapDOM (MIT); the standalone interactive-page bundle also inlines React / React DOM (MIT). Full notices and license texts are in `NOTICE` and `licenses/`.
