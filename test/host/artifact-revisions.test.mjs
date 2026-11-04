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
import { ARTIFACT_REVISION_ROUTE_PATH } from '../../src/shared/artifact-edit.ts'
import { MAX_ARTIFACT_REVISIONS, createArtifactRevisionStore } from '../../src/host/artifact-revisions.ts'

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

const revision = (overrides = {}) => ({
  revisionId: 'call-2', artifactId: 'call-1', baseRevisionId: 'call-1', revision: 2,
  sessionId: 's1', style: 'card', editedBlockIds: ['b1'], createdAt: 1, ...overrides,
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
function mountRoutes({ webServer = true, connection = true, rejection, revisions = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'iui-artifact-routes-'))
  homes.push(home)
  process.env.DSH_HOME = home
  writeFileSync(join(home, 'dsh-intelligent-ui-artifacts.json'), JSON.stringify({ version: 1, revisions }))
  const routes = []
  const checked = []
  plugin.apply({
    tools: { register() {} }, systemPrompt: { section() {} }, logger: { warn() {} },
    inject(dependencies, callback) {
      if (!dependencies.includes('webServer')) return
      // Supply partial scopes too, proving a missing connection cannot expose the route.
      callback({
        ...webServer ? { webServer: { register(route) { routes.push(route); return () => {} } } } : {},
        ...connection ? { connection: { requestRejection(req) { checked.push(req); return rejection } } } : {},
        effect(fn) { return fn() },
      })
    },
  })
  return { routes, checked, route: routes.find(candidate => candidate.path === ARTIFACT_REVISION_ROUTE_PATH) }
}

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

test('registers the probe only when webServer and connection are composed', () => {
  assert.ok(mountRoutes().route)
  assert.equal(mountRoutes({ connection: false }).route, undefined)
  assert.equal(mountRoutes({ webServer: false }).route, undefined)
  assert.equal(mountRoutes({ webServer: false, connection: false }).route, undefined)
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

test('requestRejection runs before method dispatch and preserves 401/403 denial codes', () => {
  for (const rejection of [401, 403]) {
    const { route, checked } = mountRoutes({ rejection })
    for (const method of ['GET', 'POST']) {
      const result = request(route, { method })
      assert.equal(result.status, rejection)
      assert.equal(result.body, undefined)
      assert.equal(result.headers['cache-control'], 'no-store')
    }
    assert.equal(checked.length, 2)
  }
})

test('only GET is supported and query params must be artifact identities', () => {
  const { route } = mountRoutes()
  for (const method of ['HEAD', 'POST', 'PUT', 'DELETE']) {
    const result = request(route, { method })
    assert.equal(result.status, 405)
    assert.equal(result.headers.allow, 'GET')
    assert.equal(result.body, undefined)
  }
  for (const query of ['', '?artifactId=call-1', '?revisionId=call-2', '?artifactId=call-1&revisionId=',
    '?artifactId=bad%20id&revisionId=call-2', `?artifactId=${'x'.repeat(201)}&revisionId=call-2`]) {
    const result = request(route, { url: `${ARTIFACT_REVISION_ROUTE_PATH}${query}` })
    assert.equal(result.status, 400, query)
    assert.deepEqual(JSON.parse(result.body).error.code, 'invalid_input')
  }
})
