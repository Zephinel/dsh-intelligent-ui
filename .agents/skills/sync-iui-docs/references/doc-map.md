# Doc map — dsh-intelligent-ui

Paths are repo-root relative. Load this before auditing. A file with mixed classes is split by section; when a doc is new and not listed here, classify it with the rules at the bottom before touching it.

## As-built docs (must match the implementation)

| Doc / section | Truth source | Existing guard |
| --- | --- | --- |
| `README.md` — 效果, 组件一览, 更多示例, 核心能力, 获取代码, 前置条件, 快速开始, 三档开关, 使用, 构建、测试与部署, 贡献, 已知限制, 文档, 许可证; the 当前状态 line | `src/shared/locales.ts` (UI labels), `src/host/index.ts` (tool contract), `src/host/mode.ts` (switch semantics, persistence, command copy), `src/client/index.tsx` (services/registrations), `src/lib/render.tsx` (renderer behavior), `package.json` (scripts, files, status), `git config remote.origin.url` (clone URL), `vendor/spec.json` (vocabulary), `docs/*.md` (linked detail), command output (prompt size, switch behavior) | `test/packaging/manifest.test.mjs` for package/README links/screenshots/locale meta; `test/packaging/references.test.mjs` for Agent Skill counts; clone URL and docs-link checks are in `references/verification.md` |
| `README.en.md` | Same truth sources as `README.md`, with English labels from the `en` dictionary; must mirror `README.md` structure, facts, language switcher, and screenshot references | `test/packaging/manifest.test.mjs` (cross-link + screenshots); structural and factual parity is manual |
| `docs/architecture.md` / `docs/architecture.en.md` | As-built detailed docs: component tree, full three-state switch semantics, decision policy, the Plugins detail page configuration and free-composition switch, the image/interactive-page export entries and capture pipeline, UI language and Agent Skill. Sources: `src/client/index.tsx`, `src/client/SettingsPage.tsx`, `src/client/ExportAction.tsx`, `src/client/export-*.ts`, `src/standalone/**`, `src/host/index.ts`, `src/host/mode.ts`, `src/shared/locales.ts`, `skills/intelligent-ui/SKILL.md` | Local link/anchor check; not covered by product tests — manual |
| `docs/development.md` / `docs/development.en.md` | As-built install/dev/troubleshooting/layout details. Sources: `package.json` scripts/`files`, `scripts/build.mjs` (Host/client/standalone), `scripts/generate-prompt.mjs`, `scripts/install.mjs`, `cordis.patch.yml`, `test/packaging/*` | `npm run check` and `npm run pack:check` for commands/counts; prose is manual |
| `skills/intelligent-ui/SKILL.md` | As-built for switch gating, turn-tail card, tool contract, DSH specifics, hard-rule vocabulary counts, and the reference index. Its workflow and design advice are stable product guidance — change only when behavior changes. Sources: `src/host/*`, `src/client/*`, `src/shared/locales.ts`, `vendor/spec.json` | `test/packaging/references.test.mjs` for counts/header; `test/packaging/guardrails.test.mjs` for the read-only-checkout preflight rule; copy match is manual |
| `skills/intelligent-ui/references/components.md` | As-built catalog of 57 components, 14 core + 59 library functions, 5 action steps, and signatures. Source: `vendor/spec.json` (schema the Host validates) and `src/lib/library.ts`. Hand-maintained; no generator script | `test/packaging/references.test.mjs` checks names, counts, and the header; signatures are hand-checked |
| `skills/intelligent-ui/references/language.md` | As-built syntax/state/action reference. Source: `@openuidev/lang-core` behavior, `src/generated/prompt.txt`, and the shipped examples | No direct guard; parse complete example programs if edited |
| `skills/intelligent-ui/references/examples.md` | As-built runnable programs (content itself is model-facing). Source: `src/lib/library.ts` + `vendor/spec.json` | No direct guard; complete programs across the references were parsed 15/15 in the 2026-10-20 audit |
| `skills/intelligent-ui/references/troubleshooting.md` | As-built error strings and runtime fallbacks. Source: `src/host/index.ts` and `src/host/mode.ts` (verbatim messages), `src/shared/locales.ts` and `src/lib/**` (fallback chrome), `test/host/*` for behavior | `test/packaging/guardrails.test.mjs` checks the preflight guardrail; error strings are manual. Version-skew examples quote an old Host on purpose — keep them |
| `skills/intelligent-ui/references/integration.md` | As-built deployment/install/requirements/tool contract/limits. Source: `package.json` (`dsh`, `exports`, `files`, scripts), `cordis.patch.yml`, `scripts/install.mjs`, `src/client/index.tsx` (inject list), `src/host/index.ts` (optional `webServer` routes), DSH package docs for service requirements | `test/packaging/manifest.test.mjs` covers the bundle patch row; the rest is manual |
| `test/renderer/README.md` | As-built description of the harness. Source: `package.json` scripts and `test/renderer/*.mjs` | No direct guard; check every script named in `test:renderer` and `check:theme` exists and is described |
| `package.json` | As-built manifest: description, version, keywords, scripts, `files`, `exports`, `dsh`, publishability | `test/packaging/manifest.test.mjs`; `npm run pack:check` for the shipped list/sizes |
| `locale/en.json`, `locale/zh.json` | As-built plugin display metadata. The zh title/description must be translated (`智能 UI`, description in Chinese) | `test/packaging/manifest.test.mjs` (key parity, zh CJK, descriptions differ) |
| `cordis.patch.yml` | As-built bundle-install comment and row | `test/packaging/manifest.test.mjs` (row id + package name) |
| `assets/*` | README screenshots (WebP card captures + the PNG composer switch); English-UI captures | `test/packaging/manifest.test.mjs` (each exists, is referenced by both READMEs, and no README references a missing asset) |

## Generated / vendored / legal (never hand-edit)

| Path | Rule |
| --- | --- |
| `vendor/**` — `spec.json`, `system-prompt.txt`, upstream library, upstream license | Vendored build inputs. Change the source only with upstream work; regenerate derived files |
| `src/generated/prompt.txt` | Generated by `scripts/generate-prompt.mjs` during `npm run build`. Edit `vendor/system-prompt.txt` or the script, then rebuild; `test/packaging/guardrails.test.mjs` checks the preflight guardrail survives generation |
| `lib/**` | Build artifacts, gitignored. Regenerate with `npm run build`; inspect through `npm run pack:check` |
| `licenses/**`, `LICENSE`, `NOTICE` | Legal attribution. Don't edit content; the manifest test checks attribution names |
| `package-lock.json` | Dependency lock; regenerate through npm |

## As-planned / historical (leave intent and history)

| Doc / section | Class | Rule |
| --- | --- | --- |
| `docs/verification.md` / `docs/verification.en.md` | Historical evidence record | Don't rewrite past verification. Append new evidence when verification happens; only refresh live subclaims (test counts, pack sizes, DSH version) |
| `CHANGELOG.md` | Historical release log (English only). Truth sources: `package.json` version, npm publish time, git tags/GitHub releases; repo-only (not in `package.json` `files`) | Append entries under `Unreleased`; move them under the released version when publishing. Never rewrite past releases. Guarded by `test/packaging/manifest.test.mjs` (existence, linked from both READMEs, `Unreleased` heading, absent from the tarball) and the changelog checks in `references/verification.md`. |
| Release planning / internal checklists | As-planned | Kept outside the shipped READMEs. Don't re-add a release checklist to public docs; if release steps must be documented, keep them outside the published package and verify only live subclaims (publication status, dist-tag) |
| Future `docs/roadmap*`, `docs/plans/**`, `.agents/notes/**`, `ROADMAP*` | As-planned or historical | Don't sync with code. Flag unmarked plans; append, never rewrite |
| `vendor/**` docs and upstream links | External / vendored | Don't align with this implementation |

## Classification rules for a new doc

- Planned/forward-looking markers ("will", "future", "planned", "next", "计划", "待实现") with no matching code → **as-planned**: leave the intent, flag it if unmarked.
- Changelog, ADR, verification log, archived note → **historical**: append, don't rewrite.
- Describes current behavior, copy, requirements, counts, paths, or release state → **as-built**: audit it.
- Under `vendor/`, generated output, or a license file → **generated/vendored/legal**: regenerate or leave.
- Ambiguous → ask the owner; default to leaving it and flagging it.
