import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClientTokenReader } from '../../src/client/client-token.ts'
import { onDemandCommand, sameView } from '../../src/client/commands.ts'
import { fillComposer } from '../../src/client/composer.ts'

test('tab token persists across readers and falls back to memory when storage is blocked', () => {
  const values = new Map()
  const storage = () => ({ getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) })
  const read = createClientTokenReader({ storage, uuid: () => 'tab-1' })
  assert.equal(read(), 'tab-1')
  assert.equal(read(), 'tab-1')
  assert.equal(createClientTokenReader({ storage, uuid: () => 'unused' })(), 'tab-1')
  for (const denied of [() => { throw Error('denied') }, () => ({ getItem: () => null, setItem: () => { throw Error('denied') } }), () => undefined]) {
    let calls = 0
    const fallback = createClientTokenReader({ storage: denied, uuid: () => `tab-${++calls}` })
    assert.equal(fallback(), fallback())
    assert.equal(calls, 1)
  }
  values.set([...values.keys()][0], 'bad token')
  assert.equal(createClientTokenReader({ storage, uuid: () => 'replacement' })(), 'replacement')
})

test('commands bind the tab and parent result without allowing command injection', () => {
  assert.equal(onDemandCommand('arm', 'tab-1'), '/iui on-demand tab-1')
  assert.equal(onDemandCommand('cancel'), '/iui on-demand off')
  assert.equal(onDemandCommand('adjust', 'tab-1', 'call:result-2'), '/iui on-demand tab-1 adjust call:result-2')
  for (const token of [undefined, '', 'off', 'OFF', 'x y', 'x\n', 'x'.repeat(129)]) assert.throws(() => onDemandCommand('arm', token))
  for (const id of [undefined, '', 'x y', 'x\n', '`injection`', 'x'.repeat(201)]) assert.throws(() => onDemandCommand('adjust', 'tab', id))
  assert.equal(sameView({ onDemand: { kind: 'adjust', parentResultId: 'r1' } }, { onDemand: { kind: 'adjust', parentResultId: 'r2' } }), false)
})

function editor(draft = '', occurrences = []) {
  let text = draft
  let rev = 1
  const calls = []
  const state = () => ({ draft: text, draftRev: rev, phase: 'plain', occurrences })
  const actions = {
    captureInsertion: () => ({ start: 0, end: text.length, draftRev: rev }),
    insertText(value, span) { calls.push({ value, span }); text += value; rev++; return true },
  }
  return { actions, state, calls, text: () => text }
}

test('examples append after any selection and preserve references; adjust only fills an empty draft', () => {
  const empty = editor()
  assert.equal(fillComposer(empty.actions, empty.state(), 'Example'), true)
  assert.equal(empty.text(), 'Example')
  const existing = editor('Already typed')
  assert.equal(fillComposer(existing.actions, existing.state(), 'Example'), true)
  assert.equal(existing.text(), 'Already typed\nExample')
  assert.deepEqual(existing.calls[0].span, { start: 13, end: 13, draftRev: 1 })
  assert.equal(fillComposer(existing.actions, existing.state(), 'Adjust: ', true), true)
  assert.equal(existing.calls.length, 1)
  const references = editor('See @long-reference', [{ length: 15 }])
  fillComposer(references.actions, references.state(), 'Example')
  assert.equal(references.calls[0].span.start, references.state().draft.length - '\nExample'.length - 14)
  const whitespace = editor('  ')
  fillComposer(whitespace.actions, whitespace.state(), 'Adjust: ', true)
  assert.equal(whitespace.text(), '  ', 'even whitespace is preserved for adjustments')
  assert.equal(fillComposer(empty.actions, { ...empty.state(), phase: 'submitting' }, 'No'), false)
  assert.equal(fillComposer(empty.actions, { ...empty.state(), draftRev: 0 }, 'No'), false)
  assert.equal(fillComposer({ ...empty.actions, insertText: () => false }, empty.state(), 'No'), false)
})
