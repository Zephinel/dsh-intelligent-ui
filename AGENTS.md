# Repository agent instructions

- **Release / publish work:** load `.agents/skills/release-iui/SKILL.md` before changing a version, release notes, tags, or publishing. A code/docs/page change is not a release request; preparation and tagging are separate approval gates, and tagging/publishing needs the user's explicit approval for the exact version.
- **Documentation sync:** load `.agents/skills/sync-iui-docs/SKILL.md` after behavior, UI copy, counts, dependencies, install steps, or release-state changes, and when a docs/consistency check fails.
- Keep `README.md` and `README.en.md` in sync; `docs/verification*.md` is historical evidence, not as-built truth.
