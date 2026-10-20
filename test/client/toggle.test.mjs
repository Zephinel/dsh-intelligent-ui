/**
 * Tests for the composer three-scope Intelligent UI control.
 *
 * Run: node --test test/client/toggle.test.mjs
 *
 * The pure transitions import as TypeScript source (Node >= 22.18 strips type
 * annotations). The TSX component cannot be loaded that way, so this test
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
  effectiveMode,
  modeCommand,
  publishMode,
  readSyncedMode,
  resetSyncedMode,
  runFlip,
  subscribeSyncedMode,
  toggleState,
} from '../../src/client/toggle.ts'
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
  external: ['react'],
  plugins: [{
    name: 'primitives-stub',
    setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives', namespace: 'stub' }))
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        loader: 'js',
        contents: `
          import { createElement } from 'react'
          export const Menu = ({ open, anchor, items = [] }) => open
            ? createElement('div', { role: 'menu' }, items.map(item => createElement('div', { key: item.id, role: 'menuitem' }, item.label)))
            : anchor
          export const IconChevronDownOutlineRegular = () => createElement('svg')
        `,
      }))
    },
  }],
  logLevel: 'silent',
})
const { ToggleControl } = await import(pathToFileURL(outfile).href)

after(async () => {
  await rm(outDir, { recursive: true, force: true })
})

/**
 * Server-render the control for one projection view.
 * @param {import('../../src/shared/intelligent-ui.ts').IntelligentUIModeView | undefined} view
 * @param {{ locked?: boolean, sessionId?: string, flip?: (scope: string) => Promise<string | null>, t?: (key: string, params?: Record<string, string | number>) => string }} [options]
 * @returns {{ html: string, projectionKeys: string[] }}
 */
function render(view, options = {}) {
  resetSyncedMode()
  const projectionKeys = []
  const html = renderToStaticMarkup(createElement(ToggleControl, {
    useProjection: (key) => {
      projectionKeys.push(key)
      return view
    },
    locked: options.locked ?? false,
    onActiveChange: () => undefined,
    sessionId: options.sessionId ?? 'session-1',
    flip: options.flip ?? (async () => null),
    // Omitted `t` exercises the component's English fallback used in bare tests.
    t: options.t,
  }))
  return { html, projectionKeys }
}

test('an absent projection renders nothing (deployment without the switch)', () => {
  const { html, projectionKeys } = render(undefined)
  assert.equal(html, '')
  assert.deepEqual(projectionKeys, ['intelligent-ui'])
})

test('off renders the chip closed, with the off glyph and command hint', () => {
  const { html } = render({ mode: 'off', pending: false })
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
  const { html } = render({ mode: 'session', pending: false })
  assert.match(html, /data-state="session"/)
  assert.match(html, /aria-label="Intelligent UI: this session only"/)
  assert.match(html, />UI: Session</)
  assert.match(html, /\/iui session/)
  assert.doesNotMatch(html, /disabled=""/)
})

test('global scope labels the chip All and hints the global command', () => {
  const { html } = render({ mode: 'global', pending: false })
  assert.match(html, /data-state="global"/)
  assert.match(html, /aria-label="Intelligent UI: all sessions"/)
  assert.match(html, />UI: All</)
  assert.match(html, /\/iui global/)
  assert.doesNotMatch(html, /disabled=""/)
})

test('a Chinese locale seat translates the chip, aria label and tooltip', () => {
  const t = translate(zh)
  const { html } = render({ mode: 'session', pending: false }, { t })
  assert.match(html, /data-state="session"/)
  assert.match(html, /aria-label="Intelligent UI：仅本会话"/)
  assert.match(html, />UI：本会话</)
  assert.match(html, /title="Intelligent UI 仅在本会话开启（\/iui session） — 点击更改"/)
  assert.match(html, /\/iui session/)
})

test('the Chinese locale covers every scope label', () => {
  const t = translate(zh)
  const expected = {
    off: { chip: 'UI：关闭', aria: 'Intelligent UI：关闭' },
    session: { chip: 'UI：本会话', aria: 'Intelligent UI：仅本会话' },
    global: { chip: 'UI：全部', aria: 'Intelligent UI：全部会话' },
  }
  for (const [mode, copy] of Object.entries(expected)) {
    const { html } = render({ mode, pending: false }, { t })
    assert.match(html, new RegExp(`>${copy.chip}<`), `${mode} chip`)
    assert.match(html, new RegExp(`aria-label="${copy.aria}"`), `${mode} aria label`)
  }
})

test('pending disables the chip and reports the pending state', () => {
  for (const view of [{ mode: 'off', pending: true }, { mode: 'session', pending: true }, { mode: 'global', pending: true }]) {
    const { html } = render(view)
    assert.match(html, /data-state="pending"/)
    assert.match(html, /disabled=""/)
  }
})

test('a locked composer disables the chip without changing its state', () => {
  const { html } = render({ mode: 'global', pending: false }, { locked: true })
  assert.match(html, /data-state="global"/)
  assert.match(html, />UI: All</)
  assert.match(html, /disabled=""/)
})

test('modeCommand spells the host slash command for all three scopes', () => {
  assert.equal(modeCommand('off'), '/iui off')
  assert.equal(modeCommand('session'), '/iui session')
  assert.equal(modeCommand('global'), '/iui global')
})

test('effectiveMode prefers a live cross-tab scope for the right session', () => {
  assert.equal(effectiveMode({ mode: 'off', pending: false }, undefined, 's1'), 'off')
  assert.equal(effectiveMode(undefined, { mode: 'global' }, 's1'), 'global')
  assert.equal(effectiveMode({ mode: 'off', pending: false }, { mode: 'session', sessionId: 's1' }, 's1'), 'session')
  assert.equal(effectiveMode({ mode: 'session', pending: false }, { mode: 'session', sessionId: 's2' }, 's1'), 'off')
  assert.equal(effectiveMode({ mode: 'session', pending: false }, { mode: 'off' }, 's1'), 'off')
})

test('toggleState reports pending before the settled scope', () => {
  assert.equal(toggleState('off', false), 'off')
  assert.equal(toggleState('session', false), 'session')
  assert.equal(toggleState('global', false), 'global')
  assert.equal(toggleState('global', true), 'pending')
})

test('the cross-tab store publishes scopes and notifies subscribers', () => {
  resetSyncedMode()
  const seen = []
  const unsubscribe = subscribeSyncedMode(() => { seen.push(readSyncedMode()) })
  assert.equal(readSyncedMode(), undefined)
  publishMode('global')
  assert.deepEqual(readSyncedMode(), { mode: 'global' })
  assert.deepEqual(seen, [{ mode: 'global' }])
  publishMode('session', 's1')
  assert.deepEqual(readSyncedMode(), { mode: 'session', sessionId: 's1' })
  unsubscribe()
  publishMode('off')
  assert.equal(readSyncedMode().mode, 'off')
  assert.equal(seen.length, 2, 'unsubscribed listeners stop receiving updates')
  resetSyncedMode()
  assert.equal(readSyncedMode(), undefined)
})

test('runFlip forwards the scope and normalizes both failure channels', async () => {
  const calls = []
  assert.equal(await runFlip(async (scope) => {
    calls.push(scope)
    return null
  }, 'session'), null)
  assert.deepEqual(calls, ['session'])
  assert.equal(await runFlip(async () => 'permission denied (E_DENIED)', 'off'), 'permission denied (E_DENIED)')
  assert.equal(await runFlip(async () => { throw new Error('transport closed') }, 'global'), 'transport closed')
  assert.equal(await runFlip(async () => { throw 'nope' }, 'off'), 'nope')
})
