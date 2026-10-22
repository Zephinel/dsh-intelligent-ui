# Browser E2E

Seven focused suites boot a temporary HTTP server (or a local file) + headless
Chrome and drive the real components through CDP. They check DOM, layout and
events but not the full DSH Web integration.

- `on-demand.e2e.mjs` mounts production plugin slot registration with structural DSH services: arming/cancel commands, tab-scoped hint, draft-safe examples, result adjustment/save, duplicate/error/pending handling, template management, focus return, zh/en and light/dark/narrow layout. It does not call a real model.
- `style-theme.e2e.mjs` checks four recorded cards: inline replay independent of the catalog, saved-template themes, light/dark, late/missing/unavailable catalog and recovery.
- `style-panel.e2e.mjs` drives the composer style panel: chip -> menu -> This
  session only -> style panel -> back to menu -> built-in/custom preview cards -> Escape/focus return, and checks the
  content-sized menu, upright chevron, inset divider and disabled Display style
  row while the switch is off. It renders the real `ToggleControl` in a browser.
- `export-image.e2e.mjs` renders a card with a flipped `Flashcard` and a real
  `SearchImage` (its Wikipedia lookup is stubbed to a local image), then drives
  the real `ExportAction` menu and the production `exportCardsImage` pipeline:
  the capture must see the flattening scope, frozen transitions, eager/loaded
  photos, an expanded/restored collapsed card, a map readiness signal (fake map
  fixture), the raw, card and rounded-2x frames, and the card frame's shadow
  bleed, temporary-result theming and the live HTML download. It also checks the menu's right alignment, content width, below-trigger
  fallback and dismissal on scroll. Two `ExportAction` entries are mounted; the one whose Chat selector
  reports no rendered UI must not add a trigger.

- `article-layout.e2e.mjs` renders a small Article fixture and measures the
  computed rhythm: Section bodies are nested flows with 12–16px block gaps, and
  the page-level flow does not add a second flex gap before sections.
- `settings-picker.e2e.mjs` renders the real Plugin detail page and drives the
  global template management (use, rename, edit, delete and Auto fallback) plus the custom export-background picker: native color input is gone, presets commit,
  the hex field commits on Enter and the panel closes.
- `standalone-page.e2e.mjs` assembles the real single-file page from
  `lib/standalone.js` / `lib/standalone.css` plus three recorded cards, opens it
  in Chrome, and checks the inline-only assets, all three mounted card bodies (no
  header/collapse chrome), inline and saved-template theme exports in forced light/dark, the inlined theme, the `@ToAssistant` copy toast, and the hidden variant that removes the follow-up Card plus a root-level follow-up control.
  Run `npm run build` first so the standalone artifacts exist.

```bash
npm run build && npm run test:browser
# CHROME_BIN=/path/to/chrome npm run test:browser  # non-macOS / custom Chrome
```

The suites are outside `npm run check`; CI does not need a browser.
