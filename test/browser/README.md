# Browser E2E

Eight focused suites boot a temporary HTTP server (or a local file) + headless
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
  envelope carries `"branch":true` with the old base). 111 checks; no real model
  is called (the real-model restore/branch acceptance was run manually against
  an isolated second DSH Web instance and is recorded in the M3 plan).

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

```bash
npm run build && npm run test:browser
# CHROME_BIN=/path/to/chrome npm run test:browser  # non-macOS / custom Chrome
```

The shared launcher retries a headless Chrome start up to three times with a fresh
profile when no page target appears (CI cold starts); only a repeated failure exits
nonzero.

The suites are outside `npm run check`; CI does not need a browser.
