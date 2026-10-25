# Renderer self-checks

Most of these scripts cover the `src/lib` half (the OpenUI Lang renderer) without a
browser; the typography check uses headless Chrome. They are not part of the client
bundle. `npm run test:renderer` runs the parser, render, contrast, i18n, typography,
media-row, pressable-select, CSS-contract and prop-contract checks in order;
`npm run check` runs them after the build and the Node test suites.

## Parser check

```sh
node test/renderer/check.mjs
```

Bundles a small harness that imports the real `src/lib/library.ts`, then parses every
gallery program from Open Intelligent UI against `library.toJSONSchema()`:

- by default it reads the upstream clone at `/tmp/oiui/src/app/gallery` when present,
  otherwise the copy vendored in [`test/renderer/gallery`](gallery);
- pass a directory to override: `node test/renderer/check.mjs /path/to/src/app/gallery`;
- exits nonzero and prints the failing program id, component, prop path and message;
- importing the library in Node also catches module-top-level crashes (`window`,
  `document`, `import.meta.url`) and schema construction errors.

## Render check

```sh
node test/renderer/render-check.mjs
```

Server-renders every gallery program through the exported `OpenUIRenderer` with
`react-dom/server` (same gallery directory rules as the parser check). Effects do
not run on the server, but a render-time crash in the renderer, the library or a
composed component does; client-only `useLayoutEffect` warnings are expected. Exits
nonzero when a program throws or renders almost nothing.

## Contrast check

```sh
node test/renderer/contrast-check.mjs
```

Exercises the colour helpers (`bg`, `fg`, `onColor`, `textFg`) that every component
uses — the seam where unreadable text was found in the wild — and asserts the colour
contract: text/icon colours ignore surface-only tokens (`surface`, `surface-strong`,
`border`), an `ink` background switches its content to the on-ink tokens, raw CSS
colours get computed dark/light text, and SVG paint still accepts `surface`. Exits
nonzero when a helper breaks the contract. It does not catch CSS cascade bugs; the
theme torture check below renders a real page for those.

## i18n check

```sh
node test/renderer/i18n-check.mjs
```

Server-renders a handful of programs twice through `OpenUIRenderer`: once with the
Chinese locale seat and once without one (the English fallback). It asserts that the
renderer's own chrome — Code, Timer, Map controls and the empty-program fallback —
follows the seat, so a component that forgets `useT()` fails here before the browser
E2E. Exits nonzero when an expected localized string is missing.

## Typography check

```sh
node test/renderer/typography-check.mjs
```

Renders a small fixture in headless Chrome and asserts the text rules static checks
cannot see: a leading currency sign keeps normal tracking inside a tracked display
title, CJK titles and Markdown headings drop the Latin display tracking, long badges
and buttons wrap inside a 360px card instead of clipping, an over-long chart category
label is trimmed with an ellipsis while keeping the full text in its `<title>`,
CJK/Latin autospacing (`text-autospace`, where the engine supports it) is inherited,
and the page never scrolls horizontally. It skips with exit code 0 when no Chrome
binary is available (`CHROME_BIN` overrides the default path) and is part of
`npm run test:renderer`.

These checks bundle their harness into `test/renderer/.build/` (git-ignored) and are
never part of the client bundle used by DSH.

## Media-row check

```sh
node test/renderer/media-row-check.mjs
```

Renders photos inside Rows through headless Chrome and asserts the media-row
defaults yield to explicit program sizing: a `Box` with an inline width keeps it,
`SearchImage(aspectRatio)` wins over the 4:3 default, and Row gap/align still
apply. It covers plain photos, captioned boxes and Pressable-wrapped photos, so a
stylesheet default can no longer shrink or resize a program-sized image.

## Pressable select check

```sh
node test/renderer/pressable-select-check.mjs
```

Checks the selected-tile treatment in headless Chrome: compact text chips keep
their label fully visible (inset ring, no corner badge) while textless tiles keep
the corner check, with no overlap at 360px and default width.

## CSS contract check

```sh
node test/renderer/css-contract-check.mjs
```

Renders minimal fixtures against the real stylesheet and pins layout contracts
that CSS heuristics used to break: media-row defaults, card subtitle scoping,
the list marker lane (wide and <=640px), badge/button alignment yielding to
`align=`, structural in-card display type caps, carousel width/peek, table
alignment, dark host colours on `data-iui-scheme="dark"`, and the standalone
export card gap (12px).

## Prop contract check

```sh
node test/renderer/prop-contract-check.mjs
```

Renders the component/function seam in headless Chrome and asserts explicit
props and documented behavior win: SVG paint tokens, raw-background contrast,
carousel `itemWidth`, chart series inference and stacked negatives, aspect ratio,
raw table numbers, YouTube URL forms, safe CSS lengths, slider state, Flashcard
semantics, decimal-comma input, Markdown nesting and out-of-domain `@function`
calls rendering empty instead of failing the card.

## Theme torture

```sh
npm run check:theme
```

`test/renderer/theme-torture.mjs` renders a page of hostile token combinations in
headless Chrome and asserts every text/background pair keeps a readable contrast ratio
in both themes, catching CSS cascade problems the helper-level contrast check cannot
see. It skips with exit code 0 when no Chrome binary is available (`CHROME_BIN`
overrides the default path) and is not part of `npm run check`.

## MapLibre worker source

MapLibre derives its worker URL from `import.meta.url`, which is empty in the DSH
CommonJS factory. The renderer ships the worker as a string module
(`src/lib/components/map/maplibre-worker-source.ts`) and points MapLibre at a Blob URL.

Regenerate it after upgrading `maplibre-gl`:

```sh
node test/renderer/make-worker-source.mjs
```

The generator verifies the worker is still a single self-contained module (no
imports/exports) and preserves the MapLibre BSD-3-Clause license banner.
