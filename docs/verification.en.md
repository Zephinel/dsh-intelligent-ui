# Verification record

[中文](verification.md) | English

[← Back to README](../README.en.md)

This is a historical verification record; test counts and packaging sizes are refreshed from the latest `npm run check` / `npm pack` output.

End-to-end verification was performed on a second, isolated DSH Web instance (port 3081, same profile + patch overlay):

- The model calls `render_ui` as instructed by the prompt and generates pages of 31–117 statements; invalid programs are rejected by the Host with precise field errors, and the model repairs them within the same turn.
- The component overview page, the San Francisco itinerary, the coffee calculator and the SVG origami tutorial all render correctly; photos (Wikipedia/Wikimedia), MapLibre maps + pins, charts, forms, timers, flip cards, confetti and HtmlView animations work.
- Interaction: checking timeline items updates counts, the SegmentedControl stays in sync, and form and button states behave; the dark theme switches automatically.
- Responsive: no horizontal overflow at 390 / 546 / 768 / 1092 px (the scoped `box-sizing` reset the component library relies on was added).
- Tests (live subclaims): the current 0.5.0 release evidence is the 0.5.0 release record appended at the end (Node **247/247**; renderer parse/render 42/42, CSS contract 50/50, prop contract 63/63, typography 22/22, media-row 17/17, pressable 9/9, contrast OK, i18n 4 programs; browser 7/7 with settings 101, on-demand 114, interactive-page 46 and image-export 65 assertions). Older browser/model records below remain historical.
- **Agent Skill end-to-end**: in a real DSH session the model called `skill { name: "intelligent-ui" }` and successfully loaded `<skill_content>` (15 KB body + a hint about the references base directory), then used `render_ui` as described by the skill to generate and render a verification page.
- **Bundle install path**: the `npm pack` artifact was installed into a throwaway profile (`~/.dsh/profiles/zbundle-test`, depending on `file:/tmp/…tgz` + `dsh.profile.bundles`); `dsh --profile zbundle-test --dump-config` exited 0, and its output contained `# == @zephinel/dsh-intelligent-ui` and the inserted row `id: intelligent-ui / name: '@zephinel/dsh-intelligent-ui'` (cleaned up after verification).
- **Three-state switch end-to-end (0.2.1-era record):** with the default "Off", requests contain no `render_ui` and the prompt is empty; after choosing "This session only", requests in that session carry the tool and the prompt and render a card, while a newly opened session is still off; after choosing "All sessions", newly opened sessions carry the tool and prompt directly; after choosing "Off", the file is cleared and new sessions again have neither tool nor prompt; control state syncs between two tabs over BroadcastChannel; the state file `{ "global": false, "sessions": [] }` and the projection behave as expected. The 0.3 session switch/style overrides and Article page still need live verification.
- **Style-panel browser E2E (component level, rerunnable):** `npm run test:browser` first loads the `ToggleControl` harness in headless Chrome + CDP and verifies chip → menu (no "All sessions", has "Display style") → switching to This session only emits `enable:on` and does **not** auto-open the style panel → the panel opens only via the active entry or the Display style row, and that the panel's back button returns to the scope menu instead of dismissing every popup, with focus landing on the Display style row; the menu sizes to its content with a 208px minimum, right-aligns with the chip, rows share one minimum height and spacing, the divider is inset, the chevron reaches 180° when open, and with the switch off "Display style" stays visible but disabled and cannot open the panel; the panel rect stayed inside the viewport, focus moved into the panel; dragging the real range to Article emitted `style:article`; Escape closed the panel and returned focus to the chip. This does not boot the full DSH Web and is not a substitute for a Host/Client integration E2E.
- **Image-export browser E2E (component level, rerunnable):** `npm run test:browser` then loads `test/browser/harness/export-entry.tsx`: real `ExportAction` + real renderer card + two entries (one whose Chat selector runs the real `messageHasRenderUi` against a structural snapshot and reports no rendered output), with a real `SearchImage` whose Wikipedia lookup is stubbed to a local SVG. It asserts that only the extension answer gets a labeled trigger (visible copy, `order: 1`, flush with the action row's right edge); the export menu is right-aligned, content-sized, flips below the pill when the top edge is short, and dismisses on scroll; it then exports the raw, card and rounded-2x frames from the real menu: the initially collapsed card is expanded for the capture and collapsed again afterwards; the capture sees a flattened 3D flip, frozen transitions/animations, eager/completed lazy photos and a fake map that only reports ready after the expansion resize; the card frame is wider/taller than the raw frame by the padding plus shadow bleed and its shadow band contains non-zero alpha pixels; the rounded-2x frame is twice the raw size plus 2x padding. This does not boot the full DSH Web; cross-origin Wikimedia capture was reproduced manually with the same session program (see the next bullet).
- **Interactive-page browser E2E (component level, rerunnable):** the interactive-page `npm run test:browser` script passes the real `lib/standalone.js` / `lib/standalone.css`, a theme snapshot and two card programs to `buildStandaloneHtml`, opens the resulting single-file HTML in headless Chrome, and asserts that it has no external script/stylesheet, is at least 3.4 MB, mounts both card bodies with no header/collapse chrome, and that the inline theme applies, and that an `@ToAssistant` button shows the copy fallback toast instead of calling DSH; it then opens the same page with **Remove follow-up actions** on and asserts that a mixed Card keeps its prose while only its follow-up control is hidden (the Form's fields go with it), a root-level follow-up hides only its control rather than the page, a pure follow-up Card disappears whole, a non-follow-up `@OpenUrl` Button remains visible, and no html-level hidden attribute is set; the image-export E2E asserts the same semantics (a mixed Card keeps its content, the pure follow-up Card is absent from the PNG). This does not boot DSH Web.
- **Custom color-picker browser E2E (component level, rerunnable):** the settings-picker `npm run test:browser` script renders the real Plugin detail page and asserts that the native `input[type=color]` is gone, the background trigger and 12 preset swatches exist, a preset commits `exportBackground`, and a hex value commits on Enter and closes the panel; real-mouse cases prove a preset wins while the hex field is focused and a valid typed draft commits when clicking outside.
- **Article-layout browser E2E (component level, rerunnable):** the fourth `npm run test:browser` script renders a small Article fixture and asserts that every Section body is its own flow with 16px block gaps (12px after a title) instead of touching blocks, and that the page-level flow no longer adds an extra 18px flex gap, so sections keep one page-level gap (~24px) rather than a doubled blank band.
- **Follow-up export switch:** the Plugin detail page **Export** group adds **Remove follow-up actions** (volatile Host `removeFollowUps`, on by default); when on, both images and the standalone page remove the `@ToAssistant` follow-up control and its smallest wrapper (a Form's fields go with it), a Card with prose keeps its prose and only a pure follow-up block disappears whole, and the copy callback is disabled; turning it off keeps the control and restores the page copy fallback. The setting applies to images and pages alike. Covered by settings SSR, the image-export E2E and the standalone-page E2E; a `to-assistant` unit test locks down the bare-button-only rule and the legacy `exportToAssistant` migration.
- **Layout/spacing contract:** the generation prompt and Agent Skill now carry the layout rules; the Host `layoutWarnings` returns non-fatal warnings for a root `gap`, vertical `Spacer()`, empty `Section`/`Text` and `gap: 0` block stacks (covered by Host unit tests); Article Section bodies are nested flows and the page root no longer adds a flex gap, guarded by the article-layout E2E (measured 16/16/12/16px body gaps and ~24px between sections).
- **Image export (2026-10-22, component-level + browser experiments)**: the bottom export entry and image export are implemented and build cleanly. A temporary headless-Chrome + CDP harness (real `ExportAction` + real renderer card) verified that the button appears only for messages whose Turn recorded `render_ui`; the menu offers raw / rounded / card; collapsed cards expand for the capture and restore afterwards; the 2x rounded frame produced a 1616×2348 PNG with the configured background and a filename carrying the title and local time. MapLibre experiments: with the default `preserveDrawingBuffer: false` the canvas `toDataURL` was blank (~9 KB); with `canvasContextAttributes.preserveDrawingBuffer` enabled it contained the full map (~449 KB), and capturing inside a `render` event also worked. This did not boot the full DSH Web; a manual check in a restarted DSH Web session is still pending. The historical program from session `c3a17e93-b553-4f6f-8734-3997fa02a751` was then used to reproduce and fix two defects found in a real export: stacked flashcard 3D faces (overlapping text in the image) and empty photo boxes when the image search or load had not finished; the `export-image` E2E in `npm run test:browser` now guards the flashcard flattening and the photo-settling path (with a stubbed local search; cross-origin Wikimedia capture was reproduced manually), and its card-frame assertions cover the shadow geometry too.
- **UI language**: zh/en dictionary key parity, Chinese SSR of the scope control, and Chinese plus English-fallback SSR of renderer chrome (Code, Timer, Map, empty-program fallback) are covered by automated checks; a manual language switch in a running Web UI has not been performed yet.
- **0.2.0 release**: pushing tag `v0.2.0-26-10-21` triggered GitHub Actions [run 39592467955](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39592467955) (`publish.yml`, 33 s) and published the package; registry `latest` = `0.2.0-26-10-21`, `gitHead` = `e5ce0af`, and `npm audit signatures` verified both the registry signature and the provenance attestation (SLSA v1). GitHub release: [v0.2.0-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.0-26-10-21).
- **0.2.1 release**: the configuration moved from Settings to the Plugins detail page (`plugins.bundle.config`, keyed by the package name) and the switch now mirrors the native DSH style; tag `v0.2.1-26-10-21` triggered [run 39596441971](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39596441971), registry `latest` = `0.2.1-26-10-21` (`gitHead` = `4dcd34b`), and `npm audit signatures` verified the provenance; local `npm run check` had 65 tests and `npm pack` shipped 34 files. GitHub release: [v0.2.1-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.1-26-10-21).
- Verified DSH version: **0.2.2-rc.1** (`dsh --version`). Later versions are unverified.
- **Platform coverage**: macOS (Web + DSH Desktop) and Windows (DSH Desktop) have both been installed and used successfully (composer UI control, cards); Linux is unverified.
- **0.2.2 release** (docs-only): fixed the README's CJK emphasis rendering and platform-verification wording; tag `v0.2.2-26-10-21` triggered [run 39598770488](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39598770488), registry `latest` = `0.2.2-26-10-21` (`gitHead` = `aac3f86`), and the provenance was verified; no code or behavior changed.
- **0.3.0 release**: the answer styles, image export and interactive-page export shipped as 0.3.0 together with a fix to the shipped Agent Skill's tool-contract docs; annotated tag `v0.3.0-26-10-22` triggered [run 39785829751](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39785829751) (40 s), registry `latest` = `0.3.0-26-10-22`, `gitHead` = `8cfd0cd`; the GitHub Release page was backfilled on 2026-10-22: [v0.3.0-26-10-22](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.3.0-26-10-22). The provenance statement is in the transparency log (logIndex 3388870856), and `npm audit signatures` from a temporary install reported 2 packages with verified attestations. Local `npm run check` had 102 tests and `npm pack` shipped 40 files (3.63 MB / 9.45 MB unpacked). The registry metadata took about five minutes after publish to become visible, with the tarball one to two minutes behind it (`npm install` returned 404 in that window); that is propagation, not a failed publish.

- **0.4.0 release**: custom style templates, chat-native on-demand UI and its lifecycle/content-grounding fixes shipped as 0.4.0; annotated tag `v0.4.0` points at release commit `3a3d6a8` and triggered [run 39850727142](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39850727142) (44 s, success). Registry `latest` = `0.4.0`, `gitHead` = `3a3d6a8`; GitHub Release: [0.4.0 — 2026-10-22](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.4.0). `npm audit signatures` from a temporary install reported 4 packages with verified registry signatures and 2 with verified attestations. Local `npm run check` had 179 tests and `npm pack` shipped 43 files (4,036,061 bytes / 10,216,623 bytes unpacked). Registry metadata showed `0.4.0` about two to three minutes after publish; that is propagation delay, not a failed publish.

- **0.4.1 release**: fixed the style-picker surfaces that still looked white in 0.4.0. The live DSH light theme keeps `--dsw-alias-bg-layer-2` white, so the UI now uses `--dsw-alias-bg-module-platform` (`#f5f6f7`, with a layer-2 fallback): built-in previews, the On-demand entry and Plugin detail page rows now share a light rounded surface, and the screenshot fixture mirrors the real layered tokens. Tag `v0.4.1` points at `bb38b4a` and triggered [run 39854292035](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39854292035) (44 s, success). Registry `latest` = `0.4.1`, `gitHead` = `bb38b4a`; GitHub Release: [0.4.1 — 2026-10-22](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.4.1). `npm audit signatures` from a temporary install verified 4 registry signatures and 2 attestations. Local `npm run check` had 179 tests and `npm pack` shipped 43 files (4,036,061 bytes / 10,216,623 bytes unpacked).

## 2026-10-22 — R4 custom templates and chat-native on-demand UI

This is a delta documentation/screenshot sync of an uncommitted worktree, not release acceptance. It covers HEAD `155585c9afcc943b98e7fb5b36a2a2f0e4b51c49` plus existing R1–R3 work. This stage changed no src, dependencies, version or plan/review history, and made no commit/publication. Environment: Node v24.22.0, npm 11.19.1, Google Chrome 155.0.8059.86.

### Automated results

| Command / check | Result in this stage |
| --- | --- |
| `npm run check` | PASS; 179/179 Node tests = Host 77 + Client 81 + packaging 21; 0 failed, 0 skipped |
| Renderer (inside check) | Parse 41/41, SSR 41/41 (existing `/tmp/oiui/src/app/gallery` fixtures); contrast OK; i18n 4 programs (zh/en fallback); typography 22/22 actually executed in Chrome |
| `npm run pack:check` | PASS; 43 files; tarball **4,036,061 bytes** (4.03 MB), unpacked **10,216,623 bytes** (10.22 MB) |
| Build artifacts | `lib/index.js` 637,813 bytes; `lib/client.js` 3,763,748 bytes; `lib/standalone.js` 3,426,892 bytes; `lib/standalone.css` 511,833 bytes |
| `npm run test:browser` | PASS, 7/7 suites: on-demand (85 assertions), style-panel, style-theme, export-image, standalone-page, article-layout, settings-picker; none skipped |
| `node --test test/packaging/*.test.mjs` | PASS, 21/21; manifest 9 + references 6 + guardrails 6; all 13 assets referenced by both READMEs, locale meta key parity |
| Documentation checks | Matching heading depth in README and all three docs pairs; valid local links/anchors, absolute GitHub doc paths, language switchers, clone URL and CHANGELOG links |
| `git diff --check` | PASS |

The first browser run, concurrent with screenshot work, failed at a menu-item click in `export-image.e2e.mjs:228` with `Cannot read properties of null (reading 'click')`. Without changing product code or that test, a full serial rerun passed all seven suites. Cause remains unconfirmed; retain this as one unstable browser run. React useLayoutEffect notices remain visible during SSR; render-check exits 0, so they are not recorded as a failed run.

Current component evidence covers production slot/command/focus wiring, draft preservation, armed hint/cancellation, temporary-card adjustment/save, template management and error states; temporary replay without a catalog, scheme changes/recovery; PNG pixels and HTML theme snapshots for temporary/saved templates. The image-export fixture uses a local photo, a fake map readiness signal and minimal standalone assets; the standalone-page suite uses real build artifacts. These cannot establish that DSH services or a real model follow the protocol.

### Screenshots and reproduction

`node scripts/capture-screenshots.mjs` mounts production `ToggleControl`, `OnDemandHint`, `IntelligentUICards` and `SettingsPage` in a temporary HTTP server + headless Chrome/CDP, with fixed light/dark tokens and fake projection/catalog/form services at deviceScaleFactor 2. `scripts/screenshot-entry.tsx` supplies fixed content; shell card glyphs use lucide stand-ins because DSH primitives come from the live loader. No images were hand-edited. The layout/tour remains reproducible; a full recapture into a separate directory produced seven outputs with SHA-256 hashes identical to assets.

| Capture | Output pixels |
| --- | --- |
| `assets/intelligent-ui-components-layout.webp` | 1616 × 4040 |
| `assets/intelligent-ui-settings.webp` | 1336 × 3508 |
| `assets/intelligent-ui-toggle.png` | 1080 × 800 |
| `assets/intelligent-ui-style-panel.webp` | 1080 × 1860 |
| `assets/intelligent-ui-on-demand-hint.webp` | 1520 × 598 |
| `assets/intelligent-ui-temporary-result.webp` / `assets/intelligent-ui-temporary-result-dark.webp` | 1536 × 1032 each |

All seven captures also passed `node scripts/capture-screenshots.mjs --dark --out-dir=/tmp/iui-r4-dark`; these temporary outputs are outside assets. Both READMEs reference all 13 assets; existing real-session examples are unchanged. The actual composer label is Custom styles; the settings group is My styles. Captures follow the current code.

### Real-model status and scenarios after restart

**Real-model DSH E2E was not run in this stage.** Historical model records above do not qualify this rework. After restarting the process serving DSH Web and reopening the page so Host/Client load the same build, the owner must still verify:

1. Clear requests: Composer → On-demand UI → normal message renders directly, without redundant questions, preview, naming, confirmation or forced saving; the next ordinary message does not repeat generation.
2. Material ambiguity: the default main-conversation model can use `ask_user_question`; options/free input/skipping and blocking/timed-reply recovery work; at most two rounds, no render before answering. Missing-tool text fallback and re-arming guidance are understandable.
3. Results/adjustment: preserve the draft and content, bind repeated adjustments to the right parent result; saving old/new results uses each snapshot. Directives transfer across content rather than copying business/private data.
4. Saving/management: usable without saving; session/global save, duplicate names, limits, deleting the current default, stale templates, settings limited to persistence without a generation workbench; no unintended session/global style changes.
5. Lifecycle: cancellation, re-arming after failure, 10-minute armed expiry and cleared operations after restart; prevent unintended consumption across two tabs and confirm arming-tab hint visibility. The Host still binds the next human session message with no sending-source isolation guarantee.
6. History/export: restarted DSH history really retains complete temporaryStyle arguments; temporary replay survives an unavailable catalog, and saving after 200-record eviction has a clear error. Check actual PNG/single-file HTML, light/dark, Article/Card, live media and frozen exported scheme; portaled popovers/iframes retain default themes.

No mechanical gate guarantees these model/deployment behaviors. The implementation also has no separate revisionId or server save-idempotency key. As-built docs describe immutable callId-owned results and duplicate-name errors; approved §13/§14 and the original review remain unchanged.

### 2026-10-22 — Post-R4 activation fix (tool JSON Schema subset)

When the new Host first activated after R4, the plugin entry showed Problem and the composer UI control disappeared; the Host log reported:

```
JsonSchemaError: unsupported JSON schema: schema.properties.styleId.maxLength is not a supported keyword
(subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)
```

Cause: the `render_ui` input/output JSON Schemas used `maxLength` / `minLength` / `pattern`, which DSH 0.2.1 tool registration rejects. Fix: move limits into `description`, keep strict runtime validation in execute, and add a schema-subset guard test in `test/host/tool.test.mjs` (also verified against the installed `dsh-tools` `assertSupportedJsonSchema`). After rebuilding:

- `npm run check`: **179/179** (Host 77 + Client 81 + packaging 21); renderer unchanged; `lib/index.js` 639,718 bytes.
- A second isolated DSH Web instance (127.0.0.1:3081, same profile, no concurrently written session) activated the plugin normally: no Problem entry, composer UI control present, scope menu/style panel/My styles + On-demand UI entries, armed hint, example draft fill and cancel all worked with no page/console errors. That instance made no real model call and has been stopped; **the primary instance still needs a restart** to load the fix.

### 2026-10-22 — Post-R4 on-demand timing fix and real-model validation

Real-model validation in an isolated instance exposed a DSH ordering detail: within a step the loop appends `system/message` before the first `user/message`, while the controller bound the operation only on `user/message`. The first on-demand turn therefore never received the ON-DEMAND note and rendered a normal card; a second arm click could also replace the running operation. Fix:

- `promptNote` is now injected while the operation is **armed** and kept after binding.
- Re-arming a bound running/clarifying operation is rejected; explicit cancel is required.
- A bound on-demand turn rejects a plain `render_ui` without `temporaryStyle`, forcing a temporary snapshot or a clarifying question.
- Added Host tests (**179/179**: Host 77 + Client 81 + packaging 21); `lib/index.js` is 639718 bytes.

Real-model DSH E2E (second isolated instance at 127.0.0.1:3081, same profile, primary untouched): new session → On-demand UI → example "Make this analysis a compact Linear-style dashboard" → send. The real model (DeepSeek-V4.1-Flash) called `render_ui` with a `temporaryStyle`; the page showed the Temporary style badge and temporary theme. The result registry recorded one snapshot (reusable directives plus light/dark theme); Save as template created a template in the style store. The test instance was stopped and the test template/result records removed. Still unverified live: genuine ambiguity/`ask_user_question`, chained adjustments, multiple tabs, restart replay, real image/single-file export. The primary instance needs another restart to load this Host change.

### 2026-10-22 — Post-R4 on-demand status and content-clarification hardening

Real-model testing surfaced two issues: the on-demand hint vanished on send, hiding the generating state; and when content was missing the model once fabricated a dataset, while the built-in option row cannot carry a pasted link. Changes:

- `OnDemandHint` now covers armed / running / clarifying: after sending it keeps a generating status with a restrained SVG loading indicator; while a question is pending it shows a waiting state. It no longer disappears on Enter, and is cleared only after a temporary result renders or the user cancels.
- A completed turn with no render (typically the model asking in prose for missing content) returns the operation to armed with `resume: true`; the hint shows a continue copy and the next message continues the same operation instead of silently dropping the intent.
- Content grounding: the prompt and Agent Skill now require checking content, numbers, dates and sources first; when content/link is missing, ask via `ask_user_question` with a **free-form question and no options** so the user can paste text, a path or a URL; placeholder data is explicitly forbidden. The built-in question UI itself is unchanged.
- The loading indicator was replaced by a conventional but refined SVG ring (track plus rounded arc) with a reduced-motion fallback.

Real-model DSH E2E (isolated instance at 127.0.0.1:3082): in an empty session the model checked the conversation/workspace, refused to ground the dashboard on invented data, and asked a no-options free-form question ("What should the dashboard be built from? Paste the analysis text, or give the file path / URL"); the hint stayed visible through running→clarifying. It then rendered a temporary-style card from a real `stats.gov.cn` source, kept the source in the card, and the hint cleared only after the result appeared. The test instance was stopped and its result record removed.

Gates: `npm run check` **179/179** (Host 77 + Client 81 + packaging 21); browser **7/7** (on-demand **85** assertions); `lib/index.js` 639718 bytes. The primary instance still needs a restart to load this Host/Client. Still unverified live: chained adjustments, multiple tabs, restart replay, real image/single-file export.

Addition — terminal guidance. Failed/interrupted operations no longer make the hint disappear silently: the composer keeps a summary with Retry (re-arm on-demand in this session) and Dismiss (hide this tab's hint); the hint clears on cancel, a successful render, or Dismiss. On-demand browser assertions are now **84**; Node remains 179/179.

### 2026-10-22 — Codex review fixes for the uncommitted worktree

Codex (gpt-6.1-sol / xhigh) reviewed the uncommitted tree: **no P0; 1 P1 and 3 P2 findings**. All are fixed:

- **P1 projection schema rejected `resume`**: `modeViewSchema` did not declare it, so DSH publication/read validation failed with `unrecognized_keys: resume`. Added it as an optional boolean; binding the next message clears the flag; added a wire-schema assertion that accepts `resume`.
- **P2 adjustment retry lost its parent result**: Retry after failure/interruption sent a plain arm and turned adjust into generate. It now re-arms with `kind: adjust` and `parentResultId`; the browser test asserts the command contains `adjust <parent>`.
- **P2 HTML export theme diverged when the catalog was unavailable**: live cards fell back to the default theme while export used cached templates. Added `exportTemplatesFor` as the shared selection rule (empty templates when unavailable) and a unit test; export now matches the page.
- **P2 stale lifecycle docs**: README/FAQ/architecture/integration still claimed "text-only completion without rendering fails", "re-arming replaces the active operation" and immediate re-arming after text questions. Updated to resume / rejected re-arm while bound / next message continues / retry for failures.

Gates: `npm run check` **179/179** (Host 77 + Client 81 + packaging 21); browser **7/7** (on-demand **85** assertions); packaging 21/21; `git diff --check` clean. The review did not run a real-model E2E (the real-model path was validated earlier).


### 2026-10-23 — Free on-demand layouts (uncommitted working tree)

The result contract adds `RenderLayout = card | article | free` while retaining `PageStyle = card | article` for normal sessions and saved templates. SchemaVersion 1 snapshots accept `baseLayout: "free"`, paired with `style: "free"`. This additive field value avoids a parallel snapshot format or migration; legacy card/article and style-less ordinary calls still replay unchanged. A free call requires the same Host-bound operation and current callId as every temporary result, and records `styleSource: "temporary"` plus the exact snapshot.

Free compositions use the existing neutral `OpenUIRenderer` inside DSH card chrome, with no Article wrapper, compactness requirement or mandatory Toc/Section. Themes, parser validation, anchor validation, source exclusivity and the bound-operation plain-render guard remain. The prompt omits session-shell guidance during an on-demand operation, follows the user's requested layout and asks a focused question if materially unclear. Ordinary session choices and `StylePicker` remain unchanged; the existing Free-form layout setting is independent of the new result layout. The generated prompt was rebuilt from its generator.

Replay and HTML payloads preserve `free`; standalone free results use available page width, while mixed Card/Article results keep 760px. PNG continues to capture the live DOM, expand/restore collapsed chrome and retain theme/media/interaction normalization. Saving a free result requires an explicit Card/Article template shell in the optional save dialog (new zh/en legend, no preselection). Only the saved template receives that shell; the original free snapshot remains immutable. Legacy save calls retain their original contract.

Validation: `npm run check` passed **183/183** (Host **81**, Client **81**, packaging **21**); gallery parse/render **41/41** each, extra free-composition SSR assertions in light/dark, contrast OK, i18n **4** programs and typography **22/22**. `npm run test:browser` passed **7/7** suites, including **101** on-demand assertions, free/legacy replay and saving, PNG/HTML, wide/narrow and light/dark mixed-layout exports, local interactions and existing Article behavior. The export fixture now explicitly emulates light system preference rather than assuming the machine's appearance. `npm run pack:check`: **43** files, **4,038,253** bytes packed, **10,222,452** bytes unpacked; package version remains **0.4.2**, unpublished working-tree changes only. `git diff --check` and changed bilingual heading/local link checks passed.

Evidence boundary: Host tests use isolated temporary DSH_HOME directories; browser tests use production components with structural DSH services. No real-model DSH session, shipped screenshot refresh, install, restart, commit, branch, tag, push or publish was performed. Actual model layout clarification and composition quality remain unverified in live DSH. Plans, previous verification records and published changelog entries were retained; only as-built contract claims and Unreleased notes were synchronized.

Real-model validation (2026-10-23, isolated DSH Web instance on port 3086, cloned profile + local uncommitted build): the request "做一个自由布局的产品发布海报：左边大标题，右边三列要点，不要卡片或文章外壳" made the model ask for the product content first (no fabrication). After the user authorized example content, it called `render_ui` with `style: "free"` and `temporaryStyle.baseLayout: "free"`; the DOM contained one `data-dsh-iui-style="free"` card with the DSH card header retained but no `.dsh-iui-article` / `.iui-toc` / `.iui-section`, a multi-column poster body, and clearly labelled fictitious sample copy. The result registry recorded `baseLayout: "free"` and the session tool arguments matched. The test instance, cloned profile, result record and session were cleaned up. Still unverified live: the layout-ambiguity question path, the free-result save dialog, real media export and the primary-instance visual check.

Changed files (includes the four pre-existing prompt-related edits):

| Directory | Files |
| --- | --- |
| `./` | `CHANGELOG.md`, `README.en.md`, `README.md` |
| `.agents/skills/sync-iui-docs/references/` | `verification.md` |
| `docs/` | `architecture.en.md`, `architecture.md`, `verification.en.md`, `verification.md` |
| `scripts/` | `generate-prompt.mjs` |
| `skills/intelligent-ui/` | `SKILL.md` |
| `skills/intelligent-ui/references/` | `integration.md` |
| `src/client/` | `IntelligentUICards.tsx`, `SaveResultAction.tsx`, `export-html-plan.ts`, `programs.ts`, `style-actions.ts` |
| `src/generated/` | `prompt.txt` |
| `src/host/` | `index.ts`, `on-demand.ts`, `style-routes.ts` |
| `src/shared/` | `intelligent-ui.ts`, `locales.ts`, `style-templates.ts` |
| `src/standalone/` | `index.tsx`, `standalone.css` |
| `test/browser/` | `README.md`, `export-image.e2e.mjs`, `on-demand.e2e.mjs`, `standalone-page.e2e.mjs` |
| `test/browser/harness/` | `export-entry.tsx`, `on-demand-entry.tsx` |
| `test/client/` | `export-html-plan.test.mjs`, `programs.test.mjs`, `style-actions.test.mjs`, `style-snapshot.test.mjs` |
| `test/host/` | `mode.test.mjs`, `on-demand.test.mjs`, `result-store.test.mjs`, `style-routes.test.mjs`, `style-store.test.mjs`, `tool.test.mjs` |
| `test/packaging/` | `guardrails.test.mjs` |
| `test/renderer/` | `render-check.mjs` |

### 2026-10-23 — Host layout enforcement fix (uncommitted working tree)

Fixed Astra P2: the Host enforces free style/baseLayout for `generate`, while `adjust` must match the registered parent snapshot layout. Missing or evicted parents reject adjustment and ask the user to cancel and start a new on-demand generation; conversation content and model arguments cannot establish the layout. Rejection neither records a result nor completes the operation. Existing generation fixtures now use free; preloaded legacy card/article snapshots retain adjustment coverage, including Article structure and anchor validation. Three added regression groups failed before the fix with missing expected rejections and pass afterwards, covering card/article generation rejection, cross-layout rejection and same-layout success for all three parent layouts, and missing-parent rejection with cancel-and-generate recovery. The prompt, Agent Skill, error reference and bilingual usage/architecture docs were synchronized, with a fix entry under Unreleased; historical records were retained.

Validation: `npm test` and `npm run check` both passed **186/186** (Host **84**, Client **81**, packaging **21**); gallery parse/render **41/41** each, free-composition light/dark SSR, contrast, i18n **4** programs and typography **22/22** all passed. `npm run test:browser` passed **7/7** suites (**101** on-demand assertions). `npm run pack:check`: **43** files, **4,039,289** bytes packed and **10,225,920** bytes unpacked. `git diff --check`, bilingual heading structure and local link checks passed. Host tests use isolated DSH_HOME directories and browser tests use component fixtures; this fix did not rerun a real-model DSH session. Version remains **0.4.2**; all changes are uncommitted, with no branch, tag, push or publication.


### 2026-10-23 — Saved templates preserve result layouts (uncommitted working tree)

Template and create/patch baseLayout now use RenderLayout (free/card/article), still in the version 1 store. StyleSnapshot semantics, theme/directive limits, visibility, quotas, duplicate-name rules and atomic writes remain intact. Saving accepts only the result ID and name/description/scope metadata, copies layout/directives/theme exactly from the Host snapshot and rejects client baseLayout for every layout. The save dialog removes the Card/Article choice. Selected free templates use style: "free" and the exact styleId without temporaryStyle; prompt guidance allows free composition and optional Toc/Section. The tool still rejects unsourced free, conflicts with selected Card/Article templates, wrong IDs and mixed sources. Client replay, local previews and zh/en hints support free templates; the same program keeps the DSH header, has no Article wrapper, uses the template light/dark theme and has no temporary badge/actions.

Regression evidence: before the fix, the free metadata-only route test returned **400 instead of the expected 201**. Passing regressions cover exact saving of all three layouts, override-field rejection, version 1 persistence/reload/management, free-template tool authorization, missing-source/wrong-selection rejection, replay, catalog response validation and export themes. `npm run build && npm test`, followed by `npm run check`, passed **191/191** (Host **87**, Client **83**, packaging **21**, no skips). Gallery parse/render passed **41/41** each, plus free light/dark SSR, contrast, i18n **4** programs and typography **22/22**. `npm run test:browser` passed **7/7** suites (**114** on-demand assertions, including free-template replay after an actual page reload), including free-template selection, PNG/HTML, the real standalone bundle with free temporary/template and legacy mixed exports, light/dark and wide/narrow viewports. Chrome was available; no suites were skipped. `npm run pack:check`: **43** files, **4,039,044** bytes packed and **10,229,511** bytes unpacked. `git diff --check`, bilingual heading structure, screenshot references, local links and README doc links (**26** valid, **0** broken) passed.

Tests use isolated DSH_HOME directories and browser component fixtures, with no real-model call or operation on the running DSH instance. Only isolated browser save-dialog/template-replay screenshots were inspected; repository marketing screenshots were not recaptured. Standalone HTML retains its existing body-only export without the chat collapse header. Existing unreleased work was preserved; no docs/plans files or historical verification sections were rewritten, and no commit, stash, tag, push, publication or main-instance restart occurred. Whether later model-generated answers fully follow the free composition still needs a real session; deleted templates or an unavailable catalog keep the existing default-theme fallback.

### 2026-10-23 — Portable template file export/import (uncommitted working tree)

Added single-template exchange on top of the existing free on-demand/save-layout work. `style-template-exchange.ts` explicitly constructs Envelope v1 and themes in fixed order, supporting card/article/free. Export includes only five portable fields, excluding local identity/scope/session/timestamps. Strict parsing covers kind/version/keys/types/bounds/hex/enums, the 32 KiB UTF-8 boundary, one complete code fence, label Cf stripping, prototype-key rejection and known complete legacy objects; store backups reject. Settings export confirms disclosure. Import supports file/paste, preview, rename/description/preference editing or clearing, acknowledgement of nonempty preferences, duplicate suggestions/quotas/retry, busy double-submit protection and success status. It reuses authenticated `op:'save', scope:'global'`, without sessionId, automatic application or default changes. Host equivalence vectors verify new IDs/timestamps for all three layouts and continued rejection of local/unknown fields.

Node **24.22.0**. `npm run build && npm test`, followed by `npm run check`, passed **205/205** (Host **88**, Client **96**, packaging **21**; **0** failures/skips). Added **10** codec tests, **2** createTemplate tests, **1** settings-entry SSR test and **1** Host equivalence test. Gallery parse/render passed **41/41** each, plus free light/dark SSR, contrast, i18n **4** programs and typography **22/22**. Builds: Host **628.2 kB**, Client **3.61 MB**, standalone **3.28 MB + 502.8 kB**, using the build script’s display units. Existing ToggleControl SSR useLayoutEffect warnings remain; they are not failures or skips.

`npm run test:browser` passed **7/7** suites with no skips; on-demand **114** assertions, settings **92**. Settings covers download confirmation/cancel, filenames/envelopes/metadata stripping/free, wrong-version/oversized input without POST, oversized files without reads, paste and legacy files with untrusted MIME, full plain-text preview, edit/clear/acknowledgement reset, Host duplicate/quota errors retaining input, one save on double click, unchanged global selection/settings, imported-template use/rename/edit/re-export/delete, the 40-template quota, zh/en, narrow scrolling, focus cycling and Escape. Fixture update times now increase monotonically so newly imported templates do not get updatedAt earlier than createdAt. `npm run pack:check`: **43** files, **4,048,125** bytes packed and **10,260,128** bytes unpacked; version remains **0.4.2**. `git diff --check`, bilingual heading structure and local links passed. Bilingual README/architecture, Unreleased, browser-test guidance and doc verification references were incrementally synchronized; plans/reviews and historical paragraphs were preserved.

**Evidence boundary/plan deviation**: the explicit decision for this task permits retaining nonempty external preferences after acknowledgement, replacing the plan’s mandatory appearance-only import before audit. As-built docs record the difference without changing the plan. Preferences remain untrusted prompt text; preview/acknowledgement/no automatic application do not prove prompt injection is eliminated. DSH’s tool layer controls execution authority. Execution-layer permission audit, real-deployment Origin/CSRF audit and adversarial model observation remain pending before release. This run used isolated DSH_HOME and component browser fixtures, without real models, running-instance operations, install/restart, screenshot updates, commit, stash, tag, push or publication. Real-model style fidelity remains unverified; no MVP implementation item was omitted.

### 2026-10-23 — Remove legacy raw-export compatibility from template sharing (uncommitted working tree)

Product decision: there are no external users yet, so legacy-format compatibility is not maintained. `parseStyleExport` now accepts Envelope v1 only; raw `StyleTemplate` exports, store documents and other non-envelope shapes reject as `invalid_structure`. The legacy branch, preview marker, UI copy and related tests were removed. Export confirmation, import preview/acknowledgement, reuse of `save`, the 32 KiB limit and the trust boundary are unchanged; file input still does not trust MIME type or filename.

Validation: `npm run build && npm test` and `npm run check` both passed **205/205** (Host **88**, Client **96**, packaging **21**; no skips); gallery parse/render **41/41** each, contrast, i18n **4** programs and typography **22/22** passed; `npm run test:browser` passed **7/7** suites (settings **91**, on-demand **114** assertions); `npm run pack:check`: **43** files, **4,047,844** bytes packed and **10,259,306** bytes unpacked; `git diff --check` and doc link checks passed. The browser file-input case now uses a valid envelope (`.txt` + text/plain) to keep proving that MIME/filename are not trusted; raw-export/store-document rejection is covered by codec unit tests. Version remains **0.4.2**, uncommitted and unpublished.

### 2026-10-23 — Composer template entry (uncommitted working tree)

The composer Display style panel now mounts the same portable exchange entry as Plugin settings: an **Import template** control (reusing `TemplateImport`, still creating global templates only and sending no sessionId) and an **Export file** menu item that is no longer gated by `global`, so session-scoped templates visible in the composer can be exported directly (Settings still lists global templates only). `TemplateImport` now pre-checks duplicate names against every visible template passed to it, avoiding collisions with current-session names; the 40-template global quota, Host duplicate checks and session visibility rules are unchanged. Session-scope import remains deferred until the `save` sessionId authorization is reviewed.

Validation: `npm run build && npm test` and `npm run check` both passed **205/205** (Host **88**, Client **96**, packaging **21**; no skips); renderer, contrast, i18n **4** programs and typography **22/22** passed; `npm run test:browser` passed **7/7** suites (settings **91**, on-demand **114** assertions; style-panel covers the composer import entry, export confirmation for global/session templates and panel retention); `npm run pack:check`: **43** files, **4,048,045** bytes packed and **10,259,993** bytes unpacked; `git diff --check` and doc link checks passed. Version remains **0.4.2**, uncommitted and unpublished.

### 2026-10-23 — Independent review fixes (uncommitted working tree)

Findings from three read-only reviews were fixed: external name/description now require the same import acknowledgement as directives (labels strip all `\p{Cf}` and U+2028/U+2029; host prompt quoting escapes line separators); imported directives strip all invisible format controls (bidi/tag/zero-width) so the preview cannot be visually reordered; the import dialog cannot be dismissed while a save is in flight; description is single-line; non-exportable stored names, surrogate-safe `(Imported)` truncation and filename format controls have explicit handling (focused tests were added later; host quoting was manually verified). The deviation was recorded as not approved at the time; **the owner approved it on 2026-10-24**, with execution-layer/Origin audits retained as pre-release hardening (see the final record).

Validation: `npm test` and `npm run check` both passed **205/205** (Host **88**, Client **96**, packaging **21**, no skips); renderer 41/41, contrast OK, i18n **4** programs, typography **22/22**; `npm run test:browser` **7/7** (settings **94**, on-demand **114** assertions, including no dismissal while saving and acknowledgement for all external content); `npm run pack:check`: **43** files, **4,048,614** bytes packed and **10,261,873** bytes unpacked; `git diff --check` and doc link checks passed. Reviews and dispositions: [subagent-review-2026-10-23.md](plans/template-export-share/reviews/subagent-review-2026-10-23.md).

### 2026-10-24 — Import disclaimer and owner approval (uncommitted working tree)

Per the owner's decision (option A), the import risk notice is strengthened into a disclaimer: the preview states that external templates may affect AI behavior, importing means understanding and accepting that risk, and DSH's tool/permission policy remains the real execution boundary; the acknowledgement now reads "I have read and understood the risks above; import this external template". README/architecture/plan/review record now note the owner-approved disclaimer + acknowledgement approach (2026-10-24), replacing the plan's mandatory appearance-only import; execution-layer tool-permission and real Origin/CSRF audits remain pre-release hardening items (no longer recorded as unapproved).

Validation: `npm test` and `npm run check` both passed **205/205** (Host **88**, Client **96**, packaging **21**, no skips); renderer 41/41, contrast OK, i18n **4** programs, typography **22/22**; `npm run test:browser` **7/7** (settings **94**, on-demand **114** assertions, including the disclaimer acknowledgement and no dismissal while saving); `npm run pack:check`: **43** files, **4,048,935** bytes packed and **10,262,394** bytes unpacked; `git diff --check` and doc link checks passed. Version remains **0.4.2**, uncommitted and unpublished.

### 2026-10-24 — Second-round review fixes (uncommitted working tree)

Two independent read-only subagent reviews both returned **SHIP WITH CHANGES, no P0/P1**. This pass fixed and covered:

- An import could still be dismissed from parent surfaces during a save (composer panel outside-click/back/chip, settings toggle causing disabled): import busy state is reported to the parent, and parent close paths plus the disabled render guard yield during the POST; Escape/disable/focus keep the dialog open while saving.
- Directives previously stripped only bidi controls, so tag/ZWSP/WJ and other invisible chars could hide prompt text: imported directives now strip all `\p{Cf}`; tests cover all 12 bidi controls plus tag/zero-width cases.
- Editing external name/description did not reset the acknowledgement (contradicting docs): every preview edit resets it now; e2e added.
- Selected file names kept U+2028/U+2029/C1: display is sanitized with e2e; `(Imported)` truncation uses a shared codepoint-safe helper with a unit test; export-failure messaging and fileStem Cf/line-separator handling have regression assertions.
- Docs were aligned: acknowledgement applies to every import, the description is stored/exported only and never enters the prompt (the third pass corrected the earlier "label only" wording), execution-layer/Origin audits are uniformly described as pre-release hardening; remaining plan mandates now carry a "superseded by the 2026-10-24 owner decision" note.

Validation: `npm test` and `npm run check` both passed **206/206** (Host **88**, Client **97**, packaging **21**, no skips); renderer 41/41, contrast OK, i18n **4** programs, typography **22/22**; `npm run test:browser` passed **7/7** (settings **100**, on-demand **114** assertions); `npm run pack:check`: **43** files, **4,049,089** bytes packed and **10,262,652** bytes unpacked; `git diff --check` and doc link checks passed. Reviews and dispositions: [subagent-review-2026-10-24.md](plans/template-export-share/reviews/subagent-review-2026-10-24.md).

### 2026-10-24 — Third-round review fixes (uncommitted working tree)

Two independent read-only subagent reviews both returned **SHIP WITH CHANGES, no P0/P1**. Fixed:

- **Parent surfaces could still unmount an import during save**: the composer lock/view effect and the `arm()` success path did not consult import busy; in settings a failure with the parent still disabled was hidden. The panel now stays while importing, lock/arm paths yield, unmount clears busy, errors render beside the trigger when the dialog is hidden, and busy focus moves to an in-dialog status.
- **Default-ignorable characters** (VS16/VS1, CGJ, Hangul fillers, U+2065, U+2800, etc.) were invisible yet reached the prompt: imported text now also strips `\p{Default_Ignorable_Code_Point}` and U+2800.
- **Description copy**: the description is not rendered as a label; docs now say it is stored/exported only and never enters the prompt.
- **Coverage claims**: corrected overclaims about parent-close paths and the export-failure UI; added a host regression for `quotePromptText` U+2028/U+2029. The export-failure UI branch remains untested and is recorded as such.
- **Focus flakiness**: busy focus now lands on an in-dialog status; the settings e2e passed three consecutive 100-assertion runs.

Validation: `npm test` and `npm run check` both passed **207/207** (Host **89**, Client **97**, packaging **21**, no skips); renderer 41/41, contrast OK, i18n **4** programs, typography **22/22**; `npm run test:browser` passed **7/7** (settings **100**, on-demand **114** assertions; the settings suite also passed three standalone runs); `npm run pack:check`: **43** files, **4,049,255** bytes packed and **10,263,291** bytes unpacked; `git diff --check` and doc link checks passed. Third-round reviews and residual items: [subagent-review-2026-10-24-third.md](plans/template-export-share/reviews/subagent-review-2026-10-24-third.md).

### 2026-10-24 — Fourth-round review fixes (uncommitted working tree)

Two independent read-only subagent reviews both returned **SHIP WITH CHANGES, no P0/P1**. Fixed:

- **The composer could drop a settled import result after save**: the parent kept the panel only while import busy; a new `onStatusChange` lets the parent retain the terminal status and keep the panel until the user explicitly closes it.
- **Keyboard focus could escape the busy import dialog**: all controls were disabled, leaving the focus trap empty; Cancel is now `aria-disabled` but focusable, receives focus while busy/after failure, and Tab no longer reaches background settings.
- **The third-round hidden-failure branch was untested**: the settings harness can now inject a failure after a held save releases; e2e covers "failure + parent disabled → dialog hidden and error shown beside the trigger".
- **Architecture under-documented the sanitizer**: added `Default_Ignorable_Code_Point`/U+2800/line-separator normalization.
- **Docs-sync reference was stale**: host 89, date 2026-10-24 and settings 101 updated.

Validation: `npm test` and `npm run check` both passed **207/207** (Host **89**, Client **97**, packaging **21**, no skips); renderer 41/41, contrast OK, i18n **4** programs, typography **22/22**; `npm run test:browser` passed **7/7** (settings **101**, on-demand **114** assertions); `npm run pack:check`: **43** files, **4,049,307** bytes packed and **10,263,451** bytes unpacked; `git diff --check` and doc link checks passed. The first renderer run failed on a stale empty `/tmp/oiui` directory; removing it made the run pass (environment issue, not code). Reviews and residual items: [subagent-review-2026-10-24-fourth.md](plans/template-export-share/reviews/subagent-review-2026-10-24-fourth.md).

## 2026-10-25 — Full documentation and screenshot sync (sync-iui-docs)

This is a full-audit + sync delta record for sync-iui-docs, not release acceptance. The baseline is `f5840d9`, already pushed to main (after 0.4.2, not published); npm `latest` remains `0.4.2`. This stage only synced as-built docs and screenshots; it changed no behavior, dependencies or version.

### Automated results

| Command / check | Result in this stage |
| --- | --- |
| `npm run check` | PASS; **207/207** Node tests = Host **89** + Client **97** + packaging **21**, 0 failed, 0 skipped; `check`/`render-check` both **42/42**, free-composition light/dark SSR; contrast OK; i18n **4** programs; typography **22/22** |
| `npm run pack:check` | PASS; **43** files, **4,061,684** bytes packed, **10,277,299** bytes unpacked |
| `npm run test:browser` | PASS; **7/7** suites; settings **101**, on-demand **114** assertions |
| `node scripts/capture-screenshots.mjs` | PASS; all seven fixtures recaptured; assets remain **13** files, all referenced by both READMEs |
| README / docs structure checks | Matching heading depth in the README pair and all three docs pairs; valid local links/anchors, absolute GitHub doc paths, language switchers, clone URL and CHANGELOG links; `git diff --check` PASS |

Screenshot output sizes: layout 1616×4040, settings 1336×3082, toggle 1080×800, panel 1080×1860, hint 1520×598, temporary result and dark 1536×1032 each. These are 2× component fixtures, not real-model DSH evidence.

As-built content synced here: the README and bilingual detailed docs now say main-branch (unreleased) instead of working-tree; the renderer count moved from 41/41 to 42/42; the architecture docs describe the right-aligned style panel, 12px trigger gap and the layer-2/module surface split; the sync-iui-docs maintenance references carry the current counts and classify the new plan directory. Browser and real-model gaps remain as previously recorded.

## 2026-10-25 — Typecheck/tool-schema and optional-theme delta sync (sync-iui-docs)

This record covers the uncommitted source delta on main (typecheck + `@types/node`/`tsconfig.json`, pre-registration `tool-schema.ts` validation, optional `temporaryStyle.theme`, and no template save for theme-less results). It is not release acceptance; npm `latest` remains `0.4.2`.

### Automated results

| Command / check | Result in this stage |
| --- | --- |
| `npm run check` | PASS; runs `tsc --noEmit` first (passes; `src/client` is excluded because DSH platform types are not local dependencies), then builds and tests; **216/216** Node tests = Host **98** + Client **97** + packaging **21**, 0 failed/skipped; `check`/`render-check` both **42/42**; contrast OK, i18n 4, typography 22/22 |
| `npm run test:browser` | PASS; **7/7**; settings 101, on-demand 114 assertions |
| `npm run pack:check` | PASS; 43 files, **4,066,380** bytes packed, **10,292,278** bytes unpacked |
| Docs/screenshot checks | Matching README and three docs-pair heading levels; local links/anchors, screenshot references (13 assets), clone URL and CHANGELOG links pass; `git diff --check` PASS |

As-built content synced here: README/dev docs now say `npm run check` includes typecheck and list `npm run typecheck`; the Host validates schemas before registration and fails activation as a unit with the offending keyword; `StyleSnapshot.theme` is optional, theme-less results inherit the session theme, cannot be saved as templates and hide Save in the client; Host `saveFromResult` answers 400 `no_theme` for theme-less snapshots; verification references carry the new test/build/count values. Historical records and plans are unchanged.

## 2026-10-25 — R5 renderer contract, Host validation and export semantics fixes (sync-iui-docs)

This record covers the uncommitted hazard-sweep and fix batch on the current main working tree (renderer contracts, Host validation/warnings, export and prompt consistency); it is not a release acceptance, and npm `latest` remains `0.4.2`.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; `tsc --noEmit` passes (`src/client` excluded); Node tests **247/247** = Host **117** + Client **109** + packaging **21**, 0 failed/skipped; renderer parse/render **42/42** each, CSS contract **50/50**, prop contract **63/63**, typography **22/22**, media-row **17/17**, pressable **9/9**; contrast OK, i18n 4 |
| `npm run test:browser` | PASS; **7/7** suites (settings 101, on-demand 114, interactive page 46, image export 65 assertions) |
| `npm run pack:check` | PASS; **43** files, **4,076,474** bytes packed, **10,318,189** bytes unpacked |
| Build artifacts (script units) | Host **635.9 kB**, Client **3.63 MB** (js 3.49 MB + css 143.0 kB), standalone **3.28 MB + 503.5 kB** |
| Docs/structure checks | README and all three doc pairs share heading depth; local links/anchors, screenshot references (13 assets), clone URL and CHANGELOG links pass; `git diff --check` PASS |

What this round fixed (each covered by new checks): media rows no longer override program-sized photos; the card subtitle heuristic no longer restyles body text; long list markers wrap inside their lane; `align=` beats Badge/Button defaults; standalone dark exports get the dark select/button/check colours; Carousel honours explicit `itemWidth` and keeps a 240px default with an 85% peek; Table numbers render raw; Chart defaults union number keys across rows and stacked negatives keep their sign; `aspectRatio` accepts 0.05–20; YouTube `/live/` renders; SVG paint tokens match the docs; raw-background contrast handles rgba/hsl/8-digit hex; Length accepts safe `calc()/min()/max()/clamp()`; Slider shows the bound value and writes clamped state back; number inputs accept decimal commas; Flashcard is a `div role="button"` so embedded controls are legal; Markdown keeps nested lists and renders h5/h6 as h4; `@Sqrt`/`@FormatDate` and other out-of-domain inputs no longer fail the whole card; `@Each`-generated Sections/Toc pass article validation, symbol-only anchors stay distinct, free layout skips page-rhythm warnings, and the gap warning only targets photo row lists; the prompt now tells the truth about Form/@ToAssistant forwarding, HtmlView network scope and the Example gap; exports removing follow-ups keep a mixed Card's prose; theme-less temporary results inherit the session's selected template theme in live cards and HTML exports; malformed `styleId` is rejected and unavailable templates warn; on-demand cap errors explain the cause and the re-arm action. The full audit/fix record is in the untracked `.tmp-audit/`; independent review is `.tmp-verify/round4/REPORT.md`.

Independent verification: 6/6 PASS (old CSS/component mutations fail the new checks; High/Max layout numbers unchanged). This round did not run a real-model DSH session.

## 2026-10-25 — 0.5.0 release

`@zephinel/dsh-intelligent-ui@0.5.0` is published on npm (`latest`) and as a GitHub Release.

- **Release chain**: annotated tag `v0.5.0` (tag object `5045afc`) points at release commit `c2a375f` and triggered `.github/workflows/publish.yml` [run 40190003142](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/40190003142). The first attempt failed transiently in the CI typography Chrome launch (`Chrome did not expose the page target`; the same commit passes locally), and the rerun succeeded in 51 s to complete Trusted Publishing with no code change.
- **Registry**: `latest` = `0.5.0`; tarball `dsh-intelligent-ui-0.5.0.tgz`, **43** files, shasum `b1567cb8448191054ae6787d5a46a85129bd0456`, about 4.1 MB (10.3 MB unpacked). It became visible about three to four minutes after publish (propagation delay, not a failed publish).
- **Signatures**: publish recorded provenance (transparency log logIndex **3460086916**); after installing `@0.5.0` in a throwaway directory, `npm audit signatures` reported **4 packages with verified registry signatures and 2 with verified attestations**.
- **GitHub Release**: [0.5.0 — 2026-10-25](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.5.0).
- **Release gate** (tree at the release commit): `npm run check` PASS, Node tests **247/247** (Host **117**, Client **109**, packaging **21**); renderer parse/render **42/42** each, CSS contract **50/50**, prop contract **63/63**, typography **22/22**, media-row **17/17**, pressable **9/9**; browser **7/7**; `npm pack` **43** files. The release notes include free layouts, template file import/export and this round's renderer-contract, Host-validation/warning and export-semantics fixes. This release did not run a real-model DSH session.

## 2026-10-25 — CI Chrome launch retry hardening (after 0.5.0)

The first 0.5.0 publish attempt hit a transient `typography-check` failure in CI (`Chrome did not expose the page target`); the rerun succeeded. `test/support/browser.mjs` now kills the process and relaunches Chrome with a fresh profile and port when no page target appears within 10 seconds, up to three attempts; `connectCdp` reuses the same wait helper. This is test-infrastructure-only and does not change the published artifact.

Validation (local, macOS + Chrome): `npm run check` PASS (Node **247/247**; renderer parse/render **42/42** each, CSS contract **50/50**, prop contract **63/63**, typography **22/22**, media-row **17/17**, pressable **9/9**); `npm run test:browser` **7/7** (on-demand 114, settings 101, standalone 46, image-export 65 assertions). No new version was published; the next tag carries this hardening.

## 2026-11-07 — Artifact base-registration lifecycle (uncommitted working tree)

This record covers the uncommitted base-registration increment on the current main working tree (`src/shared/artifact-base.ts`, `src/host/artifact-base.ts`, `src/client/artifact-edit/artifact-base.ts` plus the structure/history/restore wiring). It is not a release acceptance, and npm `latest` remains `0.5.0`. It fixes the root cause that a card rendered before the authoritative program registry existed could not enter authoritative state: one write-once base-registration lifecycle plus a unified base resolve/failure boundary cover both provenance shapes, the initial anchor (`revisionId === artifactId`) and the recorded anchor. There is no backfill or background migration, the model path is unchanged, nothing was committed or pushed, `dsh-web` was not restarted and no real-model session was run.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run build:host` | PASS; `lib/index.js` **823.0 kB** |
| `node --test test/host/*.test.mjs` | PASS; **253/253** (new `test/host/artifact-base.test.mjs` adds **12** tests) |
| `node --test test/client/*.test.mjs` | PASS; **257/257** (new `test/client/artifact-base.test.mjs` adds **5** tests; `test/client/artifact-edit.test.mjs` adds 3) |
| `node test/browser/artifact-edit.e2e.mjs` | PASS; **406 checks** (scenario 36 adds base registration, registration-before-structure ordering, old-Host 404 degradation and unified failure copy) |
| `npm run test:renderer` | PASS; parse **42/42**, render **42/42**, contrast OK, i18n **4**, typography **22/22**, media-row **17/17**, pressable **9/9**, CSS contract **50/50**, prop contract **63/63**, nested-css **28/28 direct + 5/5 scoped** |
| `npm run check` | **not fully PASS**: `tsc --noEmit` PASS, build PASS; of **531** Node tests **529 pass / 2 fail**. Both failures are packaging assertions caused by another pending increment in the working tree (the README real-screenshot assets): `test/packaging/manifest.test.mjs` expects 28 files under `assets/` but finds 32; `test/packaging/references.test.mjs` expects the `skills/intelligent-ui/references/integration.md` shipped-file quote to be 63 while it still says 59. Neither reads this increment's output; they are pre-existing baseline delta, and `skills/`, the READMEs and the assets belong to other members, so this task left them untouched. The renderer phase did not run inside that `check` invocation because `npm test` exited non-zero; it was run separately and passed (previous row). |
| `npm run pack:check` | PASS; **63** files, **5,730,101** bytes packed, **12,512,663** bytes unpacked (the `prepare` build ran first) |
| Build artifacts | Host **823.0 kB**; Client **4.00 MB** (js 3.79 MB + css 215.7 kB); standalone **3.33 MB + 514.4 kB** |

### Coverage

- Host: `POST /api/intelligent-ui/artifact-base` registration and disposer, auth before method dispatch, POST-only/content-type/bad JSON/>1 MiB → 413, field and program validation, initial-anchor and recorded-anchor registration, write-once no-op and 409 `program_conflict`, unknown revision and a record from another artifact, and the recorded anchor unlocking structure operations/history/restore; a no-model end-to-end upgrade — register → structure preview/apply **201 revision 2** → history with the initial revision and revision 2 → restore the initial revision **201 revision 3** — plus the structure route's `artifact_missing`/`base_missing` semantics and text regression.
- Client: `ensureArtifactBase` single flight, success cache, old-Host 404 → `unsupported` capability cache (no further probes for that revision), retryable network/malformed responses that never throw; wiring for opening the edit canvas, structure preview/apply, revision history and restore; preview now parses `error.code` and preview/apply/props share the unified missing-base copy (close-reopen, re-render, instruction-edit paths).
- Not covered: a real-model DSH session, a real old-Host process, or the real GUI after a `dsh-web` restart (the user has not approved one). Browser evidence comes from a temporary HTTP server plus headless Chrome harness, not a full DSH Web integration run.

## 2026-11-07 — Final verification after the README real-session screenshots, quick-adjust units and base registration (uncommitted working tree)

This record runs the final gate for three deltas in the same day's working tree and refreshes their counts: the README generation section now uses real DSH session screenshots; Divider/Spacer quick adjust offers only Default/px/% with a per-unit explanation; and the Artifact base-registration lifecycle (recorded separately above; this round is integration regression only). It is not a release acceptance, npm `latest` remains `0.5.0`, and nothing was committed or pushed and `dsh-web` was not restarted.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; `tsc --noEmit` + build; **531/531** Node tests = Host **253** + Client **257** + packaging **21**; renderer parse/render **42/42** each, contrast OK, i18n **4**, typography **22/22**, media-row **17/17**, pressable **9/9**, CSS contract **50/50**, prop contract **63/63**, nested-css **28/28 direct + 5/5 scoped** |
| `npm run test:browser` | PASS; **9/9** suites; `artifact-edit` **406 checks**, `nested-edit-renderer` **75**, on-demand **114**, settings **101** assertions, etc. |
| `npm run pack:check` | PASS; **65** files, **5,989,503** bytes packed, **12,783,390** bytes unpacked |
| `npm run capture:readme` | PASS; regenerated the component/editor/overview/component-tour/controls/temporary fixture captures so the switch copy matches the current code; the real-session generation Bento was **not overwritten** (`scripts/build-readme-bento.mjs` no longer contains the generation group; `scripts/build-readme-generation-bento.mjs` composes it separately) |
| Docs/structure checks | bilingual README heading levels match; screenshot references, language switches, clone URL, changelog links and local links/anchors pass; `git diff --check` PASS |

### Coverage

- Real-session screenshots: one English and one Chinese set of three different artifact types each (a Shanghai itinerary, a data dashboard, an interactive quiz), all generated in the running DSH GUI by DeepSeek V4.1 Flash · Max and captured at 2× from the production-rendered turn-tail cards. The raw captures ship in `assets/intelligent-ui-real-*`; the 1600×1130 composites have identical geometry in both languages. Sources, sessions and prompts are in `docs/screenshots/real-generation.md`. `npm run capture:readme` cannot reproduce the real-session captures.
- Quick adjust: Divider width and Spacer width/height offer only Default/px/%, with a one-line explanation under the row and in each menu option; legacy `auto` values are still accepted by the Host/renderer and display as Default, with Apply disabled until a real change; Host/renderer compatibility is unchanged.
- Base registration: see the record above; the integrated Node total and packaging counts follow its new tests and files.
- Not covered: a real old-Host process, the real client behavior after a `dsh-web` restart (no approval), reproduction of real-session screenshots by script, or a screen-reader/axe audit.


## 2026-11-07 — Independent-review fixes and final gate (uncommitted working tree)

This record covers the fixes for two read-only review subagents and the final gate. It is not a release acceptance; npm `latest` remains `0.5.0`; nothing was committed or pushed and `dsh-web` was not restarted.

### Fixes

- **F1 (owner decision A)**: the restore route's program-only fallback is back to its original semantics (`src/host/artifact-revisions.ts` is net-zero vs HEAD: a missing source record is accepted when its authoritative program is still retained, without an extra initial-identity check), with a new regression test for a non-initial orphan source.
- **F2**: the client `artifact-base` cache is invalidated when structure preview/apply/props returns `artifact_missing`/`base_missing` (and when history reports `hasProgram:false`), with an in-flight generation guard; close/reopen now really re-registers.
- **F3**: the program store writes to disk first and commits memory only on success; a failed write (e.g. EACCES) leaves no phantom record and retries safely.
- **F4**: base validation also caps the raw program length; a padded over-limit program returns 400 `invalid_program` instead of 500 storage.
- **F5/F6**: English described-unit menus get a larger height budget (272 px; measured 239 px content no longer clipped); the Default explanation is row-aware (Divider width spans its column, Spacer width fills the Row, Spacer height usually collapses).
- **F7**: the ensure-before-structure test now holds the base response unresolved and asserts no structure request before release; removing the await makes it fail (mutation-checked).
- Evidence/doc corrections: the viewport/size/language-order statements in `docs/screenshots/real-generation.md`, maintenance references, stale CHANGELOG claims and counts were corrected; the 4× itinerary raws were synced into `.tmp-report/real-generation/`.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; `tsc --noEmit` + build; **538/538** Node tests = Host **257** + Client **260** + packaging **21**; renderer parse/render **42/42** each, contrast OK, i18n **4**, typography **22/22**, media-row **17/17**, pressable **9/9**, CSS contract **50/50**, prop contract **63/63**, nested-css **28/28 direct + 5/5 scoped** |
| `npm run test:browser` | PASS; **9/9** suites; `artifact-edit` **422 checks**, `nested-edit-renderer` **75**, on-demand **114**, settings **101** assertions, etc. |
| `npm run pack:check` | PASS; **65** files, **5,989,940** bytes packed, **12,784,885** bytes unpacked |
| Docs/structure checks | bilingual README heading levels match; screenshot references, language switches, clone URL, changelog links and local links/anchors pass; `git diff --check` PASS |

### Not covered

A real old-Host process, the real GUI after a `dsh-web` restart (no approval), reproduction of real-session screenshots by script, or a screen-reader/axe audit; the zh overview composite still contains an English-UI settings panel (pre-existing language-match gap, unrelated to the real-session generation screenshots).

## 2026-11-08 — Natural-language style editing in the editor (B1) and scope-switch behavior fix (uncommitted working tree)

This record covers the final implementation and gate for B1 ("editing covers style adjustment", natural-language, revision semantics) and for "switching the scope no longer auto-opens the Display style panel". It is not a release acceptance; npm `latest` remains `0.5.0`; nothing was committed or pushed and `dsh-web` was not restarted.

### Implementation and security boundaries

- `ArtifactEditRequest` is now a block/style discriminated union; the block serializer is byte-identical and never emits `kind`; the style variant requires an explicit `editRequestId`, the recorded layout, a `styleInstruction` (≤2000) and the complete base program, and forbids every block/arrangement/global field.
- Host: a style request needs an explicit selector (H1 — never auto-applied by a selector-less `render_ui`); a side-effect-free peek runs before authorization (H2); a bound on-demand operation rejects the style apply (H3 — no double result-snapshot write for one callId); the snapshot validator is shared with on-demand; the revision records the model-returned `temporaryStyle` (H7) with no `styleId`/`editedBlockIds`; an unchanged program+snapshot is a no-op that keeps the request armed; a wholesale redesign adds the H4 preservation warning; `edit_ui_blocks` redirects style requests early and keeps them pending.
- Root-cause fix: before writing a revision, `ArtifactRevisionStore.record` records the ResultStore snapshot for revisions carrying a `temporaryStyle` (snapshot first, revision second; retryable). Temporary-style revisions from edit/restore/structure can therefore use Save as template on revision cards; no backfill.
- Client: a style section at the top of the edit panel (≤2000 chars, writes straight into the draft, exclusive with block requests via `style_mixed`), style chip/summary, `styleEdit` capability bit; a new Host with an editable card hides the footer Adjust style fallback (Save stays), old Hosts/non-editable cards keep it; persisted style instructions are cleared when the capability is absent.
- Scope switch: a successful switch only sends the enable command and never auto-opens the Display style panel; the panel has exactly two explicit entries (the Display style row and clicking the already-active scope entry when it resolves to enabled).

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; `tsc --noEmit` + build; **558/558** Node tests = Host **269** + Client **268** + packaging **21**; renderer parse/render **42/42** each, contrast OK, i18n **4**, typography **22/22**, media-row **17/17**, pressable **9/9**, CSS contract **50/50**, prop contract **63/63**, nested-css **28/28 direct + 5/5 scoped** |
| `npm run test:browser` | PASS; **9/9** suites; `artifact-edit` **447 checks**, `nested-edit-renderer` **75**, on-demand **114**, settings **101** assertions, etc. |
| `npm run pack:check` | PASS; **65** files, **5,992,803** bytes packed, **12,808,780** bytes unpacked |
| `npm run capture:readme` | PASS; the temporary-result captures now show Save as template (the footer Adjust style is gone for editable cards on a new Host) and the editor capture includes the new style section; the real-session generation Bento stays untouched |
| Docs/structure checks | bilingual README and five doc pairs keep matching heading levels; local links/anchors, screenshot references and changelog links pass; `git diff --check` PASS |

### Coverage and gaps

- Covered: style envelope/validation/serialization, Host mint/apply/authorization, H1/H3/H4/double-write mutation checks, revision snapshot boundary, history inference, capability bit and footer fallback, editor style section/focus/Escape/clear/chip, scope-switch E2E, screenshots and docs sync.
- Not covered: a real-model/real-GUI style adjustment (browser E2E uses a mocked Host); real mixed deployments (new Host + old client, old Host + new client); deterministic built-in/template style switching (B2, deliberately out of this increment).

### Corrections and follow-up (appended after the third review, 2026-11-08)

- The record's claim that the editor capture includes the new style section was false at writing time: the capture harness did not inject the `styleEdit` capability. It now does, and `assets/intelligent-ui-editing-{zh,en}.webp` plus the overview composites were recaptured; the current captures really show Style / Change style / Switch style / Apply style and the saved-Article hint.
- The record's "block serializer is byte-identical" claim no longer holds after the contract hardening: the block envelope header and program body stay compatible, but the prose is now generated by `blockEditToolContract` with a new `Tool-call contract:` line, so the whole text is no longer guaranteed byte-identical.
- The B1 real-GUI smoke was performed (2026-11-08, 上海两日游 session: the real model returned Revision 2, the style applied, the Save dialog opened, history listed it and the footer Adjust was hidden); the evidence is only the session transcript, with no retained screenshot, and it is not an automated gate.
- The current working-tree gate is now Node 615/615 (Host 298 + Client 296 + packaging 21) and `artifact-edit` 497 checks; the 558/447 values in this record are that gate's historical numbers.

## 2026-11-08 — Deterministic style switching (zero model, B2) final verification (uncommitted working tree)

This record covers the implementation and gate for B2 in-editor deterministic style switching. It is not a release acceptance; npm `latest` remains `0.5.0`; at writing time nothing was committed or pushed and `dsh-web` was not restarted (the B2 client bundle needs the next restart/refresh before it is visible in the real GUI).

### Implementation and boundaries

- Contract: the authenticated `POST /api/intelligent-ui/artifact-structure` gains a request-level `targetStyle` (builtin card/article or a saved `cs_` template) and `sessionStyleScope`; single-intent rules (with a target, operations must be empty and preview is unsupported; without one, the previous 1..20 ops/preview semantics stay). Targets are durable identities only; no client snapshot/directives/theme is accepted, and Free only works through a saved free template.
- Host: targets are resolved Host-side (`styles.resolve(styleId, sessionStyleScope)`; invisible/deleted → `style_missing`); Article reuses the exact render_ui Toc/Section+anchor predicate (`program-validation.ts`); for a base that already has a revision record (revision ≥ 2), the claimed base style/styleId is verified against the authoritative record (409 `base_style_mismatch`, nothing written — the H1 root-cause fix); the initial revision 1 has no record and keeps the request/registration identity; no-op rules (temporary-style base with any durable target always changes and drops the snapshot); a `struct_` revision records the same program, target style/styleId, no `temporaryStyle`/`editedBlockIds` (the H5 style-switch signature), keeping latest+1/branch/ledger/registry/response semantics; the digest binds target+scope; the `styleSwitch` projection capability is advertised.
- Client: the edit-panel style section adds a single-intent radio picker (built-in Card/Article plus visible saved templates, with swatches/layout meta, current badge, Article Toc/Section hint and temporary-style note); hover/focus previews the theme and Article shell locally with zero POSTs, and an explicit Apply sends the zero-model struct request. Success adds a local `kind:'style'` revision card, closes the editor and creates no composer chip; dirty/busy/current/no_change guards and `style_missing`/`article_unavailable`/`base_not_latest`/`base_style_mismatch`/`no_change` copy mapping are covered. History shows a `structure` revision without `editedBlockIds` as a style switch (old clients still see a structure operation; no new durable fields/enums).
- Limits: identity/shell/theme only — template directives do not reflow content; local revision cards do not enter the assistant message, export, replay or other devices; the H4 boundary was documented at that time (fixed in the third review round: pending block edits use the artifact recorded style); `sessionStyleScope` is template visibility scope, not authorization.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; `tsc --noEmit` + build; **603/603** Node tests = Host **292** + Client **290** + packaging **21**; renderer parse/render **42/42** each, contrast OK, i18n **4**, typography **22/22**, media-row **17/17**, pressable **9/9**, CSS contract **50/50**, prop contract **63/63**, nested-css **28/28 direct + 5/5 scoped** |
| `npm run test:browser` | PASS; **9/9** suites; `artifact-edit` **497 checks** (scenario 40 plus review-fix assertions), `nested-edit-renderer` **75**, on-demand **114**, settings **101** assertions, etc. |
| `npm run pack:check` | PASS; **65** files, **6,036,654** bytes packed, **12,874,349** bytes unpacked |
| Build | host **835.9 kB**, client **4.03 MB** (js 3.81 / CSS 220.0), standalone 3.33 MB + 514.4 kB |
| Docs/structure checks | bilingual README and five doc pairs keep matching heading levels; local links/anchors, screenshot references and changelog links pass; `git diff --check` PASS |

### Coverage and gaps

- Covered: contract unit tests, the Host struct-route matrix (article predicate/target resolution/scope/temporary-snapshot drop/no-op/H1/request shape/stale/branch/replay/zero-write) with five mutation checks, client exact POST body/dirty-busy-current guards/error mapping/local revision/history label, and E2E scenario 40 (picker/zero-POST preview/apply/local card/no chip/temporary behavior/error copy/keyboard a11y/capability-off regression).
- Not covered: the B2 picker in the real GUI with a real GUI/DOM cycle (zero model; the running process still serves the B1 bundle until a user-approved restart); real mixed deployments; the H4 fix (completed in the third review round); export/replay semantics of local style revisions (existing structure/property limitation).

## 2026-11-08 — Second-pass review fixes and model tool-call contract hardening (uncommitted working tree)

Follow-up record after a second independent read-only review (one code/security, one docs/evidence).

### Findings and fixes

- **Code HIGH**: the saved-template and temporary-style style envelopes had lost the `Pass style` instruction during the previous fix round. The Host requires `args.style === request.style` and `temporaryStyle.baseLayout === args.style`, so B1 style edits on those pages failed on the first model call. The first remedy merely restored the prose; the second-pass review correctly identified that as patching, because the model-facing prose and the Host-accepted arguments were two independent sources of truth and the tests only asserted text fragments.
- **Systemic fix**: added `styleEditToolContract`/`buildStyleEditToolArgs` and `blockEditToolContract`/`buildBlockEditToolArgs` as single contract sources; the block/style serializers now generate the `Tool-call contract:` line from those helpers instead of hand-written per-branch argument prose; new Host coupling tests execute the helper-produced real arguments for style (builtin/saved/temporary bases) and block edits (`edit_ui_blocks` fragments / `render_ui` order-only) and require the Host to record revision 2. Drift on either side fails the suite.
- **Same-round review fixes**: saved Article template rows get the `requiresArticleLayout` hint; the parser skips markers inside `<artifact-program>` (with a valid-JSON fake-marker regression test); removed the false "Host checks styleId" claim; `local-revisions` test count 3→5; stale English architecture counts/pack values, CHANGELOG pointers, README commit-state and "select then Apply style" wording, and remaining doc residues fixed; editor/overview screenshots recaptured.
- Recorded boundary: the block-edit and style-edit model contracts are now pinned by helpers plus Host coupling tests; branch and other tool-copy paths remain hand-written prose without the same contract treatment.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **603/603** Node tests = Host **292** + Client **290** + packaging **21**; renderer/contracts green; build host **835.9 kB**, client **4.03 MB** (js 3.81 / CSS 220.0), standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **497 checks**, `nested-edit-renderer` 75, on-demand 114, settings 101 |
| `npm run pack:check` | PASS; **65** files, **6,036,654** bytes packed, **12,874,349** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references, `git diff --check` all OK |

## 2026-11-08 — Third-review fixes (contract hardening, parser and edge paths; uncommitted working tree)

Record of the fixes after the third independent read-only review (code/security + docs/evidence). The review found the contract coupling tests hollow; this round tightened them and fixed the listed edge paths.

### Fixes

- **Tool-argument contract tightened**: the Host coupling tests now use a fragment request with `requestId`/`artifactId` and an order-only request with `styleId`/`editRequestId`, assert the helper's exact key set and the contract's required/optional/forbidden fields, and add two-pending selector, order-only title/styleId, session-template-vs-artifact-style (H4), and forged-snapshot (registry wins) cases.
- **Parser hardening**: block prose escapes `<` in instructions/additions/global text; an envelope requires a JSON header on the next line; `<artifact-program>`/`</artifact-program>` are located by their own-line fences, so literal markers inside the program body can no longer truncate it; valid-JSON fake markers and a literal program marker are covered by regression tests.
- **Edge paths**: order-only/global-only results now carry the recorded title/styleId and `presentationMeta`; temporary-style additions-only sends are no longer mislabelled `temporary_order`; a pending block edit renders the artifact's recorded style instead of the session template (removing the H4 deadlock); content edits take the registry temporaryStyle as authoritative; an unsaved block draft blocks a style switch; Article-hint/dirty copy is accurate.
- **Capability/accessibility**: `styleSwitch` is now derived from whether `registerArtifactStructureRoute` mounted (not advertised when the route is absent); the branch instruction line is single-sourced through `branchEnvelopeLine`; forced-colors gains a native-radio keyboard focus ring (E2E asserted), and the docs no longer claim E2E covers `struct_` history labelling (unit tests do).
- Remaining recorded LOW: a visible but unselected global template still produces the model-facing "not available" warning (the model should not pass an unselected template id).

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **615/615** Node tests = Host **298** + Client **296** + packaging **21**; renderer/contracts green; build host **836.8 kB**, client **4.03 MB** (js 3.81 / CSS 220.0), standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **497 checks**, `nested-edit-renderer` 75, on-demand 114, settings 101 |
| `npm run pack:check` | PASS; **65** files, **6,047,986** bytes packed, **12,890,199** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references, `git diff --check` all OK |

## 2026-11-08 — Fourth-review fixes (deferred route capability, title escaping, summary fence; uncommitted working tree)

The fourth review found that the route-derived `styleSwitch` returned false synchronously under real cordis while the wire schema only accepted `true`, producing an invalid view and hiding the picker; block titles were not escaped in envelope prose; `nextEditRequestSummary` still substring-scanned program fences; plus docs/test-coverage issues.

### Fixes

- **Capability**: `registerArtifactStructureRoute` no longer relies on a synchronous return; it calls `onMounted` (or `onUnavailable`) from the deferred inject callback, and `modeViewSchema` accepts an optional boolean `styleSwitch`. Added deferred-inject and false/absent-view parse tests.
- **Parsing**: block target-prose titles are escaped; `nextEditRequestSummary` locates the end with `programFence` (inline close markers can no longer truncate it), with exact-end assertions.
- **Test integrity**: the forced-colors E2E asserts the 2px focus-ring rule (the checked-row 1px outline no longer satisfies it); the E2E successful switch applies a reachable saved card template (an Article target on the DST program is rejected by the real Host); the style contract gains required/optional arrays; added a temporary-style additions-only Host test, an order-only branch unit test and a presentationMeta styleId assertion.
- **Docs/screenshots**: the stale H4 limitation is fixed; the B2 historical record notes H4 was fixed; the README example name matches the image (pour-over calculator); contract-prose wording narrowed to "only the Tool-call contract line is helper-generated"; the capture fixture gains `--dsw-alias-brand-primary` / `--dsw-alias-label-primary-foreground` and was recaptured, so Apply style is visible; doc-map/CSS/pack numbers synced.
- Remaining: the structure route's authoritative-snapshot branch is exercised only on the apply side (same policy, no route-specific test); real Windows High Contrast/real GUI untested.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **615/615** Node tests = Host **298** + Client **296** + packaging **21**; build host **836.8 kB**, client **4.03 MB** (js 3.81 / CSS 220.0), standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **497 checks**, `nested-edit-renderer` 75, on-demand 114, settings 101 |
| `npm run pack:check` | PASS; **65** files, **6,047,986** bytes packed, **12,890,199** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references, `git diff --check` all OK |

## 2026-11-08 — Stabilization guards (unified envelope scanner, capture-token contract, deferred inject, docs facts; uncommitted working tree)

Four structural guards added after the review loop:

- **Unified envelope parsing**: `scanEnvelopeWindows()` is now the single window source for parse/summary/split; program-close detection was fixed for directly concatenated envelopes without a trailing newline, with a parse/summary regression.
- **Capture-token contract**: `test/renderer/capture-token-contract-check.mjs` scans `src/**/*.css` for `--dsw-alias-*` references and requires the capture fixture `:root` to define every one; missing tokens were added and the editor/overview captures recaptured (Apply style visible).
- **Plugin-level deferred inject test**: `test/host/mode.test.mjs` gains a `deferInject` mount that drains cordis inject callbacks and then asserts the projection view parses and reports `styleSwitch: true`.
- **Docs facts source**: `docs/current-facts.json` records the current gate, and `scripts/check-doc-facts.mjs` (wired into `npm run check`) validates README/architecture/latest verification/CHANGELOG current values; historical records keep historical numbers. Limitation: the JSON is still refreshed manually after a gate, but current values have one source and omissions fail check.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **617/617** Node tests = Host **299** + Client **297** + packaging **21**; build host **836.7 kB**, client **4.03 MB** (js 3.81 / CSS 220.0); includes capture-token and doc-facts checks |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **497 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,047,986** bytes packed, **12,890,199** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references, `git diff --check` all OK |

## 2026-11-08 — B2 real-GUI acceptance after restart

- Source gate for this tree: Node **617/617** = Host **299** + Client **297** + packaging **21**; `artifact-edit` **497 checks**; build host **836.7 kB**, CSS **220.9** kB; pack **6,047,986** / **12,890,199** bytes.

- dsh-web restarted to pid **15525** (launchd loaded, port 3080 owned by it, unauthenticated root 401, clean startup log); the real GUI was opened with the new URL.
- In the 上海两日游 session (already carrying the B1 Revision 2): opened the card editor → expanded the style section; the **B2 switch group appeared** (built-in Card/Article; the page is a temporary-style base, so no current row and the temporary note was shown); selecting built-in Card enabled **Apply style**; applying closed the editor with no alert and added a local revision card labelled **"Style revision" / Revision 3**, with unchanged content/layout.
- Conclusion: the `styleSwitch` capability and projection view are valid under real cordis (the visible picker proves the view schema parsed), and the real structure-route POST succeeded; the B2 zero-model path works in the real GUI.
- Not covered: real forced-colors hardware, real mixed Host/client deployments, real model (B2 is zero-model by design).
- Note: this acceptance appended one local style revision (Revision 3, content unchanged) to the 上海两日游 session for verification.

## 2026-11-08 — Revision-history deletion (true Host removal + local-card cleanup)

- **UI**: every recorded revision in the history dialog now has a Delete action behind an inline confirmation; the initial render (Revision 1) is not deletable. The current/latest record may be deleted and the next newest becomes latest. Failures show a clear reason (`409 revision_referenced` / `404 revision_missing`).
- **Host**: `DELETE /api/intelligent-ui/artifact-revisions?artifactId=&revisionId=` shares authentication, `effect` and the disposer with the GET probe. `ArtifactRevisionStore.remove()` refuses a revision that is still another record's `baseRevisionId` and atomically rewrites the registry; the retained program is removed too (a failed cleanup only leaves an LRU-prunable orphan). No new durable field or `ArtifactHistorySource` enum value.
- **Client**: after a successful delete, the matching `localStorage` local revision card is removed and the open history refreshes; already-rendered model message cards are not removed (see limitations).
- **Boundaries**: irreversible; a referenced revision requires deleting the newer one first; after deleting the current revision, other cards' revision badges may keep their old value until the next authoritative action; a deleted base makes still-referenced drafts/branches fail at send with `base_missing`; deletion does not undo the `struct_` idempotency ledger entry (the same operationId must not be replayed).
- **Verification**: Host artifact-revisions tests 32 (delete success/referenced/initial/program cleanup), client local-revisions 7 (local-card removal + API outcome mapping), browser `artifact-edit` **498 checks** (confirm → delete → local card gone).

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **621/621** Node tests = Host **301** + Client **299** + packaging **21**; build host **837.4 kB**, client **4.04 MB** (js 3.82 / CSS 221.6), standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **498 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,032,790** bytes packed, **12,879,500** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references, `git diff --check` all OK |

## 2026-11-08 — Style/edit integration (eligibility, one status line, idempotent retry, save boundary)

- **Boundary**: the unification point is "one Artifact, one revision line, one style entry", making style switch and style instruction operation types of Artifact editing. Block/structure edits still change the program; a style switch is zero-model and keeps the program byte-identical; a style instruction produces a temporaryStyle through the model. Saving a template is not an edit and creates no revision.
- **Eligibility**: the Article predicate moved to `src/shared/article-layout.ts` and is shared by the Host and client; when the page has no usable Toc/Section/anchors, the Article row is disabled with a one-line reason. A new pure `style-targets.ts` computes the Apply blocker (checking / non-branch stale / busy / dirty / instruction / no target / unavailable / current); the style section shows one status line instead of the previous permanent notes.
- **Revision and retry**: a non-branch older revision disables Apply; an explicit branch is allowed and explained. The request carries a reusable `styleSwitchOperationId`: after a lost response the retry reuses it and the Host idempotency ledger returns the recorded result, avoiding `base_not_latest` or a duplicate revision.
- **Save**: Save-as-template remains available only for theme-bearing temporary results (B1/on-demand), on the result/revision card rather than inside the editor; switch results are not saved and saving creates no revision. Templates remain live references: theme changes/deletion affect older switch revisions, documented in limitations; branches are never automatic.
- **Tests**: two new client `style-targets` pure-function tests and two store tests (Article pre-rejection; lost response retrying with the same operation id); the E2E now covers Article disabled, one status line, keyboard skipping disabled targets and dirty pre-disable, with `artifact-edit` at 500 checks.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **625/625** Node tests = Host **301** + Client **303** + packaging **21**; build host **837.6 kB**, client **4.04 MB** (js 3.82 / CSS 221.9), standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **500 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,025,580** bytes packed, **12,879,400** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references, `git diff --check` all OK |

## 2026-11-08 — Style-row visibility closeout

- The style section stays collapsed to one row with the current style; a small swatch appears when the current style carries a theme.
- A filled style description adds a "Style note pending" marker to the collapsed row and a style-description row to the send summary (not counted as block edits); DraftDock no longer labels a pure style draft as "global instruction".
- The target group is labelled "Switch now" and the description field "Or describe it (model-applied)" so the zero-model switch and model-applied description remain distinct.
- No popover, pending page-operation queue or in-editor save entry was added: a switch still records a revision immediately, the description still uses the composer/model path, and saving stays limited to theme-bearing temporary result cards.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **625/625** Node tests = Host **301** + Client **303** + packaging **21**; build host **837.6 kB**, client **4.04 MB** (js 3.82 / CSS 222.4), standalone 3.33 + 514.4 |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **504 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,031,253** bytes packed, **12,885,993** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references, `git diff --check` all OK |

## 2026-11-08 — Save entry scope A (new template only)

- The Save note now says it creates a new template, does not overwrite built-ins or existing templates, and leaves other pages unaffected.
- Availability is unchanged: only theme-bearing temporary style result cards show Save; built-in Card/Article, saved-template, plain and theme-less temporary results have no Save entry.
- No "update original" or "copy saved template" action: no result currently has both a source styleId and a complete snapshot, the template update route only accepts name/description/directives, and templates are live references whose in-place update would affect older pages; that needs a separate design.
- E2E adds three negative assertions (built-in, saved-template and theme-less temporary results have no Save); saving still creates a new template and no revision.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **625/625** Node tests = Host **301** + Client **303** + packaging **21**; build host **837.6 kB**, client **4.04 MB** (js 3.82 / CSS 222.4) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **507 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,031,281** bytes packed, **12,885,957** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references, `git diff --check` all OK |

## 2026-11-08 — Fixes from the unreviewed commit batch

Fixes after the independent read-only review of `852e331..HEAD`:

- **Envelope sibling regression**: `programFenceFrom` bounds the search at `nextEnvelopeOpen` and the close fence keeps its line constraint, so a header without a program cannot borrow the next envelope's program. A regression covers "first missing program, second complete".
- **Deletion idempotency**: a DELETE `revision_missing` answer converges (removes the local card and refreshes); the revision rendered by the opening card cannot be deleted; the DELETE route maps storage failures; the Host auth test covers DELETE.
- **Late stale answer**: a non-branch `base_not_latest` moves the store to `conflict`, so the status line and disabled Apply agree instead of showing ready.
- **Docs/tests**: corrected DELETE route, Article predicate location, current-card deletion limit and stale/base_missing wording; client unit tests add the missing-program boundary, while E2E adds the current-card deletion guard and missing-delete convergence.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **626/626** Node tests = Host **301** + Client **304** + packaging **21**; build host **837.9 kB**, client **4.04 MB** (js 3.83 / CSS 222.4) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **509 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,031,527** bytes packed, **12,886,783** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references, `git diff --check` all OK |

## 2026-11-09 — Remaining P3 review fixes

- **Delete-confirmation accessibility**: confirmation focuses Cancel, cancelling returns focus to Delete, and the warning is announced as `role=status`; the history dialog's initial focus is synchronous so a deferred rAF cannot steal the confirmation focus.
- **Delete negative paths**: a Host cross-artifact DELETE test; DELETE included in the 401/403 auth loop; the UI forbids deleting the revision rendered by the opening card and the initial revision; the `revision_missing` convergence has E2E coverage.
- **Explicit-target bypass**: `applyArtifactStyleSwitch` no longer accepts an explicit target and only uses the session selection, so callers/tests cannot bypass the Article gate; store tests select first and then apply.
- **Test realism**: the retry test returns a 200 replay on the second call, the E2E asserts the switch revision keeps the base program, and computed-style assertions cover the 16px circular radio and square/edge-filled swatch; stale E2E comments and the browser README are corrected.
- **Docs**: restored historically rewritten verification gate numbers (615/298/296 etc.) to their original values; corrected the DELETE route, shared Article predicate path, current-revision deletion limit and stale/base_missing wording; strengthened doc-facts (sum, browser suite, pack file count); removed unused style copy keys and test references.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **627/627** Node tests = Host **302** + Client **304** + packaging **21**; build host **837.9 kB**, client **4.04 MB** (js 3.82 / CSS 222.4) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **519 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,031,255** bytes packed, **12,885,706** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references, `git diff --check` all OK |

## 2026-11-09 — Second review fixes (focus regression, layout gate, docs facts)

- **Post-delete focus escape (P2)**: the history dialog's mount/cleanup effect is now mount-only, keydown reads the latest callback through `onCloseRef`, and after a successful delete / `revision_missing` convergence a post-render effect returns focus to the dialog Close; parent rerenders no longer run cleanup that sends focus back to the trigger. E2E asserts focus remains inside the open dialog after deletion.
- **Cross-row focus**: `HistoryRow` only returns focus to its own Delete on a real cancellation (`confirmingDeleteId === null`), not when moving confirmation to another row.
- **Article/layout gate**: after removing the explicit target argument, the layout is derived from the chosen builtin layout or the selected template layout; a template without its layout fails before the request, and built-in Article always uses the shared predicate.
- **Docs facts**: the 625 gate keeps its packed bytes at 6,031,253; the 627 gate keeps its actual js 3.82; the 628 gate and current facts are 3.83; moved the missing-program claim from E2E to the client unit test; doc-facts now slices the true latest `##` record, uses the fixed nine-suite denominator, and checks `clientJsMb`.
- **Known residual**: a latest revision rendered by another card can still be deleted and later fails as stale/base_missing; the docs and delete warning now state that other cards may become stale. A complete fix needs a render lease/card invalidation mechanism, out of this round.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **628/628** Node tests = Host **302** + Client **305** + packaging **21**; build host **837.9 kB**, client **4.04 MB** (js 3.83 / CSS 222.4) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **519 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,031,830** bytes packed, **12,887,088** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references, `git diff --check` all OK |

## 2026-11-09 — Single history entry and deletion rollback

- **One entry point**: the standalone `Revision N` button is gone from the card header and the history icon is the card's only history entry; when the rendered revision number is above 1 the icon is followed by that number and the accessible label carries it (`data-dsh-iui-history-count`). The edit-panel header keeps its own history icon; before and after the collapse every entry rendered the same `ArtifactHistory` over the same Host history.
- **Deletion rollback**: before a delete, `ArtifactHistory` uses `rollbackTargetFor()` to pick the newest smaller revision with a retained program, loads it through the history-program route and stores it in the new `artifact-edit/revision-fallbacks.ts` (`localStorage`, at most 20 per chat, deduplicated by deleted revision id); `IntelligentUICards` then uses `applyRevisionFallback()` to replace every tool-result card still rendering the deleted revision with the fallback (keeping `callId`/`requestId`/card position), and the redirect survives a reload; `export-data.ts::programsForMessage` applies the same fallback. When no fallback is available the card's own rendered revision offers no delete, and the confirmation copy names the rollback revision.
- **Local cards**: deleting a local revision card (restore/structure/property/style) still removes it via `removeLocalRevision()` and records no fallback.
- **Tests**: new `test/client/revision-fallbacks.test.mjs` (9 tests at landing: target selection, style/title replacement, persistence/deduplication/cap, malformed entries ignored, indexing); `export-data.test.mjs` gains 1 export-fallback test; browser `artifact-edit` gains scenario 41 (single entry and revision number, rollback confirmation, rolled-back content and revision number, rollback surviving a rerender, no delete without a fallback) and updates the earlier history assertions.

### Automated results

| Command / check | This round |
| --- | --- |
| `npm run check` | PASS; **637/637** Node tests = Host **302** + Client **314** + packaging **21**; build host **837.9 kB**, client **4.05 MB** (js 3.83 / CSS 222.2) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **530 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,033,184** bytes packed, **12,892,076** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references and `git diff --check` all OK |

## 2026-11-09 — Local image sources (Image / Markdown)

- **Shared policy**: new `src/shared/image-source.ts` classifies http(s)/data/path sources; `data:` accepts base64 `png/jpeg/webp/gif` only (≤512 KiB decoded); paths reject NUL/control characters, `..`, `~` and URL schemes (both absolute and workspace-relative paths are accepted); local files are capped at 10 MiB, images at 40 MP, the MIME is sniffed from magic bytes and SVG is refused. `test/client/image-source.test.mjs` adds 14 tests for classification, path policy, MIME sniffing, header pixel caps, data-URI headers, SVG recognition and error mapping.
- **Client read**: new `src/client/image-source.ts` reads bytes through the optional `remote.workspaceFiles.stat/readBytes`, sniffs the type and creates a same-origin blob URL; `src/client/index.tsx` binds it with `ctx.inject(['remote.workspaceFiles'])`, degrading local paths to the unsupported-Host placeholder when absent.
- **Renderer**: new `src/lib/components/image-source.tsx` (provider, `useImageSource`, error placeholder); an explicit `Image` source that fails shows the placeholder and never searches by `alt`, while `SearchImage` is unchanged; Markdown supports `![alt](src)`; `OpenUIRenderer`, cards and the edit canvas accept the optional `resolveImage`. Also fixed the condition that rendered an `<img>` without `src` for a source that was still resolving.
- **Export**: PNG settle treats the error placeholder as settled; the HTML export reads blobs back from live `img[data-iui-image-src]` elements as data URLs and inlines them through the `mountIUI` `assets` map, and the standalone page builds its resolver from that map. Browser `artifact-edit` scenario 42 covers local/inline/http/missing/broken/SVG/escape/Markdown images and "an explicit source never searches"; `standalone-page` asserts the inlined image and the missing-map placeholder.
- **Contracts and docs**: `scripts/generate-prompt.mjs` gained an Image description rewrite (guarded; the vendored text stays untouched) and an image-source contract section; `vendor/spec.json`, the generated prompt, `skills/intelligent-ui/SKILL.md`, `references/components.md` and the README/usage/limitations/architecture docs were synchronized; `test/packaging/guardrails.test.mjs` guards the single-sourced contract. On an old Host without workspace-files only local images degrade; http/data sources are unchanged; local images inside `HtmlView` and SVG sources are unsupported in v1.

### Automated results

| Command / check | This round |
| --- | --- |
| `npm run check` | PASS; **649/649** Node tests = Host **302** + Client **325** + packaging **22**; build host **839.6 kB**, client **4.06 MB** (js 3.84 / CSS 222.9) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **538 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,040,072** bytes packed, **12,912,120** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references and `git diff --check` all OK |

## 2026-11-09 — Independent-review fixes (systemic closeout)

Two read-only independent reviews (implementation depth + release readiness) merged to: no P0, two P1s, six P2s after deduplication; this round fixes them at the root and adds coverage.

- **P1 result identity**: new `resultIdOf(program)` (`revisionId ?? callId`) is now used by Save as template and the footer Adjust, so after a rollback they address the visible fallback revision instead of the deleted revision's result snapshot.
- **P1 explicit empty source**: any string `Image` src is explicit; empty/whitespace becomes a `path-invalid` placeholder and never searches by `alt`.
- **P2 export settling**: Photo/Markdown local resolution marks `data-iui-image-pending`; PNG and HTML export wait for it. Offline mode only skips the search wait, while local images still settle. HTML asset keys use the canonical (trimmed) source.
- **P2 local-card fallbacks**: the parent passes the session's local revision ids to the history dialog, so deleting a local-card revision records no fallback (matching the docs); fallback entries additionally respect a serialized-size budget (`MAX_REVISION_FALLBACK_STORAGE_CHARS`).
- **P2 open-draft deletion lock**: the revision an opening card renders cannot be deleted while that card has an open canvas/unsent draft; the history row explains why.
- **P2 contracts and copy**: `vendor/spec.json` components and schema `$defs` descriptions are synchronized and guarded per component; Markdown image syntax joined the prompt/spec/reference; the stale troubleshooting Image row was corrected; README/usage/limitations/architecture now state the no-fallback cross-card stale case, initial-revision borrowed style, HTML mounted-only images and the draft lock.
- **P3 systemic fixes**: local SVG recognized by content as `svg-unsupported`; `//host/x` normalized to https and `DATA:` accepted case-insensitively; Markdown `<...>` destinations (spaces/parentheses); 40 MP cap pre-read from PNG/JPEG/GIF/WebP headers (unknown headers still checked after load); `bounded()` races a real timeout so a Remote ignoring abort cannot stall; ImageError's accessible name includes the reason; coverage added for absolute/padded paths, empty source, angle destinations, DOM asset collection, local-image PNG export and the draft lock.

### Automated results

| Command / check | This round |
| --- | --- |
| `npm run check` | PASS; **657/657** Node tests = Host **302** + Client **332** + packaging **23**; build host **840.8 kB**, client **4.06 MB** (js 3.84 / CSS 222.9) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **547 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,042,022** bytes packed, **12,918,700** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references and `git diff --check` all OK |

## 2026-11-09 — Second independent re-review fixes (systemic closeout)

Two fresh independent read-only reviews confirmed all eight previous fixes and found new rollback-lifecycle issues; this round fixes them at the root and reruns every gate.

- **P1 fallback chain**: `resolveRevisionFallback()` follows chained deletions (depth/cycle bound 20), and recording a fallback retargets older entries whose target is the deleted revision; cards and `export-data.ts` share it, so deleting a fallback revision cannot leave a card on a deleted record.
- **P2 ownership/concurrency**: `rollbackTargetFor()` skips revisions owned by client-local cards; redirected cards carry `fallbackFrom` and are read-only, so a fallback revision has one editing owner and cannot mount two canvases; the draft lock is session-wide (`unsentDraftRevisionIds()`), so any card's unsent draft blocks its base revision.
- **P2 source semantics**: `Image` and `SearchImage` have explicit modes; a dynamic/non-string `src` is an invalid explicit source and never searches.
- **P2 export**: the HTML page export uses `settleLocalImages()` and waits only for local source resolution (short bound) instead of the full 12.5 s photo wait; inline `data:` images also get the header-level 40 MP pre-check.
- **P3**: the Host history response carries `referenced`, so a revision still used as a newer revision's base hides Delete with an explanation; a renderer-level guard compares all 49 runtime component descriptions with `vendor/spec.json`; SVG guidance is scoped to path/data sources; docs fix the Host read-authority boundary, portaled-Popover/failed-image export placeholders and the fallback-chain/read-only-card/cross-card-draft-lock design; proof/test counts are corrected (standalone 50, image-export 66, revision-fallbacks 13, image-source 16) and the unsupported "unused hook removed" claim was dropped.
- **Gate-count verification**: the second review reported artifact-edit 547 as false (530 static `check(` calls); an instrumented run showed helper-invoked checks execute multiple times (`chooseQuickOption` 12, `unitOptionsOf` 4), so the runtime count (547/557) is the real gate and was not "corrected" to the static number.

### Automated results

| Command / check | This round |
| --- | --- |
| `npm run check` | PASS; **663/663** Node tests = Host **302** + Client **338** + packaging **23**; build host **841 kB**, client **4.06 MB** (js 3.84 / CSS 222.9) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **557 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,043,599** bytes packed, **12,924,267** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references and `git diff --check` all OK |

## 2026-11-09 — Third independent re-review fixes (double-canvas / rollback lifecycle closeout)

A third pair of fresh independent read-only reviews reproduced the same P1 and several P2/P3 issues; this round fixes them at the contract level and reruns every gate.

- **P1 redirected double canvas**: `editing`, `editorMounted`, the draft badge and the `ArtifactEditView` mount are all gated on `fallbackFrom === undefined`; opening the native fallback revision's editor leaves the redirected card with zero `[data-dsh-iui-edit-view]`. Scenario 41 asserts it.
- **P2 result-bound actions**: a fallback to the initial revision borrows `records[0].temporaryStyle` in Host history, so the redirected card now hides Save/Adjust (no matching result snapshot); scenario 46 covers it.
- **P2 deletion failure/dependency lock**: any known fallback target whose program fails to load aborts with a retry message, and a revision that a card's fallback targets cannot be deleted unless an older fallback exists (with `edit.historyDeleteDependencyLocked`), keeping the transitive chain from landing on a deleted record; scenario 47 covers the dependency lock and the chained retarget after deleting the target.
- **P3 systemic fixes**: redirected cards skip runtime-state publication; the per-session image resolver is memoized; the HTML export collects assets only for exported cards and groups them by card callId + source (no cross-card collapse of the same path); the renderer description guard fails when a described runtime component loses its description (49/49); `data:` size estimation subtracts base64 padding; `//host` is a URL only when the authority has a dot/port, otherwise it stays a double-slash path; cycle/depth tests seed a real persisted cycle and the 20/21-depth boundary; docs fix session-wide draft copy, dependency/Save-Adjust caveats, SVG scope, cross-tab limits, per-card assets and test counts (`revision-fallbacks` 13, `image-source` 17, `artifact-edit` 566); `.gitignore` ignores `video/`.
- **Gate-count verification**: the third review's static-count discussion (547/557 vs `check()` sites) was again resolved by the runtime count (helper-invoked checks execute more than once); this round's real numbers are artifact-edit **566** and Node **664**.

### Automated results

| Command / check | This round |
| --- | --- |
| `npm run check` | PASS; **664/664** Node tests = Host **302** + Client **339** + packaging **23**; build host **841 kB**, client **4.06 MB** (js 3.85 / CSS 222.9) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **566 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,044,044** bytes packed, **12,926,327** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references and `git diff --check` all OK |

## 2026-11-09 — Fourth independent re-review fixes (live fallback / test fidelity closeout)

A fourth pair of fresh independent read-only reviews found no P0/P1 runtime blocker and all gates green; the remaining P2s were dead fallback records falsely blocking deletes, an e2e fixture that did not derive `referenced` like the real Host, and docs that still described Save/Adjust as addressing the fallback revision. P3s were contract/comment/boundary items. This round fixes them.

- **P2 live-fallback semantics**: `namedRevisionIds()`, `liveFallbackTargetIds()` and `needsRevisionFallback()` distinguish live fallbacks from dead historical records; only a revision still named by a rendered program or still targeted by a live fallback records a fallback, and the dependency lock ignores dead records. Unit-tested.
- **P2 e2e fixture fidelity**: the history mock now derives `referenced` from all records' `baseRevisionId` like the Host; scenario 20 asserts the referenced row hides Delete with an explanation, while the real rollback copy remains covered by scenario 41.
- **P2 docs**: architecture/README/usage/limitations/skill/CHANGELOG now say normal cards use `resultIdOf` while redirected read-only fallback cards hide Save/Adjust (a fallback to the initial revision borrows a style snapshot with no matching result snapshot); deletion prose includes the dependency-lock exception; the `//host` normalization caveat is documented.
- **P3**: `ArtifactHistoryProps` declares `fallbackTargetIds`/`renderedRevisionIds`; an empty result-actions wrapper is no longer rendered; the `export-data` comment states its real dependency rather than claiming React-free; export asset maps use null-prototype objects and string checks (safe for `__proto__`/`constructor` paths), with consistent `''` callId buckets; `MAX_INLINE_IMAGE_DATA_URL_CHARS` is named for its unit; cycle/undefined comments match behavior; late-injected workspaceFiles and fallback-eviction reload behavior are documented in limitations; the flaky input-orbit geometry assertion waits for settled geometry.
- **Numbers**: Node **665/665** = Host **302** + Client **340** + packaging **23** (new live-fallback test); artifact-edit **566 checks**; pack **65 files / 6,044,247 / 12,927,122**.

### Automated results

| Command / check | This round |
| --- | --- |
| `npm run check` | PASS; **665/665** Node tests (Host 302 / Client 340 / packaging 23); build host **841 kB**, client **4.07 MB** (js 3.85 / CSS 222.9) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **566 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,044,247** bytes packed, **12,927,122** bytes unpacked |
| Structure | bilingual heading parity, local links/anchors, screenshot references and `git diff --check` all OK |

## 2026-11-10 — M1 active revision stage and visibility fallback

- **Version store**: new `src/client/artifact-edit/artifact-version.ts` (in-memory store + pure reducer, `useSyncExternalStore`). Per `(sessionId, artifactId)` it keeps revisions, latest/selected revision, stage card and stage visibility; the first card becomes the stage and selects latest; a newer revision while the stage is visible only produces a notice row and updates the stage in place; while the stage is invisible the new card is promoted and the old stage freezes; same/older revisions are notice/frozen by turn/revision; when the stage unmounts the newest remaining card takes over, and after the last card unmounts the artifact state is forgotten so a reload/remount converges on the latest again (D6).
- **Card roles**: `IntelligentUICards` gains `ArtifactVersionGate` — the stage renders the selected revision synthetically while keeping its own `data-dsh-iui-call-id` and carrying `data-dsh-iui-stage-card`/`data-artifact-id`/`data-dsh-iui-stage-visible`; edit key, history `currentRevisionId` and runtime state follow the selected revision. A notice renders one `data-dsh-iui-revision-notice` row that scrolls to and focuses the stage; a frozen card renders its own revision with `data-dsh-iui-stage-stale-hint`; a stage displaying a frozen card's native revision stays read-only so two canvases are never mounted.
- **Consistency**: `reconcileArtifactSubmissions` keeps using the Turn's original programs; local revisions pass through the same gate; history deletion still prepares the revision-fallback record and then calls `forgetArtifactRevision` so latest/selected point at a live record and the stage is never dangling; selected/latest revision ids join `renderedRevisionIds` for the delete guard.
- **Test switch**: `setArtifactVersionStageEnabled(false)` is harness-only; `artifact-edit` scenarios 1–47 keep the pre-M1 one-card-per-revision assertions (all original checks retained) and the new scenario 48 enables the stage for M1; production defaults to enabled with no persistence, Host route or new revision enum value.
- **Tests**: `test/client/artifact-version.test.mjs` 20 cases (first-card stage, visible in-place update, invisible promotion, initial convergence, frozen older cards, stage re-registration, unmount hand-over/forget, remount convergence, selectRevision, deletion repointing with fallback records, stageProgramFor identity synthesis, read-only rule, latest ordering, module store registration/visibility/disable switch); E2E scenario 48 (visible in-place update with no new card, notice copy and click-to-focus, editing against the selected revision, invisible promotion with frozen hint, remount back to latest, read-only older selection, local revision suppression and remount promotion); the suite grows 566 → **599 checks**.
- **Known limits/risks**: M1 has no version bar/thumbnails/persistence (M2); suppressed revisions have no full card while image/HTML export keeps the existing semantics (M3 alignment is a known regression risk; export untouched); frozen cards keep their existing edit entry; real screen readers/coarse pointers were not separately validated.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **685/685** Node tests = Host **302** + Client **360** + packaging **23**; build host **841 kB**, client **4.08 MB** (js 3.86 / CSS 225.0) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **599 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,047,081** bytes packed, **12,943,001** bytes unpacked |
| Structure | the new record exists in both languages; `npm run check:docs-facts` passes; `git diff --check` passes |

## 2026-11-10 — M2 recent-tasks version bar, screenshot thumbnails and FLIP switching

- **Version bar**: the stage card's history icon now opens a horizontal "recent tasks" strip (portaled next to the card, `role=dialog`/`listbox`, `data-dsh-iui-version-bar`); the old metadata dialog becomes the strip's Details entry (restore/delete unchanged) while frozen cards keep opening it directly. Items merge Host history, local revisions and M1 store-known revisions, sort newest first, show the 20 most recent and point at Details for the rest; each item shows a thumbnail or placeholder, revision number, source, time, the current marker and the pending-draft marker. Arrow keys/Home/End/Tab cycle, Enter activates, Escape closes and returns focus, and `aria-selected` marks the current item.
- **On-demand switching**: selecting a historical revision with no known program fetches it through `fetchArtifactHistoryProgram`, registers it with `registerArtifactRevision` and calls `selectArtifactRevision`, so the M1 stage renders it in place — no Host write, no new revision and no new card; an unavailable program keeps the current revision and reports it.
- **Thumbnails (D5 dual scheme)**: new `artifact-thumbnails.ts` (key artifactId+revisionId+scheme; bounded in-memory LRU 40 entries/6MB with object-URL revocation; IndexedDB v1 with per-artifact index, caps and silent degradation); the stage asynchronously captures the displayed revision in the current scheme with SnapDOM (fonts + two frames + ~420ms settle, ~300px webp), then captures the same revision once more through the off-screen renderer in the **other scheme with that scheme's themeStyle**. Opening the strip queues one capture per scheme for up to eight un-thumbnailed revisions (same concurrency ≤2, non-current scheme uses its own themeStyle). Reads prefer the current scheme and only fall back to the other copy with a `data-thumb-scheme` marker; deleting a revision clears both schemes and tombstones it so an in-flight capture cannot write it back.
- **FLIP**: `stage-flip.ts` provides the pure `interpolateFlipRect` geometry (unit-tested) and a transient fixed overlay animating ~260ms from the strip thumbnail into the stage `.dsh-iui-body` while the stage fades in; reduced motion or a missing thumbnail switches directly; the overlay carries `data-dsh-iui-stage-flip` and is always removed.
- **Tests**: new `test/client/artifact-thumbnails.test.mjs` and `test/client/version-items.test.mjs` (20 cases: LRU/byte cap, IndexedDB-unavailable degradation, repository hydrate/loading/put/remove/clear, dual-scheme storage/fallback/tombstones, item merge/limit/current/draft/source, FLIP geometry); browser scenario 49 (bar open/current/source/draft, keyboard and focus return, automatic and lazy thumbnails, the FLIP overlay, switching without a new card or Host write, reduced motion, the Details entry and a stage-on deletion rollback) and scenario 50 (D5: both light and dark thumbnails ready for the same revision, each page scheme uses its own image after switching while the other copy survives); the suite grows 599 → **632 checks** while scenarios 1–47 (stage off) and 48 (M1) stay green.
- **Known limits**: M2 does not persist the selected revision (D6 still returns to latest); a thumbnail may capture async-media placeholders (reopening the strip retries); suppressed cards mean image/HTML export alignment is still M3; the bar is a non-modal dialog whose Tab cycles inside and outside clicks close.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **705/705** Node tests = Host **302** + Client **380** + packaging **23**; build host **841 kB**, client **4.11 MB** (js 3.88 / CSS 230.8) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **632 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,056,334** bytes packed, **12,984,362** bytes unpacked |
| Structure | the new record exists in both languages; `npm run check:docs-facts` passes; `git diff --check` passes |

## 2026-11-10 — M3 exports follow the displayed revision + branch/deletion E2E

- **Exports (D8)**: HTML export resolves each recorded program through the version store's selected revision after `programsFor` and synthesizes program/title/style with `stageProgramFor` while keeping the callId; when that revision is displayed by a stage card in another Turn, `assetElements` reads local images from the stage and keys buckets by the exported callId. Image export uses the pure `export-image-targets.ts` planner to resolve notices (`data-dsh-iui-artifact-id`) and cards (`data-artifact-id`) in message order, prefers the cross-Turn stage card (displayed revision), falls back to a full card of the same Turn, and throws an explicit error for a notice-only artifact with no capturable content — it never exports stale content. Multiple artifacts dedupe, expand/settle per element, and are stacked vertically by `stackBoxes`; the plain-card path keeps the container capture.
- **Editing/deletion**: when the stage displays a revision natively owned by a frozen card, the frozen card becomes read-only and the stage is the single editing surface (one editKey, never two canvases), so selecting an old revision via the version bar keeps the conflict-banner → branch flow (selected base, `branch:true`, no extra card). Deleting the displayed transcript revision goes through revision-fallbacks → forget: latest/selected repoint to a live revision, the stage does not dangle and the card count is unchanged.
- **Tests**: 9 new pure unit cases in `test/client/export-versions.test.mjs` and `test/client/export-image-targets.test.mjs`; artifact-edit scenarios 51 (stage old-revision branch), 52 (stage-on displayed-transcript-revision deletion rollback) and 53 (single-card Turn deleting its displayed revision: inherited fallbackFrom keeps the fallback card read-only and the stage card stable), 632→**655 checks**; the review fixes add 6 more store/Set-identity/default-switch/resource-merge unit cases (below); the export suite gains the D8 dual-path scenario (notice-only image export captures the stage and SELECTED content, never RAW; HTML embeds the selected program rather than the stale recording). Scenarios 1–50 and the export scenarios stay green.
- **Review fixes (2026-11-10)**: `stageProgramFor` inherits `fallbackFrom` (a single-card stage stays read-only after deleting its displayed revision); gate registration updates the same cardId instead of unregister→register (new `updateArtifactVersionCard`/`updateCardInState`, role and visibility preserved, unregister only on unmount); registration uses `useLayoutEffect`; the version bar drops a duplicate import, disables `hasProgram=false` items and guards pending with a ref; selected revision ids keep Set identity when unchanged; stage selectors use `CSS.escape`; HTML export merges assetElements with the container fallback; lazy off-screen capture adds the minimal card head so both thumbnail paths compose alike; new tests pin the production default enabled and assert distinct light/dark thumbnail URLs. **Real-GUI follow-up (H1 residual)**: when the stage displays a revision fetched from Host history (the card's own program belongs to an older revision) and that revision is deleted, the store writes `redirectedFrom` on the fallback record and `stageProgramFor` synthesizes `fallbackFrom`, keeping the redirected stage read-only; covered by a reducer unit test and scenario 54. **Last variant**: when the stage displays a store-known local revision, `renderedRevisionLocal` is only true for a real local card (`callId===revisionId`) and `locallyOwned` additionally requires the dialog opener to be that local card, so deleting the displayed local revision still writes a fallback and stays read-only (scenario 55), while a local card deleting its own revision still writes no fallback (scenario 49 unchanged). **Regression lock for the renderedRevisionLocal formula (scenario 56)**: the same local revision is also persisted in localStorage (`localRevisionIds` contains it) while its local card lives in an unrendered Turn and the stage displays it from the store; mutation testing shows the old `program.localRevision === true` formula fails the scenario (no fallback/`redirectedFrom`) while only `&& program.callId === program.revisionId` passes. `redirectedFrom` is intentionally sticky: re-selecting the target revision keeps it read-only; regaining editability requires another revision or a branch from a frozen card.
- **Known limits**: exports only consult the current session's version store; multi-artifact images stack at the widest capture with a 12px gap; async media/maps rely on their settled signals; branch semantics unchanged — only the stage editing surface opens.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **722/722** Node tests = Host **302** + Client **397** + packaging **23**; build host **841 kB**, client **4.12 MB** (js 3.89 / CSS 230.8) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **699 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,058,652** bytes packed, **12,991,046** bytes unpacked |
| Structure | the M3 record exists in both languages; `check:docs-facts` passes; `git diff --check` passes |

## 2026-11-09 — Batch arrangement operations (multi-select + batch order/duplicate/delete)

- **Batch mode**: the Block arrangement section head gains a **Batch** toggle left of Reset order (`data-dsh-iui-edit-batch-toggle`, `aria-pressed`, icon + copy). While active each row's drag grip becomes a Tab-focusable selection control (Space/Enter toggles; the row body toggles too), the per-row structure menu is hidden, the row hover card never opens, and selected rows carry an `is-batch-selected`/`data-batch-selected` state. Escape leaves the mode and returns focus to the toggle; switching the edited revision or closing the editor clears the selection.
- **Batch toolbar**: selected count (`role=status`), select all/clear, move up/down/to top/to bottom, duplicate selected/delete selected and exit; buttons are disabled with aria-label/title when there is no selection or no effect, structure actions disable with a note above the Host's 20-operation cap, and the section head/toolbar wrap without horizontal overflow on the 272px docked rail at 1180px.
- **Order semantics**: top/bottom keep the selected blocks' relative order; up processes ascending indices and down descending ones so each selected block swaps only with an unselected neighbour and never crosses another selected block. Only the draft `targetOrder`/`orderChanged` change through the existing persistence/chip-sync path; edit request numbers and colours stay untouched.
- **Batch structure operations**: reuse the `POST /api/intelligent-ui/artifact-structure` batch `operations` (cap 20), first `preview: true` into the existing preview dialog with a batch title/operation label/involved-block list/the same diff, then one real batch POST on confirm that records exactly one local `kind:'structure'` revision and `markSubmitted`. Multiple duplicates are sent in descending page order with `toIndex = base editable index + 1`, so every copy lands directly after its source; the existing Host batch test plus a new host test pin that order. A selection with an unresolvable nodeId/sourceDigest, or one above the cap, reports an inline error before sending anything.
- **Scope and limits**: v1 affects only the top-level arrangement list (nested arrangement unchanged); batch structure operations do not block content-edit drafts; a structural duplicate follows the revision page order, not the draft order.
- **Tests**: new `test/client/artifact-edit-batch-ops.test.mjs` (9 cases: order semantics, draft invariants, descending duplicate send tied to the real Host apply placement, one-request/one-revision batch delete, the 20 cap, unresolvable selection, preview cancel, one-block regression); one new multi-duplicate Host test; the browser `artifact-edit` suite gains the batch scenario (toggle/selection/order/narrow rail/batch preview/apply/single revision/Escape focus return) and grows 519 → **564 checks**.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **638/638** Node tests = Host **303** + Client **314** + packaging **21**; build host **837.9 kB**, client **4.06 MB** (js 3.84 / CSS 226.6) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **564 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,035,842** bytes packed, **12,905,416** bytes unpacked |
| Structure | the new record exists in both languages; `npm run check:docs-facts` passes; `git diff --check` passes |

## 2026-11-09 — Nested arrangement batch operations and batch draft confirmation

- **Nested batch mode (B1)**: the Nested arrangement section head gains its own **Batch** toggle left of Reset nested order (`data-dsh-iui-edit-nested-batch-toggle`, `aria-pressed`), mutually exclusive with the root batch mode. While active every nested row's drag grip becomes a Tab-focusable selection control (Space/Enter or the row body toggles selection), the per-row structure menu is hidden and selected rows carry an `is-batch-selected` state; the toolbar reuses the root batch styling (selected count `role=status`, select all/clear, move up/down/to top/to bottom, duplicate/delete selected, exit). Order actions apply independently per parent container with the root batch semantics (top/bottom keep the group-relative order, up ascending / down descending and only swapping with an unselected sibling; disabled when no group can move); Escape leaves the mode and returns focus to the toggle, and switching the edited revision or leaving nested mode clears the selection.
- **Nested batch structure operations**: reuse the `POST /api/intelligent-ui/artifact-structure` `operations[]` batch (cap 20): one `preview:true` dry run into the existing preview dialog (batch title/operation label/involved blocks/the same diff), then one real apply recording exactly one local `kind:'structure'` revision. Duplicates are grouped per parent container and sent in descending base editable-index order with `toIndex = base editable index + 1`, so groups cannot shift each other; a container selected together with one of its nested blocks is disabled/refused before the request (`edit.batchNestedOverlap`), as is an unresolvable nodeId/sourceDigest or an over-cap selection.
- **Batch draft confirmation (B2)**: when the draft still has unsent content (`hasArtifactEditContent`), a batch structure preview shows an explicit unsent-content warning and renames the confirm action to **Discard draft and apply**; a clean draft keeps the previous flow (**Apply change**), and single-block structure operations keep their flow and copy unchanged.
- **Tests**: `test/client/artifact-edit-batch-ops.test.mjs` gains 4 cases (per-parent nested ordering with untouched groups, nested duplicate grouping/descending index tied to the real Host `applyStructureBatch` placement, nested delete with one request and one revision, overlapping/unresolvable selection refusal); the browser `artifact-edit` suite gains the 25d nested batch scenario (mutual exclusion, per-parent ordering, overlap-disabled select-all, dirty-draft warning, one batch revision) plus the 25b clean/dirty preview checks and the 25 single-block no-warning regression; the suite grows 564 → **610 checks**. The pre-existing input-orbit geometry assertion now waits for the 320ms panel width animation to settle before sampling while still requiring the exact 5px offset, removing a long-suite flake.
- **Scope and limits**: nested batch ordering rewrites only the pending `nestedOrder`/`nestedOrderChanged`; structural duplicates still follow the revision page order, not the draft order; a container and its descendant must be batched separately; coarse-pointer and real screen-reader checks remain out of scope.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **642/642** Node tests = Host **303** + Client **318** + packaging **21**; build host **837.9 kB**, client **4.06 MB** (js 3.84 / CSS 227.6) |
| `npm run test:browser` | PASS; 9/9 suites; `artifact-edit` **610 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,037,805** bytes packed, **12,912,720** bytes unpacked |
| Structure | the new record exists in both languages; `npm run check:docs-facts` passes; `git diff --check` passes |

## 2026-11-10 — Both feature branches merged into local main

Local `main` merged `artifact-version-switcher` (fast-forward) and `artifact-batch-version-ui` (merge commit), then ran the merged-tree gates:

- **Contents**: M1 active revision stage/visibility fallback, M2 recents-style version bar/screenshot thumbnails/FLIP, M3 exports following the displayed revision plus branch/deletion rollback, and the root/nested block-arrangement batch operations (batch ordering, one-revision batch duplicate/delete, unsent-draft confirmation).
- **Conflicts**: kept main's settled-geometry input-orbit E2E stabilization; kept the newer revision-stage plan document for the add/add plan file; doc counters are synchronized to the measured merged tree in this record. The two changes interact only in the client/test/docs layers; no new Host route or persisted field.
- **Merged-tree E2E**: `artifact-edit` **790 checks** with both the batch scenarios (25b/25c/25d) and the stage/version-bar/export scenarios (48–56) passing together.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm test` | PASS; Node **736/736** = Host **303** + Client **410** + packaging **23** |
| `npm run test:renderer` | PASS (CSS/component/nested/typography/media contracts) |
| `npm run test:browser` | PASS; **9/9** suites; `artifact-edit` **790 checks**, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,064,656** bytes packed, **13,016,644** bytes unpacked |
| Build | host 841 kB; client 4.14 MB (js 3.91 / css 236.1 kB); standalone 3.35 MB + 523.0 kB |
| Structure | both languages present; `npm run check:docs-facts` passes; `git diff --check` passes |

## 2026-11-10 — Edit pipeline: structure queue, explicit saves and total Apply preview

- **User problem**: after typing a global instruction and block requests in the Artifact editor, a batch or per-row structure operation submitted immediately and closed the editor, losing the draft. The flow is now queue first, preview second, apply once.
- **New flow**: every structure operation enters the pending round queue. Batch mode keeps duplicate/delete in a panel-local draft until **Save batch**; Cancel/Escape restores the captured order and drops the draft. Row-menu delete keeps its two-step confirmation before queueing, duplicate/move queue directly and announce through `aria-live`. The panel gains a **Pending this round** section (queue rows with per-row remove, saved request/addition counts, order state) and the global instruction becomes an explicit **Save global instruction** action with a saved/unsaved state; every save updates the composer chip and the pending-edits dock, and queued operations are counted in the chip summary.
- **Total Apply preview**: the fixed bottom Apply button (`data-dsh-iui-edit-apply`, disabled with nothing saved) refetches the Host's authoritative dry run and opens the total preview dialog (structure operations, diff, involved blocks, model summary, conflict list; loading/failed/ready; `aria-modal`, focus trap, Escape and focus restore). Conflicts (a queued delete whose block or descendant is still referenced by a saved request/addition, mixed style and structure instructions, duplicate entries, a container with its child, the 20-operation cap, unresolvable blocks/targets or mixed kinds under one parent) disable the confirm, explain each item and send no Host request.
- **Execution and remapping**: confirming submits one atomic batch that records one local `kind:'structure'` revision (a confirmed total preview reuses its dry-run program as the Apply preflight, so one Apply sends one dry run plus one real batch) and rebases the draft onto it. `remap.ts` first simulates the batch's post-order sibling slots (deletes remove a slot, duplicates sit directly after their source, moves append to the target parent), then aligns it position by position with the authoritative Host result: copy slots never claim a mapping (an identical-text copy cannot steal the next sibling's saved request), container blocks (Col/Row/Box/Grid/Card/Carousel) are paired by type + position because their display title derives from their first child, and `nestedOrder` inserts batch-created children at their base anchor so a pure duplicate is not reported as an arrangement change. Selection/additions/targetOrder/nestedOrder move over, the global/style instruction, branch, strict and nested mode stay, and the new composer chip is inserted before the old session/reference/persisted draft and chip are removed, so no dangling chip appears. Any unmapped request/addition/nested child or unreliable mapping (for example duplicate+move) blocks Apply in both the preview and the Apply preflight instead of dropping user work. Any remaining model request is auto-submitted when the composer is plain; with user prose or a failed send the chip is kept and the rekeyed panel shows the manual-send notice.
- **Deep pages**: `MAX_CST_DEPTH` moved from 4 to **10** (the root `Col` is depth 0; the real dashboard page is depth 5–6 with 83 CST nodes) and the client nested map plus the Host structure route share that constant; when `nestedBlocksForProgram` cannot map the page, `resolvePendingStructureOperations` falls back to a Host-shaped root block table for root-level delete/duplicate/move. Pages beyond the supported depth/node cap report a `depth` conflict (never the misleading "no longer in this revision"), and nested moves use `nestedTarget`.
- **Props**: successful Divider/Spacer quick props now rebase too, keeping the saved requests and pending queue instead of discarding the draft; the old B2 discard warning was removed with the old preview dialog.
- **Accessibility and locales**: saves/queueing/cancel/Apply/auto-send announce through `aria-live`; the dialog starts on cancel, traps Tab, closes on Escape and restores focus to its trigger; zh/en keys are complete; narrow panels wrap the batch toolbar, pending rows and the Apply bar without overflow.
- **Tests**: 15 pure `remap.ts` unit tests (copy exclusion, derived container titles, nestedOrder anchor insertion, unreliable duplicate+move) plus store tests for the queue/preview/apply/rebase, chip rekey and the 20-operation refusal, deep-page root structure tests, the props rebase-failure contract (mocked structurally different props result: local revision recorded, old draft/chip kept, dismissible `applyNotice='rebaseFailed'`), the restored 6 batch-order unit tests (up/down/top/bottom, only `targetOrder`/`orderChanged` change, per-parent nested moves, no-op selections) and Host route depth tests (depth-6/83-node root duplicate/delete succeed and record revisions; depth 11 is rejected with no revision or ledger write); E2E scenarios 25/25b/25c/25d/27/31/33/36 migrated to the new semantics and new scenarios 57–64 cover auto-submit, manual-send fallback, pending-queue reload, conflict blocking, a depth-6/83-node dashboard root batch apply, `depth`/`nestedTarget` conflicts on an over-deep page, an identical-text copy that cannot steal a saved request, and the refused 21st queue entry; `artifact-edit` grows 790 → **882 checks**. The mocked E2E structure preview/apply programs are produced by the real `applyStructureBatch` engine through a Node bridge, so they match the Host exactly.
- **Known limits**: auto-send needs a plain composer (busy/sending falls back to the manual notice) and was validated in the isolated real GUI (23 phases including the automatic send); the Turn-close `reconcileArtifactSubmissions` still confirms the submission and Host conflicts keep the existing banner; one Apply accepts at most 20 queued operations (the 21st is refused with visible copy, never truncated and never dropping the rest of the draft); a parent cannot mix operation kinds; structure operations support CST depth ≤10 and ≤200 nodes, the Host structure route rejects deeper pages entirely (including root-level operations) and the client pre-blocks them with a `depth` conflict; remapping relies on display identity, so duplicate+move mixes or an unalignable result **block Apply** with target/selection/addition conflicts instead of dropping saved requests, and a recorded props revision whose draft cannot move keeps the old draft/chip with a dismissible `rebaseFailed` notice; moving a block to the page root still follows the existing Host move validation (the target must be a writable container); the edit panel (Chinese) and the composer chip/dock (English) can disagree under a mixed locale, which is the pre-existing chip locale seat behaviour, not introduced here; the E2E structure mocks call the shared `applyStructureBatch` through a local Node bridge, bypassing the Host route's auth, base registry and idempotency ledger (covered by host unit tests); the asynchronous bridge leaves a few timing waits, so the suite still has a non-zero flake probability; the legacy single-operation structure API and immediate preview entry were removed (quick props kept); a style-only Apply summary shows "Style change" instead of "0 edit requests".

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **765/765** Node tests = Host **305** + Client **437** + packaging **23**; build host **841 kB**, client **4.18 MB** (js 3.94 / CSS 242.6 kB) |
| `npm run typecheck` / `npm run test:renderer` | PASS |
| `node test/browser/artifact-edit.e2e.mjs` | PASS; **882 checks** (migrated scenarios plus new 57–64) |
| `npm run test:browser` | PASS; **9/9** suites; `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,075,330** bytes packed, **13,070,892** bytes unpacked |
| Structure | both languages present; `npm run check:docs-facts` passes; `git diff --check` passes |

## 2026-11-10 — Phase A review fixes: nested Apply, queued-send blocking, attached preservation, preview contract and honest auto-send

- **Background**: two fresh-context reviewers audited `7f367f9..b62bd5a` and found one blocker plus four majors and several minors; this round fixes the Phase A structure pipeline at the root cause, reproducing every finding with the `/tmp/iui-probe` probes first and locking the fixes with unit tests and E2E.
- **Nested Apply (blocker)**: `rebaseDraftAfterStructure` rebuilds the nested block table and the complete nested order groups from the resulting program (all parent containers, including unchanged groups) and overlays the remapped pending order; nested mode is kept only when the result still has nested blocks, and a new invariant refuses to create a draft whose remapped selection/addition cannot resolve in the new table. Nested requests therefore always carry `nodeId`/`parentBlockId`; nested mode, order and changed groups are persisted (including `b1.2.1`-shaped ids) so a reload stays serializable. `probe-nested-rebase.mjs` goes from lost nested blocks/order and `invalid` serialization to the complete nested table, complete nestedOrder and an envelope with the nested node id.
- **Normal Send no longer drops the queue (major)**: `serializeArtifactEditRequest` checks pendingOps before building the request and returns `pending_apply`; a chip Send shows "apply the queue first" and neither calls `markSubmitted` nor drops the draft. `probe-send-queue.mjs` before/after.
- **Attached semantics and batch cap (major)**: a rebase preserves `oldSession.attached`, only an attached draft upserts a chip or auto-sends, and the attached count (excluding the old draft) is checked before inserting a chip; `composerHasPlainText` removes every reference span by offset before deciding, so sibling chips and their generated separators are not user prose; a detached draft gets its own notice. `probe-detached-rebase.mjs` goes from attached=true to false.
- **Preview contract and honest auto-send (major)**: one side-effect-free `buildModelRequest` is shared by the send codec and the total Apply preview, so zero-op previews also produce styleMixed/instruction/temporaryOrder/styleUnsupported/invalid/stale conflicts and disable confirm; `applyRound` probes the head before `needSend`; auto-submit first checks sendability and only reports success after the send path confirmed the draft was consumed (`isArtifactEditSubmitted`), otherwise it downgrades to manual instead of faking "submitted". `probe-style-mixed-apply` / `probe-conflict-apply` go from ready/needSend to preview conflicts/apply error.
- **Minors**: a preview cancelled while loading drops its late answer through a generation token (`probe-cancel-preview`); panel-local work and unsaved popover text join the unified dirty guard; node-budget and depth limits report `nodeLimit`/`depth` separately (a shallow 210-root-Text page no longer claims `depth`; copy and docs updated); post-Apply notices render in the chat-level draft dock so single-card/stage scenarios can see them.
- **Verification**: Node **779/779** (Host **305**, Client **451**, packaging **23**; 14 new Phase A regressions); `artifact-edit` E2E **909 checks** (new 65–68: nested Apply keeps the nested draft, queued-structure Send blocking, detached draft without re-inserted chip/auto-send, zero-op stale preview disabling confirm; scenarios 57/63 now assert the real sent text), two consecutive green runs; `npm run test:browser` 9/9 (`nested-edit-renderer` 75); pack **65** files **6,077,725** / **13,083,208** bytes; docs-facts and `git diff --check` pass.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; **779/779** Node tests = Host **305** + Client **451** + packaging **23**; build host **841 kB**, client **4.19 MB** (js 3.95 / CSS 242.8 kB) |
| `npm run typecheck` / `npm run test:renderer` | PASS |
| `node test/browser/artifact-edit.e2e.mjs` | PASS; **909 checks** (two consecutive runs) |
| `npm run test:browser` | PASS; **9/9** suites; `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,077,725** bytes packed, **13,083,208** bytes unpacked |
| Structure | zh/en records aligned; `npm run check:docs-facts` and `git diff --check` pass |

## 2026-11-10 — Phase B review fixes: deletion fallback/read-only recovery, export error copy, version labels, docs and E2E stability

- **Context**: after Phase A a second reviewer pass over the same tree reported one major (deleting the stage's displayed revision picked a fallback that disagreed with the confirmation, and a stage card that itself owned the deleted revision could stay read-only forever) plus minors (the image export swallowed its concrete notice-only error, the version bar mislabelled props revisions, current-state docs still described the old pipeline, the artifact-edit E2E flaked on a second run, the README image count said 66, the browser-suite README carried old counts, the bridge claim was overstated, the 20-operation cap had two implementations, the doc-facts checker only matched bare number fragments, and architecture presented a removed API as current). This round fixes the causes.
- **Deletion fallback (MAJOR-4)**: `forgetRevisionInState` now selects the prepared rollback target when the deleted revision was the displayed one (instead of silently moving to the latest revision), and `stageProgramFor` synthesizes `fallbackFrom` only while the stage actually displays that fallback target — a card-level marker belongs to the revision the card fell back to and the record marker belongs to the fallback target record, so selecting any other revision drops the read-only state and restores the edit entry. The `/tmp/iui-probe-wt` reproductions (`probe-forget-selection`, `probe-stage-readonly2`) change from "selected r5 + fallbackFrom r2 + stage read-only" to "selected r1 + fallback target read-only + another revision editable".
- **Image export**: `ExportAction` maps `NO_CAPTURABLE_STAGE_MESSAGE` to a localized concrete message (zh/en `export.state.noticeOnly`) in the menu status and trigger title/`data-status` instead of the generic "export failed, try again", because retrying cannot help; a notice-only answer with no capturable stage downloads nothing. The export E2E asserts the copy and the absence of a download.
- **Version source**: `version-items.ts` lets a client-local `props`/`style` kind win over the generic Host structure label when merging (a props quick-adjust is recorded as a `struct_` structure revision and used to read "structure", or even "style switch"); the store-known path does the same. Two new unit tests.
- **Shared cap**: the client queue limit in `remap.ts` now reuses the shared `MAX_ARTIFACT_STRUCTURE_OPERATIONS` (one implementation) with an equality and 20/21 boundary unit test.
- **E2E stability**: the batch-cancel chip-label negative assertion waits for the re-render instead of sampling one frame; three consecutive runs pass. New scenario 69 locks "display an old revision → delete → the stage lands on the rollback target read-only → selecting another revision restores the edit entry".
- **Docs**: `docs/limitations.md/.en` drop the removed "structural operations directly close the draft (`markSubmitted`)" wording and describe queue → save → total preview → Apply (structure-only Apply closes the draft after recording; mixed Apply keeps the rebased draft and auto-sends or falls back to a manual send; queueing/cancel lose nothing); the README pair, usage pair and architecture pair are synced; the deletion selection/read-only/recovery semantics are documented. The README image count moves 66 → 76; `test/browser/README.md` gains the current stage/version-bar/pipeline coverage and the 920-check count; architecture marks the removed single-operation structure API as history and scopes the bridge claim; `check-doc-facts.mjs` matches numbers in context (Host/Client cannot be swapped), guards the current-pipeline wording, browser-suite README counts and the image count, and gains 9 failure-case unit tests.
- **Tests**: Node +15 (artifact-version +3, version-items +2, artifact-edit-remap +1, doc-facts-guard +9); the `artifact-edit` E2E grows 909 → **920 checks**; image export 72 → **76** assertions.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; Node **794/794** = Host **305** + Client **457** + packaging **32**; build host **841 kB**, client **4.19 MB** (js 3.95 / CSS 242.8 kB) |
| `node test/browser/artifact-edit.e2e.mjs` | PASS; **920 checks**, two consecutive runs |
| `npm run test:browser` | PASS; **9/9** suites; image export 76 assertions, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,078,909** bytes packed, **13,086,153** bytes unpacked |
| Structure | zh/en records aligned; `npm run check:docs-facts` and `git diff --check` pass |

## 2026-11-10 — Final re-review closeout: zero-op stale probe and measured facts

- **N1 (review finding)**: the new doc-facts failure test moved the real counts to **796/796** Node tests (Host **305**, Client **458**, packaging **33**) and pack **6,079,046** / **13,086,574** bytes; current-facts, README, architecture, CHANGELOG and verification now quote the final measured values.
- **N2 (zero-op preview staleness race)**: with no queued structure operations, `previewPendingStructureOps` now runs the read-only revision probe first and folds a head advance the store has not observed into a `stale` conflict, disabling confirm; a unit test locks the "advanced only at preview time" path.
- **N3 (known limitation, pre-existing)**: `additions` (model-added blocks) are not yet part of `PersistedDraft`, so they are lost after a reload; same-session Apply remapping/serialization works and the gap is recorded in architecture.
- N4: the sticky read-only semantics of the rollback target are kept as documented (selecting another revision restores editing).
- N5: the E2E structure-mock chip assertion is now scoped to the active draft via `data-chip-ref` (harness `__activeDraftReference()`), so an unrelated leftover chip cannot make it vacuous; early single-chip scenarios still use `chipLabel()`.

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; Node **796/796** = Host **305** + Client **458** + packaging **33**; build host **841 kB**, client **4.19 MB** (js 3.95 / CSS 242.8 kB) |
| `node test/browser/artifact-edit.e2e.mjs` | PASS; **920 checks**, two consecutive runs |
| `npm run test:browser` | PASS; **9/9** suites; 76 image-export assertions, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,079,046** bytes packed, **13,086,574** bytes unpacked |

## 2026-11-10 — Final gate false-green, zero-op probe races and docs closeout

- **doc-facts false green (tooling/docs)**: the CLI filtered a `current-facts.json` mismatch out of the failure list, and `verifyFacts` returned early before checking any document, so an inconsistent snapshot still printed ok. The CLI no longer filters that failure, and a temp-root CLI-level regression test now requires `checkDocFacts` to fail on an inconsistent snapshot.
- **N2 races**: closing the canvas now bumps the preview generation, so a late probe answer cannot write back and reopen the dialog; if a new pending queue appears while the zero-op probe is in flight, the preview re-enters the structure path instead of confirming `ops: [] / structureReady: true`. Both races have unit tests.
- **N5 correction**: the E2E chip assertion is scoped to the active draft via `data-chip-ref` (harness `__activeDraftReference()`), so the negative assertion is not vacuous; the previous record's N5 wording is corrected.
- **N3**: the `additions` persistence gap is recorded in the architecture known-gap bullet (pre-existing, not introduced by this pipeline).
- Final measured gate: Node **799/799** (Host **305**, Client **460**, packaging **34**); `artifact-edit` **920 checks**; image export 76; `test:browser` 9/9; pack **65** files **6,079,092** / **13,086,611** bytes; build host **841 kB**, client **4.19 MB** (js 3.95 / CSS 242.8 kB).

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; Node **799/799** = Host **305** + Client **460** + packaging **34** |
| `node test/browser/artifact-edit.e2e.mjs` | PASS; **920 checks**, two consecutive runs |
| `npm run test:browser` | PASS; **9/9** suites; 76 image-export assertions, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,079,092** bytes packed, **13,086,611** bytes unpacked |

## 2026-11-10 — Closeout races, CLI coverage and final facts

- **Empty-draft close/reopen race (review MAJOR)**: the preview generation counter is no longer reset when a draft is removed (discard/close/rebase/submit now only bump it); reopening the same key after an empty-draft close can therefore never collide with an old probe. The close-race test now also asserts that a late old probe cannot clear the reopened session's conflict or replace its fresh preview.
- **CLI test coverage (review MINOR)**: the testable `runCli(root, io)` now owns the exit code and stderr path, and the temp-root doc-facts test executes the real CLI entry (asserting exit 1 plus the `docs/current-facts.json` failure copy); the Host/Client swap separator set also accepts `/` and `|`.
- Final measured gate: Node **799/799** (Host **305**, Client **460**, packaging **34**); `artifact-edit` **920 checks**; image export 76; `test:browser` 9/9; pack **65** files **6,079,141** / **13,086,571** bytes; build host **841 kB**, client **4.19 MB** (js 3.95 / CSS 242.8 kB).

### Automated results

| Command / check | Result |
| --- | --- |
| `npm run check` | PASS; Node **799/799** = Host **305** + Client **460** + packaging **34** |
| `node test/browser/artifact-edit.e2e.mjs` | PASS; **920 checks**, two consecutive runs |
| `npm run test:browser` | PASS; **9/9** suites; 76 image-export assertions, `nested-edit-renderer` 75 |
| `npm run pack:check` | PASS; **65** files, **6,079,141** bytes packed, **13,086,571** bytes unpacked |

## 2026-11-11 — Auto becomes a format decision: page-or-text, Card/Article/free layout

- **Policy**: an enabled session no longer defaults to a rendered page. The model decides per answer whether a page helps (structure, visuals, interaction or computation) and answers in Markdown otherwise; a session style (Card/Article/Auto) only names the layout when a page is rendered. `Auto` may choose the free layout directly (`style: "free"`, no `styleId`/`temporaryStyle`; the Host records `styleSource: "builtin"` and the client replays it as a built-in free layout), while a forced Card/Article session still rejects `free`. Explicit render requests (`/intelligent-ui`, an explicit page/dashboard ask), on-demand generation, pending artifact edit requests and natural-language style edits still require a page.
- **Implementation**: the policy is single-sourced in the generated prompt preamble (`scripts/generate-prompt.mjs` → `src/generated/prompt.txt`) and the runtime session prefix (ordinary vs on-demand turns); the three style notes, `customStyleNote`, the `render_ui` description and `style` argument docs, the embedded Agent Skill and its integration reference are synced; the composer Auto hint and the settings note now say the model decides page vs text. The Host accepts a free Auto render, and the client `programFromArgs` replay allows that shape.
- **Tests**: updated the enabled-session policy guardrail, the Host auto-style/free-layout cases, the client free-without-identity replay case and stale error copy; added a Host case where Auto accepts free while forced styles still reject it.
- **Measured gate**: `npm run check` PASS; Node **800/800** = Host **306** + Client **460** + packaging **34**; `npm run test:browser` **9/9** suites, `artifact-edit` **920 checks**, `nested-edit-renderer` **75**, image export **76** assertions; `npm run pack:check` **65** files, **6,080,680** bytes packed, **13,090,208** bytes unpacked; build host **842 kB**, client **4.19 MB** (js 3.95 / CSS 242.8 kB); `npm run check:docs-facts` and `git diff --check` pass.
- **Evidence boundary**: no real model was called this round, so whether the model reliably renders when it should and answers in text when it should not is unverified; the decision is a model judgment, and the same question may render once and stay text another time. A free-layout result has no theme snapshot, cannot be saved as a template, and the editor's built-in style-switch targets remain Card/Article.

## 2026-11-11 — Independent review fixes: docs consistency, Skill/troubleshooting, replay guard and prompt boundaries

- **Review**: two read-only review sub-agents audited the uncommitted change (`git diff HEAD`, 23 files) along the Standards and Spec axes; no BLOCKER. This round fixes their MAJOR/MINOR/NIT findings.
- **Docs**: README's stale "structured answers use a card by default" line and `docs/development.md`'s old policy description now match the shipped rule; the current gate lines in README/architecture say "working tree (uncommitted)"; the architecture/limitations free-layout and explicit-request wording matches the model-facing contract.
- **Prompt**: the static prompt's session-note sentence now covers the on-demand note; an explicit page/dashboard/card/UI request is a direct instruction; `ARTIFACT_EDIT_NOTE` states that a pending edit request overrides the ordinary page-vs-text decision; the per-style notes no longer repeat the text-fallback sentence (the runtime prefix owns that decision).
- **Skill / settings copy**: the free-layout advisory covers an Auto-chosen free layout, the troubleshooting reference documents the Auto-free path, and the Free-form layout switch copy now describes whether layout guidance is advisory (Auto free is not gated by it).
- **Client replay**: a free result with no `styleId`/`temporaryStyle` renders only for a live call or when the recorded meta says `styleSource: "builtin"`; a template recording with a missing/malformed identity is dropped again. Tests are narrowed to match.
- **Tests**: assertions added for the ordinary/on-demand prefixes, the edit-request override and the narrowed replay contract (test count unchanged).
- **Measured gate**: Node **800/800** = Host **306** + Client **460** + packaging **34**; **9/9** browser suites, `artifact-edit` **920 checks**, `nested-edit-renderer` **75**, image export **76** assertions; `npm run pack:check` **65** files, **6,080,849** bytes packed, **13,090,697** bytes unpacked; build host **842 kB**, client **4.19 MB** (js 3.95 / CSS 242.8 kB); `npm run check:docs-facts` and `git diff --check` pass.
- **Evidence boundary**: no real model was called; the review sub-agents were read-only (no build/browser run), and the implementer re-ran the gates. The Free-form layout switch keeps Auto free ungated and only changes copy; no new gate was added.

## 2026-11-11 — Experimental "answer as a document" mode (`documentMode`)

- **Behavior**: the Plugin detail page gains an **Experimental** switch, **Answer as a document (experimental)** (Host volatile `documentMode`, default off). When on, an ordinary answer (not an on-demand result, Artifact edit or saved template) uses the document contract: the whole answer is one `render_ui` program with `style: "free"` and no Markdown reply; the Host enforces free and ignores the session template, records `document: true` plus `styleSource: "builtin"` in the success value and `presentationMeta`, and the client renders that result as a chrome-less `section.dsh-iui-document` with no header, collapse control, frame, card actions, editing entry or revision history. On-demand results, saved templates and edit requests keep their cards; the switch only affects future answers, and recorded results replay with their recorded presentation.
- **Replay fix**: ordinary `render_ui` results now always record `style`/`styleSource` in `presentationMeta`, which fixes Auto free-layout results being dropped on settlement/replay when they carried no style identity; the `document` flag rides the same meta channel and is read by the client `programFromArgs`.
- **Tests**: Host +3 (document prompt contract, Host enforcing free and rejecting card/styleId, ordinary-result meta); Client +1 (document meta replay); the settings SSR test now covers the experimental switch (four switches); the `style-theme` browser suite gains a recorded document answer (no header, program mounted, ordinary cards keep their header).
- **Measured gate**: `npm run check` PASS; Node **804/804** = Host **309** + Client **461** + packaging **34**; `npm run test:browser` **9/9** suites, `artifact-edit` **920 checks**, `nested-edit-renderer` **75**, image export **76** assertions; `npm run pack:check` **65** files, **6,118,669** bytes packed, **13,140,084** bytes unpacked; build host **845 kB**, client **4.19 MB** (js 3.95 / CSS 243.1 kB); `npm run check:docs-facts` and `git diff --check` pass.
- **Evidence boundary**: no real model was called, so the model-side document behavior (strictly writing no prose, reliably keeping the whole answer in one program) is not verified in a real session; the browser evidence is a component-level harness (real turn-tail component replaying recorded arguments), not a complete DSH Web session. Document answers have no card editing entry or revision history, message copy/search/transcript Markdown export omit their body, and only the Web renderer shows them. A real-GUI manual pass is still pending.

## 2026-11-12 — Review closeout: decision tie-break, full-manifest release check, installer empty document

- **Context**: two independent read-only reviewers audited `aa50e7e..82aebe4` along the Standards and Spec axes (Standards: 2 MAJOR + 3 MINOR + NIT; Spec: 2 MAJOR + 3 MINOR; privacy/hygiene passed on both axes). This round fixes them by root cause, following the global AGENTS.md rule to name the cause first rather than stack patches.
- **Fixes**: the prompt, the runtime prefix and the `render_ui` tool description now share one rule: Auto has no default, and when both branches seem to fit the kind decides — a bare fact or a term restatement stays text, while an explanation of how something works is a page even when the prose version would be short; README and architecture mirror it. The Agent Skill keeps pointing at the single policy source, its `whenToUse` excludes only bare facts/term restatements, and the wording markers moved into `scripts/skill-policy-markers.mjs` shared by the guardrail and the release check; host unit tests pin the prefix/tool-description wording. `scripts/install.mjs` now understands the template's empty-array document `[]` (replace on install, write `[]` back when uninstall leaves no entries, preserve the comment header), covered by `test/packaging/install-script.test.mjs`. `scripts/release-check.mjs` extracts the tarball's complete manifest: every packed path must exist in the checkout, `lib/`, `skills/`, `locale/` and the bundle patch must hash-match it, and the installed package's file set and hashes must be byte-identical to the tarball; failures keep the temp directory, commands have deadlines, the token response retries until 303, and logs are token-scrubbed. Docs now name pnpm and the fact that `npm pack` runs the repo build (ignored `lib/`), and drop the retired `exportToAssistant` field from the config example.
- **Measured gate**: `npm run check` PASS; Node **807/807** = Host **309** + Client **461** + packaging **37**; `npm run test:browser` **9/9** suites, `artifact-edit` **920 checks**, `nested-edit-renderer` **75**, image export **76** assertions; `npm run pack:check` **65** files, **6,119,898** bytes packed, **13,143,100** bytes unpacked; build host **846 kB**, client **4.19 MB** (js 3.95 / CSS 243.1 kB); `npm run check:release` PASS (extract, install, mount, served bundle and uninstall); `npm run check:docs-facts` and `git diff --check` pass.
- **Evidence boundary**: this round did not rerun a real model, the browser suites or the real GUI; the reviewers' verdict rests on code/static commands and /tmp reproductions, and the previous real-machine record remains the latest GUI evidence. The release check's isolated Web instance verifies mounting and the served client bundle, not rendered pages.

## 2026-11-12 — Composer apply-result band fix (the Apply notice no longer covers the input area)

- **Symptom**: after a structure Apply, the "Editor apply result" notice above the input box covered the first line of the composer card — the notice text overlapped the placeholder and its bottom border cut across the input area; the user's screenshot confirmed the broken layout.
- **Root cause**: DSH's `conversation.input.overlay` slot anchor, `[data-composer-overlay]`, is an absolutely positioned, zero-height layer. The extension had a `:has()` in-flow rule only for the draft row (`.dsh-iui-draft-dock`). When Apply consumed its draft, the notice strip became the anchor's only child while the anchor stayed absolute, and the strip still used its old card-less width/margins, so it painted over the input area.
- **Fix**: the post-Apply notice strip now renders in the same composer card-top band as the draft row: the `:has()` rule also fires for `.dsh-iui-draft-dock-notices`; the strip's -8px top margin reaches the card padding through DSH's `display: contents` slot outlet (a direct-child or `:first-child` selector never matches there), it is inset 12px, and it closes with the same inset divider when alone. An armed on-demand hint above it wins the band, and a draft row below it no longer cancels the card padding a second time while keeping its own 12px rhythm and closing divider, so both the notice-only and notice+draft states stack without overlap.
- **Tests**: the `artifact-edit` E2E harness composer now mirrors the real DSH composer (absolute overlay anchor, `display: contents` slot outlet, a preceding hidden slot entry, flex column with the 12px gap; the missing pieces were why the harness never caught this) and locks both states: the overlay's computed `position` is `relative`, the band has positive height, the notice starts at the card top edge (12–14px, not on the card padding), the notice sits inside the card and above the draft line, the notice stacks above a retained draft dock, and the draft row does not cancel the card padding twice; the suite grows 920 → **931 checks** (two consecutive green runs after the fix).
- **Review fixes**: the independent reviewer found that the direct-child `:first-child` rule never matches the real DSH DOM because entries render inside a `display: contents` slot outlet (the notice sat 8px low and the card was 8px taller), and that the recorded packed bytes were 4 bytes off. This round uses a band-owned -8px top margin plus an on-demand-hint sibling override, mirrors the real DOM topology in the harness with a new top-edge assertion (observed failing on the old CSS), and updates the packed-byte figures from a fresh measurement.
- **Visual redesign (Codex gallery option C, Ghost Dismiss)**: the notice used to be a full-width bordered, filled, rounded alert card with 11px copy and an underlined blue dismiss link, i.e. it read as a content card pasted above the text area (PRODUCT.md names exactly that chrome as an anti-reference). It was first turned into a quiet status row (dot + secondary sentence + ghost text dismiss), then settled on the external gallery's option C: a state-toned semantic icon (`check-line` success / `information-line` business / `alert-line` warn / `external-link-line` warn / `close-circle-line` error), a 12.5px primary-ink lead clause plus a secondary detail clause (first semicolon, else first comma, with the separator kept inside the detail so the rendered copy is character-identical; `test/client/notice-copy.test.mjs` covers the zh/en split and re-concatenation with 3 unit tests), and an icon-only ghost × dismiss (`close-line` 14px; the existing `edit.applyNoticeDismiss` locale key supplies its accessible name and title; hover surface, 120ms color transition, focus-visible ring). Only the band hairline separates the row, with no border, fill or accent link. The failure copy keeps the primary label ink because the error token sits just under WCAG AA on the composer surface (4.50:1 light / 4.24:1 dark) and only colors the icon; body/detail copy measures 5.80:1 light / 9.25:1 dark against the real DSH tokens. Scenarios 57/58 add assertions for the semantic icon, the icon-only dismiss accessible name and the lead/detail split, and capture both light and dark rows (`harness-apply-notice-dark.png`, `harness-apply-notice-and-dock-dark.png`): 931 → **935 checks**.
- **Measured gate**: `npm run check` PASS; Node **810/810** = Host **309** + Client **464** + packaging **37**; **9/9** browser suites, `artifact-edit` **935 checks**, `nested-edit-renderer` **75**, image export **76** assertions; `npm run pack:check` **65** files, **6,120,699** bytes packed, **13,147,815** bytes unpacked; build host **846 kB**, client **4.20 MB** (js 3.96 / CSS 244.7 kB); `npm run check:docs-facts` and `git diff --check` pass.
- **Evidence boundary**: the local GUI is hosted by the running DSH Web service, and restarting it would interrupt this session, so the build was not followed by an agent-driven service restart; the final real-device visual check after a refresh/restart is left to the user. The browser evidence is a component-level harness (real composer card and overlay-anchor CSS), not a complete DSH Web session.

## 2026-11-13 — Draft rows adopt the gallery chip language

- **Context**: the design gallery the user picked shows the draft row as "file icon + title chip + revision/summary meta"; the previous round only implemented the notice row (option C), while the real draft row still used "head + dot + two-line title/meta". This round moves the real draft row to the same chip language.
- **Implementation**: in `DraftDock.tsx` the draft title is wrapped in `.dsh-iui-edit-draft-chip` (a 12px `file-text-line` icon, hairline border, hover surface, `--dsw-radius-sm`) and the revision/request summary follows inline as secondary meta; the old dot and its two-line text block (and their now-unused CSS) are removed; the active state moves onto the chip (the business-accent border is the selection cue — the fill step is ~1:1 and imperceptible — plus `aria-current`; hover only lifts the hairline, never impersonating selection); head/count, conflict/failed/detached tags, attach/discard actions and every data hook stay unchanged; the row cap widens to 400px to fit chip + meta.
- **Tests**: the `artifact-edit` E2E gains three assertions (file icon inside the chip, 1px hairline border on the chip, a selection border distinct from the idle chip), 935 → **938 checks**; the existing dock geometry/centering/divider/interaction assertions still pass.
- **Demo**: `.tmp-report/notice-demo.html` (temporary local service on `:4175`) now renders the chip row too and still toggles state/theme/draft row/old style.
- **Measured gate**: `npm run check` PASS; Node **810/810** = Host **309** + Client **464** + packaging **37**; **9/9** browser suites, `artifact-edit` **938 checks**, `nested-edit-renderer` **75**, image export **76** assertions; `npm run pack:check` **65** files, **6,120,723** bytes packed, **13,147,971** bytes unpacked; build host **846 kB**, client **4.20 MB** (js 3.96 / CSS 244.8 kB); `npm run check:docs-facts` and `git diff --check` pass.
- **Evidence boundary**: no real model call; the real GUI needs a DSH Web restart before a visual check (client bundle cache). E2E screenshots (`harness-draft-dock.png`, `harness-apply-notice-and-dock*.png`) and the demo cover both schemes and the notice+dock combination.

## 2026-11-14 — Independent re-review of the unreviewed commits + follow-up fixes (tests and docs only)

- **Context**: an independent read-only subagent re-reviewed the two commits that had never been re-reviewed: `3e46080` (the fix batch closing the Standards/Spec findings) and `0f3bf54` (the amend of the chip-row commit after the reviewer's findings). Verdict **MERGE OK WITH NITS**, no BLOCKER/MAJOR: the product fixes hold; the issues were two test-authenticity gaps and documentation precision. This round changes tests, docs and the check script only — no product behavior.
- **Test authenticity**: the `artifact-edit` E2E active-chip assertion used to compare only the active and idle border colors — the pre-fix `border-l3` differs from the idle `border-l2`, so it also passed on the old code. It now asserts that the active border equals `--dsw-alias-state-business-primary`, differs from the hover token (`border-l3`), and reaches WCAG 1.4.11's 3:1 non-text contrast against the card surface, asserted in both schemes with a self-check that the dark read really used dark tokens (938 → **944 checks**). `test/host/tool.test.mjs` asserts `ENABLED_SESSION_PREFIX` directly (deleting the tie-break sentence from the prefix used to stay green through the identical static-prompt sentence); `RETIRED_SKILL_MARKERS` gained the two old decision bullets' literal substrings.
- **Docs precision**: the marker module is now attributed to the guardrail plus the release check (the prompt does not import it); `whenToUse` lists its actual exclusions; the README `check:release` row says every packed path is checked and the owned paths are hash-compared; the current verification lines say "unpushed" instead of "uncommitted"; the active chip cue is the business border (the surface step is ~1:1); the 55 px dock band and the unconditional meta tooltip are recorded as accepted.
- **Measured gate**: `npm run check` PASS; Node **810/810** = Host **309** + Client **464** + packaging **37**; **9/9** browser suites, `artifact-edit` **944 checks**, `nested-edit-renderer` **75**, image export **76** assertions; `npm run pack:check` **65** files, **6,120,929** bytes packed, **13,148,354** bytes unpacked; build host **846 kB**, client **4.20 MB** (js 3.96 / CSS 244.8 kB); `npm run check:docs-facts` and `git diff --check` pass; `npm run check:release` re-run PASS.
- **Evidence boundary**: this is a review-follow-up round; no real model was called. The model-side tie-break behavior still needs a real-device session after a restart as the final check; the browser evidence is the component-level harness; the timeout/installer paths retain the previous real measurements plus this round's `check:release` re-run.


## 2026-11-14 — CI workflows and the docs link guard

- **Context**: after the full audit, this round adds CI and mechanical guards without changing product behavior. New `.github/workflows/ci.yml`: the `verify` job runs the same local gate on PRs/main (`npm run check`, `pack:check`, generated-file check) and the browser job runs the ten Chrome suites on main/manual dispatch only (artifact-edit has a known small flake probability, so it is not a PR gate yet). `publish.yml` now also runs `pack:check`, requires a CHANGELOG section for the tag and verifies the registry version/dist-tag after publishing. `check:release` stays a local pre-release gate until its Linux runner behaviour is verified.
- **Docs link guard**: `npm run check:docs-links` (now part of `npm run check`) checks local links, anchors, repository links and the public clone URL across the README pair, docs, changelog, test READMEs and the shipped Agent Skill. `test/packaging/manifest.test.mjs` now asserts CHANGELOG bullet uniqueness, renderer-README script coverage and the workflow trigger/gate contract. README, development, limitations and the sync-skill references are updated (CI description, command list, limitation wording, release gates).
- **Measured gate**: `npm run check` PASS; Node **810/810** = Host **309** + Client **464** + packaging **37**; **9/9** browser suites, `artifact-edit` **944 checks**, `nested-edit-renderer` **75**, image export **76** assertions; `npm run pack:check` **65** files, **6,120,929** bytes packed, **13,148,354** bytes unpacked; build host **846 kB**, client **4.20 MB** (js 3.96 / CSS 244.8 kB); `npm run check:docs-facts`/`check:docs-links` and `git diff --check` pass; `check:release` was not re-run this round (the local gate keeps the previous record).
- **Evidence boundary**: the GitHub Actions workflows have not run on a real runner yet (only YAML parsing and the equivalent local commands were verified locally); the first CI run's Linux/Chrome behaviour, and whether `check:release` can run on the Linux runner, need observation before wiring it into CI; no real model was called.


## 2026-11-14 — CI optimization (measured tuning)

- **Context**: a second tuning pass over both workflows against a CI optimization checklist (queue/setup/test phases from run history, cancel superseded PR runs, complete runs for every main commit, docs-only filtering, caches and duplicate work, prebuilt tools, parallel/split jobs, macOS limits, no repeated checks, push-and-observe). No product behavior changes.
- **Design**: a `changes` job classifies the diff; `verify` **always runs** (a required status check cannot be skipped by a filter): code changes run the full `npm run check` + `pack:check` (now `npm pack --dry-run --ignore-scripts`, reusing the built `lib/` instead of a second prepare), docs-only changes run only `check:docs-facts` + `check:docs-links`. PRs share a concurrency group with `cancel-in-progress`; every main commit gets its own group (including the SHA) so a release branch runs every commit to completion. The browser suites split into an `artifact-edit` shard and an other-suites shard — locally artifact-edit is 58 s of the 78 s suite, and the first real CI run spent 88 s in the single browser job. Chrome is resolved from the runner (google-chrome / google-chrome-stable); the only cache is setup-node's npm cache; no go/cargo installs, no macOS, no unnecessary needs (verify and browser run in parallel).
- **Measured (GitHub-hosted)**: first full run 43495680607: **118 s** wall (changes 8 s, verify 51 s [Local gate 33 s, pack 2 s], browser 102 s [setup 9 s, build 2 s, suites 88 s]). Full runs: **80 s** wall (2f4c45d; verify 51 s [Local gate 36 s, pack 0 s], artifact-edit shard 68 s [suites 58 s], other-suites shard 54 s [suites 35 s]) **93 s** after the classification job was narrowed to fetch only the diff base (2a85cc8a, runner cache/queue variance) and **81 s** for the final run on v7 actions (363324d); docs-only pushes measured **34 s** before and **21 s** after the classification fetch was narrowed (changes 4 s, verify 10 s, browser skipped, no npm ci or browser). checkout/setup-node actions are bumped to v7, removing the Node 20 runtime deprecation annotations. The first sharded run 43496285810 failed only because the input-orbit settled-geometry wait used the default timeout on a slower first CI layout: a 12 s version (43496813229) passed, and the final test uses a 15 s bound while keeping the exact 5 px assertion.
- **Local gate**: `npm run check` PASS (Node **810/810** = Host **309** + Client **464** + packaging **37**; docs-facts/docs-links ok); `npm run test:browser` **9/9** (artifact-edit **944 checks**, nested **75 checks**, image export **76** assertions); `npm run pack:check` **65** files, **6,121,044** packed / **13,148,877** unpacked; build host **846 kB**, client **4.20 MB** (js 3.96 / CSS 244.8 kB); `git diff --check` clean.
- **Evidence boundary**: runner queue/cache variance is ±10 s (first run 118 s, green sharded runs 102 s and 80 s), so each claim cites its run; the docs-only fast path does not re-pack (README text that changes tarball bytes still needs a local `pack:check`); `check:release` is still not in CI (Linux behaviour unverified); no real model was called.


## 2026-11-14 — Packaged-manifest fact guard

- **Context**: the README pair is packed into the npm tarball, but the docs-only CI fast path does not re-pack, so README text edits could change the shipped bytes without failing CI. New `npm run check:pack-facts` (inside `npm run check`): after the build it runs `npm pack --dry-run --json --ignore-scripts`, reads the packed file count and the sum of the **non-build** files (everything outside `lib/`), and compares them with `docs/current-facts.json` (`packFiles` / `nonBuildUnpackedBytes`). The non-build sum does not depend on npm/tar/gzip versions or the host esbuild output, yet still catches README text edits and added/removed files; the CI docs-only classification no longer includes the packed README pair, so README edits take the full gate.
- **Tests/guards**: `test/packaging/manifest.test.mjs` gains two assertions (the local gate includes `check:pack-facts`; the docs fast path covers only non-packed docs); `scripts/check-pack-facts.mjs` is standalone and points at re-measuring and updating current-facts when it fails. **Platform correction**: the first Linux CI run (43518528118) failed because the local vs runner `lib/` build bytes differ by 8,306 bytes (total unpacked 13,149,185 vs 13,140,829), so an absolute `unpackedSize` is not portable; the guard now compares the file count and the non-build byte sum 3,816,896.
- **Measured gate**: `npm run check` PASS; Node **810/810** = Host **309** + Client **464** + packaging **37**; **9/9** browser suites, `artifact-edit` **944 checks**, `nested-edit-renderer` **75 checks**, image export **76** assertions; `npm run pack:check` **65** files, **6,121,241** bytes packed, **13,149,185** bytes unpacked (local); `check:pack-facts` ok (65 files; non-build unpacked 3,816,896 bytes); build host **846 kB**, client **4.20 MB** (js 3.96 / CSS 244.8 kB); `git diff --check` passes.
- **Evidence boundary**: the guard does not check the compressed tarball bytes (npm/tar/gzip-version dependent); if the local and Linux-runner build outputs differ by bytes, the `unpackedSize` comparison will fail — the first Linux CI run validates build determinism, and if needed the guard should switch to per-file-type or tolerance rules.


## 2026-11-14 — Sidebar update card

- **Context**: DSH's Plugins page already checks updates, but the entry is buried. The extension adds a Host route `GET /api/intelligent-ui/update` (npm `latest`: six-hour success cache, five-minute failure cache, five-second timeout) plus the tag-pinned `release-notes/<version>.md` `## Highlights` (English UIs prefer `<version>.en.md`, falling back to the default file), and one in-flow "update available" card in the sidebar.
- **Placement and implementation**: DSH 0.2.2-rc.1 has no sidebar slot between New Session and the panel list (the browsing region is a single slot owned by ui-workspace), so `src/client/sidebar-update.ts` inserts one React host before the panel `<nav>`; an unknown shape inserts nothing (silent degradation). The "View details" label opens a fixed popover (to the right when it fits, below otherwise) that lists the points; clicking the rest of the card (including the always-right arrow) calls `pluginNavigation.openBundle` for this bundle's detail page; outside click/Escape closes it, and the card hides in the collapsed rail. An unreadable or prerelease running version answers `updateAvailable=false` (`installedVersion()` returns undefined) instead of a false positive. Highlights come from `release-notes/<version>.md`, which is human-reviewed and committed before the tag; `publish.yml` runs `npm run check:release-notes` before publishing and refuses a missing file or an empty `## Highlights` section.
- **Tests**: `sidebar-update.e2e.mjs` covers sidebar insertion/geometry/split click targets/popover/collapsed hiding and the zh/en highlights (23 checks); `test/host/update-routes.test.mjs` covers stable-version comparison, highlights parsing (Markdown removed), both default fetched URLs and caching, the English `?lang=en` URL/cache and its fallback to the default file, registry failure, missing notes (retried on the failure TTL), unknown/prerelease current version, GET-only and connection rejection. An ad-hoc Chrome interaction probe (not committed) verified the popover opens to the right of the card with the expected points, the card body (overlay button) invokes `openDetails` and closes the popover, the arrow does not rotate, and Escape closes it; static demo screenshots live in `.tmp-demo/` (not committed).
- **Measured gate**: `npm run check` PASS; Node **821/821** = Host **320** + Client **464** + packaging **37**; **10/10** browser suites, `artifact-edit` **944 checks**, `nested-edit-renderer` **75 checks**, image export **76** assertions; build host **850 kB**, client **4.21 MB** (js 3.96 / CSS 249.4 kB); `npm run pack:check` **65** files; non-build **3,818,258** bytes; `check:docs-facts`/`check:docs-links`/`check:pack-facts`/`check:release-notes` pass.
- **Evidence boundary**: not verified by hot-restarting a real DSH session (the running 3080 service still holds the old bundle); the real sidebar DOM matches the probe's structure but a DSH upgrade may change it, in which case the card hides; the Host needs access to `registry.npmjs.org` and `raw.githubusercontent.com`, and offline deployments degrade (no points or no card); the popover has no real screen-reader audit.

## 2026-11-14 — 0.6.0 release preparation

- **Context**: folded the post-0.5.0 Unreleased work into 0.6.0 (`package.json`/lock 0.6.0, CHANGELOG `## [0.6.0] - 2026-11-14`) and added the human-reviewed `release-notes/0.6.0.md` / `.en.md`. README status/install pins and the development guide's latest pin/tag examples now say 0.6.0; the stale "local main is unpushed" status text is gone.
- **Gate**: `npm run check` PASS; Node **821/821** = Host **320** + Client **464** + packaging **37**; **10/10** browser suites, `artifact-edit` **944 checks**, `sidebar-update` **23 checks**; build host **850 kB**, client **4.21 MB** (js 3.96 / CSS 249.4 kB); `npm run pack:check` **65** files, non-build **3,818,366** bytes; `npm run check:release` (local) PASS: all 65 packed files byte-identical to the installed copy, loader row/client bundle/embedded skill/uninstall all pass; `check:docs-facts`/`check:docs-links`/`check:pack-facts`/`check:release-notes` pass.
- **Release state**: version and notes are ready; the maintainer reviews the release-notes text before pushing the `v0.6.0` tag. The publish workflow reruns check/pack:check/release-notes on the tag and publishes through Trusted Publishing.

## 2026-11-14 — 0.6.0 release

- **Release**: annotated tag `v0.6.0` (pointing at `ee1e511`) triggered publish workflow run 43605229838; `npm publish --access public --tag latest --provenance` succeeded and the registry now shows **0.6.0** as `latest` with SLSA provenance attestations; the GitHub Release was created. The tag-pinned `release-notes/0.6.0.md` / `.en.md` return 200. **Correction**: the sidebar update card is a 0.6.0 capability; an installed 0.5.0 has no such code and cannot render it (0.5.0 users only see DSH's own Plugins-page update prompt), while 0.6.0 users will see the card and these highlights when a later release (0.6.1+) is published.
- **False-red publish job**: the workflow's registry check retried only 5 × 3 s; packument propagation took about seven minutes after the successful publish, so the check failed and marked the run red (`npm view` still showed 0.5.0, while the dist-tags/version endpoints eventually reported 0.6.0). The check now polls the registry endpoints directly for up to ten minutes (see the Unreleased Fixed entry) so later releases do not repeat it.
- **Gate**: local `npm run check` PASS; Node **821/821** = Host **320** + Client **464** + packaging **37**; **10/10** browser suites, `artifact-edit` **944 checks**, `sidebar-update` **23 checks**; build host **850 kB**, client **4.21 MB** (js 3.96 / CSS 249.4 kB); `npm run pack:check` **65** files, non-build **3,818,366** bytes; `check:docs-facts`/`check:docs-links`/`check:pack-facts`/`check:release-notes` pass.
- **Evidence boundary**: local `check:release` passed before publishing (65 packed files byte-identical to the installed copy); the publish workflow does not run the browser suites (main CI does); the GitHub Release body was created manually (the workflow does not create Releases).

## 2026-11-14 — 0.6.1 security/availability fix

- **Context**: issue #1 reported that 0.6.0 and earlier bundled `@openuidev/lang-core@1.0.1`, whose `resolveRef()` did not memoize shared references, so a model-authored doubling-reference program could expand exponentially in the synchronous Host parse. Measured with bounded 512 MB Node: 1.0.1 N=16 **626 ms / 256 MB**, N=18 **2,393 ms / 466 MB**; 1.1.1 N=16 **15 ms**, N=18 **6 ms**, N=20 **6 ms / 58 MB**. `@openuidev/lang-core` and `@openuidev/react-lang` are now **^1.1.1** (lock resolves 1.1.1); the rebuilt `lib/index.js` reports telemetry **1.1.1** and contains the memoized resolver; all **10 browser suites** pass locally (`artifact-edit` 944, `sidebar-update` 23).
- **Release result**: after maintainer review, tag `v0.6.1` triggered publish workflow run 43609493251 (**success**); npm **0.6.1** is `latest`, provenance verification passes, and the GitHub Release was created; the tag-pinned `release-notes/0.6.1.md` / `.en.md` are readable (2 + 2 points).
- **Gate**: Node **821/821** = Host **320** + Client **464** + packaging **37**; **10/10** browser suites, `artifact-edit` **944 checks**, `nested-edit-renderer` 75, image export 76, `sidebar-update` 23 checks; build host **858 kB**, client **4.20 MB** (js 3.96 / CSS 249.4 kB); `npm run pack:check` **65** files, non-build **3,818,283** bytes; `check:docs-facts`/`check:docs-links`/`check:pack-facts`/`check:release-notes` pass.
- **Evidence boundary**: availability-only fix; the upstream-noted superlinear unresolved-reference class is out of scope for this patch (a parse budget/off-main-thread parse could be added later). 0.5.0/0.6.0 users upgrade through DSH's Plugins page; the sidebar update card first applies when an installed 0.6.0 receives 0.6.1.

## 2026-11-14 — concise plugin-detail guide

- **Context**: DSH's Plugins detail page prefers the `meta.detail` document declared in `locale/<lang>.json` and falls back to the package README when absent. It had no such field, so the page showed the full README; it now uses the short `locale/detail.zh.md` / `locale/detail.en.md` settings guide while the README still serves GitHub, npm and the docs.
- **Implementation**: `locale/zh.json` and `locale/en.json` declare `meta.detail`; each guide is about ten lines covering the common settings, the experimental answer-as-document switch, and template/revision entry points, with links to the full docs. `test/packaging/manifest.test.mjs` now asserts the detail path exists, is non-empty, is under 4 KiB, and matches its language.
- **Gate**: Node **821/821** = Host **320** + Client **464** + packaging **37**; **10/10** browser suites, `artifact-edit` **944 checks**; build host **858 kB**, client **4.20 MB** (js 3.96 / CSS 249.4 kB); `npm run pack:check` **67** files, non-build **3,819,912** bytes; `check:docs-facts`/`check:docs-links`/`check:pack-facts`/`check:release-notes` pass.
- **Evidence boundary**: local verification covers the manifest/guard tests and packed file list; the actual DSH page render requires the version that contains these locale files (after an npm release) or a restarted file:-installed profile.

## 2026-11-14 — 0.6.2 release preparation

- **Context**: folds the post-0.6.1 plugin-detail change into 0.6.2: `locale/zh.json` and `locale/en.json` declare `meta.detail` pointing at the short settings guide in `locale/detail.zh.md` / `locale/detail.en.md`; the README still serves GitHub, npm and the docs. Version, CHANGELOG `## [0.6.2] - 2026-11-14`, `release-notes/0.6.2.md` / `.en.md`, and the README/development latest pins are ready.
- **Gate**: Node **821/821** = Host **320** + Client **464** + packaging **37**; **10/10** browser suites, `artifact-edit` **944 checks**; build host **858 kB**, client **4.20 MB** (js 3.96 / CSS 249.4 kB); `npm run pack:check` **67** files, non-build **3,819,958** bytes; `check:docs-facts`/`check:docs-links`/`check:pack-facts`/`check:release-notes` pass.
- **Pending**: the maintainer reviews the release notes, then tags `v0.6.2`; after publishing, the DSH Plugins detail page shows the short guide instead of the README.
