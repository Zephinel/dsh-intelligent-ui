/**
 * Host-half regression test: the per-session enable switch and answer style.
 *
 * The deployment-wide defaults live in Host settings (`globalEnabled`,
 * `answerStyle`); the composer persists session overrides in DSH_HOME. Mounts
 * use a private temporary DSH_HOME so the real harness home is never touched.
 *
 *   node scripts/build.mjs host
 *   node --test test/host/mode.test.mjs
 */
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installSessionControls } from '../../src/host/mode.ts'
import { createStyleStore } from '../../src/host/style-store.ts'
import { styleInput, template } from './style-fixtures.mjs'

const plugin = await import('../../lib/index.js')
const homes = []
const originalHome = process.env.DSH_HOME

const VALID = 'root = Col([title])\ntitle = Title("Hello")'
const ARTICLE = 'root = Col([toc, section])\ntoc = Toc(["一、Intro"])\nsection = Section("一、Intro", [Markdown("Body.")])'

/** Mount the plugin with optional switch services, a fake settings document, and a private DSH_HOME. */
function mount({ modeServices = true, persisted, settings, useConfig = settings !== undefined, templates = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'iui-mode-'))
  homes.push(home)
  process.env.DSH_HOME = home
  if (persisted !== undefined) writeFileSync(join(home, 'dsh-intelligent-ui.json'), JSON.stringify(persisted))
  writeFileSync(join(home, 'dsh-intelligent-ui-styles.json'), JSON.stringify({ version: 1, templates }))
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
  const values = {
    globalEnabled: settings?.globalEnabled ?? false,
    answerStyle: settings?.answerStyle ?? 'auto',
    freeComposition: settings?.freeComposition ?? false,
  }
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
  const config = useConfig
    ? {
        freeComposition: { get: () => values.freeComposition },
        globalEnabled: { get: () => values.globalEnabled },
        answerStyle: { get: () => values.answerStyle },
      }
    : undefined
  plugin.apply(ctx, config)
  return { rec, home, agents, settings: values }
}

after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
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

/** Project one session's view. */
const viewOf = (rec, sessionId) => rec.projection.wire.view(rec.projection.init({ id: sessionId }))

test('registers the projection and the /iui command', () => {
  const { rec } = mount({ settings: {} })
  assert.ok(rec.projection, 'projection registered')
  assert.equal(rec.projection.key, 'intelligent-ui')
  assert.equal(rec.projection.stateVersion, 6)
  assert.deepEqual(rec.projection.init({ id: 's1' }), { sessionId: 's1', command: null })
  assert.ok(rec.command, 'command registered')
  assert.equal(rec.command.name, 'iui')
  assert.deepEqual(rec.command.input.hint, '[on|off|inherit] | style [auto|card|article|inherit|<cs_id>] | on-demand [off|<client-instance-token> [adjust <resultId>]]')
})

test('the projection folds valid commands and exposes the live settings', () => {
  const { rec, settings } = mount({ settings: { globalEnabled: false, answerStyle: 'card' } })
  const fold = rec.projection.apply
  let state = rec.projection.init({ id: 's1' })
  assert.deepEqual(viewOf(rec, 's1'), {
    sessionEnable: 'inherit',
    sessionStyle: 'inherit',
    globalEnabled: false,
    globalStyle: 'card',
    enabled: false,
    style: 'card',
    pending: false,
    onDemand: null,
  })

  state = fold(state, { type: 'command/run', data: { name: 'iui', args: 'on', commandId: 'c1' } })
  assert.deepEqual(state.command, { commandId: 'c1', kind: 'scope' })
  assert.deepEqual(rec.projection.wire.view(state), {
    sessionEnable: 'inherit', sessionStyle: 'inherit', globalEnabled: false, globalStyle: 'card', enabled: false, style: 'card', pending: true, onDemand: null,
  })
  state = fold(state, { type: 'command/done', data: { commandId: 'c1', kind: 'success' } })
  assert.equal(rec.projection.wire.view(state).pending, false)

  state = fold(state, { type: 'command/run', data: { name: 'iui', args: 'style article', commandId: 'c2' } })
  assert.deepEqual(state.command, { commandId: 'c2', kind: 'style' })
  state = fold(state, { type: 'command/done', data: { commandId: 'c2', kind: 'success' } })

  // Status, invalid input, and a global attempt never enter pending.
  assert.equal(fold(state, { type: 'command/run', data: { name: 'iui', args: '', commandId: 'c3' } }), state)
  assert.equal(fold(state, { type: 'command/run', data: { name: 'iui', args: 'maybe', commandId: 'c4' } }), state)
  assert.equal(fold(state, { type: 'command/run', data: { name: 'iui', args: 'global', commandId: 'c5' } }), state)

  settings.globalEnabled = true
  settings.answerStyle = 'article'
  const view = viewOf(rec, 's1')
  assert.equal(view.globalEnabled, true)
  assert.equal(view.globalStyle, 'article')
})

test('the session switch gates prompt and tool visibility', async () => {
  const { rec, agents, settings } = mount({ settings: { globalEnabled: false } })
  const s1 = makeAgent(rec, 's1')
  agents.push(s1)

  assert.equal(rec.sections[0].text(promptContext('s1')), '')
  rec.handlers['agent/created']({ agent: s1 })
  assert.deepEqual(rec.restrictions, [{ deny: ['render_ui'] }])
  await assert.rejects(
    () => rec.tool.execute({ program: VALID, style: 'card' }, { agent: s1 }),
    /render_ui is disabled/,
  )

  const on = rec.command.handler({ agent: s1, rawInput: 'on' })
  assert.equal(on.kind, 'success')
  assert.match(on.text, /on for this session/)
  assert.ok(rec.sections[0].text(promptContext('s1')).length > 10_000)
  assert.deepEqual(viewOf(rec, 's1'), {
    sessionEnable: 'on', sessionStyle: 'inherit', globalEnabled: false, globalStyle: 'auto', enabled: true, style: 'auto', pending: false, onDemand: null,
  })
  assert.equal(rec.disposed.length, 1)
  const value = await rec.tool.execute({ program: VALID, style: 'card' }, { agent: s1 })
  assert.equal(value.statements, 2)
  assert.equal(value.style, 'card')

  const off = rec.command.handler({ agent: s1, rawInput: 'off' })
  assert.match(off.text, /off for this session/)
  assert.equal(rec.sections[0].text(promptContext('s1')), '')

  // Inherit follows the global switch.
  rec.command.handler({ agent: s1, rawInput: 'inherit' })
  assert.equal(rec.sections[0].text(promptContext('s1')), '')
  settings.globalEnabled = true
  assert.ok(rec.sections[0].text(promptContext('s1')).length > 10_000)
  assert.equal(viewOf(rec, 's1').enabled, true)
  assert.equal(viewOf(rec, 's1').sessionEnable, 'inherit')

  // Global on plus a session off override disables only that session.
  rec.command.handler({ agent: s1, rawInput: 'off' })
  assert.equal(rec.sections[0].text(promptContext('s1')), '')
  assert.ok(rec.sections[0].text(promptContext('s2')).length > 10_000)
})

test('style overrides are persisted and forced styles are enforced on the tool', async () => {
  const { rec, home } = mount({ settings: { globalEnabled: true, answerStyle: 'card' } })
  const s1 = makeAgent(rec, 's1')

  assert.equal(viewOf(rec, 's1').style, 'card')
  const style = rec.command.handler({ agent: s1, rawInput: 'style article' })
  assert.equal(style.kind, 'success')
  assert.match(style.text, /article/)
  assert.equal(viewOf(rec, 's1').style, 'article')
  assert.match(rec.sections[0].text(promptContext('s1')), /Answer style for this session: \*\*Article\*\*/)
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'dsh-intelligent-ui.json'), 'utf8')).styles, { s1: 'article' })

  await assert.rejects(
    () => rec.tool.execute({ program: VALID, style: 'card' }, { agent: s1 }),
    /this session's answer style is "article"/,
  )
  const value = await rec.tool.execute({ program: ARTICLE, style: 'article' }, { agent: s1 })
  assert.equal(value.style, 'article')

  rec.command.handler({ agent: s1, rawInput: 'style inherit' })
  assert.equal(viewOf(rec, 's1').style, 'card')
  await assert.rejects(
    () => rec.tool.execute({ program: VALID }, { agent: s1 }),
    /pass style "card"/,
  )
  const inherited = await rec.tool.execute({ program: VALID, style: 'card' }, { agent: s1 })
  assert.equal(inherited.style, 'card')
})

test('auto style accepts a chosen card/article style and records it', async () => {
  const { rec } = mount({ settings: { globalEnabled: true, answerStyle: 'auto' } })
  const s1 = makeAgent(rec, 's1')
  assert.equal((await rec.tool.execute({ program: ARTICLE, style: 'article' }, { agent: s1 })).style, 'article')
  await assert.rejects(
    () => rec.tool.execute({ program: ARTICLE, style: 'auto' }, { agent: s1 }),
    /pass style "card" or "article"/,
  )
  assert.equal((await rec.tool.execute({ program: ARTICLE, style: 'article' }, { agent: s1 })).style, 'article')
})

test('status, idempotence and validation are readable', () => {
  const { rec } = mount({ settings: { globalEnabled: false } })
  const s1 = makeAgent(rec, 's1')
  assert.match(rec.command.handler({ agent: s1, rawInput: '' }).text, /Intelligent UI is off via the global switch/)
  assert.match(rec.command.handler({ agent: s1, rawInput: 'off' }).text, /off for this session/)
  assert.match(rec.command.handler({ agent: s1, rawInput: 'off' }).text, /already off for this session/)
  assert.equal(rec.command.handler({ agent: s1, rawInput: 'nope' }).kind, 'error')
  assert.match(rec.command.handler({ agent: s1, rawInput: 'global' }).text, /Global enabling moved/)
  assert.match(rec.command.handler({ agent: s1, rawInput: 'style nope' }).text, /Usage: \/iui style/)
})

test('persisted session overrides load at startup', () => {
  const mount1 = mount({
    settings: { globalEnabled: false },
    persisted: { sessions: ['s9'], offSessions: ['s8'], styles: { s9: 'article' } },
  })
  const v9 = viewOf(mount1.rec, 's9')
  assert.equal(v9.sessionEnable, 'on')
  assert.equal(v9.sessionStyle, 'article')
  assert.equal(v9.style, 'article')
  const v8 = viewOf(mount1.rec, 's8')
  assert.equal(v8.sessionEnable, 'off')
  assert.equal(v8.enabled, false)

  const legacy = mount({ persisted: { enabled: true } })
  assert.equal(viewOf(legacy.rec, 'any').globalEnabled, true)
  assert.equal(viewOf(legacy.rec, 'any').enabled, true)
})

test('a host without the switch services stays always-on', async () => {
  const { rec } = mount({ modeServices: false })
  assert.equal(rec.projection, undefined)
  assert.equal(rec.command, undefined)
  assert.equal(rec.sections[0].text(promptContext('s1')).length > 10_000, true)
  const value = await rec.tool.execute({ program: VALID, style: 'card' })
  assert.equal(value.statements, 2)
  assert.equal(value.style, 'card')
})

test('persisted custom ids resolve with session visibility and keep dangling selections on the wire', async () => {
  const global = template()
  const local = template({ id: 'cs_111111abcdef', name: 'Private notes', scope: 'session', sessionId: 's1' })
  const missing = 'cs_missing12345'
  const { rec, home } = mount({
    settings: { globalEnabled: true, answerStyle: global.id }, templates: [global, local],
    persisted: { styles: { s1: local.id, s2: local.id, s3: missing, s4: 'garbage' } },
  })
  assert.equal(viewOf(rec, 's1').style, local.id)
  assert.equal(viewOf(rec, 's2').sessionStyle, local.id)
  assert.equal(viewOf(rec, 's2').style, 'auto')
  assert.equal(viewOf(rec, 's3').sessionStyle, missing)
  assert.equal(viewOf(rec, 's3').style, 'auto')
  assert.equal(viewOf(rec, 's4').sessionStyle, 'inherit')
  assert.equal(viewOf(rec, 's4').globalStyle, global.id)
  assert.equal(viewOf(rec, 's4').style, global.id)
  for (const id of ['s1', 's2', 's3', 's4']) assert.equal(rec.projection.wire.viewSchema.safeParse(viewOf(rec, id)).success, true)
  assert.match(rec.sections[0].text(promptContext('s2')), /Answer style for this session: \*\*Auto\*\*/)
  const result = await rec.tool.execute({ program: VALID, style: 'card', styleId: local.id }, promptContext('s2'))
  assert.equal(result.styleId, undefined)
  rec.command.handler({ agent: makeAgent(rec, 's5'), rawInput: 'on' })
  assert.equal(JSON.parse(readFileSync(join(home, 'dsh-intelligent-ui.json'), 'utf8')).styles.s3, missing)
})

test('custom style command names the template and rejects missing or invisible ids', () => {
  const global = template()
  const local = template({ id: 'cs_111111abcdef', name: 'Private notes', scope: 'session', sessionId: 's1' })
  const { rec } = mount({ templates: [global, local], settings: { globalEnabled: true } })
  const s1 = makeAgent(rec, 's1')
  const selected = rec.command.handler({ agent: s1, rawInput: `style ${local.id}` })
  assert.equal(selected.kind, 'success')
  assert.match(selected.text, /Private notes/)
  assert.match(rec.command.handler({ agent: s1, rawInput: '' }).text, /Private notes/)
  assert.equal(viewOf(rec, 's1').style, local.id)
  for (const [agent, rawInput] of [
    [makeAgent(rec, 's2'), `style ${local.id}`], [s1, 'style cs_missing12345'], [s1, 'style cs_bad'], [s1, `style ${global.id.toUpperCase()}`],
  ]) {
    const result = rec.command.handler({ agent, rawInput })
    assert.equal(result.kind, 'error')
    assert.match(result.text, /auto\|card\|article\|inherit\|<cs_id>/)
  }
  assert.equal(viewOf(rec, 's2').sessionStyle, 'inherit')
  assert.equal(rec.command.handler({ agent: s1, rawInput: `style ${global.id}` }).kind, 'success')
  const fold = rec.projection.apply(rec.projection.init({ id: 's1' }), { type: 'command/run', data: { name: 'iui', args: `style ${global.id}`, commandId: 'custom' } })
  assert.deepEqual(fold.command, { commandId: 'custom', kind: 'style' })
})

test('unknown global settings remain visible as strings while the effective style falls back', () => {
  const { rec, settings } = mount({ settings: { globalEnabled: true, answerStyle: 'cs_missing12345' } })
  assert.equal(viewOf(rec, 's1').globalStyle, 'cs_missing12345')
  assert.equal(viewOf(rec, 's1').style, 'auto')
  settings.answerStyle = 'unknown-style'
  assert.equal(viewOf(rec, 's1').globalStyle, 'unknown-style')
  assert.equal(viewOf(rec, 's1').style, 'auto')
  settings.answerStyle = 'x'.repeat(65)
  assert.equal(viewOf(rec, 's1').globalStyle, 'auto')
})

test('styleFor and templateFor follow live selection and fall back after deletion or scope mismatch', () => {
  mount()
  const store = createStyleStore()
  const global = store.create(styleInput())
  const local = store.create(styleInput({ name: 'Local', scope: 'session', sessionId: 's1' }))
  let selection = global.id
  const mode = installSessionControls({}, { answerStyle: { get: () => selection } }, store)
  assert.equal(mode.styleFor(), global.id)
  assert.equal(mode.templateFor('s1').id, global.id)
  selection = local.id
  assert.equal(mode.styleFor('s1'), local.id)
  assert.equal(mode.styleFor('s2'), 'auto')
  assert.equal(mode.styleFor(), 'auto')
  assert.equal(mode.templateFor('s2'), undefined)
  store.remove(local.id)
  assert.equal(mode.styleFor('s1'), 'auto')
  assert.equal(mode.templateFor('s1'), undefined)
  selection = 'article'
  assert.equal(mode.styleFor('s1'), 'article')
  assert.equal(mode.templateFor('s1'), undefined)
})

test('on-demand commands, projection and prompt are transient and session-bound', () => {
  const { rec, home } = mount({ settings: { globalEnabled: false, answerStyle: 'article' } })
  const agent = makeAgent(rec, 's1')
  const invoke = rawInput => rec.command.handler({ agent, rawInput })
  const prompt = () => rec.sections[0].text(promptContext('s1'))
  assert.equal(invoke('on-demand').kind, 'error')
  assert.equal(rec.command.handler({ rawInput: 'on-demand' }).kind, 'error')
  assert.match(invoke('on-demand off').text, /No active/)
  for (const bad of ['on-demand off extra', 'on-demand a b', `on-demand ${'x'.repeat(129)}`, 'on-demand <script>']) assert.equal(invoke(bad).kind, 'error')
  invoke('on')
  const before = readFileSync(join(home, 'dsh-intelligent-ui.json'), 'utf8')
  const state = rec.projection.init({ id: 's1' })
  const folded = rec.projection.apply(state, { type: 'command/run', data: { name: 'iui', args: 'on-demand tab-1', commandId: 'arm' } })
  assert.equal(folded.command.kind, 'on-demand')
  assert.equal(rec.projection.wire.view(folded).pending, true)
  assert.match(invoke('on-demand tab-1').text, /armed/)
  assert.equal(viewOf(rec, 's1').onDemand.status, 'armed')
  assert.equal(viewOf(rec, 's1').onDemand.clientInstanceId, 'tab-1')
  // Prompt assembly precedes the first user/message event; the armed operation must
  // already inject the request-level note, then narrow to the bound turn.
  assert.match(prompt(), /ON-DEMAND UI/)
  rec.handlers['session/event']({ id: 's1' }, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  const message = { type: 'user/message', seq: 2, data: { id: 'human-1', source: { kind: 'user' } } }
  rec.handlers['session/event']({ id: 's1' }, message)
  assert.notEqual(rec.projection.apply(state, message), state, 'live operations must invalidate the projection wire view')
  assert.equal(viewOf(rec, 's1').onDemand.status, 'running')
  assert.match(invoke('').text, /On-demand UI: running/)
  assert.ok(prompt().indexOf('ON-DEMAND UI') < prompt().indexOf('Answer style for this session'))
  assert.doesNotMatch(rec.sections[0].text(promptContext('s2')), /ON-DEMAND UI/)
  assert.match(invoke('on-demand tab-2').text, /already running/)
  assert.match(invoke('on-demand off').text, /cancelled/)
  assert.equal(viewOf(rec, 's1').onDemand.status, 'cancelled')
  assert.doesNotMatch(prompt(), /ON-DEMAND UI/)
  assert.equal(readFileSync(join(home, 'dsh-intelligent-ui.json'), 'utf8'), before)
  invoke('off')
  assert.equal(prompt(), '')
})

test('adjust command projects its parent; explicit style choices and scope off cancel intent', () => {
  const { rec } = mount({ settings: { globalEnabled: true } })
  const agent = makeAgent(rec, 's1')
  const invoke = rawInput => rec.command.handler({ agent, rawInput })
  for (const bad of ['on-demand tab adjust', 'on-demand tab adjust r extra', 'on-demand off adjust r', 'on-demand <bad> adjust r', 'on-demand tab adjust <bad>', `on-demand tab adjust ${'x'.repeat(201)}`]) {
    assert.equal(invoke(bad).kind, 'error', bad)
  }
  assert.equal(invoke('on-demand tab adjust parent-result').kind, 'success')
  const armed = viewOf(rec, 's1')
  assert.equal(armed.onDemand.kind, 'adjust')
  assert.equal(armed.onDemand.parentResultId, 'parent-result')
  assert.equal(rec.projection.wire.viewSchema.safeParse(armed).success, true)
  assert.equal(rec.projection.wire.viewSchema.safeParse({ ...armed, onDemand: { ...armed.onDemand, resume: true } }).success, true)
  rec.handlers['session/event']({ id: 's1' }, { type: 'user/message', seq: 1, data: { id: 'adjust-user', source: { kind: 'user' } } })
  assert.match(rec.sections[0].text(promptContext('s1')), /style adjustment.*parent-result/)
  assert.equal(invoke('style article').kind, 'success')
  assert.equal(viewOf(rec, 's1').onDemand.status, 'cancelled')
  assert.doesNotMatch(rec.sections[0].text(promptContext('s1')), /ON-DEMAND UI/)
  for (const command of ['style article', 'style inherit', 'off']) {
    invoke('on-demand tab')
    assert.equal(invoke(command).kind, 'success')
    assert.equal(viewOf(rec, 's1').onDemand.status, 'cancelled', command)
  }
})
