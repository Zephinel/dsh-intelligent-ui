# Independent release verification

A release is two processes, not one agent's checklist:

- **Operation** — the main agent prepares the version, docs and release notes, runs the local gates, commits, pushes, watches CI and the publish workflow, creates the GitHub Release, and records the result.
- **Verification** — a fresh-context, read-only subagent verifies the prepared commit before the tag and the published result after the workflow. It returns PASS / FAIL / CONDITIONAL with evidence.

The operator may run the same commands, but its own results are not the verification verdict. Only an independent PASS (plus the owner's version and notes approvals) opens the tag gate.

## Independence rules

- Start the verifier with `subagent` (fresh context), never `subagent_fork` (it inherits the operator's conversation and conclusions).
- The verifier is read-only: do not edit repository files, commit, tag, push, publish, restart DSH/launchd, or touch `~/.dsh` profiles or the running GUI. Scratch files go under `/tmp` only.
- The verifier must not trust the operator's summary or this checklist as proof: read the files, run the commands, quote SHAs and output.
- A CONDITIONAL verdict is not a pass. Only PASS allows the next gate.
- Use a fresh verifier for each round after fixes; do not let one context bless its own earlier finding.
- Do not run the Chrome browser suites (they are heavy and covered by the release commit's CI); `npm run check`, `check:release`, `check:docs-install` and `check:pack-facts` are enough for the local side.

## Inputs from the operator

Provide these in the subagent prompt:

- repository path and branch;
- stage: `pre-tag` or `post-publish`;
- target version (for example `0.7.1`), UTC release date and tag name;
- the exact release commit SHA and whether it is pushed;
- owner approvals: exact version approved, release-notes Highlights reviewed (or explicitly waived);
- `release-notes/<version>.md` and optional `.en.md` paths, plus the approval hash if already in the commit body;
- CI run id for the commit (pre-tag) and publish run id (post-publish);
- any known caveats (for example, a docs-only follow-up commit after the tag).

## Pre-tag checklist

Identity and git state:

- `git status --porcelain` is empty; `git rev-parse HEAD` equals the supplied release commit; the tag does not exist yet.
- `git log -1 --format=%H%n%B` shows the release commit and, when required, the `Release-Notes-Review: sha256=<hash>` trailer.
- No unexpected files are added, deleted or modified; no secrets or local paths in the diff.
- The release commit is the one that will be tagged (a later docs-only commit is allowed only if it is also the tagged commit or explicitly outside the release).

Version, changelog and notes:

- `package.json` version and `package-lock.json` root/`packages[""].version` equal the target version.
- `CHANGELOG.md` has `## [<version>] - <UTC date>` and no released section was rewritten; `## [Unreleased]` still exists.
- `release-notes/<version>.md` exists with 2–6 plain bullets; `.en.md` exists and is reviewed when present; the bullets match what the owner approved.
- `node scripts/release-notes-approval.mjs --verify` passes for the release commit; `npm run check:release-notes` passes.
- `npm view @zephinel/dsh-intelligent-ui version dist-tags --json --prefer-online` still shows the previous version as `latest` (the target must not already be published).

Docs and claims:

- Every documented CLI install of the package pins `@<version>` (`npm run check:docs-install`); pnpm/cooldown prerequisites are present.
- Marketplace/DSH Desktop text states the index refresh policy, not a "current version"; no asynchronous npm propagation is asserted as a fact.
- README status, `docs/development*.md` pins/tag examples, the shipped integration reference and `docs/current-facts.json` are consistent with the version and measured pack.
- The publish-gate docs describe both `check:release-notes` and the `Release-Notes-Review` approval.
- Spot-check recent audit findings: renderer Chrome-check list, toggle labels, prompt size, architecture history counts (do not trust the operator that they are fixed).

Gates:

- Run `npm run check`, `npm run check:release-notes`, `node scripts/release-notes-approval.mjs --verify`, `npm run pack:check`, `npm run check:release`, `git diff --check` from the release commit; record exit codes and key output (Node totals, pack files/non-build bytes, release-check PASS).
- Confirm the latest `ci.yml` run on the release commit is green (`gh run view <id> --json jobs`); browser shards on main are part of it.
- Recompute `docs/current-facts.json` values only from command output; flag cached or copied numbers.

## Post-publish checklist

- The `publish.yml` run for the tag succeeded, including the notes approval and registry verification.
- `npm view @zephinel/dsh-intelligent-ui version dist-tags --json --prefer-online` shows the target as `latest`; the version document reports `gitHead` equal to the release commit and `dist.attestations.provenance`.
- The annotated tag points at the release commit; `git tag -n99 v<version>` shows the expected message and verification line.
- The GitHub Release exists with the target title/date and the paired Chinese/English notes; the tag-pinned raw notes return 200 for both files.
- `npm run check:published-install` installs the documented pinned version into a throwaway `DSH_HOME`.
- Read the configured market indexes (`plugin_market` or the index JSON) and record what they show; the docs must not claim a market current version. A stale index is expected, not a release failure.
- The release result in `docs/verification*.md` records the workflow run, registry/provenance, Release URL, `check:published-install`, the verifier verdict and any residual risks.
- Confirm no version bump or released-section rewrite happened after the tag; the working tree is clean.

## Report format

Return exactly this shape (Chinese or English, per the operator's request):

```text
Verdict: PASS | FAIL | CONDITIONAL
Stage: pre-tag | post-publish
Release: <version> @ <commit>
Checked: <grouped list of commands/files actually checked>
Findings:
- [BLOCKER|MAJOR|MINOR|NIT] <file:line or command> — <fact> — <evidence> — <suggested fix>
Not run / unavailable: <items and why>
Independence: no repository files modified; git status unchanged
```

- PASS requires no BLOCKER/MAJOR and all gate commands above actually run.
- CONDITIONAL means only NIT/MINOR findings or an unavailable check that does not affect correctness; state what the operator must decide.
- FAIL means any BLOCKER/MAJOR, a gate failure, a missing approval, or a version/commit mismatch.
- Do not edit files to "fix" a finding; report it.

## Prompt template

```text
You are the independent release verifier for the dsh-intelligent-ui repository.
Work read-only: do not edit files, commit, tag, push, publish, restart services, or touch ~/.dsh.
Do not trust the operator's summary; read files and run commands yourself.

Repository: <abs path>
Stage: <pre-tag | post-publish>
Version: <x.y.z>
Release commit: <sha>
Tag: <v...> (or "not created yet")
Owner approvals: version=<yes/no>, notes=<reviewed/waived>
Release notes: release-notes/<version>.md, release-notes/<version>.en.md
CI run: <id or none>
Publish run: <id or none>
Known caveats: <...>

Follow .agents/skills/release-iui/references/independent-verification.md.
Run the checklist for the stage, then return only the report in its format.
```
