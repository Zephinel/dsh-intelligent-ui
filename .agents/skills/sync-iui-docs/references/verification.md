# Verification — dsh-intelligent-ui docs

Run from the repo root. Current expected values are dated 2026-11-05; derive them from the commands, never copy them forward blindly.

## Guards

| Command | Expected (2026-11-05) | What it proves |
| --- | --- | --- |
| `npm run check` | typecheck `tsc --noEmit` (pass; `src/client` excluded because its DSH platform types are not local dependencies); build: `host lib/index.js 809.1 kB`, `client lib/client.js 3.90 MB (js 3.71 MB, css 191.6 kB)`, `lib/standalone.js 3.30 MB + lib/standalone.css 515.8 kB`; tests: 474 total = Host 228 + Client 225 + packaging 21; `check: 42/42` gallery parsed; `render-check: 42/42` plus free composition in light/dark; `contrast-check: colour contract OK`; `i18n-check: localized chrome OK (4 programs)`; `typography-check: 22/22`; `media-row-check: 17/17`; `pressable-select-check: 9/9`; `css-contract-check: 50/50`; `prop-contract-check: 63/63`; `nested-css-contract: 28/28 direct + 5/5 scoped` | Build artifacts, behavior, docs/consistency guards, renderer, i18n, typography and contract claims |
| `npm run pack:check` | 43 files; tarball ≈ 4.01 MB, unpacked ≈ 10.35 MB (sizes vary with the working tree — derive from the current command output) (sizes vary with the working tree — derive from the current command output); includes `README.md`, `README.en.md`, `assets/`, `skills/`, `locale/`, `licenses/` (docs and `CHANGELOG.md` excluded) | Packaging claims, shipped-file lists, screenshot assets |
| `node --test test/packaging/*.test.mjs` | 21 pass (manifest 9 + reference catalog 6 + guardrails 6) | Package, README pair and changelog, screenshots, locale meta, catalog counts, prompt/Skill guardrails, decision policy, the `render_ui` contract rows and the shipped file count |
| `node --test test/packaging/guardrails.test.mjs` | 6 pass | The prompt and Agent Skill keep the extension checkout read-only while answering, and the enabled-session decision policy stays single-sourced |
| `node --test test/packaging/references.test.mjs` | 6 pass | `references/components.md` names/counts and `SKILL.md` hard-rule counts against `vendor/spec.json`; `integration.md`'s tool-contract rows against the host schemas and its shipped file count against `package.json` `files` |
| `node --test test/host/*.test.mjs` | 228 pass (mode, skill, tool, tool-schema, export-routes, layout, validation, on-demand, result-store, style-routes, style-store, artifact-edit, artifact-revisions, artifact-structure) | Tool contract, switch semantics, embedded skill, settings config, `@Each`-generated article validation and warning scope, edit-envelope capture/apply, multi-envelope batching and per-request selectors, requestId lineage meta, branch base validation/latest+1, `edit_ui_blocks` composition incl. temporary-style snapshots, nested CST edits and orderByParent hierarchical reconstruction, the authoritative program registry/idempotency ledger and deterministic structure-route validation/application (including cross-container move), nested additions validation/fragment ordering/insertion, `render_ui` temporary-style fallback rejection, arrangement normalization, the zero-model restore route (copying temporaryStyle) and the revision registry/query route |
| `node --test test/client/*.test.mjs` | 225 pass (programs, toggle, locales, settings, exports, followups, followup-hide, on-demand, style-actions, style-template-exchange, style-snapshot, style-theme, styles, artifact-blocks, artifact-edit, artifact-edit-reconcile, local-revisions, edit-tabs, nested-blocks, program-cst, artifact-edit-batch, artifact-block-bundle) | Client extractor (incl. block-edit revision cards), switch control (incl. Chinese), dictionaries, settings page (incl. image-export defaults and template import), template codec/actions, export message/Turn lookup, follow-up hiding semantics, HTML-export theme resolution, image-frame geometry and single-file page assembly, block recognition/deterministic reorder, multi-draft store and chip labels, requestId/batch envelope parsing, deterministic refs/stale/probe, Turn-close reconciliation and failed-draft restore, branch mode, local revision cards/restore mapping, sessionStorage draft persistence/hydration/cleanup, cross-tab lease claim/takeover/expiry, temporary-style content-edit gating/snapshot serialization, nested CST-to-display mapping, CST structure operations/insertNode/cross-container moveNode, bundle splicing |
| `npm run test:browser` | nine suites: on-demand (114 assertions), style-panel, style-theme, image export (65 assertions incl. the follow-up-removal toggle), standalone interactive page (46 assertions incl. remove-follow-up semantics), Article spacing, settings/template exchange/management (101 assertions), Artifact block editing and arrangement (175 checks: request list, arrangement, live target-order preview, drag/keyboard reorder, `edit_ui_blocks`-targeted envelope, block-fragment revision replay, order-only path, background conflict probe, 720–1179px drawer and below-720px notice, multi-card drafts/two chips, detach→re-attach, one message with two envelopes/request ids, two independent revisions and two sent-summary chips, Turn-close reconciliation of fulfilled drafts and the failed-draft restore/re-attach path, plus the M3-2 zero-model local restore card and branch conflict→note→`branch:true` envelope flow, the M3-3 draft-persistence scenario (sessionStorage record, reload restoring the chip/request list), the M3-4 temporary-style scenario (marked card, snapshot envelope without styleId, temporary revision card, reorder-only rejection guidance), and the M4-1 nested scenario (opt-in toggle, nested display id, nodeId/sourceDigest/depth envelope), and the M4-2 nested arrangement scenario (same-parent reorder, reset, orderByParent envelope keeping targetOrder), and the M4-3 structure duplicate scenario (mocked structure POST with nodeId/sourceDigest/toIndex, structural-revision local card, editor closes), the M4-4 container-expansion scenario (Box/Grid/Section/Carousel selection, Grid child id in the envelope), the M4-4 completion scenario (addition form/row/removal, additions envelope with parent/instruction, move-menu candidates and one cross-container move request), the M4-5 preview scenario (dry-run 200 → confirm apply, `aria-modal`/initial focus Cancel, diff add rows, move preview→apply), the B2-5 strict scenario (toggle off by default, envelope `"strict":true` plus strict instruction), and the B2-6 runtime-state scenario (a new revision inherits `$state` and the selected value); a nested-edit-renderer suite (75 checks) covers the display:contents compensation geometry across seven containers/18 slots, Carousel scrolling/overlay, innermost hit-testing and unchanged ordinary rendering; Chrome required; run `npm run build` first) | Browser behavior cited by docs |
| `npm run test:renderer` | `42/42` parse, `42/42` render, contrast OK, i18n 4 programs, typography 22/22, media-row 17/17, pressable-select 9/9, CSS contract 50/50, prop contract 63/63, nested-css-contract 28/28 direct + 5/5 scoped (Chrome for the latter group) | Renderer behavior cited by docs |

## Screenshot reproduction

`node scripts/capture-screenshots.mjs` captures seven production-component fixtures at 2x (layout, settings, toggle, panel, armed hint, temporary result, dark temporary result), retaining 13 README assets in total. `node scripts/capture-screenshots.mjs --dark --out-dir=/tmp/iui-r4-dark` checks all seven against fixed dark tokens without overwriting shipped light captures. Services are deterministic fakes; shell card glyphs use lucide stand-ins because DSH primitives are supplied by the live loader. The script also asserts that `DARK_THEME` defines every `--dsw-alias-*` token present in `THEME`; a missing `bg-module-platform` override previously produced a white-on-dark Temporary-style badge in the dark capture. These are component captures, not real-model DSH evidence.

## README and changelog structural checks

```sh
# Same heading depth sequence in both languages
diff <(grep -E '^#{1,3} ' README.md | sed 's/[^#].*//') <(grep -E '^#{1,3} ' README.en.md | sed 's/[^#].*//')

# Every shipped screenshot is referenced by both READMEs
for img in assets/*; do for f in README.md README.en.md; do grep -q "$img" "$f" || echo "MISSING $img in $f"; done; done
grep -oE 'assets/[A-Za-z0-9._-]+' README.md README.en.md | while IFS=: read -r _ img; do test -e "$img" || echo "DANGLING $img"; done

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
- `docs/plans/artifact-edit-followups/README.md` and `docs/plans/artifact-edit-m3/README.md` are as-planned docs that also carry dated verification records (M1/M2 Phase 1 on 2026-11-04; M3-1a/M3-1b/M3-1c/M3-2/M3-3/M3-4 on 2026-11-05 M4-0–M4-5, B2-5 and B2-6 (M4 plan), including real-GUI evidence); they are not part of the historical verification docs and are expected to be updated as milestones land. The M3-1c reconciliation code/UI is covered by `test/client/artifact-edit-reconcile.test.mjs` and the artifact-edit browser suite; the real-model partial-success path is explicitly not GUI-validated.
- `CHANGELOG.md` is repo-only by design; its absence from `npm pack` (43 files) is expected, not a missing shipped file.
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
- On a maintainer machine whose `git config remote.origin.url` uses an SSH host alias (for example `git@<ssh-alias>:…` instead of `git@github.com:…`), the clone-URL check reports drift unless the host alias is normalized to `github.com` first; the READMEs still hold the public HTTPS clone URL.
- `references/components.md` has no generator script; it is hand-maintained against `vendor/spec.json` and guarded by tests.
