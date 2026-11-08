/**
 * Host regression test: the durable artifact revision registry and its
 * authenticated latest-revision probe.
 *
 *   node scripts/build.mjs host
 *   node --test test/host/artifact-revisions.test.mjs
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import {
  ARTIFACT_HISTORY_PROGRAM_ROUTE_PATH, ARTIFACT_HISTORY_ROUTE_PATH,
  ARTIFACT_RESTORE_ROUTE_PATH, ARTIFACT_REVISION_ROUTE_PATH,
} from '../../src/shared/artifact-edit.ts'
import { ARTIFACT_BASE_ROUTE_PATH } from '../../src/shared/artifact-base.ts'
import { ARTIFACT_STRUCTURE_ROUTE_PATH } from '../../src/shared/artifact-structure.ts'
import { buildArtifactHistory, MAX_ARTIFACT_REVISIONS, MAX_RESTORE_BODY_BYTES, createArtifactRevisionStore, registerArtifactRevisionRoutes } from '../../src/host/artifact-revisions.ts'
import { createArtifactProgramStore } from '../../src/host/artifact-structure.ts'
import { createResultStore } from '../../src/host/result-store.ts'
import { THEME } from './style-fixtures.mjs'

const plugin = await import('../../lib/index.js')
const originalHome = process.env.DSH_HOME
const homes = []

function mountHome(raw) {
  const home = mkdtempSync(join(tmpdir(), 'iui-artifacts-'))
  homes.push(home)
  process.env.DSH_HOME = home
  const file = join(home, 'dsh-intelligent-ui-artifacts.json')
  if (raw !== undefined) writeFileSync(file, raw)
  const warnings = []
  return { home, file, warnings, store: createArtifactRevisionStore({ logger: { warn: message => warnings.push(message) } }) }
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
})

/** Mount one revision store that forwards result-owned snapshots to the result registry. */
function mountHomeWithResults() {
  const home = mkdtempSync(join(tmpdir(), 'iui-artifacts-results-'))
  homes.push(home)
  process.env.DSH_HOME = home
  const resultsFile = join(home, 'dsh-intelligent-ui-results.json')
  const results = createResultStore()
  const store = createArtifactRevisionStore({}, results)
  return { home, results, resultsFile, store }
}

const revision = (overrides = {}) => ({
  revisionId: 'call-2', artifactId: 'call-1', baseRevisionId: 'call-1', revision: 2,
  sessionId: 's1', style: 'card', editedBlockIds: ['b1'], createdAt: 1, ...overrides,
})

/** One valid result-owned temporary style snapshot for a card revision. */
const TEMPORARY_STYLE = { schemaVersion: 1, baseLayout: 'card', directives: 'Result-owned compact style.', theme: THEME }

test('listForArtifact returns only one artifact revisions, oldest first and detached', () => {
  const { store } = mountHome()
  store.record(revision({ revisionId: 'call-3', revision: 3, createdAt: 3 }))
  store.record(revision({ revisionId: 'call-2', revision: 2, createdAt: 2 }))
  store.record(revision({ revisionId: 'call-9', artifactId: 'call-9', baseRevisionId: 'call-9-seed', revision: 2, createdAt: 2 }))
  const list = store.listForArtifact('call-1')
  assert.deepEqual(list.map(record => record.revision), [2, 3])
  list[0].style = 'article'
  assert.equal(store.listForArtifact('call-1')[0].style, 'card', 'returns detached clones')
  assert.deepEqual(store.listForArtifact('unknown'), [])
})

test('the history route lists metadata newest-first with current/restorable/source flags', () => {
  const records = [
    revision({ revisionId: 'call-2', revision: 2, createdAt: 2, editedBlockIds: ['b1'] }),
    revision({ revisionId: 'restore_0123456789abcdef', revision: 3, baseRevisionId: 'call-2', createdAt: 3, editedBlockIds: [] }),
  ]
  const programs = [
    programRecord({ revisionId: 'call-2', program: 'root = Col([Text("two")])', createdAt: 2, lastAccessAt: 2 }),
    programRecord({ revisionId: 'restore_0123456789abcdef', program: 'root = Col([Text("three")])', createdAt: 3, lastAccessAt: 3 }),
  ]
  const m = mountRoutes({ records, revisions: records, programs })
  const response = readJson(request(m.historyRoute, { url: historyUrl('call-1') }))
  assert.equal(response.ok, true)
  assert.equal(response.artifactId, 'call-1')
  assert.equal(response.latestRevision, 3)
  assert.deepEqual(response.revisions.map(entry => entry.revision), [3, 2])
  const [latest, previous] = response.revisions
  assert.equal(latest.revisionId, 'restore_0123456789abcdef')
  assert.equal(latest.current, true)
  assert.equal(latest.restorable, false)
  assert.equal(latest.source, 'restore')
  assert.equal(latest.hasProgram, true)
  assert.equal(previous.revisionId, 'call-2')
  assert.equal(previous.current, false)
  assert.equal(previous.restorable, true)
  assert.equal(previous.source, 'edit')
  for (const entry of response.revisions) assert.equal(Object.hasOwn(entry, 'program'), false, 'history is metadata-only')
  assert.equal(JSON.stringify(response).includes('root = Col('), false)
})

test('the history route merges the program-only initial revision with style fallback', () => {
  const records = [
    revision({ revisionId: 'call-2', revision: 2, createdAt: 2, style: 'article', styleId: 'cs_abcdef123456' }),
    revision({ revisionId: 'call-3', revision: 3, baseRevisionId: 'call-2', createdAt: 3, style: 'article', styleId: 'cs_abcdef123456' }),
  ]
  const programs = [
    programRecord({ revisionId: 'call-1', program: 'root = Col([Title("First")])', createdAt: 1, lastAccessAt: 1 }),
    programRecord({ revisionId: 'call-2', program: 'root = Col([Title("Second")])', createdAt: 2, lastAccessAt: 2 }),
    programRecord({ revisionId: 'call-3', program: 'root = Col([Title("Third")])', createdAt: 3, lastAccessAt: 3 }),
  ]
  const m = mountRoutes({ revisions: records, programs })
  const response = readJson(request(m.historyRoute, { url: historyUrl('call-1') }))
  assert.deepEqual(response.revisions.map(entry => entry.revision), [3, 2, 1])
  const initial = response.revisions[2]
  assert.equal(initial.revisionId, 'call-1')
  assert.equal(initial.source, 'initial')
  assert.equal(initial.style, 'article', 'initial revision style falls back to the earliest record')
  assert.equal(initial.styleId, 'cs_abcdef123456')
  assert.equal(initial.createdAt, 1)
  assert.equal(initial.current, false)
  assert.equal(initial.hasProgram, true)
  assert.equal(initial.restorable, true)
  // A record whose program is gone is not restorable.
  assert.equal(response.revisions[1].hasProgram, true)
  assert.equal(response.latestRevision, 3)
})

test('the history route handles an initial-only artifact and a completely unknown one', () => {
  const onlyInitial = mountRoutes({ revisions: [], programs: [programRecord()] })
  const response = readJson(request(onlyInitial.historyRoute, { url: historyUrl('call-1') }))
  assert.equal(response.latestRevision, 1)
  assert.equal(response.revisions.length, 1)
  assert.equal(response.revisions[0].revision, 1)
  assert.equal(response.revisions[0].source, 'initial')
  assert.equal(response.revisions[0].current, true)
  assert.equal(response.revisions[0].restorable, false)
  assert.equal(response.revisions[0].hasProgram, true)
  const empty = mountRoutes({ revisions: [], programs: [] })
  const none = readJson(request(empty.historyRoute, { url: historyUrl('call-unknown') }))
  assert.deepEqual(none, { ok: true, artifactId: 'call-unknown', latestRevision: 1, revisions: [] })
})

test('history isolates artifacts, checks auth/method and validates the artifactId', () => {
  const records = [
    revision({ revisionId: 'call-2', revision: 2, createdAt: 2 }),
    revision({ revisionId: 'other_0123456789abcdef', artifactId: 'call-other', baseRevisionId: 'call-other-seed', revision: 2, createdAt: 5 }),
  ]
  const programs = [
    programRecord({ revisionId: 'call-2', createdAt: 2, lastAccessAt: 2 }),
    programRecord({ artifactId: 'call-other', revisionId: 'other_0123456789abcdef', createdAt: 5, lastAccessAt: 5 }),
  ]
  const m = mountRoutes({ revisions: records, programs })
  const response = readJson(request(m.historyRoute, { url: historyUrl('call-1') }))
  assert.deepEqual(response.revisions.map(entry => entry.revisionId), ['call-2'])
  assert.equal(JSON.stringify(response).includes('call-other'), false)
  const denied = mountRoutes({ revisions: records, programs, rejection: 403 })
  assert.equal(request(denied.historyRoute, { url: historyUrl('call-1') }).status, 403)
  const wrongMethod = request(m.historyRoute, { method: 'POST', url: historyUrl('call-1') })
  assert.equal(wrongMethod.status, 405)
  assert.equal(readJson(wrongMethod).error.code, 'method_not_allowed')
  const invalid = request(m.historyRoute, { url: `${ARTIFACT_HISTORY_ROUTE_PATH}?artifactId=bad%20id` })
  assert.equal(invalid.status, 400)
  assert.equal(readJson(invalid).error.code, 'invalid_input')
})

test('the program route returns retained programs and reports program_missing', () => {
  const records = [revision({ revisionId: 'call-2', revision: 2, createdAt: 2 })]
  const programs = [
    programRecord({ revisionId: 'call-1', program: 'root = Col([Title("Initial")])', createdAt: 1, lastAccessAt: 1 }),
    programRecord({ revisionId: 'call-2', program: 'root = Col([Title("Second")])', createdAt: 2, lastAccessAt: 2 }),
  ]
  const m = mountRoutes({ revisions: records, programs })
  const initial = readJson(request(m.historyProgramRoute, { url: historyProgramUrl('call-1', 'call-1') }))
  assert.deepEqual(initial, { ok: true, artifactId: 'call-1', revisionId: 'call-1', revision: 1, program: 'root = Col([Title("Initial")])' })
  const second = readJson(request(m.historyProgramRoute, { url: historyProgramUrl('call-1', 'call-2') }))
  assert.equal(second.revision, 2)
  assert.equal(second.program, 'root = Col([Title("Second")])')
  const missing = request(m.historyProgramRoute, { url: historyProgramUrl('call-1', 'call-9') })
  assert.equal(missing.status, 404)
  assert.equal(readJson(missing).error.code, 'program_missing')
  const invalid = request(m.historyProgramRoute, { url: `${ARTIFACT_HISTORY_PROGRAM_ROUTE_PATH}?artifactId=call-1` })
  assert.equal(invalid.status, 400)
  const wrongMethod = request(m.historyProgramRoute, { method: 'PUT', url: historyProgramUrl('call-1', 'call-1') })
  assert.equal(wrongMethod.status, 405)
})

test('restore accepts the program-only initial revision and copies style from the latest record', async () => {
  const records = [revision({ revisionId: 'call-3', revision: 2, createdAt: 3, style: 'article', styleId: 'cs_abcdef123456' })]
  const programs = [
    programRecord({ revisionId: 'call-1', program: 'root = Col([Title("Initial")])', createdAt: 1, lastAccessAt: 1 }),
    programRecord({ revisionId: 'call-3', program: 'root = Col([Title("Second")])', createdAt: 3, lastAccessAt: 3 }),
  ]
  const m = mountRoutes({ revisions: records, programs })
  const restoredProgram = 'root = Col([Title("Restored initial")])'
  const response = await postRestore(m.restoreRoute, {
    body: { schemaVersion: 1, artifactId: 'call-1', sourceRevisionId: 'call-1', program: restoredProgram },
  })
  assert.equal(response.status, 201, response.body)
  const body = readJson(response)
  assert.equal(body.ok, true)
  assert.equal(body.revision.baseRevisionId, 'call-1')
  assert.equal(body.revision.revision, 3)
  assert.equal(body.revision.style, 'article', 'initial restore falls back to the latest style')
  assert.equal(body.revision.styleId, 'cs_abcdef123456')
  assert.equal(body.revision.program, restoredProgram)
  const latest = createArtifactRevisionStore().latestFor('call-1')
  assert.equal(latest.revisionId, body.revision.revisionId)
  assert.equal(latest.baseRevisionId, 'call-1')
  assert.equal(latest.style, 'article')
  assert.equal(createArtifactProgramStore().lookup('call-1', body.revision.revisionId), restoredProgram)
})

test('restore accepts any unrecorded source revision whose program is still retained', async () => {
  // Decision A: the retained-program fallback is not limited to the initial
  // revision id — an unrecorded revision whose program survived in the
  // authoritative registry (for example after its revision record was evicted)
  // is still restorable as a copied revision.
  const records = [revision({ revisionId: 'call-3', revision: 2, createdAt: 3 })]
  const programs = [
    programRecord({ revisionId: 'call-orphan', program: 'root = Col([Title("Orphan")])', createdAt: 1, lastAccessAt: 1 }),
    programRecord({ revisionId: 'call-3', program: 'root = Col([Title("Second")])', createdAt: 3, lastAccessAt: 3 }),
  ]
  const m = mountSourceRoutes({ revisions: records, programs })
  const restoredProgram = 'root = Col([Title("Restored orphan")])'
  const response = await postRestore(m.restoreRoute, {
    body: { schemaVersion: 1, artifactId: 'call-1', sourceRevisionId: 'call-orphan', program: restoredProgram },
  })
  assert.equal(response.status, 201, response.body)
  const body = readJson(response)
  assert.equal(body.ok, true)
  assert.equal(body.revision.baseRevisionId, 'call-orphan')
  assert.equal(body.revision.revision, 3)
  assert.equal(body.revision.program, restoredProgram)
  const latest = createArtifactRevisionStore().latestFor('call-1')
  assert.equal(latest.revisionId, body.revision.revisionId)
  assert.equal(latest.baseRevisionId, 'call-orphan')
})

test('restore reports source_missing/program states for initial revisions', async () => {
  const noHistory = mountRoutes({ revisions: [], programs: [programRecord()] })
  const alreadyLatest = await postRestore(noHistory.restoreRoute, {
    body: { schemaVersion: 1, artifactId: 'call-1', sourceRevisionId: 'call-1', program: 'root = Col([Title("Again")])' },
  })
  assert.equal(alreadyLatest.status, 409)
  assert.equal(readJson(alreadyLatest).error.code, 'already_latest')
  const missing = mountRoutes({ revisions: [], programs: [] })
  const missingSource = await postRestore(missing.restoreRoute, {
    body: { schemaVersion: 1, artifactId: 'call-1', sourceRevisionId: 'call-1', program: 'root = Col([Title("Again")])' },
  })
  assert.equal(missingSource.status, 404)
  assert.equal(readJson(missingSource).error.code, 'source_missing')
})

test('records immutably, clones reads and reloads from the artifact file', () => {
  const { store, file } = mountHome()
  const recorded = revision()
  store.record(recorded)
  store.record(revision())
  recorded.editedBlockIds.push('b2')
  assert.throws(() => store.record(revision({ revision: 3 })), /immutable/)
  assert.deepEqual(store.get('call-2'), revision())
  const detached = store.get('call-2')
  detached.style = 'article'
  assert.equal(store.get('call-2').style, 'card')
  assert.deepEqual(createArtifactRevisionStore().get('call-2'), revision())
  assert.equal(store.get('unknown'), undefined)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, revisions: [revision()] })
})

test('latestFor and status explain first renders, latest revisions and stale bases', () => {
  const { store } = mountHome()
  // The first render is never recorded: an unknown artifact is the caller's revision 1.
  assert.deepEqual(store.status({ artifactId: 'call-1', revisionId: 'call-1' }), {
    artifactId: 'call-1', revisionId: 'call-1', revision: 1, latestRevisionId: 'call-1', latestRevision: 1, conflict: false,
  })
  assert.equal(store.latestFor('call-1'), undefined)
  store.record(revision())
  const latest = revision({ revisionId: 'call-3', baseRevisionId: 'call-2', revision: 3, createdAt: 2 })
  store.record(latest)
  assert.deepEqual(store.latestFor('call-1'), latest)
  assert.deepEqual(store.status({ artifactId: 'call-1', revisionId: 'call-3' }), {
    artifactId: 'call-1', revisionId: 'call-3', revision: 3, latestRevisionId: 'call-3', latestRevision: 3, conflict: false,
  })
  assert.deepEqual(store.status({ artifactId: 'call-1', revisionId: 'call-2' }), {
    artifactId: 'call-1', revisionId: 'call-2', revision: 2, latestRevisionId: 'call-3', latestRevision: 3, conflict: true,
  })
  // The original revision 1 id is unknown to a known artifact, so it conflicts with any edit.
  assert.equal(store.status({ artifactId: 'call-1', revisionId: 'call-1' }).conflict, true)
  assert.deepEqual(store.status({ artifactId: 'other', revisionId: 'other' }), {
    artifactId: 'other', revisionId: 'other', revision: 1, latestRevisionId: 'other', latestRevision: 1, conflict: false,
  })
})

test('round trips lineage across restart and writes only the artifact registry file', () => {
  const { store, home, file } = mountHome()
  store.record(revision())
  store.record(revision({ revisionId: 'call-3', baseRevisionId: 'call-2', revision: 3, createdAt: 2 }))
  const restored = createArtifactRevisionStore()
  assert.equal(restored.get('call-3').baseRevisionId, 'call-2')
  assert.deepEqual(readdirSync(home), ['dsh-intelligent-ui-artifacts.json'])
  assert.equal(existsSync(`${file}.tmp`), false)
})

test('a revision record keeps a temporary style snapshot and refuses mismatches', () => {
  const { store } = mountHome()
  store.record(revision({ temporaryStyle: TEMPORARY_STYLE }))
  assert.deepEqual(createArtifactRevisionStore().get('call-2').temporaryStyle, TEMPORARY_STYLE)
  for (const temporaryStyle of [
    { ...TEMPORARY_STYLE, baseLayout: 'free' },
    { ...TEMPORARY_STYLE, directives: 'x'.repeat(2001) },
    { schemaVersion: 2, baseLayout: 'card', directives: 'x' },
  ]) {
    assert.throws(() => store.record(revision({ revisionId: 'call-2', temporaryStyle })), /Invalid/)
  }
  assert.deepEqual(store.get('call-2').temporaryStyle, TEMPORARY_STYLE, 'rejected records leave the stored one unchanged')
})

test('the revision store records the result snapshot before writing a temporary revision', () => {
  const { store, results, resultsFile } = mountHomeWithResults()
  store.record(revision({ temporaryStyle: TEMPORARY_STYLE }))
  const persisted = JSON.parse(readFileSync(resultsFile, 'utf8'))
  assert.equal(persisted.version, 1)
  assert.equal(persisted.results.length, 1)
  assert.deepEqual(persisted.results[0], {
    resultId: 'call-2',
    sessionId: 's1',
    snapshot: TEMPORARY_STYLE,
    parentResultId: 'call-1',
    createdAt: 1,
  })
  assert.deepEqual(results.get('call-2').snapshot, TEMPORARY_STYLE)
  // Idempotent replay writes neither registry twice.
  store.record(revision({ temporaryStyle: TEMPORARY_STYLE }))
  assert.equal(JSON.parse(readFileSync(resultsFile, 'utf8')).results.length, 1)
  assert.deepEqual(store.get('call-2').temporaryStyle, TEMPORARY_STYLE)
  // A revision without a temporary style records no snapshot.
  store.record(revision({ revisionId: 'call-3', baseRevisionId: 'call-2', revision: 3, createdAt: 2 }))
  assert.equal(JSON.parse(readFileSync(resultsFile, 'utf8')).results.length, 1)
})

test('a failed snapshot write aborts before the revision write and can be retried', () => {
  const home = mkdtempSync(join(tmpdir(), 'iui-artifacts-boundary-'))
  homes.push(home)
  process.env.DSH_HOME = home
  const artifactsFile = join(home, 'dsh-intelligent-ui-artifacts.json')
  const broken = createArtifactRevisionStore({}, { record() { throw new Error('snapshot store full') } })
  assert.throws(() => broken.record(revision({ temporaryStyle: TEMPORARY_STYLE })), /snapshot store full/)
  assert.equal(existsSync(artifactsFile), false, 'the revision file is not touched when the snapshot write fails')
  assert.equal(broken.get('call-2'), undefined, 'no revision exists without its snapshot')
  // The whole call is retryable once the sink works again.
  const results = createResultStore()
  const retried = createArtifactRevisionStore({}, results)
  retried.record(revision({ temporaryStyle: TEMPORARY_STYLE }))
  assert.deepEqual(retried.get('call-2').temporaryStyle, TEMPORARY_STYLE)
  assert.ok(existsSync(artifactsFile))
  assert.deepEqual(results.get('call-2').snapshot, TEMPORARY_STYLE)
})

test('restoring a temporary-style revision records its snapshot in the result registry', async () => {
  const source = revision({ title: 'Temp page', temporaryStyle: TEMPORARY_STYLE })
  const latest = revision({ revisionId: 'call-3', baseRevisionId: 'call-2', revision: 3, createdAt: 2 })
  const m = mountSourceRoutes({ revisions: [source, latest] })
  const response = await postRestore(m.restoreRoute, { body: RESTORE_BODY })
  assert.equal(response.status, 201, response.body)
  const body = readJson(response)
  assert.deepEqual(m.resultsStore.get(body.revision.revisionId).snapshot, TEMPORARY_STYLE)
  const snapshot = JSON.parse(readFileSync(m.resultsFile, 'utf8')).results
    .find(entry => entry.resultId === body.revision.revisionId)
  assert.deepEqual(snapshot, {
    resultId: body.revision.revisionId,
    sessionId: 'local-restore',
    snapshot: TEMPORARY_STYLE,
    parentResultId: 'call-2',
    createdAt: snapshot.createdAt,
  })
})

test('history infers structure and style-only revisions without new durable fields', () => {
  const { store } = mountHome()
  store.record(revision({
    revisionId: 'struct_aaaabbbbccccdddd', revision: 2, createdAt: 2,
    editedBlockIds: ['b1'], temporaryStyle: TEMPORARY_STYLE,
  }))
  store.record(revision({
    revisionId: 'call-style-only', revision: 3, baseRevisionId: 'struct_aaaabbbbccccdddd', createdAt: 3,
    editedBlockIds: [], temporaryStyle: TEMPORARY_STYLE,
  }))
  store.record(revision({
    revisionId: 'call-style-edited', revision: 4, baseRevisionId: 'call-style-only', createdAt: 4,
    editedBlockIds: ['b1'], temporaryStyle: TEMPORARY_STYLE,
  }))
  // Legacy shapes keep their previous inference.
  store.record(revision({ revisionId: 'legacy-edit', revision: 5, baseRevisionId: 'call-style-edited', createdAt: 5, editedBlockIds: ['b1'] }))
  store.record(revision({ revisionId: 'legacy-structure', revision: 6, baseRevisionId: 'legacy-edit', createdAt: 6, editedBlockIds: [] }))
  const history = buildArtifactHistory(store, undefined, 'call-1')
  const source = new Map(history.revisions.map(entry => [entry.revisionId, entry.source]))
  assert.equal(source.get('struct_aaaabbbbccccdddd'), 'structure', 'the struct_ prefix wins over editedBlockIds and temporaryStyle')
  assert.equal(source.get('call-style-only'), 'edit', 'a style-only temporary revision is inferred as an edit')
  assert.equal(source.get('call-style-edited'), 'edit')
  assert.equal(source.get('legacy-edit'), 'edit')
  assert.equal(source.get('legacy-structure'), 'structure')
})

test('corrupt files, versions, schemas, duplicate ids and oversize collections are preserved on the next atomic write', () => {
  const oversized = Array.from({ length: MAX_ARTIFACT_REVISIONS + 1 }, (_, index) => revision({ revisionId: `r${index}`, revision: index + 1, createdAt: index }))
  for (const raw of [
    '{broken',
    JSON.stringify({ version: 2, revisions: [] }),
    JSON.stringify({ version: 1, revisions: [revision({ style: 'wide' })] }),
    JSON.stringify({ version: 1, revisions: [revision(), revision()] }),
    JSON.stringify({ version: 1, revisions: oversized }),
  ]) {
    const { store, file, home, warnings } = mountHome(raw)
    assert.equal(warnings.length, 1)
    assert.equal(store.get('call-2'), undefined)
    assert.equal(readFileSync(file, 'utf8'), raw)
    store.record(revision())
    const backup = readdirSync(home).find(name => /\.corrupt-\d+$/.test(name))
    assert.ok(backup)
    assert.equal(readFileSync(join(home, backup), 'utf8'), raw)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, revisions: [revision()] })
  }
})

test('rejects invalid lineage records before writing', () => {
  const { store, file } = mountHome()
  for (const patch of [
    { revisionId: '' }, { revisionId: 'x y' }, { artifactId: 'x'.repeat(201) },
    { baseRevisionId: 'call-2' }, { revision: 0 }, { revision: 1.5 }, { revision: 100_001 },
    { sessionId: ' s1' }, { sessionId: '' }, { title: 'bad\nlabel' }, { title: 'x'.repeat(201) },
    { style: 'wide' }, { styleId: 'not-a-style-id' }, { editedBlockIds: ['x'] },
    { editedBlockIds: Array.from({ length: 13 }, () => 'b1') }, { createdAt: -1 }, { extra: true },
  ]) {
    assert.throws(() => store.record(revision(patch)), /Invalid/)
  }
  assert.equal(existsSync(file), false)
})

test('retains the newest records by creation time, also after restart', () => {
  const { store } = mountHome()
  for (let index = 0; index <= MAX_ARTIFACT_REVISIONS; index++) {
    store.record(revision({ revisionId: `r${index}`, revision: index + 1, createdAt: index }))
  }
  assert.equal(store.get('r0'), undefined)
  assert.ok(store.get('r1'))
  assert.ok(createArtifactRevisionStore().get(`r${MAX_ARTIFACT_REVISIONS}`))
  store.record(revision({ revisionId: 'late-old', revision: 1, createdAt: 0 }))
  assert.equal(store.get('late-old'), undefined)
})

/** Mount the real plugin with independently available routing and auth services. */
function mountRoutes({ webServer = true, connection = true, rejection, revisions = [], programs } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'iui-artifact-routes-'))
  homes.push(home)
  process.env.DSH_HOME = home
  const file = join(home, 'dsh-intelligent-ui-artifacts.json')
  writeFileSync(file, JSON.stringify({ version: 1, revisions }))
  const programFile = join(home, 'dsh-intelligent-ui-programs.json')
  if (programs !== undefined) writeFileSync(programFile, JSON.stringify({ version: 1, programs }))
  const routes = []
  const checked = []
  const disposers = []
  const disposedPaths = []
  plugin.apply({
    tools: { register() {} }, systemPrompt: { section() {} }, logger: { warn() {} },
    inject(dependencies, callback) {
      if (!dependencies.includes('webServer')) return
      // Supply partial scopes too, proving a missing connection cannot expose the route.
      callback({
        ...webServer ? {
          webServer: {
            register(route) {
              routes.push(route)
              return () => { disposedPaths.push(route.path) }
            },
          },
        } : {},
        ...connection ? { connection: { requestRejection(req) { checked.push(req); return rejection } } } : {},
        effect(fn) {
          const disposer = fn()
          if (typeof disposer === 'function') disposers.push(disposer)
          return disposer
        },
      })
    },
  })
  return {
    routes, checked, disposers, disposedPaths, home, file, programFile,
    route: routes.find(candidate => candidate.path === ARTIFACT_REVISION_ROUTE_PATH),
    restoreRoute: routes.find(candidate => candidate.path === ARTIFACT_RESTORE_ROUTE_PATH),
    historyRoute: routes.find(candidate => candidate.path === ARTIFACT_HISTORY_ROUTE_PATH),
    historyProgramRoute: routes.find(candidate => candidate.path === ARTIFACT_HISTORY_PROGRAM_ROUTE_PATH),
  }
}

/** Invoke the restore POST handler and resolve with the completed response. */
function postRestore(route, { body, raw, headers = { 'content-type': 'application/json' }, url = ARTIFACT_RESTORE_ROUTE_PATH } = {}) {
  const payload = raw === undefined ? JSON.stringify(body) : raw
  const req = Readable.from([payload])
  Object.assign(req, { method: 'POST', url, headers })
  const result = { status: 0, headers: {}, body: undefined, req }
  let complete
  result.done = new Promise(resolve => { complete = resolve })
  const res = new EventEmitter()
  Object.assign(res, {
    writeHead(status, responseHeaders = {}) {
      result.status = status
      result.headers = responseHeaders
    },
    end(chunk) {
      result.body = chunk
      complete(result)
    },
  })
  route.handler(req, res)
  return result.done
}

/**
 * Mount the source restore route directly with its own stores.
 *
 * The plugin-path harness above loads the previously built `lib/index.js`; the
 * host bundle is deliberately not rebuilt in this fix stream, so the reverted
 * retained-program fallback is exercised through the source registration.
 */
function mountSourceRoutes({ revisions = [], programs } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'iui-artifact-restore-src-'))
  homes.push(home)
  process.env.DSH_HOME = home
  writeFileSync(join(home, 'dsh-intelligent-ui-artifacts.json'), JSON.stringify({ version: 1, revisions }))
  if (programs !== undefined) writeFileSync(join(home, 'dsh-intelligent-ui-programs.json'), JSON.stringify({ version: 1, programs }))
  const resultsStore = createResultStore()
  const revisionStore = createArtifactRevisionStore({}, resultsStore)
  const programStore = createArtifactProgramStore()
  const routes = []
  registerArtifactRevisionRoutes({
    inject(dependencies, callback) {
      callback({
        webServer: { register(route) { routes.push(route); return () => {} } },
        connection: { requestRejection() { return undefined } },
        effect(fn) { return fn() },
      })
    },
  }, revisionStore, programStore)
  return {
    revisionStore,
    programStore,
    resultsStore,
    resultsFile: join(home, 'dsh-intelligent-ui-results.json'),
    routes,
    restoreRoute: routes.find(route => route.path === ARTIFACT_RESTORE_ROUTE_PATH),
  }
}

/** One authoritative program registry entry. */
const programRecord = (overrides = {}) => ({
  artifactId: 'call-1', revisionId: 'call-1', program: 'root = Col([Title("Initial")])',
  createdAt: 1, lastAccessAt: 1, ...overrides,
})

/** Serialize one program module entry list into the store file shape. */
const programFile = programs => ({ version: 1, programs })

const historyUrl = artifactId => `${ARTIFACT_HISTORY_ROUTE_PATH}?artifactId=${encodeURIComponent(artifactId)}`
const historyProgramUrl = (artifactId, revisionId) => `${ARTIFACT_HISTORY_PROGRAM_ROUTE_PATH}?artifactId=${encodeURIComponent(artifactId)}&revisionId=${encodeURIComponent(revisionId)}`
const readJson = result => result.body === undefined ? undefined : JSON.parse(result.body)

/** One valid restore body for the seeded `revision()` source record. */
const RESTORE_BODY = { schemaVersion: 1, artifactId: 'call-1', sourceRevisionId: 'call-2', program: 'root = Col([Title("Restored")])' }

/** Invoke the exact HTTP handler while recording response metadata. */
function request(route, { method = 'GET', url = ARTIFACT_REVISION_ROUTE_PATH } = {}) {
  const req = { method, url }
  const result = { status: 0, headers: {}, body: undefined, req }
  route.handler(req, {
    writeHead(status, headers = {}) { result.status = status; result.headers = headers },
    end(body) { result.body = body },
  })
  return result
}

test('registers the probe and the restore route only when webServer and connection are composed', () => {
  const composed = mountRoutes()
  assert.ok(composed.route)
  assert.ok(composed.restoreRoute)
  for (const partial of [{ connection: false }, { webServer: false }, { webServer: false, connection: false }]) {
    assert.equal(mountRoutes(partial).route, undefined)
    assert.equal(mountRoutes(partial).restoreRoute, undefined)
  }
})

test('one disposer disposes the status and restore routes together', () => {
  const { disposers, disposedPaths } = mountRoutes()
  assert.ok(disposers.length > 0)
  for (const dispose of disposers) dispose()
  assert.deepEqual(
    disposedPaths.filter(path => path.startsWith('/api/intelligent-ui/artifact-')).sort(),
    [ARTIFACT_RESTORE_ROUTE_PATH, ARTIFACT_REVISION_ROUTE_PATH, ARTIFACT_STRUCTURE_ROUTE_PATH,
      ARTIFACT_HISTORY_ROUTE_PATH, ARTIFACT_HISTORY_PROGRAM_ROUTE_PATH, ARTIFACT_BASE_ROUTE_PATH].sort(),
  )
})

test('GET answers latest-lineage status with no-store JSON', () => {
  const { route } = mountRoutes({ revisions: [revision()] })
  const latest = request(route, { url: `${ARTIFACT_REVISION_ROUTE_PATH}?artifactId=call-1&revisionId=call-2` })
  assert.equal(latest.status, 200)
  assert.equal(latest.headers['cache-control'], 'no-store')
  assert.match(latest.headers['content-type'], /^application\/json/)
  assert.deepEqual(JSON.parse(latest.body), {
    artifactId: 'call-1', revisionId: 'call-2', revision: 2, latestRevisionId: 'call-2', latestRevision: 2, conflict: false,
  })
  assert.deepEqual(JSON.parse(request(route, { url: `${ARTIFACT_REVISION_ROUTE_PATH}?artifactId=call-1&revisionId=call-1` }).body), {
    artifactId: 'call-1', revisionId: 'call-1', revision: 1, latestRevisionId: 'call-2', latestRevision: 2, conflict: true,
  })
  assert.deepEqual(JSON.parse(request(route, { url: `${ARTIFACT_REVISION_ROUTE_PATH}?artifactId=fresh&revisionId=fresh` }).body), {
    artifactId: 'fresh', revisionId: 'fresh', revision: 1, latestRevisionId: 'fresh', latestRevision: 1, conflict: false,
  })
})

test('DELETE removes an unreferenced revision and its retained program', () => {
  const m = mountRoutes({ revisions: [revision()], programs: [programRecord({ revisionId: 'call-2' })] })
  const result = request(m.route, { method: 'DELETE', url: `${ARTIFACT_REVISION_ROUTE_PATH}?artifactId=call-1&revisionId=call-2` })
  assert.equal(result.status, 200)
  assert.deepEqual(JSON.parse(result.body), { ok: true })
  assert.deepEqual(JSON.parse(readFileSync(m.file, 'utf8')).revisions, [])
  assert.deepEqual(JSON.parse(readFileSync(m.programFile, 'utf8')).programs, [])
  assert.equal(createArtifactRevisionStore().get('call-2'), undefined)
})

test('DELETE refuses a revision that still bases another revision, and the initial render', () => {
  const m = mountRoutes({
    revisions: [
      revision({ revisionId: 'call-2', revision: 2, createdAt: 2 }),
      revision({ revisionId: 'call-3', revision: 3, baseRevisionId: 'call-2', createdAt: 3 }),
    ],
  })
  const referenced = request(m.route, { method: 'DELETE', url: `${ARTIFACT_REVISION_ROUTE_PATH}?artifactId=call-1&revisionId=call-2` })
  assert.equal(referenced.status, 409)
  assert.deepEqual(JSON.parse(referenced.body).error.code, 'revision_referenced')
  assert.equal(createArtifactRevisionStore().listForArtifact('call-1').length, 2)
  const initial = request(m.route, { method: 'DELETE', url: `${ARTIFACT_REVISION_ROUTE_PATH}?artifactId=call-1&revisionId=call-1` })
  assert.equal(initial.status, 404)
  assert.deepEqual(JSON.parse(initial.body).error.code, 'revision_missing')
  const newest = request(m.route, { method: 'DELETE', url: `${ARTIFACT_REVISION_ROUTE_PATH}?artifactId=call-1&revisionId=call-3` })
  assert.equal(newest.status, 200)
  const thenBase = request(m.route, { method: 'DELETE', url: `${ARTIFACT_REVISION_ROUTE_PATH}?artifactId=call-1&revisionId=call-2` })
  assert.equal(thenBase.status, 200)
  assert.deepEqual(createArtifactRevisionStore().listForArtifact('call-1'), [])
})

test('requestRejection runs before method dispatch and preserves 401/403 denial codes', () => {
  for (const rejection of [401, 403]) {
    const { route, checked } = mountRoutes({ rejection })
    for (const method of ['GET', 'POST', 'DELETE']) {
      const result = request(route, { method })
      assert.equal(result.status, rejection)
      assert.equal(result.body, undefined)
      assert.equal(result.headers['cache-control'], 'no-store')
    }
    assert.equal(checked.length, 3)
  }
})

test('only GET and DELETE are supported and query params must be artifact identities', () => {
  const { route } = mountRoutes()
  for (const method of ['HEAD', 'POST', 'PUT']) {
    const result = request(route, { method })
    assert.equal(result.status, 405)
    assert.equal(result.headers.allow, 'GET, DELETE')
    assert.equal(result.body, undefined)
  }
  assert.equal(request(route, { method: 'DELETE' }).status, 400)
  for (const method of ['GET', 'DELETE']) {
    for (const query of ['', '?artifactId=call-1', '?revisionId=call-2', '?artifactId=call-1&revisionId=',
      '?artifactId=bad%20id&revisionId=call-2', `?artifactId=${'x'.repeat(201)}&revisionId=call-2`]) {
      const result = request(route, { method, url: `${ARTIFACT_REVISION_ROUTE_PATH}${query}` })
      assert.equal(result.status, 400, `${method} ${query}`)
      assert.deepEqual(JSON.parse(result.body).error.code, 'invalid_input')
    }
  }
})

test('POST restore records latest+1 from an older source and returns the local revision', async () => {
  const source = revision({ title: 'Restored page', styleId: 'cs_abcdef123456' })
  const latest = revision({ revisionId: 'call-3', baseRevisionId: 'call-2', revision: 3, createdAt: 2 })
  const { restoreRoute, route, file } = mountRoutes({ revisions: [source, latest] })
  const response = await postRestore(restoreRoute, { body: RESTORE_BODY })
  assert.equal(response.status, 201)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.match(response.headers['content-type'], /^application\/json/)
  const body = JSON.parse(response.body)
  assert.equal(body.ok, true)
  assert.equal(body.revision.artifactId, 'call-1')
  assert.match(body.revision.revisionId, /^restore_[0-9a-f]{16}$/)
  assert.equal(body.revision.baseRevisionId, 'call-2')
  assert.equal(body.revision.revision, 4)
  assert.equal(body.revision.program, RESTORE_BODY.program)
  assert.equal(body.revision.title, 'Restored page')
  assert.equal(body.revision.style, 'card')
  assert.equal(body.revision.styleId, 'cs_abcdef123456')
  assert.notEqual(body.revision.revisionId, source.revisionId)
  // The new revision is durable and copies the source presentation metadata.
  const records = JSON.parse(readFileSync(file, 'utf8')).revisions
  const restored = records.find(record => record.revisionId === body.revision.revisionId)
  assert.deepEqual(restored, {
    revisionId: body.revision.revisionId, artifactId: 'call-1', baseRevisionId: 'call-2', revision: 4,
    sessionId: 'local-restore', style: 'card', styleId: 'cs_abcdef123456', title: 'Restored page',
    createdAt: restored.createdAt,
  })
  assert.ok(Number.isSafeInteger(restored.createdAt))
  // The existing GET probe sees the restored revision as the new head.
  const probe = request(route, { url: `${ARTIFACT_REVISION_ROUTE_PATH}?artifactId=call-1&revisionId=call-2` })
  assert.deepEqual(JSON.parse(probe.body), {
    artifactId: 'call-1', revisionId: 'call-2', revision: 2,
    latestRevisionId: body.revision.revisionId, latestRevision: 4, conflict: true,
  })
})

test('restore rejects missing, mismatched and already-latest sources', async () => {
  const missing = mountRoutes({ revisions: [revision()] })
  const missingResponse = await postRestore(missing.restoreRoute, { body: { ...RESTORE_BODY, sourceRevisionId: 'call-missing' } })
  assert.equal(missingResponse.status, 404)
  assert.deepEqual(JSON.parse(missingResponse.body).error.code, 'source_missing')

  const newest = mountRoutes({ revisions: [revision()] })
  const latestResponse = await postRestore(newest.restoreRoute, { body: RESTORE_BODY })
  assert.equal(latestResponse.status, 409)
  assert.deepEqual(JSON.parse(latestResponse.body).error.code, 'already_latest')

  const mismatch = mountRoutes({ revisions: [revision()] })
  const mismatchResponse = await postRestore(mismatch.restoreRoute, { body: { ...RESTORE_BODY, artifactId: 'call-9' } })
  assert.equal(mismatchResponse.status, 400)
  assert.deepEqual(JSON.parse(mismatchResponse.body).error.code, 'artifact_mismatch')

  for (const { file } of [missing, newest, mismatch]) {
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).revisions.length, 1, 'failed restores record nothing')
  }
})

test('restore validates the body, program and payload size', async () => {
  const source = revision()
  const latest = revision({ revisionId: 'call-3', baseRevisionId: 'call-2', revision: 3, createdAt: 2 })
  const { restoreRoute } = mountRoutes({ revisions: [source, latest] })
  for (const body of [
    { ...RESTORE_BODY, schemaVersion: 2 },
    { ...RESTORE_BODY, sourceRevisionId: 'bad id' },
    { ...RESTORE_BODY, extra: true },
    { ...RESTORE_BODY, program: 'root = Markdown("plain")' },
    { ...RESTORE_BODY, program: 'root = Col([' },
  ]) {
    const response = await postRestore(restoreRoute, { body })
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60))
    const problem = JSON.parse(response.body).error
    assert.equal(problem.code, body.program === undefined || body.extra !== undefined || body.schemaVersion === 2 || body.sourceRevisionId === 'bad id' ? 'invalid_input' : 'invalid_program')
  }
  const wrongType = await postRestore(restoreRoute, { raw: JSON.stringify(RESTORE_BODY), headers: { 'content-type': 'text/plain' } })
  assert.equal(wrongType.status, 400)
  assert.equal(JSON.parse(wrongType.body).error.code, 'invalid_input')
  const brokenJson = await postRestore(restoreRoute, { raw: '{broken' })
  assert.equal(brokenJson.status, 400)
  assert.equal(JSON.parse(brokenJson.body).error.code, 'invalid_input')
  const declaredTooLarge = await postRestore(restoreRoute, {
    raw: '{}',
    headers: { 'content-type': 'application/json', 'content-length': String(MAX_RESTORE_BODY_BYTES + 1) },
  })
  assert.equal(declaredTooLarge.status, 413)
  assert.equal(JSON.parse(declaredTooLarge.body).error.code, 'payload_too_large')
  const streamedTooLarge = await postRestore(restoreRoute, { raw: 'x'.repeat(MAX_RESTORE_BODY_BYTES + 1) })
  assert.equal(streamedTooLarge.status, 413)
  assert.equal(JSON.parse(streamedTooLarge.body).error.code, 'payload_too_large')
})

test('restore rejects non-POST requests and preserves authentication denials', async () => {
  const { restoreRoute, checked } = mountRoutes({ revisions: [revision()] })
  for (const method of ['GET', 'PUT', 'DELETE', 'HEAD']) {
    const response = request(restoreRoute, { method })
    assert.equal(response.status, 405, method)
    assert.equal(response.headers.allow, 'POST')
    assert.deepEqual(JSON.parse(response.body).error.code, 'method_not_allowed')
  }
  for (const rejection of [401, 403]) {
    const guarded = mountRoutes({ rejection })
    const response = request(guarded.restoreRoute, { method: 'POST' })
    assert.equal(response.status, rejection)
    assert.equal(response.body, undefined)
    assert.equal(response.headers['cache-control'], 'no-store')
    assert.equal(guarded.checked.length, 1)
  }
  // Authentication runs before method dispatch, so even rejected methods were checked.
  assert.equal(checked.length, 4)
})

test('restore copies a source temporary style into the new revision and response', async () => {
  const source = revision({ title: 'Temp page', temporaryStyle: TEMPORARY_STYLE })
  const latest = revision({ revisionId: 'call-3', baseRevisionId: 'call-2', revision: 3, createdAt: 2 })
  const { restoreRoute, file } = mountRoutes({ revisions: [source, latest] })
  const response = await postRestore(restoreRoute, { body: RESTORE_BODY })
  assert.equal(response.status, 201)
  const body = JSON.parse(response.body)
  assert.deepEqual(body.revision.temporaryStyle, TEMPORARY_STYLE)
  assert.equal(body.revision.style, 'card')
  assert.equal(Object.hasOwn(body.revision, 'styleId'), false)
  const record = JSON.parse(readFileSync(file, 'utf8')).revisions.find(candidate => candidate.revisionId === body.revision.revisionId)
  assert.deepEqual(record.temporaryStyle, TEMPORARY_STYLE)
  assert.equal(record.revisionId, body.revision.revisionId)
})
