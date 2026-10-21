# Browser E2E

`style-panel.e2e.mjs` boots a temporary HTTP server + headless Chrome and drives
the composer style panel through CDP: chip -> menu -> This session only -> style
panel -> slider -> Escape/focus return. It renders the real `ToggleControl` in a browser,
so it checks DOM, layout and events but not the full DSH Web integration.

```bash
npm run test:browser
# CHROME_BIN=/path/to/chrome npm run test:browser  # non-macOS / custom Chrome
```

The test is outside `npm run check`; CI does not need a browser.
