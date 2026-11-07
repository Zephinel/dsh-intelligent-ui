<img src="icon.svg" alt="dsh-intelligent-ui" width="72" height="72" align="right">

# dsh-intelligent-ui

[中文](README.md) | English

[![npm version](https://img.shields.io/npm/v/@zephinel/dsh-intelligent-ui?label=npm)](https://www.npmjs.com/package/@zephinel/dsh-intelligent-ui)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.1-4f46e5)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![publish](https://github.com/Zephinel/dsh-intelligent-ui/actions/workflows/publish.yml/badge.svg)](https://github.com/Zephinel/dsh-intelligent-ui/actions/workflows/publish.yml)

**Turn a DeepSeek Harness (DSH) model answer into a page you can actually use.** After installing and enabling the plugin, ask:

```text
Plan two days in Shanghai, with checkboxes and adjustments
```

The model calls the `render_ui` tool and writes its answer as an [OpenUI Lang 1.0](https://openui.com) program; at the end of the turn, DSH renders it into an interactive page — maps, photos, charts, checklists, forms, SVG drawings and mini-games are all real components, not screenshots.

Ported from [Open Intelligent UI](https://github.com/thesysdev/open-intelligent-ui) (MIT), with an Agent Skill (`intelligent-ui`) that the plugin registers automatically.

> [!NOTE]
> **Current status**: published on GitHub and npm as **`@zephinel/dsh-intelligent-ui@0.5.0`** (`latest`). Custom styles, on-demand generation, free layouts and template file import/export, plus the renderer-contract, Host-validation and export-semantics fixes, are all included in 0.5.0.

[Quick start](#quick-start) · [Getting the code](#getting-the-code) · [Build, test and deploy](#build-test-and-deploy)

## What it looks like

![Two days in Shanghai: photos, map, timeline, checklist, budget and interactive controls all rendered by OpenUI Lang](assets/intelligent-ui-itinerary.webp)

- When the user asks "plan two days in Shanghai", the model no longer replies with just a paragraph: it renders an itinerary page (map + photos + timeline + checklist + budget) at the end of the answer that can be clicked, checked off and dragged.
- The `$variables`, `@Set` and `@functions` inside the card all execute locally in the browser: checkboxes, sliders, steppers, timers and budget allocation never require another model request.
- A rendered page stays editable: click **Edit** in the card header (each top-level editable block has a washed-out pastel comet orbiting its invisible edge about once every 2.6 s, staggered per block and cycling through blue, purple, green, amber, pink and cyan, brightening on hover; the selected block reads as a floating frame and shadow instead of a blue outline (the edit canvas keeps the page's exact layout; all selection chrome is painted by a geometry overlay); panel rows and canvas blocks hover-sync both ways, each row carries a **More** menu (locate/edit/duplicate/move/delete), root blocks always show their page-order index (nested only on hover) and opening a block editor dims the rest of the canvas; selecting a `Divider`/`Spacer` opens quick-adjust fields (colour/width/thickness, or width/height) with a live canvas preview; colour and unit pickers plus the width/thickness/height sliders are plugin-drawn, not native controls, applied through a deterministic Host property route without a model turn — dynamic or out-of-domain props fall back to an instruction with an explanation, and an unchanged bag cannot be applied; saving an instruction replaces the big selected frame with a quiet pending marker (dot + request number)), write change requests for blocks, or drag or keyboard-reorder the top-level blocks in **Block arrangement** (the canvas previews the target order live); a normal send makes the model return only the selected blocks' rewritten fragments, which the Host splices back into the byte-identical page and records as a new revision in the requested order. One chat can keep several card edit drafts at once (one chip each; a draft strip inside the composer card switches/attaches/discards them, one active canvas); one send can submit up to 3 artifacts' edit requests and each artifact gets its own independent revision. Older revisions stay usable too: a historical revision card can be **Restored as a new revision** (zero model calls, producing a local revision card), and an outdated revision's edit conflict banner can **Create a new revision from this one** as a branch. Temporary-style results also accept block content edits (the result-owned style snapshot travels with the request); reordering or a global instruction still needs a page with a saved or built-in style. Blocks inside containers are editable too: switch the edit canvas to **Nested blocks** and select a child of a `Col`/`Row`/`Box`/`Grid`/`Card`/`Section`/`Carousel` (M4-1 content replacement), and reorder children inside one container in the **Nested block order** list (M4-2); arrangement rows also offer duplicate/delete (M4-3) and **Move to…** another container (M4-4 cross-container move; the Host applies the deterministic operation with no model turn and records a revision), and nested groups offer **Add block** so the model can generate new content (M4-4 additions; the send produces one model-generated block and a new revision). Structure operations first show a **change preview** (add/remove/same rows plus the affected top-level block count) and only record a revision after confirmation (M4-5/B2-5 structural diff preview). Entering edit mode dynamically narrows the chat content based on the **conversation column after the sidebar** (24px gap between the content right edge and the panel left edge), refits immediately when the shell chat-width handle is dragged during editing, and restores the previous width on exit; the editor no longer offers an expand/collapse button. Each artifact has its own **revision history**: the card-header history icon, the `Revision N` badge or the edit-panel header button opens that artifact history dialog (metadata plus changed-block chips, no full-page preview); old revisions can be restored as a new revision with zero model calls, including the initial revision (style borrowed from the latest record). The edit toolbar also has an optional **Strict protection** switch: when on, the Host rejects any change to an unselected top-level block, keeps the request pending on rejection, and the same request can be retried (B2-5). Every icon the plugin draws itself comes from Remix Icon (inlined paths, no runtime dependency, inherits `currentColor`); `Icon("…")` inside generated OpenUI programs still resolves through lucide because those names are program data. The edit panel header also offers **Exit editing**; the panel itself is a rounded floating card with a ~320ms enter/exit animation (disabled under `prefers-reduced-motion`); structural delete uses a persistent two-state **Cancel / Delete** confirmation (no auto-dismiss timer — it stays until Cancel, an outside click or Escape); the block-instruction popover stays fully inside the viewport even when its anchor scrolls away, and its focused textarea shows the orbit focus cue (a static ring under reduced motion) instead of a focus border. A new revision card produced by an edit **partially preserves runtime state**: renderer-owned `$state` and form field initial values are inherited from the base revision that was edited (B2-6); third-party component internals and values interacted with inside the edit canvas are not preserved. Article and free layouts have both been validated on the real GUI (B2-8): an Article card can be edited and still produces an article Revision 2; a free layout must be generated through On-demand UI (`style=free` + `temporaryStyle` — a plain `render_ui` with free is rejected by the Host), and editing it keeps Revision 2 temporary/free. At 390×844 there is no horizontal overflow and **Edit** only shows the narrow-width notice instead of entering the editor; at 900×1000 the editor opens normally (B2-9). `test/browser/visual-baselines/` stores 5 manual visual baselines (article/free cards, article editor, structure-preview modal, 390 narrow viewport) for human comparison only — **there is no automated pixel diff** (B2-10). The edit canvas supports screen readers and keyboard-only use (B1-5): reorder/add/remove/move/preview open-cancel actions are announced through a polite live region, drag grips and the **Move to…** menu carry `aria-describedby` hints, the move menu supports arrow keys/Home/End/Enter/Escape with focus return, the add form and nested groups have accessible names, and focus-visible rings were added.
- Only actions that genuinely need to continue the conversation (`@ToAssistant`, such as a form submission) put a short message back into the composer and send it.

## Component tour

The renderer is not a chat bubble around a paragraph — it is a full component library: **57 components, 73 functions, 5 action steps**. The three cards below are real renders from the extension: same renderer, same DSH theme tokens, no mockups:

![Everything you can render: 57 components, 73 functions and 5 actions, plus the layout (11) and text (12) component groups](assets/intelligent-ui-components-layout.webp)

![Inputs, media and data: 13 input components plus photos, tables, charts, maps and YouTube](assets/intelligent-ui-components-inputs.webp)

![Play and drawing: flip cards, the confetti trigger, ten SVG drawing components and a sandboxed iframe game](assets/intelligent-ui-components-drawing.webp)

## More examples

![Sales dashboard: KPIs, line chart, donut and detail table all recompute when the region filter changes](assets/intelligent-ui-example-dashboard.webp)

![Coffee brewing quiz: flip cards, per-answer feedback, score bar and a sandboxed mini-game](assets/intelligent-ui-example-quiz.webp)

On a narrow screen (about 380 px) the card switches to a single column, and maps and charts fit the card width; over-long chart category labels are trimmed instead of overflowing:

![The pour-over coffee calculator on a narrow screen: single-column layout, no horizontal overflow](assets/intelligent-ui-responsive.webp)

## Capabilities

| Capability | What it gives you |
|---|---|
| Interactive pages | Maps, photos, charts, checklists, forms, SVG drawings and mini-games are real components, not screenshots |
| Block editing and arrangement | Write change requests for blocks on a rendered page and drag or keyboard-reorder the top-level blocks (the canvas previews the target order); content edits, order-only or combined updates all work, the model returns block fragments and the Host merges them into a page whose unselected blocks stay byte-identical, producing a new revision. One chat can keep several drafts in parallel (one active canvas, one chip per artifact); one send can submit up to 3 artifacts' requests and each revision is independent; a historical revision can be restored as a local revision card without a model call, or branched from when it is outdated; nested blocks inside `Col`/`Row`/`Box`/`Grid`/`Card`/`Section`/`Carousel` accept content edits, same-parent reordering, model-added blocks and zero-model duplicate/delete/cross-container-move structure operations behind an opt-in toggle while the root order stays unchanged |
| Image export | Saves the rendered result as one PNG with a raw, rounded or card frame; background color and 1x/2x live on the Plugin detail page |
| Interactive-page export | Saves every card from the turn as a single-file HTML page; open it in a browser to keep interacting, and `@ToAssistant` copies its message plus a paste-back-into-DSH hint |
| Local execution | `$variables`, `@Set` and `@functions` run in the browser; only `@ToAssistant` writes a message back |
| Switch and style | Global defaults on the Plugin detail page; composer overrides per session; built-in Auto / Card / Article and custom templates |
| Custom templates and visual themes | Reusable display preferences with light/dark palettes, font, radius, density and shadow; use, rename, edit or delete in My styles |
| Chat-native on-demand UI | No template required; choose On-demand UI in the UI panel, send a normal message, clarify with the built-in question tool when needed |
| Free on-demand layouts | Compose the page from the user's request; saved templates keep the free layout, preferences and theme without a Card/Article shell |
| Temporary results and optional saving | Inline style snapshots are ready to use, adjust or save later; no required preview, naming or saving |
| Bilingual UI | Follows DSH's Chinese or English UI language |
| Agent Skill | Registers `intelligent-ui` with the plugin so the model can load syntax, examples and troubleshooting on demand |
| Plugin detail page | Manage global enablement, default style, templates, composition and export preferences in one place |
| Replayable | Programs and temporary styles replay from recorded tool arguments; exported pages freeze the scheme at export time |

## Getting the code

Clone the repository from GitHub:

```bash
git clone https://github.com/Zephinel/dsh-intelligent-ui.git
cd dsh-intelligent-ui
```

To contribute, fork this repository and clone your fork. To use the plugin, install from npm without a checkout (see [Quick start](#quick-start)).

## Prerequisites

These commands are for DSH Web and source development; DSH Desktop users can follow the in-app steps in [Quick start](#quick-start).

- **DSH 0.2.1 plugin API** (the [`dsh` CLI](https://www.npmjs.com/package/@deepseek-ai/dsh)): the Host/Client halves and plugin protocol are developed against this version; the verified version is `0.2.1-rc.2`, and later versions are unverified. Pin the install to the verified version: `npm install -g @deepseek-ai/dsh@0.2.1-rc.2`.
- **[Node.js 24 and its bundled npm](https://nodejs.org/en/download)**: builds, tests and the publish workflow use Node 24. The repository has no `engines` or `.nvmrc` pin, so select Node 24 before running `npm install`; the Host's Node 22 build target does not verify the whole toolchain on Node 22.
- **[Git](https://git-scm.com/downloads)**: needed only to get the source; the repository sets no minimum version.
- **`@deepseek-ai/dsh-client-locale`**: the browser half requires a deployment that composes it; DSH Web 0.2.1 includes it by default, and without it the switch and card do not mount (the Host tool and prompt keep working).

Confirm the tools are present:

```bash
node --version   # v24.x
npm --version
dsh --version    # verified: 0.2.1-rc.2
git --version    # only needed to get the source
```

The restart examples cover a foreground `dsh web`, macOS launchd and Linux systemd; for other supervisors restart the corresponding service. Verified platforms: macOS (Web + DSH Desktop) and Windows (DSH Desktop); Linux is unverified.

## Quick start

**DSH Web**: install the published 0.5.0 package and start the Web UI (first foreground run):

```bash
dsh plugin --profile web add @zephinel/dsh-intelligent-ui@0.5.0
dsh web
```

If Web is already running, restart that process after installing (foreground: Ctrl+C, then run `dsh web` again; launchd/systemd: restart the service). Open the printed URL and look for the **UI** control on the right of the composer; the DSH profile determines the address and port.

Alternative sources replace the install command above: use `dsh plugin --profile web add @zephinel/dsh-intelligent-ui` to follow npm's latest version, or `dsh plugin --profile web add github:Zephinel/dsh-intelligent-ui` for committed GitHub code. Neither installs uncommitted changes from your checkout.

**DSH Desktop** needs no terminal command — install it inside the app:

1. Open **Plugins** in the sidebar → **Add plugin** (or the arrow → **Install a third-party plugin**).
2. Enter `@zephinel/dsh-intelligent-ui@0.5.0` (or just the package name for the latest), then click **Install**.
3. When the install finishes, click **Enable now**; if the **UI** control does not appear, quit and reopen DSH Desktop.

The desktop profile is owned by the Electron app, so `dsh plugin --profile desktop` is rejected. A mainland-China mirror can lag behind the official npm registry for a fresh release; switch the install source back to npm if the version is not found.

After installing, click **UI**, choose **This session only** (or send `/iui on`), then send the itinerary example at the top. An interactive itinerary at the end of the turn confirms it works. Set the session Auto / Card / Article style in the same panel if needed.

See [Development and deployment](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.en.md) for the local-checkout development loop, uninstall and troubleshooting; the extension has no development server of its own.

## Switch and answer style

![The composer UI control: Off / This session only / All sessions, plus Display style below an inset divider](assets/intelligent-ui-toggle.png)

![Style panel: built-in Auto / Card / Article cards, Custom styles and On-demand UI at the bottom](assets/intelligent-ui-style-panel.webp)

- **Global defaults:** the Plugin detail page sets **Enable in all sessions** and **Answer style** for new sessions; choose a built-in style or a saved global template.
- **Session overrides:** Composer **UI** chip → **This session only** or **Display style** opens the panel: built-in Auto / Card / Article preview cards, **Custom styles** (saved templates), then **On-demand UI** at the bottom. **All sessions** follows the global switch for this session without turning it on globally. Commands are `/iui on|off|inherit` and `/iui style auto|card|article|inherit|<cs_id>`.
- **Auto** chooses compact Card for interactive/structured answers and Article for detailed/long-form ones. Article needs a `Toc`, collapsible `Section`s and substantive prose.
- **On-demand UI:** choosing it closes the panel, focuses the composer and shows a cancellable hint with examples. Examples fill without sending and preserve the existing draft. Send normally: clear requests render directly; material ambiguity uses the built-in `ask_user_question`, then generation continues after the answer.
- Session enable/style settings are written atomically to `<DSH_HOME>/dsh-intelligent-ui.json`. An on-demand operation changes neither setting; a temporary style is not the selected style. See [Architecture and behavior](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.en.md) for the boundaries.

![Armed on-demand hint: examples fill the composer without sending](assets/intelligent-ui-on-demand-hint.webp)

## Usage

With the switch on, just ask in natural language, for example:

- "Plan two days in Shanghai, with checkboxes and adjustments"
- "Build a gear-shifting simulator for a 7-speed bicycle"
- "Turn these tables into a sales dashboard I can filter"
- "Introduce Chinese history, expandable by dynasty"
- Choose On-demand UI, then send "Make this analysis a compact dashboard; highlight key metrics with cards and charts"
- Choose Adjust style on the result, then send "Keep the content and use a more spacious reading layout"
- Click **Edit** in the header of a rendered page, write a change request for a block, and drag or keyboard-reorder the blocks in **Block arrangement** (the canvas previews the target order live), then send normally
- Click **Restore as new revision** on an older revision card (no model call), or **Create a new revision from this one** in an outdated revision's edit conflict banner

The edit request stays in the composer as one chip per edited artifact, labelled **Edit {title} · Revision N · {summary}** (summaries such as **2 changes**, **Reorder blocks**, **Global instruction**); a branch edit appends ** · branch**. One send merges up to 3 artifacts' requests; deleting a chip only removes that draft from the current send (the draft is kept and can be re-attached in the **Pending edits** switcher); clicking a chip reopens that draft's canvas.

Once enabled, **any answer with structure defaults to a card** — including explanations, introductions, timelines, stages, comparisons and things to explore; Markdown is reserved for a single fact, a one- or two-sentence reply, an explicit request for text/document/code, or repeated render failures. When the switch is off the model cannot see `render_ui` and answers in plain text — that is not a failure; turn the switch on and ask again.

To guarantee a card (or when the model still replies in text), invoke the skill explicitly with `/intelligent-ui` in a session where the switch is on; explicit invocation is treated as a direct instruction. You can also say "read the intelligent-ui skill and then build ... with render_ui".

![Temporary result: badge, Adjust style and Save as template](assets/intelligent-ui-temporary-result.webp)

![The same temporary result under the fixed dark theme](assets/intelligent-ui-temporary-result-dark.webp)

A temporary result is ready to use. **Adjust style** binds that result and fills an adjustment prompt while preserving your draft; send it normally. **Save as template** optionally asks for a name, description and availability (this session or global); saving preserves the result’s layout (free/card/article), preferences and explicit light/dark theme without a layout choice. A result without an explicit theme inherits the session theme and is not offered Save as template, because there is no palette to copy. Free templates have a local preview and **Free layout** hint; selecting one keeps the DSH card header without a Card/Article shell, with optional Toc/Section. Saving reuses the validated result style, makes no new model request, and neither selects the template nor changes the global default. No preview, naming or saving is required before use.

**Since 0.5.0**: the Host requires free layout for new on-demand generation; adjustments preserve the parent layout (free, legacy card or article). If the parent snapshot is absent from the latest-200 result registry, adjustment returns an error; cancel it and choose **On-demand UI** again. Historical results can still replay from tool arguments.

![Plugin detail page: global enable, default style, My styles management, composition and export](assets/intelligent-ui-settings.webp)

The Plugin detail page groups settings into **Availability**, **Answer style**, **My styles**, **Composition** and **Export**. My styles manages saved global templates: set as default, rename, edit description/display preferences, export file, import template or delete. The composer manages global and session templates visible in that session. Generation happens in the composer; settings explain the entry without providing a generation workbench. Global values are the defaults for new sessions; a session override in the composer wins. **Free-form layout** only changes how strongly the design guidance is advisory; it is orthogonal to the answer style. **Export** stores the default background color, the 1x/2x resolution, and whether images/pages remove the `@ToAssistant` follow-up control together with its form fields (a Card with prose keeps its prose; only a pure follow-up block disappears whole; on by default).

**Template file sharing**: in My styles, or in the composer’s **Display style** panel, choose a template’s `…` → **Export file**, review the sensitive-information notice, then **Download** to get `<template-name>.iui-style.json`. The composer panel also covers session-scoped templates, so they need no separate global copy first. The file contains the name, description, base layout, full display preferences and theme. Check all of it for personal or internal information before sharing. The recipient chooses **Import template** in My styles or the composer’s **Display style** panel, selects a file or pastes JSON → **Preview**, then checks the name, description, layout, light/dark swatches and full preferences. Rename, edit or clear the preferences as needed. Importing always requires **I have read and understood the risks above; import this external template** before **Import template**. Import creates a new global template (the composer entry also writes global templates only; importing into the current session remains deferred until session authorization is checked), never applies it or changes the current selection/global default; afterwards use, edit, delete and export it normally.

Template exchange format v1 contains only portable style configuration, supports `card|article|free`, and excludes local IDs, scope, sessions and timestamps. Plugin versions supporting v1 can import it; unknown versions are rejected without downgrade guessing. Only this exchange format is accepted: raw template exports and library backups are rejected (no external users yet, so no legacy-format support is maintained). Exchange versions are independent of npm package versions. Future v2 implementations should retain v1 support; adding layouts or removing `baseLayout` requires explicit format evolution rather than silently accepting unknown layouts in v1.

Exchange is limited to one template and **32 KiB of UTF-8 input**. Files are size-checked before reading, regardless of extension or MIME. One Markdown code fence around the entire input is tolerated; JSON is never extracted from arbitrary prose. Unknown fields and library backups are rejected. The global limit is 40 templates; duplicate names get an `(Imported)` suggestion, remaining collisions require a rename, and a full library requires deleting unneeded templates. Share codes, online links, batch backups and session imports are unavailable; the composer import also writes global templates only.

**Security boundary**: an external template's name and display preferences enter the prompt and may affect model behavior; the description is stored/exported only and never enters the prompt. All three are treated as untrusted text. Preview, acknowledgement and no automatic application mitigate risk without eliminating prompt injection; DSH’s tool/permission layer controls execution authority. The current implementation follows the owner-approved approach (2026-10-24): a disclaimer plus acknowledgement before retaining external content. Real-deployment Origin/CSRF and tool-privilege auditing remain recommended pre-release hardening.

Once an answer has rendered, a labeled **export pill** appears at the **far right** of the message action strip (visually distinct from the native copy / like / branch icons); only answers rendered by the extension have it. It can save every card from that turn as one PNG — **Raw** (the answer alone), **Rounded** (background color and rounded padding) or **Card** (padding, rounded corners and a soft shadow) — or export them as a single-file HTML page, which opens in a browser with the interactions intact; in that page `@ToAssistant` copies the message and shows the paste-back-into-DSH hint instead of calling DSH. The image contains the rendered cards only, not the Markdown text around them and not the export control itself. See [Architecture and behavior](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.en.md) for the full flow.

## Build, test and deploy

Start at the checkout root from [Getting the code](#getting-the-code). `npm install` builds automatically through `prepare`; the local installer defaults to the `web` profile and backs up its patch. If that profile already has the npm/GitHub version, remove it first with `dsh plugin --profile web remove @zephinel/dsh-intelligent-ui` to avoid registering the plugin twice.

```bash
npm install
dsh plugin --profile web list  # check the profile; initializes it on first use
node scripts/install.mjs
dsh web
```

If Web is already running, restart it after installing and open the printed URL. Once **UI** appears on the right of the composer, enable it and try a request as in [Quick start](#quick-start). There is no separate development server or watch mode; run `npm run build` and restart DSH after each change. See [Development and deployment](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.en.md) for uninstall and troubleshooting.

Everyday checks and packaging:

| Command | Purpose |
|---|---|
| `npm run build` | Generate the prompt, Host, Client and standalone export-page bundles |
| `npm test` | Run Host, Client and packaging Node tests after a build |
| `npm run typecheck` | Run `tsc --noEmit` (the browser `src/client` half is currently excluded: its DSH platform types are runtime-provided) |
| `npm run check` | Full pre-submit check: typecheck, build, Node tests and renderer checks |
| `npm run pack:check` | Preview the final npm package file list without publishing |
| `npm run test:browser` | Run 9 browser suites after a build; Chrome required. `test/browser/visual-baselines/` holds manual visual baselines (5 PNGs + `captures.json` + `SHA256SUMS`) with no automated pixel comparison |

- Current main-branch verification record: **510/510** Node tests (Host 241, Client 248, packaging 21; block editing/arrangement/multi-card/branch/restore/draft-persistence/temporary-style/nested-edit/hierarchical-order/structure-operation/container-expansion/model-additions/cross-container-move/structure-preview/strict-protection/runtime-state/panel-animation-and-width-fit feature test files total 239); renderer parse/render **42/42** each, CSS/prop contract **50/50** and **63/63**, typography **22/22**, i18n **4** programs, nested CSS-compensation contract **28/28 direct + 5/5 scoped**; **9/9** browser suites passed, including **101** settings template-exchange, **114** on-demand, **46** interactive-page and **65** image-export assertions, plus **339** checks in the Artifact block-editing suite and **75** checks in the nested edit-renderer suite. Browser tests cover components/contracts; real-model validation scope and remaining scenarios are in the [verification record](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/verification.en.md) (historical evidence).
- `node scripts/capture-screenshots.mjs` rebuilds panel, hint, temporary-result and settings captures at 2x in Chrome using fixed DSH tokens, production components and fake services. English UI; shell card glyphs use lucide stand-ins.
- The typography check inside `npm run check` needs a local Chrome; without one that check is skipped and the remaining tests still run. Use `CHROME_BIN` for a non-default Chrome executable location (also used by the browser suites).

The published artifact is a DSH bundle; deploying means installing the plugin into the target DSH profile. See [Development and deployment](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.en.md) for uninstall and version notes.

## Contributing

- Questions and feature requests: use [GitHub Issues](https://github.com/Zephinel/dsh-intelligent-ui/issues).
- Run `npm run check` before opening a PR; there is no PR CI, so the local command is the gate. Releases use the [GitHub Actions Trusted Publishing workflow](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/.github/workflows/publish.yml); the development guide describes the process.
- Contributors and AI coding agents should follow the [doc-sync skill](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/.agents/skills/sync-iui-docs/SKILL.md): when behavior, copy or counts change, update both READMEs, `CHANGELOG.md` and the matching documents under `docs/`. In a checkout, use the local `.agents/skills/sync-iui-docs/SKILL.md`.
- Maintainer: [@Zephinel](https://github.com/Zephinel).

## Known limitations

- The card appears **at the end** of the turn; during generation the process area shows one "Interactive answer" line (交互式回答 in a Chinese UI).
- The model occasionally generates invalid OpenUI Lang; Host validation returns precise errors, and it usually repairs them within the same turn (1–2 attempts in testing).
- The map basemap relies on OpenFreeMap tiles, routes on the OSRM demo, and photos on Wikipedia/Wikimedia; when offline, maps degrade to a list of places and photos to placeholder blocks.
- KaTeX uses global styles already loaded by the DSH shell; if those styles are removed, the Math component degrades to plain text.
- The generation prompt is about 10K tokens and is **sent only when the switch covers that session** (global on, or the session explicitly on); when off, that cost is zero (the tool schema is absent too). Article mode produces longer pages, so output tokens and render time increase accordingly.
- The extension's UI copy follows DSH's UI language; the `/iui` Host replies, the command palette's command description and the README screenshots stay in English (the first two are DSH platform behavior).
- Image export does not capture sandboxed iframes (`HtmlView` mini-games), so that region is missing from the image; maps are captured through the preserved WebGL drawing buffer, and a browser without WebGL falls back to the map's own place-list presentation.
- Every card rendered by one turn is combined into one image; the image captures **what is currently rendered**, so it includes the interaction state at export time (checked items, active filters and so on). The export waits for in-card photos and image searches to settle (at most about 12.5 seconds); offline or still-pending photos are recorded from the placeholder state shown on the page.
- The interactive-page export inlines the renderer, the current theme and every card into one HTML file (about 3.4–4.9 MB), so it is large but install-free; maps, photos and other components still need the network. `@ToAssistant` in that page tries the clipboard and shows a toast; when the clipboard is unavailable the toast keeps the message for manual copying.
- The browser half requires a deployment that composes `dsh-client-locale` (included by default in DSH Web 0.2.1); a minimal custom profile without it will not mount the switch or the card, while the Host tool and prompt keep working.
- The configuration on the Plugin detail page requires the DSH settings services: a minimal custom profile without `dsh-settings` / `dsh-client-ui-settings` does not show it, and a Host/Client version mismatch can leave the switch unavailable. Global enable/style and free-form layout only change the prompt and page shape; no model is guaranteed to follow them perfectly, and session style overrides still rely on the Host-injected prompt.
- The interactive-page export needs the `webServer` service (included by default in DSH Web 0.2.1); a minimal custom profile without it cannot build the exported page, while image export is unaffected.

- Temporary styles live in recorded tool arguments/result snapshots, outside the catalog. Replay needs the call arguments in the loaded history window. Saving later depends on the bounded result registry (latest 200 records); an evicted result may still replay but cannot be saved. Saved templates and result snapshots persist in separate JSON files under `<DSH_HOME>`.
- Style creation/on-demand generation uses the deployment's default main-conversation model services; the extension supplies no separate generation model or draft interview service. `ask_user_question` is the structured clarification path; if unavailable, text questions are a degraded fallback — the hint stays and the next message continues the same operation without re-selecting On-demand UI (except after expiry, restart or failure).
- Operations are in memory: armed intent expires after 10 minutes; active operations cannot resume after restart and must be re-armed. Completed results survive. There is one active operation per session: re-arming replaces it while armed, while a bound running/clarifying operation rejects re-arming until explicitly cancelled. Clarification is limited to two rounds. A text-only completion without rendering returns to the pending/resume state and the next message continues; failed/interrupted turns show Retry/Dismiss guidance.
- Multi-tab binding is conservative: only the arming tab shows the hint, but the Host binds the next human message in the session without verifying its sending tab. Send from the arming tab and avoid concurrent messages in another tab.
- Custom themes apply to the renderer host; portaled popovers and sandboxed iframes keep the default theme, and semantic status colors remain renderer-owned. Exported pages freeze the light/dark scheme at export time.
- Block editing and arrangement cover **every direct child of the root `Col`**, including `Caption`, `Divider`, `Spacer`, `Toc` and a root `Title` (M4-6); `Divider`/`Spacer` also offer zero-model **quick adjust** (colour/width/thickness, or width/height) with a live canvas preview, applied through a deterministic Host property route that records a revision directly. Blocks can be reordered, duplicated, deleted and moved inside or across containers; the only non-editable nodes left are the safety exclusions (`@Each` templates, opaque expressions, shared named expressions, depth/node limits (the CST budget is 200 nodes, enough for long article pages), and duplication of subtrees containing `Section`/`Toc` anchors); the target order must contain every top-level block of the base revision exactly once (up to 100), and the Host maps the model's returned blocks back to that order by statement name/title and reports the normalized program. Content edits use `edit_ui_blocks`: the model returns only the selected blocks' fragments (`root = Col([...])`, optional new helper statements) and the Host splices them back; Phase 1 still sends the full page as read-only context, with input-token savings deferred to Phase 2. Temporary-style results support block **content** edits only: the edit request carries the result-owned style snapshot, the Host reuses it and no `styleId` is sent; order-only/global-only requests are blocked in the client (with a needs-a-saved-style hint) and rejected by the Host's `render_ui` fallback; a temporary card without a valid snapshot is not editable. One revision is edited at a time: a stale base or a newer existing revision is rejected with a reload prompt. A block instruction is limited to 2,000 characters, the global instruction to 4,000, and one request to 12 content edits; a send needs at least one content edit, an order change or a global instruction, and a request that changes nothing is rejected. An unselected block that changed produces a preservation warning. Block editing is unavailable below 720px: the card and an active edit view show a minimum-width notice (with a dismiss/exit action) instead, and widening the window restores it.
- Edit robustness: the composer's edit-request chip has a deterministic reference that still resolves after a reload; when the edit session is gone, Send reports that the session is stale and asks to reopen editing (or delete the chip). While editing, a background revision check runs every 15 seconds and on window focus/visibility, surfacing a concurrent update as the conflict banner before sending. The canvas **Previewing the target order** is edit-mode only — the recorded revision and exports stay unchanged until Send; a failed tool row shows a one-line reason (full text in its hover title) and never exposes program arguments. When one send touches several artifacts, the client reconciles by request id once the Turn closes: drafts whose revision landed disappear, while unfinished ones come back as a **Not completed; draft kept** badge and can be re-attached for the next send — they are never resent automatically. The Host keeps unfinished pending requests until their 15-minute TTL expires (they are not cleaned at Turn close), and Turn ownership uses a send-time window heuristic. The real-model "partial success" path has not been validated on the real GUI (single- and two-card success paths were). Edit drafts are cached per browser tab in `sessionStorage`: after a reload the composer chip and the card draft badge are restored (same tab only; not shared across tabs, and the branch marker/oversized programs are not restored). When the same revision is opened in another tab, the editor shows a soft-lease banner (**Another tab is editing this revision** / **Take over editing**): takeover only moves the notice — changes are never merged, and with no BroadcastChannel support the banner is silently absent; the Host revision check remains the final authority.
- Multi-card parallel editing (M3-1, v1): one chat keeps up to 6 edit drafts with content, and only one card shows the edit canvas at a time; one send attaches up to 3 drafts (the rest stay detached and can be attached in the **Pending edits** switcher), and one user message carries at most 3 requests. Each request executes and records its revision independently — the Host has no cross-artifact transaction, so one failure does not roll back other successful revisions. When the Turn closes the client reconciles by request id: fulfilled drafts disappear, unfinished ones return as editable **Not completed; draft kept** drafts (`submitFailed`, detached, fresh requestId; up to 12 unresolved submitted drafts are retained per chat, oldest dropped) and need an explicit re-attach before the next Send — no automatic resend. The Host keeps unfinished pending requests until their TTL; Turn ownership uses a send-time window (`turn.start-5s` to `turn.end`) heuristic, so historical Turns do not claim newer submissions, though extreme clock/long-delay cases are unverified; the real-model partial-success path is not GUI-validated. One artifact may exist in several drafts for different revisions, but a single send accepts only its first request. The transport is still one V1 envelope per chip aggregated by the Host into an internal batch — there is no V2 composite envelope; the envelope still carries the full page as context, with input-token savings deferred to Phase 2.
- Historical revisions, branches and local restore (M3-2): **Restore as new revision** on an older revision card does not call the model — the Host records a new revision (revision = current latest + 1) and the client keeps the result as a **local revision card** (`localStorage`, at most 20 per chat, marked `localRevision`). Local cards render only in the Turn that triggered the restore (not at the bottom of the conversation) and exist only in browser-local storage: clearing storage or switching devices loses them, they never become an assistant message entry, and they do not participate in the export/image-export/replay chain. Restore is available only for non-latest revisions (the latest revision answers `already_latest`). Branch editing sends a `branch: true` request from an outdated revision's conflict banner, still carrying the old `baseRevisionId`; the Host records `latest + 1` with the old revision as its base. A branch draft that fails and is restored by Turn-close reconciliation loses the branch marker and must be re-enabled from the conflict banner; the real-model "branch partial failure" path is not separately validated.
- Draft persistence and cross-tab soft leases (M3-3): unsent drafts are written only to `sessionStorage` (per tab; one `dsh-iui-edit-draft:v1:<sessionId>:<baseRevisionId>` record plus a per-chat index), so a reload keeps them but **other tabs do not share them**; `branch`/`latestRevision`/`submitFailed` and the undo record are not persisted (branch must be re-enabled from the conflict banner), programs above the size cap are not persisted, and quota/JSON failures are silent. The soft lease runs over BroadcastChannel (`dsh-iui-artifact-edit-tabs:v1`, 30-second TTL, 10-second renewal): it only warns about the revision being edited; **Take over editing** moves the notice but never merges changes and never blocks editing; when the channel is unavailable the notice degrades to absent; extreme concurrency/clock skew is unverified; and the Host revision check remains the final authority.
- Temporary-style block editing (M3-4): temporary-style results support block content edits only; order-only/global-only requests are blocked by the client (`edit.errorTemporaryOrder`) and rejected by the Host's `render_ui` fallback, so they need a saved or built-in style; a temporary card without a valid style snapshot is not editable; the temporary-style path has not been separately validated with a real model or the real GUI (E2E simulates it). M3 is now complete (M3-1/2/3/4); M4 has started (M4-1 nested content editing done), with M4-2 hierarchical ordering and M4-3 restricted structure operations next, plus the B1/B2 closeout items (a11y, visual regression, real-GUI acceptance record, release).
- Nested block editing and hierarchical ordering (M4-1/M4-2): the editor's **Nested blocks / Top level only** control is opt-in (top-level only by default; a reload returns to top level and the mode is not remembered). Direct children of `Col`/`Row`/`Box`/`Grid`/`Card`/`Section`/`Carousel` are offered (M4-4 container expansion; Carousel wraps each child in its own item): M4-1 does content replacement, and M4-2 reorders children inside one container in the **Nested block order** list (pointer drag or keyboard ↑/↓/Home/End, with reset); duplicate/delete and cross-container moves were added by M4-3/M4-4; nested reordering has no live canvas preview (the list shows the target order), order-only requests still need one model `render_ui` turn (not zero-model), and a parent subtree being reordered must not also be edited in the same request; `@Each` templates, opaque expressions and shared named expressions are not selectable (page chrome no longer exists: `Caption`/`Divider`/`Spacer`/`Toc` and a root `Title` are normal editable blocks now); the root `targetOrder` is unchanged; one edit request must be all-nested or all-legacy (mixed requests are rejected by the Host); ordering changes travel as `orderByParent` (parent -> complete child nodeId permutation, changed groups only) while root `targetOrder` remains the base order; `editedBlockIds` is `[]` for order-only requests and the affected root block ids for nested content plus order; the Host still uses the program carried by the envelope as its base (the authoritative program store is not implemented yet); nested rendering relies on `display:contents` wrappers plus a 25-selector CSS compensation layer that must be maintained with the component CSS; real-GUI validation covered a single nested text replacement (M4-1), swapping two texts inside one container (M4-2), Box/Grid/Section child recognition, duplicating a Grid child, a model-added block (Revision 3) and a cross-container move (Revision 4) (M4-4), and the duplicate preview modal (add/remove/same rows plus summary) → confirm → Revision 5 (M4-5). Limits: `additions` and `orderByParent` cannot share one request (send them separately); the root is not a valid cross-container move target (the UI does not offer it and the Host does not support nested→root); Carousel off-screen items may anchor outside the track and need clipping when drawn (not implemented); no structure diff/preview or multi-step undo, delete does not garbage-collect helpers, and cross-container moves only append to the target end; v1 allows one added block per container; `base_missing` only shows an inline error (no old-card auto-recovery or lost-content prompt); local structure revision cards are localStorage-only and render only in the triggering Turn (no message/export/cross-device); additions depend on the model returning fragments in the documented order, and failures keep the request armed for a retry. M4-4 is complete; M4-5 (closeout: structural diff preview, a11y/performance smoke) is complete; B2-5 (strict protection + structural diff preview) is complete; B2-6 (partial runtime-state preservation) is complete; B1-5 (edit-canvas a11y) is complete. The remaining B2-8/9/10 real-GUI and visual-baseline work, then release, are next.\n- Layout/visual-validation limits (B2-8/B2-9/B2-10): a free layout cannot be forced through a plain `render_ui` — it must come from On-demand UI (a plain `render_ui` with free is rejected by the Host); the visual baselines are **manual references**, with no automated pixel comparison and sensitivity to the environment (macOS/Chrome 156/2x/light); the existing browser suites still guard geometry/typography; 390×844 only verifies the narrow-screen notice and absence of overflow, and 900×1000 only verifies the editor opens without horizontal overflow — broader device/browser combinations are not covered.
- Panel-polish limits (user-feedback fix): the enter/exit animation is panel-only (320ms, disabled under `prefers-reduced-motion`); switching the active draft unmounts the old editor immediately without the exit animation (only a real close animates); the delete confirmation is in-memory UI state and does not survive a reload; the popover clamp relies on measured sizes, so extreme font/zoom combinations are not covered.
- Editing width-fit limits (user-feedback fix): the fit is based on the conversation column after the sidebar and the measured content width (a hidden probe resolves `clamp()`-style tokens); the user preference is read from the content parent's `--dsh-chat-user-width` and followed through a MutationObserver; only the ≥1180px docked mode is affected; if the shell ever relocates these variables/attributes, the centralized selector/variable constants must be updated; the floating panel also has a 12px right inset (`panelRightInset`) that the fit accounts for on both sides (e.g. 1440/748+12→648).
- **Deployment note**: after the client bundle changes, **restart `dsh-web`** (a page refresh is not enough) to load the new code; if you still see old behavior (e.g. the editor still has an expand button or the width does not fit), confirm the service was restarted rather than assuming the code was not updated.
- Edit-canvas a11y limits (B1-5): the live region is a single polite slot, so rapid consecutive reorder announcements coalesce (only the latest message is read); pointer drags announce only on drop, not during the drag; closing the move menu with Tab does not force focus back to the trigger (Escape does); hidden drag/menu hints remain present in the accessibility tree; no real-GUI screen-reader/axe audit and no pixel-level visual baseline (B2-10).
- Runtime-state limits (B2-6): snapshots live in browser session memory only — **a page refresh loses them**; capacity is 24 artifacts, 5 revision snapshots per artifact (latest included) and 64 KiB of JSON per snapshot (invalid/circular/oversized state is ignored); the **first render does not inherit** history — only a new revision card carrying `baseRevisionId` inherits its base revision snapshot (falling back to the artifact latest when the base snapshot is missing); third-party component internal state and values interacted with inside the edit canvas are not preserved (the edit canvas renders a frozen base snapshot and never writes back).
- M4-5/B2-5 limits: the structure preview is a Host dry-run with strict validation and a diff display only; there is no pixel-level visual snapshot baseline and no full screen-reader/axe audit; preview loading has no client-side timeout (it relies on fetch failures); the modal backdrop blocks pointer events but is not `inert`/`aria-hidden`; visual regression relies on geometry/typography E2E rather than screenshot diffs; strict protection only covers **recognized top-level unselected blocks** — a change to an unselected nested child inside a selected root block is not detected; the `strictOff` copy is currently unused; the strict rejection path is covered only by Host unit tests (no real-GUI run); all earlier M4 limits still apply (Carousel off-screen anchors, append-only cross-container moves without root targets, additions vs orderByParent separation, one addition per container, no multi-step undo/GC, inline-only `base_missing`, local-card limits).
- Deterministic structure operations (M4-3, extended by M4-4/M4-5/M4-6): the UI offers duplicate, delete, same-parent move, cross-container **Move to…**, a structural diff preview and strict protection (Divider/Spacer quick adjust uses the same route's `props` operation). Each successful operation records a new revision and writes the authoritative program registry (`<DSH_HOME>/dsh-intelligent-ui-programs.json`, at most 200 records / 50 MB of program text, LRU-evicted); structure requests may only use that registry as their base — revisions recorded before M4-3 or evicted bases return `base_missing` and need a re-render; `branch` also requires the base program to still be present. Operations are idempotent (`operationId` plus a body digest: a replay returns the same result, a different body returns `operation_replayed`), and `toIndex` means the final position among editable children; a `props` operation (Divider/Spacer quick adjust) is validated against the node component, rewritten through the CST and recorded with the same idempotency/branch/CAS rules; its digest binds the property bag and cross-container target, duplicate targets in one batch are rejected and a no-op bag records no revision; target-order normalization identifies untitled blocks by content digest before falling back to page order for byte-identical duplicates. Local structure/property revision cards live only in client-localStorage and render only in the Turn that triggered the operation: no assistant message entry, no export/image-export participation, lost when switching devices; no diff preview or multi-step undo; delete does not garbage-collect helper declarations; `Section`/`Toc`/`@Each`/shared expressions are limited by CST rules; structure operations and content edits are separate actions, and a structure operation directly `markSubmitted`s the current draft (there is no "content draft expired by structure change" confirmation UI yet). Real-GUI validation covered duplicate (R2) and the two-step delete (R3).
- Saved-template directives are bounded display preferences (2,000 characters), with no authority over system, tool or safety rules. Limits are 40 global templates and 20 per session. Missing/deleted saved templates fall back to the default theme; a theme-less temporary result inherits the session template or built-in theme, while a snapshot with an explicit theme remains catalog-independent.

## FAQ

**Must I create a template, preview or name it first?** No. Choose On-demand UI and chat normally; use the result immediately. A name is needed only when you choose Save as template. Temporary results do not replace the selected session style.

**Can I save later or keep adjusting?** Yes. Use Adjust style or Save as template on that result. Saving uses the clicked result's version, not a later result. If the registry has evicted it, saving reports an unavailable snapshot.

**Why did clarification not continue generation?** A structured `ask_user_question` answer resumes the same operation; after a text question, the next message automatically continues it. Only expiry, restart, failure or interruption needs a re-arm/retry. Concurrent messages in multiple tabs may also consume the same intent.

**Why does an answer come back as plain text with no card?** First check that the switch is on for that session (the **UI** control in the composer, or `/iui on`). Even then the model may treat a single fact, a one- or two-sentence reply, or an explicit text/code request as a bounded exception. To force a card, invoke the skill explicitly with `/intelligent-ui` in a session where the switch is on. See [Usage](#usage).

**Why is there no export pill under an answer?** Only answers rendered by the extension have it; it is absent when the switch is off, the model replies in text, or rendering fails. See [Usage](#usage) and [Known limitations](#known-limitations).

**Why did the UI not change (or show an error) after rebuilding the plugin?** A page refresh may still load the old revision: restart the DSH process that serves the Web UI, then reopen the page. See [Development and deployment](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.en.md) for the exact errors and handling.

## Documentation

Detailed docs, the changelog and repository maintenance skills are excluded from the npm package, so their links use absolute GitHub URLs. For uncommitted features, use the corresponding files in the checkout.

- [Architecture and behavior](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/architecture.en.md): Host/Client component tree, the full switch and answer-style semantics, Artifact block editing, arrangement and multi-card parallel editing, UI language, image and interactive-page export flows, and the Agent Skill.
- [Development and deployment](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/development.en.md): install and uninstall, development commands, the restart tip after renaming/rebuilding, Host/Client version mismatch, release layout and community marketplace maintenance.
- [Verification record](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/docs/verification.en.md): end-to-end verification, test and packaging results (historical).
- [Changelog](https://github.com/Zephinel/dsh-intelligent-ui/blob/main/CHANGELOG.md): additions, changes and fixes per release.
- [GitHub Releases](https://github.com/Zephinel/dsh-intelligent-ui/releases): dated release pages with install notes.

## Credits and third-party dependencies

This extension builds on the following open-source projects and assets; thanks to their authors and maintainers:

- **[Open Intelligent UI](https://github.com/thesysdev/open-intelligent-ui) / [OpenUI](https://github.com/thesysdev/openui)** — the starting point for the component library, renderer, system prompt and component spec. MIT, Copyright (c) 2026 Thesys Inc.
- **OpenUI packages** — `@openuidev/lang-core`, `@openuidev/react-lang`, plus the transitive `@openuidev/devtools` and `@openuidev/observability`; they parse OpenUI Lang, define components and render them. MIT.
- **[Remix Icon](https://github.com/Remix-Design/RemixIcon)** — icons used by the plugin's own chrome (edit, delete, move, locate, info, etc.); path data is transcribed as-is. Remix Icon License v1.0, Copyright (c) 2017-2026 Remix Design.
- **[lucide-react](https://github.com/lucide-icons/lucide)** — icons for the model-rendered `Icon` component. ISC.
- **[KaTeX](https://github.com/KaTeX/KaTeX)** — math rendering for the `Math` component, including the bundled fonts. MIT.
- **[MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js)** — map and route rendering; its worker source is embedded in the bundle. BSD-3-Clause, Copyright (c) MapLibre contributors.
- **[SnapDOM](https://github.com/zumerlab/snapdom)** (`@zumer/snapdom`) — answer-card image export. MIT, Copyright (c) 2025 ZumerLab.
- **[zod](https://github.com/colinhacks/zod)** — runtime validation for component props and OpenUI programs. MIT.

**React / React DOM** (MIT) are provided by the DSH Web platform; the standalone interactive-page bundle inlines them. Map tiles and routing data come from OpenFreeMap / OpenMapTiles / OpenStreetMap, Esri and OSRM, and the map shows the corresponding attribution in place.

Full license texts are in [NOTICE](NOTICE) and [licenses/](licenses/). If something is missing or misattributed, please open an issue or PR.

## License

This project is [MIT](LICENSE). It is based on Open Intelligent UI (MIT, Copyright (c) 2026 Thesys Inc.) and the OpenUI ecosystem; the browser bundle contains lucide-react (ISC), KaTeX (MIT), MapLibre GL JS (BSD-3-Clause), zod (MIT) and SnapDOM (MIT); the standalone interactive-page bundle also inlines React / React DOM (MIT). Full notices and license texts are in [NOTICE](NOTICE) and [licenses/](licenses/).
