---
name: release-iui
description: "Release and publish the dsh-intelligent-ui extension: prepare the version, CHANGELOG, bilingual release notes, README/docs pins, run the local gates, tag, watch Trusted Publishing, verify the registry and create the GitHub Release. Use only when the user explicitly asks to release/publish this repository, or asks to prepare a release that will be tagged later. Never create a tag or publish from a request that only changes code, docs, or a plugin page."
whenToUse: "发布插件, 发版, 出个版本, 发布新版本, release, publish, cut a release, prepare a release, tag v0.x, npm publish, GitHub Release, 发布流程"
---

# Release IUI

This repository publishes `@zephinel/dsh-intelligent-ui` to npm through a tag-triggered Trusted Publishing workflow. This skill fixes the release procedure so a new session does not have to rediscover it, and keeps the human approval gates explicit.

## Two processes: operation and independent verification

A release has two owners and they must not collapse into one:

1. **Operation (main agent).** Prepare the version, docs and release notes; run the local gates; commit and push; tag; watch the publish workflow; create the GitHub Release; record the result.
2. **Verification (independent subagent).** A fresh-context, read-only subagent verifies the prepared commit before the tag and the published result after the workflow. It must not edit files, commit, tag, push, publish or restart services. It returns PASS / FAIL / CONDITIONAL with evidence.

Rules:

- Start the verifier with `subagent` (fresh context), never `subagent_fork` (it inherits the operator's conversation).
- The main agent's own gate results are not the verification verdict. Only a PASS (plus the owner's version and notes approvals) opens the tag gate; do not tag on "should be fine".
- Use a fresh verifier for each round after fixes; do not ask one context to bless its own earlier finding.
- The verifier's checklist, independence constraints, report format and prompt template live in [`references/independent-verification.md`](references/independent-verification.md).

## Authorization (read first)

- **A change request is not a release request.** Adding a feature, fixing a bug, or editing docs/README/plugin pages never authorizes a version bump, tag, push, or publish.
- **Preparation and publishing are separate gates.** If the user says "prepare 0.6.2" or "把发布准备好", do the preparation below but stop before the tag and show the release-notes text for review.
- **Tagging/publishing requires an explicit approval for the exact version** ("发布吧", "publish 0.6.2", "tag it"). Record the approved version in the commit and tag. That approval authorizes the version only: the release-notes Highlights still need the owner's own review in step 1.9 unless the owner explicitly waives it ("要点不用 review").
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
5. Update current version/status claims. **Deterministic release facts are written now, before the tag**; do not leave them for a post-publish docs commit:
   - README pair status block and install pins (`README.md`, `README.en.md`): every documented CLI install pins `@<version>`;
   - `docs/development*.md` install commands, latest pin/tag examples;
   - `docs/current-facts.json` **after** remeasuring the packed facts;
   - `docs/architecture*`, latest verification record, and `sync-iui-docs` maintenance metadata when counts/sizes changed.

   **Asynchronous external state is never asserted as current.** Marketplace index versions, DSH Desktop marketplace availability and npm propagation are not known at commit time; write the refresh policy (for example "indexes refresh on their own schedule; the previous release may still show") and verify the real state after publish. A statement such as "the marketplace currently has `<version>`" is forbidden unless it was observed.
6. Run `sync-iui-docs` (delta mode) so README/docs/CHANGELOG/release-notes agree.
7. If packed files changed (README, locale, `skills/`, `lib/`, assets), remeasure:
   ```bash
   npm run build
   npm run pack:check
   npm pack --dry-run --json --ignore-scripts   # non-build bytes = all non-lib/ packed files
   ```
   Update `docs/current-facts.json` and the current claims from that output. Do not quote compressed tarball bytes in docs; only the portable non-build byte sum and packed file count are guarded.
8. **Release claims audit (pre-tag, recorded in the release commit body).** Check the docs as a user, not as their author:
   - `npm run check:docs-install` passes: every documented CLI install pins `@<version>` (a bare package name can resolve to the previous release under pnpm 11/12's default 24-hour `minimumReleaseAge`), and the guard rejects marketplace/Desktop current-version claims.
   - The upgrade path from the previous release is documented: the pinned install command, or GitHub `main`.
   - Query the configured market indexes (`plugin_market` → both sources) and record their current versions. README/development must not claim a market or DSH Desktop already has the new version; they state the refresh policy and point to the pinned command for immediate use. Third-party listing descriptions are external and are corrected separately.
   - Record the audit summary in the release commit body, e.g. `Release-Claims-Audit: docs-install ok; markets=<observed>,<observed>; pinned=<version>`.

9. **Notes review gate (never skipped implicitly).** Show the complete `release-notes/<version>.md` Highlights (plus `.en.md` when present) to the owner and wait for an explicit approve-or-changes answer before step 2 — even when the owner's message already named the version ("发布 0.6.2"). These bullets render verbatim in the update prompt and the tag pins them, so a wording fix after the tag is impossible. After approval run `node scripts/release-notes-approval.mjs`: it reprints the reviewed bullets and a `Release-Notes-Review: sha256=<hash>` line; put that line in the release commit body (the commit that gets tagged). The hash covers the version plus both notes files, so any later notes edit invalidates the approval and `publish.yml` refuses to publish. Only an explicit "要点没问题 / skip the review" waives this gate.

## 2. Gates before tagging

Run all of these from the prepared commit:

```bash
npm run check                 # typecheck/build/tests/renderer/check:docs-install/docs-facts/docs-links/pack-facts
npm run check:release-notes   # release-notes highlights, default + optional English
node scripts/release-notes-approval.mjs --verify   # the tagged commit carries the approved notes hash
npm run pack:check            # packed manifest
npm run check:release         # package-level install/boot/byte-identity/uninstall (local, needs dsh + pnpm)
git diff --check
```

- `npm run check:release` is intentionally not in CI; run it locally before the tag.
- If code or renderer dependencies changed, also run the browser suites locally when feasible (`npm run test:browser`), or confirm the latest full CI run on the same tree is green.
- Commit the prepared tree, push `main`, and wait for CI to be green before tagging. A push-triggered `verify` run is not the publish gate; the tag reruns its own checks.

## 2.5 Independent pre-tag verification

After the gates pass, the release commit is pushed and CI is green, launch the independent verifier:

- Use `subagent` with the prompt from [`references/independent-verification.md`](references/independent-verification.md), stage `pre-tag`; give the exact commit SHA, version, notes paths, owner approvals, CI run id and any caveats.
- The verifier must read the files and run its own checks (git state, version/lock, CHANGELOG, notes approval, install pins/market wording, `npm run check`, `check:release`, `pack:check`, CI). It must not trust this skill or the operator's summary.
- FAIL/CONDITIONAL: fix, re-run the local gates and CI, then launch a **fresh** verifier for the new commit. Do not create the tag.
- PASS: record the verdict and verifier name, then proceed to step 3.

## 3. Tag and publish

Only after explicit approval of the exact version and release-notes text:

```bash
git tag -a v<version> -m "<version> — <UTC date>" -m "Release-Verification: PASS (<verifier name>)"
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
  npm run check:published-install   # the documented pinned command installs <version> into a throwaway DSH_HOME
  ```
  `check:published-install` proves the install path, not just the registry: if it fails, fix the docs before announcing. A temporary install + `npm audit signatures` is optional but useful for provenance.
- Read the configured market indexes after the release and record what they still show. If an index shows the previous release, that is expected; do not edit docs to claim otherwise. A marketplace description that is materially outdated is a separate correction request.
- Launch a **fresh** independent verifier for `post-publish` (do not reuse the pre-tag context) after the workflow and registry settle. It verifies the publish run, registry/provenance, tag/commit, GitHub Release, tag-pinned notes, `check:published-install` and the observed market state. If it fails, fix and re-verify; do not announce until PASS.

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
4. Record the release result in `docs/verification*.md` (workflow run, npm `latest`, provenance, Release URL, `check:published-install`, the independent verifier name/verdict and any residual risks) and push with `sync-iui-docs`; this is a docs-only follow-up and must not bump the version.
5. Marketplace listings follow npm `latest` on their own schedule and may still show the previous release. Record the observed index state; do not assert their current version in docs. The repository only needs its README/screenshots pushed; materially outdated listing text is corrected through the market entry.

## Don't

- Don't tag or publish while release-notes are still draft or without the exact-version approval.
- Don't treat an exact-version approval as sign-off on the Highlights: the notes review (step 1.9) is a separate gate unless the owner explicitly waives it.
- Don't tag a release commit without the `Release-Notes-Review: sha256=<hash>` line, and don't edit the notes files after approval — `publish.yml` refuses either case.
- Don't `npm publish` locally; Trusted Publishing is the only path.
- Don't self-verify a release or tag before the independent verifier returns PASS. Don't let the verifier edit, commit, tag, push or publish; it is read-only.
- Don't ship a bare `dsh plugin add @zephinel/dsh-intelligent-ui` in docs: pnpm 11/12's 24-hour release-age default makes it install the previous version on release day. Pin the version.
- Don't assert a marketplace, DSH Desktop or second-party index "currently" has the new version. State the refresh policy and verify the observed state after publish.
- Don't amend, delete, or retag an already-published tag.
- Don't rewrite released CHANGELOG sections; add a new Unreleased entry for a fix.
- Don't treat a short registry lag or a stale client page as a failed release; verify the registry endpoints first.
- Don't change behavior to make a document match; that is implementation, not this skill.
