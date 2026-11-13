#!/usr/bin/env node
/**
 * Packaged-manifest fact guard.
 *
 * `npm run check` builds `lib/` first, then this script packs the checkout with
 * `npm pack --dry-run --json --ignore-scripts` (no second `prepare` build) and
 * compares the packed file count and `unpackedSize` with
 * `docs/current-facts.json`.
 *
 * `unpackedSize` is the sum of the shipped file sizes, so it is independent of
 * the npm/tar/gzip versions (unlike the compressed tarball size) while still
 * catching README text edits that change the shipped bytes, plus added/removed
 * packaged files. It is the guard for the "docs changes are packed" gap: the CI
 * docs-only fast path excludes the README pair for the same reason.
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
if (packed.unpackedSize !== facts.unpackedBytes) {
  failures.push(`packed unpackedSize ${packed.unpackedSize} != docs/current-facts.json unpackedBytes ${facts.unpackedBytes}`)
}

if (failures.length > 0) {
  console.error('pack-facts: shipped manifest drifted from docs/current-facts.json')
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('  run `npm run build && npm run pack:check`, update docs/current-facts.json and the docs that quote the gate')
  process.exitCode = 1
} else {
  console.log(`pack-facts: ok (${packed.files.length} files; unpacked ${packed.unpackedSize} bytes)`)
}
