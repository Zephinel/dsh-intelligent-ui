import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStyleActions, StyleActionError } from '../../src/client/style-actions.ts'
import { template } from '../host/style-fixtures.mjs'
import { toPortableStyle } from '../../src/shared/style-template-exchange.ts'

test('all mutations share authenticated JSON POSTs and validate successful envelopes', async () => {
  const calls = []
  const saved = template({ baseLayout: 'free' })
  const actions = createStyleActions({ fetch: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, options, body })
    return new Response(JSON.stringify(body.op === 'delete' ? { deleted: body.id } : { template: saved }), { status: body.op === 'saveFromResult' ? 201 : 200 })
  } })
  const input = { resultId: 'call-1', name: 'Saved', scope: 'session', sessionId: 's1' }
  assert.deepEqual(await actions.saveFromResult(input), saved)
  assert.deepEqual(await actions.update(saved.id, { name: 'Renamed' }), saved)
  assert.equal(await actions.delete(saved.id), undefined)
  assert.deepEqual(calls.map(c => c.body), [{ op: 'saveFromResult', ...input }, { op: 'update', id: saved.id, patch: { name: 'Renamed' } }, { op: 'delete', id: saved.id }])
  for (const { url, options } of calls) {
    assert.equal(url, '/api/intelligent-ui/styles'); assert.equal(options.method, 'POST')
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store')
    assert.equal(options.headers['content-type'], 'application/json')
  }
})

test('localized errors keep Host codes; invalid/mismatched template and delete responses reject', async () => {
  for (const code of ['duplicate_name', 'result_missing', 'limit_reached', 'invalid_input']) {
    const actions = createStyleActions({ fetch: async () => new Response(JSON.stringify({ error: { code } }), { status: 400 }) })
    await assert.rejects(() => actions.saveFromResult({}), error => error instanceof StyleActionError && error.code === code)
  }
  for (const body of [null, {}, { template: { ...template(), theme: {} } }, { template: template({ id: 'cs_otherid' }) }]) {
    const actions = createStyleActions({ fetch: async () => new Response(JSON.stringify(body)) })
    await assert.rejects(() => actions.update(template().id, {}), /invalid_response/)
  }
  const actions = createStyleActions({ fetch: async () => new Response(JSON.stringify({ deleted: 'wrong-id' })) })
  await assert.rejects(() => actions.delete(template().id), /invalid_response/)
})

test('createTemplate sends only portable fields as a global authenticated save and validates the response', async () => {
  const calls = []
  const saved = template({ baseLayout: 'free' })
  const portable = toPortableStyle(saved)
  const actions = createStyleActions({ fetch: async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) })
    return new Response(JSON.stringify({ template: saved }), { status: 201 })
  } })
  assert.deepEqual(await actions.createTemplate({ ...portable, id: 'ignored', scope: 'session', sessionId: 'private' }), saved)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].body, { op: 'save', template: portable, scope: 'global' })
  assert.equal(calls[0].url, '/api/intelligent-ui/styles')
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers['content-type'], 'application/json')
})

test('createTemplate preserves Host errors and rejects invalid success responses and network failures', async () => {
  const input = toPortableStyle(template())
  for (const code of ['duplicate_name', 'limit_reached', 'invalid_input', 'save_failed']) {
    const actions = createStyleActions({ fetch: async () => new Response(JSON.stringify({ error: { code } }), { status: 400 }) })
    await assert.rejects(() => actions.createTemplate(input), error => error instanceof StyleActionError && error.code === code)
  }
  for (const body of [null, [], {}, { template: { ...template(), scope: 'session' } }, { template: { ...template(), baseLayout: 'other' } }]) {
    const actions = createStyleActions({ fetch: async () => new Response(JSON.stringify(body), { status: 201 }) })
    await assert.rejects(() => actions.createTemplate(input), /invalid_response/)
  }
  const actions = createStyleActions({ fetch: async () => { throw new Error('offline') } })
  await assert.rejects(() => actions.createTemplate(input), /offline/)
})
