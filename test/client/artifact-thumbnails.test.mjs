/**
 * Unit tests for the M2 thumbnail cache: storage keys, the bounded LRU,
 * IndexedDB graceful degradation, and the repository's hydrate/put/remove
 * behaviour with an injected persistence adapter.
 *
 * Run: node --test test/client/artifact-thumbnails.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_THUMBNAIL_LIMITS,
  chooseThumbnailSnapshot,
  createIndexedDbThumbnailPersistence,
  createMemoryThumbnailPersistence,
  createThumbnailLru,
  createThumbnailRepository,
  oppositeThumbnailScheme,
  thumbnailKey,
} from '../../src/client/artifact-edit/artifact-thumbnails.ts'

/** Fake bitmap with a controlled byte size. */
function thumb(bytes, overrides = {}) {
  return { blob: { size: bytes }, width: 300, height: 120, createdAt: 1, ...overrides }
}

/** Wrap one memory persistence and remember every write/remove for assertions. */
function recordingPersistence() {
  const inner = createMemoryThumbnailPersistence()
  const writes = []
  const removes = []
  return {
    writes,
    removes,
    persistence: {
      read: key => inner.read(key),
      write: async record => { writes.push(record); await inner.write(record) },
      remove: async key => { removes.push(key); await inner.remove(key) },
      list: artifactId => inner.list(artifactId),
      clearArtifact: artifactId => inner.clearArtifact(artifactId),
    },
  }
}

const PARTS = { artifactId: 'call_a', revisionId: 'rev_2', scheme: 'light' }

test('thumbnail keys separate scheme and artifact identity', () => {
  assert.equal(thumbnailKey(PARTS), 'call_a\u0000rev_2\u0000light')
  assert.notEqual(thumbnailKey(PARTS), thumbnailKey({ ...PARTS, scheme: 'dark' }))
  assert.notEqual(thumbnailKey(PARTS), thumbnailKey({ ...PARTS, artifactId: 'call_b' }))
  assert.equal(DEFAULT_THUMBNAIL_LIMITS.maxEntries > 0, true)
  assert.equal(DEFAULT_THUMBNAIL_LIMITS.maxBytes > 0, true)
})

test('the LRU evicts the oldest entry by count and refreshes recency on get', () => {
  const evicted = []
  const lru = createThumbnailLru({ maxEntries: 2, onEvict: key => { evicted.push(key) } })
  lru.set('a', thumb(10))
  lru.set('b', thumb(10))
  lru.get('a')
  lru.set('c', thumb(10))
  assert.deepEqual(evicted, ['b'], 'the least recently used entry is evicted')
  assert.deepEqual(lru.keys(), ['a', 'c'])
  assert.equal(lru.size(), 2)
})

test('the LRU evicts by byte budget but always keeps the newest entry', () => {
  const evicted = []
  const lru = createThumbnailLru({ maxEntries: 10, maxBytes: 25, onEvict: key => { evicted.push(key) } })
  lru.set('a', thumb(20))
  lru.set('b', thumb(20))
  assert.deepEqual(evicted, ['a'])
  assert.deepEqual(lru.keys(), ['b'])
  assert.equal(lru.bytes(), 20)
  lru.set('c', thumb(40))
  assert.deepEqual(evicted, ['a', 'b'], 'an oversized newest entry survives alone')
  assert.deepEqual(lru.keys(), ['c'])
})

test('the LRU delete/clear report removed bytes', () => {
  const lru = createThumbnailLru({ maxEntries: 4 })
  lru.set('a', thumb(12))
  lru.set('b', thumb(8))
  assert.equal(lru.bytes(), 20)
  lru.delete('a')
  assert.equal(lru.bytes(), 8)
  lru.clear()
  assert.equal(lru.size(), 0)
  assert.equal(lru.bytes(), 0)
})

test('IndexedDB persistence degrades to no-ops when the API is unavailable', async () => {
  const persistence = createIndexedDbThumbnailPersistence(undefined)
  assert.equal(await persistence.read('missing'), undefined)
  await persistence.write({ key: 'k', artifactId: 'a', revisionId: 'r', scheme: 'light', ...thumb(10), blob: new Blob([new Uint8Array(10)]) })
  assert.deepEqual(await persistence.list('a'), [])
  await persistence.remove('k')
  await persistence.clearArtifact('a')
})

test('the repository hydrates persisted records and exposes object URLs', async () => {
  const { persistence } = recordingPersistence()
  const blob = new Blob([new Uint8Array(16)])
  await persistence.write({ key: thumbnailKey(PARTS), artifactId: 'call_a', revisionId: 'rev_2', scheme: 'light', blob, width: 300, height: 120, createdAt: 5 })
  const revoked = []
  const repository = createThumbnailRepository({
    persistence,
    createObjectURL: () => 'blob:thumb-1',
    revokeObjectURL: url => { revoked.push(url) },
  })
  assert.equal(repository.snapshot(PARTS).status, 'missing')
  await repository.hydrate('call_a')
  const snapshot = repository.snapshot(PARTS)
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.url, 'blob:thumb-1')
  assert.equal(snapshot.width, 300)
  assert.deepEqual(repository.thumbnail(PARTS).blob, blob)
  await repository.remove(PARTS)
  assert.equal(repository.snapshot(PARTS).status, 'missing')
  assert.deepEqual(revoked, ['blob:thumb-1'], 'the object URL is revoked when the entry is removed')
})

test('the repository marks a persisted load as loading and notifies subscribers', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const blob = new Blob([new Uint8Array(8)])
  const repository = createThumbnailRepository({
    persistence: {
      async read() { await gate; return { key: thumbnailKey(PARTS), artifactId: 'call_a', revisionId: 'rev_2', scheme: 'light', blob, width: 300, height: 120, createdAt: 2 } },
      async write() {},
      async remove() {},
      async list() { return [] },
      async clearArtifact() {},
    },
    createObjectURL: () => 'blob:loading',
  })
  let notified = 0
  repository.subscribe(() => { notified += 1 })
  const pending = repository.ensure(PARTS)
  assert.equal(repository.snapshot(PARTS).status, 'loading')
  release()
  await pending
  assert.equal(repository.snapshot(PARTS).status, 'ready')
  assert.ok(notified >= 2, 'loading and ready both notify')
})

test('put writes through the persistence layer and removeRevision drops both schemes', async () => {
  const { persistence, writes, removes } = recordingPersistence()
  const repository = createThumbnailRepository({ persistence, createObjectURL: () => 'blob:x' })
  repository.put(PARTS, thumb(10))
  repository.put({ ...PARTS, scheme: 'dark' }, thumb(11))
  assert.equal(repository.snapshot(PARTS).status, 'ready')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(writes.length, 2)
  assert.equal(writes[0].artifactId, 'call_a')
  await repository.removeRevision('call_a', 'rev_2')
  assert.equal(repository.snapshot(PARTS).status, 'missing')
  assert.equal(repository.snapshot({ ...PARTS, scheme: 'dark' }).status, 'missing')
  assert.deepEqual(removes.sort(), [thumbnailKey({ ...PARTS, scheme: 'dark' }), thumbnailKey(PARTS)].sort())
})

test('clearArtifact removes every cached scheme of one artifact only', async () => {
  const { persistence } = recordingPersistence()
  const repository = createThumbnailRepository({ persistence, createObjectURL: () => 'blob:x' })
  repository.put(PARTS, thumb(10))
  repository.put({ ...PARTS, scheme: 'dark' }, thumb(10))
  repository.put({ artifactId: 'call_other', revisionId: 'rev_1', scheme: 'light' }, thumb(10))
  await repository.clearArtifact('call_a')
  assert.equal(repository.snapshot(PARTS).status, 'missing')
  assert.equal(repository.snapshot({ ...PARTS, scheme: 'dark' }).status, 'missing')
  assert.equal(repository.snapshot({ artifactId: 'call_other', revisionId: 'rev_1', scheme: 'light' }).status, 'ready')
})

test('D5 keeps one independent thumbnail per scheme', async () => {
  const { persistence } = recordingPersistence()
  const repository = createThumbnailRepository({ persistence, createObjectURL: () => 'blob:thumb' })
  repository.put(PARTS, thumb(10))
  assert.equal(repository.snapshot(PARTS).status, 'ready')
  assert.equal(repository.snapshot({ ...PARTS, scheme: 'dark' }).status, 'missing', 'the other scheme is captured separately')
  repository.put({ ...PARTS, scheme: 'dark' }, thumb(11))
  assert.equal(repository.snapshot(PARTS).status, 'ready')
  assert.equal(repository.snapshot({ ...PARTS, scheme: 'dark' }).status, 'ready')
  await repository.remove(PARTS)
  assert.equal(repository.snapshot(PARTS).status, 'missing', 'removing one scheme keeps the other')
  assert.equal(repository.snapshot({ ...PARTS, scheme: 'dark' }).status, 'ready')
  await repository.removeRevision('call_a', 'rev_2')
  assert.equal(repository.snapshot({ ...PARTS, scheme: 'dark' }).status, 'missing')
})

test('the opposite scheme helper mirrors the scheme', () => {
  assert.equal(oppositeThumbnailScheme('light'), 'dark')
  assert.equal(oppositeThumbnailScheme('dark'), 'light')
})

test('the requested scheme wins over the fallback snapshot', () => {
  const requestedReady = { status: 'ready', url: 'blob:light', width: 10, height: 10 }
  const fallbackReady = { status: 'ready', url: 'blob:dark', width: 10, height: 10 }
  assert.deepEqual(chooseThumbnailSnapshot(requestedReady, fallbackReady, 'dark'), requestedReady, 'a ready requested scheme is used as is')
  assert.deepEqual(
    chooseThumbnailSnapshot({ status: 'missing' }, fallbackReady, 'dark'),
    { ...fallbackReady, crossScheme: 'dark' },
    'a missing requested scheme falls back with the cross-scheme marker',
  )
  assert.deepEqual(chooseThumbnailSnapshot({ status: 'missing' }, { status: 'missing' }, 'dark'), { status: 'missing' }, 'both missing keeps missing')
  assert.deepEqual(chooseThumbnailSnapshot({ status: 'loading' }, undefined, undefined), { status: 'loading' }, 'no fallback identity keeps the requested snapshot')
})

test('a deleted revision is not written back by an in-flight capture', async () => {
  const { persistence } = recordingPersistence()
  const repository = createThumbnailRepository({ persistence, createObjectURL: () => 'blob:deleted' })
  await repository.removeRevision('call_a', 'rev_2')
  repository.put(PARTS, thumb(10))
  repository.put({ ...PARTS, scheme: 'dark' }, thumb(10))
  assert.equal(repository.snapshot(PARTS).status, 'missing', 'light is tombstoned')
  assert.equal(repository.snapshot({ ...PARTS, scheme: 'dark' }).status, 'missing', 'dark is tombstoned')
  await repository.clearArtifact('call_a')
  repository.put(PARTS, thumb(10))
  assert.equal(repository.snapshot(PARTS).status, 'ready', 'an explicit cache reset re-allows captures')
})
