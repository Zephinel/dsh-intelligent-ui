/**
 * Settings-page regressions: global enablement, the default answer style, and
 * the deployment-wide free-composition switch.
 *
 * Run: node --test test/client/settings.test.mjs
 *
 * The TSX component is bundled with the repo's esbuild devDependency (React
 * stays external) and server-rendered. The writes themselves are exercised by
 * the Host tests and the live settings form; this file asserts the markup
 * contract for every snapshot the page can receive.
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
    settingsForm: options.form ?? form(),
    t: options.t,
  }))
}

test('off shows every control with its default state', () => {
  const html = render()
  assert.equal((html.match(/role="switch"/g) ?? []).length, 3)
  assert.match(html, /aria-checked="false"/)
  assert.match(html, /aria-label="Enable in all sessions"/)
  assert.match(html, /aria-label="Free-form layout"/)
  assert.match(html, /aria-describedby="[^"]+ [^"]+"/)
  assert.match(html, /Global defaults/)
  assert.match(html, /Off: new sessions start disabled/)
  assert.match(html, /Off: follow the default layout and typography guidance/)
  assert.match(html, /data-dsh-iui-style-picker="true"/)
  assert.match(html, /Card \(compact\)/)
  assert.match(html, /Article \(detailed\)/)
  assert.match(html, /Display style: Auto/)
  assert.doesNotMatch(html, /disabled=""/)
})

test('on reflects the global enable, style, and free-composition values', () => {
  const html = render({ form: form({ value: { globalEnabled: true, answerStyle: 'article', freeComposition: true } }) })
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 3)
  assert.match(html, /On: new sessions start with Intelligent UI enabled/)
  assert.match(html, /On: the model may choose the page structure/)
  assert.match(html, /data-active="true"/)
  assert.match(html, /Display style: Article/)
})

test('image export shows its defaults: white background and 2x', () => {
  const html = render()
  assert.match(html, /Defaults and options for image and interactive-page export/)
  assert.match(html, /data-dsh-iui-export-background/)
  assert.match(html, />#ffffff</)
  assert.doesNotMatch(html, /type="color"/)
  assert.match(html, />1x</)
  assert.match(html, />2x</)
  assert.match(html, /aria-pressed="true"[^>]*>2x</)
  assert.match(html, /Background color/)
  assert.match(html, /Resolution/)
  assert.match(html, /Keep follow-up actions/)
  assert.equal((html.match(/role="switch"/g) ?? []).length, 3, 'the export group adds the follow-up switch')
})

test('image export reflects stored background and scale', () => {
  const html = render({ form: form({ value: { exportBackground: '#112233', exportScale: '1x' } }) })
  assert.match(html, />#112233</)
  assert.match(html, /aria-pressed="true"[^>]*>1x</)
  assert.doesNotMatch(html, /aria-pressed="true"[^>]*>2x</)
})

test('an unavailable namespace disables the controls and explains why', () => {
  const html = render({ form: form({ status: 'unavailable', writable: false, value: undefined }) })
  assert.match(html, /disabled=""/)
  assert.match(html, /This deployment provides no settings service/)
})

test('a read-only settings document disables the controls', () => {
  const html = render({ form: form({ writable: false }) })
  assert.match(html, /disabled=""/)
  assert.match(html, /These settings are read-only/)
})

test('the Chinese dictionary localizes the page copy', () => {
  const html = render({ t: translate(zh) })
  assert.match(html, /全局默认/)
  assert.match(html, /在所有会话中启用/)
  assert.match(html, /回答样式/)
  assert.match(html, /卡片（简洁）/)
  assert.match(html, /文章（详细）/)
  assert.match(html, /自由布局/)
  assert.match(html, /图片与交互页面导出的默认外观和选项/)
  assert.match(html, /背景颜色/)
  assert.match(html, /分辨率/)
})
