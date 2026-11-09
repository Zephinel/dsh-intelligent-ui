/**
 * Client-owned rollback targets for deleted rendered revisions.
 *
 * Deleting a revision that a card renders would leave that card pointing at a
 * Host record that no longer exists, so the history dialog only offers that
 * delete when an older revision with a retained program exists (and, for local
 * revision cards, because deleting them removes the card itself). Before the
 * delete this module persists that older revision's program as the card's
 * fallback; the card list then renders the fallback in place of the deleted
 * revision so the card, its later edits and a reload keep naming a record that
 * exists. Entries are capped and persisted in localStorage per chat session,
 * exactly like the local revision cards.
 */
import { useSyncExternalStore } from 'react'
import { MAX_ARTIFACT_PROGRAM_CHARS, type ArtifactHistoryRevision } from '../../shared/artifact-edit.ts'
import type { IntelligentUIProgram, RenderLayout } from '../../shared/intelligent-ui.ts'
import { isStyleSnapshot, type StyleSnapshot } from '../../shared/style-templates.ts'

/** One card's rollback target after the revision it rendered was deleted. */
export interface RevisionFallback {
  /** Revision id the transcript card still names; the deleted record. */
  readonly deletedRevisionId: string
  /** Root artifact identity the fallback belongs to. */
  readonly artifactId: string
  /** Older revision that card renders from now on. */
  readonly revisionId: string
  /** 1-based revision number of `revisionId`. */
  readonly revision: number
  /** Parent revision of `revisionId`, when the history record names one. */
  readonly baseRevisionId?: string
  /** Retained authoritative program of `revisionId`. */
  readonly program: string
  readonly title?: string
  readonly style: RenderLayout
  readonly styleId?: string
  /** Result-owned temporary style snapshot copied from the fallback revision. */
  readonly temporaryStyle?: StyleSnapshot
  readonly createdAt: number
}

/** Maximum fallback entries kept per chat session. */
export const MAX_REVISION_FALLBACKS = 20

/** Bound for following fallback chains; cycles and runaway chains stop here. */
export const MAX_REVISION_FALLBACK_CHAIN = 20

/**
 * Serialized-size budget for one session's entries. `localStorage` is roughly
 * 5 MB of UTF-16 units for the whole origin; a rollback program can be 200k
 * chars, so the count cap alone is not enough to keep the write from failing.
 */
export const MAX_REVISION_FALLBACK_STORAGE_CHARS = 2_000_000
const STORAGE_PREFIX = 'dsh-intelligent-ui-revision-fallbacks:v1:'

type Listener = () => void
const listeners = new Set<Listener>()
const store = new Map<string, RevisionFallback[]>()
const loaded = new Set<string>()
let snapshotCache = new Map<string, readonly RevisionFallback[]>()

function storage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

function validFallback(value: unknown): value is RevisionFallback {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.deletedRevisionId === 'string' && record.deletedRevisionId.length > 0
    && typeof record.artifactId === 'string' && record.artifactId.length > 0
    && typeof record.revisionId === 'string' && record.revisionId.length > 0
    && record.revisionId !== record.deletedRevisionId
    && typeof record.revision === 'number' && Number.isSafeInteger(record.revision) && record.revision >= 1
    && (record.baseRevisionId === undefined || typeof record.baseRevisionId === 'string')
    && typeof record.program === 'string' && record.program.length > 0 && record.program.length <= MAX_ARTIFACT_PROGRAM_CHARS
    && (record.title === undefined || typeof record.title === 'string')
    && (record.style === 'card' || record.style === 'article' || record.style === 'free')
    && (record.styleId === undefined || typeof record.styleId === 'string')
    && (record.temporaryStyle === undefined || (isStyleSnapshot(record.temporaryStyle) && record.temporaryStyle.baseLayout === record.style))
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
      store.set(sessionId, parsed.filter(validFallback).slice(-MAX_REVISION_FALLBACKS))
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

/** Rollback targets for one chat session, oldest first. */
export function revisionFallbacksFor(sessionId: string): readonly RevisionFallback[] {
  load(sessionId)
  return store.get(sessionId) ?? []
}

/** Subscribe to rollback-target changes. */
export function subscribeRevisionFallbacks(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Read rollback targets through React's external store contract. */
export function useRevisionFallbacks(sessionId: string): readonly RevisionFallback[] {
  return useSyncExternalStore(subscribeRevisionFallbacks, () => {
    const cached = snapshotCache.get(sessionId)
    if (cached !== undefined) return cached
    const next = revisionFallbacksFor(sessionId)
    snapshotCache.set(sessionId, next)
    return next
  }, () => revisionFallbacksFor(sessionId))
}

/** Drop the oldest entries until the session's serialized list fits the budget. */
function trimToBudget(sessionId: string): void {
  const list = store.get(sessionId) ?? []
  let serialized = JSON.stringify(list)
  while (list.length > 1 && serialized.length > MAX_REVISION_FALLBACK_STORAGE_CHARS) {
    list.shift()
    serialized = JSON.stringify(list)
  }
}

/**
 * Keep an older entry pointing at a live revision after its own target was
 * deleted: `R3→R2` is rewritten to `R3→R1` when `R2→R1` is recorded.
 */
function retargetFallback(item: RevisionFallback, deletedRevisionId: string, fallback: RevisionFallback): RevisionFallback {
  if (item.revisionId !== deletedRevisionId) return item
  return {
    ...item,
    revisionId: fallback.revisionId,
    revision: fallback.revision,
    ...fallback.baseRevisionId === undefined ? { baseRevisionId: undefined } : { baseRevisionId: fallback.baseRevisionId },
    program: fallback.program,
    ...fallback.title === undefined ? { title: undefined } : { title: fallback.title },
    style: fallback.style,
    ...fallback.styleId === undefined ? { styleId: undefined } : { styleId: fallback.styleId },
    ...fallback.temporaryStyle === undefined ? { temporaryStyle: undefined } : { temporaryStyle: fallback.temporaryStyle },
  }
}

/** Remember one card's rollback target; a repeated delete replaces the entry. */
export function recordRevisionFallback(sessionId: string, fallback: RevisionFallback): void {
  load(sessionId)
  const existing = store.get(sessionId) ?? []
  const rewritten = existing.map(item => retargetFallback(item, fallback.deletedRevisionId, fallback))
  const next = [...rewritten.filter(item => item.deletedRevisionId !== fallback.deletedRevisionId), fallback]
    .slice(-MAX_REVISION_FALLBACKS)
  store.set(sessionId, next)
  loaded.add(sessionId)
  trimToBudget(sessionId)
  persist(sessionId)
  publish()
}

/** Drop every rollback target of one chat session. */
export function clearRevisionFallbacks(sessionId: string): void {
  load(sessionId)
  store.delete(sessionId)
  const api = storage()
  try { api?.removeItem(`${STORAGE_PREFIX}${sessionId}`) } catch { /* ignore */ }
  publish()
}

/**
 * Newest older revision whose program is still retained — the rollback target
 * for deleting `deletedRevisionId`.
 *
 * A revision owned by a client-local card is skipable: deleting it removes
 * that card, so it is not a durable fallback target a transcript card can keep
 * rendering after a reload.
 * @param revisions - one artifact's history, newest first.
 * @param deletedRevisionId - revision whose deletion is being prepared.
 * @param skipRevisionIds - revisions that are not valid fallback targets.
 * @returns the fallback revision, or undefined when nothing older is retained.
 */
export function rollbackTargetFor(
  revisions: readonly ArtifactHistoryRevision[],
  deletedRevisionId: string,
  skipRevisionIds?: ReadonlySet<string>,
): ArtifactHistoryRevision | undefined {
  const deleted = revisions.find(revision => revision.revisionId === deletedRevisionId)
  if (deleted === undefined) return undefined
  let target: ArtifactHistoryRevision | undefined
  for (const revision of revisions) {
    if (!revision.hasProgram || revision.revision >= deleted.revision) continue
    if (skipRevisionIds?.has(revision.revisionId) === true) continue
    if (target === undefined || revision.revision > target.revision) target = revision
  }
  return target
}

/**
 * Build the persisted fallback for one prepared deletion.
 * @param artifactId - root artifact identity.
 * @param deletedRevisionId - revision being deleted.
 * @param target - rollback revision chosen by {@link rollbackTargetFor}.
 * @param program - retained authoritative program of `target`.
 * @returns the fallback record to persist before the DELETE.
 */
export function createRevisionFallback(
  artifactId: string,
  deletedRevisionId: string,
  target: ArtifactHistoryRevision,
  program: string,
): RevisionFallback {
  return {
    deletedRevisionId,
    artifactId,
    revisionId: target.revisionId,
    revision: target.revision,
    ...target.baseRevisionId === undefined ? {} : { baseRevisionId: target.baseRevisionId },
    program,
    ...target.title === undefined ? {} : { title: target.title },
    style: target.style,
    ...target.styleId === undefined ? {} : { styleId: target.styleId },
    ...target.temporaryStyle === undefined ? {} : { temporaryStyle: target.temporaryStyle },
    createdAt: Date.now(),
  }
}

/**
 * Re-point one card program at its fallback revision.
 *
 * The transcript identity (`callId`) is kept so the card keeps its React
 * identity and position; revision lineage, style and program are replaced by
 * the fallback record. `requestId` is kept so edit-draft reconciliation still
 * sees the fulfilled request.
 * @param program - card program whose revision was deleted.
 * @param fallback - persisted rollback target for that revision.
 * @returns the program the card renders from now on.
 */
export function applyRevisionFallback(program: IntelligentUIProgram, fallback: RevisionFallback): IntelligentUIProgram {
  const {
    program: _program, revisionId: _revisionId, revision: _revision, baseRevisionId: _baseRevisionId,
    title: _title, style: _style, styleId: _styleId, temporaryStyle: _temporaryStyle,
    styleSource: _styleSource, editedBlockIds: _editedBlockIds, ...rest
  } = program
  const title = fallback.title ?? program.title
  const styleSource = fallback.temporaryStyle !== undefined
    ? 'temporary' as const
    : fallback.styleId !== undefined ? 'template' as const : undefined
  return {
    ...rest,
    program: fallback.program,
    revisionId: fallback.revisionId,
    // A redirected card is read-only: another card may already own editing of
    // this revision, and a shared edit key would otherwise mount two canvases.
    fallbackFrom: program.revisionId,
    revision: fallback.revision,
    ...fallback.baseRevisionId === undefined ? {} : { baseRevisionId: fallback.baseRevisionId },
    ...title === undefined ? {} : { title },
    style: fallback.style,
    ...fallback.styleId === undefined ? {} : { styleId: fallback.styleId },
    ...fallback.temporaryStyle === undefined ? {} : { temporaryStyle: fallback.temporaryStyle },
    ...styleSource === undefined ? {} : { styleSource },
  }
}

/**
 * Resolve the final fallback for one card.
 *
 * History can delete a revision that was itself a fallback target
 * (`R3→R2`, then `R2→R1`). A single map lookup would leave the card on the
 * deleted `R2`; this follows the chain to a revision with no further fallback.
 * Cycles and chains longer than {@link MAX_REVISION_FALLBACK_CHAIN} resolve to
 * undefined; the caller then renders the raw program, which UI-created chains
 * never point at a deleted record (only corrupt/legacy storage can reach this).
 * @param fallbacks - fallbacks indexed by the deleted revision id.
 * @param revisionId - revision the transcript card still names.
 * @returns the final fallback, or undefined when the chain is broken/cyclic.
 */
export function resolveRevisionFallback(
  fallbacks: ReadonlyMap<string, RevisionFallback>,
  revisionId: string | undefined,
): RevisionFallback | undefined {
  let current = revisionId
  const seen = new Set<string>()
  while (current !== undefined) {
    if (seen.has(current) || seen.size >= MAX_REVISION_FALLBACK_CHAIN) return undefined
    seen.add(current)
    const fallback = fallbacks.get(current)
    if (fallback === undefined) return undefined
    if (!fallbacks.has(fallback.revisionId)) return fallback
    current = fallback.revisionId
  }
  return undefined
}

/** Revision identities still named by the rendered card programs (before redirect). */
export function namedRevisionIds(
  programs: ReadonlyArray<{ readonly callId: string; readonly revisionId?: string }>,
): ReadonlySet<string> {
  return new Set(programs.map(program => program.revisionId ?? program.callId))
}

/**
 * Fallback targets that still belong to a rendered program.
 *
 * A stored fallback whose deleted revision is no longer named by any rendered
 * program is dead: it must not block deleting a revision that the Host allows.
 * @param fallbacks - persisted fallbacks for one chat.
 * @param named - revision identities still named by rendered cards.
 * @returns fallback revision ids that a live card still depends on.
 */
export function liveFallbackTargetIds(
  fallbacks: readonly RevisionFallback[],
  named: ReadonlySet<string>,
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const fallback of fallbacks) {
    if (named.has(fallback.deletedRevisionId)) ids.add(fallback.revisionId)
  }
  return ids
}

/**
 * Whether deleting one revision needs a persisted fallback record.
 *
 * Only a revision that some rendered card still names, or that a live fallback
 * still targets (so older entries must be retargeted), needs a replacement.
 * Recording a fallback for a merely historical row would leave a dead record
 * that later blocks an unrelated delete.
 * @param deletedRevisionId - revision being deleted.
 * @param named - revision identities still named by rendered cards.
 * @param liveTargets - fallback targets still used by rendered cards.
 */
export function needsRevisionFallback(
  deletedRevisionId: string,
  named: ReadonlySet<string>,
  liveTargets: ReadonlySet<string>,
): boolean {
  return named.has(deletedRevisionId) || liveTargets.has(deletedRevisionId)
}

/** Index fallbacks by the deleted revision id a card program still names. */
export function revisionFallbackMap(fallbacks: readonly RevisionFallback[]): ReadonlyMap<string, RevisionFallback> {
  return new Map(fallbacks.map(fallback => [fallback.deletedRevisionId, fallback]))
}
