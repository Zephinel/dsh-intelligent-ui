/**
 * Unit tests for the assistant-message export lookups.
 *
 * Run: node --test test/client/export-data.test.mjs
 *
 * The module is imported as TypeScript source: Node >= 22.18 strips type
 * annotations natively, so the test needs no build step.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  messageHasRenderUi,
  programsForMessage,
  turnForMessage,
  turnHasRenderUi,
} from '../../src/client/export-data.ts'

const PROGRAM = 'root = Card([Text("hello")])'
const MESSAGE = 'msg-1'
const TURN = 3

/** One assistant-step node closing the message at `turn`. */
function assistantNode(messageId, turn) {
  return { kind: 'assistant-step', data: { turn, finalNode: { messageId } } }
}

/** One settled render_ui tool-call node. */
function settled(callId, args, options = {}) {
  return {
    root: {
      kind: 'tool-result',
      callId,
      name: options.name ?? 'render_ui',
      isError: options.isError ?? false,
      call: options.missingArgs === true ? null : { name: options.name ?? 'render_ui', argsRaw: JSON.stringify(args) },
    },
  }
}

/** One running render_ui node. */
function started(callId, args) {
  return { root: { phase: 'start', callId, name: 'render_ui', argsRaw: JSON.stringify(args) } }
}

/**
 * Build a structural Chat snapshot with one assistant message and one Turn's tool nodes.
 * @param {object} [options]
 */
function snapshot({ messages = [[MESSAGE, TURN]], toolNodes = () => [settled('call-1', { program: PROGRAM, title: 'Hello' })], throws = false } = {}) {
  const nodes = messages.map(([id, turn]) => assistantNode(id, turn))
  return {
    nodes: {
      values: () => nodes.values(),
      turnDataSource: (turn, kind) => {
        assert.equal(kind, 'tool-call')
        if (throws) throw new Error('no source')
        return { getSnapshot: () => (turn === TURN ? toolNodes(turn) : []) }
      },
    },
  }
}

test('resolves the Turn that owns a finalized assistant message', () => {
  assert.equal(turnForMessage(snapshot(), MESSAGE), TURN)
})

test('unknown or synthetic messages resolve to no Turn', () => {
  const other = snapshot()
  assert.equal(turnForMessage(other, 'missing'), undefined)
  assert.equal(turnForMessage(snapshot({ messages: [[MESSAGE, TURN], ['msg-2', 4]] }), 'msg-2'), 4)
})

test('a Turn with a settled render_ui call is exportable', () => {
  const other = snapshot()
  assert.equal(turnHasRenderUi(other, TURN), true)
  assert.equal(messageHasRenderUi(other, MESSAGE), true)
})

test('other tools, failed calls and missing arguments are not exportable', () => {
  assert.equal(messageHasRenderUi(snapshot({ toolNodes: () => [settled('c1', { program: PROGRAM }, { name: 'other_tool' })] }), MESSAGE), false)
  assert.equal(messageHasRenderUi(snapshot({ toolNodes: () => [settled('c1', { program: PROGRAM }, { isError: true })] }), MESSAGE), false)
  assert.equal(messageHasRenderUi(snapshot({ toolNodes: () => [settled('c1', { program: PROGRAM }, { missingArgs: true })] }), MESSAGE), false)
})

test('a running render_ui call is still exportable', () => {
  assert.equal(messageHasRenderUi(snapshot({ toolNodes: () => [started('c1', { program: PROGRAM })] }), MESSAGE), true)
})

test('every render_ui program of the Turn is returned in order', () => {
  const other = snapshot({
    toolNodes: () => [
      settled('call-1', { program: 'root = Title("one")', title: 'One' }),
      settled('call-2', { program: 'root = Title("two")', title: 'Two' }),
    ],
  })
  assert.deepEqual(programsForMessage(other, MESSAGE), [
    { callId: 'call-1', program: 'root = Title("one")', title: 'One', running: false },
    { callId: 'call-2', program: 'root = Title("two")', title: 'Two', running: false },
  ])
})

test('messages without a Turn or without a readable source return no programs', () => {
  assert.deepEqual(programsForMessage(snapshot(), 'missing'), [])
  assert.equal(turnHasRenderUi(snapshot({ throws: true }), TURN), false)
  assert.deepEqual(programsForMessage(snapshot({ throws: true }), MESSAGE), [])
})

test('the message index is cached per immutable snapshot', () => {
  const other = snapshot()
  assert.equal(turnForMessage(other, MESSAGE), TURN)
  // The second read must not depend on a functioning nodes iterator; the cache
  // carries the resolved index for this snapshot object.
  other.nodes.values = () => { throw new Error('should not rebuild') }
  assert.equal(turnForMessage(other, MESSAGE), TURN)
})
