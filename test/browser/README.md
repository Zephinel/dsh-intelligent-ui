# Browser E2E

Three focused suites boot a temporary HTTP server (or a local file) + headless
Chrome and drive the real components through CDP. They check DOM, layout and
events but not the full DSH Web integration.

- `style-panel.e2e.mjs` drives the composer style panel: chip -> menu -> This
  session only -> style panel -> back to menu -> style panel -> slider -> Escape/focus return, and checks the
  content-sized menu, upright chevron, inset divider and disabled Display style
  row while the switch is off. It renders the real `ToggleControl` in a browser.
- `export-image.e2e.mjs` renders a card with a flipped `Flashcard` and a real
  `SearchImage` (its Wikipedia lookup is stubbed to a local image), then drives
  the real `ExportAction` menu and the production `exportCardsImage` pipeline:
  the capture must see the flattening scope, frozen transitions, eager/loaded
  photos, an expanded/restored collapsed card, a map readiness signal (fake map
  fixture), the raw, card and rounded-2x frames, and the card frame's shadow
  bleed. It also checks the menu's right alignment, content width, below-trigger
  fallback and dismissal on scroll. Two `ExportAction` entries are mounted; the one whose Chat selector
  reports no rendered UI must not add a trigger.

- `standalone-page.e2e.mjs` assembles the real single-file page from
  `lib/standalone.js` / `lib/standalone.css` plus two recorded cards, opens it
  in Chrome, and checks the inline-only assets, both mounted card bodies (no
  header/collapse chrome), the inlined theme and the `@ToAssistant` copy toast.
  Run `npm run build` first so the standalone artifacts exist.

```bash
npm run build && npm run test:browser
# CHROME_BIN=/path/to/chrome npm run test:browser  # non-macOS / custom Chrome
```

The suites are outside `npm run check`; CI does not need a browser.
