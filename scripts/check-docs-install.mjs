#!/usr/bin/env node
/**
 * Guard: documented install pins and marketplace current-version claims.
 *
 * pnpm 11/12 enables a 24-hour `minimumReleaseAge` by default. A bare package
 * name therefore resolves to the previous mature version on release day, which
 * is how the 0.7.0 README silently installed 0.6.2. Every
 * `dsh plugin ... add @zephinel/dsh-intelligent-ui` command must pin the exact
 * `package.json` version; `github:` / `link:` / `file:` installs are exempt
 * because they do not resolve a registry range.
 *
 * The same scan rejects asserting that a marketplace or DSH Desktop
 * "currently" has a version: those indexes refresh asynchronously, so docs
 * must state the refresh policy instead of a snapshot.
 *
 *   node scripts/check-docs-install.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootArg = process.argv.slice(2).find((arg) => arg.startsWith('--root='))
const root = rootArg
  ? resolve(rootArg.slice('--root='.length))
  : resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const version = pkg.version
const PACKAGE = '@zephinel/dsh-intelligent-ui'
const PINNED = `${PACKAGE}@${version}`

/** Docs that show a CLI install command a user can copy. */
const FILES = [
  'README.md',
  'README.en.md',
  'docs/development.md',
  'docs/development.en.md',
  'skills/intelligent-ui/references/integration.md',
]

const failures = []
/** A marketplace/Desktop snapshot claim that will rot as soon as the index refreshes. */
const CURRENT_MARKET = /(marketplace|插件市场|市场)[^\n]{0,120}(currently|当前)[^\n]{0,60}\d+\.\d+\.\d+/iu
for (const file of FILES) {
  const lines = readFileSync(resolve(root, file), 'utf8').split('\n')
  let npmInstalls = 0
  for (const [index, line] of lines.entries()) {
    if (CURRENT_MARKET.test(line)) {
      failures.push(`${file}:${index + 1}: do not assert a marketplace/Desktop current version; state the refresh policy`)
    }
    if (!/\bdsh\s+plugin\b/.test(line) || !/\badd\b/.test(line)) continue
    const addIndex = line.search(/\badd\b/)
    const spec = line.slice(addIndex + 3).trim().split(/\s+/)[0]?.replace(/[`'"]+$/u, '') ?? ''
    if (!spec.startsWith(PACKAGE)) continue // github:, link:, file:, tarball paths
    npmInstalls += 1
    if (spec === PACKAGE) {
      failures.push(`${file}:${index + 1}: bare ${PACKAGE}; pin ${PINNED} (pnpm 11/12 delays bare latest by 24h)`)
    } else if (spec !== PINNED) {
      failures.push(`${file}:${index + 1}: ${spec} does not match package.json ${PINNED}`)
    }
  }
  if (npmInstalls === 0) failures.push(`${file}: no ${PACKAGE} npm install command found`)
}

if (failures.length > 0) {
  console.error('docs-install: documented installs/market claims need review')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log(`docs-install: ok (${PINNED} in ${FILES.length} docs)`)
}
