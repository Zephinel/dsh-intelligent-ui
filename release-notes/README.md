# Release notes

One Markdown pair per release, committed **before** the `v<version>` tag is
pushed:

- `release-notes/<version>.md` — the default (Chinese) notes; required.
- `release-notes/<version>.en.md` — the English notes; optional, falls back to
  the default file in the update prompt when absent (or when its Highlights are
  empty).

The update prompt reads the tag-pinned raw URLs
`v<version>/release-notes/<version>.md` (and `.en.md` when the DSH locale starts
with `en`), so the text a user sees for a release cannot drift after publishing.

```markdown
## Highlights

- 一句话说明用户能感知的变化
- 另一条要点（最多 6 条；更新提示的「查看详情」直接显示这些条目）

## Details

可选：完整一点说明，留给后续的插件详情页更新记录使用。
```

Rules:

- `Highlights` is required in the default file and must contain at least one
  bullet. The English file is optional; if it exists it must also contain
  Highlights.
- The publish workflow refuses a tag whose default file is missing, empty or has
  no `## Highlights` bullets (`npm run check:release-notes`), and validates an
  English file when present. The English file is reviewed in the same
  commit/PR.
- Keep each bullet short and user-facing; the card shows them verbatim.
- Inline Markdown is reduced to plain text: links keep their label, code ticks
  and bold markers are removed.
- Reviewed in the same commit/PR as `package.json` and `CHANGELOG.md`. After
  review, run `node scripts/release-notes-approval.mjs` and include the printed
  `Release-Notes-Review: sha256=<hash>` trailer in the release commit body;
  `publish.yml` verifies that hash against the tagged tree and refuses a
  missing, duplicated or mismatched approval.
- Older releases may omit the file; their bottom-right update prompt
  (`shell.overlay`) still shows the version change and notes that no highlights
  were published.
