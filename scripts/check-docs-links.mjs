#!/usr/bin/env node
/**
 * Docs link guard: every local Markdown link/anchor in the as-built docs must
 * resolve, every absolute GitHub `blob/main` link in the README pair must point
 * at a tracked file, and both READMEs must carry the public HTTPS clone URL of
 * the configured remote.
 *
 * Runs as part of `npm run check` and in CI. The checker intentionally scans the
 * as-built docs only (README pair, docs pairs, PRODUCT.md, CHANGELOG, the two
 * test READMEs and the shipped Agent Skill); historical plan/review documents
 * are excluded because they may quote paths that no longer exist.
 *
 * Known false positives are handled rather than whitelisted:
 * - Markdown image syntax (`![alt](source)`) is skipped; only real links count.
 * - Links inside fenced code blocks and inline code spans are ignored.
 * - An absolute GitHub link with `#anchor` is checked against the file, not the
 *   literal path.
 *
 *   node scripts/check-docs-links.mjs
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

/** As-built docs that must keep working local links. */
const DOC_FILES = [
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'PRODUCT.md',
  'docs/architecture.md',
  'docs/architecture.en.md',
  'docs/development.md',
  'docs/development.en.md',
  'docs/limitations.md',
  'docs/limitations.en.md',
  'docs/usage.md',
  'docs/usage.en.md',
  'docs/verification.md',
  'docs/verification.en.md',
  'test/browser/README.md',
  'test/renderer/README.md',
  'skills/intelligent-ui/SKILL.md',
  ...readdirSync(resolve(root, 'skills/intelligent-ui/references'))
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => `skills/intelligent-ui/references/${name}`),
]

/** GitHub's heading slug (enough for this repository's headings). */
const slug = (heading) => heading
  .replace(/`/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\*\*|__/g, '')
  .replace(/<[^>]+>/g, '')
  .trim()
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s_-]/gu, '')
  .replace(/\s+/g, '-')

const anchorsOf = (path) => {
  const set = new Set()
  for (const line of read(path).split('\n')) {
    const match = /^#{1,6}\s+(.+)$/.exec(line)
    if (match) set.add(slug(match[1]))
  }
  return set
}

/** Lines outside fenced code blocks; inline code spans blanked out. */
const proseLines = (path) => {
  const lines = []
  let fenced = false
  for (const line of read(path).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    lines.push(line.replace(/`[^`]*`/g, ''))
  }
  return lines
}

const failures = []
const anchorCache = new Map()
let localLinks = 0
let anchorsChecked = 0

for (const file of DOC_FILES) {
  if (!existsSync(resolve(root, file))) {
    failures.push(`${file}: doc file is missing`)
    continue
  }
  for (const line of proseLines(file)) {
    for (const match of line.matchAll(/!?\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      if (match[0].startsWith('!')) continue // image syntax: covered by the manifest test
      const target = match[2]
      if (target === '' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue
      const [pathPart, rawAnchor] = target.split('#')
      const decodedPath = decodeURIComponent(pathPart)
      const resolved = decodedPath === '' ? resolve(root, file) : resolve(root, dirname(file), decodedPath)
      if (!existsSync(resolved)) {
        failures.push(`${file}: missing local target ${target}`)
        continue
      }
      localLinks += 1
      if (rawAnchor === undefined || rawAnchor === '') continue
      if (!statSync(resolved).isFile() || !resolved.endsWith('.md')) continue
      const key = relative(root, resolved)
      if (!anchorCache.has(key)) anchorCache.set(key, anchorsOf(key))
      if (!anchorCache.get(key).has(decodeURIComponent(rawAnchor).toLowerCase())) {
        failures.push(`${file}: missing anchor ${target}`)
      }
      anchorsChecked += 1
    }
  }
}

// Absolute GitHub blob links in the README pair must point at tracked files.
const pkg = JSON.parse(read('package.json'))
const repoSlug = String(pkg.repository?.url ?? '')
  .replace(/^git\+/, '')
  .replace(/\.git$/, '')
  .replace(/^https:\/\/github\.com\//, '')
const docLinkPrefix = new RegExp(
  `https://github\\.com/${repoSlug.replaceAll('.', '\\.')}/(?:blob|tree)/main/([^)\\s#]+)`,
  'g',
)
let absoluteLinks = 0
for (const file of ['README.md', 'README.en.md']) {
  for (const line of proseLines(file)) {
    for (const match of line.matchAll(docLinkPrefix)) {
      const target = decodeURIComponent(match[1])
      if (!existsSync(resolve(root, target))) failures.push(`${file}: broken repository link ${match[0]}`)
      absoluteLinks += 1
    }
  }
}

// Both READMEs must carry the public HTTPS clone URL of the configured remote.
let remote = ''
try {
  remote = execSync('git config --get remote.origin.url', { cwd: root, encoding: 'utf8' }).trim()
} catch {
  remote = ''
}
let cloneUrl = ''
if (remote !== '') {
  cloneUrl = remote
    .replace(/^git@[^:]+:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@[^/]+\//, 'https://github.com/')
    .replace(/^https:\/\/(?:[^@/]+@)?github\.com\//, 'https://github.com/')
    .replace(/\.git$/, '')
  for (const file of ['README.md', 'README.en.md']) {
    if (!read(file).includes(cloneUrl)) failures.push(`${file}: missing clone URL ${cloneUrl}`)
  }
}

if (failures.length > 0) {
  console.error(`docs-links: ${failures.length} failure(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    `docs-links: ok (${DOC_FILES.length} docs; ${localLinks} local links; ${anchorsChecked} anchors; ` +
      `${absoluteLinks} repository links; clone URL ${cloneUrl === '' ? 'skipped (no remote)' : 'ok'})`,
  )
}
