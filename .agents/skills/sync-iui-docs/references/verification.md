# Verification — dsh-intelligent-ui docs

Run from the repo root. Current expected values are dated 2026-10-24; derive them from the commands, never copy them forward blindly.

## Guards

| Command | Expected (2026-10-24) | What it proves |
| --- | --- | --- |
| `npm run check` | build: `host lib/index.js 628.2 kB`, `client lib/client.js 3.61 MB`, `lib/standalone.js 3.28 MB + lib/standalone.css 502.8 kB`; tests: 207 total = Host 89 + Client 97 + packaging 21; `check: 41/41` gallery parsed; `render-check: 41/41` plus free composition in light/dark; `contrast-check: colour contract OK`; `i18n-check: localized chrome OK (4 programs)`; `typography-check: 22/22` | Build artifacts, behavior, docs/consistency guards, renderer, i18n and typography claims |
| `npm run pack:check` | 43 files; tarball/unpacked sizes vary with the working tree (derive from the current command output); includes `README.md`, `README.en.md`, `assets/`, `skills/`, `locale/`, `licenses/` (docs excluded) | Packaging claims, shipped-file lists, screenshot assets |
| `node --test test/packaging/*.test.mjs` | 21 pass (manifest 9 + reference catalog 6 + guardrails 6) | Package, README pair and changelog, screenshots, locale meta, catalog counts, prompt/Skill guardrails, decision policy, the `render_ui` contract rows and the shipped file count |
| `node --test test/packaging/guardrails.test.mjs` | 6 pass | The prompt and Agent Skill keep the extension checkout read-only while answering, and the enabled-session decision policy stays single-sourced |
| `node --test test/packaging/references.test.mjs` | 6 pass | `references/components.md` names/counts and `SKILL.md` hard-rule counts against `vendor/spec.json`; `integration.md`'s tool-contract rows against the host schemas and its shipped file count against `package.json` `files` |
| `node --test test/host/*.test.mjs` | 89 pass (mode, skill, tool, export-routes, layout, on-demand, result-store, style-routes, style-store) | Tool contract, switch semantics, embedded skill, settings config |
| `node --test test/client/*.test.mjs` | 97 pass (programs, toggle, locales, settings, exports, follow-ups, on-demand, style-actions, style-template-exchange, style-snapshot, style-theme, styles) | Client extractor, switch control (incl. Chinese), dictionaries, settings page (incl. image-export defaults and template import), template codec/actions, export message/Turn lookup, image-frame geometry and single-file page assembly |
| `npm run test:browser` | seven suites: on-demand (114 assertions), style-panel, style-theme, image export, standalone interactive page, Article spacing and settings/template exchange/management (101 assertions; Chrome required; run `npm run build` first) | Browser behavior cited by docs |
| `npm run test:renderer` | `41/41` parse, `41/41` render, contrast OK, i18n 4 programs, typography 22/22 (Chrome) | Renderer behavior cited by docs |

## Screenshot reproduction

`node scripts/capture-screenshots.mjs` captures seven production-component fixtures at 2x (layout, settings, toggle, panel, armed hint, temporary result, dark temporary result), retaining 13 README assets in total. `node scripts/capture-screenshots.mjs --dark --out-dir=/tmp/iui-r4-dark` checks all seven against fixed dark tokens without overwriting shipped light captures. Services are deterministic fakes; shell card glyphs use lucide stand-ins because DSH primitives are supplied by the live loader. These are component captures, not real-model DSH evidence.

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
2. Update the 已验证 / verification bullet in **both** `docs/verification.md` and `docs/verification.en.md`: Host / Client / packaging counts, renderer `41/41` pairs, typography `22/22`, i18n program count, pack file count and sizes.
3. If the change introduced a new test file or suite, keep the totals inside the same sentence and verify `npm test` totals match the sum.
4. Never adjust a count by arithmetic on a previous docs value.
5. Append the user-visible change to `CHANGELOG.md`; move `Unreleased` entries under the new version when publishing.

## Examples and vocabulary

- Requirement: complete fenced programs (`root = …`) across `skills/intelligent-ui/references/*.md` must parse against the library. The 2026-10-20 audit parsed 15/15 and the 2026-10-22 audit parsed 16/16; if examples change, re-run that ad-hoc parse (bundle `src/lib/library.ts` with esbuild, `createParser(library.toJSONSchema())`, parse every fenced block that starts with `root =`). If it becomes routine, promote it to a renderer test.
- Vocabulary: `node --test test/packaging/references.test.mjs` is the guard for component/function/action names and counts. Update `references/components.md` and `SKILL.md` together with `vendor/spec.json` changes.

## Known expected non-bugs (do not "fix")

- `docs/verification.md` / `docs/verification.en.md` is a historical verification record; its past tense claims are not current-state claims.
- `CHANGELOG.md` is repo-only by design; its absence from `npm pack` (43 files) is expected, not a missing shipped file.
- Release planning is intentionally not part of the shipped READMEs; don't re-add a release checklist to public docs.
- `docs/` is excluded from npm `files`; the README links to it with absolute GitHub URLs so links work on npm. Don't switch to relative links unless docs are added to `files`.
- The repository and npm package are public; the README clone and GitHub Issues links are live. The stable version `0.4.2` is intentionally tagged `latest`.
- Host/Client version-skew passages quote old Host strings (`Usage: /iui [on|off]`, "already off for this session") on purpose.
- Screenshots under `assets/` are English-UI captures (card-level, captured from the real renderer with DSH theme tokens); the READMEs say so. A Chinese capture needs a live Chinese session.
- Model-facing English text (tool description, generation prompt, Agent Skill body) and the `/iui` Host replies / command-palette description are English by design.
- `npm run typecheck` exists but has no `tsconfig.json`; don't cite it as a working check until it is wired.
- There is no PR CI; `.github/workflows/publish.yml` is the only workflow and publishes on `v*` tags via Trusted Publishing (OIDC + provenance). `npm run check` remains the local gate, and the workflow itself checks that the tag matches `package.json`.
- Release verification is manual: after pushing a `v*` tag, watch `gh run list --workflow=publish.yml`; then confirm the registry version and `npm audit signatures` from a temporary install. See the release bullet in `docs/verification*.md`.
- `lib/` is gitignored; artifact sizes are build outputs and must come from a fresh `npm run check`.
- `references/components.md` has no generator script; it is hand-maintained against `vendor/spec.json` and guarded by tests.
