# Known limitations

[中文](limitations.md) | [Back to README](../README.en.md)

This page lists only the **current** boundaries and unverified areas; implemented behavior lives in the [Usage guide](usage.en.md) and [Architecture and behavior](architecture.en.md).

## Runtime and compatibility

- The DSH plugin API targets **0.2.2**; the validated build is **0.2.2-rc.1** (current latest), and later DSH versions are untested.
- Build, test and release workflows use **Node.js 24**; the repository pins neither `engines` nor `.nvmrc`.
- Validated platforms are macOS (Web + DSH Desktop) and Windows (DSH Desktop); Linux is not verified.
- The browser half requires `@deepseek-ai/dsh-client-locale` in the deployment (DSH Web 0.2.2 includes it); a minimal profile without it cannot mount the switch or cards.
- The plugin settings page needs `dsh-settings` / `dsh-client-ui-settings`; interactive-page export needs the `webServer` service. Missing services hide the corresponding UI.
- After a client-bundle change, **restart `dsh-web`**; a page refresh is not enough.

## Answers and rendering

- A card appears at the **end of its turn**; during generation the process row only shows "Interactive answer".
- The model can produce invalid OpenUI Lang; the Host returns precise validation errors and the model usually repairs within the same turn (1–2 attempts observed), but success is not guaranteed.
- The generation prompt is about 10K tokens and is sent only when the switch hits the session; off means no prompt and no tool schema. Article pages take longer to generate and render.
- Maps use OpenFreeMap tiles, routes use the OSRM demo, and photos use Wikipedia/Wikimedia; offline maps fall back to a place list and photos to placeholders.
- KaTeX relies on the DSH shell's global styles; removing them degrades `Math` to plain text.
- `/iui` Host replies, command-palette descriptions and README screenshots stay English; only browser UI copy follows the DSH language.

## Export

- Image export does not include sandboxed iframe content (`HtmlView` mini-games); maps rely on the WebGL buffer and fall back to the map's own degraded view when WebGL is unavailable.
- All cards in one turn are combined into one image, and export captures the **current interactive state** (checks, filters), not the initial state. Export waits for images/search for up to ~12.5 seconds and otherwise captures placeholders.
- Interactive-page export inlines the renderer, theme and all cards into one HTML (roughly 3.4–4.9 MB); maps and photos still need the network. `@ToAssistant` uses the clipboard; when unavailable it shows the message for manual copying.
- Temporary style, templates and on-demand state do not travel with the exported HTML for cross-device editing; the export is the rendered result.

## Templates and styles

- Portable template exchange is v1 and at most **32 KiB (UTF-8)**; only the exchange envelope is accepted, not raw template exports or library backups. Limits are 40 global and 20 session templates.
- Import creates global templates only; session-scope import is not open yet. There are no share codes, live links, batch backups or batch imports.
- External template names and directives enter the prompt as untrusted text; preview and explicit acknowledgement reduce but do not remove prompt-injection risk. Origin/CSRF and tool-permission auditing are still recommended for real deployments.
- Custom light/dark themes apply to the renderer host only; portaled Popovers and sandboxed iframes keep the default theme. Interactive-page export freezes the exported scheme.

## On-demand, drafts and tabs

- On-demand operations are memory-only: armed state expires after 10 minutes and is lost on restart; completed results survive. One active operation per session; a bound running/clarifying operation refuses re-arm and allows at most two clarification rounds.
- The on-demand hint appears only in the initiating tab, but the Host binds the session's next human message without checking the sending tab; send from the initiating tab.
- Unsent edit drafts are stored per tab in `sessionStorage`: refresh restores them, but **tabs do not share them**; `branch`, `latestRevision`, `submitFailed` and undo records are not persisted, and oversized programs are not stored.
- Cross-tab edit leases use BroadcastChannel and only warn; they do not merge edits or block editing. Without the channel there is no warning, and the Host revision check remains authoritative.

## Block editing and structural operations

- Editable blocks are every direct child of the root `Col` and of the seven allowlisted containers; `@Each`, opaque expressions, shared named expressions, page chrome and pages over the depth/node budget are not editable. The CST node budget is **200**, so very long article pages can be rejected.
- Top-level order must contain exactly the base revision's top-level blocks (at most 100); the Host merges the model's edited fragments and leaves unselected blocks byte-identical.
- One request carries at most 12 content edits; instructions are at most 2,000 characters and the global note 4,000. A request with no actual change is rejected.
- Strict protection only detects **identified unselected top-level blocks**; changes inside a selected root block's subtree are not detected.
- A natural-language style adjustment turns a saved/built-in-style page into a result-owned (temporary-style) revision: without a model-provided theme it inherits the session theme rather than the original template theme (template-theme continuity is a follow-up); history shows the source as "block edit" plus the temporary-style badge; cards without a valid base or on an old Host do not offer the in-editor style section and keep the footer Adjust style fallback; deterministic built-in/template switching is not available yet (B2). Each temporary-style revision adds one result-registry snapshot (existing LRU cap).
- Structural operations support duplicate, delete, same-parent/cross-container move and one addition per container; nested-to-root moves, batch undo/GC, and helper cleanup are not supported. Cross-container moves append to the target. Off-screen Carousel anchors may need draw-time clipping (not implemented).
- Structural operations directly close the current draft (`markSubmitted`); a "structure changed, content draft stale" confirmation UI is not provided.
- Legacy pages need no manual migration: the first time you open editing, revision history or restore, the client registers the currently rendered content as the Host's authoritative base (write-once, never overwritten), after which structure operations, history and restore work. Remaining limits: with an old Host (no registration route) mixed with a new client, registration is unavailable and the affected operations fall back to instruction editing or a re-render; legacy cards never touched by an authoritative operation stay unregistered (no background migration); an LRU-evicted non-current revision program cannot be reconstructed client-side; a registered initial revision shows the registration time in history. The authoritative registry holds at most 200 programs / 50MB.
- Local structure/property revision cards live in browser `localStorage`, render only in the triggering Turn, are not assistant messages, do not participate in image/interactive-page export and are lost across devices.
- Edits for multiple artifacts are independent with no cross-artifact transaction: one failure does not roll back other successful revisions. After a Turn, drafts are reconciled by requestId; unfinished drafts return as "not completed, draft kept" for re-attaching and are never auto-retried. Host pending still has a 15-minute TTL; Turn ownership uses a send-time window heuristic, and extreme clock/latency cases are unverified.
- The real-model "partial success" path has not been validated in the real GUI; single-card, two-card, nested-edit and structural-operation success paths have.

## Runtime state and accessibility

- Runtime snapshots are memory-only and lost on refresh; caps are 24 artifacts, 5 revisions per artifact and 64KiB per snapshot. First renders do not inherit history; only a revision with `baseRevisionId` inherits from its base. Third-party internals and edit-canvas interactions are not preserved.
- The edit canvas supports screen readers and keyboard-only use, but has not had a real screen-reader/axe audit. The live region is a single polite slot, so rapid reorders merge announcements; pointer drag announces only on drop.
- Input-orbit forced-colors/touch behavior is validated through Chromium CDP emulation only; real Windows High Contrast, iPad/Safari and dark-theme contrast are unmeasured.
- Visual baselines are manual (5 PNGs) with no automated pixel diff; layout was checked at 390×844, 900×1000 and desktop widths, not across more devices/browsers.
- `npm run check` does not include the Chrome browser suites, and there is no PR CI; releases run from a tag-triggered GitHub Actions workflow. `tsc` does not check `src/client` because DSH platform types are runtime-provided.
