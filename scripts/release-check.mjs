#!/usr/bin/env node
/**
 * Release check: pack the plugin, install the tarball into a throwaway DSH
 * profile, and verify that what ships is byte-for-byte what the checkout built —
 * the complete packed file set, the installed copy, the mounted loader row, the
 * served client bundle and clean uninstall.
 *
 * Why this exists: `npm run check` never leaves the source tree, so it cannot
 * catch a package that ships a stale or missing file — classically a rebuilt
 * `lib/` reaching a local profile while `skills/` stayed old. The guarantees
 * here are artifact-level, not sample-level: the tarball's full manifest is
 * extracted and compared against both the checkout and the installed package.
 *
 * Requirements: `dsh` and `pnpm` on PATH (override dsh with DSH_BIN). `npm pack`
 * runs the repository's `prepare` build, which rewrites the ignored `lib/`, the
 * same way a publish would. The script never reads or writes the user's DSH
 * profiles: it uses a throwaway `$DSH_HOME` and an isolated Web instance on
 * 127.0.0.1 with an OS-assigned port.
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

import { CURRENT_SKILL_MARKERS, RETIRED_SKILL_MARKERS } from './skill-policy-markers.mjs'

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
  'locale/detail.zh.md',
  'locale/detail.en.md',
  'skills/intelligent-ui/SKILL.md',
]
/** Number of reference files shipped beside SKILL.md. */
const REQUIRED_SKILL_REFERENCES = 5
/** Directories whose packed files must hash-match the checkout. */
const COMPARED_PACK_PREFIXES = ['lib/', 'skills/', 'locale/']
/** Other packed files whose content the checkout owns. */
const COMPARED_PACK_FILES = ['cordis.patch.yml']
/** Repo-only directories that must never reach the tarball. */
const FORBIDDEN_PACK_PREFIXES = ['test/', 'src/', 'vendor/', '.agents/', '.git/']

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

/** Run one child process and return its captured output; every command has a deadline. */
async function run(command, args, options = {}) {
  const { timeout = 300_000, ...rest } = options
  try {
    return await execFileAsync(command, args, {
      maxBuffer: 64 * 1024 * 1024,
      timeout,
      killSignal: 'SIGKILL',
      ...rest,
    })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`\`${command}\` is not available: install the DSH CLI and pnpm (or set DSH_BIN) before running the release check`)
    }
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : ''
    const reason = error?.killed === true ? `timed out after ${timeout}ms` : `exit ${error?.code ?? '?'}`
    throw new Error(
      `\`${command} ${args.join(' ')}\` failed (${reason})`
      + (stderr === '' ? '' : `\n--- stderr ---\n${stderr.slice(-4000)}`)
      + (stdout === '' ? '' : `\n--- stdout ---\n${stdout.slice(-2000)}`),
    )
  }
}

/** Print a check line that passes. */
function pass(message) {
  console.log(`  ok  ${message}`)
}

/** Fail the check when a condition does not hold. */
function ensure(condition, message) {
  if (!condition) throw new Error(message)
}

/** Stable content hash for artifact comparisons. */
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

/** List every regular file under a directory, as `/`-joined relative paths. */
async function walkFiles(directory, base = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = base === '' ? entry.name : `${base}/${entry.name}`
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walkFiles(absolute, relative))
    else if (entry.isFile()) files.push({ path: relative, absolute })
  }
  return files
}

/** Manifest of one artifact: every file's size and content hash. */
async function hashTree(directory) {
  const manifest = new Map()
  for (const file of await walkFiles(directory)) {
    const content = await readFile(file.absolute)
    manifest.set(file.path, { size: content.byteLength, hash: sha256(content) })
  }
  return manifest
}

/** Remove the pairing token from captured logs before printing them. */
function sanitize(text) {
  return text.replace(/token=[^\s"&]+/g, 'token=…')
}

/** Parse `npm pack --json` stdout, which prefixes the JSON with build log lines. */
async function pack(packDir) {
  const { stdout } = await run('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: root, timeout: 600_000 })
  const start = stdout.lastIndexOf('\n[') >= 0 ? stdout.lastIndexOf('\n[') + 1 : stdout.indexOf('[')
  ensure(start >= 0, 'npm pack --json printed no JSON')
  const [entry] = JSON.parse(stdout.slice(start))
  ensure(entry !== undefined && Array.isArray(entry.files), 'npm pack --json returned no file list')
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

/** Wait until the server answers the token URL with the pairing redirect. */
async function waitForTokenResponse(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let lastStatus
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      if (response.status === 303) return response
      lastStatus = response.status
      await response.body?.cancel().catch(() => {})
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error)
    }
    await sleep(250)
  }
  throw new Error(`dsh web did not settle on the token pairing redirect (last: ${lastStatus ?? 'timeout'})`)
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
  const extractDir = join(workDir, 'packed')
  const packedHome = join(workDir, 'dsh-home')
  const env = { ...process.env, DSH_HOME: packedHome }
  let server
  let serverOutput = ''
  let failed = false

  try {
    console.log(`release-check: ${PACKAGE_NAME}`)

    console.log('- pack')
    await mkdir(packDir, { recursive: true })
    const entry = await pack(packDir)
    const packed = new Map(entry.files.map((file) => [file.path, file.size]))
    for (const required of REQUIRED_PACK_FILES) {
      ensure(packed.has(required), `tarball is missing ${required}`)
    }
    for (const prefix of FORBIDDEN_PACK_PREFIXES) {
      ensure(!entry.files.some((file) => file.path.startsWith(prefix)), `tarball leaks repo-only path ${prefix}*`)
    }
    const tarball = join(packDir, entry.filename)
    ensure(await exists(tarball), `npm pack did not create ${tarball}`)
    pass(`${entry.entryCount} files, ${Math.round(entry.size / 1024)} kB tarball`)

    console.log('- extract the tarball manifest')
    await mkdir(extractDir, { recursive: true })
    await run('tar', ['-xzf', tarball, '-C', extractDir], { timeout: 60_000 })
    const packedRoot = join(extractDir, 'package')
    ensure(await exists(packedRoot), 'the tarball has no package/ root')
    const packedFiles = await hashTree(packedRoot)
    ensure(
      packedFiles.size === entry.files.length,
      `extracted ${packedFiles.size} files but npm listed ${entry.files.length}`,
    )
    for (const [path, size] of packed) {
      const extracted = packedFiles.get(path)
      ensure(extracted !== undefined, `npm listed ${path} but the tarball has no such file`)
      ensure(extracted.size === size, `${path}: npm listed ${size} B but the tarball holds ${extracted.size} B`)
    }
    const shippedReferences = [...packedFiles.keys()].filter((path) => /^skills\/intelligent-ui\/references\/.+\.md$/.test(path))
    ensure(
      shippedReferences.length >= REQUIRED_SKILL_REFERENCES,
      `tarball ships ${shippedReferences.length} skill references, expected ${REQUIRED_SKILL_REFERENCES}`,
    )
    pass(`${packedFiles.size} files extracted; ${shippedReferences.length} skill references`)

    console.log('- the packed skill matches the current decision policy')
    const packedSkill = await readFile(join(packedRoot, 'skills/intelligent-ui/SKILL.md'), 'utf8')
    for (const marker of CURRENT_SKILL_MARKERS) {
      ensure(packedSkill.includes(marker), `packed SKILL.md is missing: ${marker}`)
    }
    for (const marker of RETIRED_SKILL_MARKERS) {
      ensure(!packedSkill.includes(marker), `packed SKILL.md still contains retired wording: ${marker}`)
    }
    pass('skill carries the current page-vs-text policy and no retired wording')

    console.log('- every packed file matches the checkout')
    for (const [path, file] of packedFiles) {
      const source = join(root, path)
      ensure(await exists(source), `packed ${path} does not exist in the checkout`)
      const compared = COMPARED_PACK_FILES.includes(path)
        || COMPARED_PACK_PREFIXES.some((prefix) => path.startsWith(prefix))
      if (!compared) continue
      const sourceHash = sha256(await readFile(source))
      ensure(sourceHash === file.hash, `packed ${path} differs from the checkout (stale or transformed package file)`)
    }
    pass('all packed paths exist in the checkout; lib/, skills/, locale/ and the bundle patch hash-match it')

    console.log('- initialize a throwaway DSH profile')
    await run(dshBin, ['--profile', PROFILE, '--dump-config'], { env, timeout: 120_000 })
    const profileManifest = join(packedHome, 'profiles', PROFILE, 'package.json')
    const initialManifest = JSON.parse(await readFile(profileManifest, 'utf8'))
    ensure(
      initialManifest.dsh?.profile?.bundles?.includes('@deepseek-ai/dsh-web-app') === true,
      'the throwaway profile is not the shipped web template',
    )
    pass(`fresh $DSH_HOME at ${packedHome}`)

    console.log('- install the tarball')
    await run(dshBin, ['plugin', '--profile', PROFILE, 'add', tarball], { env, timeout: 180_000 })
    const installedManifest = JSON.parse(await readFile(profileManifest, 'utf8'))
    ensure(installedManifest.dependencies?.[PACKAGE_NAME] !== undefined, 'profile dependency missing after install')
    ensure(
      installedManifest.dsh?.profile?.bundles?.includes(PACKAGE_NAME) === true,
      'profile bundles missing after install',
    )
    const installedDir = join(packedHome, 'profiles', PROFILE, 'node_modules', ...PACKAGE_NAME.split('/'))
    ensure(await exists(installedDir), `installed package missing at ${installedDir}`)
    pass('dependency + bundle row recorded')

    console.log('- the installed package is the packed artifact')
    const installedFiles = await hashTree(installedDir)
    const missing = [...packedFiles.keys()].filter((path) => !installedFiles.has(path))
    const extra = [...installedFiles.keys()].filter((path) => !packedFiles.has(path))
    ensure(missing.length === 0, `installed package is missing packed files: ${missing.slice(0, 5).join(', ')}`)
    ensure(extra.length === 0, `installed package has files the tarball does not: ${extra.slice(0, 5).join(', ')}`)
    const mismatched = [...packedFiles.entries()]
      .filter(([path, file]) => installedFiles.get(path).hash !== file.hash)
      .map(([path]) => path)
    ensure(mismatched.length === 0, `installed files differ from the tarball: ${mismatched.slice(0, 5).join(', ')}`)
    const installedSkill = await readFile(join(installedDir, 'skills/intelligent-ui/SKILL.md'), 'utf8')
    for (const marker of CURRENT_SKILL_MARKERS) {
      ensure(installedSkill.includes(marker), `installed SKILL.md is missing: ${marker}`)
    }
    pass(`${packedFiles.size} installed files are byte-identical to the tarball`)

    console.log('- composed profile mounts the row')
    const composed = await run(dshBin, ['--profile', PROFILE, '--dump-config'], { env, timeout: 120_000 })
    ensure(composed.stdout.includes(`# == ${PACKAGE_NAME}`), 'composed tree has no bundle marker for the plugin')
    ensure(
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
    const setCookies = typeof tokenResponse.headers.getSetCookie === 'function'
      ? tokenResponse.headers.getSetCookie()
      : [tokenResponse.headers.get('set-cookie') ?? '']
    const cookie = setCookies.filter(Boolean).map((value) => value.split(';')[0]).join('; ')
    ensure(cookie !== '', 'token URL did not set a session cookie')
    const pageResponse = await fetch(new URL('/', tokenUrl), { headers: { cookie } })
    ensure(pageResponse.status === 200, `boot page returned ${pageResponse.status}`)
    const page = await pageResponse.text()
    ensure(page.includes(`"${PACKAGE_NAME}"`), 'boot graph does not list the plugin package')
    const moduleMatch = /"url":"(plugins\/\?\?[^"]*dsh-intelligent-ui\/client\.js[^"]*)"/.exec(page)
    ensure(moduleMatch !== null, 'boot graph has no client bundle URL for the plugin')
    pass('client bundle URL registered')

    console.log('- served bundle is the installed package file')
    const bundleResponse = await fetch(new URL(moduleMatch[1], tokenUrl), { headers: { cookie } })
    ensure(bundleResponse.status === 200, `client bundle returned ${bundleResponse.status}`)
    const servedBundle = await bundleResponse.text()
    const installedClient = await readFile(join(installedDir, 'lib/client.js'), 'utf8')
    ensure(servedBundle.startsWith(installedClient), 'served client bundle does not start with the installed lib/client.js')
    const trailer = servedBundle.slice(installedClient.length)
    ensure(trailer.length < 2048 && trailer.includes('sourceMappingURL'), 'served client bundle has an unexpected trailer')
    pass(`${installedClient.length} B, only the source-map trailer differs`)

    console.log('- host registered the embedded skill')
    ensure(!serverOutput.includes('embedded skill not registered'), `plugin reported a skill registration failure:\n${sanitize(serverOutput).slice(-2000)}`)
    pass('no embedded-skill registration warning')

    await stopServer(server)
    server = undefined

    console.log('- uninstall')
    await run(dshBin, ['plugin', '--profile', PROFILE, 'remove', PACKAGE_NAME], { env, timeout: 180_000 })
    const removedManifest = JSON.parse(await readFile(profileManifest, 'utf8'))
    ensure(removedManifest.dependencies?.[PACKAGE_NAME] === undefined, 'profile dependency survived uninstall')
    ensure(
      removedManifest.dsh?.profile?.bundles?.includes(PACKAGE_NAME) !== true,
      'profile bundles entry survived uninstall',
    )
    const afterRemove = await run(dshBin, ['--profile', PROFILE, '--dump-config'], { env, timeout: 120_000 })
    ensure(!afterRemove.stdout.includes('id: intelligent-ui'), 'loader row survived uninstall')
    ensure(!(await exists(installedDir)), 'installed package directory survived uninstall')
    pass('dependency, bundle row and package removed')

    console.log('')
    console.log(`release-check: PASS (${packedFiles.size} packaged files verified)`)
  } catch (error) {
    failed = true
    console.error('')
    console.error(`release-check: FAIL — ${error instanceof Error ? error.message : String(error)}`)
    if (server !== undefined) {
      await stopServer(server)
      server = undefined
    }
    if (serverOutput.trim() !== '') console.error(`--- isolated dsh web output (tail) ---\n${sanitize(serverOutput).slice(-4000)}`)
    console.error(`artifacts kept at ${workDir}`)
    process.exitCode = 1
  } finally {
    if (server !== undefined) await stopServer(server)
    if (!failed && !keepArtifacts) await rm(workDir, { recursive: true, force: true })
    else if (!failed && keepArtifacts) console.log(`artifacts kept at ${workDir}`)
  }
}

await main()
