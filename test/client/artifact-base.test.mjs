/**
 * Unit tests for the client lazy Artifact base registration.
 *
 *   node --test test/client/artifact-base.test.mjs
 *
 * The module keeps a process-wide cache, so every test owns unique
 * artifact/revision identities.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ARTIFACT_BASE_ROUTE_PATH } from '../../src/shared/artifact-base.ts'
import { ensureArtifactBase, invalidateArtifactBase } from '../../src/client/artifact-edit/artifact-base.ts'

/** One renderable program used as the registration payload. */
const PROGRAM = 'root = Col([Title("Initial"), Text("body")])'

/** JSON Response helper. */
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

/** Let the registration's internal promise chain run to the fetch call. */
async function tick() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

test('concurrent ensures share one single-flight request and cache the outcome', async () => {
  const calls = []
  let releaseFetch
  const gate = new Promise(resolve => { releaseFetch = resolve })
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    await gate
    return jsonResponse({ ok: true, registered: true })
  }
  const input = { artifactId: 'base-single-flight', revisionId: 'base-single-flight', program: PROGRAM }
  const first = ensureArtifactBase(input)
  const second = ensureArtifactBase({ ...input })
  await tick()
  assert.equal(calls.length, 1, 'two concurrent ensures started exactly one request')
  releaseFetch()
  assert.deepEqual(await Promise.all([first, second]), ['registered', 'registered'])
  // A later call is served from the cache.
  assert.equal(await ensureArtifactBase(input), 'registered')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, ARTIFACT_BASE_ROUTE_PATH)
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.equal(calls[0].options.cache, 'no-store')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    schemaVersion: 1,
    artifactId: 'base-single-flight',
    revisionId: 'base-single-flight',
    program: PROGRAM,
  })
})

test('a present base resolves to present and is cached', async () => {
  const calls = []
  globalThis.fetch = async url => {
    calls.push(String(url))
    return jsonResponse({ ok: true, registered: false })
  }
  const input = { artifactId: 'base-present', revisionId: 'base-present', program: PROGRAM }
  assert.equal(await ensureArtifactBase(input), 'present')
  assert.equal(await ensureArtifactBase(input), 'present')
  assert.equal(calls.length, 1)
})

test('a 404 from an old Host caches unsupported and stops probing that revision', async () => {
  const calls = []
  globalThis.fetch = async () => {
    calls.push('probe')
    return jsonResponse({ error: { code: 'not_found', message: 'unknown route' } }, 404)
  }
  const input = { artifactId: 'base-old-host', revisionId: 'base-old-host', program: PROGRAM }
  assert.equal(await ensureArtifactBase(input), 'unsupported')
  assert.equal(await ensureArtifactBase(input), 'unsupported')
  assert.equal(calls.length, 1, 'the unsupported capability is cached per revision')
})

test('a network failure is retryable and never throws', async () => {
  let attempt = 0
  globalThis.fetch = async () => {
    attempt += 1
    if (attempt === 1) throw new Error('offline')
    return jsonResponse({ ok: true, registered: true })
  }
  const input = { artifactId: 'base-retry', revisionId: 'base-retry', program: PROGRAM }
  assert.equal(await ensureArtifactBase(input), 'failed')
  assert.equal(await ensureArtifactBase(input), 'registered', 'the failed outcome was not cached')
  assert.equal(attempt, 2)
})

test('a server error or malformed success body is retryable too', async () => {
  const responses = [
    () => jsonResponse({ error: { code: 'storage', message: 'failed' } }, 500),
    () => jsonResponse({ ok: true }),
    () => jsonResponse({ ok: true, registered: false }),
  ]
  let attempt = 0
  globalThis.fetch = async () => responses[Math.min(attempt++, responses.length - 1)]()
  const input = { artifactId: 'base-malformed', revisionId: 'base-malformed', program: PROGRAM }
  assert.equal(await ensureArtifactBase(input), 'failed')
  assert.equal(await ensureArtifactBase(input), 'failed')
  assert.equal(await ensureArtifactBase(input), 'present')
  assert.equal(attempt, 3)
})

test('invalidation drops the cached outcome so the next ensure re-posts', async () => {
  const calls = []
  globalThis.fetch = async () => {
    calls.push('post')
    return jsonResponse({ ok: true, registered: true })
  }
  const input = { artifactId: 'base-invalidate', revisionId: 'base-invalidate', program: PROGRAM }
  assert.equal(await ensureArtifactBase(input), 'registered')
  assert.equal(await ensureArtifactBase(input), 'registered')
  assert.equal(calls.length, 1, 'the first outcome was cached')
  invalidateArtifactBase(input.artifactId, input.revisionId)
  assert.equal(await ensureArtifactBase(input), 'registered', 'the re-registration result is reported too')
  assert.equal(calls.length, 2, 'invalidation forced exactly one new request')
})

test('invalidation during an in-flight ensure cannot repopulate the cache', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    await gate
    return jsonResponse({ ok: true, registered: true })
  }
  const input = { artifactId: 'base-inflight-invalidate', revisionId: 'base-inflight-invalidate', program: PROGRAM }
  const first = ensureArtifactBase(input)
  await tick()
  assert.equal(calls, 1)
  invalidateArtifactBase(input.artifactId, input.revisionId)
  release()
  assert.equal(await first, 'registered')
  // The stale answer was discarded; the next ensure starts a fresh request.
  globalThis.fetch = async () => {
    calls += 1
    return jsonResponse({ ok: true, registered: false })
  }
  assert.equal(await ensureArtifactBase(input), 'present')
  assert.equal(calls, 2, 'the invalidated revision was not served from the stale cache')
})
