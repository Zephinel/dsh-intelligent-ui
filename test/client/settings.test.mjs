/**
 * Settings-page regressions: the deployment-wide free-composition switch.
 *
 * Run: node --test test/client/settings.test.mjs
 *
 * The TSX component is bundled with the repo's esbuild devDependency (React
 * stays external) and server-rendered, matching the composer-control harness.
 * The switch write itself is exercised by the Host test (prompt suffix) and by
 * the live settings form; this file asserts the markup contract for every
 * snapshot the page can receive.
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { translate, zh } from '../../src/shared/locales.ts'

const root = join(import.meta.dirname, '..', '..')
const outDir = join(import.meta.dirname, '.tmp-settings')
await mkdir(outDir, { recursive: true })
const outfile = join(outDir, 'settings-page.mjs')
await build({
  entryPoints: [join(root, 'src/client/SettingsPage.tsx')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  target: 'node22',
  external: ['react'],
  logLevel: 'silent',
})
const { SettingsPage } = await import(pathToFileURL(outfile).href)

after(async () => {
  await rm(outDir, { recursive: true, force: true })
})

/** Build one fake Host config form around a fixed snapshot. */
function form(overrides = {}) {
  const snapshot = { status: 'ready', writable: true, value: {}, ...overrides }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async () => true,
  }
}

/**
 * Server-render the page.
 * @param {{ form?: ReturnType<typeof form>, t?: (key: string, params?: Record<string, string | number>) => string }} [options]
 * @returns {string} the static markup.
 */
function render(options = {}) {
  return renderToStaticMarkup(createElement(SettingsPage, {
    form: options.form ?? form(),
    // Omitted `t` exercises the English fallback used in bare tests.
    t: options.t,
  }))
}

test('off shows an enabled switch with the default-playbook hint', () => {
  const html = render()
  assert.match(html, /role="switch"/)
  assert.match(html, /aria-checked="false"/)
  assert.match(html, /aria-label="Free composition"/)
  assert.match(html, /aria-describedby="[^"]+ [^"]+"/)
  assert.match(html, /Answer layout/)
  assert.match(html, /Off: the default design playbook/)
  assert.match(html, /prompt-level preference, not enforcement/)
  assert.match(html, /invoke \/intelligent-ui explicitly/)
  assert.doesNotMatch(html, /disabled=""/)
})

test('on flips the switch and its hint', () => {
  const html = render({ form: form({ value: { freeComposition: true } }) })
  assert.match(html, /aria-checked="true"/)
  assert.match(html, /On: free composition/)
})

test('an unavailable namespace disables the switch and explains why', () => {
  const html = render({ form: form({ status: 'unavailable', writable: false, value: undefined }) })
  assert.match(html, /disabled=""/)
  assert.match(html, /This deployment provides no settings service/)
})

test('a read-only settings document disables the switch', () => {
  const html = render({ form: form({ writable: false }) })
  assert.match(html, /disabled=""/)
  assert.match(html, /These settings are read-only/)
})

test('the Chinese dictionary localizes the page copy', () => {
  const html = render({ t: translate(zh) })
  assert.match(html, /自由布局/)
  assert.match(html, /回答版式/)
  assert.match(html, /当前：默认设计规范/)
  assert.match(html, /提示词层的偏好/)
})
