/**
 * Host-half regression test: the three-scope Intelligent UI switch.
 *
 * Scopes are `off`, `session` (only the session that flipped it) and `global`
 * (every session). Mounts use a private temporary DSH_HOME so the real harness
 * home is never touched.
 *
 *   node scripts/build.mjs host
 *   node --test test/host/mode.test.mjs
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const plugin = await import('../../lib/index.js')
const homes = []

/** Mount the plugin with optional switch services and a private DSH_HOME. */
function mount({ modeServices = true, persisted } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'iui-mode-'))
  homes.push(home)
  process.env.DSH_HOME = home
  if (persisted !== undefined) writeFileSync(join(home, 'dsh-intelligent-ui.json'), JSON.stringify(persisted))
  const rec = {
    tool: undefined,
    sections: [],
    skill: undefined,
    projection: undefined,
    command: undefined,
    handlers: {},
    restrictions: [],
    disposed: [],
  }
  const agents = []
  const ctx = {
    tools: { register(definition) { rec.tool = definition } },
    systemPrompt: { section(section) { rec.sections.push(section) } },
    logger: { warn() {} },
    agents: { list: () => agents },
    on(event, handler) {
      rec.handlers[event] = handler
      return () => {}
    },
    inject(dependencies, callback) {
      const list = [...dependencies]
      if (list.includes('skills')) {
        callback({ skills: { register(skill) { rec.skill = skill } } })
        return
      }
      if (!modeServices) return
      if (list.includes('agents')) {
        callback({ agents: { list: () => agents } })
        return
      }
      if (!list.includes('sessionProjections') || !list.includes('commands')) return
      callback({
        sessionProjections: {
          register(definition) { rec.projection = definition },
        },
        commands: { register(definition) { rec.command = definition } },
      })
    },
  }
  plugin.apply(ctx)
  return { rec, home, agents }
}

after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

/** One fake agent whose tool scope records restrictions. */
function makeAgent(rec, sessionId) {
  return {
    session: { id: sessionId },
    ctx: {
      tools: {
        restrict(filter) {
          rec.restrictions.push(filter)
          return () => { rec.disposed.push(filter) }
        },
      },
    },
  }
}

/** Prompt resolver context for one session. */
const promptContext = sessionId => ({ agent: { session: { id: sessionId } } })

test('registers the projection and the /iui command', () => {
  const { rec } = mount()
  assert.ok(rec.projection, 'projection registered')
  assert.equal(rec.projection.key, 'intelligent-ui')
  assert.equal(rec.projection.stateVersion, 3)
  assert.deepEqual(rec.projection.init({ id: 's1' }), { sessionId: 's1', running: null })
  assert.ok(rec.command, 'command registered')
  assert.equal(rec.command.name, 'iui')
  assert.deepEqual(rec.command.input.hint, '[off|session|global]')
})

test('the projection folds the accepted scope only for its pending state', () => {
  const { rec } = mount()
  const fold = rec.projection.apply
  let state = rec.projection.init({ id: 's1' })
  state = fold(state, { type: 'command/run', data: { name: 'iui', args: 'session', commandId: 'c1' } })
  assert.deepEqual(state.running, { commandId: 'c1', scope: 'session' })
  assert.deepEqual(rec.projection.wire.view(state), { mode: 'off', pending: true })
  state = fold(state, { type: 'command/done', data: { commandId: 'c1', kind: 'success' } })
  assert.deepEqual(rec.projection.wire.view(state), { mode: 'off', pending: false })
  // Bare status and invalid arguments never enter the pending state.
  assert.equal(fold(state, { type: 'command/run', data: { name: 'iui', args: '', commandId: 'c2' } }), state)
  assert.equal(fold(state, { type: 'command/run', data: { name: 'iui', args: 'maybe', commandId: 'c3' } }), state)
  // `on` is the legacy spelling of global.
  const on = fold(state, { type: 'command/run', data: { name: 'iui', args: 'on', commandId: 'c4' } })
  assert.equal(on.running.scope, 'global')
})

test('off hides prompt and tool; session scope admits only that session', async () => {
  const { rec, home, agents } = mount()
  const s1 = makeAgent(rec, 's1')
  agents.push(s1)

  assert.equal(rec.sections[0].text(promptContext('s1')), '')
  rec.handlers['agent/created']({ agent: s1 })
  assert.deepEqual(rec.restrictions, [{ deny: ['render_ui'] }])
  await assert.rejects(
    () => rec.tool.execute({ program: 'root = Col([title])\ntitle = Title("x")' }, { agent: s1 }),
    /render_ui is disabled/,
  )

  // Session scope: only s1 is admitted.
  const session = rec.command.handler({ agent: s1, rawInput: 'session' })
  assert.equal(session.kind, 'success')
  assert.match(session.text, /this session only/)
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'dsh-intelligent-ui.json'), 'utf8')), { global: false, sessions: ['s1'] })
  assert.ok(rec.sections[0].text(promptContext('s1')).length > 10_000)
  assert.equal(rec.sections[0].text(promptContext('s2')), '')
  assert.deepEqual(rec.projection.wire.view(rec.projection.init({ id: 's1' })), { mode: 'session', pending: false })
  assert.deepEqual(rec.projection.wire.view(rec.projection.init({ id: 's2' })), { mode: 'off', pending: false })
  const value = await rec.tool.execute({ program: 'root = Col([title])\ntitle = Title("Hello")' }, { agent: s1 })
  assert.equal(value.statements, 2)
  await assert.rejects(
    () => rec.tool.execute({ program: 'root = Col([title])\ntitle = Title("Hello")' }, { agent: { session: { id: 's2' } } }),
    /render_ui is disabled/,
  )

  // Global scope: s1 and s2 are both admitted.
  const global = rec.command.handler({ agent: s1, rawInput: 'global' })
  assert.match(global.text, /all sessions/)
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'dsh-intelligent-ui.json'), 'utf8')), { global: true, sessions: [] })
  assert.ok(rec.sections[0].text(promptContext('s2')).length > 10_000)
  assert.deepEqual(rec.projection.wire.view(rec.projection.init({ id: 's2' })), { mode: 'global', pending: false })

  // Off clears every override.
  const off = rec.command.handler({ agent: s1, rawInput: 'off' })
  assert.match(off.text, /off for every session/)
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'dsh-intelligent-ui.json'), 'utf8')), { global: false, sessions: [] })
  assert.equal(rec.sections[0].text(promptContext('s1')), '')
  assert.deepEqual(rec.restrictions.at(-1), { deny: ['render_ui'] })

  // Status/idempotence/validation.
  assert.match(rec.command.handler({ agent: s1, rawInput: '' }).text, /Intelligent UI is off/)
  assert.match(rec.command.handler({ agent: s1, rawInput: 'off' }).text, /already off/)
  assert.equal(rec.command.handler({ agent: s1, rawInput: 'nope' }).kind, 'error')
  assert.match(rec.command.handler({ agent: s1, rawInput: 'nope' }).text, /Usage: \/iui \[off\|session\|global\]/)
})

test('persisted scopes load at startup, including the legacy file', () => {
  const sessionMount = mount({ persisted: { global: false, sessions: ['s9'] } })
  assert.deepEqual(sessionMount.rec.projection.wire.view(sessionMount.rec.projection.init({ id: 's9' })), { mode: 'session', pending: false })
  assert.equal(sessionMount.rec.sections[0].text(promptContext('s9')).length > 10_000, true)
  assert.equal(sessionMount.rec.sections[0].text(promptContext('s10')), '')

  const globalMount = mount({ persisted: { global: true, sessions: [] } })
  assert.deepEqual(globalMount.rec.projection.wire.view(globalMount.rec.projection.init({ id: 'any' })), { mode: 'global', pending: false })

  const legacyMount = mount({ persisted: { enabled: true } })
  assert.deepEqual(legacyMount.rec.projection.wire.view(legacyMount.rec.projection.init({ id: 'any' })), { mode: 'global', pending: false })
})

test('a host without the switch services stays always-on', async () => {
  const { rec } = mount({ modeServices: false })
  assert.equal(rec.projection, undefined)
  assert.equal(rec.command, undefined)
  assert.equal(rec.sections[0].text(promptContext('s1')).length > 10_000, true)
  const value = await rec.tool.execute({ program: 'root = Col([title])\ntitle = Title("Hello")' })
  assert.equal(value.statements, 2)
})
