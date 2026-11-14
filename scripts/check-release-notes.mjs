#!/usr/bin/env node
/**
 * Release-note gate for the tag-driven publish workflow.
 *
 * A release must commit `release-notes/<version>.md` with at least one
 * `## Highlights` bullet before its tag is pushed. The text is read back by the
 * update card from the tag-pinned raw URL, so the same reviewed file is what
 * users see. This check runs in `publish.yml` before `npm publish`; running it
 * locally (`node scripts/check-release-notes.mjs`) previews the gate.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHighlights } from '../src/shared/release-notes.ts'

const root = resolve(new URL('..', import.meta.url).pathname)
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
const file = resolve(root, 'release-notes', `${version}.md`)
let markdown = ''
try {
  markdown = readFileSync(file, 'utf8')
} catch {
  console.error(`release-notes: missing release-notes/${version}.md`)
  process.exitCode = 1
}
if (markdown === '') process.exit()

const highlights = parseHighlights(markdown)
if (highlights.length === 0) {
  console.error(`release-notes: release-notes/${version}.md has no "## Highlights" bullets`)
  process.exitCode = 1
}

// The English variant is optional (the Host falls back to the default file),
// but when committed it must contain reviewed Highlights as well.
const englishFile = resolve(root, 'release-notes', `${version}.en.md`)
let english = null
try {
  english = parseHighlights(readFileSync(englishFile, 'utf8'))
} catch { /* no English notes; the Host falls back to the default file */ }
if (english !== null && english.length === 0) {
  console.error(`release-notes: release-notes/${version}.en.md has no "## Highlights" bullets`)
  process.exitCode = 1
}

if (process.exitCode === 0 || process.exitCode === undefined) {
  console.log(`release-notes: ok (${version}; ${highlights.length} highlight(s)${english === null ? '' : `, ${english.length} English`})`)
  for (const point of highlights) console.log(`  - ${point}`)
  for (const point of english ?? []) console.log(`  - [en] ${point}`)
}
