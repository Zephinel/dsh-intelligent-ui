/**
 * The local checkout installer edits a profile's `cordis.patch.yml` by text.
 * The shipped template writes that patch as the YAML empty-array document
 * `[]`, so appending a list item after it used to produce a second YAML
 * document and DSH refused to parse the profile. These tests pin the document
 * forms the installer must preserve: the empty template, a patch with existing
 * entries, and removal back to an empty document.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const installScript = join(root, 'scripts', 'install.mjs')
/** The installer refuses to run until the Host bundle exists. */
const libReady = existsSync(join(root, 'lib', 'index.js'))
const skip = libReady ? false : 'lib/index.js is missing — run `npm run build` first'

const TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

/** Create a throwaway $DSH_HOME with one profile patch file. */
async function profileHome(t, patch) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-iui-install-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const profile = join(home, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'cordis.patch.yml'), patch, 'utf8')
  return { home, patchFile: join(profile, 'cordis.patch.yml') }
}

/** Run the installer for the throwaway home. */
function install(home, args = []) {
  return promisify(execFile)('node', [installScript, '--home', home, '--profile', 'web', ...args], { cwd: root })
}

/** Count occurrences of a line in the patch text. */
function countLine(text, pattern) {
  return text.split('\n').filter((line) => pattern.test(line)).length
}

test('replaces the empty-array template with one managed block and restores it on uninstall', { skip }, async (t) => {
  const { home, patchFile } = await profileHome(t, TEMPLATE)

  await install(home)
  const installed = await readFile(patchFile, 'utf8')
  assert.equal(countLine(installed, /^\s*\[\s*\]\s*$/), 0, 'the empty-array document is gone')
  assert.equal(countLine(installed, /^# >>> dsh-intelligent-ui managed block/), 1, 'exactly one block starts')
  assert.equal(countLine(installed, /^# <<< dsh-intelligent-ui managed block/), 1, 'exactly one block ends')
  assert.match(installed, /- insert:\n {4}- id: intelligent-ui\n {6}name: .*\/lib\/index\.js/, 'the insert row is present')
  assert.match(installed, /^# Your patch layer for this dsh profile/m, 'the template header is preserved')

  const again = await install(home)
  assert.match(again.stdout, /already up to date/)

  await install(home, ['--uninstall'])
  const removed = await readFile(patchFile, 'utf8')
  assert.equal(countLine(removed, /dsh-intelligent-ui managed block/), 0, 'the block is gone')
  assert.equal(countLine(removed, /^\s*\[\s*\]\s*$/), 1, 'the empty-array document is restored once')
  assert.match(removed, /^# Your patch layer/m, 'the template header survives uninstall')
})

test('appends after existing entries without introducing a second document', { skip }, async (t) => {
  const { home, patchFile } = await profileHome(t, '- id: keep-me\n  name: "@deepseek-ai/dsh-base"\n')
  await install(home)
  const installed = await readFile(patchFile, 'utf8')
  assert.match(installed, /^- id: keep-me\n {2}name: "@deepseek-ai\/dsh-base"/m, 'the existing entry stays first')
  assert.equal(countLine(installed, /^\s*\[\s*\]\s*$/), 0, 'no empty-array document is introduced')
  assert.match(installed, /- insert:\n {4}- id: intelligent-ui/, 'the managed block is appended')

  await install(home, ['--uninstall'])
  const removed = await readFile(patchFile, 'utf8')
  assert.match(removed, /^- id: keep-me/m, 'the existing entry survives uninstall')
  assert.equal(countLine(removed, /dsh-intelligent-ui managed block/), 0, 'the block is gone')
  assert.equal(countLine(removed, /^\s*\[\s*\]\s*$/), 0, 'no empty-array document is added while entries remain')
})

test('a comments-only patch stays parseable in both directions', { skip }, async (t) => {
  const { home, patchFile } = await profileHome(t, '# header only\n')
  await install(home)
  const installed = await readFile(patchFile, 'utf8')
  assert.match(installed, /- insert:\n {4}- id: intelligent-ui/, 'the managed block is appended')
  assert.equal(countLine(installed, /^\s*\[\s*\]\s*$/), 0, 'no empty-array document is introduced')

  await install(home, ['--uninstall'])
  const removed = await readFile(patchFile, 'utf8')
  assert.equal(countLine(removed, /dsh-intelligent-ui managed block/), 0, 'the block is gone')
  assert.equal(countLine(removed, /^\s*\[\s*\]\s*$/), 1, 'the document is written back as an empty array')
})
