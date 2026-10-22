import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOnDemandController, ON_DEMAND_ARM_TTL } from '../../src/host/on-demand.ts'

/** Feed installed DSH event shapes through the real subscriptions, without a model. */
function fixture() {
  const handlers = {}
  let time = 100
  let seq = 0
  const controller = createOnDemandController({ on(name, fn) { handlers[name] = fn } }, { now: () => time })
  return {
    controller,
    advance(ms) { time += ms },
    event(type, data, sessionId = 's1') { handlers['session/event']({ id: sessionId }, { type, data, seq: ++seq }) },
    dispose(id) { handlers['session/disposed']({ id }) },
  }
}
const human = id => ({ id, source: { kind: 'user' }, content: [] })
const call = (name, callId, turn = 1) => ({ name, callId, turn, step: 1, arguments: '{}' })
const result = (toolCallId, isError = false, content = [], turn = 1) => ({ turn, step: 1, message: { toolCallId, isError, content } })

test('arms, binds a human message, clarifies, resumes and completes with a compact terminal projection', () => {
  const { controller: c, event } = fixture()
  assert.match(c.arm('s1', 'tab-1'), /armed/)
  assert.equal(c.allowsTemporaryStyle('s1'), false)
  // The loop renders a turn's system prompt before the first user/message event,
  // so the note must already be available while the operation is merely armed.
  assert.match(c.promptNote('s1'), /ON-DEMAND UI/)
  assert.match(c.promptNote('s1'), /Host rejects a render_ui call without temporaryStyle/)
  assert.match(c.promptNote('s1'), /GROUND THE CONTENT FIRST/)
  assert.match(c.promptNote('s1'), /do NOT invent placeholder/)
  assert.match(c.promptNote('s1'), /ask_user_question first/)
  event('turn/start', { turn: 1 })
  event('user/message', human('user-1'))
  assert.equal(c.view('s1').triggerMessageId, 'user-1')
  assert.equal(c.view('s1').status, 'running')
  assert.match(c.promptNote('s1'), /1–3 concise structured questions/)
  event('tool/call', call('ask_user_question', 'q1'))
  assert.equal(c.view('s1').status, 'clarifying')
  assert.equal(c.view('s1').clarificationRounds, 1)
  assert.equal(c.allowsTemporaryStyle('s1'), true)
  event('tool/call', call('render_ui', 'premature'))
  assert.equal(c.allowsTemporaryStyle('s1', 'premature'), false)
  event('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal(c.view('s1').status, 'clarifying')
  event('turn/start', { turn: 2 })
  event('user/message', human('answer-1'))
  assert.equal(c.view('s1').triggerMessageId, 'user-1')
  event('tool/call', call('render_ui', 'r1', 2))
  event('tool/result', result('different', false, [], 2))
  assert.equal(c.view('s1').status, 'running')
  event('tool/result', result('r1', false, [], 2))
  assert.equal(c.view('s1').status, 'completed')
  assert.deepEqual(c.projection('s1'), { operationId: c.view('s1').operationId, status: 'completed', kind: 'generate', clientInstanceId: 'tab-1', resultIds: ['r1'] })
  assert.equal(c.allowsTemporaryStyle('s1'), false)
  assert.equal(c.promptNote('s1'), undefined)
  event('user/message', human('ordinary-later'))
  assert.equal(c.view('s1').status, 'completed')
  const detached = c.view('s1')
  detached.resultIds.push('tampered')
  assert.deepEqual(c.view('s1').resultIds, ['r1'])
})

test('blocking question results resume; timed timeout waits for a correlated late reply', () => {
  const { controller: c, event } = fixture()
  c.arm('s1')
  event('user/message', human('first'))
  event('tool/call', call('ask_user_question', 'q1'))
  event('tool/result', result('q1', false, [{ type: 'text', text: JSON.stringify({ answers: [{ id: 'density', selected: [], custom: 'compact' }] }) }]))
  assert.equal(c.view('s1').status, 'running')
  event('tool/call', call('ask_user_question', 'q2'))
  event('tool/result', result('q2', false, [{ type: 'text', text: '{"status":"pending"}' }]))
  assert.equal(c.view('s1').status, 'clarifying')
  event('user/message', { id: 'wrong-reply', source: { kind: 'user-question-reply', callId: 'wrong' } })
  assert.equal(c.view('s1').status, 'clarifying')
  event('user/message', { id: 'late-answer', source: { kind: 'user-question-reply', callId: 'q2' } })
  assert.equal(c.view('s1').status, 'running')
  event('tool/call', call('render_ui', 'r'))
  assert.equal(c.allowsTemporaryStyle('s1', 'r'), true)
})

test('cancel and replacement revoke old call identities, including late results in another operation', () => {
  const { controller: c, event } = fixture()
  c.arm('s1')
  event('user/message', human('first'))
  event('tool/call', call('render_ui', 'old'))
  // A second click cannot silently replace a turn that is already bound.
  assert.match(c.arm('s1', 'tab-2'), /already running/)
  const previous = c.view('s1').operationId
  c.cancel('s1')
  assert.match(c.arm('s1', 'tab-2'), /armed/)
  assert.notEqual(c.view('s1').operationId, previous)
  event('user/message', human('second'))
  assert.equal(c.allowsTemporaryStyle('s1', 'old'), false)
  event('tool/result', result('old'))
  assert.equal(c.view('s1').status, 'running')
  event('tool/call', call('render_ui', 'new'))
  c.cancel('s1')
  assert.equal(c.complete('s1', { resultId: 'new' }), false)
  event('tool/result', result('new'))
  assert.equal(c.view('s1').status, 'cancelled')
  assert.equal(c.promptNote('s1'), undefined)
  assert.match(c.cancel('s1'), /No active/)
})

test('a text-only completed turn keeps the intent armed for missing content; real failures clear authorization', () => {
  for (const [reason, expected] of [
    [{ kind: 'error' }, 'failed'], [{ kind: 'blocked' }, 'failed'], [{ kind: 'max-tokens' }, 'failed'],
    [{ kind: 'interrupted' }, 'interrupted'], [{ kind: 'aborted', reason: { kind: 'user' } }, 'cancelled'],
    [{ kind: 'aborted', reason: { kind: 'disposed' } }, 'interrupted'],
  ]) {
    const { controller: c, event } = fixture()
    c.arm('s1')
    event('turn/start', { turn: 1 })
    event('user/message', human('m'))
    event('tool/call', call('render_ui', 'bad'))
    event('tool/result', result('bad', true))
    assert.equal(c.view('s1').status, 'running')
    event('turn/end', { turn: 1, reason })
    assert.equal(c.view('s1').status, expected)
    assert.equal(c.allowsTemporaryStyle('s1'), false)
    assert.equal(c.promptNote('s1'), undefined)
  }
})

test('a completed turn without a render re-arms the same operation with a resume flag', () => {
  const { controller: c, event } = fixture()
  c.arm('s1', 'tab-1')
  event('turn/start', { turn: 1 })
  event('user/message', human('missing-content'))
  event('tool/call', call('ask_user_question', 'q1'))
  event('tool/result', result('q1', false, [{ type: 'text', text: JSON.stringify({ answers: [{ id: 'content', selected: ['link'], custom: '' }] }) }]))
  event('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal(c.view('s1').status, 'armed')
  assert.equal(c.view('s1').triggerMessageId, undefined)
  assert.deepEqual(c.projection('s1'), { operationId: c.view('s1').operationId, status: 'armed', kind: 'generate', clientInstanceId: 'tab-1', resultIds: [], resume: true })
  assert.match(c.promptNote('s1'), /GROUND THE CONTENT FIRST/)
  event('turn/start', { turn: 2 })
  event('user/message', human('pasted-content'))
  assert.equal(c.view('s1').status, 'running')
  assert.equal(c.projection('s1').resume, undefined, 'binding the next message clears the resume flag')
  event('tool/call', call('render_ui', 'after-content', 2))
  assert.equal(c.allowsTemporaryStyle('s1', 'after-content'), true)
  event('tool/result', result('after-content', false, [], 2))
  assert.equal(c.view('s1').status, 'completed')
})

test('TTL, session isolation, disposal, injected context filtering and seq fallback', () => {
  const { controller: c, event, advance, dispose } = fixture()
  c.arm('s1')
  c.arm('s2')
  event('user/message', { id: 'skill', source: { kind: 'plugin' } })
  assert.equal(c.view('s1').status, 'armed')
  advance(ON_DEMAND_ARM_TTL - 1)
  assert.equal(c.view('s1').status, 'armed')
  event('user/message', human('s2-message'), 's2')
  advance(1)
  assert.equal(c.view('s1').status, 'interrupted')
  assert.equal(c.view('s2').status, 'running')
  assert.equal(c.allowsTemporaryStyle('s1'), false)
  c.arm('s1')
  event('user/message', { source: { kind: 'user' } })
  assert.match(c.view('s1').triggerMessageId, /^seq:\d+$/)
  dispose('s1')
  assert.equal(c.view('s1'), null)
  assert.equal(c.view('s2').status, 'running')
})

test('bounded ids, calls, rounds and retained sessions', () => {
  const { controller: c, event } = fixture()
  assert.match(c.arm('x'.repeat(201)), /Invalid/)
  c.arm('s1')
  event('user/message', human('m'))
  for (let i = 0; i < 9; i++) event('tool/call', call('render_ui', `r${i}`))
  assert.equal(c.view('s1').status, 'failed')
  c.arm('s1')
  event('user/message', human('m2'))
  for (let i = 0; i < 3; i++) {
    event('tool/call', call('ask_user_question', `q${i}`))
    if (i < 2) event('user/message', human(`answer${i}`))
  }
  assert.equal(c.view('s1').status, 'failed')
  for (let i = 0; i < 256; i++) c.arm(`session-${i}`)
  assert.match(c.arm('overflow'), /Too many/)
  c.cancel('session-0')
  assert.match(c.arm('overflow'), /armed/)
})

test('operation updates precede an already-installed projection listener on the same committed event', () => {
  const listeners = []
  const projected = []
  let c
  const ctx = { on(name, fn, prepend) { if (name === 'session/event') prepend ? listeners.unshift(fn) : listeners.push(fn) } }
  // The DSH projection service generally exists before this plugin is installed.
  ctx.on('session/event', () => projected.push(c.projection('s1').status))
  c = createOnDemandController(ctx)
  c.arm('s1')
  for (const event of [
    { type: 'user/message', seq: 1, data: human('human') },
    { type: 'turn/end', seq: 2, data: { reason: { kind: 'completed' } } },
  ]) for (const listener of listeners) listener({ id: 's1' }, event)
  assert.deepEqual(projected, ['running', 'armed'])
})

test('adjustment binds its parent, names the snapshot and completes with a new result', () => {
  const { controller: c, event } = fixture()
  c.arm('s1', 'tab-1', { kind: 'adjust', parentResultId: 'call:previous-1' })
  assert.equal(c.projection('s1').kind, 'adjust')
  assert.equal(c.projection('s1').parentResultId, 'call:previous-1')
  assert.match(c.promptNote('s1'), /\*\*style adjustment\*\*.*call:previous-1/)
  event('user/message', human('adjust-message'))
  assert.match(c.promptNote('s1'), /\*\*style adjustment\*\*.*call:previous-1/)
  assert.match(c.promptNote('s1'), /Reuse that result's `temporaryStyle` snapshot/)
  assert.match(c.promptNote('s1'), /keep the content/)
  event('tool/call', call('render_ui', 'new-result'))
  event('tool/result', result('new-result'))
  assert.deepEqual(c.projection('s1').resultIds, ['new-result'])
  assert.equal(c.projection('s1').parentResultId, 'call:previous-1')
  assert.equal(c.projection('s1').status, 'completed')
})

test('invalid adjustment and tab tokens cannot replace an existing operation', () => {
  const { controller: c } = fixture()
  c.arm('s1', 'valid-token')
  const id = c.view('s1').operationId
  for (const token of ['', 'off', 'OFF', 'bad token', 'x'.repeat(129), 'x\n', '<script>']) assert.match(c.arm('s1', token), /Invalid/)
  for (const parentResultId of [undefined, '', 'x'.repeat(201), 'x y', 'x\n', '`injection`', '<script>']) {
    assert.match(c.arm('s1', 'valid-token', { kind: 'adjust', parentResultId }), /Invalid/)
  }
  assert.match(c.arm('s1', 'valid-token', { parentResultId: 'unexpected' }), /Invalid/)
  assert.equal(c.view('s1').operationId, id)
})
