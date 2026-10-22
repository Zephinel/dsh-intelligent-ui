# Development and deployment

[中文](development.md) | English

[← Back to README](../README.en.md)

This page expands the installation and development details summarised in the README.

## Installation

Requires DSH 0.2.1 (the `dsh` CLI) and Node 24. The browser half additionally requires a deployment that composes `@deepseek-ai/dsh-client-locale` (included by default in DSH Web 0.2.1; without it the switch and card do not mount, while the Host tool and prompt keep working).

Install the bundle from npm or GitHub (recommended):

```bash
# npm; current latest is 0.2.2-26-10-21
dsh plugin --profile web add @zephinel/dsh-intelligent-ui
# pin the version
dsh plugin --profile web add @zephinel/dsh-intelligent-ui@0.2.2-26-10-21
# or install from GitHub
dsh plugin --profile web add github:Zephinel/dsh-intelligent-ui
# Restart the DSH process that serves the Web UI (foreground `dsh web`: Ctrl+C, then run it again;
# DSH Desktop: quit and reopen the app; systemd/launchd: restart the corresponding service)
```

> The npm package name is **`@zephinel/dsh-intelligent-ui`**: the unscoped `dsh-intelligent-ui` is taken by another, unrelated project, so the package uses the `@zephinel` scope. GitHub installs are unaffected.

On the Web side you can also install and enable it from the **Plugins** page. DSH Desktop installs the same bundle inside the app: **Plugins** in the sidebar → **Add plugin** (or the arrow → **Install a third-party plugin**) → enter the package name and version → **Install** → **Enable now**. The desktop profile is owned by the Electron app, so `dsh plugin --profile desktop` is rejected; if the **UI** control does not appear after enabling, quit and reopen Desktop. A mainland-China mirror can lag behind the official npm registry for a fresh release; switch the install source back to npm if the version is not found. With a bundle install the skill appears automatically along with the Host plugin and needs no separate installation.

### Local checkout (development)

When changing the extension itself, install from a local checkout; the commands are in [README Quick start](../README.en.md#quick-start): the script writes `$DSH_HOME/profiles/web/cordis.patch.yml` (automatic backup), and the page disconnects after the restart; reopen it with the newly printed URL. To uninstall:

```bash
node scripts/install.mjs --uninstall   # then restart the DSH Web process the same way
```

> On 0.2.1-rc.2, the host rebuilds the plugin tree after the patch file changes (Host tools appear immediately), but the browser-side plugin may stay on the old revision: **refreshing the page** usually fixes it; if it is still broken, restart.

## Development

```bash
npm run build          # full build of prompt + host + client
npm run build:client   # rebuild the browser bundle only
npm run build:host     # rebuild the Host only
npm run check          # build + Host/Client/packaging tests + renderer checks
npm run pack:check     # npm pack --dry-run, checks the final published file list
npm run test:browser   # optional real-browser E2E (style panel + image export + interactive page + Article spacing + color picker; Chrome required)
```

- `scripts/build.mjs`: bundles the Host into an ESM with Node built-ins and `@deepseek-ai/schemastery` external (the latter backs the Plugin detail page Config schema); the Client becomes a CJS body plus a `window.__ModuleLoader__.load({ id, factory })` shell, with React/Cordis/DSH client platform packages injected by the loader, third-party libraries bundled privately, and CSS collected into a string that is injected when the plugin loads. It also builds the standalone page entry into `lib/standalone.js` / `lib/standalone.css` (KaTeX fonts inlined) for the interactive-page export.
- `scripts/generate-prompt.mjs`: rewrites the OpenUI Lang prompt generated upstream into a version that is invoked "through the render_ui tool", and owns the decision policy (enabled sessions default to a page, prose is a bounded exception, explicit invocation is a directive) plus the layout/spacing contract (the renderer owns the page rhythm; the model does not add root gaps or manual blank blocks); rebuild after editing.
- `scripts/install.mjs`: profile install/uninstall for a local checkout (writes a marked patch block, with automatic backup).
- `src/lib/**`: the port of the upstream component library and 59 library `@functions`; `src/lib/render.tsx` is the DSH wrapper (theme isolation, error boundary, `@ToAssistant` backfill), and `src/lib/i18n.tsx` gives renderer components their `t` seat plus the English fallback.
- `src/client/**`: DSH Slot registrations (the composer UI switch, the Plugin detail page `plugins.bundle.config` and the export entry in the message action strip), the turn-tail card, the `render_ui` process line, the program extractor, export message/Turn lookup, the image-export pipeline (SnapDOM plus frame composition), interactive-page assembly (asset fetch + theme snapshot + inline HTML), and the `ctx.locale` dictionary registration.
- `src/standalone/**`: the standalone page entry and chrome (card title/collapse, `@ToAssistant` copy fallback, theme styles); `npm run build` emits `lib/standalone.*`, and the Host serves them on same-origin routes for the export flow.
- `src/shared/**`: Host/Client protocol constants (`intelligent-ui.ts`) and the bilingual UI dictionaries (`locales.ts`).
- `src/host/**`: tool registration, program validation, the system prompt section, the settings Config (`globalEnabled` / `answerStyle` / `freeComposition` / `exportBackground` / `exportScale` / `removeFollowUps`), embedded skill registration, and (when `webServer` is available) the same-origin routes serving the interactive-page assets; `mode.ts` implements the global defaults + session overrides for the switch and style (persistence file, commands, projection, per-agent tool visibility).
- `skills/intelligent-ui/**`: the Agent Skill shipped with the package.
- `vendor/`: upstream source (components/functions/generated artifacts) and licenses.

## Development tip: restart the Web service after renaming or rebuilding the client

The browser-side plugin module uses **`package.json`'s `name` as its `__ModuleLoader__` registration id**, while a running DSH Web host caches the client module graph and bundle snapshot by revision. While the service is running:

- you rename the package (for example switching between `dsh-intelligent-ui` / `@zephinel/dsh-intelligent-ui`), or
- you rebuild `lib/client.js` or `lib/standalone.*` (`npm run build` / the `prepare` hook of `npm pack` also rebuilds it; the Host routes cache assets per process)

afterwards **a page refresh alone may fetch the old revision**, and the page shows:

```
Failed to load plugins
… import failed: client-modules: … already executed without registering "<package name>";
… loaded without registering "<package name>" via __ModuleLoader__.load
```

The meaning is: the id actually registered by the loaded bundle does not match the row id in the browser's boot graph (the typical cause is the rename/rebuild above). In that case **restart the DSH process that serves the Web UI once** (for a foreground `dsh web`, press Ctrl+C and start it again; under launchd/systemd, restart the service; for DSH Desktop, quit and reopen) so the host recomputes the graph; a plain refresh does not fix it. The same applies after release when users upgrade the plugin or change configuration: refresh first, and restart only if the error persists.

The packaging test in `npm run check` verifies that the registration id in `lib/client.js` matches `name` in `package.json`, preventing the published artifact and the package name from drifting apart.

### Host/Client version mismatch (common during development)

The Host half loads only at **process start**; the browser half is re-fetched from the current `lib/client.js` by the module loader on **page refresh**. So refreshing without restarting can produce "new control + old Host":

- the new control sends `/iui on|off|inherit` or `/iui style …`, while the old Host only understands `on|off`, so a red `Usage: …` appears in the command line (the rendering of a command with `kind: 'error'`, not a crash);
- the old Host's success messages are also the old ones (for example "already off for this session").

When you see this mixed state, first **restart the DSH process that serves the Web UI** (then refresh the page) so both halves switch to the current build; `/iui on` then returns the normal success message. The same applies to plugin upgrades after release: after a bundle update the host must be restarted, not merely refreshed.

## Layout (release-related)

| Path | Purpose |
|---|---|
| `lib/index.js` / `lib/client.js` / `lib/standalone.js` / `lib/standalone.css` | build artifacts published to npm; the last two are the standalone renderer assets for interactive-page export |
| `cordis.patch.yml` | DSH bundle patch (inserts the `intelligent-ui` row) |
| `.github/workflows/publish.yml` | tag-triggered release workflow (Trusted Publishing / OIDC + provenance); not shipped in the npm package |
| `locale/en.json` / `locale/zh.json` | display name and description for the plugin marketplace/plugin detail page |
| `src/shared/locales.ts` | bilingual UI dictionaries (`ctx.locale` registration and the renderer's English fallback) |
| `README.md` / `README.en.md` | Chinese / English docs, linked to each other at the top |
| `docs/` | detailed docs (architecture, development, verification); not shipped in the npm package |
| `CHANGELOG.md` | release changelog (English, historical, append-only); not shipped in the npm package |
| `assets/` | README screenshots: itinerary, three component tours, dashboard and quiz examples, narrow screen, the composer switch/style panel and the plugin settings page (WebP + PNG) |
| `icon.svg` | plugin card icon |
| `skills/intelligent-ui/` | the embedded Agent Skill that also ships with the package |
| `licenses/` | full text of third-party licenses (Open Intelligent UI, OpenUI, lucide, KaTeX, MapLibre, zod, SnapDOM, React) |
| `LICENSE` / `NOTICE` | this project's MIT license and third-party attribution notices |

## Releasing (Trusted Publishing)

Releases run in GitHub Actions; no npm token is stored in the repository or CI.

**One-time setup** (package owner, requires npm account 2FA) — either:

```bash
npm login
npm trust github @zephinel/dsh-intelligent-ui --file publish.yml \
  --repo Zephinel/dsh-intelligent-ui --allow-publish --yes
```

or npmjs.com → the package → Settings → Trusted Publishing → GitHub Actions, with repository `Zephinel/dsh-intelligent-ui` and workflow `publish.yml`.

**Publishing a version**:

1. Update the version in `package.json` / `package-lock.json`, `CHANGELOG.md`, the README status and version pins, and the matching docs;
2. run `npm run check`;
3. commit and push `main`;
4. create and push a tag that matches the version:

```bash
git tag v0.2.2-26-10-21
git push origin main --follow-tags
```

`.github/workflows/publish.yml` rejects a tag that does not match `package.json`, runs `npm run check`, then publishes with OIDC + `--provenance`; no `NODE_AUTH_TOKEN` is needed. Verify afterwards with `npm view @zephinel/dsh-intelligent-ui version dist-tags`.

> The old direct-publish granular token flow is removed in January 2027; this pipeline does not depend on a long-lived token.
