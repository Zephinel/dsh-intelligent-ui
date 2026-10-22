import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStyleActions, StyleActionError } from '../../src/client/style-actions.ts'
import { template } from '../host/style-fixtures.mjs'

test('all mutations share authenticated JSON POSTs and validate successful envelopes', async () => {
  const calls = []
  const saved = template()
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
