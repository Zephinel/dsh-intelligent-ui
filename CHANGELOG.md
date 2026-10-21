# Changelog

Notable changes to `@zephinel/dsh-intelligent-ui`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions are the
published npm versions. `Unreleased` collects changes on `main` that have not
been published yet.

## [Unreleased]

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
