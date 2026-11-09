/**
 * Screenshot thumbnail cache for the M2 version bar.
 *
 * Thumbnails are keyed by `artifactId + revisionId + scheme` (D5: light and dark
 * each get their own capture) and kept in a small in-memory LRU (entries and
 * bytes bounded) with an IndexedDB persistence layer so a reload keeps the visual
 * index. Every storage operation is best-effort:
 * private mode, a missing IndexedDB implementation, quota or a corrupt record
 * silently degrade to the memory cache (and then to the bar's placeholder), so
 * the version bar never blocks on thumbnails.
 *
 * The DOM/SnapDOM capture pipeline lives in `artifact-thumbnail-capture.ts` so
 * this module stays importable by the Node unit tests.
 */
import { useSyncExternalStore } from 'react'

/** Color scheme a thumbnail was captured in (D5: one image per scheme). */
export type ThumbnailScheme = 'light' | 'dark'

/** One captured thumbnail bitmap. */
export interface ArtifactThumbnail {
  readonly blob: Blob
  readonly width: number
  readonly height: number
  readonly createdAt: number
}

/** Storage identity of one thumbnail. */
export interface ThumbnailParts {
  readonly artifactId: string
  readonly revisionId: string
  readonly scheme: ThumbnailScheme
}

/** One persisted record (blob plus its identity metadata). */
export interface StoredThumbnailRecord extends ArtifactThumbnail {
  readonly key: string
  readonly artifactId: string
  readonly revisionId: string
  readonly scheme: ThumbnailScheme
}

/** Memory-cache bounds. */
export interface ThumbnailLimits {
  readonly maxEntries: number
  readonly maxBytes: number
}

/** Default memory bounds: a session rarely shows more than a few artifacts. */
export const DEFAULT_THUMBNAIL_LIMITS: ThumbnailLimits = { maxEntries: 40, maxBytes: 6 * 1024 * 1024 }

/** Stable storage key for one thumbnail. */
export function thumbnailKey(parts: ThumbnailParts): string {
  return `${parts.artifactId}\u0000${parts.revisionId}\u0000${parts.scheme}`
}

/** The scheme the other thumbnail copy is captured in (D5: one image per scheme). */
export function oppositeThumbnailScheme(scheme: ThumbnailScheme): ThumbnailScheme {
  return scheme === 'light' ? 'dark' : 'light'
}

/**
 * Pick the snapshot to render: the requested scheme wins when ready, otherwise
 * the other scheme's image is used and marked with `crossScheme` so callers can
 * show the degraded state.
 * @param requested - snapshot of the requested scheme.
 * @param fallback - snapshot of the other scheme.
 * @param fallbackScheme - the other scheme's identity.
 * @returns the snapshot to render.
 */
export function chooseThumbnailSnapshot(
  requested: ThumbnailSnapshot,
  fallback: ThumbnailSnapshot | undefined,
  fallbackScheme: ThumbnailScheme | undefined,
): ThumbnailSnapshot {
  if (requested.status === 'ready' || fallbackScheme === undefined || fallback?.status !== 'ready') return requested
  return { ...fallback, crossScheme: fallbackScheme }
}

/** Persistence adapter; every method resolves and never throws on failure. */
export interface ThumbnailPersistence {
  read(key: string): Promise<StoredThumbnailRecord | undefined>
  write(record: StoredThumbnailRecord): Promise<void>
  remove(key: string): Promise<void>
  list(artifactId: string): Promise<readonly StoredThumbnailRecord[]>
  clearArtifact(artifactId: string): Promise<void>
}

/** Validate one untrusted persisted record. */
function isStoredRecord(value: unknown): value is StoredThumbnailRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.key === 'string' && record.key !== ''
    && typeof record.artifactId === 'string' && record.artifactId !== ''
    && typeof record.revisionId === 'string' && record.revisionId !== ''
    && (record.scheme === 'light' || record.scheme === 'dark')
    && record.blob instanceof Blob
    && record.blob.size > 0
    && typeof record.width === 'number' && Number.isFinite(record.width) && record.width > 0
    && typeof record.height === 'number' && Number.isFinite(record.height) && record.height > 0
    && typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
}

/** In-memory persistence used by tests and as the no-IndexedDB fallback. */
export function createMemoryThumbnailPersistence(): ThumbnailPersistence {
  const records = new Map<string, StoredThumbnailRecord>()
  return {
    async read(key) { return records.get(key) },
    async write(record) { records.set(record.key, record) },
    async remove(key) { records.delete(key) },
    async list(artifactId) { return [...records.values()].filter(record => record.artifactId === artifactId) },
    async clearArtifact(artifactId) {
      for (const [key, record] of records) if (record.artifactId === artifactId) records.delete(key)
    },
  }
}

/** IndexedDB database name; bump only with an explicit migration. */
const THUMBNAIL_DB_NAME = 'dsh-iui-thumbnails:v1'
const THUMBNAIL_STORE = 'thumbnails'
const THUMBNAIL_ARTIFACT_INDEX = 'byArtifact'
/** Persisted entries kept per artifact before the oldest are pruned. */
const MAX_PERSISTED_PER_ARTIFACT = 40

type IdbFactory = Pick<IDBFactory, 'open'> | undefined

function defaultIndexedDb(): IdbFactory {
  try {
    return typeof indexedDB === 'undefined' ? undefined : indexedDB
  } catch {
    return undefined
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T | undefined> {
  return new Promise(resolve => {
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { resolve(undefined) }
  })
}

/**
 * IndexedDB persistence with a hard graceful-degradation path.
 * @param factory - IndexedDB factory (injectable for tests); defaults to `indexedDB`.
 * @returns the persistence adapter; every operation resolves even when storage is unavailable.
 */
export function createIndexedDbThumbnailPersistence(factory: IdbFactory = defaultIndexedDb()): ThumbnailPersistence {
  let disabled = factory === undefined
  let opening: Promise<IDBDatabase | undefined> | undefined
  const db = (): Promise<IDBDatabase | undefined> => {
    if (disabled || factory === undefined) return Promise.resolve(undefined)
    if (opening !== undefined) return opening
    opening = new Promise(resolve => {
      try {
        const request = factory.open(THUMBNAIL_DB_NAME, 1)
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(THUMBNAIL_STORE)) {
            const store = database.createObjectStore(THUMBNAIL_STORE, { keyPath: 'key' })
            store.createIndex(THUMBNAIL_ARTIFACT_INDEX, 'artifactId', { unique: false })
          }
        }
        request.onsuccess = () => { resolve(request.result) }
        request.onerror = () => { disabled = true; resolve(undefined) }
        request.onblocked = () => { disabled = true; resolve(undefined) }
      } catch {
        disabled = true
        resolve(undefined)
      }
    })
    return opening
  }
  const run = async <T>(operation: (database: IDBDatabase) => Promise<T | undefined>): Promise<T | undefined> => {
    const database = await db()
    if (database === undefined) return undefined
    try {
      return await operation(database)
    } catch {
      disabled = true
      return undefined
    }
  }
  const transaction = (database: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore | undefined => {
    try {
      return database.transaction(THUMBNAIL_STORE, mode).objectStore(THUMBNAIL_STORE)
    } catch {
      return undefined
    }
  }
  return {
    async read(key) {
      return run(async database => {
        const store = transaction(database, 'readonly')
        if (store === undefined) return undefined
        const value = await requestResult(store.get(key))
        return isStoredRecord(value) ? value : undefined
      })
    },
    async write(record) {
      await run(async database => {
        const store = transaction(database, 'readwrite')
        if (store === undefined) return undefined
        await requestResult(store.put(record))
        // Best-effort per-artifact cap: read the artifact's records and delete
        // the oldest beyond the cap. Failure here never fails the write path.
        const index = transaction(database, 'readonly')?.index(THUMBNAIL_ARTIFACT_INDEX)
        if (index === undefined) return undefined
        const values = await requestResult(index.getAll(record.artifactId))
        if (!Array.isArray(values)) return undefined
        const stale = values
          .filter((value): value is StoredThumbnailRecord => isStoredRecord(value))
          .sort((left, right) => left.createdAt - right.createdAt)
          .slice(0, Math.max(0, values.length - MAX_PERSISTED_PER_ARTIFACT))
        for (const value of stale) {
          const removeStore = transaction(database, 'readwrite')
          if (removeStore !== undefined) await requestResult(removeStore.delete(value.key))
        }
        return undefined
      })
    },
    async remove(key) {
      await run(async database => {
        const store = transaction(database, 'readwrite')
        if (store === undefined) return undefined
        await requestResult(store.delete(key))
        return undefined
      })
    },
    async list(artifactId) {
      const values = await run(async database => {
        const store = transaction(database, 'readonly')
        if (store === undefined) return undefined
        const index = store.index(THUMBNAIL_ARTIFACT_INDEX)
        return requestResult(index.getAll(artifactId))
      })
      return Array.isArray(values) ? values.filter(isStoredRecord) : []
    },
    async clearArtifact(artifactId) {
      await run(async database => {
        const store = transaction(database, 'readwrite')
        if (store === undefined) return undefined
        const index = store.index(THUMBNAIL_ARTIFACT_INDEX)
        const keys = await requestResult(index.getAllKeys(artifactId))
        if (!Array.isArray(keys)) return undefined
        for (const key of keys) {
          if (typeof key === 'string') await requestResult(store.delete(key))
        }
        return undefined
      })
    },
  }
}

/** Small LRU over thumbnail bitmaps; evicts by count and by stored blob bytes. */
export interface ThumbnailLru {
  get(key: string): ArtifactThumbnail | undefined
  has(key: string): boolean
  set(key: string, thumbnail: ArtifactThumbnail): void
  delete(key: string): void
  clear(): void
  size(): number
  bytes(): number
  keys(): readonly string[]
}

/**
 * Create a bounded LRU.
 * @param options - bounds and an eviction callback (used to revoke object URLs).
 * @returns the LRU.
 */
export function createThumbnailLru(options: {
  readonly maxEntries?: number
  readonly maxBytes?: number
  readonly onEvict?: (key: string, thumbnail: ArtifactThumbnail) => void
} = {}): ThumbnailLru {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_THUMBNAIL_LIMITS.maxEntries)
  const maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_THUMBNAIL_LIMITS.maxBytes)
  const entries = new Map<string, ArtifactThumbnail>()
  let byteTotal = 0
  const evict = (key: string): void => {
    const thumbnail = entries.get(key)
    if (thumbnail === undefined) return
    entries.delete(key)
    byteTotal -= thumbnail.blob.size
    options.onEvict?.(key, thumbnail)
  }
  const prune = (): void => {
    while (entries.size > maxEntries || (byteTotal > maxBytes && entries.size > 1)) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      evict(oldest)
    }
  }
  return {
    get(key) {
      const thumbnail = entries.get(key)
      if (thumbnail === undefined) return undefined
      // Refresh recency: delete+set moves the entry to the newest position.
      entries.delete(key)
      entries.set(key, thumbnail)
      return thumbnail
    },
    has(key) { return entries.has(key) },
    set(key, thumbnail) {
      if (entries.has(key)) evict(key)
      entries.set(key, thumbnail)
      byteTotal += thumbnail.blob.size
      prune()
    },
    delete(key) { evict(key) },
    clear() {
      for (const key of [...entries.keys()]) evict(key)
    },
    size() { return entries.size },
    bytes() { return byteTotal },
    keys() { return [...entries.keys()] },
  }
}

/** One thumbnail as the version bar sees it. */
export interface ThumbnailSnapshot {
  readonly status: 'missing' | 'loading' | 'ready'
  readonly url?: string
  readonly width?: number
  readonly height?: number
  /** Scheme that produced the image when it differs from the requested one (D5 fallback). */
  readonly crossScheme?: ThumbnailScheme
}

/** Repository contract shared by the singleton and unit tests. */
export interface ThumbnailRepository {
  snapshot(parts: ThumbnailParts): ThumbnailSnapshot
  thumbnail(parts: ThumbnailParts): ArtifactThumbnail | undefined
  objectUrl(parts: ThumbnailParts): string | undefined
  subscribe(listener: () => void): () => void
  hydrate(artifactId: string): Promise<void>
  ensure(parts: ThumbnailParts): Promise<void>
  put(parts: ThumbnailParts, thumbnail: ArtifactThumbnail): void
  remove(parts: ThumbnailParts): Promise<void>
  removeRevision(artifactId: string, revisionId: string): Promise<void>
  clearArtifact(artifactId: string): Promise<void>
}

/**
 * Create one thumbnail repository.
 * @param options - persistence adapter, bounds and injectable URL/clock hooks.
 * @returns the repository. All async work is fire-and-forget and never rejects.
 */
export function createThumbnailRepository(options: {
  readonly persistence?: ThumbnailPersistence
  readonly limits?: Partial<ThumbnailLimits>
  readonly createObjectURL?: (blob: Blob) => string
  readonly revokeObjectURL?: (url: string) => void
} = {}): ThumbnailRepository {
  const persistence = options.persistence ?? createMemoryThumbnailPersistence()
  const listeners = new Set<() => void>()
  const urls = new Map<string, string>()
  const loading = new Set<string>()
  const hydrated = new Set<string>()
  const hydrating = new Map<string, Promise<void>>()
  /** Revision identities whose thumbnails were deleted; captures must not write them back. */
  const deletedRevisions = new Set<string>()
  let snapshotCache = new Map<string, ThumbnailSnapshot>()
  const lru = createThumbnailLru({
    ...options.limits,
    onEvict: key => {
      const url = urls.get(key)
      if (url === undefined) return
      urls.delete(key)
      options.revokeObjectURL?.(url)
    },
  })
  const createUrl = options.createObjectURL ?? ((blob: Blob): string => {
    try {
      return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : ''
    } catch {
      return ''
    }
  })
  const publish = (): void => {
    snapshotCache = new Map()
    for (const listener of [...listeners]) listener()
  }
  const revisionTombstone = (artifactId: string, revisionId: string): string => `${artifactId}\u0000${revisionId}`
  const isDeleted = (parts: ThumbnailParts): boolean => deletedRevisions.has(revisionTombstone(parts.artifactId, parts.revisionId))
  const urlFor = (key: string, parts: ThumbnailParts): string | undefined => {
    const cached = urls.get(key)
    if (cached !== undefined) return cached
    const thumbnail = lru.get(key)
    if (thumbnail === undefined) return undefined
    const url = createUrl(thumbnail.blob)
    if (url === '') return undefined
    urls.set(key, url)
    return url
  }
  const snapshotOf = (parts: ThumbnailParts): ThumbnailSnapshot => {
    const key = thumbnailKey(parts)
    if (isDeleted(parts)) return { status: 'missing' }
    const cached = snapshotCache.get(key)
    if (cached !== undefined) return cached
    const thumbnail = lru.get(key)
    const value: ThumbnailSnapshot = thumbnail !== undefined
      ? { status: 'ready', url: urlFor(key, parts), width: thumbnail.width, height: thumbnail.height }
      : loading.has(key) ? { status: 'loading' } : { status: 'missing' }
    snapshotCache.set(key, value)
    return value
  }
  return {
    snapshot: snapshotOf,
    thumbnail: parts => isDeleted(parts) ? undefined : lru.get(thumbnailKey(parts)),
    objectUrl: parts => isDeleted(parts) ? undefined : urlFor(thumbnailKey(parts), parts),
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async hydrate(artifactId) {
      if (hydrated.has(artifactId)) return
      const inFlight = hydrating.get(artifactId)
      if (inFlight !== undefined) return inFlight
      const task = (async () => {
        const records = await persistence.list(artifactId)
        let changed = false
        for (const record of records) {
          const key = thumbnailKey(record)
          if (lru.has(key)) continue
          lru.set(key, { blob: record.blob, width: record.width, height: record.height, createdAt: record.createdAt })
          changed = true
        }
        hydrated.add(artifactId)
        if (changed) publish()
      })().catch(() => undefined).finally(() => { hydrating.delete(artifactId) })
      hydrating.set(artifactId, task)
      return task
    },
    async ensure(parts) {
      const key = thumbnailKey(parts)
      if (isDeleted(parts) || lru.has(key) || loading.has(key)) return
      loading.add(key)
      publish()
      try {
        const record = await persistence.read(key)
        if (record !== undefined && isStoredRecord(record)) {
          lru.set(key, { blob: record.blob, width: record.width, height: record.height, createdAt: record.createdAt })
        }
      } catch {
        /* a failed read simply leaves the placeholder */
      } finally {
        loading.delete(key)
        publish()
      }
    },
    put(parts, thumbnail) {
      // A revision deleted while a capture was in flight must not resurrect.
      if (isDeleted(parts)) return
      const key = thumbnailKey(parts)
      lru.set(key, thumbnail)
      publish()
      const record: StoredThumbnailRecord = {
        key,
        artifactId: parts.artifactId,
        revisionId: parts.revisionId,
        scheme: parts.scheme,
        blob: thumbnail.blob,
        width: thumbnail.width,
        height: thumbnail.height,
        createdAt: thumbnail.createdAt,
      }
      void persistence.write(record).catch(() => undefined)
    },
    async remove(parts) {
      const key = thumbnailKey(parts)
      lru.delete(key)
      publish()
      try { await persistence.remove(key) } catch { /* ignore */ }
    },
    async removeRevision(artifactId, revisionId) {
      deletedRevisions.add(revisionTombstone(artifactId, revisionId))
      lru.delete(thumbnailKey({ artifactId, revisionId, scheme: 'light' }))
      lru.delete(thumbnailKey({ artifactId, revisionId, scheme: 'dark' }))
      publish()
      try {
        await persistence.remove(thumbnailKey({ artifactId, revisionId, scheme: 'light' }))
        await persistence.remove(thumbnailKey({ artifactId, revisionId, scheme: 'dark' }))
      } catch {
        /* ignore */
      }
    },
    async clearArtifact(artifactId) {
      for (const scheme of ['light', 'dark'] as const) {
        for (const key of [...lru.keys()]) {
          if (key.startsWith(`${artifactId}\u0000`) && key.endsWith(`\u0000${scheme}`)) lru.delete(key)
        }
      }
      for (const tombstone of [...deletedRevisions]) {
        if (tombstone.startsWith(`${artifactId}\u0000`)) deletedRevisions.delete(tombstone)
      }
      hydrated.delete(artifactId)
      publish()
      try { await persistence.clearArtifact(artifactId) } catch { /* ignore */ }
    },
  }
}

/** Shared thumbnail repository of the browser client. */
export const artifactThumbnails: ThumbnailRepository = createThumbnailRepository({
  persistence: createIndexedDbThumbnailPersistence(),
})

let thumbnailVersion = 0
const versionListeners = new Set<() => void>()
let hookSnapshotCache = new Map<string, ThumbnailSnapshot>()

artifactThumbnails.subscribe(() => {
  thumbnailVersion += 1
  hookSnapshotCache = new Map()
  for (const listener of [...versionListeners]) listener()
})

/** Subscribe to thumbnail cache changes (ready/loading/removed). */
export function subscribeThumbnailVersion(listener: () => void): () => void {
  versionListeners.add(listener)
  return () => { versionListeners.delete(listener) }
}

/** Monotonic cache version for `useSyncExternalStore` consumers. */
export function thumbnailCacheVersion(): number {
  return thumbnailVersion
}

/** React hook: re-render when any thumbnail changes. */
export function useThumbnailVersion(): number {
  return useSyncExternalStore(subscribeThumbnailVersion, thumbnailCacheVersion, thumbnailCacheVersion)
}

/** Resolve a snapshot, optionally falling back to the other scheme's image (D5). */
export function thumbnailSnapshot(parts: ThumbnailParts, fallbackScheme?: ThumbnailScheme): ThumbnailSnapshot {
  const key = `${thumbnailKey(parts)}|${fallbackScheme ?? ''}`
  const cached = hookSnapshotCache.get(key)
  if (cached !== undefined) return cached
  const direct = artifactThumbnails.snapshot(parts)
  const other = fallbackScheme === undefined || fallbackScheme === parts.scheme
    ? undefined
    : artifactThumbnails.snapshot({ ...parts, scheme: fallbackScheme })
  const value = chooseThumbnailSnapshot(direct, other, fallbackScheme === parts.scheme ? undefined : fallbackScheme)
  hookSnapshotCache.set(key, value)
  return value
}

/** Persist a captured thumbnail in the shared repository. */
export function saveArtifactThumbnail(parts: ThumbnailParts, thumbnail: ArtifactThumbnail): void {
  artifactThumbnails.put(parts, thumbnail)
}

/** Load persisted thumbnails of one artifact into the shared cache. */
export function hydrateArtifactThumbnails(artifactId: string): Promise<void> {
  return artifactThumbnails.hydrate(artifactId)
}

/** Remove both scheme thumbnails of one deleted revision. */
export function deleteRevisionThumbnails(artifactId: string, revisionId: string): void {
  void artifactThumbnails.removeRevision(artifactId, revisionId)
}

/** Remove every thumbnail of one artifact. */
export function clearArtifactThumbnails(artifactId: string): void {
  void artifactThumbnails.clearArtifact(artifactId)
}
