# Verification — dsh-intelligent-ui docs

Run from the repo root. Current expected values are dated 2026-11-14; derive them from the commands, never copy them forward blindly.

## Guards

| Command | Expected (2026-11-14) | What it proves |
| --- | --- | --- |
| `npm run check` | typecheck `tsc --noEmit` (pass; `src/client` excluded because its DSH platform types are not local dependencies); build: `host lib/index.js 845.9 kB`, `client lib/client.js 4.20 MB (js 3.96 MB, css 244.8 kB)`, `lib/standalone.js 3.37 MB + lib/standalone.css 523.2 kB`; tests: 810 total = Host 309 + Client 464 + packaging 37; `check: 42/42` gallery programs plus `49/49` runtime component descriptions; `render-check: 42/42` plus free composition in light/dark; `contrast-check: colour contract OK`; `i18n-check: localized chrome OK (4 programs, zh + en fallback)`; `typography-check: 22/22`; `media-row-check: 17/17`; `pressable-select-check: 9/9`; `css-contract-check: 50/50`; `prop-contract-check: 63/63`; `nested-css-contract: 28/28 direct + 5/5 scoped`; `capture-token-contract: ok (23 alias tokens)`; `check:docs-facts` pack 6,120,929 / 13,148,354 | Build artifacts, behavior, docs/consistency guards, renderer, i18n, typography and contract claims |
| `npm run pack:check` | 65 files; tarball 6,120,929 bytes (≈6.13 MB), unpacked 13,148,354 bytes (≈13.15 MB) (sizes vary with the working tree — derive from the current command output); includes `README.md`, `README.en.md`, `assets/`, `skills/`, `locale/`, `licenses/` (docs and `CHANGELOG.md` excluded) | Packaging claims, shipped-file lists, screenshot assets |
| `node --test test/packaging/*.test.mjs` | 37 pass (doc-facts-guard 11 + guardrails 8 + install-script 3 + manifest 9 + references 6) | Package, README pair and changelog, screenshots, locale meta, catalog counts, prompt/Skill guardrails, decision policy, the `render_ui` contract rows and the shipped file count |
| `node --test test/packaging/guardrails.test.mjs` | 8 pass | The prompt and Agent Skill keep the extension checkout read-only while answering, and the enabled-session decision policy stays single-sourced |
| `node --test test/packaging/references.test.mjs` | 6 pass | `references/components.md` names/counts and `SKILL.md` hard-rule counts against `vendor/spec.json`; `integration.md`'s tool-contract rows against the host schemas and its shipped file count against `package.json` `files` |
| `node --test test/host/*.test.mjs` | 309 pass (artifact-base, artifact-edit, artifact-revisions, artifact-structure, export-routes, layout, mode, on-demand, result-store, skill, style-routes, style-store, tool-schema, tool, validation) | Tool contract, switch semantics, embedded skill, settings config, `@Each`-generated article validation and warning scope, edit-envelope capture/apply, multi-envelope batching and per-request selectors, requestId lineage meta, branch base validation/latest+1, `edit_ui_blocks` composition incl. temporary-style snapshots, nested CST edits and orderByParent hierarchical reconstruction, the authoritative program registry/idempotency ledger and deterministic structure-route validation/application (including cross-container move), nested additions validation/fragment ordering/insertion, `render_ui` temporary-style fallback rejection, arrangement normalization, the zero-model restore route (copying temporaryStyle), the revision registry/query route, and the experimental document-mode prompt/validation/result-meta cases |
| `node --test test/client/*.test.mjs` | 464 pass (46 files: artifact-base, artifact-block-bundle, artifact-block-props, artifact-blocks, artifact-edit-auto-submit, artifact-edit-batch-order, artifact-edit-batch, artifact-edit-deep-structure, artifact-edit-reconcile, artifact-edit-remap, artifact-edit, artifact-style-switch, artifact-thumbnails, artifact-version-default, artifact-version, edit-tabs, export-data, export-html-plan, export-image-plan, export-image-targets, export-versions, followup-hide, image-source, intelligent-ui-identity, local-revisions, locales, nested-blocks, nested-performance, notice-copy, on-demand, panel-width, program-cst, programs, remix-icon-names, revision-fallbacks, runtime-state, settings, style-actions, style-snapshot, style-targets, style-template-exchange, style-theme, styles, to-assistant, toggle, version-items) | Client extractor (incl. block-edit revision cards and the recorded document presentation flag), switch control (incl. Chinese), dictionaries, the composer notice copy split (lead + detail, zh/en), settings page (incl. image-export defaults, template import and the document-mode switch), template codec/actions, export message/Turn lookup, follow-up hiding semantics, HTML-export theme resolution, image-frame geometry and single-file page assembly, block recognition/deterministic reorder, multi-draft store and chip labels, requestId/batch envelope parsing, deterministic refs/stale/probe, Turn-close reconciliation and failed-draft restore, branch mode, local revision cards/restore mapping, sessionStorage draft persistence/hydration/cleanup, cross-tab lease claim/takeover/expiry, temporary-style content-edit gating/snapshot serialization, nested CST-to-display mapping, CST structure operations/insertNode/cross-container moveNode, bundle splicing, runtime state, and the document-mode replay/meta path |
| `npm run test:browser` | nine suites (plus manual visual baselines under `test/browser/visual-baselines/`, no automated pixel diff): on-demand (114 assertions), style-panel, style-theme (five recorded answers incl. a chrome-less document answer with no card header), image export (76 assertions incl. the follow-up-removal toggle), standalone interactive page, Article spacing, settings/template exchange/management (101 assertions), Artifact block editing and arrangement (944 checks: request list, arrangement, live target-order preview, drag/keyboard reorder, `edit_ui_blocks`-targeted envelope, block-fragment revision replay, order-only path, background conflict probe, 720–1179px drawer and below-720px notice, multi-card drafts/two chips, detach→re-attach, one message with two envelopes/request ids, two independent revisions and two sent-summary chips, Turn-close reconciliation of fulfilled drafts and the failed-draft restore/re-attach path, M3-2 zero-model local restore and branch flow, M3-3 draft persistence, M3-4 temporary-style edits, M4-1 nested content, M4-2 nested order, M4-3 structure duplicate, M4-4 containers/additions/cross-container move, M4-5 preview, B2-5 strict mode, B2-6 runtime state, B1-5 a11y, the composer apply-notice band/ghost-dismiss rows, the draft-row chip active-cue assertions (light/dark incl. the scheme self-check), the single-row More menu, input focus orbit, menu Tab/Escape/forced-colors/focus-return, page/request numbering, base_missing/artifact_missing fallback, quick-adjust unit descriptions and legacy-auto Default, base registration and old-Host degradation, real 1180px shell fit, and the editing width fit/restore; a nested-edit-renderer suite (75 checks) covers the display:contents compensation geometry across seven containers/18 slots, Carousel scrolling/overlay, innermost hit-testing and unchanged ordinary rendering; Chrome required; run `npm run build` first) | Browser behavior cited by docs |
| `npm run test:renderer` | `42/42` parse + `49/49` runtime component descriptions, `42/42` render, contrast OK, i18n 4 programs, typography 22/22, media-row 17/17, pressable-select 9/9, CSS contract 50/50, prop contract 63/63, nested-css-contract 28/28 direct + 5/5 scoped, capture-token contract 23 aliases (Chrome for the latter group) | Renderer behavior cited by docs |

## Screenshot reproduction

`npm run capture:readme` runs `capture-screenshots.mjs` (seven production-component fixtures at 2x: layout, settings, toggle, panel, armed hint, temporary result, dark temporary result), `capture-editor-screenshot.mjs` (editor captures in Chinese and English; the fixture itinerary/dashboard/quiz card captures are produced separately with `--card=<kind>` and are not part of this command) and `build-readme-bento.mjs` (five bento composites: overview-zh/en, components, controls, temporary), retaining 34 README assets. The `settings` fixture renders the real Plugin detail page (including the Experimental group), so recapture it with `node scripts/capture-screenshots.mjs settings` after a settings-page copy or grouping change. The generation composites (`intelligent-ui-readme-generation-zh/en.webp`) are composed by `build-readme-generation-bento.mjs` from the committed 2x captures of real DSH sessions (`assets/intelligent-ui-real-*.webp`, provenance in `docs/screenshots/real-generation.md`) and are deliberately not part of `capture:readme`. English and Chinese READMEs use language-matched overview, generation and editor captures; the remaining component captures are shared English-UI fixtures. `node scripts/capture-screenshots.mjs --dark --out-dir=/tmp/iui-r4-dark` checks all seven against fixed dark tokens without overwriting shipped light captures. Services are deterministic fakes; shell card glyphs use lucide stand-ins because DSH primitives are supplied by the live loader. The script also asserts that `DARK_THEME` defines every `--dsw-alias-*` token present in `THEME`; a missing `bg-module-platform` override previously produced a white-on-dark Temporary-style badge in the dark capture. These are component captures, not real-model DSH evidence.

## README and changelog structural checks

```sh
# Same heading depth sequence in both languages
diff <(grep -E '^#{1,3} ' README.md | sed 's/[^#].*//') <(grep -E '^#{1,3} ' README.en.md | sed 's/[^#].*//')

# Every asset a README references exists
grep -oE 'assets/[A-Za-z0-9._-]+' README.md README.en.md | while IFS=: read -r _ img; do test -e "$img" || echo "DANGLING $img"; done

# The shipped set (34 files) and which README uses each asset are guarded by
# `test/packaging/manifest.test.mjs`: language-matched captures (overview/generation/editing
# -zh and -en) belong to their own README, shared fixtures appear in both, and a README that
# points at a missing file fails.

# Language switchers exist
grep -q '\[English\](README.en.md)' README.md && grep -q '\[中文\](README.md)' README.en.md && echo 'switchers ok'

# Changelog is English-only, repo-only, linked from both READMEs, and carries an Unreleased section
test -f CHANGELOG.md || echo 'MISSING CHANGELOG.md'
grep -q 'CHANGELOG.md' README.md && grep -q 'CHANGELOG.md' README.en.md && echo 'changelog links ok'
grep -q '^## \[Unreleased\]' CHANGELOG.md && echo 'changelog section ok'

# Clone URL in the READMEs matches the configured remote (SSH/HTTPS normalized)
node --input-type=module <<'NODE'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
const raw = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim()
const url = raw
  .replace(/^git@github\.com:/, 'https://github.com/')
  .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
  .replace(/\.git$/, '')
let bad = 0
for (const readme of ['README.md', 'README.en.md']) {
  if (!fs.readFileSync(readme, 'utf8').includes(url)) {
    console.log('CLONE URL DRIFT', readme, 'expected', url)
    bad++
  }
}
console.log(bad ? 'clone URL mismatch' : 'clone URL ok')
if (bad) process.exitCode = 1
NODE
```

Local links and anchors (README pair, changelog, docs pairs, Agent Skill references, test/renderer README):

```sh
node --input-type=module <<'NODE'
import fs from 'node:fs'
import path from 'node:path'
const root = process.cwd()
const files = [
  'README.md', 'README.en.md', 'CHANGELOG.md', 'test/renderer/README.md', 'test/browser/README.md',
  'docs/architecture.md', 'docs/architecture.en.md',
  'docs/development.md', 'docs/development.en.md',
  'docs/verification.md', 'docs/verification.en.md',
  'skills/intelligent-ui/SKILL.md',
  ...fs.readdirSync('skills/intelligent-ui/references').map(f => `skills/intelligent-ui/references/${f}`),
]
const slug = (h) => h.replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\*\*|__/g, '').replace(/<[^>]+>/g, '').trim().toLowerCase()
  .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-')
const anchors = new Map()
const anchorsOf = (file) => {
  const set = new Set()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^#{1,6}\s+(.+)$/.exec(line)
    if (m) set.add(slug(m[1]))
  }
  return set
}
let broken = 0
for (const md of files) {
  for (const m of fs.readFileSync(md, 'utf8').matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    const raw = m[2]
    if (/^[a-z]+:/i.test(raw) || raw.startsWith('/')) continue
    const [target, anchor] = raw.split('#')
    const file = target === '' ? md : path.resolve(path.dirname(md), target)
    if (!fs.existsSync(file)) { console.log('MISSING FILE', md, '->', raw); broken++; continue }
    if (anchor) {
      if (!anchors.has(file)) anchors.set(file, anchorsOf(file))
      if (!anchors.get(file).has(decodeURIComponent(anchor).toLowerCase())) {
        console.log('MISSING ANCHOR', md, '->', raw); broken++
      }
    }
  }
}
console.log(broken ? `${broken} broken local link(s)` : 'local links ok')
if (broken) process.exitCode = 1
NODE
```

## Detailed docs checks

The three detailed docs are repo-only (not in `package.json` `files`); the READMEs link to them with absolute GitHub URLs so the links also work on npm.

```sh
# Docs pairs: same heading depth sequence and working language switcher
for base in architecture development verification; do
  diff <(grep -E '^#{1,3} ' "docs/$base.md" | sed 's/[^#].*//') \
       <(grep -E '^#{1,3} ' "docs/$base.en.md" | sed 's/[^#].*//') || echo "heading drift: $base"
done
grep -q '\[English\](architecture.en.md)' docs/architecture.md && \
grep -q '\[中文\](architecture.md)' docs/architecture.en.md && echo 'doc switchers ok'

# README documentation links resolve to repo files (absolute GitHub URLs)
node --input-type=module <<'NODE'
import fs from 'node:fs'
const prefix = 'https://github.com/Zephinel/dsh-intelligent-ui/blob/main/'
let ok = 0, bad = 0
for (const readme of ['README.md', 'README.en.md']) {
  for (const m of fs.readFileSync(readme, 'utf8').matchAll(new RegExp(prefix.replaceAll('.', '\\.') + '([^)\\s]+)', 'g'))) {
    if (fs.existsSync(m[1])) ok++
    else { console.log('MISSING DOC LINK', readme, '->', m[1]); bad++ }
  }
}
console.log(`doc links: ${ok} ok, ${bad} broken`)
if (bad) process.exitCode = 1
NODE
```

## Updating counts after a test or packaging change

1. Run `npm run check` and `npm run pack:check`; read the real numbers.
2. Update the 已验证 / verification bullet in **both** `docs/verification.md` and `docs/verification.en.md`: Host / Client / packaging counts, renderer `42/42` pairs plus the contract checks (`media-row 17/17`, `pressable-select 9/9`, `CSS contract 50/50`, `prop contract 63/63`), typography `22/22`, i18n program count, pack file count and sizes.
3. If the change introduced a new test file or suite, keep the totals inside the same sentence and verify `npm test` totals match the sum.
4. Never adjust a count by arithmetic on a previous docs value.
5. Append the user-visible change to `CHANGELOG.md`; move `Unreleased` entries under the new version when publishing.
6. When a roadmap milestone from `docs/plans/artifact-edit-followups/README.md` or `docs/plans/artifact-edit-m3/README.md` lands, update its dated verification record and milestone status there; do not rewrite the historical `docs/verification*.md` entries.

## Examples and vocabulary

- Requirement: complete fenced programs (`root = …`) across `skills/intelligent-ui/references/*.md` must parse against the library. The 2026-10-20 audit parsed 15/15 and the 2026-10-22 audit parsed 16/16; if examples change, re-run that ad-hoc parse (bundle `src/lib/library.ts` with esbuild, `createParser(library.toJSONSchema())`, parse every fenced block that starts with `root =`). If it becomes routine, promote it to a renderer test.
- Vocabulary: `node --test test/packaging/references.test.mjs` is the guard for component/function/action names and counts. Update `references/components.md` and `SKILL.md` together with `vendor/spec.json` changes.

## Known expected non-bugs (do not "fix")

- `docs/verification.md` / `docs/verification.en.md` is a historical verification record; its past tense claims are not current-state claims.
- Dated milestone sections inside `docs/architecture*.md` (for example "验证：Node 628/628 … artifact-edit 519 checks") are historical snapshots like the verification record; only the newest 当前验证/Current verification line is a current claim. Do not rewrite the milestone lines.
- `docs/plans/artifact-edit-followups/README.md` and `docs/plans/artifact-edit-m3/README.md` are as-planned docs that also carry dated verification records (M1/M2 Phase 1 on 2026-11-04; M3-1a/M3-1b/M3-1c/M3-2/M3-3/M3-4 on 2026-11-05 M4-0–M4-5, B2-5, B2-6, B1-5, B2-8/9/10 and the editing-width user-feedback fix (M4 plan), including real-GUI evidence); they are not part of the historical verification docs and are expected to be updated as milestones land. The M3-1c reconciliation code/UI is covered by `test/client/artifact-edit-reconcile.test.mjs` and the artifact-edit browser suite; the real-model partial-success path is explicitly not GUI-validated.
- `CHANGELOG.md` is repo-only by design; its absence from `npm pack` (65 files) is expected, not a missing shipped file.
- Release planning is intentionally not part of the shipped READMEs; don't re-add a release checklist to public docs.
- `docs/` is excluded from npm `files`; the README links to it with absolute GitHub URLs so links work on npm. Don't switch to relative links unless docs are added to `files`.
- The repository and npm package are public; the README clone and GitHub Issues links are live. The stable version `0.5.0` is intentionally tagged `latest`.
- Host/Client version-skew passages quote old Host strings (`Usage: /iui [on|off]`, "already off for this session") on purpose.
- Screenshots under `assets/` are English-UI captures (card-level, captured from the real renderer with DSH theme tokens); the READMEs say so. A Chinese capture needs a live Chinese session.
- Model-facing English text (tool description, generation prompt, Agent Skill body) and the `/iui` Host replies / command-palette description are English by design.
- `npm run typecheck` is wired through `tsconfig.json` and `npm run check`; it excludes `src/client` because DSH platform packages are runtime-provided. Do not claim the browser half is type-checked.
- There is no PR CI; `.github/workflows/publish.yml` is the only workflow and publishes on `v*` tags via Trusted Publishing (OIDC + provenance). `npm run check` remains the local gate, and the workflow itself checks that the tag matches `package.json`.
- Release verification is manual: after pushing a `v*` tag, watch `gh run list --workflow=publish.yml`; then confirm the registry version and `npm audit signatures` from a temporary install. See the release bullet in `docs/verification*.md`.
- `lib/` is gitignored; artifact sizes are build outputs and must come from a fresh `npm run check`.
- On a maintainer machine whose `git config remote.origin.url` uses an SSH host alias that resolves to GitHub (for example `git@<ssh-alias>:…` instead of `git@github.com:…`), the clone-URL check reports drift unless the host alias is normalized to `github.com` first; the READMEs still hold the public HTTPS clone URL.
- `references/components.md` has no generator script; it is hand-maintained against `vendor/spec.json` and guarded by tests.
- The local-link checker below treats Markdown image syntax inside inline code (for example `![alt](source)` or `![alt](路径)`) as a link and reports the pseudo-target as missing; these are false positives. Only entries without a leading `!` are real links.
- The README documentation-link checker below does not strip a trailing `#anchor` before `fs.existsSync`, so an anchored absolute link reports as missing; check the file part separately.
