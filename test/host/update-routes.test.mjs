import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { UPDATE_ROUTE_PATH, isNewerStableVersion } from '../../src/shared/update-check.ts'
import { parseHighlights } from '../../src/shared/release-notes.ts'
import { createUpdateChecker, installedVersion } from '../../src/host/update-routes.ts'

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

const NOTES = '## Highlights\n- `侧栏` [更新](https://example.com) 提示\n- **第二**点\n\n## Details\n- 不算要点\n'

/** Stub the registry + raw notes fetches and record every URL. */
function stubFetch({ version = '0.6.0', versionError = false, notes = NOTES, notesError = false } = {}) {
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (String(url).includes('registry.npmjs.org')) {
      if (versionError) throw new Error('offline')
      return { ok: true, status: 200, async json() { return { version } } }
    }
    if (String(url).includes('raw.githubusercontent.com')) {
      if (notesError) return { ok: false, status: 404, async text() { return '' } }
      return { ok: true, status: 200, async text() { return notes } }
    }
    throw new Error(`unexpected fetch ${String(url)}`)
  }
  return calls
}

test('only a newer stable version counts as an update', () => {
  assert.equal(isNewerStableVersion('0.6.0', '0.5.0'), true)
  assert.equal(isNewerStableVersion('0.6.0', '0.6.0'), false)
  assert.equal(isNewerStableVersion('0.5.9', '0.5.10'), false)
  assert.equal(isNewerStableVersion('0.6.0-rc.1', '0.5.0'), false)
  assert.equal(isNewerStableVersion('not-a-version', '0.5.0'), false)
})

test('release notes turn their Highlights bullets into plain-text points', () => {
  assert.deepEqual(parseHighlights(NOTES), ['侧栏 更新 提示', '第二点'])
  assert.deepEqual(parseHighlights('## Details\n- nope\n'), [])
  assert.deepEqual(parseHighlights('## Highlights\n1. one\n2. two\n### nested\n- not included\n\n## Next\n- skipped\n'), ['one', 'two'])
})

test('the route reports the newer version with its reviewed highlights and caches both reads', async () => {
  const calls = stubFetch()
  const { route } = mount()
  assert.equal(typeof route?.handler, 'function')
  const first = await request(route)
  assert.equal(first.status, 200)
  assert.deepEqual(JSON.parse(first.body), {
    current: packageVersion,
    latest: '0.6.0',
    updateAvailable: true,
    highlights: ['侧栏 更新 提示', '第二点'],
  })
  assert.deepEqual(calls, [
    'https://registry.npmjs.org/@zephinel%2Fdsh-intelligent-ui/latest',
    'https://raw.githubusercontent.com/Zephinel/dsh-intelligent-ui/v0.6.0/release-notes/0.6.0.md',
  ])
  const second = await request(route)
  assert.deepEqual(JSON.parse(second.body).highlights, ['侧栏 更新 提示', '第二点'])
  assert.equal(calls.length, 2, 'the successful answer is cached for the process')
})

test('the route stays silent when the registry read fails', async () => {
  stubFetch({ versionError: true })
  const { route } = mount()
  const result = await request(route)
  assert.equal(result.status, 200)
  assert.deepEqual(JSON.parse(result.body), { current: packageVersion, latest: null, updateAvailable: false, highlights: [] })
})

test('a prerelease latest never offers an update', async () => {
  stubFetch({ version: '0.6.0-rc.1' })
  const { route } = mount()
  const result = await request(route)
  assert.deepEqual(JSON.parse(result.body), { current: packageVersion, latest: null, updateAvailable: false, highlights: [] })
})

test('a missing release-notes document keeps the update but returns no points', async () => {
  const calls = stubFetch({ notesError: true })
  const { route } = mount()
  const first = await request(route)
  assert.deepEqual(JSON.parse(first.body), { current: packageVersion, latest: '0.6.0', updateAvailable: true, highlights: [] })
  await request(route)
  assert.equal(calls.length, 2, 'an unread notes document is retried on the failure TTL rather than every request')
})

test('an unknown or prerelease running version never offers an update', async () => {
  const home = mkdtempSync(join(tmpdir(), 'iui-update-manifest-'))
  try {
    const manifest = join(home, 'package.json')
    writeFileSync(manifest, JSON.stringify({ name: '@zephinel/dsh-intelligent-ui', version: '0.6.0-rc.1' }))
    stubFetch()
    const check = createUpdateChecker({ manifestUrl: pathToFileURL(manifest) })
    assert.deepEqual(await check(), { current: '0.0.0', latest: '0.6.0', updateAvailable: false, highlights: [] })
    assert.equal(installedVersion(pathToFileURL(manifest)), undefined)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the route accepts GET only and honours connection rejection', async () => {
  stubFetch()
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
