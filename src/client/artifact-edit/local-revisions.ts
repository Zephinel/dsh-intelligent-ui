/**
 * Client-owned revision cards restored without a model turn (M3-2).
 *
 * A restore copies an older revision's program into a new recorded revision via
 * the authenticated Host route, then keeps the card locally: the program cannot
 * be recovered from a Turn tool result because no tool call happened. Cards are
 * stored per chat session, capped, and persisted in localStorage so a reload
 * keeps them until the conversation window itself is gone.
 */
import { useSyncExternalStore } from 'react'
import {
  ARTIFACT_RESTORE_ROUTE_PATH,
  MAX_ARTIFACT_PROGRAM_CHARS,
  type ArtifactRevisionMeta,
} from '../../shared/artifact-edit.ts'
import type { IntelligentUIProgram, RenderLayout } from '../../shared/intelligent-ui.ts'

/** One locally recorded revision restored from an older one. */
export interface LocalArtifactRevision {
  readonly artifactId: string
  readonly sourceRevisionId: string
  readonly revisionId: string
  readonly revision: number
  readonly program: string
  readonly title?: string
  readonly style: RenderLayout
  readonly styleId?: string
  /** Loaded Turn the restore was triggered from; the card renders in that Turn. */
  readonly turn?: number
  readonly createdAt: number
}

/** Maximum local revision cards kept per chat session. */
export const MAX_LOCAL_REVISIONS = 20
const STORAGE_PREFIX = 'dsh-intelligent-ui-local-revisions:v1:'

type Listener = () => void
const listeners = new Set<Listener>()
const store = new Map<string, LocalArtifactRevision[]>()
const loaded = new Set<string>()
let snapshotCache = new Map<string, readonly LocalArtifactRevision[]>()

function storage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

function validRevision(value: unknown): value is LocalArtifactRevision {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.artifactId === 'string' && record.artifactId.length > 0
    && typeof record.sourceRevisionId === 'string' && record.sourceRevisionId.length > 0
    && typeof record.revisionId === 'string' && record.revisionId.length > 0
    && typeof record.revision === 'number' && Number.isSafeInteger(record.revision) && record.revision >= 1
    && typeof record.program === 'string' && record.program.length > 0 && record.program.length <= MAX_ARTIFACT_PROGRAM_CHARS
    && (record.title === undefined || typeof record.title === 'string')
    && (record.style === 'card' || record.style === 'article' || record.style === 'free')
    && (record.styleId === undefined || typeof record.styleId === 'string')
    && (record.turn === undefined || (typeof record.turn === 'number' && Number.isSafeInteger(record.turn)))
    && typeof record.createdAt === 'number'
}

function load(sessionId: string): void {
  if (loaded.has(sessionId)) return
  loaded.add(sessionId)
  const api = storage()
  if (api === undefined) return
  try {
    const parsed: unknown = JSON.parse(api.getItem(`${STORAGE_PREFIX}${sessionId}`) ?? '[]')
    if (Array.isArray(parsed)) {
      store.set(sessionId, parsed.filter(validRevision).slice(-MAX_LOCAL_REVISIONS))
    }
  } catch { /* corrupt local storage is ignored; the session simply starts empty */ }
}

function persist(sessionId: string): void {
  const api = storage()
  if (api === undefined) return
  try { api.setItem(`${STORAGE_PREFIX}${sessionId}`, JSON.stringify(store.get(sessionId) ?? [])) } catch { /* quota is non-fatal */ }
}

function publish(): void {
  snapshotCache = new Map()
  for (const listener of listeners) listener()
}

/** Local revisions for one chat session, in restore order. */
export function localRevisionsFor(sessionId: string): readonly LocalArtifactRevision[] {
  load(sessionId)
  return store.get(sessionId) ?? []
}

/** Subscribe to local revision changes. */
export function subscribeLocalRevisions(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Read local revisions through React's external store contract. */
export function useLocalRevisions(sessionId: string): readonly LocalArtifactRevision[] {
  return useSyncExternalStore(subscribeLocalRevisions, () => {
    const cached = snapshotCache.get(sessionId)
    if (cached !== undefined) return cached
    const next = localRevisionsFor(sessionId)
    snapshotCache.set(sessionId, next)
    return next
  }, () => localRevisionsFor(sessionId))
}

/** Append one restored revision; identical ids replace, the oldest entries fall off. */
export function addLocalRevision(sessionId: string, revision: LocalArtifactRevision): void {
  load(sessionId)
  const existing = store.get(sessionId) ?? []
  const next = [...existing.filter(item => item.revisionId !== revision.revisionId), revision]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_LOCAL_REVISIONS)
  store.set(sessionId, next)
  loaded.add(sessionId)
  persist(sessionId)
  publish()
}

/** Remove every local revision card of one chat session. */
export function clearLocalRevisions(sessionId: string): void {
  load(sessionId)
  store.delete(sessionId)
  const api = storage()
  try { api?.removeItem(`${STORAGE_PREFIX}${sessionId}`) } catch { /* ignore */ }
  publish()
}

/** Convert one local revision into the card program the renderer consumes. */
export function localRevisionProgram(revision: LocalArtifactRevision): IntelligentUIProgram {
  return {
    callId: revision.revisionId,
    program: revision.program,
    ...revision.title === undefined ? {} : { title: revision.title },
    style: revision.style,
    ...revision.styleId === undefined ? {} : { styleId: revision.styleId, styleSource: 'template' as const },
    artifactId: revision.artifactId,
    revisionId: revision.revisionId,
    baseRevisionId: revision.sourceRevisionId,
    revision: revision.revision,
    localRevision: true,
    running: false,
  }
}

/** Latest-revision probe used to decide whether a card can be restored. */
export async function fetchArtifactStatus(artifactId: string, revisionId: string): Promise<{ conflict: boolean; latestRevision: number } | undefined> {
  try {
    const response = await fetch(`/api/intelligent-ui/artifact-revisions?artifactId=${encodeURIComponent(artifactId)}&revisionId=${encodeURIComponent(revisionId)}`)
    if (!response.ok) return undefined
    const value: unknown = await response.json()
    if (value === null || typeof value !== 'object') return undefined
    const record = value as Record<string, unknown>
    if (typeof record.conflict !== 'boolean' || typeof record.latestRevision !== 'number') return undefined
    return { conflict: record.conflict, latestRevision: record.latestRevision }
  } catch {
    return undefined
  }
}

/** Record a new revision that copies an older one, without a model turn. */
export async function restoreRevision(input: {
  readonly artifactId: string
  readonly sourceRevisionId: string
  readonly program: string
}): Promise<LocalArtifactRevision | undefined> {
  try {
    const response = await fetch(ARTIFACT_RESTORE_ROUTE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, artifactId: input.artifactId, sourceRevisionId: input.sourceRevisionId, program: input.program }),
    })
    if (!response.ok) return undefined
    const value: unknown = await response.json() as { ok?: unknown; revision?: unknown }
    const meta = value.revision as (ArtifactRevisionMeta & { program?: string }) | undefined
    if (value.ok !== true || meta === undefined || typeof meta !== 'object') return undefined
    if (typeof meta.artifactId !== 'string' || typeof meta.revisionId !== 'string' || typeof meta.revision !== 'number') return undefined
    if (typeof meta.program !== 'string' || meta.program.trim() === '') return undefined
    if (meta.style !== 'card' && meta.style !== 'article' && meta.style !== 'free') return undefined
    return {
      artifactId: meta.artifactId,
      sourceRevisionId: meta.baseRevisionId ?? input.sourceRevisionId,
      revisionId: meta.revisionId,
      revision: meta.revision,
      program: meta.program,
      ...meta.title === undefined ? {} : { title: meta.title },
      style: meta.style,
      ...meta.styleId === undefined ? {} : { styleId: meta.styleId },
      createdAt: Date.now(),
    }
  } catch {
    return undefined
  }
}
