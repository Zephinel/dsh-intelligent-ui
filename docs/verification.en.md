# Verification record

[中文](verification.md) | English

[← Back to README](../README.en.md)

This is a historical verification record; test counts and packaging sizes are refreshed from the latest `npm run check` / `npm pack` output.

End-to-end verification was performed on a second, isolated DSH Web instance (port 3081, same profile + patch overlay):

- The model calls `render_ui` as instructed by the prompt and generates pages of 31–117 statements; invalid programs are rejected by the Host with precise field errors, and the model repairs them within the same turn.
- The component overview page, the San Francisco itinerary, the coffee calculator and the SVG origami tutorial all render correctly; photos (Wikipedia/Wikimedia), MapLibre maps + pins, charts, forms, timers, flip cards, confetti and HtmlView animations work.
- Interaction: checking timeline items updates counts, the SegmentedControl stays in sync, and form and button states behave; the dark theme switches automatically.
- Responsive: no horizontal overflow at 390 / 546 / 768 / 1092 px (the scoped `box-sizing` reset the component library relies on was added).
- Tests (live subclaims): the current main-branch evidence is in the second 2026-10-25 record appended at the end (Node 216/216; renderer parse/render 42/42, contrast OK, i18n 4 programs, typography 22/22; browser 7/7 with settings 101 and on-demand 114 assertions). Older browser/model records below remain historical.
- **Agent Skill end-to-end**: in a real DSH session the model called `skill { name: "intelligent-ui" }` and successfully loaded `<skill_content>` (15 KB body + a hint about the references base directory), then used `render_ui` as described by the skill to generate and render a verification page.
- **Bundle install path**: the `npm pack` artifact was installed into a throwaway profile (`~/.dsh/profiles/zbundle-test`, depending on `file:/tmp/…tgz` + `dsh.profile.bundles`); `dsh --profile zbundle-test --dump-config` exited 0, and its output contained `# == @zephinel/dsh-intelligent-ui` and the inserted row `id: intelligent-ui / name: '@zephinel/dsh-intelligent-ui'` (cleaned up after verification).
- **Three-state switch end-to-end (0.2.1-era record):** with the default "Off", requests contain no `render_ui` and the prompt is empty; after choosing "This session only", requests in that session carry the tool and the prompt and render a card, while a newly opened session is still off; after choosing "All sessions", newly opened sessions carry the tool and prompt directly; after choosing "Off", the file is cleared and new sessions again have neither tool nor prompt; control state syncs between two tabs over BroadcastChannel; the state file `{ "global": false, "sessions": [] }` and the projection behave as expected. The 0.3 session switch/style overrides and Article page still need live verification.
- **Style-panel browser E2E (component level, rerunnable):** `npm run test:browser` first loads the `ToggleControl` harness in headless Chrome + CDP and verifies chip → menu (no "All sessions", has "Display style") → This session only → style panel, and that the panel's back button returns to the scope menu instead of dismissing every popup, with focus landing on the Display style row; the menu sizes to its content with a 208px minimum, right-aligns with the chip, rows share one minimum height and spacing, the divider is inset, the chevron reaches 180° when open, and with the switch off "Display style" stays visible but disabled and cannot open the panel; the panel rect stayed inside the viewport, focus moved into the panel; dragging the real range to Article emitted `style:article`; Escape closed the panel and returned focus to the chip. This does not boot the full DSH Web and is not a substitute for a Host/Client integration E2E.
- **Image-export browser E2E (component level, rerunnable):** `npm run test:browser` then loads `test/browser/harness/export-entry.tsx`: real `ExportAction` + real renderer card + two entries (one whose Chat selector runs the real `messageHasRenderUi` against a structural snapshot and reports no rendered output), with a real `SearchImage` whose Wikipedia lookup is stubbed to a local SVG. It asserts that only the extension answer gets a labeled trigger (visible copy, `order: 1`, flush with the action row's right edge); the export menu is right-aligned, content-sized, flips below the pill when the top edge is short, and dismisses on scroll; it then exports the raw, card and rounded-2x frames from the real menu: the initially collapsed card is expanded for the capture and collapsed again afterwards; the capture sees a flattened 3D flip, frozen transitions/animations, eager/completed lazy photos and a fake map that only reports ready after the expansion resize; the card frame is wider/taller than the raw frame by the padding plus shadow bleed and its shadow band contains non-zero alpha pixels; the rounded-2x frame is twice the raw size plus 2x padding. This does not boot the full DSH Web; cross-origin Wikimedia capture was reproduced manually with the same session program (see the next bullet).
- **Interactive-page browser E2E (component level, rerunnable):** the interactive-page `npm run test:browser` script passes the real `lib/standalone.js` / `lib/standalone.css`, a theme snapshot and two card programs to `buildStandaloneHtml`, opens the resulting single-file HTML in headless Chrome, and asserts that it has no external script/stylesheet, is at least 3.4 MB, mounts both card bodies with no header/collapse chrome, and that the inline theme applies, and that an `@ToAssistant` button shows the copy fallback toast instead of calling DSH; it then opens the same page with **Remove follow-up actions** on and asserts that the whole Card containing the follow-up is hidden (including a Button nested in a Row), a non-follow-up `@OpenUrl` Button remains visible, a root-level follow-up hides only its control rather than the page, and no html-level hidden attribute is set; the image-export E2E also asserts that the follow-up Card is absent from the PNG (shorter capture). This does not boot DSH Web.
- **Custom color-picker browser E2E (component level, rerunnable):** the settings-picker `npm run test:browser` script renders the real Plugin detail page and asserts that the native `input[type=color]` is gone, the background trigger and 12 preset swatches exist, a preset commits `exportBackground`, and a hex value commits on Enter and closes the panel; real-mouse cases prove a preset wins while the hex field is focused and a valid typed draft commits when clicking outside.
- **Article-layout browser E2E (component level, rerunnable):** the fourth `npm run test:browser` script renders a small Article fixture and asserts that every Section body is its own flow with 16px block gaps (12px after a title) instead of touching blocks, and that the page-level flow no longer adds an extra 18px flex gap, so sections keep one page-level gap (~24px) rather than a doubled blank band.
- **Follow-up export switch:** the Plugin detail page **Export** group adds **Remove follow-up actions** (volatile Host `removeFollowUps`, on by default); when on, both images and the standalone page hide the semantic block containing the follow-up control (Card/Form/Carousel item/Pressable/Row) and disable the copy callback; turning it off keeps the block and restores the page copy fallback. The setting applies to images and pages alike. Covered by settings SSR, the image-export E2E and the standalone-page E2E; a `to-assistant` unit test locks down the bare-button-only rule and the legacy `exportToAssistant` migration.
- **Layout/spacing contract:** the generation prompt and Agent Skill now carry the layout rules; the Host `layoutWarnings` returns non-fatal warnings for a root `gap`, vertical `Spacer()`, empty `Section`/`Text` and `gap: 0` block stacks (covered by Host unit tests); Article Section bodies are nested flows and the page root no longer adds a flex gap, guarded by the article-layout E2E (measured 16/16/12/16px body gaps and ~24px between sections).
- **Image export (2026-10-22, component-level + browser experiments)**: the bottom export entry and image export are implemented and build cleanly. A temporary headless-Chrome + CDP harness (real `ExportAction` + real renderer card) verified that the button appears only for messages whose Turn recorded `render_ui`; the menu offers raw / rounded / card; collapsed cards expand for the capture and restore afterwards; the 2x rounded frame produced a 1616×2348 PNG with the configured background and a filename carrying the title and local time. MapLibre experiments: with the default `preserveDrawingBuffer: false` the canvas `toDataURL` was blank (~9 KB); with `canvasContextAttributes.preserveDrawingBuffer` enabled it contained the full map (~449 KB), and capturing inside a `render` event also worked. This did not boot the full DSH Web; a manual check in a restarted DSH Web session is still pending. The historical program from session `c3a17e93-b553-4f6f-8734-3997fa02a751` was then used to reproduce and fix two defects found in a real export: stacked flashcard 3D faces (overlapping text in the image) and empty photo boxes when the image search or load had not finished; the `export-image` E2E in `npm run test:browser` now guards the flashcard flattening and the photo-settling path (with a stubbed local search; cross-origin Wikimedia capture was reproduced manually), and its card-frame assertions cover the shadow geometry too.
- **UI language**: zh/en dictionary key parity, Chinese SSR of the scope control, and Chinese plus English-fallback SSR of renderer chrome (Code, Timer, Map, empty-program fallback) are covered by automated checks; a manual language switch in a running Web UI has not been performed yet.
- **0.2.0 release**: pushing tag `v0.2.0-26-10-21` triggered GitHub Actions [run 39592467955](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39592467955) (`publish.yml`, 33 s) and published the package; registry `latest` = `0.2.0-26-10-21`, `gitHead` = `e5ce0af`, and `npm audit signatures` verified both the registry signature and the provenance attestation (SLSA v1). GitHub release: [v0.2.0-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.0-26-10-21).
- **0.2.1 release**: the configuration moved from Settings to the Plugins detail page (`plugins.bundle.config`, keyed by the package name) and the switch now mirrors the native DSH style; tag `v0.2.1-26-10-21` triggered [run 39596441971](https://github.com/Zephinel/dsh-intelligent-ui/actions/runs/39596441971), registry `latest` = `0.2.1-26-10-21` (`gitHead` = `4dcd34b`), and `npm audit signatures` verified the provenance; local `npm run check` had 65 tests and `npm pack` shipped 34 files. GitHub release: [v0.2.1-26-10-21](https://github.com/Zephinel/dsh-intelligent-ui/releases/tag/v0.2.1-26-10-21).
- Verified DSH version: **0.2.1-rc.2** (`dsh --version`). Later versions are unverified.
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
| `npm run pack:check` | PASS; 43 files; tarball **4,036,061 bytes** (4.04 MB), unpacked **10,216,623 bytes** (10.22 MB) |
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
| `assets/intelligent-ui-settings.webp` | 1336 × 2690 |
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
