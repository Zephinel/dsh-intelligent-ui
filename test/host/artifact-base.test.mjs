/**
 * Host regression test: the Artifact base-registration route and resolve
 * boundary that turn previously rendered content into authoritative Host state.
 *
 *   node scripts/build.mjs host
 *   node --test test/host/artifact-base.test.mjs
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  ARTIFACT_BASE_ROUTE_PATH,
  isArtifactBaseSuccess,
} from '../../src/shared/artifact-base.ts'
import {
  ARTIFACT_HISTORY_ROUTE_PATH,
  ARTIFACT_RESTORE_ROUTE_PATH,
  MAX_ARTIFACT_PROGRAM_CHARS,
} from '../../src/shared/artifact-edit.ts'
import { ARTIFACT_STRUCTURE_ROUTE_PATH } from '../../src/shared/artifact-structure.ts'
import { buildArtifactTree } from '../../src/shared/program-cst.ts'
import {
  MAX_ARTIFACT_BASE_BODY_BYTES,
  registerArtifactBase,
  registerArtifactBaseRoute,
  resolveArtifactBase,
} from '../../src/host/artifact-base.ts'
import { createArtifactProgramStore } from '../../src/host/artifact-structure.ts'
import { createArtifactRevisionStore } from '../../src/host/artifact-revisions.ts'

const plugin = await import('../../lib/index.js')
const originalHome = process.env.DSH_HOME
const homes = []

/** One minimal editable Col program for the registration tests. */
const PROGRAM = 'root = Col([Title("Initial"), Text("body")])'
/** A second, equally valid program used for write-once conflicts. */
const OTHER_PROGRAM = 'root = Col([Title("Other"), Text("body")])'

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
})

function tempHome(prefix) {
  const home = mkdtempSync(join(tmpdir(), prefix))
  homes.push(home)
  process.env.DSH_HOME = home
  return home
}

/** One valid recorded revision (revisions recorded after the initial render start at 2). */
const revision = (overrides = {}) => ({
  revisionId: 'call-2', artifactId: 'call-1', baseRevisionId: 'call-1', revision: 2,
  sessionId: 's1', style: 'card', createdAt: 1, ...overrides,
})

/** The authoritative tree of the sample program for operation digests. */
const TREE = buildArtifactTree(PROGRAM, { containerTypes: ['Col', 'Row', 'Card'] })
const childNodes = () => {
  const root = TREE.nodes.get(TREE.rootNodeId)
  return (root.childSlots.children ?? []).map(nodeId => TREE.nodes.get(nodeId))
}
const duplicateOp = () => {
  const target = childNodes()[0]
  assert.ok(target !== undefined, 'sample tree has a first child')
  return { op: 'duplicate', nodeId: target.nodeId, sourceDigest: target.digest, toIndex: 1 }
}

let operationCounter = 0
const operationId = (label) => {
  operationCounter += 1
  return `op_${label}_${String(operationCounter).padStart(4, '0')}`
}

/** Full plugin harness with captured HTTP routes and seeded registry files. */
function mount({ webServer = true, connection = true, rejection, revisions, programs } = {}) {
  const home = tempHome('iui-artifact-base-')
  const artifactsFile = join(home, 'dsh-intelligent-ui-artifacts.json')
  if (revisions !== undefined) writeFileSync(artifactsFile, JSON.stringify({ version: 1, revisions }))
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
    home, routes, checked, disposers, disposedPaths, artifactsFile, programFile,
    baseRoute: routes.find(candidate => candidate.path === ARTIFACT_BASE_ROUTE_PATH),
    structureRoute: routes.find(candidate => candidate.path === ARTIFACT_STRUCTURE_ROUTE_PATH),
    historyRoute: routes.find(candidate => candidate.path === ARTIFACT_HISTORY_ROUTE_PATH),
    restoreRoute: routes.find(candidate => candidate.path === ARTIFACT_RESTORE_ROUTE_PATH),
  }
}

/** Invoke one exact HTTP handler, resolving after the async body is read. */
async function post(route, { body, raw, headers = { 'content-type': 'application/json' }, method = 'POST', url } = {}) {
  const payload = raw === undefined ? JSON.stringify(body) : raw
  const req = Readable.from([payload])
  Object.assign(req, { method, url: url ?? route.path, headers })
  const result = { status: 0, headers: {}, body: undefined }
  result.done = new Promise(resolve => {
    const res = new EventEmitter()
    Object.assign(res, {
      writeHead(status, responseHeaders = {}) {
        result.status = status
        result.headers = responseHeaders
      },
      end(chunk) {
        if (chunk !== undefined) {
          try { result.body = JSON.parse(String(chunk)) } catch { result.body = String(chunk) }
        }
        resolve(result)
      },
    })
    route.handler(req, res)
  })
  return result.done
}

/** Invoke one synchronous GET handler (history only reads its query). */
function get(route, url = route.path) {
  const req = { method: 'GET', url }
  const result = { status: 0, headers: {}, body: undefined }
  route.handler(req, {
    writeHead(status, headers = {}) { result.status = status; result.headers = headers },
    end(body) { result.body = body === undefined ? undefined : JSON.parse(String(body)) },
  })
  return result
}

/** One valid registration body for the sample initial revision. */
const baseBody = (overrides = {}) => ({
  schemaVersion: 1,
  artifactId: 'call-1',
  revisionId: 'call-1',
  program: PROGRAM,
  ...overrides,
})

const storedPrograms = file => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).programs : []

/**
 * Mount the base route from source with its own stores.
 *
 * The plugin-path harness above loads the previously built `lib/index.js`; the
 * host bundle is deliberately not rebuilt in this fix stream, so behavior
 * changes under test are exercised through the source registration directly.
 */
function mountSourceRoute() {
  const home = tempHome('iui-artifact-base-src-')
  const revisions = createArtifactRevisionStore()
  const programs = createArtifactProgramStore()
  const routes = []
  registerArtifactBaseRoute({
    inject(dependencies, callback) {
      callback({
        webServer: { register(route) { routes.push(route); return () => {} } },
        connection: { requestRejection() { return undefined } },
        effect(fn) { return fn() },
      })
    },
  }, { revisions, programs })
  return { home, revisions, programs, routes, baseRoute: routes.find(route => route.path === ARTIFACT_BASE_ROUTE_PATH) }
}

test('the base route is registered only with webServer and connection and disposed with the plugin', () => {
  assert.ok(mount().baseRoute, 'composed scope registers the route')
  for (const partial of [{ connection: false }, { webServer: false }, { webServer: false, connection: false }]) {
    assert.equal(mount(partial).baseRoute, undefined, JSON.stringify(partial))
  }
  const { disposers, disposedPaths } = mount()
  assert.ok(disposers.length > 0)
  for (const dispose of disposers) dispose()
  assert.ok(disposedPaths.includes(ARTIFACT_BASE_ROUTE_PATH))
})

test('requestRejection runs before method dispatch and preserves 401/403 denials', async () => {
  for (const rejection of [401, 403]) {
    const m = mount({ rejection })
    for (const method of ['POST', 'GET']) {
      const result = await post(m.baseRoute, { method, body: method === 'POST' ? baseBody() : undefined, raw: method === 'GET' ? '' : undefined })
      assert.equal(result.status, rejection)
      assert.equal(result.body, undefined)
      assert.equal(result.headers['cache-control'], 'no-store')
    }
    assert.equal(m.checked.length, 2)
    assert.deepEqual(storedPrograms(m.programFile), [], 'denied requests store nothing')
  }
})

test('only POST is supported and the body must be JSON', async () => {
  const m = mount()
  for (const method of ['GET', 'PUT', 'DELETE', 'HEAD']) {
    const result = await post(m.baseRoute, { method, raw: '' })
    assert.equal(result.status, 405, method)
    assert.equal(result.headers.allow, 'POST')
    assert.equal(result.body.error.code, 'method_not_allowed')
  }
  const wrongType = await post(m.baseRoute, { raw: JSON.stringify(baseBody()), headers: { 'content-type': 'text/plain' } })
  assert.equal(wrongType.status, 400)
  assert.equal(wrongType.body.error.code, 'invalid_input')
  const brokenJson = await post(m.baseRoute, { raw: '{broken' })
  assert.equal(brokenJson.status, 400)
  assert.equal(brokenJson.body.error.code, 'invalid_input')
  assert.deepEqual(storedPrograms(m.programFile), [])
})

test('a body above 1 MiB is rejected as payload_too_large', async () => {
  const m = mount()
  const declared = await post(m.baseRoute, {
    raw: '{}',
    headers: { 'content-type': 'application/json', 'content-length': String(MAX_ARTIFACT_BASE_BODY_BYTES + 1) },
  })
  assert.equal(declared.status, 413)
  assert.equal(declared.body.error.code, 'payload_too_large')
  const streamed = await post(m.baseRoute, {
    raw: 'x'.repeat(MAX_ARTIFACT_BASE_BODY_BYTES + 1),
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(streamed.status, 413)
  assert.equal(streamed.body.error.code, 'payload_too_large')
  assert.deepEqual(storedPrograms(m.programFile), [])
})

test('invalid registration bodies are rejected without storing anything', async () => {
  const m = mount()
  const invalid = [
    { ...baseBody(), schemaVersion: 2 },
    { ...baseBody(), artifactId: 'bad id' },
    { ...baseBody(), artifactId: 'x'.repeat(201) },
    { ...baseBody(), revisionId: '' },
    { ...baseBody(), revisionId: 'bad id' },
    { ...baseBody(), program: '   ' },
    { ...baseBody(), program: 'x'.repeat(MAX_ARTIFACT_PROGRAM_CHARS + 1) },
    { ...baseBody(), program: 'root = Col([Text("a")])\u0001' },
    { ...baseBody(), extra: true },
    { schemaVersion: 1, artifactId: 'call-1', revisionId: 'call-1' },
    { schemaVersion: 1, artifactId: 'call-1', program: PROGRAM },
  ]
  for (const body of invalid) {
    const result = await post(m.baseRoute, { body })
    assert.equal(result.status, 400, JSON.stringify(body).slice(0, 80))
    assert.equal(result.body.error.code, 'invalid_input', JSON.stringify(body).slice(0, 80))
  }
  // A shape-valid but structurally unusable program is rejected by the lifecycle.
  const wrongRoot = await post(m.baseRoute, { body: baseBody({ program: 'root = Markdown("plain")' }) })
  assert.equal(wrongRoot.status, 400)
  assert.equal(wrongRoot.body.error.code, 'invalid_program')
  assert.deepEqual(storedPrograms(m.programFile), [])
})

test('a padded Col program above the raw character cap is rejected as invalid_program', async () => {
  const m = mountSourceRoute()
  const program = `root = Col([Title("A")])${' '.repeat(MAX_ARTIFACT_PROGRAM_CHARS)}`
  assert.ok(program.trim().length <= MAX_ARTIFACT_PROGRAM_CHARS, 'the trimmed length is inside the cap')
  assert.ok(program.length > MAX_ARTIFACT_PROGRAM_CHARS, 'the raw length exceeds the program store cap')
  const result = await post(m.baseRoute, { body: baseBody({ program }) })
  assert.equal(result.status, 400, JSON.stringify(result.body).slice(0, 120))
  assert.equal(result.body.error.code, 'invalid_input')
  assert.match(result.body.error.message, /invalid_program/)
  assert.equal(m.programs.size(), 0, 'a rejected request stores nothing')
})

test('a storage failure answers 500 without a phantom registration and can be retried', async () => {
  const m = mountSourceRoute()
  chmodSync(m.home, 0o555)
  let failed
  try {
    failed = await post(m.baseRoute, { body: baseBody() })
  } finally {
    chmodSync(m.home, 0o755)
  }
  assert.equal(failed.status, 500, JSON.stringify(failed.body).slice(0, 120))
  assert.equal(failed.body.error.code, 'storage')
  // The rejected write must not appear in the in-memory registry used by every
  // later route read; the disk holds the previous (empty) state.
  assert.equal(m.programs.size(), 0, 'the failed write leaves no phantom record')
  assert.equal(m.programs.lookup('call-1', 'call-1'), undefined)
  const retried = await post(m.baseRoute, { body: baseBody() })
  assert.equal(retried.status, 200, JSON.stringify(retried.body).slice(0, 120))
  assert.deepEqual(retried.body, { ok: true, registered: true })
  assert.equal(m.programs.lookup('call-1', 'call-1'), PROGRAM)
})

test('the initial anchor registers once, is idempotent for the same program and conflicts on a different one', async () => {
  const m = mount()
  const first = await post(m.baseRoute, { body: baseBody() })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(first.headers['cache-control'], 'no-store')
  assert.match(first.headers['content-type'], /^application\/json/)
  assert.deepEqual(first.body, { ok: true, registered: true })
  assert.equal(isArtifactBaseSuccess(first.body), true)
  const stored = storedPrograms(m.programFile)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].artifactId, 'call-1')
  assert.equal(stored[0].revisionId, 'call-1')
  assert.equal(stored[0].program, PROGRAM)
  assert.equal(existsSync(m.artifactsFile), false, 'registration never writes a revision record')
  // Same program: no-op.
  const replay = await post(m.baseRoute, { body: baseBody() })
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.body, { ok: true, registered: false })
  assert.deepEqual(storedPrograms(m.programFile), stored, 'the no-op did not rewrite storage')
  // Different program for the same revision: write-once conflict, no storage change.
  const conflict = await post(m.baseRoute, { body: baseBody({ program: OTHER_PROGRAM }) })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error.code, 'program_conflict')
  assert.equal(JSON.stringify(conflict.body).includes('root = Col('), false, 'errors never echo the program')
  assert.deepEqual(storedPrograms(m.programFile), stored)
  assert.equal(existsSync(m.artifactsFile), false)
})

test('a non-initial revision needs recorded lineage belonging to the same artifact', async () => {
  const unknown = mount()
  const unknownResult = await post(unknown.baseRoute, { body: baseBody({ revisionId: 'rev-unknown' }) })
  assert.equal(unknownResult.status, 404)
  assert.equal(unknownResult.body.error.code, 'unknown_revision')
  assert.deepEqual(storedPrograms(unknown.programFile), [])

  const otherArtifact = mount({
    revisions: [revision({ artifactId: 'call-2', revisionId: 'rev-2', baseRevisionId: 'call-2-seed' })],
  })
  const mismatch = await post(otherArtifact.baseRoute, {
    body: baseBody({ artifactId: 'call-1', revisionId: 'rev-2' }),
  })
  assert.equal(mismatch.status, 404)
  assert.equal(mismatch.body.error.code, 'unknown_revision')
  assert.deepEqual(storedPrograms(otherArtifact.programFile), [])
})

test('a recorded anchor registers after program eviction and unlocks structure, history and restore', async () => {
  const m = mount({ revisions: [revision({ artifactId: 'call-1', revisionId: 'call-2', baseRevisionId: 'call-1' })] })
  const registered = await post(m.baseRoute, {
    body: baseBody({ revisionId: 'call-2' }),
  })
  assert.equal(registered.status, 200)
  assert.deepEqual(registered.body, { ok: true, registered: true })
  assert.equal(storedPrograms(m.programFile)[0].revisionId, 'call-2')

  // Structure preview and apply now work from the registered base.
  const preview = await post(m.structureRoute, {
    body: {
      schemaVersion: 1, artifactId: 'call-1', baseRevisionId: 'call-2',
      operationId: operationId('preview'), operations: [duplicateOp()], style: 'card', preview: true,
    },
  })
  assert.equal(preview.status, 200, JSON.stringify(preview.body))
  assert.match(preview.body.preview.program, /Title\("Initial"\), Title\("Initial"\)/)
  const applied = await post(m.structureRoute, {
    body: {
      schemaVersion: 1, artifactId: 'call-1', baseRevisionId: 'call-2',
      operationId: operationId('apply'), operations: [duplicateOp()], style: 'card',
    },
  })
  assert.equal(applied.status, 201, JSON.stringify(applied.body))
  assert.equal(applied.body.result.revision, 3)
  assert.equal(applied.body.result.baseRevisionId, 'call-2')

  // History exposes the recorded row with its now-retained program.
  const history = get(m.historyRoute, `${ARTIFACT_HISTORY_ROUTE_PATH}?artifactId=call-1`)
  assert.equal(history.status, 200)
  const recorded = history.body.revisions.find(entry => entry.revisionId === 'call-2')
  assert.equal(recorded.hasProgram, true)
  assert.equal(recorded.restorable, true)

  // Restore accepts the recorded source now that its program is retained.
  const restored = await post(m.restoreRoute, {
    body: { schemaVersion: 1, artifactId: 'call-1', sourceRevisionId: 'call-2', program: PROGRAM },
  })
  assert.equal(restored.status, 201, JSON.stringify(restored.body))
  assert.equal(restored.body.revision.baseRevisionId, 'call-2')
})

test('end to end upgrade: register initial, structure apply, history and restore (no model)', async () => {
  const m = mount()
  const registered = await post(m.baseRoute, { body: baseBody() })
  assert.deepEqual(registered.body, { ok: true, registered: true })

  const preview = await post(m.structureRoute, {
    body: {
      schemaVersion: 1, artifactId: 'call-1', baseRevisionId: 'call-1',
      operationId: operationId('e2e-preview'), operations: [duplicateOp()], style: 'card', preview: true,
    },
  })
  assert.equal(preview.status, 200, JSON.stringify(preview.body))
  const applied = await post(m.structureRoute, {
    body: {
      schemaVersion: 1, artifactId: 'call-1', baseRevisionId: 'call-1',
      operationId: operationId('e2e-apply'), operations: [duplicateOp()], style: 'card',
    },
  })
  assert.equal(applied.status, 201, JSON.stringify(applied.body))
  assert.equal(applied.body.result.revision, 2)
  assert.equal(applied.body.result.baseRevisionId, 'call-1')

  const history = get(m.historyRoute, `${ARTIFACT_HISTORY_ROUTE_PATH}?artifactId=call-1`)
  assert.equal(history.status, 200)
  assert.deepEqual(history.body.revisions.map(entry => entry.revision), [2, 1])
  const initial = history.body.revisions[1]
  assert.equal(initial.revisionId, 'call-1')
  assert.equal(initial.source, 'initial')
  assert.equal(initial.hasProgram, true)
  assert.equal(initial.restorable, true)
  assert.equal(JSON.stringify(history.body).includes('root = Col('), false, 'history stays metadata-only')

  const restored = await post(m.restoreRoute, {
    body: { schemaVersion: 1, artifactId: 'call-1', sourceRevisionId: 'call-1', program: PROGRAM },
  })
  assert.equal(restored.status, 201, JSON.stringify(restored.body))
  assert.equal(restored.body.revision.revision, 3)
  assert.equal(restored.body.revision.baseRevisionId, 'call-1')
})

test('structure route error semantics stay artifact_missing/base_missing for unregistered bases', async () => {
  const empty = mount()
  const missingArtifact = await post(empty.structureRoute, {
    body: {
      schemaVersion: 1, artifactId: 'call-1', baseRevisionId: 'call-1',
      operationId: operationId('missing'), operations: [duplicateOp()], style: 'card', preview: true,
    },
  })
  assert.equal(missingArtifact.status, 404)
  assert.equal(missingArtifact.body.error.code, 'artifact_missing')
  assert.equal(missingArtifact.body.error.message, 'no authoritative program is recorded for this artifact; render the page again before changing its structure.')

  const knownArtifact = mount({ programs: [{ artifactId: 'call-1', revisionId: 'call-1', program: PROGRAM, createdAt: 1, lastAccessAt: 1 }] })
  const missingBase = await post(knownArtifact.structureRoute, {
    body: {
      schemaVersion: 1, artifactId: 'call-1', baseRevisionId: 'call-9',
      operationId: operationId('missing-base'), operations: [duplicateOp()], style: 'card', preview: true,
    },
  })
  assert.equal(missingBase.status, 404)
  assert.equal(missingBase.body.error.code, 'base_missing')
  assert.equal(missingBase.body.error.message, 'the authoritative program for the base revision is not available; reload the page and retry.')
})

test('resolveArtifactBase keeps the structure route latest/first/base judgment', () => {
  const home = tempHome('iui-artifact-base-resolve-')
  const services = () => ({ revisions: createArtifactRevisionStore(), programs: createArtifactProgramStore() })
  const empty = services()
  assert.deepEqual(resolveArtifactBase(empty, { artifactId: 'call-1', baseRevisionId: 'call-1' }), { ok: false, kind: 'artifact_missing' })

  const initialOnly = services()
  initialOnly.programs.record({ artifactId: 'call-1', revisionId: 'call-1', program: PROGRAM })
  assert.deepEqual(resolveArtifactBase(initialOnly, { artifactId: 'call-1', baseRevisionId: 'call-1' }), { ok: true, program: PROGRAM })
  assert.deepEqual(resolveArtifactBase(initialOnly, { artifactId: 'call-1', baseRevisionId: 'call-9' }), { ok: false, kind: 'base_missing' })

  const recorded = services()
  recorded.revisions.record(revision({ artifactId: 'call-1', revisionId: 'call-2', baseRevisionId: 'call-1' }))
  assert.deepEqual(resolveArtifactBase(recorded, { artifactId: 'call-1', baseRevisionId: 'call-2' }), { ok: false, kind: 'base_missing' })
  recorded.programs.record({ artifactId: 'call-1', revisionId: 'call-2', program: PROGRAM })
  assert.deepEqual(resolveArtifactBase(recorded, { artifactId: 'call-1', baseRevisionId: 'call-2' }), { ok: true, program: PROGRAM })
  assert.ok(existsSync(join(home, 'dsh-intelligent-ui-programs.json')))
})

test('registerArtifactBase rejects provenance and structural problems before any write', () => {
  const home = tempHome('iui-artifact-base-direct-')
  const services = { revisions: createArtifactRevisionStore(), programs: createArtifactProgramStore() }
  const unknown = registerArtifactBase(services, { schemaVersion: 1, artifactId: 'call-1', revisionId: 'rev-unknown', program: PROGRAM })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.code, 'unknown_revision')
  const invalid = registerArtifactBase(services, { schemaVersion: 1, artifactId: 'call-1', revisionId: 'call-1', program: 'root = Markdown("plain")' })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.code, 'invalid_program')
  assert.equal(existsSync(join(home, 'dsh-intelligent-ui-programs.json')), false)
  const accepted = registerArtifactBase(services, { schemaVersion: 1, artifactId: 'call-1', revisionId: 'call-1', program: PROGRAM })
  assert.deepEqual(accepted, { ok: true, registered: true })
  const replay = registerArtifactBase(services, { schemaVersion: 1, artifactId: 'call-1', revisionId: 'call-1', program: PROGRAM })
  assert.deepEqual(replay, { ok: true, registered: false })
  const conflict = registerArtifactBase(services, { schemaVersion: 1, artifactId: 'call-1', revisionId: 'call-1', program: OTHER_PROGRAM })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.code, 'program_conflict')
})
