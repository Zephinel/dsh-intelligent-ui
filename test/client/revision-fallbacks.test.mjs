/**
 * Unit tests for the client-owned deletion rollback targets.
 *
 * Run: node --test test/client/revision-fallbacks.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_REVISION_FALLBACKS,
  MAX_REVISION_FALLBACK_CHAIN,
  MAX_REVISION_FALLBACK_STORAGE_CHARS,
  applyRevisionFallback,
  clearRevisionFallbacks,
  createRevisionFallback,
  liveFallbackTargetIds,
  namedRevisionIds,
  needsRevisionFallback,
  recordRevisionFallback,
  resolveRevisionFallback,
  revisionFallbackMap,
  revisionFallbacksFor,
  rollbackTargetFor,
} from '../../src/client/artifact-edit/revision-fallbacks.ts'

/** Tiny localStorage stand-in; the store must work with and without one. */
function createFakeStorage() {
  const map = new Map()
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: key => { map.delete(key) },
    clear: () => { map.clear() },
    key: index => [...map.keys()][index] ?? null,
    get length() { return map.size },
  }
}

const testStorage = createFakeStorage()
try {
  Object.defineProperty(globalThis, 'localStorage', { value: testStorage, configurable: true, writable: true })
} catch {
  globalThis.localStorage = testStorage
}

function historyRevision(id, revision, overrides = {}) {
  return {
    revisionId: id,
    revision,
    style: 'card',
    createdAt: 1_700_000_000_000 + revision,
    current: false,
    source: 'edit',
    hasProgram: true,
    restorable: true,
    ...overrides,
  }
}

function fallbackRecord(deletedRevisionId, overrides = {}) {
  return {
    deletedRevisionId,
    artifactId: 'call_1',
    revisionId: 'call_1',
    revision: 1,
    program: 'root = Col([Title("initial")])',
    style: 'card',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

test('rollback target is the newest older revision with a retained program', () => {
  const revisions = [
    historyRevision('r4', 4),
    historyRevision('r3', 3, { hasProgram: false }),
    historyRevision('r2', 2),
    historyRevision('r1', 1, { source: 'initial', hasProgram: true }),
  ]
  assert.equal(rollbackTargetFor(revisions, 'r2')?.revisionId, 'r1')
  assert.equal(rollbackTargetFor(revisions, 'r3')?.revisionId, 'r2')
  assert.equal(rollbackTargetFor(revisions, 'r4')?.revisionId, 'r2')
  // The initial revision is never deletable, so it has no rollback target.
  assert.equal(rollbackTargetFor(revisions, 'r1'), undefined)
  // Nothing older exists.
  assert.equal(rollbackTargetFor([historyRevision('r1', 1)], 'r1'), undefined)
})

test('rollback target skips revisions whose program is gone', () => {
  const revisions = [
    historyRevision('r3', 3),
    historyRevision('r2', 2, { hasProgram: false }),
    historyRevision('r1', 1, { source: 'initial', hasProgram: false }),
  ]
  assert.equal(rollbackTargetFor(revisions, 'r3'), undefined)
})

test('applyRevisionFallback re-points lineage, content and style', () => {
  const program = {
    callId: 'tool_2',
    program: 'root = Col([Title("deleted")])',
    title: 'Deleted',
    style: 'card',
    styleId: 'cs_old',
    styleSource: 'template',
    artifactId: 'call_1',
    revisionId: 'tool_2',
    requestId: 'req_1',
    baseRevisionId: 'call_1',
    revision: 2,
    editedBlockIds: ['b2'],
    running: false,
  }
  const fallback = fallbackRecord('tool_2', {
    revisionId: 'call_1',
    revision: 1,
    title: 'Initial',
    temporaryStyle: { schemaVersion: 1, baseLayout: 'card', directives: 'calm' },
  })
  const redirected = applyRevisionFallback(program, fallback)
  assert.equal(redirected.callId, 'tool_2')
  assert.equal(redirected.artifactId, 'call_1')
  assert.equal(redirected.program, fallback.program)
  assert.equal(redirected.revisionId, 'call_1')
  assert.equal(redirected.revision, 1)
  assert.equal(redirected.title, 'Initial')
  assert.equal(redirected.style, 'card')
  assert.equal(redirected.styleId, undefined)
  assert.deepEqual(redirected.temporaryStyle, fallback.temporaryStyle)
  assert.equal(redirected.styleSource, 'temporary')
  assert.equal(redirected.requestId, 'req_1')
  assert.equal(redirected.baseRevisionId, undefined)
  assert.equal(redirected.editedBlockIds, undefined)
  assert.equal(redirected.running, false)
})

test('applyRevisionFallback keeps the card title when the target has none', () => {
  const program = { callId: 'tool_2', program: 'root = Col([])', title: 'Kept', revisionId: 'tool_2', revision: 2, running: false }
  const redirected = applyRevisionFallback(program, fallbackRecord('tool_2'))
  assert.equal(redirected.title, 'Kept')
  assert.equal(redirected.styleSource, undefined)
})

test('createRevisionFallback copies the target metadata and program', () => {
  const target = historyRevision('r1', 1, {
    source: 'initial',
    title: 'Initial',
    baseRevisionId: 'r0',
    style: 'article',
    styleId: 'cs_a',
  })
  const fallback = createRevisionFallback('call_1', 'r2', target, 'root = Col([])')
  assert.equal(fallback.deletedRevisionId, 'r2')
  assert.equal(fallback.artifactId, 'call_1')
  assert.equal(fallback.revisionId, 'r1')
  assert.equal(fallback.revision, 1)
  assert.equal(fallback.baseRevisionId, 'r0')
  assert.equal(fallback.title, 'Initial')
  assert.equal(fallback.style, 'article')
  assert.equal(fallback.styleId, 'cs_a')
  assert.equal(fallback.program, 'root = Col([])')
})

test('fallbacks persist, replace by deleted revision id and are capped', () => {
  clearRevisionFallbacks('chat-fallback-a')
  recordRevisionFallback('chat-fallback-a', fallbackRecord('deleted_1', { revision: 2 }))
  assert.equal(revisionFallbacksFor('chat-fallback-a').length, 1)
  recordRevisionFallback('chat-fallback-a', fallbackRecord('deleted_1', { revision: 5 }))
  assert.equal(revisionFallbacksFor('chat-fallback-a').length, 1)
  assert.equal(revisionFallbacksFor('chat-fallback-a')[0].revision, 5)
  assert.equal(JSON.parse(testStorage.getItem('dsh-intelligent-ui-revision-fallbacks:v1:chat-fallback-a')).length, 1)
  for (let index = 0; index < MAX_REVISION_FALLBACKS + 3; index += 1) {
    recordRevisionFallback('chat-fallback-a', fallbackRecord(`deleted_${index + 10}`))
  }
  assert.equal(revisionFallbacksFor('chat-fallback-a').length, MAX_REVISION_FALLBACKS)
  clearRevisionFallbacks('chat-fallback-a')
  assert.equal(revisionFallbacksFor('chat-fallback-a').length, 0)
  assert.equal(testStorage.getItem('dsh-intelligent-ui-revision-fallbacks:v1:chat-fallback-a'), null)
})

test('the persisted list is trimmed to the storage budget', () => {
  clearRevisionFallbacks('chat-fallback-budget')
  const big = 'x'.repeat(190_000)
  for (let index = 0; index < 12; index += 1) {
    recordRevisionFallback('chat-fallback-budget', fallbackRecord(`deleted_${index}`, { program: big }))
  }
  const kept = revisionFallbacksFor('chat-fallback-budget')
  assert.ok(kept.length < 12, 'large fallbacks are evicted before the quota is hit')
  assert.ok(JSON.stringify(kept).length <= MAX_REVISION_FALLBACK_STORAGE_CHARS, 'the stored list fits the budget')
  clearRevisionFallbacks('chat-fallback-budget')
})

test('chained deletions resolve to the oldest still-live revision', () => {
  clearRevisionFallbacks('chat-chain')
  recordRevisionFallback('chat-chain', fallbackRecord('r3', { revisionId: 'r2', revision: 2, program: 'root = Col([Title("two")])' }))
  recordRevisionFallback('chat-chain', fallbackRecord('r2', { revisionId: 'r1', revision: 1, program: 'root = Col([Title("one")])' }))
  const fallbacks = revisionFallbackMap(revisionFallbacksFor('chat-chain'))
  const resolved = resolveRevisionFallback(fallbacks, 'r3')
  assert.equal(resolved?.revisionId, 'r1', 'R3→R2 then R2→R1 resolves all the way to R1')
  assert.equal(resolved?.program, 'root = Col([Title("one")])')
  // Recording R2→R1 retargets the older R3 entry so a map lookup is already live.
  const rewritten = revisionFallbacksFor('chat-chain').find(item => item.deletedRevisionId === 'r3')
  assert.equal(rewritten?.revisionId, 'r1')
  assert.equal(resolveRevisionFallback(fallbacks, 'unknown'), undefined)
  clearRevisionFallbacks('chat-chain')
})

test('a persisted cycle resolves to nothing and the depth bound stops runaway chains', () => {
  // Seed a real two-node cycle the way a corrupt/legacy store would contain it:
  // recording through the API would retarget the entries instead.
  const key = 'dsh-intelligent-ui-revision-fallbacks:v1:chat-cycle'
  testStorage.setItem(key, JSON.stringify([
    fallbackRecord('r3', { revisionId: 'r2', revision: 2 }),
    fallbackRecord('r2', { revisionId: 'r3', revision: 3 }),
  ]))
  const cycle = revisionFallbackMap(revisionFallbacksFor('chat-cycle'))
  assert.equal(resolveRevisionFallback(cycle, 'r3'), undefined)
  assert.equal(resolveRevisionFallback(cycle, 'r2'), undefined)
  // r20 → … → r1 → r0 is 20 hops and resolves; 21 entries hit the bound.
  const chainOf = (length) => Array.from({ length }, (_, offset) => {
    const index = length - offset
    return fallbackRecord(`r${index}`, { revisionId: `r${index - 1}`, revision: index - 1 })
  })
  assert.equal(resolveRevisionFallback(revisionFallbackMap(chainOf(20)), 'r20')?.revisionId, 'r0')
  assert.equal(resolveRevisionFallback(revisionFallbackMap(chainOf(21)), 'r21'), undefined)
  assert.ok(MAX_REVISION_FALLBACK_CHAIN === 20)
  clearRevisionFallbacks('chat-cycle')
})

test('applying a fallback marks the card read-only and keeps its identity', () => {
  const program = { callId: 'call_9', program: 'root = Col([Title("three")])', revisionId: 'r3', revision: 3, requestId: 'req_1', running: false }
  const fallback = createRevisionFallback('call_1', 'r3', historyRevision('r2', 2), 'root = Col([Title("two")])')
  const applied = applyRevisionFallback(program, fallback)
  assert.equal(applied.callId, 'call_9')
  assert.equal(applied.requestId, 'req_1')
  assert.equal(applied.revisionId, 'r2')
  assert.equal(applied.fallbackFrom, 'r3')
  assert.equal(applied.program, 'root = Col([Title("two")])')
})

test('only live fallbacks count: dead records do not lock or get written', () => {
  const named = namedRevisionIds([
    { callId: 'call-3', revisionId: 'r3' },
    { callId: 'call-2', revisionId: 'r2' },
    { callId: 'local-1' },
  ])
  assert.deepEqual([...named].sort(), ['local-1', 'r2', 'r3'])
  const fallbacks = [
    fallbackRecord('r3', { revisionId: 'r2', revision: 2 }),
    fallbackRecord('r9', { revisionId: 'r8', revision: 8 }),
  ]
  assert.deepEqual([...liveFallbackTargetIds(fallbacks, named)], ['r2'])
  assert.equal(needsRevisionFallback('r3', named, new Set(['r2'])), true, 'a rendered revision needs a fallback')
  assert.equal(needsRevisionFallback('r2', named, new Set(['r2'])), true, 'a live fallback target needs retargeting')
  assert.equal(needsRevisionFallback('r9', named, new Set(['r2'])), false, 'a dead historical revision needs no fallback')
})

test('rollback targets skip revisions owned by client-local cards', () => {
  const revisions = [
    historyRevision('r3', 3),
    historyRevision('r2', 2),
    historyRevision('r1', 1, { source: 'initial' }),
  ]
  assert.equal(rollbackTargetFor(revisions, 'r3')?.revisionId, 'r2')
  assert.equal(rollbackTargetFor(revisions, 'r3', new Set(['r2']))?.revisionId, 'r1')
  assert.equal(rollbackTargetFor(revisions, 'r3', new Set(['r2', 'r1'])), undefined)
})

test('malformed persisted fallbacks are ignored', () => {
  const key = 'dsh-intelligent-ui-revision-fallbacks:v1:chat-fallback-bad'
  testStorage.setItem(key, JSON.stringify([
    { deletedRevisionId: 'x', artifactId: 'call_1', revisionId: 'x' },
    { ...fallbackRecord('good'), deletedRevisionId: 'good' },
    { ...fallbackRecord('bad-style'), style: 'wat' },
  ]))
  assert.deepEqual(revisionFallbacksFor('chat-fallback-bad').map(item => item.deletedRevisionId), ['good'])
  testStorage.removeItem(key)
})

test('fallback map indexes by deleted revision id', () => {
  const map = revisionFallbackMap([fallbackRecord('tool_2'), fallbackRecord('tool_3')])
  assert.equal(map.get('tool_2')?.revision, 1)
  assert.equal(map.get('tool_3')?.revision, 1)
  assert.equal(map.get('tool_4'), undefined)
})
