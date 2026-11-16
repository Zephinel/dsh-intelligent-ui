/**
 * Reproduction test for PTC-dispatched render_ui calls.
 *
 * DSH models a PTC dispatch as one root Tool lifecycle whose `data.root`
 * carries the dispatched children in `root.subCalls` (see the chat client's
 * `projectBlock`). The extractor under test only reads `node.root`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { programsFromToolNodes } from '../../src/client/programs.ts'

const PROGRAM = 'root = Card([Text("bounce buffer")])'

/**
 * One PTC-dispatched render_ui child, shaped like the chat client's
 * `childResult`: a settled tool-result with the paired call head.
 */
function ptcChild(callId, args) {
  return {
    kind: 'tool-result',
    seq: 42,
    time: 1_700_000_000_000,
    callId,
    parentCallId: 'call-root',
    name: 'render_ui',
    argsRaw: JSON.stringify(args),
    call: { name: 'render_ui', argsRaw: JSON.stringify(args) },
    callTime: 1_700_000_000_000,
    content: [],
    isError: false,
    subCalls: [],
  }
}

/** The parent run_code lifecycle, with the dispatched child under subCalls. */
function ptcParent(children) {
  return {
    root: {
      kind: 'tool-result',
      seq: 40,
      time: 1_700_000_000_000,
      callId: 'call-root',
      name: 'run_code',
      isError: false,
      call: { name: 'run_code', argsRaw: JSON.stringify({ code: 'await tools.render_ui({...})' }) },
      subCalls: children,
    },
  }
}

test('a render_ui dispatched through PTC yields its program', () => {
  assert.deepEqual(programsFromToolNodes([ptcParent([ptcChild('call-root:ptc:1', { program: PROGRAM })])]), [
    { callId: 'call-root:ptc:1', program: PROGRAM, running: false },
  ])
})

test('a PTC render_ui that is still running yields its program as running', () => {
  const running = {
    phase: 'start',
    callId: 'call-root:ptc:2',
    parentCallId: 'call-root',
    name: 'render_ui',
    argsRaw: JSON.stringify({ program: PROGRAM }),
    subCalls: [],
  }
  assert.deepEqual(programsFromToolNodes([ptcParent([running])]), [
    { callId: 'call-root:ptc:2', program: PROGRAM, running: true },
  ])
})

test('a PTC dispatch without render_ui contributes nothing', () => {
  const other = { ...ptcChild('call-root:ptc:3', { program: PROGRAM }), name: 'read' }
  assert.deepEqual(programsFromToolNodes([ptcParent([other])]), [])
})
