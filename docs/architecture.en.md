# Architecture and behavior

[中文](architecture.md) | English

[← Back to README](../README.en.md)

This page expands the structural and behavioral details summarised in the README.

## Architecture

```
Host  lib/index.js (Node)
├─ ctx.tools.register(render_ui)          # args { program, style, title?, styleId? | temporaryStyle? }
│   └─ @openuidev/lang-core validates against the component library spec; errors are returned precisely, and the model repairs them in the same turn
├─ session switch + answer style (global defaults + session overrides)   # /iui command + projection + per-agent tool visibility
├─ ctx.systemPrompt.section(...)          # injects the OpenUI Lang generation prompt only when the switch is on
├─ Config.globalEnabled / answerStyle / freeComposition / exportBackground / exportScale / removeFollowUps (volatile)  # written by the plugin detail page; the prompt reads them live per request
├─ on-demand.ts Operation controller       # session/event binding, clarification and termination; projection v6 onDemand
├─ style-store.ts + style-routes.ts          # saved templates; authenticated catalog/saveFromResult/update/delete
├─ result-store.ts                          # up to 200 immutable temporary result snapshots; save later
├─ webServer routes (optional injection)     # /api/intelligent-ui/export/standalone.{js,css} for the interactive-page export
└─ ctx.skills.register(intelligent-ui)    # embedded Agent Skill (skills/intelligent-ui/SKILL.md)

Client  lib/client.js (browser, lazily loaded by the DSH module loader)
├─ ctx.locale.register('intelligent-ui')  # zh/en UI dictionaries; slots declare locale and receive the injected t
├─ conversation.input.activity             # the composer UI control (chip + Menu + style panel; reads projection + switch/style/on-demand commands)
├─ conversation.input.overlay              # OnDemandHint: armed hint, examples and cancel in the arming tab
├─ plugins.bundle.config '@zephinel/dsh-intelligent-ui'  # plugin detail page: Availability, Answer style, My styles, Composition and Export (writes volatile Host settings fields)
├─ conversation.chat.turnTail list item    # extracts programs/snapshots at turn end; renders themes, temporary badge and adjust/save actions
│   └─ <OpenUIRenderer> = @openuidev/react-lang <Renderer> + 57 ported components (chrome reads the renderer i18n context)
├─ conversation.chat.assistant-actions list item  # export button, only for messages whose Turn recorded render_ui
│   └─ menu (image: raw / rounded / card; interactive page) -> PNG or single-file HTML download
├─ tool.call.toolview keyed 'render_ui'   # leaves a single "Interactive answer" (交互式回答 in Chinese) line in the process area
└─ built-in CSS (the component library / MapLibre / KaTeX use DSH global styles + a scoped reset)
```

With the switch off there is no trace of this tool on the model side; only after it is turned on does the model see the tool, a system prompt section and an on-demand skill. All UI rendering and interaction happen in the browser; the program itself enters the session log as a tool argument and is replayed with history.

## Switch and answer style

![The composer UI control: the three-way switch and Display style below an inset divider](../assets/intelligent-ui-toggle.png)

- **Global defaults:** the Plugin detail page provides **Enable in all sessions**, the global Auto / Card / Article or saved-template style, the **Free-form layout** switch, and the **Export** defaults (image background color, 1x/2x, and whether images/pages remove the whole `@ToAssistant` follow-up block (on by default)). New sessions inherit these values. The page groups them into **Availability**, **Answer style**, **My styles**, **Composition** and **Export**.
- **Session overrides:** the composer UI control changes only the current session. `/iui on|off|inherit` sets the enable override; `/iui style auto|card|article|inherit|<cs_id>` sets the style override. A session override wins over the global value; `inherit` follows it.
- **Answer styles:** `Card` is the compact interactive card; `Article` is a reading layout inside the `render_ui` card (`Toc` + collapsible `Section`s + long Markdown prose); `Auto` lets the model choose per request. A Section body is its own nested flow using the group rhythm; the page-level flow relies on margins only, without an extra flex gap, so section boundaries do not double their blank space.
- **State:** the global enable/style/free-composition values live in the Host settings document; session enable, off and style overrides are written atomically to `<DSH_HOME>/dsh-intelligent-ui.json` (`sessions`, `offSessions`, `styles`). Legacy `{ "global": true, "sessions": [...] }` files are still read as migration values.
- The session command log folds into the `intelligent-ui` projection, which carries the current enable/style view, pending state and live `onDemand` (stateVersion 6); the composer control only mirrors the projection, and the Host owns every state decision. The control broadcasts its optimistic view to other tabs over BroadcastChannel; the projection wins once it arrives. The scope menu and the export menu share the same `MenuItem`/`MenuDivider` rows (content-based width with a 208px minimum, one vertical rhythm, consistent selected/hover/disabled states); the scope menu right-aligns with the chip; the Display style row is always visible, disabled while off, with an inset hairline above it; the style panel is a second level, and its back button returns to the scope menu instead of dismissing every popup.
- The switch requires a deployment that composes both `sessionProjections` and `commands` (DSH Web has both by default). If either service is missing, the session controls cannot be displayed or persisted, and the extension falls back to **always on**.

## Custom styles and on-demand operations

### Result style contract

`StyleSnapshot` in `src/shared/style-templates.ts` is schemaVersion 1 (StyleSnapshotV1): `baseLayout: card|article|free`, `directives`, `theme`, and optional `suggestedName`. `render_ui` requires `program` and `style`, with optional `title` and mutually exclusive `styleId` or `temporaryStyle`. The temporary snapshot's `baseLayout` must equal `style`; only a current tool call observed and authorized by the Host may use it. New on-demand generation uses `style: "free"` and `temporaryStyle.baseLayout: "free"`; the program determines the layout without Card compactness or an Article reading wrapper. Toc/Section are optional for free results; parser, anchor, theme and authorization checks remain. Legacy card/article snapshots keep their shell and Article checks. Built-in session styles remain Auto/Card/Article; saved templates use `baseLayout: RenderLayout` (card/article/free). A selected free template uses `style: "free"` and its exact `styleId`, without `temporaryStyle`; the Host retains template ID and layout consistency checks. During on-demand operations the prompt omits session-shell guidance: follow the user’s layout request and ask a focused question if materially unclear, with no silent default. Success includes `statements`, `style`, `styleSource: builtin|template|temporary`, and optional `styleId`/`warnings`; the snapshot lives in tool arguments rather than a duplicate success field.

The Host enforces layout by operation kind: `generate` requires both `style` and `temporaryStyle.baseLayout` to be `free`; `adjust` requires both to match the snapshot `baseLayout` stored under `parentResultId` (free stays free, legacy card/article keeps its layout). A missing parent snapshot, including eviction by the latest-200 limit, rejects adjustment with an error asking the user to cancel and start a new on-demand generation; model arguments and conversation content cannot establish the parent layout. Rejection neither records a result nor completes the operation; historical tool arguments still replay.

Precedence is authorized temporary style for this call → session override → global default → Auto. Temporary styles never write session/global settings. An ordinary call under a selected custom template must pass its exact `styleId` and base layout. Missing templates/catalog fall back to the default client theme; temporary snapshots are independent of the catalog.

### Operation and session events

`host/on-demand.ts` keeps one Operation per session: Host-generated `operationId`, session/optional client identity, the first human message's `triggerMessageId`, generate/adjust kind, optional `parentResultId`, clarification rounds, result IDs and timestamps. `/iui on-demand [off|<client-instance-token> [adjust <resultId>]]` arms or cancels; the session must be enabled first. While armed, re-arming replaces the active operation without changing the selected style; once a human message has bound the operation (running/clarifying), re-arming is rejected and the caller must cancel explicitly, so a second click cannot revoke an authorization the model is about to use.

States are `armed → running ↔ clarifying → completed`, with `failed`, `cancelled` and `interrupted` exits. Armed intent has a 10-minute TTL checked on access. The controller retains at most 256 sessions without silently evicting active work. Operations are in memory; restart clears their views (without reconstructing interrupted records) and requires re-arming.

A prepended `session/event` listener updates state before projection publication, deduplicates monotonic seq values and constrains tool events by turn. The first human `user/message` binds the operation; injected skill/file context is ignored. DSH appends a step's `system/message` before its first `user/message`, so the ON-DEMAND note must be injected while the operation is **armed** and kept after binding; otherwise the first turn's model never sees the on-demand contract. During a bound on-demand turn, a plain `render_ui` without `temporaryStyle` is rejected so the model must use a temporary snapshot or ask first. `tool/call render_ui` registers its callId (up to 8 attempts); temporary authorization requires the bound message, active state and current callId. After validation and the durable result write, the Host synchronously completes the operation. Late calls lose authorization after completion/cancellation. A completed turn that rendered nothing returns to armed/resume; only error/abort moves the operation to failed/cancelled/interrupted.

`ask_user_question` enters clarifying and blocks temporary render until answered. A matching structured tool result (`answers` array) or callId-tagged `user-question-reply` resumes running; a timeout is not an answer, a question error fails, and at most two rounds are allowed. The prompt requests 1–3 questions per round, with options/free input/skipping when DSH supports them; the extension does not replace the built-in question UI. If the tool is unavailable, text questions degrade the flow; a completed turn without a render enters resume, so the next message continues without an immediate re-arm (except after expiry, restart or failure).

Projection v6 adds nullable `onDemand` (operationId, status, kind, parentResultId, clientInstanceId, resultIds) alongside enable/style/pending. Replaying history does not authorize operations. `OnDemandHint` appears only for armed intent and matching client identity; examples fill without sending and preserve drafts. The Host still binds the next human message in the session without checking its sending tab; this conservative convergence is not message-metadata isolation.

### Saving and template management

`result-store.ts` atomically persists the latest 200 immutable temporary snapshots in `<DSH_HOME>/dsh-intelligent-ui-results.json`: `resultId = tool callId`, sessionId, snapshot, optional parentResultId and createdAt. Each adjustment gets a new callId; there is no separate revisionId in this implementation. Saving uses the clicked result ID. Recorded arguments can still replay after registry eviction, but saving then returns `result_missing`.

`style-store.ts` persists templates in `<DSH_HOME>/dsh-intelligent-ui-styles.json` (still `version: 1`; free is an additive layout value requiring no migration), limited to 40 global and 20 per session. `GET /api/intelligent-ui/styles?sessionId=…` returns global and that session's templates; POST on the same route supports `save`, `saveFromResult`, `update`, `delete`. Routes register only with `webServer` and `connection.requestRejection`, authenticate first, accept JSON up to 64 KiB/15 seconds and return no-store responses.

`saveFromResult` accepts resultId, name, description, scope and optional sessionId; it rejects `baseLayout` (including legacy client shell choices) and browser-provided directives/theme. The Host copies baseLayout/directives/theme exactly from the registered snapshot; and session scope must match the owning session. Saving neither selects the template nor changes the global default. Duplicate names fail; the server has no separate idempotency key. `update` allows only name/description/directives; `delete` removes a template. The composer manages visible templates; settings manages global templates and file export/import. Deleting the current choice attempts an Auto fallback; other sessions handle stale references as missing templates.

### Portable template exchange v1 (unreleased)

The pure shared `src/shared/style-template-exchange.ts` has no React, DOM or DSH dependency and provides `toPortableStyle`, `createStyleExport`, `encodeStyleExport` and `parseStyleExport`. Envelope keys are exactly `kind: "dsh-intelligent-ui/style-template"`, `schemaVersion: 1`, and `template`. Portable fields are constructed in order: `name`, `description`, `baseLayout: card|article|free`, `directives`, `theme`. Missing description becomes `''`; other fields are required. Every level rejects unknown keys, including `__proto__`, `constructor` and `prototype`. Themes reuse `isStyleTheme` hex/enum validation; labels/preferences retain existing bounds and character rules. Names/descriptions also strip Unicode `Cf` and trim; empty or reserved names reject. Themes and palettes are explicitly rebuilt in fixed order, with `JSON.stringify(value, null, 2)` producing identical bytes for the same configuration. Local IDs, scope, sessions, timestamps, package versions, export dates, authors, signatures and checksums are excluded.

Input is checked with `TextEncoder` before parsing, limited to 32 KiB of UTF-8 bytes. File selection checks `File.size` before reading, regardless of filename/MIME. One whole-input Markdown fence with `json` or no language is tolerated; JSON is not searched for in arbitrary prose. External names/descriptions/directives strip `Cf`, `Default_Ignorable_Code_Point` and U+2800; labels also normalize U+2028/U+2029 to spaces. Raw legacy template exports are not supported: raw template objects, store documents such as `{version:1, templates:[…]}` and other non-envelope shapes reject as `invalid_structure` without fuzzy detection. Typed `StyleExchangeError` codes are `empty_input`, `too_large`, `invalid_json`, `invalid_structure`, `unsupported_version` and `invalid_template`; the UI localizes them without exposing raw exceptions.

My styles in Plugin settings and the composer's Display style panel share the export menu (session-scoped templates export from the composer too): both confirm the name/description/full preferences/theme disclosure before exporting `<template-name>.iui-style.json` (application/json), using `fileStem`, an attached noopener anchor, removal and deferred URL revocation. Both import entries (My styles and the composer panel) mount `TemplateImport` and send file/paste input through the same codec, creating global templates only. Preview supports editing name (30), description (100) and preferences (2000), or clearing preferences, while showing layout, light/dark canvas/ink/accent swatches and full preference text. All external content (name, description and preferences) requires explicit acknowledgement, reset when the name or preferences change. External content uses React text nodes/form fields without HTML or Markdown execution. Case-insensitive global name collisions suggest a truncated `(Imported)` name; remaining collisions block confirmation. A full 40-template global catalog disables import, while Host duplicate_name/limit_reached errors remain authoritative. Errors retain input. Busy state plus a synchronous flight guard prevents double submission; the Popover supports Escape, focus return and keyboard cycling.

Confirmation calls `StyleActions.createTemplate` on the existing authenticated `POST /api/intelligent-ui/styles`, with exactly `{op:'save', template:{name,description,baseLayout,directives,theme}, scope:'global'}` and no sessionId. The response must pass `isStyleTemplate`. The Host retains its five-field whitelist, theme/label/preference checks, cross-scope duplicate names, quotas and atomic writes, generating fresh identity/timestamps. Success refreshes the catalog, closes the dialog and announces status, without settings writes or automatic application. Imported templates use the ordinary use/rename/edit/delete/re-export paths. There are no new Host endpoints, store formats or model calls; the composer reuses the same export/import components (export covers session templates, import still writes global templates only) and session-scope import remains deferred. Codes/links/gallery/batch imports are unavailable.

**Compatibility promise**: exchange format v1 contains only portable style configuration and all three current layouts, excluding local identity/session metadata. Plugin versions supporting v1 can import it; unknown versions reject explicitly without downgrade guessing. Raw template exports are out of compatibility scope. Exchange versions are independent of npm versions. Future v2 implementations should retain the v1 parser; adding layouts or removing baseLayout requires explicit format evolution, never silently accepting unknown layouts in v1.

**Trust boundary and plan deviation**: following owner approval (2026-10-24), the current implementation replaces the plan’s mandatory appearance-only import before audit with a disclaimer plus acknowledgement of all external content (name, description and preferences). The plan/reviews are retained. External names and directives enter the prompt while the description is stored/exported only and never enters it; all external content is treated as untrusted text. Preview, edit/clear, acknowledgement and no automatic application mitigate risk without eliminating prompt injection. DISPLAY PREFERENCES/JSON encoding does not isolate execution. DSH’s tool/permission execution layer remains authoritative; execution-layer and real-deployment Origin/CSRF audits are recommended pre-release hardening. This validation checks existing requestRejection delegation and route denial, not real-deployment Origin/CSRF policy or prevention of tool privilege escalation.

### Card themes, actions and security boundaries

`programs.ts` defensively extracts temporary snapshots from recorded arguments, rejects mixed sources/layout mismatch, and skips failed calls or arguments outside the loaded history window. `IntelligentUICards` resolves temporary snapshots first, catalog templates second; `resolveStyleThemeVars` maps only whitelisted fields into renderer-host CSS variables. Scheme follows the DSH body marker (system preference outside DSH). Portaled popovers and sandboxed iframes keep the default theme; semantic status colors remain CSS-owned.

Temporary results show a **Temporary style** badge and extension-owned **Adjust style** / **Save as template** actions outside the model program. Adjustment binds a specific resultId, preserves the draft and fills a prefix; normal sending creates a new result. The save popover asks only for name/description/availability. The Host copies the original layout and validated theme/directives exactly, leaving the result unchanged and making no model call. Legacy snapshots retain their layout and original save flow. Free templates have a local composition preview and **Free layout** hint, with use/rename/edit preferences/delete actions. Template results retain the DSH card header without the temporary badge or adjust/save actions; free adds no Article wrapper or Toc/Section requirement and uses the template’s light/dark theme. Settings owns global defaults, saved-template management, composition and exports; generation happens in the composer.

Themes accept only light/dark six-digit hex palettes and font/radius/density/shadow enums, rejecting unknown fields, arbitrary CSS/scripts/URLs. Temporary ink/canvas and accent/canvas must reach 3:1 in each scheme, with a warning below 4.5:1. Directives are limited to 2,000 characters. Saved-template directives enter the prompt as a JSON string inside DISPLAY PREFERENCES delimiters, explicitly subordinate to system/tool/safety rules. Temporary directives remain result data, never promoted to system instructions. Models cannot self-arm, save templates or change defaults; the existing `HtmlView` sandbox boundary remains.

Replay accepts free template calls with a valid styleId; free without a source, invalid snapshots and styleId/temporaryStyle mixes still render nothing. Replay and `programsToExportCards` preserve free layout for temporary results and templates; PNG captures the live composition. Standalone HTML uses available page width for free results and retains the 760px measure for Card/Article results, including mixed exports. Resolved per-result themes and schemes remain frozen in HTML exports.

UI state structure: an in-flight write or command must not be expressed as visual `disabled`. The settings page has no render-visible pending state; saves set `aria-busy` imperatively through `sectionRef`. The composer panel is a separate `StylePanel` that receives only availability (`disabled`) and callbacks, so the parent's `busy`/`pending` is outside its scope; On-demand arming lives inside `StylePicker`. Controls added inside these boundaries therefore cannot receive transient command state and turn a save/style switch into block-wide `disabled`/opacity flashes. Only the control that owns the async operation may disable itself briefly (the On-demand entry, an import submit button). The `:disabled { opacity }` CSS remains, so a new boundary that reintroduces transient `disabled` can still flash; express unavailability through `locked`/`panelDisabled` instead.

## Layout and spacing contract

For free temporary results or selected free templates, the page-shape and typography guidance below is advisory; follow the user-requested composition. Component flow spacing, language, theme and safety rules still apply.

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
- **Frames:** the menu offers **raw** (the answer alone), **rounded** (background color plus rounded padding) and **card** (padding, rounded corners and a soft shadow). The frame is chosen per export; the menu right-aligns with the export pill, its width follows its content, and when the space above is too short it opens below the pill. The background color, 1x/2x resolution and the follow-up-removal switch are defaults from the **Export** group on the Plugin detail page.
- **Theme:** PNG captures the live renderer theme, including the current card chrome and action row.
- **Download:** the browser receives one PNG named after the answer title plus a local timestamp. No Host or session data is involved.

## Interactive-page export

- **Entry:** it shares the action-strip export pill and menu with the image export; the item below a divider, labelled **Interactive page**, is separate from the three image frames.
- **Assets:** `scripts/build.mjs` also builds `lib/standalone.js` / `lib/standalone.css` (React + renderer + KaTeX/MapLibre styles). Through an optional `webServer` injection the Host registers two same-origin exact routes (`/api/intelligent-ui/export/standalone.js` and `.../standalone.css`) and reads those build artifacts per request; a deployment without `webServer` registers nothing and the client reports a page-build failure.
- **Assembly:** on click the browser fetches both assets in parallel, walks the current page stylesheets to snapshot computed custom properties as the theme, then `export-html-plan.ts` inlines the card programs, assets and theme into one HTML document (about 3.4–4.9 MB). The download name carries the answer title and a local timestamp.
- **Per-result theme snapshot:** `programsToExportCards` prioritizes inline temporaryStyle.theme, then the currently visible template, and inlines resolved themeStyle and scheme per card. The exported page makes no later catalog lookup. Temporary results are catalog-independent; missing saved templates export with the default theme.
- **Page runtime:** `src/standalone/index.tsx` renders the real `OpenUIRenderer` body only (the DSH card header and collapse control are not exported), so maps, charts and forms keep the same interactions as inside DSH. `@OpenUrl` opens links as usual; `@ToAssistant` degrades to copy-message + toast telling the reader to paste back into DSH, and a failed clipboard leaves the message in the toast; the **Remove follow-up actions** switch is on by default and removes the whole block that contains the follow-up at export time (for both images and pages); turn it off to keep the copy fallback. The page keeps only the theme it was exported with (current light/dark) and does not follow later DSH theme switches.

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
- During on-demand operations the skill requires temporaryStyle with matching style and no styleId; material ambiguity uses built-in ask_user_question before direct rendering, with no required preview/naming/saving. Authorization belongs to the Host; the model cannot self-authorize or save templates.
- the skill contains:
  - `SKILL.md` — the workflow (the decision policy is owned by the injected prompt; explicit invocation is a directive), the read-only-checkout preflight rule while answering, hard OpenUI Lang rules, design guidelines (advisory when Free-form layout is on), DSH behavior, and a reference index;
  - `references/components.md` — complete parameter tables for 57 components + 73 `@functions` (14 core + 59 library) + 5 action steps;
  - `references/language.md` — syntax, expressions, `$` state, `@Each`, and a table of common errors;
  - `references/examples.md` — 6+ complete, directly runnable programs (itinerary, calculator, SVG tutorial, dashboard, forms, mini-game);
  - `references/troubleshooting.md` — raw Host validation errors and how to fix them, runtime fallbacks and the preflight rule;
  - `references/integration.md` — integration steps and contracts for other deployments/agents.

The skill files also ship with the package as an ordinary directory (`skills/`), making them easy to read, reuse and redistribute.
