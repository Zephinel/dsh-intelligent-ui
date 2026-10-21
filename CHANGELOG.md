# Changelog

Notable changes to `@zephinel/dsh-intelligent-ui`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions are the
published npm versions. `Unreleased` collects changes on `main` that have not
been published yet.

## [Unreleased]

### Added

- **Answer styles:** sessions can render as a compact `Card` or an `Article` reading page. Article mode adds a `Toc` component and a collapsible `Section` component, plus a single-column reading layout in the card.
- **Image export:** completed answers rendered by `render_ui` gain an export button in the assistant message action strip. The entry sits at the far right of the action strip as a labeled export pill, visually distinct from the native icon controls; its menu right-aligns with the pill and follows its content width, and saves every card rendered by that turn as one PNG with a raw, rounded or card beautification frame. Collapsed cards are expanded for the capture and restored afterwards; maps are captured through the preserved MapLibre drawing buffer and the export waits for each map's readiness signal (reset on resize/data loading, set on MapLibre `idle`). The new **Image export** group on the Plugin detail page stores the default background color and 1x/2x resolution.
- **Global defaults:** the Plugin detail page now owns **Enable in all sessions**, the global Auto / Card / Article style, and the **Free-form layout** switch.
- **Session overrides:** the composer UI control is now Off / This session only / Follow global, and opening the session entry shows the answer-style panel with two previews, Auto/Card/Article slider, and Follow global. `/iui on|off|inherit` and `/iui style auto|card|article|inherit` are the command equivalents.
- **Style metadata:** `render_ui` now takes a required `style` argument; the Host validates it against the effective session style and records it with the card.
- **Browser E2E:** `npm run test:browser` drives the composer menu (content width, chevron direction, inset divider, disabled Display style row, custom slider) and focus/escape flow in headless Chrome, then opens the export menu, asserts its right alignment and scroll dismissal, flips a flashcard, runs the real export pipeline and asserts the flattened flip, eager/loaded photos and the produced PNG.

### Changed

- The composer no longer offers **All sessions**; global enablement and the global style moved to the Plugin detail page. Session state is stored as `sessions`, `offSessions` and `styles` in `dsh-intelligent-ui.json`; legacy `global`/`enabled` files remain readable.
- The Plugin detail page is grouped into **Availability**, **Answer style**, **Composition** and **Image export**; the former **Free composition** setting is now labelled **Free-form layout**, with clearer on/off hints in both languages.
- Every extension-owned surface (settings page, composer chip/menu, style panel and slider) now uses custom borderless rounded cards and a custom range control instead of shell menu/range defaults. The composer scope menu and the export menu share content-sized menu rows with one vertical rhythm (the scope menu has a 208px minimum and right-aligns with the chip); the Display style row stays visible (disabled while Intelligent UI is off) below an inset hairline divider, and the export menu dismisses on scroll, resize or when its trigger leaves the viewport.
- `@zumer/snapdom` (MIT) now ships inside the browser bundle for the image export; `NOTICE` and `licenses/` carry its attribution.
- The Agent Skill and injected prompt now carry the Card/Article/Auto guidance, the article-first content contract, and the `Section`/`Toc` vocabulary.

### Fixed

- Article Section/Toc anchors now decouple display titles from stable ids (`Section(title, children, anchor?)`, `Toc(items, anchors?)`); duplicate effective anchors and empty anchors are rejected or normalized consistently by the Host and renderer.
- The style panel's back button now returns to the scope menu (one level up) instead of dismissing every popup, and returns focus to the Display style row.
- Menu dismissal no longer scrolls the page back to an off-screen trigger; end-aligned menus clamp inside the viewport; a menu dismissed mid-export leaves the pill in an error state instead of swallowing the failure; map readiness is invalidated before style swaps and photos settle before maps.
- The composer chip's chevron rotated twice on open (the inner SVG repeated the outer span's 180°), so an open menu still pointed down; only the outer element rotates now.
- Image export normalizes the card for snapshot rasterization: CSS transitions and animations are frozen, the flashcard's two 3D faces are flattened to the face the reader currently sees (they previously stacked and rendered mirrored text), and the export waits for in-card photos and `SearchImage` lookups to settle so photos no longer export as empty boxes. The card frame also reserves the shadow bleed around its background so the soft shadow is actually painted instead of being clipped at the canvas edge.

### Documentation

- Regenerated the 57-component layout, composer menu, style-panel and Plugin settings screenshots; the settings screenshot now includes the **Image export** group, and the settings copy and hints are bilingual.

## [0.2.2-26-10-21] - 2026-10-21

### Fixed

- The README pair's **DSH Desktop（桌面版）** label no longer renders its Markdown asterisks: a space now separates
  the closing emphasis run from the following CJK text, which CommonMark's right-flanking delimiter rule requires.

### Documentation

- The README pair and the verification record now list macOS (Web + DSH Desktop) and Windows (DSH Desktop) as
  verified platforms; Linux remains unverified.

## [0.2.1-26-10-21] - 2026-10-21

### Changed

- The deployment-wide **Free composition** switch now lives on the extension's **Plugins detail page**
  (`plugins.bundle.config`, keyed by the package name) instead of a separate **Settings → Intelligent UI**
  section; the Settings page is gone.
- The switch now mirrors the shell's native switch styling: 36×20 track with 2px padding, full-radius
  `corner-shape: round`, the brand/border/switch-thumb tokens, and the native thumb transition.

### Documentation

- The README pair, architecture pair, development pair, Agent Skill and integration reference now point at the
  Plugins detail page instead of the removed Settings section.

## [0.2.0-26-10-21] - 2026-10-21

### Added

- Releases publish from GitHub Actions through npm Trusted Publishing (OIDC) with provenance: pushing a `v*` tag
  that matches `package.json` runs `.github/workflows/publish.yml`, which builds, runs `npm run check`, and publishes
  with `--provenance` without a repository token.
- A **Settings → Intelligent UI** page with a **Free composition** switch. The page registers through
  `settings.section` and persists the volatile `freeComposition` field of the extension's Host settings entry;
  `@deepseek-ai/schemastery` is now a runtime dependency for that Config schema. When on, the injected prompt and
  the Agent Skill treat the design playbook as advisory; off (the default) keeps the current layout rules. The
  page states that this is a prompt-level preference rather than enforcement, and points at `/intelligent-ui`
  when a card must be guaranteed.

### Changed

- In a session that enables the switch, a `render_ui` page is now the default answer format for any structured
  answer, including explanations, introductions and timelines. Prose is limited to a single fact or a one- or
  two-sentence reply, an explicit request for text, content that cannot be shown as a page, or two failed render
  attempts. The policy lives only in the injected prompt (with its dynamic enabled-session prefix); the Agent
  Skill no longer restates it.
- Explicit user invocation of the `intelligent-ui` skill (`/intelligent-ui`) is now a direct instruction to render
  a page, documented in the READMEs and the skill.

### Documentation

- The README pair, architecture pair, Agent Skill and integration reference now document the default-card policy
  and the explicit-invocation guarantee, plus the Settings page and the free-composition switch.
- The `intelligent-ui` Agent Skill now infers whether the session is enabled from the injected prompt and tool
  availability instead of asking the model to inspect the composer chip, and states its decision boundary once
  (default page, bounded prose exceptions, explicit invocation).
- The README pair, `docs/development` pair and the Agent Skill integration reference now document the DSH Desktop install path (Plugins → Add plugin → Install → Enable now) and why `dsh plugin --profile desktop` is rejected.
- The README pair now carries npm version, license and DSH badges, and states the local development loop explicitly (no standalone dev server; build → install → restart → check for the UI control), plus the Chrome requirement of the typography check.
- The verification record now mentions the changelog guard and the typography check in its current test and packaging summary.
- The `docs/development` pair documents the tag-driven Trusted Publishing release flow and the one-time `npm trust github` setup.

## [0.1.0-26-10-21] - 2026-10-21

### Added

- A headless-Chrome typography regression check (`test/renderer/typography-check.mjs`,
  22 assertions) for currency tracking, CJK tracking, the in-card title scale and
  long-label overflow. It runs as part of `npm run test:renderer` / `npm run check`
  and skips when Chrome is unavailable.

### Changed

- Inside a `Card`, display title sizes keep their hierarchy on a capped scale —
  `lg` 18px, `xl` 22px, `2xl` 26px, `3xl` 30px — instead of all rendering at 18px,
  so a KPI number stays distinct from the card's section heading.
- CJK/Latin mixed text gets the standard quarter-em separation where the browser
  supports CSS Text 4 `text-autospace`.
- The README pair now leads with a card-level component tour (all 55 components)
  plus itinerary, dashboard and quiz examples and a narrow-screen calculator,
  replacing the two older screenshots.

### Fixed

- Currency amounts in display titles (`¥3,000`, `$1,250`, `€899`, …) no longer let
  the sign touch the first digit: a leading currency sign keeps normal tracking
  while the rest of the title stays tracked.
- CJK titles, Markdown headings and flashcards no longer inherit the Latin negative
  display tracking that made Chinese, Japanese and Korean text feel cramped.
- Long badge labels and button labels wrap inside a narrow card instead of being
  clipped at its edge.
- Over-long chart category labels are trimmed with an ellipsis instead of spilling
  outside the plot; the full label remains available in the SVG `<title>` tooltip.
- The Agent Skill's integration reference now states that the published tarball
  ships 34 files (previously 29).

### Documentation

- The README pair, component-tour screenshots, `docs/development` asset inventory,
  and the typography guidance in the `intelligent-ui` Agent Skill now match the
  renderer. The local `npm pack` artifact is 34 files / ≈2.20 MB.

## [0.1.0-26-10-20] - 2026-10-20

### Added

- Initial public release: a DSH bundle for DSH 0.2.1 (validated on `0.2.1-rc.2`)
  with a Host half (`lib/index.js`) and a browser half (`lib/client.js`).
- The `render_ui` tool, which renders one OpenUI Lang 1.0 program as a turn-tail
  card; 55 components, 73 functions and 5 action steps.
- A three-state switch — off (default), this session, all sessions — through the
  composer UI control and `/iui` commands; the choice persists in
  `$DSH_HOME/dsh-intelligent-ui.json`.
- An `intelligent-ui` Agent Skill registered by the plugin, with language,
  component, example and troubleshooting references.
- A bilingual UI that follows DSH's interface language (the browser half requires
  `@deepseek-ai/dsh-client-locale`).
- Install from npm (`@zephinel/dsh-intelligent-ui`) or GitHub, with `npm run check`
  and `npm run pack:check` documented in the README pair.
