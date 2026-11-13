#!/usr/bin/env node
/**
 * Packaged-manifest fact guard.
 *
 * `npm run check` builds `lib/` first, then this script packs the checkout with
 * `npm pack --dry-run --json --ignore-scripts` (no second `prepare` build) and
 * compares the packed file count and `unpackedSize` with
 * `docs/current-facts.json`.
 *
 * The guard compares the packed file count and the sum of the NON-build files
 * (everything outside `lib/`) with `docs/current-facts.json`. The non-build sum
 * is independent of npm/tar/gzip versions and of the host platform's esbuild
 * output (the Linux runner's `lib/` bytes differ from macOS by a few KB), while
 * still catching README text edits and added/removed packed files. It is the
 * guard for the "docs changes are packed" gap: the CI docs-only fast path
 * excludes the README pair for the same reason.
 *
 *   npm run build
 *   node scripts/check-pack-facts.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

let output
try {
  output = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  console.error('pack-facts: npm pack failed')
  console.error(String(error.stderr ?? error.message))
  process.exitCode = 1
  process.exit()
}

const start = output.indexOf('[')
if (start === -1) {
  console.error('pack-facts: npm pack printed no JSON manifest')
  process.exit(1)
}
let packed
try {
  packed = JSON.parse(output.slice(start))[0]
} catch (error) {
  console.error(`pack-facts: cannot parse npm pack JSON: ${String(error)}`)
  process.exit(1)
}

const facts = JSON.parse(readFileSync(resolve(root, 'docs/current-facts.json'), 'utf8'))
const failures = []
if (packed.files.length !== facts.packFiles) {
  failures.push(`packed files ${packed.files.length} != docs/current-facts.json packFiles ${facts.packFiles}`)
}
const nonBuildFiles = packed.files.filter((file) => !file.path.startsWith('lib/'))
const nonBuildBytes = nonBuildFiles.reduce((sum, file) => sum + file.size, 0)
if (nonBuildBytes !== facts.nonBuildUnpackedBytes) {
  failures.push(`non-build packed bytes ${nonBuildBytes} != docs/current-facts.json nonBuildUnpackedBytes ${facts.nonBuildUnpackedBytes}`)
}

if (failures.length > 0) {
  console.error('pack-facts: shipped manifest drifted from docs/current-facts.json')
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('  run `npm run build && npm run pack:check`, update docs/current-facts.json and the docs that quote the gate')
  process.exitCode = 1
} else {
  console.log(
    `pack-facts: ok (${packed.files.length} files; non-build unpacked ${nonBuildBytes} bytes; total unpacked ${packed.unpackedSize})`,
  )
}
