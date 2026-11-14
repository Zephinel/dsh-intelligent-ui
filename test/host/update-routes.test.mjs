import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { UPDATE_ROUTE_PATH } from '../../src/shared/update-check.ts'
import { isNewerStableVersion } from '../../src/shared/update-check.ts'

const plugin = await import('../../lib/index.js')
const packageVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

/** Mount the real plugin with recording webServer/connection services. */
function mount({ webServer = true, connection = true, rejection } = {}) {
  const routes = []
  plugin.apply({
    tools: { register() {} }, systemPrompt: { section() {} },
    inject(dependencies, callback) {
      if (!dependencies.includes('webServer')) return
      callback({
        ...webServer ? { webServer: { register(route) { routes.push(route); return () => {} } } } : {},
        ...connection ? { connection: { requestRejection(req) { return rejection } } } : {},
        effect(fn) { return fn() },
      })
    },
  })
  return { routes, route: routes.find(item => item.path === UPDATE_ROUTE_PATH) }
}

/** Invoke the exact HTTP handler while recording response metadata. */
function request(route, { method = 'GET', url = UPDATE_ROUTE_PATH } = {}) {
  const req = Readable.from([])
  Object.assign(req, { method, url, headers: {} })
  const result = { status: 0, headers: {}, body: undefined, req }
  let complete
  result.done = new Promise(resolve => { complete = resolve })
  const res = new EventEmitter()
  Object.assign(res, {
    writeHead(status, headers = {}) { result.status = status; result.headers = headers },
    end(body) { result.body = body; res.writableEnded = true; complete(result) },
  })
  route.handler(req, res)
  return result.done
}

/** Stub one registry answer for the next checks. */
function stubFetch(answer) {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (answer instanceof Error) throw answer
    return {
      ok: true,
      status: 200,
      async json() { return answer },
    }
  }
  return () => calls
}

test('only a newer stable version counts as an update', () => {
  assert.equal(isNewerStableVersion('0.6.0', '0.5.0'), true)
  assert.equal(isNewerStableVersion('0.6.0', '0.6.0'), false)
  assert.equal(isNewerStableVersion('0.5.9', '0.5.10'), false)
  assert.equal(isNewerStableVersion('0.6.0-rc.1', '0.5.0'), false)
  assert.equal(isNewerStableVersion('not-a-version', '0.5.0'), false)
})

test('the route reports a newer stable version and caches it', async () => {
  const fetchCalls = stubFetch({ version: '0.6.0' })
  const { route } = mount()
  assert.equal(typeof route?.handler, 'function')
  const first = await request(route)
  assert.equal(first.status, 200)
  assert.deepEqual(JSON.parse(first.body), { current: packageVersion, latest: '0.6.0', updateAvailable: true })
  const second = await request(route)
  assert.deepEqual(JSON.parse(second.body), { current: packageVersion, latest: '0.6.0', updateAvailable: true })
  assert.equal(fetchCalls(), 1, 'the successful answer is cached for the process')
})

test('the route stays silent when the registry read fails', async () => {
  stubFetch(new Error('offline'))
  const { route } = mount()
  const result = await request(route)
  assert.equal(result.status, 200)
  assert.deepEqual(JSON.parse(result.body), { current: packageVersion, latest: null, updateAvailable: false })
})

test('a prerelease latest never offers an update', async () => {
  stubFetch({ version: '0.6.0-rc.1' })
  const { route } = mount()
  const result = await request(route)
  assert.deepEqual(JSON.parse(result.body), { current: packageVersion, latest: null, updateAvailable: false })
})

test('the route accepts GET only and honours connection rejection', async () => {
  stubFetch({ version: '0.6.0' })
  const { route } = mount({ rejection: 403 })
  const rejected = await request(route)
  assert.equal(rejected.status, 403)
  const other = mount()
  const post = await request(other.route, { method: 'POST' })
  assert.equal(post.status, 405)
})

test('a deployment without both services exposes no update route', () => {
  assert.equal(mount({ connection: false }).route, undefined)
  assert.equal(mount({ webServer: false }).route, undefined)
})
