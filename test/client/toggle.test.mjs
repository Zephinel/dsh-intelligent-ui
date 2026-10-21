/**
 * Tests for the composer Intelligent UI control.
 *
 * Run: node --test test/client/toggle.test.mjs
 *
 * The pure command helpers import as TypeScript source (Node >= 22.18 strips
 * type annotations). The TSX component cannot be loaded that way, so this test
 * bundles it with the repo's existing esbuild devDependency — React stays
 * external and resolves from the repo's node_modules — then server-renders it
 * to assert the markup contract. No new dependencies.
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import {
  effectiveView,
  enableCommand,
  publishMode,
  readSyncedMode,
  resetSyncedMode,
  runCommand,
  startModeSync,
  styleCommand,
  subscribeSyncedMode,
} from '../../src/client/commands.ts'
import { translate, zh } from '../../src/shared/locales.ts'

const root = join(import.meta.dirname, '..', '..')
const outDir = join(import.meta.dirname, '.tmp-toggle')
await mkdir(outDir, { recursive: true })
const outfile = join(outDir, 'toggle-control.mjs')
await build({
  entryPoints: [join(root, 'src/client/ToggleControl.tsx')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  target: 'node22',
  external: ['react', 'react-dom'],
  logLevel: 'silent',
})
const { ToggleControl } = await import(pathToFileURL(outfile).href)

after(async () => {
  await rm(outDir, { recursive: true, force: true })
})

/** One projection view with sensible defaults. */
const view = (overrides = {}) => ({
  sessionEnable: 'inherit',
  sessionStyle: 'inherit',
  globalEnabled: true,
  globalStyle: 'auto',
  enabled: true,
  style: 'auto',
  pending: false,
  ...overrides,
})

/**
 * Server-render the control for one projection view.
 * @param {import('../../src/shared/intelligent-ui.ts').IntelligentUIModeView | undefined} projection
 * @param {{ locked?: boolean, sessionId?: string, flip?: (scope: string) => Promise<string | null>, setStyle?: (style: string) => Promise<string | null>, t?: (key: string, params?: Record<string, string | number>) => string }} [options]
 * @returns {{ html: string, projectionKeys: string[] }}
 */
function render(projection, options = {}) {
  resetSyncedMode()
  const projectionKeys = []
  const html = renderToStaticMarkup(createElement(ToggleControl, {
    useProjection: (key) => {
      projectionKeys.push(key)
      return projection
    },
    locked: options.locked ?? false,
    sessionId: options.sessionId ?? 'session-1',
    flip: options.flip ?? (async () => null),
    setStyle: options.setStyle ?? (async () => null),
    t: options.t,
  }))
  return { html, projectionKeys }
}

test('an absent projection renders nothing (deployment without the switch)', () => {
  const { html, projectionKeys } = render(undefined)
  assert.equal(html, '')
  assert.deepEqual(projectionKeys, ['intelligent-ui'])
})

test('off renders the closed chip with its own command hint', () => {
  const { html } = render(view({ sessionEnable: 'off', globalEnabled: false, enabled: false }))
  assert.match(html, /data-dsh-iui-toggle="true"/)
  assert.match(html, /data-state="off"/)
  assert.match(html, /aria-label="Intelligent UI: off"/)
  assert.match(html, /aria-haspopup="menu"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, />UI: Off</)
  assert.match(html, /\/iui off/)
  assert.doesNotMatch(html, /role="menu"/)
  assert.doesNotMatch(html, /disabled=""/)
})

test('session scope labels the chip Session and hints the session command', () => {
  const { html } = render(view({ sessionEnable: 'on' }))
  assert.match(html, /data-state="on"/)
  assert.match(html, /aria-label="Intelligent UI: this session only"/)
  assert.match(html, />UI: Session</)
  assert.match(html, /\/iui on/)
  assert.doesNotMatch(html, /disabled=""/)
})

test('inherit labels the chip Global and hints the inherit command', () => {
  const { html } = render(view({ sessionEnable: 'inherit' }))
  assert.match(html, /data-state="inherit"/)
  assert.match(html, /aria-label="Intelligent UI: follow global"/)
  assert.match(html, />UI: Follow global</)
  assert.match(html, /\/iui inherit/)
  assert.doesNotMatch(html, /disabled=""/)
})

test('a Chinese locale seat translates the chip, aria label and tooltip', () => {
  const t = translate(zh)
  const { html } = render(view({ sessionEnable: 'on' }), { t })
  assert.match(html, /data-state="on"/)
  assert.match(html, /aria-label="Intelligent UI：仅本会话"/)
  assert.match(html, />UI：本会话</)
  assert.match(html, /title="Intelligent UI 在本会话开启（\/iui on） — 点击更改"/)
})

test('pending disables the chip and reports the pending state', () => {
  for (const sessionEnable of ['off', 'on', 'inherit']) {
    const { html } = render(view({ sessionEnable, pending: true }))
    assert.match(html, /data-state="pending"/)
    assert.match(html, /disabled=""/)
  }
})

test('a locked composer disables the chip without changing its state', () => {
  const { html } = render(view({ sessionEnable: 'inherit' }), { locked: true })
  assert.match(html, /data-state="inherit"/)
  assert.match(html, />UI: Follow global</)
  assert.match(html, /disabled=""/)
})

test('the command helpers spell the host command for every value', () => {
  assert.equal(enableCommand('off'), '/iui off')
  assert.equal(enableCommand('on'), '/iui on')
  assert.equal(enableCommand('inherit'), '/iui inherit')
  assert.equal(styleCommand('auto'), '/iui style auto')
  assert.equal(styleCommand('card'), '/iui style card')
  assert.equal(styleCommand('article'), '/iui style article')
  assert.equal(styleCommand('inherit'), '/iui style inherit')
})

test('runCommand normalizes both failure channels', async () => {
  assert.equal(await runCommand(async () => null, 'on'), null)
  assert.equal(await runCommand(async () => 'permission denied (E_DENIED)', 'off'), 'permission denied (E_DENIED)')
  assert.equal(await runCommand(async () => { throw new Error('transport closed') }, 'inherit'), 'transport closed')
  assert.equal(await runCommand(async () => { throw 'nope' }, 'style card'), 'nope')
})


test('cross-tab views publish, subscribe, and stop overriding once cleared', () => {
  resetSyncedMode()
  startModeSync()
  const seen = []
  const unsubscribe = subscribeSyncedMode(() => seen.push(readSyncedMode()))
  const base = view()
  const optimistic = view({ sessionEnable: 'on', enabled: true })
  publishMode(optimistic, 'session-1', base)
  assert.deepEqual(readSyncedMode(), { sessionId: 'session-1', view: optimistic, base })
  assert.equal(seen.length, 1)
  assert.deepEqual(effectiveView(undefined, readSyncedMode(), 'session-1'), optimistic)
  assert.equal(effectiveView(undefined, readSyncedMode(), 'session-2'), undefined)
  unsubscribe()
  publishMode(view(), 'session-2', base)
  assert.equal(seen.length, 1, 'unsubscribed listeners stop receiving updates')
  resetSyncedMode()
  assert.equal(readSyncedMode(), undefined)
})
