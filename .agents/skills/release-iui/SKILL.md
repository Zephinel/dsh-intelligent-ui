---
name: release-iui
description: "Release and publish the dsh-intelligent-ui extension: prepare the version, CHANGELOG, bilingual release notes, README/docs pins, run the local gates, tag, watch Trusted Publishing, verify the registry and create the GitHub Release. Use only when the user explicitly asks to release/publish this repository, or asks to prepare a release that will be tagged later. Never create a tag or publish from a request that only changes code, docs, or a plugin page."
whenToUse: "发布插件, 发版, 出个版本, 发布 0.6.x, release, publish, cut a release, prepare a release, tag v0.6.x, npm publish, GitHub Release, 发布流程"
---

# Release IUI

This repository publishes `@zephinel/dsh-intelligent-ui` to npm through a tag-triggered Trusted Publishing workflow. This skill fixes the release procedure so a new session does not have to rediscover it, and keeps the human approval gates explicit.

## Authorization (read first)

- **A change request is not a release request.** Adding a feature, fixing a bug, or editing docs/README/plugin pages never authorizes a version bump, tag, push, or publish.
- **Preparation and publishing are separate gates.** If the user says "prepare 0.6.2" or "把发布准备好", do the preparation below but stop before the tag and show the release-notes text for review.
- **Tagging/publishing requires an explicit approval for the exact version** ("发布吧", "publish 0.6.2", "tag it"). Record the approved version in the commit and tag.
- Do not bump a version, create `release-notes/<version>*`, or rerun the publish workflow without that approval. Do not retag or republish an already-published version.
- This skill does not override product decisions, code review, or the `sync-iui-docs` skill; use both for release docs.

## Preconditions

1. Confirm the target version with the user (stable semver, normally a patch after a security fix and a minor for a feature batch).
2. `git status --porcelain` is empty, `main` is in sync with `origin/main`, and the latest CI run on `main` is green.
3. `docs/development.md` § 发布（Trusted Publishing） is the current platform procedure; read it before editing. This skill adds the repository-specific gate and approval rules around it.
4. If the release includes code or locale changes, the feature branch is already merged and verified on `main`.
5. Check the current published state:
   ```bash
   node -p "require('./package.json').version"
   npm view @zephinel/dsh-intelligent-ui version dist-tags --json --prefer-online
   git tag --sort=-v:refname | head -3
   ```

## 1. Prepare the release commit (no tag yet)

1. Decide the UTC release date. CHANGELOG section dates and the GitHub Release title use the **UTC** date; the local timezone may be a day ahead.
2. `package.json` / `package-lock.json`: bump `version` (both the root field and `packages[""].version`).
3. `CHANGELOG.md`: move the current `## [Unreleased]` entries into `## [<version>] - <UTC date>`. Leave `## [Unreleased]` in place (empty is fine). Never rewrite released sections.
4. `release-notes/<version>.md` (required) and optional `release-notes/<version>.en.md`:
   - `## Highlights` with **2–6 short, user-facing bullets**; no implementation detail unless the user wants it.
   - The publish workflow refuses a tag whose notes file is missing or has no Highlights; an English file is validated when present and falls back to the default file.
   - Keep each bullet plain user language; the update prompt renders these verbatim.
5. Update current version/status claims:
   - README pair status block and install pins (`README.md`, `README.en.md`);
   - `docs/development*.md` latest pin/tag examples;
   - `docs/current-facts.json` **after** remeasuring the packed facts;
   - `docs/architecture*`, latest verification record, and `sync-iui-docs` maintenance metadata when counts/sizes changed.
6. Run `sync-iui-docs` (delta mode) so README/docs/CHANGELOG/release-notes agree.
7. If packed files changed (README, locale, `skills/`, `lib/`, assets), remeasure:
   ```bash
   npm run build
   npm run pack:check
   npm pack --dry-run --json --ignore-scripts   # non-build bytes = all non-lib/ packed files
   ```
   Update `docs/current-facts.json` and the current claims from that output. Do not quote compressed tarball bytes in docs; only the portable non-build byte sum and packed file count are guarded.
8. Show the release-notes Highlights to the user and wait for approval. Stop before step 2 (tag).

## 2. Gates before tagging

Run all of these from the prepared commit:

```bash
npm run check                 # typecheck/build/tests/renderer/docs-facts/docs-links/pack-facts
npm run check:release-notes   # release-notes highlights, default + optional English
npm run pack:check            # packed manifest
npm run check:release         # package-level install/boot/byte-identity/uninstall (local, needs dsh + pnpm)
git diff --check
```

- `npm run check:release` is intentionally not in CI; run it locally before the tag.
- If code or renderer dependencies changed, also run the browser suites locally when feasible (`npm run test:browser`), or confirm the latest full CI run on the same tree is green.
- Commit the prepared tree, push `main`, and wait for CI to be green before tagging. A push-triggered `verify` run is not the publish gate; the tag reruns its own checks.

## 3. Tag and publish

Only after explicit approval of the exact version and release-notes text:

```bash
git tag -a v<version> -m "<version> — <UTC date>"
git push origin v<version>
```

Rules:

- Use an **annotated** tag (`git tag -a`); the existing releases are annotated.
- The tag must match `package.json`; `publish.yml` rejects a mismatch.
- Do not use `--follow-tags` from an unrelated commit: push the tag explicitly so the workflow runs exactly once for this version.
- The workflow reruns `npm run check`, `pack:check`, the CHANGELOG section check and `check:release-notes`, then publishes with OIDC + provenance. There is no `NODE_AUTH_TOKEN`.

## 4. Watch the publish workflow

```bash
gh run list --workflow=publish.yml --limit 1 --json databaseId,status,headSha
gh run watch <run-id> --exit-status --interval 10
```

- npm propagation is eventual: the version endpoint and `dist-tags` can lag several minutes. The current workflow polls the registry endpoints for up to **10 minutes**. Do not conclude publish failed from a stale `npm view` in the first minutes.
- If the publish step itself succeeded but the verify step failed, check the registry directly before reacting:
  ```bash
  curl -fsS "https://registry.npmjs.org/-/package/@zephinel%2Fdsh-intelligent-ui/dist-tags"
  curl -sS -o /dev/null -w '%{http_code}\n' "https://registry.npmjs.org/@zephinel%2Fdsh-intelligent-ui/<version>"
  ```
  Do **not** rerun the tag workflow to "fix" a propagation lag: it may attempt to republish the same version.
- Verify once settled:
  ```bash
  npm view @zephinel/dsh-intelligent-ui version dist-tags --json --prefer-online
  curl -sS "https://registry.npmjs.org/@zephinel/dsh-intelligent-ui/<version>"   # check dist.attestations.provenance
  ```
  A temporary install + `npm audit signatures` is optional but useful for provenance.

## 5. Post-publish

1. Create the GitHub Release (the workflow does not do this):
   ```bash
   { cat release-notes/<version>.md; echo; echo "---"; echo; cat release-notes/<version>.en.md; } > /tmp/release-<version>.md
   gh release create v<version> --title "<version> — <UTC date>" --notes-file /tmp/release-<version>.md
   ```
2. Verify the tag-pinned raw notes are readable (the update prompt fetches these):
   ```bash
   curl -fsS "https://raw.githubusercontent.com/Zephinel/dsh-intelligent-ui/v<version>/release-notes/<version>.md" >/dev/null
   ```
3. If the release was prompted by an issue, comment with the fixed version and evidence, then close it if the reporter's scenario is resolved.
4. Record the release result in `docs/verification*.md` (workflow run, npm `latest`, provenance, Release URL) and push with `sync-iui-docs`; this is a docs-only follow-up and must not bump the version.
5. Marketplace listings follow npm `latest` on their own schedule; the repository only needs its README/screenshots pushed.

## Don't

- Don't tag or publish while release-notes are still draft or without the exact-version approval.
- Don't `npm publish` locally; Trusted Publishing is the only path.
- Don't amend, delete, or retag an already-published tag.
- Don't rewrite released CHANGELOG sections; add a new Unreleased entry for a fix.
- Don't treat a short registry lag or a stale client page as a failed release; verify the registry endpoints first.
- Don't change behavior to make a document match; that is implementation, not this skill.
