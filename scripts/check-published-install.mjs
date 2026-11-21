#!/usr/bin/env node
/**
 * Post-publish check: the published tarball's own docs pin the version, and the
 * documented pinned install command installs that version into a throwaway
 * DSH home.
 *
 * Run after the publish workflow has verified the registry and the version is
 * visible, before announcing the release:
 *
 *   npm run check:published-install
 *
 * Downloading the published tarball (rather than reading the checkout) is
 * deliberate: the tagged artifact is what users install, and a post-tag docs
 * commit cannot repair it. The scan covers the packed README pair and the
 * shipped Agent Skill integration reference; the install itself uses the pin
 * found there. It never reads or writes the user's profiles.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const version = pkg.version
const PACKAGE = '@zephinel/dsh-intelligent-ui'
const PINNED = `${PACKAGE}@${version}`
const profile = 'published-install-check'
const dsh = process.env.DSH_BIN ?? (process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
const home = mkdtempSync(join(tmpdir(), 'iui-published-install-'))
let staleDocs = false

/** Docs packed into the npm tarball that show an install command. */
const PACKED_DOCS = ['README.md', 'README.en.md', 'skills/intelligent-ui/references/integration.md']

/** Find install specs in one packaged doc; return failures and pinned specs. */
function scanDoc(read, rel, failures, pinnedSpecs) {
  let text
  try {
    text = read(rel)
  } catch {
    failures.push(`${rel}: missing from the published tarball`)
    return
  }
  let found = false
  for (const [index, line] of text.split('\n').entries()) {
    if (!/\bdsh\s+plugin\b/.test(line) || !/\badd\b/.test(line)) continue
    const addIndex = line.search(/\badd\b/)
    const spec = line.slice(addIndex + 3).trim().split(/\s+/)[0]?.replace(/[`'"]+$/u, '') ?? ''
    if (!spec.startsWith(PACKAGE)) continue // github:, link:, file:, tarball paths
    found = true
    if (spec === PACKAGE) {
      failures.push(`${rel}:${index + 1}: bare ${PACKAGE}; the published docs must pin ${PINNED}`)
    } else if (spec !== PINNED) {
      failures.push(`${rel}:${index + 1}: ${spec} does not match package.json ${PINNED}`)
    } else {
      pinnedSpecs.push(spec)
    }
  }
  if (!found) failures.push(`${rel}: no ${PACKAGE} npm install command found`)
}

try {
  const packDir = join(home, 'pack')
  mkdirSync(packDir, { recursive: true })
  const packOutput = execFileSync(
    'npm',
    ['pack', `${PACKAGE}@${version}`, '--pack-destination', packDir, '--ignore-scripts', '--json'],
    { encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const packed = JSON.parse(packOutput.slice(packOutput.indexOf('[')))[0]
  const tarball = join(packDir, packed.filename)
  const extractDir = join(home, 'extract')
  mkdirSync(extractDir, { recursive: true })
  execFileSync('tar', ['-xzf', tarball, '-C', extractDir], { timeout: 120_000 })

  const packageRoot = join(extractDir, 'package')
  const publishedPkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (publishedPkg.version !== version) {
    throw new Error(`registry tarball is ${publishedPkg.version}, expected ${version}`)
  }

  const failures = []
  const pinnedSpecs = []
  for (const rel of PACKED_DOCS) {
    scanDoc((path) => readFileSync(join(packageRoot, path), 'utf8'), rel, failures, pinnedSpecs)
  }
  if (failures.length > 0) {
    console.error(`published-install: the published ${version} tarball has stale docs`)
    for (const failure of failures) console.error(`  - ${failure}`)
    console.error('  the tag/tarball is immutable; fix the docs and publish a new version')
    staleDocs = true
  } else {
    if (pinnedSpecs.length === 0) throw new Error(`no pinned ${PACKAGE} install command found in the published docs`)
    const spec = pinnedSpecs[0]
    const output = execFileSync(
      dsh,
      ['plugin', '--profile', profile, 'add', spec],
      {
        env: { ...process.env, DSH_HOME: home },
        encoding: 'utf8',
        timeout: 300_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const installed = JSON.parse(readFileSync(
      join(home, 'profiles', profile, 'node_modules', ...PACKAGE.split('/'), 'package.json'),
      'utf8',
    ))
    if (installed.version !== version) {
      throw new Error(`installed ${installed.version}, expected ${version}`)
    }
    if (/\bpnpm was not found\b/u.test(output)) {
      throw new Error('dsh reported that pnpm is missing from PATH')
    }
    console.log(`published-install: ok (${spec} from the published docs installed into a throwaway DSH_HOME)`)
  }
} catch (error) {
  console.error(`published-install: ${PINNED} could not be verified`)
  if (error?.stderr) console.error(String(error.stderr).trim())
  if (error?.stdout) console.error(String(error.stdout).trim())
  console.error(String(error?.message ?? error))
  console.error('  registry propagation or pnpm/network setup may need a retry; do not announce until this passes')
  process.exitCode = 1
} finally {
  rmSync(home, { recursive: true, force: true })
}
if (staleDocs) process.exitCode = 1
