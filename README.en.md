# dsh-intelligent-ui

[中文](README.md) | English

**Turn a model answer into a page you can actually use.** The model calls the `render_ui` tool and writes its answer as an [OpenUI Lang 1.0](https://openui.com) program; at the end of the turn, DSH renders it into an interactive page — maps, photos, charts, checklists, forms, SVG drawings and mini-games are all real components, not screenshots.

Ported from [Open Intelligent UI](https://github.com/thesysdev/open-intelligent-ui) (MIT), with an Agent Skill (`intelligent-ui`) that the plugin registers automatically.

> [!NOTE]
> **Current status**: published on GitHub and npm as **`@zephinel/dsh-intelligent-ui@0.1.0-26-10-21`** (`latest`).

## What it looks like

![Two days in Shanghai: photos, map, timeline, checklist, budget and interactive controls all rendered by OpenUI Lang](assets/intelligent-ui-itinerary.webp)

- When the user asks "plan two days in Shanghai", the model no longer replies with just a paragraph: it renders an itinerary page (map + photos + timeline + checklist + budget) at the end of the answer that can be clicked, checked off and dragged.
- The `$variables`, `@Set` and `@functions` inside the card all execute locally in the browser: checkboxes, sliders, steppers, timers and budget allocation never require another model request.
- Only actions that genuinely need to continue the conversation (`@ToAssistant`, such as a form submission) put a short message back into the composer and send it.

## Component tour

The renderer is not a chat bubble around a paragraph — it is a full component library: **55 components, 73 functions, 5 action steps**. The three cards below are real renders from the extension: same renderer, same DSH theme tokens, no mockups:

![Layout and typography: Col, Row, Box, Grid, Card, Carousel, Popover, Divider, Spacer and 12 text components](assets/intelligent-ui-components-layout.webp)

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
| Local execution | `$variables`, `@Set` and `@functions` run in the browser; only `@ToAssistant` writes a message back |
| Three-state switch | Off by default; "This session only" / "All sessions"; composer UI control or `/iui` commands |
| Bilingual UI | Follows DSH's UI language; dictionaries live in `src/shared/locales.ts` |
| Agent Skill | Registers `intelligent-ui` with the plugin so the model can load syntax, examples and troubleshooting on demand |
| Replayable | The generated program enters the session log as a tool argument and replays with history |

## Getting the code

Clone the repository from GitHub:

```bash
git clone https://github.com/Zephinel/dsh-intelligent-ui.git
cd dsh-intelligent-ui
```

You can also install it from npm without a checkout (next section).

## Prerequisites

- **DSH 0.2.1** (the `dsh` CLI): the Host/Client halves and plugin protocol are developed against this version; the verified version is `0.2.1-rc.2`, and later versions are unverified.
- **Node.js 24**: build, tests and `npm pack` are verified on Node 24; the repository has no `engines` or `.nvmrc` pin, so verify a lower version yourself before using one.
- **`@deepseek-ai/dsh-client-locale`**: the browser half requires a deployment that composes it; DSH Web 0.2.1 includes it by default, and without it the switch and card do not mount (the Host tool and prompt keep working).

Confirm the tools are present:

```bash
node --version   # v24.x
dsh --version    # 0.2.1 or 0.2.1-rc.2
```

The restart examples cover a foreground `dsh web`, macOS launchd and Linux systemd; for other supervisors restart the corresponding service. The verified environment is macOS; Windows is unverified.

## Quick start

Install from npm (prerequisites are in the previous section):

```bash
dsh plugin --profile web add @zephinel/dsh-intelligent-ui

# pin the current version
dsh plugin --profile web add @zephinel/dsh-intelligent-ui@0.1.0-26-10-21

# or install from GitHub
dsh plugin --profile web add github:Zephinel/dsh-intelligent-ui
```

Restart the DSH process that serves the Web UI (foreground `dsh web`: Ctrl+C, then run it again; launchd/systemd: restart the service; DSH Desktop: quit and reopen), open the URL it prints, and look for the **UI** control on the right side of the composer.

For local development, install from a checkout:

```bash
cd /path/to/dsh-intelligent-ui
npm install && npm run build
node scripts/install.mjs  # writes $DSH_HOME/profiles/web/cordis.patch.yml (automatic backup)
```

> [!IMPORTANT]
> After renaming the package or rebuilding `lib/client.js`, a page refresh may keep the old revision; restart the DSH process that serves the Web UI, then reopen the page.

Then click the **UI** control, choose "This session only" or "All sessions" (or `/iui session` / `/iui global`), and ask, for example:

```text
Plan two days in Shanghai, with checkboxes and adjustments
```

See [Development and deployment](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.en.md) for uninstall, development and troubleshooting.

## Three-state switch

![The UI control on the right side of the composer: clicking it opens an "Off / This session only / All sessions" menu (screenshot from the English UI)](assets/intelligent-ui-toggle.png)

- **Off** (default): no `render_ui` schema in any session's request, and the ~8.5K-token generation prompt expands to nothing.
- **This session only** / **All sessions**: scopes the current session or every session (including ones opened later); the **UI** control is equivalent to `/iui off|session|global`.
- State is written atomically to `<DSH_HOME>/dsh-intelligent-ui.json` and survives a refresh or DSH restart; see [Architecture and behavior](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.en.md) for the full semantics (projection, cross-tab sync, service requirements).

## Usage

With the switch on, just ask in natural language, for example:

- "Plan two days in Shanghai, with checkboxes and adjustments"
- "Build a gear-shifting simulator for a 7-speed bicycle"
- "Turn these tables into a sales dashboard I can filter"
- "Teach me how to tie a tie, with an image for every step"

When the switch is off the model cannot see `render_ui` and answers in plain text — that is not a failure; turn the switch on and ask again. If the model replies with text only, just say "show it with render_ui". To explicitly bring in the full skill, say "read the intelligent-ui skill and then build ... with render_ui".

## Build, test and deploy

```bash
npm run build       # build the prompt, Host and Client bundle
npm run check       # build + Host/Client/packaging tests + renderer checks
npm run pack:check  # inspect the final npm pack file list
```

The published artifact is a DSH bundle; deploying means installing the plugin into the target DSH profile. See [Development and deployment](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.en.md) for uninstall, local development and version notes.

## Contributing

- Questions and feature requests: use [GitHub Issues](https://github.com/Zephinel/dsh-intelligent-ui/issues).
- Run `npm run check` before submitting; the repository has no CI, so the local command is the source of truth.
- When behavior, copy or counts change, update the Chinese and English READMEs, `CHANGELOG.md`, and the matching documents under `docs/`; the sync rules live in `.agents/skills/sync-iui-docs/SKILL.md` (development-only, not shipped in the npm package).

## Known limitations

- The card appears **at the end** of the turn; during generation the process area shows one "Interactive answer" line (交互式回答 in a Chinese UI).
- The model occasionally generates invalid OpenUI Lang; Host validation returns precise errors, and it usually repairs them within the same turn (1–2 attempts in testing).
- The map basemap relies on OpenFreeMap tiles, routes on the OSRM demo, and photos on Wikipedia/Wikimedia; when offline, maps degrade to a list of places and photos to placeholder blocks.
- KaTeX uses global styles already loaded by the DSH shell; if those styles are removed, the Math component degrades to plain text.
- The generation prompt is about 8.5K tokens and is **sent only when the switch covers that session** (all sessions, or the session is on the allowlist); when off, that cost is zero (the tool schema is absent too). Enabled requests are the same as the previous version, so DSH cache hits offset most of the cost.
- The extension's UI copy follows DSH's UI language; the `/iui` Host replies, the command palette's command description and the README screenshots stay in English (the first two are DSH platform behavior).
- The browser half requires a deployment that composes `dsh-client-locale` (included by default in DSH Web 0.2.1); a minimal custom profile without it will not mount the switch or the card, while the Host tool and prompt keep working.

## Documentation

- [Architecture and behavior](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.en.md): Host/Client component tree, the full three-state switch semantics, UI language and the Agent Skill.
- [Development and deployment](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.en.md): install and uninstall, development commands, the restart tip after renaming/rebuilding, Host/Client version mismatch and the release layout.
- [Verification record](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/verification.en.md): end-to-end verification, test and packaging results (historical).
- [Changelog](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/CHANGELOG.md): additions, changes and fixes per release.

## License

This project is [MIT](LICENSE). It is based on Open Intelligent UI (MIT, Copyright (c) 2026 Thesys Inc.) and the OpenUI ecosystem; the browser bundle contains lucide-react (ISC), KaTeX (MIT), MapLibre GL JS (BSD-3-Clause) and zod (MIT). Full notices and license texts are in `NOTICE` and `licenses/`.
