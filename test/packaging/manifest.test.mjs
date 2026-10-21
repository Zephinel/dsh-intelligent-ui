/**
 * Packaging regressions: the manifest must stay a loadable DSH bundle and ship
 * every file the runtime reads. These tests inspect the published surface, not
 * the implementation, and run without installing anything.
 *
 *   node --test test/packaging/manifest.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const pkg = JSON.parse(read('package.json'))

/** Fixed package files the runtime or the DSH bundle layer reads. */
const REQUIRED_FILES = [
  'lib/index.js',
  'lib/client.js',
  'cordis.patch.yml',
  'icon.svg',
  'LICENSE',
  'NOTICE',
]

test('package.json is one DSH bundle with bundle-patch-only options', () => {
  assert.equal(pkg.name, '@zephinel/dsh-intelligent-ui')
  assert.match(pkg.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.type, 'module')
  // Published manifest: no `private` flag may block npm publish.
  assert.equal(pkg.private, undefined)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(pkg.main, 'lib/index.js')
})

test('the published files list covers every runtime and bundle input', () => {
  for (const entry of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'skills', 'locale', 'licenses', 'assets', 'icon.svg', 'LICENSE', 'NOTICE']) {
    assert.ok(pkg.files.includes(entry), `files includes ${entry}`)
  }
  for (const file of REQUIRED_FILES) {
    assert.ok(existsSync(new URL(file, root)), `${file} exists`)
  }
  assert.ok(statSync(new URL('icon.svg', root)).size < 256 * 1024, 'icon fits the manifest image limit')
  for (const readme of ['README.md', 'README.en.md']) {
    assert.ok(pkg.files.includes(readme), `files includes ${readme}`)
    assert.ok(existsSync(new URL(readme, root)), `${readme} exists`)
  }
})

test('every shipped screenshot exists and is used by both READMEs', () => {
  const screenshots = readdirSync(new URL('assets', root))
  assert.ok(screenshots.length >= 3, 'assets ships the README screenshots')
  for (const image of screenshots) {
    assert.ok(existsSync(new URL(`assets/${image}`, root)), `assets/${image} exists`)
    assert.ok(read('README.md').includes(`assets/${image}`), `README.md uses ${image}`)
    assert.ok(read('README.en.md').includes(`assets/${image}`), `README.en.md uses ${image}`)
  }
  // The other direction: a README must not point at a screenshot that is gone.
  for (const readme of ['README.md', 'README.en.md']) {
    for (const [, image] of read(readme).matchAll(/assets\/([^)\s]+)/g)) {
      assert.ok(existsSync(new URL(`assets/${image}`, root)), `${readme} references a shipped assets/${image}`)
    }
  }
})

test('the two README languages ship and link to each other', () => {
  assert.match(read('README.md'), /\[English\]\(README\.en\.md\)/, 'Chinese README links to English')
  assert.match(read('README.en.md'), /\[中文\]\(README\.md\)/, 'English README links to Chinese')
  // The changelog is English-only and repo-only: both READMEs link it, it has an
  // Unreleased section, and it stays out of the npm tarball.
  assert.match(read('README.md'), /CHANGELOG\.md/, 'Chinese README links the changelog')
  assert.match(read('README.en.md'), /CHANGELOG\.md/, 'English README links the changelog')
  assert.ok(existsSync(new URL('CHANGELOG.md', root)), 'CHANGELOG.md exists')
  assert.match(read('CHANGELOG.md'), /^## \[Unreleased\]$/m, 'CHANGELOG.md has an Unreleased section')
  assert.ok(!pkg.files.includes('CHANGELOG.md'), 'CHANGELOG.md stays out of the npm package')
})

test('the bundle patch inserts the host row under the installed package name', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /^- insert:$/m)
  assert.match(patch, /^\s+- id: intelligent-ui$/m)
  assert.match(patch, new RegExp(`^\\s+name: '${pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'$`, 'm'))
})

test('plugin display metadata is valid and localized', () => {
  const en = JSON.parse(read('locale/en.json'))
  const zh = JSON.parse(read('locale/zh.json'))
  for (const [language, locale] of [['en', en], ['zh', zh]]) {
    assert.ok(typeof locale.meta.title === 'string' && locale.meta.title.length > 0, `${language} meta.title`)
    assert.ok(typeof locale.meta.description === 'string' && locale.meta.description.length > 0, `${language} meta.description`)
  }
  assert.deepEqual(Object.keys(en.meta).sort(), Object.keys(zh.meta).sort(), 'meta key sets match')
  assert.match(zh.meta.title, /[\u4e00-\u9fff]/u, 'Chinese display title is translated')
  assert.match(zh.meta.description, /[\u4e00-\u9fff]/u, 'Chinese display description is translated')
  assert.notEqual(en.meta.description, zh.meta.description, 'descriptions differ per language')
  assert.equal(pkg.icon, './icon.svg')
})

test('third-party attribution ships with the package', () => {
  const notice = read('NOTICE')
  for (const name of ['Open Intelligent UI', 'OpenUI', 'lucide-react', 'KaTeX', 'MapLibre GL JS', 'zod', 'SnapDOM']) {
    assert.ok(notice.includes(name), `NOTICE mentions ${name}`)
  }
  for (const file of ['licenses/Open-Intelligent-UI-LICENSE', 'licenses/snapdom-LICENSE']) {
    const licenses = readFileSync(new URL(file, root), 'utf8')
    assert.match(licenses, /MIT License/, `${file} carries the license text`)
  }
})

test('the shipped Agent Skill exists and is referenced by the host build', () => {
  const skill = new URL('skills/intelligent-ui/SKILL.md', root)
  assert.ok(existsSync(skill), 'skills/intelligent-ui/SKILL.md exists')
  const host = read('lib/index.js')
  // The bundle is minified, so assert on literals that survive minification.
  assert.match(host, /SKILL\.md/)
  assert.match(host, /modelInvocable/)
  assert.match(host, /skills/)
})

test('the built client bundle registers its configuration on the bundle detail page', () => {
  const file = new URL('lib/client.js', root)
  // `npm run check` builds first; a bare test run may not have artifacts yet.
  if (!existsSync(file)) return
  const client = readFileSync(file, 'utf8')
  const head = client.slice(0, 400)
  const id = /id:\s*"([^"]+)"/.exec(head)?.[1]
  assert.equal(id, pkg.name, 'client bundle loader id must equal package.json name — run `npm run build` after changing the package name')
  assert.match(client, /plugins\.bundle\.config/, 'configuration registers on the Plugins detail page')
  assert.doesNotMatch(client, /settings\.section/, 'the separate Settings section is gone')
})
