# Release notes

One Markdown file per release, named `<version>.md` (for example `0.6.0.md`) and
committed **before** the `v<version>` tag is pushed. The update card reads the
tag-pinned raw URL `v<version>/release-notes/<version>.md`, so the text a user
sees for a release cannot drift after publishing.

```markdown
## Highlights

- 一句话说明用户能感知的变化
- 另一条要点（最多 6 条；卡片弹窗直接显示这些条目）

## Details

可选：完整一点说明，留给后续的插件详情页更新记录使用。
```

Rules:

- `Highlights` is required and must contain at least one bullet; the publish
  workflow refuses a tag whose `release-notes/<version>.md` is missing, empty or
  has no `## Highlights` bullets.
- Keep each bullet short and user-facing; the card shows them verbatim.
- Inline Markdown is reduced to plain text: links keep their label, code ticks
  and bold markers are removed.
- The file is reviewed in the same commit/PR as `package.json` and
  `CHANGELOG.md`; pushing the tag after that review is the publish approval.
- Older releases may omit the file; their card simply has no points and the
  popover says no highlights were published.
