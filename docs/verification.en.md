# Verification record

[中文](verification.md) | English

[← Back to README](../README.en.md)

This is a historical verification record; test counts and packaging sizes are refreshed from the latest `npm run check` / `npm pack` output.

End-to-end verification was performed on a second, isolated DSH Web instance (port 3081, same profile + patch overlay):

- The model calls `render_ui` as instructed by the prompt and generates pages of 31–117 statements; invalid programs are rejected by the Host with precise field errors, and the model repairs them within the same turn.
- The 55-component overview page, the San Francisco itinerary, the coffee calculator and the SVG origami tutorial all render correctly; photos (Wikipedia/Wikimedia), MapLibre maps + pins, charts, forms, timers, flip cards, confetti and HtmlView animations work.
- Interaction: checking timeline items updates counts, the SegmentedControl stays in sync, and form and button states behave; the dark theme switches automatically.
- Responsive: no horizontal overflow at 390 / 546 / 768 / 1092 px (the scoped `box-sizing` reset the component library relies on was added).
- Tests: `npm run check` is fully green — Host 13 (including three-state switch projection/commands/tool visibility), Client 29 (including the three-state control, menu, cross-tab sync, bilingual dictionaries and Chinese control rendering), packaging 16 (including the component/function catalog, SKILL.md counts, bilingual README links, CHANGELOG and screenshot consistency, and the prompt/Skill read-only-checkout guardrail), renderer parsing 41/41, SSR 41/41, i18n render check for 4 programs (zh + en fallback), typography check 22/22 (currency tracking, CJK tracking, in-card title scale, narrow-screen wrapping and chart labels); the `npm pack` artifact is about 2.20 MB / 34 files (5.16 MB unpacked); the README screenshots now cover the component tour, examples and composer switch (WebP + PNG).
- **Agent Skill end-to-end**: in a real DSH session the model called `skill { name: "intelligent-ui" }` and successfully loaded `<skill_content>` (15 KB body + a hint about the references base directory), then used `render_ui` as described by the skill to generate and render a verification page.
- **Bundle install path**: the `npm pack` artifact was installed into a throwaway profile (`~/.dsh/profiles/zbundle-test`, depending on `file:/tmp/…tgz` + `dsh.profile.bundles`); `dsh --profile zbundle-test --dump-config` exited 0, and its output contained `# == @zephinel/dsh-intelligent-ui` and the inserted row `id: intelligent-ui / name: '@zephinel/dsh-intelligent-ui'` (cleaned up after verification).
- **Three-state switch end-to-end** (isolated instance + real model): with the default "Off", requests contain no `render_ui` and the prompt is empty; after choosing "This session only", requests in that session carry the tool and the prompt and render a card, while a newly opened session is still off; after choosing "All sessions", newly opened sessions carry the tool and prompt directly; after choosing "Off", the file is cleared and new sessions again have neither tool nor prompt; control state syncs between two tabs over BroadcastChannel; the state file `{ "global": false, "sessions": [] }` and the projection behave as expected.
- **UI language**: zh/en dictionary key parity, Chinese SSR of the scope control, and Chinese plus English-fallback SSR of renderer chrome (Code, Timer, Map, empty-program fallback) are covered by automated checks; a manual language switch in a running Web UI has not been performed yet.
- Verified DSH version: **0.2.1-rc.2** (`dsh --version`). Later versions are unverified.
