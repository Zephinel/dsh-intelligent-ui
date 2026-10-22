import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { STYLES_ROUTE_PATH } from '../../src/shared/style-templates.ts'
import { template, styleInput } from './style-fixtures.mjs'

const plugin = await import('../../lib/index.js')
const homes = []
const originalHome = process.env.DSH_HOME

/** Mount the real plugin with independently available routing and auth services. */
function mount({ webServer = true, connection = true, rejection, templates = [], results = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'iui-style-routes-'))
  homes.push(home)
  process.env.DSH_HOME = home
  writeFileSync(join(home, 'dsh-intelligent-ui-styles.json'), JSON.stringify({ version: 1, templates }))
  writeFileSync(join(home, 'dsh-intelligent-ui-results.json'), JSON.stringify({ version: 1, results }))
  const routes = []
  const checked = []
  plugin.apply({
    tools: { register() {} }, systemPrompt: { section() {} },
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
  return { home, routes, checked, route: routes.find(route => route.path === STYLES_ROUTE_PATH) }
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
})

/** Invoke the exact HTTP handler while recording response metadata. */
function request(route, { method = 'GET', url = STYLES_ROUTE_PATH, body, raw, headers = { 'content-type': 'application/json' } } = {}) {
  const req = Readable.from(raw === undefined && body === undefined ? [] : [raw ?? JSON.stringify(body)])
  Object.assign(req, { method, url, headers })
  const result = { status: 0, headers: {}, body: undefined, req }
  let complete
  result.done = new Promise(resolve => { complete = resolve })
  const res = new EventEmitter()
  Object.assign(res, {
    writeHead(status, headers = {}) { result.status = status; result.headers = headers },
    end(body) { result.body = body; res.writableEnded = true; complete(result) },
  })
  route.handler(req, res)
  return result
}

test('registers the styles route only when webServer and connection are composed', () => {
  assert.ok(mount().route)
  assert.equal(mount({ connection: false }).route, undefined)
  assert.equal(mount({ webServer: false }).route, undefined)
  assert.equal(mount({ webServer: false, connection: false }).route, undefined)
})

test('GET returns full global templates plus only the requested session, without caching', () => {
  const global = template()
  const s1 = template({ id: 'cs_111111abcdef', name: 'Session 1', scope: 'session', sessionId: 'one & two', createdAt: 200, updatedAt: 200 })
  const s2 = template({ id: 'cs_222222abcdef', name: 'Session 2', scope: 'session', sessionId: 's2' })
  const { route, checked } = mount({ templates: [global, s1, s2] })
  const globals = request(route)
  assert.equal(globals.status, 200)
  assert.equal(globals.headers['cache-control'], 'no-store')
  assert.match(globals.headers['content-type'], /^application\/json/)
  assert.deepEqual(JSON.parse(globals.body), { templates: [global] })
  const filtered = request(route, { url: `${STYLES_ROUTE_PATH}?sessionId=${encodeURIComponent('one & two')}` })
  assert.deepEqual(JSON.parse(filtered.body), { templates: [s1, global] })
  assert.deepEqual(JSON.parse(request(route, { url: `${STYLES_ROUTE_PATH}?sessionId=missing` }).body), { templates: [global] })
  assert.deepEqual(checked[0], globals.req)
  assert.equal(checked.length, 3)
})

test('requestRejection runs before method dispatch and preserves 401/403 denial codes', () => {
  for (const rejection of [401, 403]) {
    const { route, checked } = mount({ rejection, templates: [template()] })
    for (const method of ['GET', 'POST']) {
      const result = request(route, { method })
      assert.equal(result.status, rejection)
      assert.equal(result.body, undefined)
      assert.equal(result.headers['cache-control'], 'no-store')
    }
    assert.equal(checked.length, 2)
  }
})

test('unsupported methods return 405 and advertise GET and POST', () => {
  const { route, checked } = mount()
  for (const method of ['PATCH', 'HEAD', 'PUT', 'DELETE']) {
    const result = request(route, { method })
    assert.equal(result.status, 405)
    assert.equal(result.headers.allow, 'GET, POST')
    assert.equal(result.body, undefined)
  }
  assert.equal(checked.length, 4)
})

async function post(route, body, options = {}) {
  return await request(route, { method: 'POST', body, ...options }).done
}

test('POST save validates, trims labels, drops global sessionId and persists to GET', async () => {
  const { route } = mount()
  const { scope, ...draft } = styleInput()
  const result = await post(route, { op: 'save', template: { ...draft, name: '  New style  ', description: '  Details  ' }, scope: 'global', sessionId: 'discard' })
  assert.equal(result.status, 201)
  const saved = JSON.parse(result.body).template
  assert.equal(saved.name, 'New style')
  assert.equal(saved.description, 'Details')
  assert.equal('sessionId' in saved, false)
  assert.equal(saved.scope, 'global')
  assert.match(saved.id, /^cs_/)
  assert.deepEqual(JSON.parse(request(route).body).templates, [saved])
  const duplicate = await post(route, { op: 'save', template: { ...draft, name: 'NEW STYLE' }, scope: 'global' })
  assert.equal(duplicate.status, 400)
  assert.equal(JSON.parse(duplicate.body).error.code, 'duplicate_name')
  const { description, ...optional } = draft
  const session = await post(route, { op: 'save', template: { ...optional, name: 'Session style' }, scope: 'session', sessionId: '  s1  ' })
  assert.equal(session.status, 201)
  assert.equal(JSON.parse(session.body).template.description, '')
  assert.equal(JSON.parse(session.body).template.sessionId, 's1')
  assert.equal(JSON.parse(request(route).body).templates.length, 1)
  assert.equal(JSON.parse(request(route, { url: `${STYLES_ROUTE_PATH}?sessionId=s1` }).body).templates.length, 2)
})

test('POST rejects invalid operations, fields, scope/session rules and JSON bodies', async () => {
  const { route } = mount()
  const { scope, ...draft } = styleInput()
  const valid = { op: 'save', template: draft, scope }
  for (const body of [null, {}, { ...valid, op: 'delete' }, { ...valid, scope: 'other' },
    { ...valid, scope: 'session' }, { ...valid, scope: 'session', sessionId: ' ' },
    { ...valid, scope: 'session', sessionId: 'x'.repeat(201) },
    { ...valid, template: { ...draft, name: 'x'.repeat(31) } },
    { ...valid, template: { ...draft, directives: 'x'.repeat(2001) } },
    { ...valid, template: { ...draft, theme: { ...draft.theme, css: 'red' } } },
    { ...valid, template: { ...draft, description: 123 } }, { ...valid, extra: true },
  ]) {
    const result = await post(route, body)
    assert.equal(result.status, 400, JSON.stringify(body))
    assert.equal(JSON.parse(result.body).error.code, 'invalid_input')
  }
  for (const options of [{ raw: '{' }, { headers: {} }, { headers: { 'content-type': 'text/plain' } },
    { raw: 'x'.repeat(65537) }, { headers: { 'content-type': 'application/json', 'content-length': '65537' } },
  ]) assert.equal((await post(route, valid, options)).status, 400)
  assert.equal((await post(route, valid, { headers: { 'content-type': 'application/json; charset=utf-8' } })).status, 201)
})

const snapshot = { schemaVersion: 1, baseLayout: 'card', directives: 'Reusable hierarchy.\nPreserve this exact spacing.  ', theme: template().theme, suggestedName: 'Suggested' }
const storedResult = { resultId: 'result-1', sessionId: 's1', snapshot, createdAt: 1 }
const saveResult = { op: 'saveFromResult', resultId: 'result-1', name: 'Saved result', scope: 'global' }

test('saveFromResult copies exactly the Host snapshot across restart, never writes settings or changes defaults', async () => {
  const { route, home } = mount({ results: [storedResult] })
  const settings = '{"answerStyle":"article","globalEnabled":false}'
  writeFileSync(join(home, 'settings.json'), settings)
  const first = await post(route, saveResult)
  assert.equal(first.status, 201)
  const saved = JSON.parse(first.body).template
  assert.deepEqual({ baseLayout: saved.baseLayout, theme: saved.theme, directives: saved.directives },
    { baseLayout: snapshot.baseLayout, theme: snapshot.theme, directives: snapshot.directives })
  assert.equal(saved.name, saveResult.name)
  assert.equal(saved.description, '')
  assert.equal(saved.scope, 'global')
  assert.equal('sessionId' in saved, false)
  assert.equal(readFileSync(join(home, 'settings.json'), 'utf8'), settings)
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'dsh-intelligent-ui-results.json'), 'utf8')), { version: 1, results: [storedResult] })
  const session = await post(route, { ...saveResult, name: 'Session result', scope: 'session', sessionId: 's1', description: 'Stored locally' })
  assert.equal(session.status, 201)
  assert.equal(JSON.parse(session.body).template.sessionId, 's1')
  assert.equal(JSON.parse(session.body).template.description, 'Stored locally')
})

test('saveFromResult rejects missing results, duplicates, scope limits and all client snapshot fields', async () => {
  const { route } = mount({ results: [storedResult] })
  const missing = await post(route, { ...saveResult, resultId: 'unknown' })
  assert.equal(missing.status, 404); assert.equal(JSON.parse(missing.body).error.code, 'result_missing')
  assert.equal((await post(route, { ...saveResult, resultId: 'unknown', name: 'Auto' })).status, 400, 'metadata validates before result lookup')
  assert.equal((await post(route, saveResult)).status, 201)
  const duplicate = await post(route, { ...saveResult, name: 'SAVED RESULT' })
  assert.equal(duplicate.status, 400); assert.equal(JSON.parse(duplicate.body).error.code, 'duplicate_name')
  for (const patch of [{ snapshot }, { temporaryStyle: snapshot }, { directives: 'Tampered' }, { theme: snapshot.theme }, { baseLayout: 'article' },
    { resultId: '' }, { resultId: 'x'.repeat(201) }, { name: 'Auto' }, { name: 'Card' }, { name: 'Article' },
    { name: 'x'.repeat(31) }, { name: 'bad\nlabel' }, { name: 'bad\u0085label' }, { name: '' }, { description: null },
    { description: 'x'.repeat(101) }, { scope: 'session' }, { scope: 'session', sessionId: 'other-session' }, { sessionId: 3 },
  ]) {
    const response = await post(route, { ...saveResult, ...patch })
    assert.equal(response.status, 400, JSON.stringify(patch)); assert.equal(JSON.parse(response.body).error.code, 'invalid_input')
  }
  for (const scope of ['global', 'session']) {
    const { route: full } = mount({ results: [storedResult], templates: Array.from({ length: scope === 'global' ? 40 : 20 }, (_, i) =>
      template({ id: `cs_limit${String(i).padStart(6, '0')}`, name: `Style ${i}`, scope, ...scope === 'session' ? { sessionId: 's1' } : {} })) })
    const limit = await post(full, { ...saveResult, scope, sessionId: 's1' })
    assert.equal(limit.status, 400); assert.equal(JSON.parse(limit.body).error.code, 'limit_reached')
  }
})

test('update/delete restrict editable fields, preserve snapshot history, and return explicit missing errors', async () => {
  const { route, home } = mount({ results: [storedResult], templates: [template(), template({ id: 'cs_second1', name: 'Second' })] })
  const id = template().id
  const updated = await post(route, { op: 'update', id, patch: { name: 'Renamed', description: 'New description', directives: 'New\npreferences' } })
  assert.equal(updated.status, 200)
  const saved = JSON.parse(updated.body).template
  assert.equal(saved.name, 'Renamed'); assert.equal(saved.directives, 'New\npreferences')
  assert.equal(saved.description, 'New description'); assert.deepEqual(saved.theme, template().theme)
  assert.equal(saved.baseLayout, template().baseLayout)
  const duplicate = await post(route, { op: 'update', id, patch: { name: 'SECOND' } })
  assert.equal(JSON.parse(duplicate.body).error.code, 'duplicate_name')
  for (const patch of [{}, { theme: snapshot.theme }, { baseLayout: 'article' }, { scope: 'session' },
    { name: 'auto' }, { name: 'x'.repeat(31) }, { description: 'x'.repeat(101) }, { directives: 'x'.repeat(2001) }, { directives: '\u0000' }, { name: null },
  ]) assert.equal((await post(route, { op: 'update', id, patch })).status, 400)
  assert.equal((await post(route, { op: 'update', id: 'cs_unknown', patch: { name: 'Missing' } })).status, 404)
  assert.equal((await post(route, { op: 'delete', id, extra: true })).status, 400)
  const removed = await post(route, { op: 'delete', id })
  assert.equal(removed.status, 200); assert.deepEqual(JSON.parse(removed.body), { deleted: id })
  assert.equal((await post(route, { op: 'delete', id })).status, 404)
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'dsh-intelligent-ui-results.json'), 'utf8')), { version: 1, results: [storedResult] })
  assert.equal((await post(route, { ...saveResult, name: 'Saved after delete' })).status, 201)
})

