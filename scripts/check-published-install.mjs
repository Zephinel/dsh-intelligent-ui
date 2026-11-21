#!/usr/bin/env node
/**
 * Post-publish check: the documented pinned install command installs the
 * just-published version into a throwaway DSH home.
 *
 * Run after the publish workflow has verified the registry and the version is
 * visible, before announcing the release:
 *
 *   npm run check:published-install
 *
 * It creates a temporary `$DSH_HOME` and never reads or writes the user's
 * profiles. `check:docs-install` keeps the docs pinned; this script proves the
 * pinned command actually resolves and installs.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const version = pkg.version
const PACKAGE = '@zephinel/dsh-intelligent-ui'
const spec = `${PACKAGE}@${version}`
const profile = 'published-install-check'
const dsh = process.env.DSH_BIN ?? (process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
const home = mkdtempSync(join(tmpdir(), 'iui-published-install-'))

try {
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
  console.log(`published-install: ok (${spec} installed into a throwaway DSH_HOME)`)
} catch (error) {
  console.error(`published-install: ${spec} could not be installed`)
  if (error?.stderr) console.error(String(error.stderr).trim())
  if (error?.stdout) console.error(String(error.stdout).trim())
  console.error(String(error?.message ?? error))
  console.error('  registry propagation or pnpm/network setup may need a retry; docs must keep the pinned version')
  process.exitCode = 1
} finally {
  rmSync(home, { recursive: true, force: true })
}
