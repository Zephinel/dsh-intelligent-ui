# Visual-regression baselines (B2-10)

These PNGs are the reference screenshots for the Intelligent UI visual surface.
They are **manual visual baselines**, not an automated pixel-diff suite: the
existing `npm run test:browser` suites already guard layout geometry and
typography (0 px drift, font caps, hit-testing); these images make larger
visual drift reviewable after a UI change.

## Captures

| File | Surface |
| --- | --- |
| `article-card-1440.png` | Article layout card (`B28 Article 验证`, Revision 2) at 1440×1000 @2x |
| `free-card-1440.png` | Free-composition on-demand card (`B28 Free2 验证`, temporary style) at 1440×1000 @2x |
| `editor-article-1440.png` | Article block-editor canvas, 1440×1000 @2x, clipped to the editor |
| `preview-modal-1440.png` | Structure-operation diff confirmation modal (`Duplicate block`) |
| `narrow-390-viewport.png` | Narrow/mobile viewport (390×844 @2x) with the unsupported-width notice |

`captures.json` records the browser, viewport, capture time and capture method.
`SHA256SUMS` pins the exact bytes.

## Environment

- macOS, Chrome/Chromium 156 (`ego-browser`, headless-capable), light scheme.
- 2× device scale factor; 1440×1000 for desktop surfaces, 390×844 for mobile.
- Fixtures/session: isolated DSH profile with the reference chat, real model
  renderings (Article via `render_ui`, free via On-demand UI).

## Comparing / regenerating

1. Compare the changed surface against the matching baseline at the same
   viewport and DPR. Review layout, spacing, typography, colors and chrome;
   do not expect byte equality across OS/Chrome/font versions.
2. Regenerate with `ego-browser` against an isolated DSH profile, capture the
   element or viewport with `Page.captureScreenshot` (`captureBeyondViewport`
   for clipped element shots), and keep the same viewport/DPR/light scheme.
3. Update `captures.json` and `SHA256SUMS` in the same change.

Known limits: baselines are environment-sensitive, there is no committed
automated comparator, and the preview image is a full-viewport capture from
the M4-5 real-GUI verification (the later a11y change did not alter the modal's
visual layout).
