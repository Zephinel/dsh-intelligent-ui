# Browser E2E

Nine focused suites boot a temporary HTTP server (or a local file) + headless
Chrome and drive the real components through CDP. They check DOM, layout and
events but not the full DSH Web integration.

- `artifact-edit.e2e.mjs` mounts the production card list with one recorded
  `render_ui` program (the 夏令时与冬令时 sample fixture) and exercises block
  editing and arrangement: entering edit mode, an empty request list and an
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
  envelope carries `"branch":true` with the old base). The M3-3 scenario saves an
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
  menu focuses its first target and moves focus with arrow keys. 180 checks;
  The last scenarios check the editing width fit: the chat content is narrowed
  while editing and restored on exit, no expand button remains, and the fitted
  width follows a live change of the shell width preference. 207 checks; no real
  model is called (the
  real-model restore/branch, cross-tab lease and nested-edit/nested-order
  acceptance were run manually against an isolated second DSH Web instance and
  are recorded in the M3/M4 plans).

- `on-demand.e2e.mjs` mounts production plugin slot registration with structural DSH services: arming/cancel commands, tab-scoped hint, draft-safe examples, result adjustment/save, free/legacy replay, metadata-only saving that preserves the source layout, and selected free-template replay across page reload without temporary actions, duplicate/error/pending handling, template management, focus return, zh/en and light/dark/narrow layout. It does not call a real model.
- `style-theme.e2e.mjs` checks four recorded cards: inline replay independent of the catalog, saved-template themes, light/dark, late/missing/unavailable catalog and recovery.
- `style-panel.e2e.mjs` drives the composer style panel: chip -> menu -> This
  session only -> style panel -> back to menu -> built-in/custom preview cards -> composer import entry -> export confirmation for global and session templates -> Escape/focus return, and checks the
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
  pure follow-up Card does not (its marker colour is absent). Two `ExportAction` entries are mounted; the one whose Chat selector
  reports no rendered UI must not add a trigger.

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
