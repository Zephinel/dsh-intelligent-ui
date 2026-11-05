/**
 * Unit tests for the B2-6 runtime-state snapshot store.
 *
 * Run: node --test test/client/runtime-state.test.mjs
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_RUNTIME_STATE_ARTIFACTS,
  MAX_RUNTIME_STATE_JSON_CHARS,
  MAX_RUNTIME_STATE_REVISIONS,
  clearRuntimeState,
  recordRuntimeState,
  resetRuntimeStateForTests,
  runtimeStateForProgram,
  runtimeStateRevisionCountForTests,
} from '../../src/client/runtime-state.ts'

/** One artifact/revision identity used by most cases. */
const artifact = 'artifact-1'
/** Revision 1 of the artifact. */
const revisionOne = { artifactId: artifact, revisionId: 'rev-1', callId: 'rev-1' }
/** Editing state snapshot for revision 1. */
const stateOne = {
  $answer: 'yes',
  signup: { email: { value: 'a@example.com', componentType: 'Input' } },
}

beforeEach(() => {
  resetRuntimeStateForTests()
})

test('a first render has no runtime state', () => {
  assert.equal(runtimeStateForProgram({ callId: 'call-1' }), undefined)
  recordRuntimeState({ artifactId: artifact, revisionId: 'rev-1', callId: 'rev-1' }, stateOne)
  // Still no base revision: the card is a first render and must not inherit.
  assert.equal(runtimeStateForProgram({ callId: 'call-1' }), undefined)
})

test('recording a revision can be resolved for the same revision', () => {
  recordRuntimeState(revisionOne, stateOne)
  assert.deepEqual(runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-1', baseRevisionId: 'rev-1' }), stateOne)
})

test('an edited revision inherits the snapshot of its base revision', () => {
  recordRuntimeState(revisionOne, stateOne)
  recordRuntimeState({ artifactId: artifact, revisionId: 'rev-1', callId: 'rev-1' }, { ...stateOne, $answer: 'later' })
  const inherited = runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-2', baseRevisionId: 'rev-1' })
  assert.deepEqual(inherited, { ...stateOne, $answer: 'later' })
})

test('a missing base snapshot falls back to the latest snapshot', () => {
  recordRuntimeState(revisionOne, stateOne)
  const inherited = runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-3', baseRevisionId: 'rev-unknown' })
  assert.deepEqual(inherited, stateOne)
})

test('the latest snapshot is not used for a first render', () => {
  recordRuntimeState(revisionOne, stateOne)
  assert.equal(runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-1' }), undefined)
  assert.equal(runtimeStateForProgram({ artifactId: artifact, callId: 'rev-1' }), undefined)
})

test('returned and recorded states are clone-isolated', () => {
  recordRuntimeState(revisionOne, stateOne)
  const first = runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-1', baseRevisionId: 'rev-1' })
  assert.deepEqual(first, stateOne)
  first.signup.email.value = 'mutated@example.com'
  assert.equal(runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-1', baseRevisionId: 'rev-1' }).signup.email.value, 'a@example.com')
  // Mutating the source object after recording must not change the cache.
  const source = { $answer: 'source' }
  recordRuntimeState({ artifactId: artifact, revisionId: 'rev-3', callId: 'rev-3' }, source)
  source.$answer = 'changed-after-record'
  assert.equal(runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-3', baseRevisionId: 'rev-3' }).$answer, 'source')
})

test('non-object and non-JSON states are ignored', () => {
  recordRuntimeState(revisionOne, stateOne)
  recordRuntimeState(revisionOne, null)
  recordRuntimeState(revisionOne, [1, 2, 3])
  recordRuntimeState(revisionOne, 'not an object')
  recordRuntimeState(revisionOne, 42)
  const circular = {}
  circular.self = circular
  recordRuntimeState(revisionOne, circular)
  const after = runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-1', baseRevisionId: 'rev-1' })
  assert.deepEqual(after, stateOne)
})

test('oversized states are ignored', () => {
  recordRuntimeState(revisionOne, stateOne)
  const oversized = { $blob: 'x'.repeat(MAX_RUNTIME_STATE_JSON_CHARS + 1) }
  recordRuntimeState(revisionOne, oversized)
  const after = runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-1', baseRevisionId: 'rev-1' })
  assert.deepEqual(after, stateOne)
})

test('missing artifact/revision ids are ignored', () => {
  recordRuntimeState({ callId: '' }, stateOne)
  recordRuntimeState({ artifactId: artifact }, stateOne)
  recordRuntimeState({ revisionId: 'rev-1' }, stateOne)
  assert.equal(runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-1', baseRevisionId: 'rev-1' }), undefined)
})

test('callId is used when artifactId/revisionId are absent', () => {
  recordRuntimeState({ callId: 'call-only' }, { $flag: true })
  assert.deepEqual(runtimeStateForProgram({ callId: 'call-only', baseRevisionId: 'call-only' }), { $flag: true })
})

test('revision snapshots per artifact stay bounded with latest preserved', () => {
  for (let index = 1; index <= MAX_RUNTIME_STATE_REVISIONS + 3; index += 1) {
    recordRuntimeState({ artifactId: artifact, revisionId: `rev-${index}`, callId: `rev-${index}` }, { index })
  }
  assert.equal(runtimeStateRevisionCountForTests(artifact), MAX_RUNTIME_STATE_REVISIONS)
  // The newest revision is still directly resolvable and is also the latest fallback.
  assert.deepEqual(
    runtimeStateForProgram({ artifactId: artifact, revisionId: `rev-${MAX_RUNTIME_STATE_REVISIONS + 3}`, baseRevisionId: `rev-${MAX_RUNTIME_STATE_REVISIONS + 3}` }),
    { index: MAX_RUNTIME_STATE_REVISIONS + 3 },
  )
  assert.deepEqual(
    runtimeStateForProgram({ artifactId: artifact, revisionId: 'missing-base', baseRevisionId: 'missing-base' }),
    { index: MAX_RUNTIME_STATE_REVISIONS + 3 },
  )
  // The oldest revision was evicted: base lookup falls back to latest.
  assert.deepEqual(
    runtimeStateForProgram({ artifactId: artifact, revisionId: 'x', baseRevisionId: 'rev-1' }),
    { index: MAX_RUNTIME_STATE_REVISIONS + 3 },
  )
})

test('artifacts are bounded and the oldest artifact is evicted', () => {
  for (let index = 0; index < MAX_RUNTIME_STATE_ARTIFACTS; index += 1) {
    recordRuntimeState({ artifactId: `artifact-${index}`, revisionId: 'rev-1', callId: `call-${index}` }, { index })
  }
  recordRuntimeState({ artifactId: 'artifact-new', revisionId: 'rev-1', callId: 'call-new' }, { index: 'new' })
  // Oldest artifact lost its snapshot.
  assert.equal(runtimeStateForProgram({ artifactId: 'artifact-0', revisionId: 'rev-1', baseRevisionId: 'rev-1' }), undefined)
  // A recent artifact is still present.
  assert.deepEqual(
    runtimeStateForProgram({ artifactId: 'artifact-new', revisionId: 'rev-1', baseRevisionId: 'rev-1' }),
    { index: 'new' },
  )
})

test('clear drops every snapshot and reset is equivalent', () => {
  recordRuntimeState(revisionOne, stateOne)
  clearRuntimeState()
  assert.equal(runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-1', baseRevisionId: 'rev-1' }), undefined)
  recordRuntimeState(revisionOne, stateOne)
  resetRuntimeStateForTests()
  assert.equal(runtimeStateForProgram({ artifactId: artifact, revisionId: 'rev-1', baseRevisionId: 'rev-1' }), undefined)
})
