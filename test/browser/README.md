# Browser E2E

Nine focused suites boot a temporary HTTP server (or a local file) + headless
Chrome and drive the real components through CDP. They check DOM, layout and
events but not the full DSH Web integration.

- `artifact-edit.e2e.mjs` mounts the production card list with one recorded
  `render_ui` program (the 夏令时与冬令时 sample fixture) and exercises block
  editing and arrangement. The current pipeline (scenarios 48–69) also covers
  the M1 active revision stage (in-place updates, notice rows, frozen-promotion,
  remount convergence, read-only stage for a frozen card's revision), the M2
  version bar/thumbnails/FLIP/Details flow, the queue → save → total preview →
  Apply edit pipeline (atomic structural revision, draft remap and
  auto-send/manual fallback, conflict blocking, pending-queue reload, deep vs
  too-deep pages, the 61–64 mapping/cap regressions), the Phase A real-send,
  attached-draft, nested-Apply and preview-contract fixes (65–68) and the
  Phase B deletion-fallback/read-only-recovery scenario (69). The historical
  narrative below keeps the earlier scenario descriptions; the M4-5
  “preview a structure operation” flow is the pre-pipeline behaviour (every
  structure operation now enters the pending queue and applies through the
  total preview). It starts with entering edit mode, an empty request list and an
  always-complete arrangement, opening a popover without creating a request,
  numbered/colour request rows after saving, the hover request card, keyboard
  (↑/↓/Home/End) and pointer-drag reordering with live canvas preview, locate-only
  row activation, Reset order preserving requests/numbers/global instruction, the
  conditional request list, the composer chip labels, one structured
  `<artifact-edit-request>` envelope carrying edits + `targetOrder` + the global
  instruction and targeting `edit_ui_blocks`, replay of a Host-composed
  revision-2 result from `presentationMeta`, an order-only send through
  `render_ui`, a background revision probe (window focus) surfacing the conflict
  banner, a conflict blocking the send, the 720–1179px drawer, the below-720px
  minimum-width notice and dark chrome. The multi-card scenario then edits two
  cards into two drafts with two chips, keeps an inactive draft across a canvas
  switch, shows the (2/6) draft switcher, deletes a chip so its draft becomes
  detached and re-attaches it, composes one message with two envelopes carrying
  their request ids, applies two independent block-edit revisions as two cards
  and shows two sent-summary chips. The final reconciliation scenario closes the
  Turn: when every submitted request produced a revision the drafts and badges
  disappear, and when a batch is only partially fulfilled the untouched draft
  comes back with the `failed` draft badge (**Not completed; draft kept**) and
  can be re-attached into a new chip. The M3-2 scenarios restore an old revision
  into a local revision card without a model call (local badge, restore-done
  notice, exactly one copy) and branch from an outdated revision's conflict
  banner (note names the base revision, chip label gains " · branch", the
  envelope carries `"branch":true` with the old base). The revision-history
  scenario opens from the single header icon (which carries the rendered
  revision number instead of the removed `Revision N` badge), asserts the
  rollback copy when the card's own revision is deleted, and scenario 41 deletes
  a rendered revision and checks that the card re-renders the retained fallback
  revision (number and content), that the rollback survives a rerender, that the
  redirected card is read-only (no edit entry and, while the native fallback
  revision's editor is open, no second edit canvas), and that no delete is
  offered when no fallback program exists. Scenario 42 covers image
  sources: workspace-relative, absolute and padded paths render from blob URLs
  via the mocked `remote.workspaceFiles`, http(s) and inline data images still
  load, a missing file / broken URL / SVG / parent-segment path / empty source
  each show their own error placeholder, an inline data-URI pixel bomb is
  rejected from its header and the error placeholder's accessible name carries
  the reason, Markdown images (including an angle-bracket destination with a
  space) use the same resolver, the real DOM asset collector produces data URLs
  for the HTML export, and an explicit source never triggers a Wikipedia photo
  search. Scenario 43 checks that an unsent draft on one card makes its base
  revision undeletable from another card's history; scenario 44 checks that a
  revision still used as another revision's base hides Delete with an
  explanation; scenario 45 proves the HTML export's local-only settle waits for
  a slow local reader but not for an outstanding image search; scenario 46
  checks that a fallback to the initial revision neither shows Save nor Adjust
  for the borrowed style snapshot; scenario 47 checks that a live fallback
  target cannot be deleted without an older fallback and that deleting it once
  one exists retargets the chained fallback to the older revision; scenario 20
  also asserts that deleting a local-card revision records no rollback
  fallback. The M3-3 scenario saves an
  unsent draft, checks its `sessionStorage` payload, reloads the page and
  confirms the composer chip and the pending request list are restored, then
  resets to the pristine harness state. The M3-4 scenario then edits a
  temporary-style card's block content: the card carries the temporary marker,
  the envelope carries the style snapshot without a style id, the revision card
  keeps the temporary style, and an order-only draft is blocked with the
  saved-style guidance. The M4-1 nested scenario adds a nested card, edits it
  with the opt-in nested mode, selects nested block `b1.1.1`, saves an
  instruction and checks the envelope carries the nested identity fields
  (nodeId/sourceDigest/depth). The M4-2 scenario then reorders two children
  inside one nested parent in the **Nested block order** list: the list rows
  swap, the reset control enables, the composer chip reports the reorder, and
  the envelope carries `orderByParent` while keeping the legacy root
  `targetOrder`. The M4-3 scenario then duplicates a nested block through the
  row action (one mocked structure POST with nodeId/sourceDigest/toIndex),
  checks the structural-revision local card label and that the editor closes.
  The M4-4 scenario selects Box/Grid/Section/Carousel children in nested mode,
  checks the envelope carries a Grid child id, and exercises the completion
  paths: an addition instruction appears in its group and the envelope carries
  the `additions` entry, while the **Move to…** menu excludes root/current
  parent/ancestors and sends one move structure request with the target node id
  and index. The M4-5 flow then previews a structure operation: the dry-run
  request returns a preview, the modal exposes `aria-modal` with initial focus
  on Cancel and add/remove/same diff rows, confirming sends the real apply, and
  a cross-container move is previewed and applied as two requests. The B2-5
  scenario then toggles **Strict protection**, checks it is off by default and
  that the envelope carries `"strict":true` with the strict instruction. The
  B2-6 scenario then applies an edit revision and checks the new card inherits
  the runtime `$state` (the selected DST option and its derived note). The B1-5
  scenario then checks the live region announces nested reorders and additions,
  the nested grip references the hidden keyboard hint, and the **Move to…**
  menu focuses its first target and moves focus with arrow keys. The latest round
  adds the single-row **More** menu (Locate/Edit/Duplicate/Move/Delete with an
  in-menu delete confirmation), the input focus orbit, menu keyboard/focus and
  forced-colors checks, page/request numbering, a real shell-width 1180px fit,
  and artifact-missing/reflow coverage. The composer mock now carries the real
  DSH absolute overlay anchor plus its display:contents slot outlet and a
  preceding hidden slot entry, and scenarios 57/58 assert that the post-Apply
  result notice starts at the card top edge (not the card padding), stays inside
  the card and above the draft line, both notice-only (Apply consumed the draft)
  and above the retained draft dock, and capture the quiet notice row in light
  and dark. The input-orbit checks now exclude dropdown triggers, which keep their
  menu focus state. Scenario 36
  covers the Artifact base-registration lifecycle on legacy cards: opening the editor registers exactly one base with the render call id as the
  revision identity and the rendered program, the registration precedes the first structure request, the old-host 404 degrades without blocking,
  both the props fallback and the duplicate-preview failure show the actionable missing-authoritative-program copy, and scenario 39 covers the B1 in-editor style editing: style section visibility/capability, focus/Escape/clear, style chip label, style envelope fields (kind/styleInstruction/editRequestId, no block fields), mixed-content blocking, a mocked style revision card with Save, the legacy footer Adjust fallback rules, unit-tested `struct_` history labelling (E2E does not reopen history), third-pass assertions for contract-correct block/style envelopes (exact tool args, parser marker hardening, order-only title/styleId, temporary additions, unsaved-draft guard), and scenario 40 covers B2 deterministic style switching: capability picker/current row, zero-POST hover/focus preview (article wrapper + template accent), one-POST apply with `operations: []` + target + scope, local style revision card with no composer chip, dirty guard, temporary-base drop, Article targets disabled client-side, `style_missing`/`base_style_mismatch` copy, keyboard/a11y/forced-colors, the capability-off B1 regression, and the review follow-ups: contract-correct style envelope, preview-on-open suppression, style_missing/blocked-Apply/mismatch copy and client-side Article gating.
  931 checks; no real model is called — the Phase A/B edit-pipeline sends run
  through the production send path against the harness composer (the real-model
  restore/branch, cross-tab lease and nested-edit/nested-order acceptance were
  run manually against an isolated second DSH Web instance and are recorded in
  the M3/M4 plans).

- `on-demand.e2e.mjs` mounts production plugin slot registration with structural DSH services: arming/cancel commands, tab-scoped hint, draft-safe examples, result adjustment/save, free/legacy replay, metadata-only saving that preserves the source layout, and selected free-template replay across page reload without temporary actions, duplicate/error/pending handling, template management, focus return, zh/en and light/dark/narrow layout. It does not call a real model.
- `style-theme.e2e.mjs` checks five recorded answers: four cards (inline replay independent of the catalog, saved-template themes, light/dark, late/missing/unavailable catalog and recovery) plus a recorded document-mode answer that must render as a chrome-less section with its program mounted and no card header, while ordinary cards keep theirs.
- `style-panel.e2e.mjs` drives the composer style panel: chip -> menu -> Display style row -> style panel -> back to menu -> scope switch to This session only (asserts no auto-open) -> active entry opens the panel -> built-in/custom preview cards -> composer import entry -> export confirmation for global and session templates -> Escape/focus return, and checks the
  content-sized menu, upright chevron, inset divider and disabled Display style
  row while the switch is off. It renders the real `ToggleControl` in a browser.
- `export-image.e2e.mjs` renders a card with a flipped `Flashcard` and a real
  `SearchImage` (its Wikipedia lookup is stubbed to a local image), then drives
  the real `ExportAction` menu and the production `exportCardsImage` pipeline:
  the capture must see the flattening scope, frozen transitions, eager/loaded
  photos, an expanded/restored collapsed card, a map readiness signal (fake map
  fixture), the raw, card and rounded-2x frames, and the card frame's shadow
  bleed, temporary-result theming, free-layout temporary/saved-template PNG capture and the live HTML download. It also checks the menu's right alignment, content width, below-trigger
  fallback and dismissal on scroll. With the follow-up-removal toggle on it also
  proves a mixed Card still appears in the PNG (prose pixels present) while a
  pure follow-up Card does not (its marker colour is absent). The revision-notice
  case exports the active stage card rather than the raw recording, and a
  notice-only answer whose artifact has no capturable stage shows the concrete
  cause (no image is downloaded) instead of the generic retry copy. Two
  `ExportAction` entries are mounted; the one whose Chat selector reports no
  rendered UI must not add a trigger. 76 assertions.

- `article-layout.e2e.mjs` renders a small Article fixture and measures the
  computed rhythm: Section bodies are nested flows with 12–16px block gaps, and
  the page-level flow does not add a second flex gap before sections.
- `settings-picker.e2e.mjs` renders the real Plugin detail page and drives the
  global template management (use, rename, edit, delete and Auto fallback), portable file exports with confirmation, paste/file import of free envelopes, wrong-version/oversized-input rejection, raw-export/store-document rejection in codec tests,
  acknowledgement/edit/clear, local/server errors, quotas, double-submit protection, zh/en, narrow dialogs and keyboard focus, plus the custom export-background picker: native color input is gone, presets commit,
  the hex field commits on Enter and the panel closes.
- `standalone-page.e2e.mjs` assembles the real single-file page from
  `lib/standalone.js` / `lib/standalone.css` plus three recorded cards, opens it
  in Chrome, and checks the inline-only assets, all three mounted card bodies (no
  header/collapse chrome), inline and saved-template theme exports in forced light/dark, free temporary/template and legacy mixed-layout exports at wide/narrow widths in light/dark, the inlined theme, the `@ToAssistant` copy toast, and the remove-follow-up variant: a mixed Card keeps its prose while only its follow-up control (and form fields) is hidden, a root-level follow-up hides only its control, and a pure follow-up Card disappears whole.
  Run `npm run build` first so the standalone artifacts exist.

- `nested-edit-renderer.e2e.mjs` mounts the edit-mode nested library and measures
  the `display:contents` wrappers: card/text 0px drift, innermost click and
  hover, overlay union rects, the reorder path mapping and unchanged ordinary
  rendering without wrappers. M4-4 extends it to all seven containers (18 slots),
  Box/Grid/Section/Carousel parent chains and Carousel scrolling/overlay
  hit-testing. 75 checks; Carousel off-screen anchors are a known follow-up.

- B2-8/B2-9/B2-10 verification (real GUI, not part of the suites): Article and
  free-composition layouts were validated (free requires On-demand UI; a plain
  `render_ui` with free is rejected), 390×844 mobile shows no horizontal
  overflow and the narrow-width notice instead of the editor while 900×1000
  opens the editor, and manual visual baselines live in
  [`visual-baselines/`](visual-baselines/README.md) (5 PNGs + captures.json +
  SHA256SUMS; human comparison only, no automated pixel diff).

```bash
npm run build && npm run test:browser
# CHROME_BIN=/path/to/chrome npm run test:browser  # non-macOS / custom Chrome
```

The shared launcher retries a headless Chrome start up to three times with a fresh
profile when no page target appears (CI cold starts); only a repeated failure exits
nonzero.

The suites are outside `npm run check`; CI does not need a browser.
