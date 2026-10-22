# Architecture and behavior

[中文](architecture.md) | English

[← Back to README](../README.en.md)

This page expands the structural and behavioral details summarised in the README.

## Architecture

```
Host  lib/index.js (Node)
├─ ctx.tools.register(render_ui)          # args { program, style, title? }
│   └─ @openuidev/lang-core validates against the component library spec; errors are returned precisely, and the model repairs them in the same turn
├─ session switch + answer style (global defaults + session overrides)   # /iui command + projection + per-agent tool visibility
├─ ctx.systemPrompt.section(...)          # injects the OpenUI Lang generation prompt only when the switch is on
├─ Config.globalEnabled / answerStyle / freeComposition / exportBackground / exportScale (volatile)  # written by the plugin detail page; the prompt reads them live per request
├─ webServer routes (optional injection)     # /api/intelligent-ui/export/standalone.{js,css} for the interactive-page export
└─ ctx.skills.register(intelligent-ui)    # embedded Agent Skill (skills/intelligent-ui/SKILL.md)

Client  lib/client.js (browser, lazily loaded by the DSH module loader)
├─ ctx.locale.register('intelligent-ui')  # zh/en UI dictionaries; slots declare locale and receive the injected t
├─ conversation.input.activity             # the composer UI control (chip + Menu + style panel; reads the projection + runs switch/style commands)
├─ plugins.bundle.config '@zephinel/dsh-intelligent-ui'  # plugin detail page: Availability, Answer style, Composition and Image export (writes volatile Host settings fields)
├─ conversation.chat.turnTail list item    # at the end of each turn, takes that turn's render_ui program and renders the card
│   └─ <OpenUIRenderer> = @openuidev/react-lang <Renderer> + 57 ported components (chrome reads the renderer i18n context)
├─ conversation.chat.assistant-actions list item  # export button, only for messages whose Turn recorded render_ui
│   └─ menu (image: raw / rounded / card; interactive page) -> PNG or single-file HTML download
├─ tool.call.toolview keyed 'render_ui'   # leaves a single "Interactive answer" (交互式回答 in Chinese) line in the process area
└─ built-in CSS (the component library / MapLibre / KaTeX use DSH global styles + a scoped reset)
```

With the switch off there is no trace of this tool on the model side; only after it is turned on does the model see the tool, a system prompt section and an on-demand skill. All UI rendering and interaction happen in the browser; the program itself enters the session log as a tool argument and is replayed with history.

## Switch and answer style

![The composer UI control: the three-way switch and Display style below an inset divider](../assets/intelligent-ui-toggle.png)

- **Global defaults:** the Plugin detail page provides **Enable in all sessions**, the global Auto / Card / Article style, the **Free-form layout** switch, and the **Image export** defaults (background color, 1x/2x). New sessions inherit these values. The page groups them into **Availability**, **Answer style**, **Composition** and **Image export**.
- **Session overrides:** the composer UI control changes only the current session. `/iui on|off|inherit` sets the enable override; `/iui style auto|card|article|inherit` sets the style override. A session override wins over the global value; `inherit` follows it.
- **Answer styles:** `Card` is the compact interactive card; `Article` is a reading layout inside the `render_ui` card (`Toc` + collapsible `Section`s + long Markdown prose); `Auto` lets the model choose per request. A Section body is its own nested flow using the group rhythm; the page-level flow relies on margins only, without an extra flex gap, so section boundaries do not double their blank space.
- **State:** the global enable/style/free-composition values live in the Host settings document; session enable, off and style overrides are written atomically to `<DSH_HOME>/dsh-intelligent-ui.json` (`sessions`, `offSessions`, `styles`). Legacy `{ "global": true, "sessions": [...] }` files are still read as migration values.
- The session command log folds into the `intelligent-ui` projection, which carries the current enable/style view and pending state; the composer control only mirrors the projection, and the Host owns every state decision. The control broadcasts its optimistic view to other tabs over BroadcastChannel; the projection wins once it arrives. The scope menu and the export menu share the same `MenuItem`/`MenuDivider` rows (content-based width with a 208px minimum, one vertical rhythm, consistent selected/hover/disabled states); the scope menu right-aligns with the chip; the Display style row is always visible, disabled while off, with an inset hairline above it; the style panel is a second level, and its back button returns to the scope menu instead of dismissing every popup.
- The switch requires a deployment that composes both `sessionProjections` and `commands` (DSH Web has both by default). If either service is missing, the session controls cannot be displayed or persisted, and the extension falls back to **always on**.

## Layout and spacing contract

- **The renderer owns the vertical rhythm**: the page root `Col`, `Section` bodies and `Card` contents are flow-spaced (page 24px, group 12px, inner 8px). The model should not pass `gap` there; an explicit gap overrides or doubles the rhythm.
- **Explicit gaps are for rows and compact groups**: `Row`, `Grid`, `Carousel` and small control stacks may use 1–2 (inner) or 3–4 (group); do not use a nested `Col` with 5–6 to imitate page spacing.
- **No manual blank space**: `Spacer()`, empty `Box`/`Col`/`Card`, empty `Text`/`Markdown`, and a `Divider` used as a blank create uncontrolled blank bands; group with a `Card`, otherwise let the flow space the blocks.
- **Fallback chain**: the generation prompt and the Agent Skill carry the same contract; the Host's `layoutWarnings` returns non-fatal warnings for root gaps, vertical Spacers, empty Sections/Text and `gap: 0` block stacks so the model can repair them in the same turn; the renderer itself guarantees Section bodies are nested flows and the Article root keeps a single page gap.

## Decision policy

The switch only makes the capability visible; the policy that decides whether a turn gets a card and which style it uses lives in one place — the injected `tool:intelligent-ui` prompt section (the Host also prefixes it with "Intelligent UI is enabled for this session" and appends the effective style note). Because it is injected together with the switch, an enabled session behaves as follows:

- **Pages are the default:** any answer with structure is answered with `render_ui`; a `Card` page stays compact and scannable.
- **Article pages:** the `Article` style calls for an article-first page — a `Toc`, collapsible `Section`s, and substantive `Markdown` prose for every major part; a skeleton, or content hidden behind interactions, is not acceptable.
- **Prose is the bounded exception:** the whole answer is a single fact or one or two sentences; the user explicitly asks for text / a document / code; the content cannot be shown as a page (a safety warning, material that must be quoted verbatim); or two render attempts failed in the turn.
- **One source:** the Agent Skill does not repeat the decision policy; it only covers how to build.
- **Free-form layout switch:** the plugin detail page writes a volatile field in the Host settings document. When on, the design playbook becomes advisory. It is orthogonal to the answer style and does not replace it.

## Image export

- **Entry:** the extension contributes an entry to DSH's `conversation.chat.assistant-actions` list (the standard copy / like / branch strip) and uses `order` plus `margin-left: auto` to sit at the **far right** of that row, styled as a labeled export pill to stand apart from the native icon controls. The entry renders only when the finalized assistant message's Turn recorded an exportable `render_ui` call, so plain text answers keep the shipped action row unchanged. The `render_ui` tool call is the durable marker; no extra session metadata is written.
- **Scope:** one export covers every card rendered by that Turn. Exported images contain the rendered cards only — not the Markdown text around them and not the export control itself.
- **Capture:** the entry temporarily expands collapsed cards (restoring them afterwards), waits for in-card photos and image searches plus each map's readiness signal (`data-iui-map-ready` mirrors MapLibre `idle`, and style swaps, tile fallback and resizes reset it first) to settle, freezes CSS transitions and animations, and rasterizes the live card DOM with SnapDOM. SVG rasterization does not honour `backface-visibility`, so a flashcard's 3D faces are flattened during the capture to the face the reader currently sees. Maps are captured through MapLibre's preserved WebGL drawing buffer; sandboxed iframes (`HtmlView`) are not capturable and are missing from the image. Images, fonts and local interaction state follow the live DOM.
- **Frames:** the menu offers **raw** (the answer alone), **rounded** (background color plus rounded padding) and **card** (padding, rounded corners and a soft shadow). The frame is chosen per export; the menu right-aligns with the export pill, its width follows its content, and when the space above is too short it opens below the pill. The background color and 1x/2x resolution are defaults from the **Image export** group on the Plugin detail page.
- **Download:** the browser receives one PNG named after the answer title plus a local timestamp. No Host or session data is involved.

## Interactive-page export

- **Entry:** it shares the action-strip export pill and menu with the image export; the item below a divider, labelled **Interactive page**, is separate from the three image frames.
- **Assets:** `scripts/build.mjs` also builds `lib/standalone.js` / `lib/standalone.css` (React + renderer + KaTeX/MapLibre styles). Through an optional `webServer` injection the Host registers two same-origin exact routes (`/api/intelligent-ui/export/standalone.js` and `.../standalone.css`) and reads those build artifacts per request; a deployment without `webServer` registers nothing and the client reports a page-build failure.
- **Assembly:** on click the browser fetches both assets in parallel, walks the current page stylesheets to snapshot computed custom properties as the theme, then `export-html-plan.ts` inlines the card programs, assets and theme into one HTML document (about 3.4–4.9 MB). The download name carries the answer title and a local timestamp.
- **Page runtime:** `src/standalone/index.tsx` renders the real `OpenUIRenderer` body only (the DSH card header and collapse control are not exported), so maps, charts and forms keep the same interactions as inside DSH. `@OpenUrl` opens links as usual; `@ToAssistant` degrades to copy-message + toast telling the reader to paste back into DSH, and a failed clipboard leaves the message in the toast. The page keeps only the theme it was exported with (current light/dark) and does not follow later DSH theme switches.

## UI language

- All of the extension's own browser-side copy (the composer switch, its menu, card titles and states, render-failure notices, component chrome such as the map, code blocks and timers, and accessible labels) is translated through DSH's locale service: `ctx.locale.register('intelligent-ui', { zh, en })`, with slot registrations declaring `locale` so components receive the injected `t`.
- The browser half therefore requires a deployment that composes `@deepseek-ai/dsh-client-locale` (included by default in DSH Web 0.2.1); in a custom composition without it the browser half does not mount (the Host tool and prompt are unaffected).
- It follows DSH's UI language setting (**Settings → General → Language**); switches apply immediately with no reload. The bilingual dictionaries live in `src/shared/locales.ts`: `zh` is the key-set source of truth and `en` is checked against the same key set.
- The plugin's title and description in the Plugins list come from `locale/en.json` and `locale/zh.json` (the `PluginLocalizedMeta` convention), a separate mechanism from the UI dictionaries above.
- Model-facing text (the `render_ui` tool description, the OpenUI Lang generation prompt and the Agent Skill) and the `/iui` command's Host replies stay in English: DSH's locale service covers browser UI only, and built-in Host commands are English as well.
- The renderer library defaults to English when used outside DSH (tests, standalone embeds) and does not depend on the locale service.

## Agent Skill

On mount, the plugin registers `skills/intelligent-ui/SKILL.md` as an **embedded skill** (only when the deployment also composes the `dsh-skill` skill service; deployments without a skill service are unaffected):

- `intelligent-ui` appears in the session catalog, and the model loads it on demand with the `skill` tool;
- the skill catalog entry is always visible (at negligible cost); but **do not call `render_ui` while the switch is off** — the Host rejects it, so ask the user to turn the switch on first;
- users can also invoke it directly with `/intelligent-ui` (`userInvocable`); explicit invocation injects the same skill content and turns the invocation into a directive to build a page;
- the skill contains:
  - `SKILL.md` — the workflow (the decision policy is owned by the injected prompt; explicit invocation is a directive), the read-only-checkout preflight rule while answering, hard OpenUI Lang rules, design guidelines (advisory when Free-form layout is on), DSH behavior, and a reference index;
  - `references/components.md` — complete parameter tables for 57 components + 73 `@functions` (14 core + 59 library) + 5 action steps;
  - `references/language.md` — syntax, expressions, `$` state, `@Each`, and a table of common errors;
  - `references/examples.md` — 6+ complete, directly runnable programs (itinerary, calculator, SVG tutorial, dashboard, forms, mini-game);
  - `references/troubleshooting.md` — raw Host validation errors and how to fix them, runtime fallbacks and the preflight rule;
  - `references/integration.md` — integration steps and contracts for other deployments/agents.

The skill files also ship with the package as an ordinary directory (`skills/`), making them easy to read, reuse and redistribute.
