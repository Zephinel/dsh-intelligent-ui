/** Local template catalog lifecycle; no browser or React runtime required. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStyleCatalog, styleCatalog } from '../../src/client/styles.ts'
import { STYLES_ROUTE_PATH } from '../../src/shared/style-templates.ts'
import { template } from '../host/style-fixtures.mjs'

const ok = templates => ({ ok: true, json: async () => ({ templates }) })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('import and construction are lazy, fetch uses session URL and local-only options', async () => {
  const calls = []
  const catalog = createStyleCatalog({ fetch: async (...args) => { calls.push(args); return ok([template()]) } })
  assert.equal(styleCatalog.status, 'idle')
  assert.deepEqual(catalog.getSnapshot(), { status: 'idle', templates: [] })
  assert.equal(calls.length, 0)
  const snapshots = []
  const stop = catalog.subscribe(() => snapshots.push(catalog.getSnapshot()))
  await catalog.ensure('session /?')
  assert.deepEqual(calls, [[`${STYLES_ROUTE_PATH}?sessionId=session%20%2F%3F`, { credentials: 'same-origin', cache: 'no-store' }]])
  assert.deepEqual(snapshots.map(s => s.status), ['loading', 'ready'])
  assert.equal(catalog.status, 'ready')
  assert.deepEqual(catalog.getTemplate(template().id), template())
  assert.equal(catalog.getTemplate('cs_missing'), undefined)
  const snapshot = catalog.getSnapshot()
  await catalog.ensure('session /?')
  assert.equal(catalog.getSnapshot(), snapshot, 'stable ready snapshots avoid unnecessary React updates')
  stop()
  await catalog.refresh()
  assert.equal(snapshots.length, 2)
  assert.equal(calls.length, 2)
})

test('drops invalid entries and never admits another session’s private templates', async () => {
  const own = template({ id: 'cs_session1', scope: 'session', sessionId: 'one' })
  const other = template({ id: 'cs_session2', scope: 'session', sessionId: 'two' })
  const catalog = createStyleCatalog({ fetch: async () => ok([null, {}, template({ id: 'bad' }), template({ theme: {} }), template(), own, other]) })
  await catalog.ensure('one')
  assert.deepEqual(catalog.getSnapshot().templates, [template(), own])
  await catalog.ensure()
  assert.deepEqual(catalog.getSnapshot().templates, [template()])
})

test('dedupes in-flight requests and fetches again only on refresh or session switch', async () => {
  const gate = deferred()
  const calls = []
  const catalog = createStyleCatalog({ fetch: async url => { calls.push(url); await gate.promise; return ok([]) } })
  const first = catalog.ensure()
  assert.equal(catalog.ensure(), first)
  assert.equal(catalog.status, 'loading')
  gate.resolve()
  await first
  await catalog.ensure()
  await catalog.ensure('one')
  await catalog.ensure('one')
  await catalog.refresh()
  assert.deepEqual(calls, [STYLES_ROUTE_PATH, `${STYLES_ROUTE_PATH}?sessionId=one`, `${STYLES_ROUTE_PATH}?sessionId=one`])
})

test('late results from an old session cannot replace the current snapshot', async () => {
  const old = deferred()
  const catalog = createStyleCatalog({ fetch: async url => url.endsWith('old') ? old.promise : ok([template()]) })
  const pending = catalog.ensure('old')
  await catalog.ensure('new')
  old.resolve(ok([template({ id: 'cs_oldold', scope: 'session', sessionId: 'old' })]))
  await pending
  assert.equal(catalog.getSnapshot().sessionId, 'new')
  assert.deepEqual(catalog.getSnapshot().templates, [template()])
})

for (const [name, fail] of [
  ['HTTP failure', async () => ({ ok: false, status: 503 })],
  ['network failure', async () => { throw new Error('offline') }],
  ['JSON failure', async () => ({ ok: true, json: async () => { throw new Error('bad JSON') } })],
  ['invalid envelope', async () => ({ ok: true, json: async () => ({ templates: null }) })],
]) {
  test(`${name} keeps the last catalog, marks it unavailable, and ensure retries`, async () => {
    let fetcher = async () => ok([template()])
    const catalog = createStyleCatalog({ fetch: (...args) => fetcher(...args) })
    await catalog.ensure('one')
    fetcher = fail
    await catalog.refresh()
    assert.equal(catalog.status, 'unavailable')
    assert.ok(catalog.getSnapshot().error)
    assert.deepEqual(catalog.getSnapshot().templates, [template()])
    fetcher = async () => ok([])
    await catalog.ensure('one')
    assert.equal(catalog.status, 'ready')
    assert.equal(catalog.getSnapshot().error, undefined)
    assert.deepEqual(catalog.getSnapshot().templates, [])
  })
}

test('refresh forces a new request even while ensure is loading', async () => {
  const gates = [deferred(), deferred()]
  let calls = 0
  const catalog = createStyleCatalog({ fetch: () => gates[calls++].promise })
  const first = catalog.ensure('one')
  const refreshed = catalog.refresh()
  assert.notEqual(first, refreshed)
  assert.equal(catalog.ensure('one'), refreshed)
  await Promise.resolve()
  assert.equal(calls, 2)
  gates[1].resolve(ok([template()]))
  await refreshed
  gates[0].resolve(ok([]))
  await first
  assert.deepEqual(catalog.getSnapshot().templates, [template()], 'the replaced request cannot overwrite the refresh')
})
