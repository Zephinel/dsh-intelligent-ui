# Integration and deployment

dsh-intelligent-ui is a DSH bundle with two halves:

- **Host** (`lib/index.js`, Node): registers the `render_ui` tool, validates programs with `@openuidev/lang-core` against the generated component spec compiled into the bundle, owns the per-session switch and answer-style overrides (persistence file + slash command + session projection + per-agent tool visibility), contributes the OpenUI Lang generation prompt as a conditional system-prompt section (`tool:intelligent-ui`, order 3100), serves the global `globalEnabled` / `answerStyle` / `freeComposition` / `documentMode` / `exportBackground` / `exportScale` / `removeFollowUps` settings (the prompt reads the enable/style/composition values live; the browser also reads the image-export and page follow-up defaults), validates the model-provided `style` against the effective session style, registers the shipped Agent Skill when the deployment composes a skill service, and (when the deployment composes `webServer`) serves `lib/standalone.js` / `lib/standalone.css` on same-origin routes for interactive-page export. `@deepseek-ai/schemastery` is the one runtime dependency, used only for the Config schema the Host settings service reads.
- **Client** (`lib/client.js`, browser): registers a `conversation.chat.turnTail` card that renders every `render_ui` program recorded by the closing turn, the language-keyed `openui` layer of `conversation.chat.markdown.fence` that renders an ordinary answer's fenced programs inline at all times, independently of the session switch (while a fence streams its plain code block stays); the switch gates prompting/tools for new answers, not the display of already-written UI, a compact `render_ui` process row that keeps the raw program out of the tool list, the composer UI switch in `conversation.input.activity`, an export entry in `conversation.chat.assistant-actions` (only for messages whose closing Turn recorded `render_ui`; it saves the Turn's rendered cards as one PNG or one single-file interactive HTML page), and the deployment-wide configuration on the bundle's Plugins detail page in `plugins.bundle.config`. It also registers the extension's zh/en UI dictionaries with the client locale service (`ctx.locale.register('intelligent-ui', { zh, en })`) and declares `locale` on those slot registrations, so an in-app language switch re-renders all of its chrome. An ordinary render recorded while the experimental document mode is on carries `document: true`; the client renders that result as a chrome-less document section instead of a card (no header, collapse control, editing entry or revision history). The composer control opens built-in Auto/Card/Article preview cards, Custom styles with management, and a bottom On-demand UI entry. `conversation.input.overlay` shows an armed hint/examples/cancel; temporary result cards add a badge and adjust/save actions; the Plugin detail page adds global enablement, the global default style, and the export defaults (background color, 1x/2x, and whether images/pages remove the whole `@ToAssistant` follow-up block (on by default)).

The same package ships the Agent Skill in `skills/intelligent-ui/`. A deployment can use the tool without the skill; the skill is what makes an agent good at it.

## Current status

**Published stable:** `@zephinel/dsh-intelligent-ui@0.6.2` is on npm and the repository is public at `Zephinel/dsh-intelligent-ui`; that package has turn-tail cards, in-place editing with revision history, standalone pages, local images and style switching, but **no inline UI**. The four-form inline UI is new on `main` and unreleased on npm; install the GitHub bundle or a local checkout to use it. The next npm release will carry it. Prefer the npm or GitHub bundle install below; the local-checkout flow remains available for development.

## Requirements

- DSH **0.2.2** (validated on `0.2.2-rc.5`: Host/Client mount plus a natural-prompt real-GUI inline-rendering test; `0.2.2-rc.3` on the `next` channel has a community PTC check, while card editing/export were not systematically re-verified there), Node **24**. Inline UI fences additionally need the `conversation.chat.markdown.fence` client slot introduced in DSH 0.2.2-rc.2; on an older Host the `openui` fences stay plain code blocks.
- The **web** profile (or any profile whose app has a browser chat surface); the client half declares `"dsh": { "client": { "platform": "web" } }`.
- Interactive-page export additionally needs a `webServer` service so the Host can serve the standalone renderer assets; without it image export still works and page export reports a build failure.
- Style catalog and management require Host `webServer` plus `connection.requestRejection` authentication. On-demand uses the deployment's normal default conversation model services and session events; there is no extension-owned draft model endpoint, `llm` injection or `agentDefaultModel` injection. The structured clarification path additionally needs the built-in `ask_user_question` tool; a text fallback keeps the operation pending for the next message instead of requiring an immediate re-arm.
- The app composes the client locale service (`@deepseek-ai/dsh-client-locale`; DSH Web includes it by default). The browser half requires the `locale` service: without it the switch and the card do not mount, while the Host tool and prompt keep working. UI dictionaries live in `src/shared/locales.ts` (`zh` as the key-set source of truth, `en` checked complete); the renderer falls back to English outside DSH.
- Network access for the nice-to-haves: Wikipedia/Wikimedia (photo search), OpenFreeMap tiles and OSRM demo routing (Map). Offline, the page still renders with the fallbacks described below.
- Runtime dependency **`@deepseek-ai/schemastery`** (~3.18.5), installed with the package; the Host uses it only for the Plugin detail page Config schema.
- The package declares **no `engines.dsh` yet**; it was verified against `0.2.2-rc.5`. A later DSH may refuse it until a compatible release lands or an exact-version exemption is granted (below).

## Session switch and answer style

The extension costs ~10k prompt tokens, so access is opt-in. The deployment-wide defaults live on the Plugin detail page; the composer can override them for one session. A fresh install starts **off** globally, and session state survives refresh and DSH restarts.

- **Global defaults (Plugin detail page):** **Enable in all sessions**, the global **Auto / Card / Article** or saved-template style, the existing **Free-form layout** switch, and the experimental **Answer as a document (experimental)** (`documentMode`) switch. Inline UI needs no switch: it is part of the ordinary-answer policy.
- **Session overrides (composer UI chip):** **Off / This session only / Follow global** for enablement (Follow global inherits the global switch without changing it; the chip states whether the global switch is on or off); `/iui on|off|inherit`. Switching enablement scope never auto-opens the style panel; open **UI → Display style** from the menu for built-in preview cards, saved templates, On-demand UI, and **Follow global**; `/iui style auto|card|article|inherit|<cs_id>`.
- **Effective values:** session override first, then the global value; `inherit` follows the global value.
- **Answer style:** `Card` is a compact interactive page; `Article` is a reading layout inside the `render_ui` card (`Toc` + collapsible `Section` + long Markdown prose); `Auto` lets the model choose Card, Article or a free layout. The Host appends the effective style note to the generation prompt and rejects a `render_ui` style that conflicts with a forced Card/Article setting; in Auto it accepts `card`, `article` or `free`. The session style is a layout preference for a standalone page artifact and does not decide between inline UI and text; the model keeps explanations Markdown with inline fences, renders an explicit deliverable as a page, and on-demand generation still renders a card.
- **Persistence:** `<DSH_HOME>/dsh-intelligent-ui.json`, written atomically on every session change: `{ "sessions": [...], "offSessions": [...], "styles": { "<session-id>": "article" } }`. A legacy `{ "enabled": true }` or `{ "global": true, "sessions": [...] }` file is still read as migration state. Global values live in the Host settings document.
- **What off means for a session:** the `render_ui` schema is denied per agent through `agent.ctx.tools.restrict()`, the `tool:intelligent-ui` prompt section resolves to an empty string, and a stray call throws `render_ui is disabled for this session`.
- **Experimental document mode:** when `documentMode` is on, an ordinary answer (not an on-demand result or Artifact edit) must be rendered with `style: "free"` and the whole answer inside the program; the prompt omits the session style note, the Host overrides any selected saved template, and the success value/meta records `document: true`. The client then renders the result as a chrome-less document that reads as the turn's message text. It remains a turn-tail override: the content lives in the result, so message copy/search/transcript export omit it, and the document page has no editing entry or revision history. The switch only affects new answers; recorded results replay with their recorded presentation.
- **Inline UI in ordinary answers (default, no switch):** the ordinary-answer prompt tells the model to keep an explanation in Markdown and put each UI block in a fenced code block whose info string is exactly `openui`; a standalone deliverable (page, dashboard, tool, form, game or editable result) is the main case that calls `render_ui`. The client's `openui` fence layer renders a settled fence inline in the message (streaming keeps the code block; an invalid program keeps the renderer fallback note), injecting `@ToAssistant` and local-image resolution. There is no Host rejection of `render_ui`; the prompt owns the choice, an answer has at most one page card, and inline UI plus a card may coexist when their roles differ and the content is not duplicated. The content is part of the message Markdown, so copy/search/transcript export keep the source; no turn-tail result or `document` meta is recorded for inline UI.
- **What on means for a session:** the prompt section is injected with the effective style note; the model chooses inline UI for an explanation, a page artifact for an explicit deliverable, both when the answer has two distinct jobs, or text; a session style only names the layout when a standalone page renders.
- **Projection:** the `intelligent-ui` session projection folds the `command/run` + `command/done` pair (pending state) and projects `sessionEnable`, `sessionStyle`, `globalEnabled`, `globalStyle`, `enabled`, `style`, `pending`, nullable `onDemand`, and the optional capability bits `styleEdit`/`styleSwitch` (projection stateVersion 6). The composer control mirrors this projection and sends commands. It also publishes an optimistic view to other tabs over BroadcastChannel; when the host projection catches up, the projection becomes authoritative again.
- **Deployments without `sessionProjections` + `commands`:** no session controls and no persistence, so the extension keeps its legacy **always-on** behavior. DSH Web composes both services.

Use `/iui off` (session override) to stop paying the prompt cost for that session; use the Plugin detail page to change the deployment-wide default.

## UI language

The browser half follows DSH's UI language and needs no configuration:

- `src/shared/locales.ts` holds one flat dictionary per built-in locale (`zh` is the key-set source of truth, `en` is type-checked against it, `{name}` placeholders are interpolated at lookup). `src/client/index.tsx` registers both with `ctx.locale.register('intelligent-ui', { zh, en })`.
- All eleven slot registrations across nine slot names (`shell.overlay`, `conversation.user.text.node`, `conversation.chat.turnTail`, `conversation.chat.markdown.fence`, `conversation.chat.assistant-actions`, two `tool.call.toolview` rows for `render_ui` and `edit_ui_blocks`, `conversation.input.activity`, two `conversation.input.overlay` entries for `DraftDock` and `OnDemandHint`, and `plugins.bundle.config`) declare `locale: 'intelligent-ui'`, so the slot system hands each component the `t` seat; switching the language in Settings re-renders the composer chip, its menu, the card chrome, the Plugin detail page and the renderer's component chrome (map controls, copy button, timer, fallbacks) without a reload.
- The renderer library is also mounted outside DSH by the self-checks and standalone embeds, so `src/lib/render.tsx` accepts the seat as a prop, publishes it through React context, and falls back to English when none is given.
- Model-facing text is out of scope: the tool description, the generation prompt and the Agent Skill stay in English, and so do the `/iui` Host replies (DSH's locale service covers browser UI only). The plugin's display title and description come from `locale/en.json` / `locale/zh.json`, a separate `PluginLocalizedMeta` mechanism.

## Install as a bundle

The package declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, and that patch inserts the host row `id: intelligent-ui` with `name: '@zephinel/dsh-intelligent-ui'`. Installing the repository as a bundle installs the package into the profile and selects it in the profile's ordered layer list:

```sh
# main (inline UI, unreleased; needs the build toolchain)
dsh plugin --profile web add github:Zephinel/dsh-intelligent-ui
# npm 0.6.2 (stable, no inline fence)
dsh plugin --profile web add @zephinel/dsh-intelligent-ui@0.6.2
```

The npm package name is **`@zephinel/dsh-intelligent-ui`** (the unscoped `dsh-intelligent-ui` is owned by an unrelated project), published under the `@zephinel` npm scope.

DSH Desktop installs the same bundle from the app instead of the CLI: **Plugins** → **Add plugin** (or the arrow → **Install a third-party plugin**) → package name and version → **Install** → **Enable now**. The desktop profile is owned by the Electron app, so `dsh plugin --profile desktop` is rejected. If the **UI** control does not appear after enabling, quit and reopen Desktop. A mainland-China mirror can lag behind the official npm registry for a fresh release; switch the install source back to npm if the version is not found.

Packaging behavior that matters when publishing:

- The registry tarball ships the prebuilt `lib/` (host and client bundles plus standalone export assets), `cordis.patch.yml`, `skills/`, `locale/` (including display metadata JSONs and the `detail.*.md` guides the plugin page prefers over the README), `licenses/`, `assets/`, the two READMEs (`README.md` / `README.en.md`), `LICENSE`, `NOTICE` and `icon.svg` (71 files). The generated component spec and generation prompt are build inputs compiled into `lib/index.js`; `vendor/` and `src/` are not shipped.
- A Git checkout installs from source: pnpm runs the package's `prepare` build, so the install may ask for **build-script approval** and needs the toolchain. A registry tarball has nothing to build.
- Without `dsh.bundle`, the manager would install the package as a plain dependency with the warning `declares no dsh.bundle — installed as a plain dependency, not a profile layer`, and nothing would load. This package declares it, so that warning means the wrong spec or an old tarball.

If DSH refuses the package for version incompatibility, either install a compatible version or grant an exact-version exemption:

```sh
dsh plugin --profile web version-exemptions
dsh plugin --profile web allow-version @zephinel/dsh-intelligent-ui@0.6.2 --dsh-version 0.2.2-rc.5 --accept-risk
```

Remove it with the mirror command:

```sh
dsh plugin --profile web remove @zephinel/dsh-intelligent-ui
```

## Install from a local checkout

Prepare the checkout once:

```sh
npm install
npm run build              # lib/index.js (host) + lib/client.js (browser)
```

Then choose one of two equivalent installs:

**A. Manual patch row (fastest development loop).** `scripts/install.mjs` appends one managed block to `$DSH_HOME/profiles/<profile>/cordis.patch.yml` pointing at the checkout's absolute `lib/index.js`:

```sh
node scripts/install.mjs   # default profile: web; flags: --profile, --home, --dry-run
```

The managed block points at the absolute path, so moving the repository requires re-running the installer. Remove the block with `node scripts/install.mjs --uninstall`.

**B. Link the checkout as a bundle (exercises the real bundle path).** The root `cordis.patch.yml` is present, so the checkout can be installed as a profile bundle; run from the checkout root:

```sh
dsh plugin --profile web add link:$(pwd)    # or: file:$(pwd)
```

This writes the profile dependency and selects the bundle, keeping both pointed at the checkout. Rebuild (`npm run build`) after source changes; the host half reloads with the composed tree, the client half needs a page refresh.

## Activate and verify

Compose/restart after the install. The host half appears as soon as the composed tree reloads; the browser half is loaded lazily by the DSH module loader, so an already-open page may need a **refresh**, and a full restart if the plugin tree or boot graph changed:

```sh
dsh --profile web --dump-config | grep -n intelligent-ui   # the entry must be composed
# restart the process serving the Web UI (foreground `dsh web`: Ctrl+C and run it again;
# DSH Desktop: quit and reopen; launchd/systemd: restart the unit), then reopen the URL
```

Verification checklist (remember the switch is off by default):

0. **Switch present.** The composer shows the **UI** chip in `conversation.input.activity`; its menu offers **Off**, **This session only**, and **Follow global** (localized: 「关闭 / 仅本会话 / 跟随全局」 in a Chinese UI); Follow global shows the current global state under the row. Pick **This session only** (or run `/iui on`) before checking the tool and prompt; with the switch off, steps 1–2 are expected to *fail* by design. The Plugin detail page exposes the global enablement switch, the default Answer style and Free-form layout.
1. **Tool present while on.** With the switch admitting the session, it exposes `render_ui` with the argument schema `{ program: string, style: "card"|"article"|"free", title?: string, styleId?: string, temporaryStyle?: StyleSnapshot, editRequestId?: string }`. Authorized new on-demand generation requires free layout; adjustments preserve the registered parent layout. Both override session style guidance; otherwise the effective style is built-in or a visible saved template; Auto requires the model to pass the concrete style it chose (`card`, `article` or `free`), and any ordinary style may answer in Markdown when a page would add nothing. The model-facing description starts "Render an interactive page for the user." With the switch off (or scoped to another session), the request tool list must **not** contain `render_ui`.
2. **Prompt present while on.** With the switch on, the composed system prompt contains the OpenUI Lang section (order 3100) with the 57-component catalog and the effective style note; with the switch off the section resolves to an empty string.
3. **Card works.** Ask the model to render a trivial page, or let the skill lead it. The turn ends with a card titled by `title` (or the localized default "Interactive answer" / 「交互式回答」) containing the rendered UI; the process area shows one such row, not the raw program.
4. **Skill present.** When the profile composes the skill registry, the session catalog lists `intelligent-ui`; loading it returns the body of `skills/intelligent-ui/SKILL.md`. Without a skill service the tool still works and only the catalog entry is missing.

## Skill auto-registration

The host half (`lib/index.js`) registers the skill at runtime; it is **not** a filesystem-discovered "bundled skill":

- It reads `SKILL.md` from `skills/intelligent-ui/` **beside the built `lib/index.js`** (in the repo: `<checkout>/skills/intelligent-ui/`; in an installed package: `node_modules/@zephinel/dsh-intelligent-ui/skills/intelligent-ui/`).
- It parses the minimal frontmatter (`name`, `description`, optional `whenToUse`) and registers the body with `ctx.skills.register()`, model- and user-invocable, with the skill directory as the resource base. References resolve relative to that directory.
- Registration is wired through `ctx.inject(['skills'], …)`: it happens **only when the profile composes a skill service**. Without one, the tool, prompt and card work; the skill simply does not appear in the catalog.
- A missing or malformed `SKILL.md` logs a warning and the plugin keeps running; it never fails the host. Malformed means no frontmatter delimiters, or an empty name, description or body.

Filesystem discovery is only a **manual fallback** for an environment where the runtime registration is unavailable (for example a host without the skills service). Copy or symlink the whole `skills/intelligent-ui/` directory — the references must travel with `SKILL.md` — into one of the scanned roots (one level deep, highest priority first):

| Rank | Root | Path |
| --- | --- | --- |
| 1 | project DSH | `<project>/.dsh/skills/intelligent-ui/SKILL.md` |
| 2 | project agents | `<project>/.agents/skills/intelligent-ui/SKILL.md` |
| 3 | custom | any `customSkillDirs` entry |
| 4 | user DSH | `$DSH_HOME/skills/intelligent-ui/SKILL.md` |
| 5 | user agents | `~/.agents/skills/intelligent-ui/SKILL.md` |

`<project>` is the nearest ancestor containing `.git`. Do not copy only `SKILL.md`: the reference files are part of the skill.

## Tool contract

| Aspect | Contract |
| --- | --- |
| Name | `render_ui` |
| Arguments | `{ "program": string, "style": "card"|"article"|"free", "title"?: string, "styleId"?: string, "temporaryStyle"?: StyleSnapshot, "editRequestId"?: string }`, `required: ["program", "style"]`, `additionalProperties: false` |
| `program` | One complete OpenUI Lang program, statement per line, `root` first. Passed verbatim by the model; persisted as the tool call's arguments and replayed from history. |
| `title` | Optional short card label, e.g. "Day in San Francisco". When omitted the client uses the localized default ("Interactive answer" / 「交互式回答」). |
| `style` | `"card"`, `"article"` or `"free"`; required. Free is accepted with an authorized temporary snapshot, the exact styleId of the selected free template (without temporaryStyle), an Auto session that chose free (no styleId/temporaryStyle), or an ordinary answer rendered while the deployment enables document mode (then free is required and styleId/temporaryStyle are rejected); without Card compactness or mandatory Toc/Section. Pass the effective base layout from the prompt; a Host-authorized temporary snapshot overrides the selected style only for that result. In Auto pass the style you chose. |
| `styleId` | Exact selected custom template id; omit for built-in or temporary styles. Mutually exclusive with temporaryStyle. |
| `temporaryStyle` | Host-authorized schemaVersion 1 snapshot: baseLayout equals style (Host-enforced `free` for new generation; adjustments must match the registered parent snapshot layout, including legacy card/article), reusable directives, optional theme (omitted = inherit the session theme; when passed it must be complete and contrast-checked), optional suggestedName. A snapshot without a theme cannot become a style template. Missing or evicted parents reject adjustment with an error asking the user to cancel and start a new on-demand generation. Model arguments cannot authorize an operation. A pending natural-language style edit also exercises this snapshot path, but only with `editRequestId` and without `styleId`. |
| `editRequestId` | The pending Artifact edit request this call applies: required for a natural-language style edit (`kind: "style"` envelope) and used for order-only/global-only block requests. A style request is explicit-only and never auto-applies; a called style edit records `styleEdit: true`, the approved `temporaryStyle` and the recorded `title`, and the revision keeps the layout with no `styleId`/`editedBlockIds`. |
| Success value | `{ "statements": number, "style": "card"|"article"|"free", "styleSource"?: "builtin"|"template"|"temporary", "styleId"?: string, "document"?: boolean, "warnings"?: string[] }` — the parsed statement count, the resolved style recorded with the page, `document: true` for an ordinary answer recorded in document mode, and any non-fatal findings (`Unresolved reference: …`, `Unreferenced statement (will not render): …`). The result meta also records `style`/`styleSource` so a settled free layout replays without a style identity. |
| Model-visible result | `Interactive UI rendered for the user (<n> statements, <style> style).` plus ` Notes: <warnings joined by "; ">` when warnings exist. |
| Empty/failed validation | Throws `Error: render_ui: …`; the model sees the message as a tool error and is expected to fix and retry in the same turn. |
| Validation | `createParser(componentSpecSchema, "Col")` from `@openuidev/lang-core`; the spec is generated from `vendor/spec.json` at build time and compiled into `lib/index.js`. Fatal findings are parser errors, `incomplete: true`, and an unresolved root. Warnings never block rendering. |
| Rendering | Client-side only. The card is appended at the end of the turn that called the tool; multiple calls in one turn render multiple cards, but the tool guidance asks for one. A result recorded with `document: true` is rendered as a chrome-less document section (the message-body presentation of the experimental document mode) instead of a card. Inline UI creates no result: an `openui` fence in the assistant Markdown is rendered in place by `conversation.chat.markdown.fence` (no card chrome, no lineage); an explicit page deliverable still renders as a `render_ui` result. |
| Interaction | All `$` state, `@functions`, `@Set`/`@Reset`, charts, maps and SVG run in the browser with no model round trip. `@ToAssistant` seeds the composer draft with the message and submits it, starting a new turn. |
| Persistence | The program and any inline temporaryStyle are recorded in tool arguments; DOM is not persisted. Replay reads those arguments when available in the loaded history window. Temporary replay needs no catalog; saved-template colors resolve from the current catalog and may fall back if missing. |
| Trust boundary | `HtmlView` runs in a sandboxed iframe with an opaque origin. Its CSP allows inline code, a few script/style/font CDNs and https images; no other network. Programs cannot reach the chat DOM, cookies or storage. |

### `edit_ui_blocks` tool contract

| Block-edit aspect | Contract |
| --- | --- |
| Tool name | `edit_ui_blocks` (gated by the same session enablement switch as `render_ui`; also uses the compact `RenderUiRow` process row in `tool.call.toolview`) |
| Parameters | `{ "program": string, "requestId"?: string, "artifactId"?: string }`, `required: ["program"]`, `additionalProperties: false` |
| Fragment `program` | A mini OpenUI Lang program `root = Col([...])` holding only the edited target blocks' expressions (and any requested `additions`) in request order, plus new helper statements. The Host splices those expressions into the unchanged base page and records a new revision. |
| Output | `{ "statements": number, "style": "card"|"article"|"free", "styleId"?: string, "temporaryStyle"?: StyleSnapshot, "title"?: string, "warnings"?: string[] }`; the full composed program travels in the recorded result meta. |
| Model-visible summary | `Interactive UI updated for the user (revision N of the artifact, K blocks edited).` |

## Style and operation contracts

| Surface | Current contract |
| --- | --- |
| Catalog | `GET /api/intelligent-ui/styles?sessionId=<id>` → `{ templates }` visible globally or in that session. Requires webServer + connection authentication. |
| Save from result | `POST /api/intelligent-ui/styles`, `{ op: "saveFromResult", resultId, name, description?, scope: "global"|"session", sessionId? }` → 201 `{ template }`. Host copies baseLayout/directives/theme exactly from the validated snapshot, including free. A snapshot without a theme answers 400 `no_theme`: a template needs its own palette, so the UI hides Save for those results. All results reject a client `baseLayout` field; the dialog only asks for name/description/scope. Free templates keep the DSH card header with no Card/Article shell or required Toc/Section, and use styleId without temporaryStyle or temporary actions. The result snapshot stays unchanged; no theme/directives/revisionId accepted. Session scope requires the owning sessionId. No automatic selection/default write or model call. Duplicate names fail; no server idempotency key. |
| Save | Same POST with `{ op: "save", template: { name, description?, baseLayout, directives, theme }, scope, sessionId? }`. Validated persistence API, not a model creation workflow. |
| Update | Same POST with `{ op: "update", id, patch: { name?, description?, directives? } }`; only these fields may change; returns `{ template }`. |
| Delete | Same POST with `{ op: "delete", id }` → `{ deleted: id }`; missing template returns 404. |
| Route limits | Auth checked first; GET/POST only, application/json, 64 KiB maximum body, 15-second read timeout, no-store. No draft/LLM interview routes. |
| Stores | `<DSH_HOME>/dsh-intelligent-ui-styles.json`: version 1 with card/article/free baseLayout (no migration); 40 global/20 per-session templates. `dsh-intelligent-ui-results.json`: latest 200 immutable temporary result snapshots with resultId (= callId), sessionId, optional parentResultId and createdAt. Evicted results return `result_missing` when saved and reject adjustment; historical tool arguments still replay. |
| Operation | `/iui on-demand [off|<client-instance-token> [adjust <resultId>]]`; one active operation per session, armed TTL 10 minutes, up to two clarification rounds. While armed, re-arm replaces; once bound (running/clarifying), re-arm is rejected and needs an explicit cancel. A completed turn that produced no render returns to armed with `resume: true`; the hint stays and the next human message continues the same operation. In-memory states: armed/running/clarifying/completed/failed/cancelled/interrupted. Restart clears operation views; re-arm to continue. |
| Event binding | Live session/event binds the next human message; ignores injected context, deduplicates seq and constrains tool events by turn. The prompt note is injected while armed because DSH appends the system prompt before the first user/message; it requires content grounding (never fabricate missing data) and, for missing text/link content, a free-form question with no options. Presentation follows the user request; if materially unclear, ask a focused layout question rather than silently defaulting. New generation passes style/baseLayout free. A bound on-demand turn rejects a plain render without temporaryStyle. Observed callId + bound operation authorize temporaryStyle. Structured ask_user_question answers resume the operation; pending questions block render. A text-only completed turn re-arms with `resume` and keeps the composer hint until a result renders or the user cancels. Failed/interrupted operations keep a retry/dismiss hint instead of vanishing. Client token limits hint visibility, not the source of the next session message. |
| Theme boundary | Controlled theme variables apply to the renderer host; portaled popovers and sandboxed iframes retain default theme. Export freezes the resolved per-card theme/scheme: snapshot theme first, then the saved or session-selected template theme (theme-less temporary snapshots included), then the built-in theme. |
| Prompt boundary | Saved-template directives are JSON-quoted bounded display preferences subordinate to system/tool/safety rules. Temporary directives stay result data. Models may render authorized snapshots; saving/management belongs to explicit user actions. |

## Troubleshooting a missing `render_ui`

Work top-down; each step rules out one layer:

1. **Switch state (start here).** The extension is off by default. Check the composer **UI** control (Off / This session only / Follow global; Chinese UI: 「关闭 / 仅本会话 / 跟随全局」) or run `/iui` to print the current state; if the control is missing, the profile lacks `sessionProjections`/`commands` or the browser half did not load. A tool error reading `render_ui is disabled for this session` means the switch does not admit this session (wrong scope, or a command that has not settled) — pick “this session only” and retry.
2. **Right profile.** Installed into `web` but the session runs under another profile (`headless`, `sdk`, custom) → install there too.
3. **Composed tree.** `dsh --profile web --dump-config` does not mention `intelligent-ui` → the bundle is not selected or the checkout is not linked. Re-add it (`dsh plugin --profile web add link:$(pwd)` from the checkout, or `node scripts/install.mjs`), then restart.
4. **Built artifacts.** For a checkout: `lib/index.js` and `lib/client.js` exist and are newer than `src/`. If not, `npm run build`.
5. **Build-script approval / source install.** A Git or linked checkout installs from source and may be waiting on pnpm build-script approval; approve the scripts in the profile, then retry.
6. **Package compatibility.** The install was refused for an unmet DSH requirement → use a compatible version or grant an exemption. The package declares no `engines.dsh` yet, so the reverse case (a future DSH refusing it) is possible too.
7. **Restart vs refresh.** Host tools usually appear after the patch reload; an open browser page may still show the old client. Refresh the page; if the tool is still missing, restart the web app.
8. **Tool hidden or shadowed.** Another plugin may register a same-name tool or a restriction may hide it. Check the session's tool list; remove the conflict.
9. **Skill but no tool.** If `intelligent-ui` is in the catalog but `render_ui` is not, the skill was registered by a host that then failed to expose the tool — inspect the app boot logs for the plugin import error (missing dependency, wrong `main` path).
10. **Tool but no skill.** The profile composes no skills service, so the runtime registration is skipped. That is expected; the tool still works. Add a skill service, or use the filesystem fallback above.
11. **Card area empty after a successful call.** A successful tool result with `statements > 0` always has a program; if the card is absent, the client half did not load. Refresh first, then restart, then check the browser console for module-loader errors.

## Known limits

- The **page card** appears at the end of the turn (turn-tail); an `openui` fence renders inline in the message. During card generation the process row reads the localized "Interactive answer" (「交互式回答」 in a Chinese UI).
- Model-authored programs occasionally fail validation; the host returns exact errors and the model is expected to self-repair in the same turn. Repeated failures are a prompt/model issue, not a host issue.
- The generation prompt is about 10K tokens and is sent **only for a session the switch admits**; otherwise the prompt section is empty and the tool schema is hidden. Prompt caching absorbs most of the cost while on.
- Photos, map tiles and routing are third-party services with offline fallbacks (see [troubleshooting.md](troubleshooting.md#runtime-fallbacks-valid-program-degraded-media)).
- `Math` relies on the host's global KaTeX styles; if a future DSH shell drops them, formulas degrade to text.
- This extension is web-only: profiles without a browser surface register the tool but have no card to render into.
- The browser half requires the client locale service (`dsh-client-locale`); a minimal custom profile without it will not mount the switch or the card, while the Host tool and prompt keep working.
- Interactive pages are self-contained but large (about 3.4–4.9 MB) and keep only the exporting theme; non-free cards keep the 760px measure and the live 12px card gap, free results use the full page width, and their photos, maps and routing still use the same third-party services as inside DSH.
- **Image export follows the live cards, not the whole page.** Portaled overlays — an open `Popover` panel and `Celebration` confetti live on `<body>` — are visible on screen but absent from the saved PNG; everything inside the card, including an expanded `Map` dialog, is captured.
- The `/iui` Host replies and the command palette's command description stay English even in a Chinese UI; both are DSH platform behavior, and the command palette localizes only first-party commands by identity.
- The package is published on npm as `@zephinel/dsh-intelligent-ui@0.6.2`; pin a version for reproducibility. Publishing a new version needs a version bump plus the packaging checks in `test/packaging/`.
