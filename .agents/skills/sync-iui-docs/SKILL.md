---
name: sync-iui-docs
description: "Keeps the dsh-intelligent-ui extension's as-built documentation truthful to the current implementation, while leaving as-planned and historical docs alone. Use in this repository after behavior, UI copy, counts, dependencies, install or release-state changes; when a docs or consistency check fails; or when asked whether the extension's docs are still accurate. Not for prose polish, code review, or writing new docs."
whenToUse: "同步扩展文档, 更新扩展文档, 检查扩展文档, 文档落后了, 文档和实现一致吗, README 对不对, Agent Skill 文档, references 文档, 发布前检查文档, docs out of date, update docs, check docs, docs drift, docs audit"
---

# Sync IUI Docs

Scope: the `dsh-intelligent-ui` repository — the Intelligent UI extension for DeepSeek Harness (DSH). It ships a Node Host half (`lib/index.js`), a browser Client half (`lib/client.js`), and a model-facing Agent Skill (`skills/intelligent-ui/`). Its docs describe all three plus the DSH services they need, and keep the release history in `CHANGELOG.md`; DSH shell docs are out of scope.

Docs split into two contracts. **As-built** docs describe what the extension does now and must match the code. **As-planned** docs (roadmaps, proposals, specs, future checklists) and **historical** docs (verification logs, decisions already made) may differ on purpose. Classify first, then sync only the as-built set.

This skill works on documentation only — editing when sync is authorized, reporting otherwise. It does not change behavior to match documentation, and it does not rewrite plans, history, generated files, or vendored files.

## When to Use

- After changing behavior, user-visible copy, counts, dependencies, requirements, install steps, or release state under `src/`, `skills/intelligent-ui/`, `locale/`, `package.json`, `scripts/`, or the docs guards in `test/` — including appending or moving entries in `CHANGELOG.md`.
- When `npm run check`, a docs-consistency test, or a link check fails.
- When asked to check, sync, or update the extension's README pair, the detailed docs under `docs/`, Agent Skill references, locale meta, test/renderer README, or release/ship-status claims.
- Before release, or after a DSH version or dependency upgrade.

Near misses: prose polish belongs to `write`; code review to `check`; roadmap or proposal writing to a planning workflow; implementing behavior a doc promises is normal implementation, not this skill.

## Modes and Authorization

Decide both before reading docs; each defaults from the request.

**Mode**

- **Delta** — a change is in scope (working tree, diff, commit, or the user's description). Audit the claims that change touches, plus docs that quote them. Default whenever anything under the repo's behavior, copy, metadata, or guards changed.
- **Full audit** — no change; the ask is "are the extension's docs current?". Audit drift-prone claims across every as-built doc in [`references/doc-map.md`](references/doc-map.md). Cover the README pair, the detailed docs and the Agent Skill first, then the smaller docs; state coverage.

**Authorization**

- **Audit (read-only)** — "检查 / 核对 / verify / check / audit" without edit intent. Report stale claims and the proposed fix; do not edit. If fixes are wanted, the user asks, or you ask once.
- **Sync (edit)** — "同步 / 更新 / sync / update", or an implementation task that owns its doc updates. Edit as-built docs minimally.

An ambiguous request defaults to audit, then one question. Documentation authorization never extends to code changes; code fixes need their own request. An ambiguous doc class is left alone and flagged.

## Outcome Contract

- Outcome: as-built docs proven current or corrected; as-planned, historical, generated/vendored/legal docs deliberately left alone; work bounded by the chosen mode and authorization.
- Done when: every audited claim has an evidence pointer; every edit maps to one; every untouched doc is listed with its class and reason; full audits state coverage; the repo guards pass or their failures are explained.
- Output: mode + authorization, coverage, changed or proposed claims with evidence, untouched docs with reason, unguarded drift, and open questions.
- Scope: docs only. Roadmap authoring, new-feature proposals, behavior changes, and test/index publishing are out of scope unless the owner asks.

## Steps

### 1. Set the frame and run the guards

Load [`references/verification.md`](references/verification.md). Run `npm run check` when feasible (it rebuilds first) or at least `node --test test/packaging/*.test.mjs`, and record the outputs — test counts, renderer results, and `npm run pack:check` sizes become evidence. Read the repo's agent instructions if any. Name the mode, the authorization, and the delta evidence or the full-audit coverage boundary.

Completion criterion: mode and authorization are named; guard output is recorded; every claim in scope has an evidence pointer or is explicitly marked unverifiable.

### 2. Inventory and classify

Load [`references/doc-map.md`](references/doc-map.md). Tag each file and section with its class, including new docs that appeared since the map was written (e.g. `docs/architecture*.md`, `docs/development*.md`, `docs/roadmap*`, `docs/plans/`, `.agents/notes/`, `CHANGELOG`). Split mixed files: README's as-built sections versus `docs/verification*.md` (historical).

Completion criterion: every doc in scope is tagged; mixed files have their sections split; every as-planned doc either carries a visible plan marker or is flagged.

### 3. Audit as-built claims

Check each as-built claim against its truth source from [`references/doc-map.md`](references/doc-map.md), using the claim groups below. Record stale, incorrect, missing, and unverifiable claims. In full audit, track coverage per doc.

Claim groups for this extension:

- **Product state and requirements**: default off, three scopes, `/iui` syntax, DSH 0.2.1 (validated on 0.2.1-rc.2), Node 24, browser half requiring `dsh-client-locale`, published on GitHub and npm (`0.2.2-26-10-21`), no `engines.dsh`.
- **Tool contract**: `render_ui` name, `{ program, title? }`, success `{ statements, warnings? }`, model-visible result line, exact error strings.
- **Card and renderer**: turn-tail placement, process-row title, default card title, fallbacks, map/code/timer chrome, chart aria.
- **UI copy**: zh/en labels and menu text from `src/shared/locales.ts`; zh docs quote zh labels, English docs quote English labels.
- **Vocabulary and counts**: 55 components, 73 functions (14 core + 59 library), 5 action steps; component signatures; prompt size (~8.5K tokens, approximate).
- **Verification and packaging** (recorded in `docs/verification*.md`): test counts (Host 25 / Client 51 / packaging 18, total 94), renderer 41/41 parse and render, typography 22/22, i18n 4 programs, pack 40 files (~3.70 MB tarball, ~9.78 MB unpacked), every screenshot under `assets/` referenced by both READMEs.
- **Detailed docs**: `docs/architecture*.md` expands the component tree, full switch semantics, UI language and Agent Skill; `docs/development*.md` expands install/uninstall, development commands, restart tips, the release layout and the tag-driven Trusted Publishing release flow. The READMEs link both with absolute GitHub URLs because `docs/` is not shipped in npm.
- **Repository and contribution**: the README clone URL is the HTTPS equivalent of `git config remote.origin.url`; GitHub Issues is the contribution channel; `npm run check` is the local gate (there is no PR CI); releases are published by the tag-triggered GitHub Actions Trusted Publishing workflow (`.github/workflows/publish.yml`, OIDC + provenance); docs changes follow `.agents/skills/sync-iui-docs/SKILL.md`.
- **Release status**: published to GitHub and npm as `@zephinel/dsh-intelligent-ui@0.2.2-26-10-21`; the README current-status line, the package name/homepage/repository metadata in `package.json`, and the `latest` dist-tag.
- **Release history**: `CHANGELOG.md` (English-only) mirrors the published versions (`package.json` version plus npm publish time); `Unreleased` collects the current main-branch delta; released sections are append-only, and the file is repo-only (not in `package.json` `files`).

Completion criterion: every audited claim is verified, corrected, or listed unresolved; full audits state which docs and claim groups were not covered.

### 4. Edit minimally, only when authorized

In audit mode, stop and propose; do not edit. In sync mode, change only claims proven wrong or missing. Update both `README.md` / `README.en.md`, both sides of a `docs/*.md` / `docs/*.en.md` pair, and the matching `CHANGELOG.md` section in the same edit, keeping them structurally and factually aligned. Take UI copy from `src/shared/locales.ts` (and `locale/*.json` for display metadata), not from older docs. Take counts and sizes from command output, never from arithmetic on memory. Match each document's language and tone.

Generated and vendored content is off-limits: `vendor/**`, `src/generated/prompt.txt`, `lib/**`, lockfiles, `LICENSE`/`NOTICE`/`licenses/`. Regenerate through the build (`npm run build`, which runs `scripts/generate-prompt.mjs`) instead of editing.

When an as-built doc advertises planned behavior: qualify it as planned, or move it to the plan doc — ask the owner before deleting it. When a plan was implemented: leave the plan as history and update the as-built docs instead.

Completion criterion: read-only runs have zero edits; every changed line traces to an evidence pointer; no plan, history, generated, or vendored text was rewritten; no unrelated prose or formatting churned.

### 5. Guard the claims that will drift again

Where a claim is mechanically checkable, extend an existing guard instead of adding a new mechanism: `test/packaging/manifest.test.mjs` (manifest, files, README pair and changelog, screenshots, locale meta), `test/packaging/references.test.mjs` (Agent Skill catalog and counts), a renderer/i18n test, or the docs link/pair and changelog checks in [`references/verification.md`](references/verification.md). When behavior changes, update the guard's expected values together with the docs.

Completion criterion: each riskiest corrected claim is now covered by a guard, or the report says why no guard is feasible and what to watch instead.

### 6. Verify and report

Re-run the guards after edits (`npm run check`; `npm run pack:check`; the README, changelog and detailed-docs checks in [`references/verification.md`](references/verification.md)). Report mode, authorization, coverage, and the lists in the template below.

Completion criterion: guards pass or their failures are explained; the report lets the owner see which decisions were theirs.

## Doc-Specific Gotchas

- **The README pair and each doc pair are updated together.** Heading depth, language switcher, back link, facts, and screenshot references must mirror; a one-sided edit is drift by construction.
- **`CHANGELOG.md` is append-only history (English only).** Both READMEs link it from their documentation section; add entries under `## [Unreleased]`; move them under the released version when publishing. Never rewrite a released section. Repo-only: not in `package.json` `files`; the packaging test asserts the file exists, is linked from both READMEs, carries `Unreleased`, and stays out of the tarball.
- **`docs/verification*.md` is not as-built truth.** Keep the verification record as history; don't rewrite past verification. Refresh only live subclaims (test counts, pack sizes, DSH version). Release planning is intentionally not part of the shipped READMEs — don't re-add a release checklist to public docs.
- **Docs live in `docs/`, screenshots live in `assets/`.** The npm package excludes `docs/`, so the READMEs link to the detailed docs with absolute GitHub URLs; keep that if docs stay out of `files`.
- **Version-skew examples quote an old Host on purpose.** Troubleshooting and "Host/Client 版本错位" describe a stale host (`Usage: /iui [on|off]`, "already off for this session"); do not "fix" those quotes to the current host.
- **UI copy has two languages and two layers.** Client chrome is bilingual through `src/shared/locales.ts`; model-facing text (tool description, prompt, Agent Skill body) stays English. Host `/iui` replies and command-palette descriptions are English by DSH platform behavior, not untranslated drift.
- **Screenshots are English-UI captures.** Every image under `assets/` must be referenced by both READMEs; the set is now a card-level component tour plus examples (WebP, captured with the real renderer at 2× against DSH theme tokens), so recapture it rather than hand-editing an image. A Chinese-UI capture needs a live Chinese session and cannot be faked.
- **Generated and vendored files are caches.** `src/generated/prompt.txt` comes from `vendor/system-prompt.txt` via `scripts/generate-prompt.mjs`; `vendor/spec.json` drives the validator and `references/components.md` is hand-maintained against it. Never hand-edit the generated side.
- **`lib/` is gitignored but packaged.** Build before `npm run pack:check` or any claim about artifacts; the browser half and host bundle sizes are build outputs.
- **`npm run typecheck` exists but has no `tsconfig.json`.** Do not cite it as a working check until it is wired (the command list in `docs/development*.md` is the source for what works).
- **`references/components.md` has no generator script.** It is hand-maintained and guarded by `references.test.mjs`; update both in the same change.

## Ask the Owner Before

- A doc or section could be a plan or an as-built claim (for example a future release step versus the current packaging behavior).
- An as-built doc promises a feature that does not exist (qualify, move, implement, or delete — the owner chooses).
- Screenshots, marketing copy, or user-visible wording need a product decision or a new capture.
- Release state, npm dist-tag, version, or `engines.dsh` may change — this includes moving `Unreleased` entries under a new version and deciding whether the changelog should stay repo-only or ship in the npm package.
- Code and a plan/spec disagree, and the plan may be authoritative.

## Report Template

```
Mode: <delta | full audit> — <read-only audit | sync authorized>
Guards: npm run check <result>; npm run pack:check <files/size>; docs links <result>
Coverage: <audited docs/claim groups; for full audit, what was not covered and why>

Changed (as-built) / Proposed (read-only):
- <path> — <stale claim> → <now says> (evidence: <file:line | command output>)

Untouched (classified):
- <path> — as-planned | historical | generated/vendored/legal | external — <reason>

Unguarded drift:
- <claim> — no mechanical check; suggested: <guard>

Questions:
- <decision the owner must make>
```

## References

- [`references/doc-map.md`](references/doc-map.md) — per-doc class, truth source, and existing guard for this repository. Load in step 2.
- [`references/verification.md`](references/verification.md) — guard commands, expected outputs, README structural checks, and known non-bugs. Load in step 1 and before reporting.

These two references describe the repo as of 2026-10-22. When the doc inventory, guards, scripts, or expected counts change, update them in the same change — they are maintenance metadata, not shipped docs.

This skill lives at `.agents/skills/sync-iui-docs/` for project-local discovery. It is not listed in `package.json` `files` and is not shipped to npm.
