# Integration and deployment

dsh-intelligent-ui is a DSH bundle with two halves:

- **Host** (`lib/index.js`, Node): registers the `render_ui` tool, validates programs with `@openuidev/lang-core` against the generated component spec compiled into the bundle, owns the per-session switch and answer-style overrides (persistence file + slash command + session projection + per-agent tool visibility), contributes the OpenUI Lang generation prompt as a conditional system-prompt section (`tool:intelligent-ui`, order 3100), serves the global `globalEnabled` / `answerStyle` / `freeComposition` / `exportBackground` / `exportScale` / `removeFollowUps` settings (the prompt reads the enable/style/composition values live; the browser also reads the image-export and page follow-up defaults), validates the model-provided `style` against the effective session style, registers the shipped Agent Skill when the deployment composes a skill service, and (when the deployment composes `webServer`) serves `lib/standalone.js` / `lib/standalone.css` on same-origin routes for interactive-page export. `@deepseek-ai/schemastery` is the one runtime dependency, used only for the Config schema the Host settings service reads.
- **Client** (`lib/client.js`, browser): registers a `conversation.chat.turnTail` card that renders every `render_ui` program recorded by the closing turn, a compact `render_ui` process row that keeps the raw program out of the tool list, the composer UI switch in `conversation.input.activity`, an export entry in `conversation.chat.assistant-actions` (only for messages whose closing Turn recorded `render_ui`; it saves the Turn's rendered cards as one PNG or one single-file interactive HTML page), and the deployment-wide configuration on the bundle's Plugins detail page in `plugins.bundle.config`. It also registers the extension's zh/en UI dictionaries with the client locale service (`ctx.locale.register('intelligent-ui', { zh, en })`) and declares `locale` on those slot registrations, so an in-app language switch re-renders all of its chrome. The composer control opens a style panel with Card/Article previews and the Auto/Card/Article slider; the Plugin detail page adds global enablement, the global default style, and the export defaults (background color, 1x/2x, and whether images/pages remove the whole `@ToAssistant` follow-up block (on by default)).

The same package ships the Agent Skill in `skills/intelligent-ui/`. A deployment can use the tool without the skill; the skill is what makes an agent good at it.

## Current status

**Published.** `@zephinel/dsh-intelligent-ui@0.2.2-26-10-21` is on npm and the repository is public at `Zephinel/dsh-intelligent-ui`. Prefer the npm or GitHub bundle install below; the local-checkout flow remains available for development.

## Requirements

- DSH **0.2.1** (validated on `0.2.1-rc.2`), Node **24**.
- The **web** profile (or any profile whose app has a browser chat surface); the client half declares `"dsh": { "client": { "platform": "web" } }`.
- Interactive-page export additionally needs a `webServer` service so the Host can serve the standalone renderer assets; without it image export still works and page export reports a build failure.
- The app composes the client locale service (`@deepseek-ai/dsh-client-locale`; DSH Web includes it by default). The browser half requires the `locale` service: without it the switch and the card do not mount, while the Host tool and prompt keep working. UI dictionaries live in `src/shared/locales.ts` (`zh` as the key-set source of truth, `en` checked complete); the renderer falls back to English outside DSH.
- Network access for the nice-to-haves: Wikipedia/Wikimedia (photo search), OpenFreeMap tiles and OSRM demo routing (Map). Offline, the page still renders with the fallbacks described below.
- Runtime dependency **`@deepseek-ai/schemastery`** (~3.18.5), installed with the package; the Host uses it only for the Plugin detail page Config schema.
- The package declares **no `engines.dsh` yet**; it was verified against `0.2.1-rc.2`. A later DSH may refuse it until a compatible release lands or an exact-version exemption is granted (below).

## Session switch and answer style

The extension costs ~9.5k prompt tokens, so access is opt-in. The deployment-wide defaults live on the Plugin detail page; the composer can override them for one session. A fresh install starts **off** globally, and session state survives refresh and DSH restarts.

- **Global defaults (Plugin detail page):** **Enable in all sessions**, the global **Auto / Card / Article** style, and the existing **Free-form layout** switch.
- **Session overrides (composer UI chip):** **Off / This session only / Follow global** for enablement; `/iui on|off|inherit`. The **This session only** entry opens a style panel: two previews, an Auto/Card/Article slider, and **Follow global**; `/iui style auto|card|article|inherit`.
- **Effective values:** session override first, then the global value; `inherit` follows the global value.
- **Answer style:** `Card` is a compact interactive page; `Article` is a reading layout inside the `render_ui` card (`Toc` + collapsible `Section` + long Markdown prose); `Auto` lets the model choose. The Host appends the effective style to the generation prompt and rejects a `render_ui` style that conflicts with a forced Card/Article setting.
- **Persistence:** `<DSH_HOME>/dsh-intelligent-ui.json`, written atomically on every session change: `{ "sessions": [...], "offSessions": [...], "styles": { "<session-id>": "article" } }`. A legacy `{ "enabled": true }` or `{ "global": true, "sessions": [...] }` file is still read as migration state. Global values live in the Host settings document.
- **What off means for a session:** the `render_ui` schema is denied per agent through `agent.ctx.tools.restrict()`, the `tool:intelligent-ui` prompt section resolves to an empty string, and a stray call throws `render_ui is disabled for this session`.
- **What on means for a session:** the prompt section is injected with the effective style note; structured answers use `render_ui`, and the bounded prose exception still applies (single fact, explicit text request, non-visual content, two failed calls).
- **Projection:** the `intelligent-ui` session projection folds the `command/run` + `command/done` pair (pending state) and projects `sessionEnable`, `sessionStyle`, `globalEnabled`, `globalStyle`, `enabled`, `style` and `pending`. The composer control mirrors this projection and sends commands. It also publishes an optimistic view to other tabs over BroadcastChannel; when the host projection catches up, the projection becomes authoritative again.
- **Deployments without `sessionProjections` + `commands`:** no session controls and no persistence, so the extension keeps its legacy **always-on** behavior. DSH Web composes both services.

Use `/iui off` (session override) to stop paying the prompt cost for that session; use the Plugin detail page to change the deployment-wide default.

## UI language

The browser half follows DSH's UI language and needs no configuration:

- `src/shared/locales.ts` holds one flat dictionary per built-in locale (`zh` is the key-set source of truth, `en` is type-checked against it, `{name}` placeholders are interpolated at lookup). `src/client/index.tsx` registers both with `ctx.locale.register('intelligent-ui', { zh, en })`.
- All four slot registrations declare `locale: 'intelligent-ui'`, so the slot system hands each component the `t` seat; switching the language in Settings re-renders the composer chip, its menu, the card chrome, the Plugin detail page and the renderer's component chrome (map controls, copy button, timer, fallbacks) without a reload.
- The renderer library is also mounted outside DSH by the self-checks and standalone embeds, so `src/lib/render.tsx` accepts the seat as a prop, publishes it through React context, and falls back to English when none is given.
- Model-facing text is out of scope: the tool description, the generation prompt and the Agent Skill stay in English, and so do the `/iui` Host replies (DSH's locale service covers browser UI only). The plugin's display title and description come from `locale/en.json` / `locale/zh.json`, a separate `PluginLocalizedMeta` mechanism.

## Install as a bundle

The package declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, and that patch inserts the host row `id: intelligent-ui` with `name: '@zephinel/dsh-intelligent-ui'`. Installing the repository as a bundle installs the package into the profile and selects it in the profile's ordered layer list:

```sh
# npm (current latest: 0.2.2-26-10-21)
dsh plugin --profile web add @zephinel/dsh-intelligent-ui
dsh plugin --profile web add @zephinel/dsh-intelligent-ui@0.2.2-26-10-21   # pin a version
# or GitHub
dsh plugin --profile web add github:Zephinel/dsh-intelligent-ui
```

The npm package name is **`@zephinel/dsh-intelligent-ui`** (the unscoped `dsh-intelligent-ui` is owned by an unrelated project), published under the `@zephinel` npm scope.

DSH Desktop installs the same bundle from the app instead of the CLI: **Plugins** → **Add plugin** (or the arrow → **Install a third-party plugin**) → package name and version → **Install** → **Enable now**. The desktop profile is owned by the Electron app, so `dsh plugin --profile desktop` is rejected. If the **UI** control does not appear after enabling, quit and reopen Desktop. A mainland-China mirror can lag behind the official npm registry for a fresh release; switch the install source back to npm if the version is not found.

Packaging behavior that matters when publishing:

- The registry tarball ships the prebuilt `lib/` (host and client bundles), `cordis.patch.yml`, `skills/`, `locale/`, `licenses/`, `assets/`, the two READMEs (`README.md` / `README.en.md`), `LICENSE`, `NOTICE` and `icon.svg` (36 files). The generated component spec and generation prompt are build inputs compiled into `lib/index.js`; `vendor/` and `src/` are not shipped.
- A Git checkout installs from source: pnpm runs the package's `prepare` build, so the install may ask for **build-script approval** and needs the toolchain. A registry tarball has nothing to build.
- Without `dsh.bundle`, the manager would install the package as a plain dependency with the warning `declares no dsh.bundle — installed as a plain dependency, not a profile layer`, and nothing would load. This package declares it, so that warning means the wrong spec or an old tarball.

If DSH refuses the package for version incompatibility, either install a compatible version or grant an exact-version exemption:

```sh
dsh plugin --profile web version-exemptions
dsh plugin --profile web allow-version @zephinel/dsh-intelligent-ui@0.2.2-26-10-21 --dsh-version 0.2.1-rc.2 --accept-risk
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
# restart the process serving the Web UI (foreground `dsh web`: Ctrl+C and run it again;\n# DSH Desktop: quit and reopen; launchd/systemd: restart the unit), then reopen the URL
```

Verification checklist (remember the switch is off by default):

0. **Switch present.** The composer shows the **UI** chip in `conversation.input.activity`; its menu offers **Off**, **This session only**, and **Follow global** (localized: 「关闭 / 仅本会话 / 跟随全局」 in a Chinese UI). Pick **This session only** (or run `/iui on`) before checking the tool and prompt; with the switch off, steps 1–2 are expected to *fail* by design. The Plugin detail page exposes the global enablement switch, the default Answer style and Free-form layout.
1. **Tool present while on.** With the switch admitting the session, it exposes `render_ui` with the argument schema `{ program: string, style: "card"|"article", title?: string }`. The session's effective style is Auto, Card or Article; Auto requires the model to pass the concrete card/article style it chose. The model-facing description starts "Render an interactive answer as UI in the chat". With the switch off (or scoped to another session), the request tool list must **not** contain `render_ui`.
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
| Arguments | `{ "program": string, "title"?: string }`, `additionalProperties: false` |
| `program` | One complete OpenUI Lang program, statement per line, `root` first. Passed verbatim by the model; persisted as the tool call's arguments and replayed from history. |
| `title` | Optional short card label, e.g. "Day in San Francisco". When omitted the client uses the localized default ("Interactive answer" / 「交互式回答」). |
| Success value | `{ "statements": number, "warnings"?: string[] }` — the parsed statement count and any non-fatal findings (`Unresolved reference: …`, `Unreferenced statement (will not render): …`). |
| Model-visible result | `Interactive UI rendered for the user (<n> statements).` plus ` Parser notes: <warnings joined by "; ">` when warnings exist. |
| Empty/failed validation | Throws `Error: render_ui: …`; the model sees the message as a tool error and is expected to fix and retry in the same turn. |
| Validation | `createParser(componentSpecSchema, "Col")` from `@openuidev/lang-core`; the spec is generated from `vendor/spec.json` at build time and compiled into `lib/index.js`. Fatal findings are parser errors, `incomplete: true`, and an unresolved root. Warnings never block rendering. |
| Rendering | Client-side only. The card is appended at the end of the turn that called the tool; multiple calls in one turn render multiple cards, but the tool guidance asks for one. |
| Interaction | All `$` state, `@functions`, `@Set`/`@Reset`, charts, maps and SVG run in the browser with no model round trip. `@ToAssistant` seeds the composer draft with the message and submits it, starting a new turn. |
| Persistence | The program string is stored in the session event log as tool arguments; the rendered result is not. A resumed session re-renders from the program. |
| Trust boundary | `HtmlView` runs in a sandboxed iframe with an opaque origin. Its CSP allows inline code, a few script/style/font CDNs and https images; no other network. Programs cannot reach the chat DOM, cookies or storage. |

## Troubleshooting a missing `render_ui`

Work top-down; each step rules out one layer:

1. **Switch state (start here).** The extension is off by default. Check the composer **UI** control (Off / This session / Follow global; Chinese UI: 「关闭 / 仅本会话 / 跟随全局」) or run `/iui` to print the current state; if the control is missing, the profile lacks `sessionProjections`/`commands` or the browser half did not load. A tool error reading `render_ui is disabled for this session` means the switch does not admit this session (wrong scope, or a command that has not settled) — pick “this session only” and retry.
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

- The card appears at the **end of the turn** (turn-tail), never inline mid-answer; during generation the process row reads the localized "Interactive answer" (「交互式回答」 in a Chinese UI).
- Model-authored programs occasionally fail validation; the host returns exact errors and the model is expected to self-repair in the same turn. Repeated failures are a prompt/model issue, not a host issue.
- The generation prompt is about 9.5K tokens and is sent **only for a session the switch admits**; otherwise the prompt section is empty and the tool schema is hidden. Prompt caching absorbs most of the cost while on.
- Photos, map tiles and routing are third-party services with offline fallbacks (see [troubleshooting.md](troubleshooting.md#runtime-fallbacks-valid-program-degraded-media)).
- `Math` relies on the host's global KaTeX styles; if a future DSH shell drops them, formulas degrade to text.
- This extension is web-only: profiles without a browser surface register the tool but have no card to render into.
- The browser half requires the client locale service (`dsh-client-locale`); a minimal custom profile without it will not mount the switch or the card, while the Host tool and prompt keep working.
- Interactive pages are self-contained but large (about 3.4–4.9 MB) and keep only the exporting theme; their photos, maps and routing still use the same third-party services as inside DSH.
- The `/iui` Host replies and the command palette's command description stay English even in a Chinese UI; both are DSH platform behavior, and the command palette localizes only first-party commands by identity.
- The package is published on npm as `@zephinel/dsh-intelligent-ui@0.2.2-26-10-21`; pin a version for reproducibility. Publishing a new version needs a version bump plus the packaging checks in `test/packaging/`.
