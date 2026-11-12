#!/usr/bin/env node
/**
 * Release check: pack the plugin, install the tarball into a throwaway DSH
 * profile, and verify what actually ships — the bundled Agent Skill, the
 * mounted loader row, the served client bundle and clean uninstall.
 *
 * Why this exists: `npm run check` never leaves the source tree, so it cannot
 * catch a package that ships a stale or missing `skills/` (the checkout had the
 * new skill, the installed profile kept the old one), a bundle that fails to
 * mount from its packed form, or a client bundle the running host does not
 * actually serve. Every step here reads the packed/installed artifact, not the
 * checkout, except where the checkout is the expected source of truth.
 *
 * Requirements: `dsh` on PATH (override with DSH_BIN) and pnpm available to it.
 * This script starts its own isolated DSH Web instance on 127.0.0.1 with an
 * OS-assigned port; it never touches the user's profiles or running service.
 *
 * Usage:
 *   node scripts/release-check.mjs           # run the full check, then clean up
 *   node scripts/release-check.mjs --keep    # keep the temp pack dir and DSH_HOME
 */

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshBin = process.env.DSH_BIN ?? 'dsh'
const keepArtifacts = process.argv.includes('--keep')
const PACKAGE_NAME = '@zephinel/dsh-intelligent-ui'
const PROFILE = 'web'

/** Files the tarball must ship. The skill and its references are the part a packaging change drops first. */
const REQUIRED_PACK_FILES = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/client.js',
  'lib/standalone.js',
  'lib/standalone.css',
  'locale/en.json',
  'locale/zh.json',
  'skills/intelligent-ui/SKILL.md',
]
/** Number of reference files shipped beside SKILL.md. */
const REQUIRED_SKILL_REFERENCES = 5
/** Current decision-policy wording that must be present in the shipped skill. */
const CURRENT_SKILL_MARKERS = [
  'the model decides the format per answer',
  'applies it rather than restating it',
  'Draw the mechanism',
  '## Document mode (experimental)',
]
/** Wording removed by the Auto-format-decision change; presence means a stale skill ships. */
const STALE_SKILL_MARKERS = [
  'a page is the default answer format',
  'prose is the bounded exception',
  'Answer in Markdown only when the whole answer is',
  'a definition or concise explanation',
  'Render a page when the answer gains from structure',
]
/** Repo-only directories that must never reach the tarball. */
const FORBIDDEN_PACK_PREFIXES = ['test/', 'src/', 'vendor/', '.agents/', '.git/']

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

/** Run one child process and return its captured output. */
async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, { maxBuffer: 64 * 1024 * 1024, ...options })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`\`${command}\` is not available: install the DSH CLI (or set DSH_BIN) before running the release check`)
    }
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : ''
    throw new Error(
      `\`${command} ${args.join(' ')}\` failed (exit ${error?.code ?? '?'})`
      + (stderr === '' ? '' : `\n--- stderr ---\n${stderr.slice(-4000)}`)
      + (stdout === '' ? '' : `\n--- stdout ---\n${stdout.slice(-2000)}`),
    )
  }
}

/** Print a check line that passes. */
function pass(message) {
  console.log(`  ok  ${message}`)
}

/** Fail with a message tied to the current check. */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/** Stable content hash for staged/installed file comparisons. */
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Whether a path exists. */
async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Parse `npm pack --json` stdout, which prefixes the JSON with build log lines. */
async function pack(packDir) {
  const { stdout } = await run('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: root })
  const start = stdout.lastIndexOf('\n[') >= 0 ? stdout.lastIndexOf('\n[') + 1 : stdout.indexOf('[')
  assert(start >= 0, 'npm pack --json printed no JSON')
  const [entry] = JSON.parse(stdout.slice(start))
  assert(entry !== undefined && Array.isArray(entry.files), 'npm pack --json returned no file list')
  return entry
}

/** Wait for the `dsh web` startup URL. */
async function waitForUrl(child, output, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/.exec(output())
    if (match !== null) return match[1]
    if (child.exitCode !== null) throw new Error(`dsh web exited (${child.exitCode}) before printing a URL`)
    await sleep(200)
  }
  throw new Error('timed out waiting for the dsh web startup URL')
}

/** Wait for the server to accept the token URL. */
async function waitForTokenResponse(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      return response
    } catch (error) {
      lastError = error
      await sleep(250)
    }
  }
  throw new Error(`dsh web did not accept the token URL: ${lastError?.message ?? 'timeout'}`)
}

/** Stop the isolated server. */
async function stopServer(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const deadline = Date.now() + 10_000
  while (child.exitCode === null && Date.now() < deadline) await sleep(100)
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function main() {
  const workDir = await mkdtemp(join(tmpdir(), 'dsh-iui-release-check-'))
  const packDir = join(workDir, 'pack')
  const packedHome = join(workDir, 'dsh-home')
  const env = { ...process.env, DSH_HOME: packedHome }
  let server
  let serverOutput = ''

  try {
    console.log(`release-check: ${PACKAGE_NAME}`)

    console.log('- pack')
    await mkdir(packDir, { recursive: true })
    const entry = await pack(packDir)
    const files = new Map(entry.files.map((file) => [file.path, file.size]))
    for (const required of REQUIRED_PACK_FILES) {
      assert(files.has(required), `tarball is missing ${required}`)
    }
    const shippedReferences = entry.files.filter((file) => /^skills\/intelligent-ui\/references\/.+\.md$/.test(file.path))
    assert(
      shippedReferences.length >= REQUIRED_SKILL_REFERENCES,
      `tarball ships ${shippedReferences.length} skill references, expected ${REQUIRED_SKILL_REFERENCES}`,
    )
    for (const prefix of FORBIDDEN_PACK_PREFIXES) {
      assert(!entry.files.some((file) => file.path.startsWith(prefix)), `tarball leaks repo-only path ${prefix}*`)
    }
    const tarball = join(packDir, entry.filename)
    assert(await exists(tarball), `npm pack did not create ${tarball}`)
    pass(`${entry.entryCount} files, ${files.get('skills/intelligent-ui/SKILL.md')} B skill, ${Math.round(entry.size / 1024)} kB tarball`)

    console.log('- packed skill matches the current decision policy')
    const checkoutSkill = await readFile(join(root, 'skills/intelligent-ui/SKILL.md'), 'utf8')
    for (const marker of CURRENT_SKILL_MARKERS) {
      assert(checkoutSkill.includes(marker), `skills/intelligent-ui/SKILL.md is missing: ${marker}`)
    }
    for (const marker of STALE_SKILL_MARKERS) {
      assert(!checkoutSkill.includes(marker), `skills/intelligent-ui/SKILL.md still contains stale wording: ${marker}`)
    }
    pass('skill carries the Auto page-vs-text decision and document mode')

    console.log('- initialize a throwaway DSH profile')
    await run(dshBin, ['--profile', PROFILE, '--dump-config'], { env })
    const profileManifest = join(packedHome, 'profiles', PROFILE, 'package.json')
    const initialManifest = JSON.parse(await readFile(profileManifest, 'utf8'))
    assert(
      initialManifest.dsh?.profile?.bundles?.includes('@deepseek-ai/dsh-web-app') === true,
      'the throwaway profile is not the shipped web template',
    )
    pass(`fresh $DSH_HOME at ${packedHome}`)

    console.log('- install the tarball')
    await run(dshBin, ['plugin', '--profile', PROFILE, 'add', tarball], { env })
    const installedManifest = JSON.parse(await readFile(profileManifest, 'utf8'))
    assert(installedManifest.dependencies?.[PACKAGE_NAME] !== undefined, 'profile dependency missing after install')
    assert(
      installedManifest.dsh?.profile?.bundles?.includes(PACKAGE_NAME) === true,
      'profile bundles missing after install',
    )
    const installedDir = join(packedHome, 'profiles', PROFILE, 'node_modules', ...PACKAGE_NAME.split('/'))
    assert(await exists(installedDir), `installed package missing at ${installedDir}`)
    pass('dependency + bundle row recorded')

    console.log('- installed files match the checkout')
    for (const relative of ['lib/index.js', 'lib/client.js', 'skills/intelligent-ui/SKILL.md']) {
      const [installed, source] = await Promise.all([
        readFile(join(installedDir, relative)),
        readFile(join(root, relative)),
      ])
      assert(sha256(installed) === sha256(source), `installed ${relative} differs from the checkout (stale or wrong file packaged)`)
    }
    const installedReferences = (await readdir(join(installedDir, 'skills/intelligent-ui/references'))).filter((name) => name.endsWith('.md'))
    assert(
      installedReferences.length >= REQUIRED_SKILL_REFERENCES,
      `installed skill ships ${installedReferences.length} references, expected ${REQUIRED_SKILL_REFERENCES}`,
    )
    const installedSkill = await readFile(join(installedDir, 'skills/intelligent-ui/SKILL.md'), 'utf8')
    for (const marker of CURRENT_SKILL_MARKERS) {
      assert(installedSkill.includes(marker), `installed SKILL.md is missing: ${marker}`)
    }
    pass('lib, client bundle and skill hashes equal the checkout')

    console.log('- composed profile mounts the row')
    const composed = await run(dshBin, ['--profile', PROFILE, '--dump-config'], { env })
    assert(composed.stdout.includes(`# == ${PACKAGE_NAME}`), 'composed tree has no bundle marker for the plugin')
    assert(
      /id: intelligent-ui\n\s+name: '@zephinel\/dsh-intelligent-ui'/.test(composed.stdout),
      'composed tree has no intelligent-ui row',
    )
    pass('loader row present in the composed tree')

    console.log('- boot an isolated web instance')
    server = spawn(dshBin, ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const append = (chunk) => { serverOutput += chunk }
    server.stdout.setEncoding('utf8')
    server.stderr.setEncoding('utf8')
    server.stdout.on('data', append)
    server.stderr.on('data', append)
    const tokenUrl = await waitForUrl(server, () => serverOutput)
    pass(`dsh web on ${new URL(tokenUrl).origin}`)

    console.log('- boot graph lists the client module')
    const tokenResponse = await waitForTokenResponse(tokenUrl)
    assert(tokenResponse.status === 303, `token URL returned ${tokenResponse.status}, expected the pairing redirect`)
    const setCookies = typeof tokenResponse.headers.getSetCookie === 'function'
      ? tokenResponse.headers.getSetCookie()
      : [tokenResponse.headers.get('set-cookie') ?? '']
    const cookie = setCookies.filter(Boolean).map((value) => value.split(';')[0]).join('; ')
    assert(cookie !== '', 'token URL did not set a session cookie')
    const pageResponse = await fetch(new URL('/', tokenUrl), { headers: { cookie } })
    assert(pageResponse.status === 200, `boot page returned ${pageResponse.status}`)
    const page = await pageResponse.text()
    assert(page.includes(`"${PACKAGE_NAME}"`), 'boot graph does not list the plugin package')
    const moduleMatch = /"url":"(plugins\/\?\?[^"]*dsh-intelligent-ui\/client\.js[^"]*)"/.exec(page)
    assert(moduleMatch !== null, 'boot graph has no client bundle URL for the plugin')
    pass('client bundle URL registered')

    console.log('- served bundle is the installed package file')
    const bundleResponse = await fetch(new URL(moduleMatch[1], tokenUrl), { headers: { cookie } })
    assert(bundleResponse.status === 200, `client bundle returned ${bundleResponse.status}`)
    const servedBundle = await bundleResponse.text()
    const installedClient = await readFile(join(installedDir, 'lib/client.js'), 'utf8')
    assert(servedBundle.startsWith(installedClient), 'served client bundle does not start with the installed lib/client.js')
    const trailer = servedBundle.slice(installedClient.length)
    assert(trailer.length < 2048 && trailer.includes('sourceMappingURL'), 'served client bundle has an unexpected trailer')
    pass(`${installedClient.length} B, only the source-map trailer differs`)

    console.log('- host registered the embedded skill')
    assert(!serverOutput.includes('embedded skill not registered'), `plugin reported a skill registration failure:\n${serverOutput.slice(-2000)}`)
    pass('no embedded-skill registration warning')

    await stopServer(server)
    server = undefined

    console.log('- uninstall')
    await run(dshBin, ['plugin', '--profile', PROFILE, 'remove', PACKAGE_NAME], { env })
    const removedManifest = JSON.parse(await readFile(profileManifest, 'utf8'))
    assert(removedManifest.dependencies?.[PACKAGE_NAME] === undefined, 'profile dependency survived uninstall')
    assert(
      removedManifest.dsh?.profile?.bundles?.includes(PACKAGE_NAME) !== true,
      'profile bundles entry survived uninstall',
    )
    const afterRemove = await run(dshBin, ['--profile', PROFILE, '--dump-config'], { env })
    assert(!afterRemove.stdout.includes('id: intelligent-ui'), 'loader row survived uninstall')
    assert(!(await exists(installedDir)), 'installed package directory survived uninstall')
    pass('dependency, bundle row and package removed')

    console.log('')
    console.log(`release-check: PASS (${entry.entryCount} packaged files)`)
  } catch (error) {
    console.error('')
    console.error(`release-check: FAIL — ${error instanceof Error ? error.message : String(error)}`)
    if (server !== undefined) {
      await stopServer(server)
      server = undefined
    }
    if (serverOutput.trim() !== '') console.error(`--- isolated dsh web output (tail) ---\n${serverOutput.slice(-4000)}`)
    console.error(`artifacts kept at ${workDir}`)
    process.exitCode = 1
    return
  } finally {
    if (server !== undefined) await stopServer(server)
    if (keepArtifacts) {
      console.log(`artifacts kept at ${workDir}`)
    } else {
      await rm(workDir, { recursive: true, force: true })
    }
  }
}

await main()
