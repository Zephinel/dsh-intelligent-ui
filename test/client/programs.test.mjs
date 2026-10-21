/**
 * Unit tests for the browser-half program extractor.
 *
 * Run: node --test test/client/programs.test.mjs
 *
 * The extractor is imported as TypeScript source: Node >= 22.18 strips type
 * annotations natively, so the test needs no build step and no dependencies.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { programsFromToolNodes } from '../../src/client/programs.ts'

const PROGRAM = 'root = Card([Text("hello")])'

/** @param {string} callId @param {Record<string, unknown>} args */
function started(callId, args, name = 'render_ui') {
  return { root: { phase: 'start', callId, name, argsRaw: JSON.stringify(args) } }
}

/**
 * @param {string} callId
 * @param {Record<string, unknown> | null} args
 * @param {{ name?: string, isError?: boolean }} [options]
 */
function settled(callId, args, options = {}) {
  const name = options.name ?? 'render_ui'
  return {
    root: {
      kind: 'tool-result',
      callId,
      name,
      isError: options.isError ?? false,
      call: args === null ? null : { name, argsRaw: JSON.stringify(args) },
    },
  }
}

test('a dispatched render_ui call yields its program as running', () => {
  assert.deepEqual(programsFromToolNodes([started('call-1', { program: PROGRAM })]), [
    { callId: 'call-1', program: PROGRAM, running: true },
  ])
})

test('a settled render_ui call yields its program as finished', () => {
  assert.deepEqual(programsFromToolNodes([settled('call-2', { program: PROGRAM, title: 'Weather' })]), [
    { callId: 'call-2', program: PROGRAM, title: 'Weather', running: false },
  ])
})

test('a failed render_ui result is skipped; the Tool row owns that failure', () => {
  assert.deepEqual(programsFromToolNodes([settled('call-3', { program: PROGRAM }, { isError: true })]), [])
  // A rejected attempt followed by a successful retry in the same Turn.
  assert.deepEqual(programsFromToolNodes([
    settled('call-3a', { program: 'root = Nope()' }, { isError: true }),
    settled('call-3b', { program: PROGRAM }),
  ]), [{ callId: 'call-3b', program: PROGRAM, running: false }])
})

test('a result whose call head left the history window is skipped', () => {
  assert.deepEqual(programsFromToolNodes([settled('call-4', null)]), [])
})

test('other tools are skipped', () => {
  assert.deepEqual(programsFromToolNodes([
    started('call-5', { program: PROGRAM }, 'bash'),
    settled('call-6', { program: PROGRAM }, { name: 'read' }),
  ]), [])
})

test('a preparing call carries no complete arguments and is skipped', () => {
  assert.deepEqual(programsFromToolNodes([
    { root: { phase: 'preparing', callId: 'call-7', name: 'render_ui' } },
  ]), [])
})

test('malformed JSON and non-object arguments are skipped', () => {
  const badJson = { root: { phase: 'start', callId: 'call-8', name: 'render_ui', argsRaw: '{not json' } }
  assert.deepEqual(programsFromToolNodes([badJson, started('call-9', { program: 42 })]), [])
})

test('program must be a non-empty string', () => {
  assert.deepEqual(programsFromToolNodes([
    started('call-10', {}),
    started('call-11', { program: '' }),
    started('call-12', { program: '   ' }),
    started('call-13', { program: null }),
  ]), [])
})

test('a non-string title is dropped, keeping the program', () => {
  assert.deepEqual(programsFromToolNodes([started('call-14', { program: PROGRAM, title: 7 })]), [
    { callId: 'call-14', program: PROGRAM, running: true },
  ])
})

test('invocation order is preserved and an absent node list is empty', () => {
  assert.deepEqual(programsFromToolNodes([
    started('call-15', { program: 'one' }),
    started('call-16', { program: PROGRAM }, 'bash'),
    settled('call-17', { program: 'two' }),
  ]), [
    { callId: 'call-15', program: 'one', running: true },
    { callId: 'call-17', program: 'two', running: false },
  ])
  assert.deepEqual(programsFromToolNodes(undefined), [])
  assert.deepEqual(programsFromToolNodes([]), [])
})

test('a valid style is kept and an invalid style is dropped', () => {
  assert.deepEqual(programsFromToolNodes([
    started('call-18', { program: PROGRAM, style: 'article' }),
    settled('call-19', { program: PROGRAM, style: 'card' }),
    started('call-20', { program: PROGRAM, style: 'huge' }),
    started('call-21', { program: PROGRAM, style: 'auto' }),
  ]), [
    { callId: 'call-18', program: PROGRAM, style: 'article', running: true },
    { callId: 'call-19', program: PROGRAM, style: 'card', running: false },
    { callId: 'call-20', program: PROGRAM, running: true },
    { callId: 'call-21', program: PROGRAM, running: true },
  ])
})
