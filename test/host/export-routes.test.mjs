/**
 * Host regression test: the standalone renderer assets are served on the two
 * same-origin routes the browser export fetches.
 *
 *   node scripts/build.mjs host
 *   node --test test/host/export-routes.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
const plugin = await import('../../lib/index.js')
import {
  EXPORT_STANDALONE_CSS_PATH,
  EXPORT_STANDALONE_JS_PATH,
} from '../../src/shared/intelligent-ui.ts'

/** Mount the Host with a fake web server and capture its exact routes. */
function mount() {
  const routes = []
  plugin.apply({
    tools: { register() {} },
    systemPrompt: { section() {} },
    logger: { warn() {} },
    inject(dependencies, callback) {
      if (!dependencies.includes('webServer')) return
      callback({
        webServer: {
          register(route) {
            routes.push(route)
            return () => {}
          },
        },
        effect(fn) { return fn() },
      })
    },
    effect(fn) { return fn() },
  })
  return routes
}

/** Invoke one route handler and return its status, headers and body. */
function request(route, method) {
  const response = { status: 0, headers: {}, body: undefined }
  route.handler({ method }, {
    writeHead(status, headers = {}) { response.status = status; response.headers = headers },
    end(body) { response.body = body },
  })
  return response
}

test('the Host serves both standalone renderer assets', () => {
  const routes = mount()
  const js = routes.find(route => route.path === EXPORT_STANDALONE_JS_PATH)
  const css = routes.find(route => route.path === EXPORT_STANDALONE_CSS_PATH)
  assert.ok(js !== undefined, 'standalone JavaScript route is registered')
  assert.ok(css !== undefined, 'standalone stylesheet route is registered')

  const jsResponse = request(js, 'GET')
  assert.equal(jsResponse.status, 200)
  assert.match(jsResponse.headers['content-type'], /^text\/javascript/)
  assert.ok(jsResponse.body.length > 1_000_000, 'the renderer script ships')
  assert.match(jsResponse.body.toString('utf8', 0, 40), /window\.mountIUI|=>/)

  const cssResponse = request(css, 'GET')
  assert.equal(cssResponse.status, 200)
  assert.match(cssResponse.headers['content-type'], /^text\/css/)
  assert.ok(cssResponse.body.length > 100_000, 'the renderer stylesheet ships')

  const head = request(js, 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.body, undefined, 'HEAD sends no body')

  assert.equal(request(js, 'POST').status, 405)
})
