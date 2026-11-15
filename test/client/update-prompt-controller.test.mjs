/**
 * Unit tests for the update-prompt controller.
 *
 * Run: node --test test/client/update-prompt-controller.test.mjs
 *
 * The controller is browser-shaped but storage and fetch are injectable, so the
 * whole trigger/decision/action loop runs headless: explicit composer enables,
 * the deployment-wide switch watcher, persistence across page controllers,
 * queued-check races and the navigation guard.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUpdatePromptController } from '../../src/client/update-prompt-controller.ts'
import { UPDATE_PROMPT_STORAGE_KEY, parseUpdatePromptState } from '../../src/client/update-prompt.ts'

/** Let the controller's async check/action microtasks settle. */
const flush = async () => {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** One Host update answer. */
const answer = (latest, current = '0.5.0', highlights = ['要点']) => ({
  current,
  latest,
  updateAvailable: latest !== null && latest !== current,
  highlights,
})

/** In-memory storage plus a parsed view of what was written. */
function memoryStorage() {
  const data = new Map()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    read: () => parseUpdatePromptState(data.get(UPDATE_PROMPT_STORAGE_KEY) ?? null),
  }
}

/** A fetch stub returning one answer per call, recording the requested URLs. */
function fetchStub(responses) {
  const calls = []
  const impl = async (url) => {
    calls.push(String(url))
    const next = typeof responses === 'function' ? responses() : responses
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { impl, calls }
}

/** A settings source whose snapshot the test can flip. */
function settingsSource(initial) {
  let snapshot = initial
  const listeners = new Set()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

test('an explicit enable records first and asks on the next one, requesting the active language', async () => {
  const storage = memoryStorage()
  const fetch = fetchStub(answer('0.6.1'))
  const controller = createUpdatePromptController({ fetchImpl: fetch.impl, storage, language: () => 'zh-CN' })

  controller.noteOpen('explicit-enable')
  await flush()
  assert.equal(controller.store.getSnapshot().kind, 'hidden')
  assert.equal(storage.read().pendingVersion, '0.6.1')
  assert.ok(fetch.calls[0].includes('lang=zh-CN'))

  controller.noteOpen('explicit-enable')
  await flush()
  const shown = controller.store.getSnapshot()
  assert.equal(shown.kind, 'shown')
  assert.deepEqual(
    { current: shown.current, latest: shown.latest, highlights: shown.highlights, laterClicks: shown.laterClicks, canSilence: shown.canSilence },
    { current: '0.5.0', latest: '0.6.1', highlights: ['要点'], laterClicks: 0, canSilence: false },
  )
})

test('a page start whose global switch is already on asks immediately', async () => {
  const storage = memoryStorage()
  const fetch = fetchStub(answer('0.6.1'))
  const controller = createUpdatePromptController({ fetchImpl: fetch.impl, storage })
  const settings = settingsSource({ status: 'loading' })

  controller.watchGlobalSetting(settings)
  await flush()
  assert.equal(controller.store.getSnapshot().kind, 'hidden')

  settings.set({ status: 'ready', value: { globalEnabled: true } })
  await flush()
  assert.equal(controller.store.getSnapshot().kind, 'shown')
})

test('flipping the global switch mid-session waits for the next page start', async () => {
  const storage = memoryStorage()
  const fetch = fetchStub(answer('0.6.1'))
  const controller = createUpdatePromptController({ fetchImpl: fetch.impl, storage })
  const settings = settingsSource({ status: 'ready', value: { globalEnabled: false } })

  controller.watchGlobalSetting(settings)
  await flush()
  settings.set({ status: 'ready', value: { globalEnabled: true } })
  await flush()
  assert.equal(controller.store.getSnapshot().kind, 'hidden')

  // The next page controller sees the switch already on and asks at start.
  controller.dispose()
  const next = createUpdatePromptController({ fetchImpl: fetch.impl, storage })
  next.watchGlobalSetting(settingsSource({ status: 'ready', value: { globalEnabled: true } }))
  await flush()
  assert.equal(next.store.getSnapshot().kind, 'shown')
})

test('later counts per version, the fourth prompt can silence, and a newer version asks again', async () => {
  const storage = memoryStorage()
  const fetch = fetchStub(answer('0.6.1'))
  const controller = createUpdatePromptController({ fetchImpl: fetch.impl, storage })
  const open = async () => { controller.noteOpen('explicit-enable'); await flush() }

  await open() // records
  await open()
  assert.equal(controller.store.getSnapshot().canSilence, false)
  controller.actions.later()
  assert.equal(controller.store.getSnapshot().kind, 'hidden')
  assert.equal(storage.read().laterClicks, 1)
  await open()
  controller.actions.later()
  await open()
  controller.actions.later()
  await open()
  assert.equal(controller.store.getSnapshot().canSilence, true)

  controller.actions.silence()
  assert.equal(controller.store.getSnapshot().kind, 'hidden')
  assert.equal(storage.read().silencedVersion, '0.6.1')

  await open() // the silenced version stays silent
  assert.equal(controller.store.getSnapshot().kind, 'hidden')

  const newer = fetchStub(answer('0.6.2'))
  const upgraded = createUpdatePromptController({ fetchImpl: newer.impl, storage })
  upgraded.noteOpen('explicit-enable')
  await flush()
  assert.equal(upgraded.store.getSnapshot().kind, 'hidden')
  upgraded.noteOpen('explicit-enable')
  await flush()
  assert.equal(upgraded.store.getSnapshot().kind, 'shown')
  assert.equal(upgraded.store.getSnapshot().latest, '0.6.2')
  assert.equal(upgraded.store.getSnapshot().canSilence, false)
})

test('a failed registry read still asks for a recorded version using its highlights', async () => {
  const storage = memoryStorage()
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    const payload = calls === 1 ? answer('0.6.1') : { current: '0.5.0', latest: null, updateAvailable: false, highlights: [] }
    return new Response(JSON.stringify(payload), { status: 200 })
  }
  const controller = createUpdatePromptController({ fetchImpl, storage })
  controller.noteOpen('explicit-enable')
  await flush()
  controller.noteOpen('explicit-enable')
  await flush()
  const shown = controller.store.getSnapshot()
  assert.equal(shown.kind, 'shown')
  assert.equal(shown.latest, '0.6.1')
  assert.deepEqual(shown.highlights, ['要点'])
})

test('the recorded cycle survives a new page controller', async () => {
  const storage = memoryStorage()
  const fetch = fetchStub(answer('0.6.1'))
  const first = createUpdatePromptController({ fetchImpl: fetch.impl, storage })
  first.noteOpen('explicit-enable')
  await flush()
  first.dispose()

  const second = createUpdatePromptController({ fetchImpl: fetch.impl, storage })
  second.noteOpen('explicit-enable')
  await flush()
  assert.equal(second.store.getSnapshot().kind, 'shown')
})

test('a check still in flight cannot re-open the prompt after Later', async () => {
  const storage = memoryStorage()
  let calls = 0
  let release
  const fetchImpl = async () => {
    calls += 1
    if (calls <= 2) return new Response(JSON.stringify(answer('0.6.1')), { status: 200 })
    return new Promise((resolve) => {
      release = () => resolve(new Response(JSON.stringify(answer('0.6.1')), { status: 200 }))
    })
  }
  const controller = createUpdatePromptController({ fetchImpl, storage })
  controller.noteOpen('explicit-enable')
  await flush()
  controller.noteOpen('explicit-enable')
  await flush()
  assert.equal(controller.store.getSnapshot().kind, 'shown')

  controller.noteOpen('explicit-enable') // third check stays in flight
  controller.actions.later()
  assert.equal(controller.store.getSnapshot().kind, 'hidden')
  release()
  await flush()
  assert.equal(controller.store.getSnapshot().kind, 'hidden')
})

test('update keeps the prompt when navigation is unavailable and closes once it starts', async () => {
  const storage = memoryStorage()
  const fetch = fetchStub(answer('0.6.1'))
  let navigations = 0
  let canNavigate = false
  const controller = createUpdatePromptController({
    fetchImpl: fetch.impl,
    storage,
    openDetails: () => {
      if (!canNavigate) return false
      navigations += 1
      return true
    },
  })
  controller.noteOpen('explicit-enable')
  await flush()
  controller.noteOpen('explicit-enable')
  await flush()
  assert.equal(controller.store.getSnapshot().kind, 'shown')

  controller.actions.update()
  assert.equal(controller.store.getSnapshot().kind, 'shown')
  assert.equal(navigations, 0)

  canNavigate = true
  controller.actions.update()
  assert.equal(controller.store.getSnapshot().kind, 'hidden')
  assert.equal(navigations, 1)
})

test('dispose stops publishing and drops queued work', async () => {
  const storage = memoryStorage()
  const fetch = fetchStub(answer('0.6.1'))
  const controller = createUpdatePromptController({ fetchImpl: fetch.impl, storage })
  controller.dispose()
  controller.noteOpen('explicit-enable')
  await flush()
  assert.equal(controller.store.getSnapshot().kind, 'hidden')
})
