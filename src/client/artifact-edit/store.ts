/**
 * Browser-side multi-draft edit-session store for Artifact block editing.
 *
 * One draft is keyed by `${sessionId}:${baseRevisionId}` and owns the selected
 * blocks, their instructions, the target order, the global instruction and the
 * transient popover/panel state. M3 separates the draft from the canvas: a chat
 * session may keep several drafts, but only one of them is the active edit
 * canvas at a time (`activeKeys`). Closing the canvas keeps a non-empty draft
 * alive; only an empty, detached draft is discarded.
 *
 * Every draft that has content and is `attached` owns one composer reference
 * chip (`artifact-edit:<key>`, deterministic per draft). The store keeps all of
 * a chat's chips in step: attached drafts upsert their chip with a label that
 * carries the artifact title, revision and request summary, while detached,
 * empty and submitted drafts remove only their own chip. A chip the user
 * deletes is treated as "detached": the draft survives and the user can attach
 * it again from the panel or the card badge.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { describeArticleLayoutProblem } from '../../shared/article-layout.ts'
import {
  ARTIFACT_EDIT_SOURCE,
  ARTIFACT_REVISION_ROUTE_PATH,
  ARTIFACT_STYLE_EDIT_KIND,
  MAX_ARTIFACT_ADDITIONS,
  MAX_ARTIFACT_BATCH_REQUESTS,
  MAX_BLOCK_INSTRUCTION_CHARS,
  MAX_ARTIFACT_DRAFTS,
  MAX_ARTIFACT_PROGRAM_CHARS,
  MAX_STYLE_INSTRUCTION_CHARS,
  describeEditRequestProblem,
  describeTargetOrderProblem,
  isArtifactRevisionStatus,
  isEditLayout,
  isRequestId,
  isReorderedOrder,
  type ArtifactBlock,
  type ArtifactBlockEdit,
  type ArtifactEditRequest,
  type ArtifactStyleEditRequest,
} from '../../shared/artifact-edit.ts'
import { extractArtifactBlocks, wrapProgramForBlockEditing } from '../../shared/artifact-blocks.ts'
import { buildArtifactTree, replaceNodeContent } from '../../shared/program-cst.ts'
import {
  artifactBlockPropsFromNode,
  describeArtifactBlockPropsProblem,
  describeArtifactBlockPropsSupport,
  isArtifactBlockPropComponent,
  serializeArtifactBlockProps,
  type ArtifactBlockProps,
  type ArtifactBlockPropsSupport,
} from '../../shared/artifact-block-props.ts'
import { nestedBlocksForProgram } from './nested.ts'
import { addLocalRevision } from './local-revisions.ts'
import {
  ARTIFACT_STRUCTURE_ROUTE_PATH,
  MAX_ARTIFACT_STRUCTURE_OPERATIONS,
  describeStyleTargetProblem,
  isArtifactStructurePreview,
  isArtifactStructureResult,
  type ArtifactStructureResult,
  type ArtifactStyleTarget,
} from '../../shared/artifact-structure.ts'
import { ensureArtifactBase, invalidateArtifactBase, type ArtifactBaseOutcome } from './artifact-base.ts'
import { NESTED_CONTAINER_TYPES } from '../../shared/artifact-containers.ts'
import type { IntelligentUIProgram } from '../../shared/intelligent-ui.ts'
import { isStyleSnapshot, type StyleSnapshot } from '../../shared/style-templates.ts'
import { fallbackT, type Translate } from '../../shared/locales.ts'
import type { ApplyModelSummary, ApplyOutcomeNotice, ApplyPreviewOp, ApplyPreviewState, ApplyRoundResult, ArtifactBlockPropsPreview, ArtifactEditSession, ArtifactStructurePreviewLine, ArtifactStructurePreviewState, BatchOrderMode, OpenEditorResult, PendingApplyConflict, PendingStructureOp } from './contracts.ts'
import { MAX_PENDING_STRUCTURE_OPS, detectPendingConflicts, mapOldToNewBlocks, remapAdditions, remapNestedOrder, remapSelection, remapTargetOrder, validateStructureRemap, type RemapBlock } from './remap.ts'

/** Composer integration the store talks to; registered by the chip module. */
export interface ArtifactComposerBridge {
  /** Whether the draft can accept a chip edit right now. */
  readonly canEditChip: (sessionId: string) => boolean
  /** Insert or replace one draft's structured edit chip with its localized label. */
  readonly upsertChip: (sessionId: string, referenceId: string, label: string) => void
  /** Remove one draft's chip; every other artifact-edit chip stays in the draft. */
  readonly removeChip: (sessionId: string, referenceId: string) => void
  /** Return to the card that owns one chip. */
  readonly openRequest: (sessionId: string, referenceId: string) => void
}

/** Outcome of assembling the structured request at send time. */
export type SerializeOutcome =
  | { readonly ok: true; readonly request: ArtifactEditRequest }
  | {
    readonly ok: false
    /**
     * Why the send was blocked: the request shape, the revision probe, or a
     * chip whose edit session no longer exists (`stale`). `missing` is reserved
     * for an empty/internal reference that never named a session.
     */
    readonly problem: 'empty' | 'empty_instruction' | 'conflict' | 'invalid' | 'stale' | 'missing' | 'temporary_order' | 'style_mixed' | 'style_unsupported' | 'pending_apply'
  }

interface SessionMapSnapshot {
  readonly sessions: ReadonlyMap<string, ArtifactEditSession>
}

const listeners = new Set<() => void>()
const sessions = new Map<string, ArtifactEditSession>()
/** Chip reference -> session key, so the codec can resolve a sent chip. */
const references = new Map<string, string>()
const chipTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Active edit-canvas draft per chat session (`sessionId` -> draft key). */
const activeKeys = new Map<string, string>()
let snapshot: SessionMapSnapshot = { sessions: new Map() }
let bridge: ArtifactComposerBridge | undefined
let translate: Translate = fallbackT
/**
 * Host capability for revision-bound style editing, learned from the mode
 * projection. `undefined` until the projection is known; `false` on an old Host,
 * where style instructions are dropped so no unreadable envelope is ever sent.
 */
let styleEditSupported: boolean | undefined

/**
 * Record the Host's style-edit capability from the current mode projection.
 *
 * When the capability disappears (an old/upgraded-away Host), every pending
 * style instruction is cleared and its draft re-persisted, because such a Host
 * cannot parse a style envelope. Clearing is silent and keeps block edits.
 * @param supported - true when the Host announced the capability.
 */
export function setArtifactStyleEditSupported(supported: boolean): void {
  if (styleEditSupported === supported) return
  styleEditSupported = supported
  if (supported) return
  const changedSessions = new Set<string>()
  for (const [key, session] of sessions) {
    if (session.styleInstruction.trim() === '') continue
    sessions.set(key, { ...session, styleInstruction: '' })
    scheduleDraftPersist(key)
    changedSessions.add(session.sessionId)
  }
  if (changedSessions.size === 0) return
  publish()
  for (const sessionId of changedSessions) scheduleChipSync(sessionId, true)
}

/** Whether the Host supports style editing; undefined before the projection arrives. */
export function isArtifactStyleEditSupported(): boolean | undefined {
  return styleEditSupported
}

/**
 * Whether one draft holds unsaved work that a destructive action must not drop.
 *
 * Content lives in the draft; a mounted panel may additionally hold local work
 * (the unsaved global textarea, a panel-local structure batch) and the popover
 * may hold unsaved instruction text. Revision deletion, draft discard and Apply
 * all use this one predicate so no surface can silently bypass another.
 * @param session - draft to inspect.
 * @returns true when the draft or its mounted editor has unsaved work.
 */
export function hasUnsavedArtifactState(session: Pick<ArtifactEditSession, 'selection' | 'orderChanged' | 'globalInstruction' | 'styleInstruction' | 'activeDirty'> & {
  readonly nestedOrderChanged?: boolean
  readonly additions?: readonly unknown[]
  readonly pendingOps?: readonly unknown[]
  readonly panelDirty?: boolean
}): boolean {
  return hasArtifactEditContent(session) || session.activeDirty === true || session.panelDirty === true
}

/** Whether one draft currently holds unsent edit content. */
export function hasArtifactEditContent(
  session: Pick<ArtifactEditSession, 'selection' | 'orderChanged' | 'globalInstruction' | 'styleInstruction'> & { readonly nestedOrderChanged?: boolean; readonly pendingOps?: readonly unknown[] },
): boolean {
  return (session.pendingOps?.length ?? 0) > 0
    || session.selection.length > 0
    || (session.additions?.length ?? 0) > 0
    || session.orderChanged
    || session.nestedOrderChanged === true
    || session.globalInstruction.trim() !== ''
    || session.styleInstruction.trim() !== ''
}

/** Whether a draft counts against the per-chat draft cap and shows in the switcher. */
function isUserDraft(session: ArtifactEditSession): boolean {
  // Attachment only matters once a draft has content to send; an empty canvas
  // draft is transient and never counts.
  return session.status !== 'submitted' && hasArtifactEditContent(session)
}

/**
 * Base revision ids that one chat's unsent drafts are editing.
 *
 * A deletion of such a revision is blocked regardless of which card opens the
 * history: another card's draft is keyed by that base and would be stranded if
 * the record disappeared.
 * @param allSessions - current edit-session map.
 * @param sessionId - chat session.
 * @returns revision ids that must not be deleted while a draft exists.
 */
export function unsentDraftRevisionIds(
  allSessions: ReadonlyMap<string, ArtifactEditSession>,
  sessionId: string,
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const session of allSessions.values()) {
    if (session.sessionId !== sessionId || session.status === 'submitted') continue
    // A mounted panel's local work (unsaved global text, a batch draft) and
    // unsaved popover text are unsaved too: deleting the base would strand them.
    if (!hasUnsavedArtifactState(session)) continue
    ids.add(session.baseRevisionId)
  }
  return ids
}

/** Count the chat's drafts, optionally ignoring one key. */
function draftCount(sessionId: string, excludeKey?: string): number {
  let count = 0
  for (const [key, session] of sessions) {
    if (session.sessionId !== sessionId || key === excludeKey) continue
    if (isUserDraft(session)) count += 1
  }
  return count
}

/** Count the chat's drafts that currently contribute a composer chip. */
function attachedDraftCount(sessionId: string, excludeKey?: string): number {
  let count = 0
  for (const [key, session] of sessions) {
    if (key === excludeKey || session.sessionId !== sessionId || session.status === 'submitted') continue
    if (session.attached && hasArtifactEditContent(session)) count += 1
  }
  return count
}

/** Stable per-draft request id: `req_` plus 12 base36 characters. */
function newRequestId(): string {
  const bytes = new Uint8Array(12)
  const cryptoApi = typeof globalThis.crypto === 'object' ? globalThis.crypto : undefined
  if (cryptoApi !== undefined && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  let id = ''
  for (const byte of bytes) id += (byte % 36).toString(36)
  return `req_${id}`
}

/** The deterministic chip reference of one draft. */
function referenceOf(key: string): string {
  return `${ARTIFACT_EDIT_SOURCE}:${key}`
}

/** Drop the references-map entry of one discarded draft. */
function removeReference(key: string): void {
  references.delete(referenceOf(key))
}

/** Per-tab storage key prefix for one persisted draft. */
export const ARTIFACT_DRAFT_STORAGE_PREFIX = 'dsh-iui-edit-draft:v1:'
/** Per-chat storage key prefix for the draft key index. */
export const ARTIFACT_DRAFT_INDEX_PREFIX = 'dsh-iui-edit-draft-index:v1:'
/** Debounce before a changed draft is written back to sessionStorage. */
const DRAFT_PERSIST_DELAY = 250

/**
 * One draft as stored in sessionStorage: only what is needed to rebuild the
 * edit session after a reload. Blocks and the wrapped program are recomputed
 * from `program`, and transient UI state is never persisted.
 */
interface PersistedDraft {
  readonly key: string
  readonly sessionId: string
  readonly artifactId: string
  readonly baseRevisionId: string
  readonly baseRevision: number
  readonly requestId: string
  readonly title?: string
  readonly style: 'card' | 'article' | 'free'
  readonly styleId?: string
  readonly temporaryStyle?: StyleSnapshot
  readonly program: string
  readonly originalOrder: readonly string[]
  readonly targetOrder: readonly string[]
  readonly orderChanged: boolean
  readonly selection: readonly { readonly blockId: string; readonly order: number; readonly instruction: string }[]
  readonly globalInstruction: string
  /** Optional for drafts persisted before style editing existed. */
  readonly styleInstruction?: string
  /** Queued structure operations (task-11); absent on older records. */
  readonly pendingOps?: readonly { readonly id: string; readonly op: 'delete' | 'duplicate' | 'move'; readonly blockId: string; readonly targetParentBlockId?: string; readonly createdAt: number }[]
  /** Whether the draft was showing nested-container blocks; the tables rebuild from `program`. */
  readonly nestedMode?: boolean
  /** Pending nested group orders that differ from the rebuilt base order. */
  readonly nestedOrder?: Readonly<Record<string, readonly string[]>>
  readonly attached: boolean
}

/** Last payload written (or read) per draft, so unchanged drafts are skipped. */
const persistedDrafts = new Map<string, string>()
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Keys already looked up in storage once; a missing record is not retried. */
const hydrateAttempted = new Set<string>()

function draftStorage(): Storage | undefined {
  try {
    const storage = (globalThis as { sessionStorage?: Storage }).sessionStorage
    if (storage !== undefined && storage !== null && typeof storage.getItem === 'function') return storage
  } catch {
    /* sessionStorage access can throw in restricted browser contexts */
  }
  return undefined
}

function draftRecordKey(key: string): string {
  return `${ARTIFACT_DRAFT_STORAGE_PREFIX}${key}`
}

function draftIndexKey(sessionId: string): string {
  return `${ARTIFACT_DRAFT_INDEX_PREFIX}${sessionId}`
}

/** Read one chat's persisted draft-key index; empty for a missing record. */
function readDraftIndex(sessionId: string): string[] {
  const storage = draftStorage()
  if (storage === undefined) return []
  try {
    const raw = storage.getItem(draftIndexKey(sessionId))
    if (raw === null) return []
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

/** Write one chat's persisted draft-key index (best effort). */
function writeDraftIndex(sessionId: string, keys: readonly string[]): void {
  const storage = draftStorage()
  if (storage === undefined) return
  try {
    if (keys.length === 0) storage.removeItem(draftIndexKey(sessionId))
    else storage.setItem(draftIndexKey(sessionId), JSON.stringify(keys))
  } catch {
    /* quota/security: persistence stays best effort */
  }
}

/** Whether one draft should survive a reload. */
function isPersistableDraft(session: ArtifactEditSession): boolean {
  return session.status !== 'submitted' && hasArtifactEditContent(session)
}

/** Serialize the restore-relevant part of one draft; undefined when not storable. */
function serializePersistedDraft(session: ArtifactEditSession): string | undefined {
  if (session.program.length === 0 || session.program.length > MAX_ARTIFACT_PROGRAM_CHARS) return undefined
  // The shared request contract allows a temporary-style snapshot of at most
  // 20k characters; do not persist a draft whose snapshot would not be sendable.
  if (session.temporaryStyle !== undefined) {
    if (!isStyleSnapshot(session.temporaryStyle)) return undefined
    if (JSON.stringify(session.temporaryStyle).length > 20_000) return undefined
  }
  const changedNestedOrder = nestedOrderChanges(session)
  const record: PersistedDraft = {
    key: session.key,
    sessionId: session.sessionId,
    artifactId: session.artifactId,
    baseRevisionId: session.baseRevisionId,
    baseRevision: session.baseRevision,
    requestId: session.requestId,
    ...session.title === undefined ? {} : { title: session.title },
    style: session.style,
    ...session.styleId === undefined ? {} : { styleId: session.styleId },
    ...session.temporaryStyle === undefined ? {} : { temporaryStyle: session.temporaryStyle },
    program: session.program,
    originalOrder: [...session.originalOrder],
    targetOrder: [...session.targetOrder],
    orderChanged: session.orderChanged,
    selection: session.selection.map(entry => ({
      blockId: entry.blockId,
      order: entry.order,
      instruction: entry.instruction,
    })),
    globalInstruction: session.globalInstruction,
    ...session.styleInstruction.trim() === '' ? {} : { styleInstruction: session.styleInstruction },
    ...(session.pendingOps?.length ?? 0) === 0 ? {} : { pendingOps: session.pendingOps },
    ...session.nestedMode === true ? { nestedMode: true as const } : {},
    ...changedNestedOrder === undefined ? {} : { nestedOrder: changedNestedOrder },
    attached: session.attached,
  }
  try {
    return JSON.stringify(record)
  } catch {
    return undefined
  }
}

/** Write one draft immediately unless storage already holds the same payload. */
function writeDraftNow(key: string): void {
  const storage = draftStorage()
  if (storage === undefined) return
  const session = sessions.get(key)
  if (session === undefined || !isPersistableDraft(session)) { removePersistedDraft(key, session?.sessionId); return }
  const payload = serializePersistedDraft(session)
  if (payload === undefined) { removePersistedDraft(key, session.sessionId); return }
  if (persistedDrafts.get(key) === payload) return
  try {
    storage.setItem(draftRecordKey(key), payload)
    const index = readDraftIndex(session.sessionId).filter(candidate => candidate !== key)
    index.push(key)
    // Cap the per-chat index; the oldest persisted dump is evicted first.
    while (index.length > MAX_ARTIFACT_DRAFTS) {
      const evicted = index.shift()
      if (evicted === undefined) continue
      try { storage.removeItem(draftRecordKey(evicted)) } catch { /* best effort */ }
      persistedDrafts.delete(evicted)
    }
    writeDraftIndex(session.sessionId, index)
    persistedDrafts.set(key, payload)
  } catch {
    /* quota/security: toast-free best-effort persistence */
  }
}

/** Schedule the debounced write of one changed draft. */
function scheduleDraftPersist(key: string): void {
  if (draftStorage() === undefined) return
  const timer = persistTimers.get(key)
  if (timer !== undefined) clearTimeout(timer)
  persistTimers.set(key, setTimeout(() => {
    persistTimers.delete(key)
    writeDraftNow(key)
  }, DRAFT_PERSIST_DELAY))
}

/** Remove one draft from sessionStorage and from its chat's index. */
function removePersistedDraft(key: string, sessionId?: string): void {
  const timer = persistTimers.get(key)
  if (timer !== undefined) { clearTimeout(timer); persistTimers.delete(key) }
  persistedDrafts.delete(key)
  const storage = draftStorage()
  if (storage === undefined) return
  let owner = sessionId
  if (owner === undefined) {
    const session = sessions.get(key)
    if (session !== undefined) owner = session.sessionId
    else {
      try {
        const raw = storage.getItem(draftRecordKey(key))
        const value: unknown = raw === null ? undefined : JSON.parse(raw)
        if (value !== null && typeof value === 'object' && typeof (value as { sessionId?: unknown }).sessionId === 'string') {
          owner = (value as { sessionId: string }).sessionId
        }
      } catch { /* corrupt record: still remove the payload below */ }
    }
  }
  try { storage.removeItem(draftRecordKey(key)) } catch { /* best effort */ }
  if (owner === undefined) return
  writeDraftIndex(owner, readDraftIndex(owner).filter(candidate => candidate !== key))
}

/** Display block id grammar shared by persisted selections and nested orders. */
const DISPLAY_BLOCK_ID = /^b[1-9][0-9]{0,3}(?:\.[1-9][0-9]{0,3}){0,3}$/

/** Read the persisted changed nested groups; undefined for a missing/corrupt value. */
function readPersistedNestedOrder(value: unknown): Readonly<Record<string, readonly string[]>> | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const groups: Record<string, readonly string[]> = {}
  for (const [parent, children] of Object.entries(value as Record<string, unknown>)) {
    if (!DISPLAY_BLOCK_ID.test(parent) || !Array.isArray(children)) return undefined
    const ids: string[] = []
    for (const child of children) {
      if (typeof child !== 'string' || !DISPLAY_BLOCK_ID.test(child)) return undefined
      ids.push(child)
    }
    groups[parent] = ids
  }
  return Object.keys(groups).length === 0 ? undefined : groups
}

/** Validate one stored draft record; undefined for corrupt/obsolete data. */
function readPersistedDraft(raw: string): PersistedDraft | undefined {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return undefined }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.key !== 'string' || typeof record.sessionId !== 'string') return undefined
  if (typeof record.artifactId !== 'string' || typeof record.baseRevisionId !== 'string') return undefined
  if (typeof record.baseRevision !== 'number' || !Number.isSafeInteger(record.baseRevision) || record.baseRevision < 1) return undefined
  if (!isRequestId(record.requestId)) return undefined
  if (!isEditLayout(record.style)) return undefined
  if ('styleId' in record && typeof record.styleId !== 'string') return undefined
  if ('title' in record && typeof record.title !== 'string') return undefined
  let temporaryStyle: StyleSnapshot | undefined
  if ('temporaryStyle' in record) {
    if (!isStyleSnapshot(record.temporaryStyle)) return undefined
    if (record.temporaryStyle.baseLayout !== record.style) return undefined
    if (JSON.stringify(record.temporaryStyle).length > 20_000) return undefined
    if ('styleId' in record) return undefined
    temporaryStyle = record.temporaryStyle
  }
  if (typeof record.program !== 'string' || record.program.length === 0 || record.program.length > MAX_ARTIFACT_PROGRAM_CHARS) return undefined
  if (!Array.isArray(record.originalOrder) || !Array.isArray(record.targetOrder)) return undefined
  if (!record.originalOrder.every(entry => typeof entry === 'string')) return undefined
  if (!record.targetOrder.every(entry => typeof entry === 'string')) return undefined
  if (typeof record.orderChanged !== 'boolean' || typeof record.attached !== 'boolean') return undefined
  if (typeof record.globalInstruction !== 'string') return undefined
  // Tolerant migration: drafts persisted before style editing simply lack the
  // field; a corrupt one is dropped rather than failing the whole draft.
  const styleInstruction = typeof record.styleInstruction === 'string'
    ? record.styleInstruction.slice(0, MAX_STYLE_INSTRUCTION_CHARS)
    : ''
  // Queued structure operations are optional for older records. A corrupt shape
  // still rejects the draft, but an oversized (legacy) queue is trimmed to the
  // current cap so the rest of the user's draft survives the reload.
  const pendingOps: NonNullable<PersistedDraft['pendingOps']>[number][] = []
  if ('pendingOps' in record && record.pendingOps !== undefined) {
    if (!Array.isArray(record.pendingOps)) return undefined
    for (const entry of record.pendingOps) {
      if (entry === null || typeof entry !== 'object') return undefined
      const candidate = entry as Record<string, unknown>
      if (typeof candidate.id !== 'string' || candidate.id === '') return undefined
      if (candidate.op !== 'delete' && candidate.op !== 'duplicate' && candidate.op !== 'move') return undefined
      if (typeof candidate.blockId !== 'string' || !/^b[1-9][0-9.]{0,12}$/.test(candidate.blockId)) return undefined
      if ('targetParentBlockId' in candidate && candidate.targetParentBlockId !== undefined && typeof candidate.targetParentBlockId !== 'string') return undefined
      if (typeof candidate.createdAt !== 'number' || !Number.isFinite(candidate.createdAt)) return undefined
      pendingOps.push({ id: candidate.id, op: candidate.op, blockId: candidate.blockId, ...candidate.targetParentBlockId === undefined ? {} : { targetParentBlockId: candidate.targetParentBlockId as string }, createdAt: candidate.createdAt })
      if (pendingOps.length >= MAX_PENDING_STRUCTURE_OPS) break
    }
  }
  if (!Array.isArray(record.selection)) return undefined
  const selection: PersistedDraft['selection'][number][] = []
  for (const entry of record.selection) {
    if (entry === null || typeof entry !== 'object') return undefined
    const candidate = entry as Record<string, unknown>
    if (typeof candidate.blockId !== 'string' || !DISPLAY_BLOCK_ID.test(candidate.blockId)) return undefined
    if (typeof candidate.order !== 'number' || !Number.isSafeInteger(candidate.order) || candidate.order < 1) return undefined
    if (typeof candidate.instruction !== 'string') return undefined
    selection.push({ blockId: candidate.blockId, order: candidate.order, instruction: candidate.instruction })
  }
  if ('nestedMode' in record && record.nestedMode !== undefined && typeof record.nestedMode !== 'boolean') return undefined
  const nestedOrder = readPersistedNestedOrder(record.nestedOrder)
  return {
    key: record.key,
    sessionId: record.sessionId,
    artifactId: record.artifactId,
    baseRevisionId: record.baseRevisionId,
    baseRevision: record.baseRevision,
    requestId: record.requestId,
    ...record.title === undefined ? {} : { title: record.title },
    style: record.style,
    ...record.styleId === undefined ? {} : { styleId: record.styleId },
    ...temporaryStyle === undefined ? {} : { temporaryStyle },
    program: record.program,
    originalOrder: record.originalOrder,
    targetOrder: record.targetOrder,
    orderChanged: record.orderChanged,
    selection,
    globalInstruction: record.globalInstruction,
    ...styleInstruction === '' ? {} : { styleInstruction },
    ...pendingOps.length === 0 ? {} : { pendingOps },
    ...record.nestedMode === true ? { nestedMode: true as const } : {},
    ...nestedOrder === undefined ? {} : { nestedOrder },
    attached: record.attached,
  }
}

/**
 * Hydrate one draft from sessionStorage into the in-memory store.
 *
 * Idempotent and non-destructive: an in-memory draft always wins, a missing or
 * corrupt record is ignored (and cleaned up), and transient state is reset
 * (`status: 'ready'`, no active canvas/popover). After hydration the chat's
 * composer chips are re-synced so a restored draft keeps its chip.
 * @param key - edit-session key (`${sessionId}:${baseRevisionId}`).
 * @returns the restored draft, or undefined when there is nothing to restore.
 */
export function ensureArtifactDraft(key: string): ArtifactEditSession | undefined {
  const inMemory = sessions.get(key)
  if (inMemory !== undefined) return inMemory
  if (hydrateAttempted.has(key)) return undefined
  hydrateAttempted.add(key)
  const storage = draftStorage()
  if (storage === undefined) return undefined
  let raw: string | null
  try { raw = storage.getItem(draftRecordKey(key)) } catch { return undefined }
  if (raw === null) return undefined
  const record = readPersistedDraft(raw)
  if (record === undefined || record.key !== key) { removePersistedDraft(key); return undefined }
  const extraction = blocksForProgram(record.program)
  if (extraction.blocks.length === 0) { removePersistedDraft(key, record.sessionId); return undefined }
  const wrappedProgram = wrapProgramForBlockEditing(record.program, extraction)
  if (wrappedProgram === undefined) { removePersistedDraft(key, record.sessionId); return undefined }
  // A nested-mode draft is restored into its nested block table, so the
  // persisted nested selection keeps its node identity and stays serializable.
  const nested = record.nestedMode === true ? nestedBlocksForProgram(record.program) : undefined
  const blocks = nested === undefined ? extraction.blocks : nested.blocks
  const blockIds = extraction.blocks.map(block => block.blockId)
  if (describeTargetOrderProblem(blockIds, record.targetOrder) !== undefined) {
    removePersistedDraft(key, record.sessionId)
    return undefined
  }
  let nestedOrder: Record<string, string[]> | undefined
  let nestedOriginalOrder: Record<string, string[]> | undefined
  let nestedOrderChanged = false
  if (nested !== undefined) {
    nestedOriginalOrder = orderGroups(blocks)
    nestedOrder = Object.fromEntries(Object.entries(nestedOriginalOrder).map(([parent, ids]) => [parent, [...ids]]))
    for (const [parent, stored] of Object.entries(record.nestedOrder ?? {})) {
      const base = nestedOrder[parent]
      // Only a complete permutation of the current children can be trusted;
      // a stale/corrupt group falls back to the rebuilt base order.
      if (base === undefined || stored.length !== base.length || stored.some(id => !base.includes(id))) continue
      nestedOrder[parent] = [...stored]
    }
    nestedOrderChanged = nestedOrdersDiffer(nestedOrder, nestedOriginalOrder)
  }
  const known = new Set(blocks.map(block => block.blockId))
  const selection = record.selection
    .filter(entry => known.has(entry.blockId))
    .map(entry => ({ blockId: entry.blockId, order: entry.order, instruction: entry.instruction }))
  const session: ArtifactEditSession = {
    key,
    sessionId: record.sessionId,
    artifactId: record.artifactId,
    baseRevisionId: record.baseRevisionId,
    baseRevision: record.baseRevision,
    requestId: record.requestId,
    attached: record.attached,
    ...record.title === undefined ? {} : { title: record.title },
    style: record.style,
    ...record.styleId === undefined ? {} : { styleId: record.styleId },
    ...record.temporaryStyle === undefined ? {} : { temporaryStyle: record.temporaryStyle },
    program: record.program,
    ...nested === undefined ? {} : { nestedMode: true as const },
    wrappedProgram,
    blocks,
    originalOrder: blockIds,
    targetOrder: [...record.targetOrder],
    orderChanged: isReorderedOrder(blockIds, record.targetOrder),
    ...nestedOrder === undefined ? {} : { nestedOrder, nestedOriginalOrder, nestedOrderChanged },
    selection,
    globalInstruction: record.globalInstruction.slice(0, 4000),
    styleInstruction: styleEditSupported === false ? '' : (record.styleInstruction ?? '').slice(0, MAX_STYLE_INSTRUCTION_CHARS),
    editing: false,
    drawerOpen: false,
    status: 'ready',
    activeDraft: '',
    activeDirty: false,
    ...record.pendingOps === undefined || record.pendingOps.length === 0 ? {} : { pendingOps: record.pendingOps },
  }
  sessions.set(key, session)
  persistedDrafts.set(key, raw)
  referenceForSession(key)
  // An old Host cannot parse a style envelope: keep the restored draft but drop
  // its instruction and rewrite the persisted copy without it.
  if (styleEditSupported === false && (record.styleInstruction ?? '') !== '') scheduleDraftPersist(key)
  publish()
  scheduleChipSync(record.sessionId)
  return session
}

/**
 * Hydrate every persisted draft of one chat from its storage index.
 * @param sessionId - chat session id.
 * @returns number of drafts added to memory.
 */
export function hydrateArtifactDrafts(sessionId: string): number {
  let hydrated = 0
  for (const key of readDraftIndex(sessionId)) {
    if (sessions.has(key)) continue
    if (ensureArtifactDraft(key) !== undefined) hydrated += 1
  }
  return hydrated
}

/**
 * Flush every pending debounced draft write immediately.
 * Used by tests and by page-lifecycle flushes that cannot wait for the debounce.
 */
export function flushArtifactDraftPersistence(): void {
  for (const [key, timer] of [...persistTimers]) {
    clearTimeout(timer)
    persistTimers.delete(key)
    writeDraftNow(key)
  }
}

function publish(): void {
  const next = new Map<string, ArtifactEditSession>()
  for (const [key, value] of sessions) {
    if (value.editing || hasArtifactEditContent(value) || value.status === 'submitted') next.set(key, value)
  }
  for (const [key, value] of [...sessions]) {
    if (!next.has(key) && value.status !== 'submitted') {
      sessions.delete(key)
      removeReference(key)
      if (activeKeys.get(value.sessionId) === key) activeKeys.delete(value.sessionId)
    }
  }
  for (const [sessionId, key] of [...activeKeys]) {
    if (!sessions.has(key)) activeKeys.delete(sessionId)
  }
  // Storage hygiene: a draft that was sent, emptied or deleted stops surviving
  // reloads even while its in-memory record is still retained (submitted drafts
  // stay in memory only for submission reconciliation).
  for (const key of [...persistedDrafts.keys()]) {
    const session = sessions.get(key)
    if (session === undefined || !isPersistableDraft(session)) removePersistedDraft(key, session?.sessionId)
  }
  snapshot = { sessions: next }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): SessionMapSnapshot {
  return snapshot
}

/** Read the current edit store from React. */
export function useArtifactEditStore(): SessionMapSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Wire the composer chip implementation and locale. */
export function installArtifactComposerBridge(next: ArtifactComposerBridge, t: Translate = fallbackT): void {
  bridge = next
  translate = t
}

/** Translation seat used by the store's chip copy and by the codec. */
export function artifactEditTranslate(): Translate {
  return translate
}

/** Stable edit-session key. */
export function editKey(sessionId: string, baseRevisionId: string): string {
  return `${sessionId}:${baseRevisionId}`
}

/** Read one draft snapshot without subscribing; hydrates it from storage when needed. */
export function editSessionFor(sessionId: string, baseRevisionId: string): ArtifactEditSession | undefined {
  const key = editKey(sessionId, baseRevisionId)
  return sessions.get(key) ?? ensureArtifactDraft(key)
}

/** Read one draft by its session key without subscribing. */
export function draftSessionFor(key: string): ArtifactEditSession | undefined {
  return sessions.get(key)
}

/**
 * Subscribe one card to its own edit draft.
 *
 * A draft restored from sessionStorage is hydrated after mount (never during
 * render): the first render shows the normal card, then the badge/canvas appears
 * once the store publishes.
 */
export function useArtifactEditSession(sessionId: string, baseRevisionId: string): ArtifactEditSession | undefined {
  const store = useArtifactEditStore()
  const key = editKey(sessionId, baseRevisionId)
  const session = store.sessions.get(key)
  useEffect(() => {
    if (session === undefined) ensureArtifactDraft(key)
  }, [key, session])
  return session
}

/** The draft key currently shown in the edit canvas for one chat, if any. */
export function activeDraftKeyFor(sessionId: string): string | undefined {
  hydrateArtifactDrafts(sessionId)
  return activeKeys.get(sessionId)
}

/** The draft currently shown in the edit canvas for one chat. */
export function editingSessionFor(sessionId: string): ArtifactEditSession | undefined {
  const key = activeKeys.get(sessionId)
  if (key === undefined) return undefined
  const session = sessions.get(key)
  return session !== undefined && session.editing ? session : undefined
}

/**
 * Drafts of one chat that belong in the draft switcher, in creation order.
 * Submitted drafts and empty canvas-only drafts never appear.
 * @param sessionId - chat session id.
 * @returns the retained drafts.
 */
export function draftSessionsFor(sessionId: string): ArtifactEditSession[] {
  hydrateArtifactDrafts(sessionId)
  const drafts: ArtifactEditSession[] = []
  for (const session of sessions.values()) {
    if (session.sessionId !== sessionId || !isUserDraft(session)) continue
    drafts.push(session)
  }
  return drafts
}

/** Resolve one chip reference id back to its session key. */
export function editSessionKeyForReference(referenceId: string): string | undefined {
  return references.get(referenceId)
}

/**
 * Chip reference id for one session key.
 *
 * Deterministic on purpose: the id is derived only from the key
 * (`${sessionId}:${baseRevisionId}`), so it is identical after a page reload
 * and the references map can be rebuilt to match a chip restored from a draft.
 * The id contains no data beyond the key, so two sessions can never collide.
 * @param key - edit-session key.
 * @returns the stable chip reference id.
 */
export function referenceForSession(key: string): string {
  const reference = referenceOf(key)
  if (!references.has(reference)) references.set(reference, key)
  return reference
}

/** Recognition cache so the card and the store agree on one parse result. */
const extractionCache = new Map<string, ReturnType<typeof extractArtifactBlocks>>()

/** Cached block recognition for one program. */
export function blocksForProgram(program: string): ReturnType<typeof extractArtifactBlocks> {
  const cached = extractionCache.get(program)
  if (cached !== undefined) return cached
  const result = extractArtifactBlocks(program)
  if (extractionCache.size > 32) extractionCache.clear()
  extractionCache.set(program, result)
  return result
}

/**
 * Whether a card offers block editing at all.
 *
 * Temporary-style results are editable for block content only: the card must
 * carry a valid result-owned style snapshot (it is sent with the edit request).
 */
export function supportsBlockEditing(program: IntelligentUIProgram): boolean {
  if (program.running) return false
  if (program.styleSource === 'temporary' && !isStyleSnapshot(program.temporaryStyle)) return false
  if (program.temporaryStyle !== undefined && !isStyleSnapshot(program.temporaryStyle)) return false
  const extraction = blocksForProgram(program.program)
  if (extraction.blocks.length === 0) return false
  return wrapProgramForBlockEditing(program.program, extraction) !== undefined
}

/** Patch one session immutably and publish. */
function patch(key: string, update: (session: ArtifactEditSession) => ArtifactEditSession | undefined): void {
  const current = sessions.get(key)
  if (current === undefined) return
  const next = update(current)
  if (next === undefined) return
  sessions.set(key, next)
  publish()
}

/** Outcome of one revision probe: status plus the Host's latest revision number. */
interface RevisionProbe {
  readonly result: 'ok' | 'conflict' | 'unknown'
  /** Latest revision number reported by the Host; absent for unknown answers. */
  readonly latestRevision?: number
}

/** Revision probe; unknown host/network states are non-blocking. */
async function probeRevision(session: ArtifactEditSession): Promise<RevisionProbe> {
  if (typeof fetch !== 'function') return { result: 'unknown' }
  const query = `?artifactId=${encodeURIComponent(session.artifactId)}&revisionId=${encodeURIComponent(session.baseRevisionId)}`
  try {
    const response = await fetch(`${ARTIFACT_REVISION_ROUTE_PATH}${query}`, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (!response.ok) return { result: 'unknown' }
    const value: unknown = await response.json()
    if (!isArtifactRevisionStatus(value)) return { result: 'unknown' }
    return { result: value.conflict ? 'conflict' : 'ok', latestRevision: value.latestRevision }
  } catch {
    return { result: 'unknown' }
  }
}

/** Resolve a card's artifact lineage from the program extraction result. */
function lineageOf(program: IntelligentUIProgram): { artifactId: string; baseRevisionId: string; baseRevision: number } {
  return {
    artifactId: program.artifactId ?? program.callId,
    baseRevisionId: program.revisionId ?? program.callId,
    baseRevision: program.revision ?? 1,
  }
}

/**
 * Ensure the Host recorded the authoritative base program for one draft's
 * rendered revision. Fire-and-forget callers dedupe through the module cache;
 * authoritative operations await it and proceed even when it is unavailable.
 * @param session - draft facts naming the rendered revision and its program.
 * @returns the registration outcome (never throws).
 */
function ensureBaseForSession(session: Pick<ArtifactEditSession, 'artifactId' | 'baseRevisionId' | 'program'>): Promise<ArtifactBaseOutcome> {
  return ensureArtifactBase({
    artifactId: session.artifactId,
    revisionId: session.baseRevisionId,
    program: session.program,
  })
}

/**
 * Drop the cached base registration after the Host reports it is missing, so
 * the next authoritative operation re-posts the rendered program instead of
 * serving a stale success (the Host may have evicted the program after our
 * registration, or the record may have disappeared with an older Host).
 * @param session - draft facts naming the affected revision.
 * @param code - Host error code of the failed operation, when one was parsed.
 */
function invalidateBaseAfterMiss(session: Pick<ArtifactEditSession, 'artifactId' | 'baseRevisionId'>, code: string | undefined): void {
  if (code === 'base_missing' || code === 'artifact_missing') invalidateArtifactBase(session.artifactId, session.baseRevisionId)
}

/** Make one draft the chat's active canvas and close every other canvas. */
function activateKeyFor(sessionId: string, key: string): void {
  for (const [otherKey, other] of sessions) {
    if (otherKey === key || other.sessionId !== sessionId || !other.editing) continue
    sessions.set(otherKey, { ...other, editing: false, activeBlockId: undefined, activeDraft: '', activeDirty: false, drawerOpen: false })
  }
  activeKeys.set(sessionId, key)
}

/** Cancel the debounced chip sync for one chat session. */
function clearChipTimer(sessionId: string): void {
  const timer = chipTimers.get(sessionId)
  if (timer !== undefined) { clearTimeout(timer); chipTimers.delete(sessionId) }
}

/**
 * Publish the chips of every draft of one chat.
 *
 * Attached drafts with content upsert their own chip; detached, empty or
 * submitted drafts remove only their own chip. Insertion order follows draft
 * creation order, so the composer chip order stays stable while editing.
 * @param sessionId - chat session whose chips change.
 * @param immediate - skip the typed-text debounce.
 */
function scheduleChipSync(sessionId: string, immediate = false): void {
  if (bridge === undefined) return
  clearChipTimer(sessionId)
  const run = (): void => {
    chipTimers.delete(sessionId)
    const currentBridge = bridge
    if (currentBridge === undefined) return
    for (const [key, session] of sessions) {
      if (session.sessionId !== sessionId) continue
      const reference = referenceForSession(key)
      const participates = session.status !== 'submitted' && session.attached && hasArtifactEditContent(session)
      if (participates) currentBridge.upsertChip(sessionId, reference, chipLabelForSession(session))
      else currentBridge.removeChip(sessionId, reference)
    }
  }
  if (immediate) run()
  else chipTimers.set(sessionId, setTimeout(run, 250))
}

/**
 * Activate one draft as the chat's edit canvas.
 * @param key - draft key.
 * @returns whether a retained draft was activated.
 */
export function activateDraft(key: string): boolean {
  const session = sessions.get(key) ?? ensureArtifactDraft(key)
  if (session === undefined || session.status === 'submitted') return false
  activateKeyFor(session.sessionId, key)
  if (!session.editing) {
    sessions.set(key, { ...session, editing: true, submitFailed: false, activeBlockId: undefined, activeDraft: '', activeDirty: false, drawerOpen: false })
  } else if (session.submitFailed === true) {
    sessions.set(key, { ...session, submitFailed: false })
  }
  publish()
  return true
}

/**
 * Attach one detached draft to the next Send, when the batch has room.
 * @param key - draft key.
 * @returns whether the draft now contributes a chip.
 */
export function attachDraft(key: string): boolean {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted') return false
  if (session.attached) return true
  if (attachedDraftCount(session.sessionId) >= MAX_ARTIFACT_BATCH_REQUESTS) return false
  sessions.set(key, { ...session, attached: true, submitFailed: false })
  publish()
  if (hasArtifactEditContent(sessions.get(key) ?? session)) scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
  return true
}

/**
 * Discard one draft for good (content, chip and canvas state).
 *
 * Unsaved content is never dropped silently: the caller has to pass an explicit
 * confirmation, so the dock's two-step delete is the only way to lose a draft
 * that still holds work (draft content or panel-local text).
 * @param key - draft key.
 * @param confirm - true only after the user explicitly confirmed the discard.
 */
export function discardDraft(key: string, confirm = false): void {
  const session = sessions.get(key)
  if (session === undefined) return
  if (!confirm && hasUnsavedArtifactState(session) && session.status !== 'submitted') return
  const reference = referenceOf(key)
  nextPreviewGeneration(key)
  sessions.delete(key)
  references.delete(reference)
  if (activeKeys.get(session.sessionId) === key) activeKeys.delete(session.sessionId)
  if (bridge !== undefined) bridge.removeChip(session.sessionId, reference)
  publish()
}

/**
 * Composer callback: one attached draft's chip disappeared from the draft.
 *
 * This is the user deleting the chip, not the store removing it, so the draft
 * is kept and simply stops participating in the next Send until re-attached.
 * Empty drafts and drafts the store itself removed are ignored.
 * @param referenceId - chip reference that is gone.
 */
export function noteArtifactChipMissing(referenceId: string): void {
  const key = references.get(referenceId)
  if (key === undefined) return
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted' || !session.attached) return
  if (!hasArtifactEditContent(session)) return
  sessions.set(key, { ...session, attached: false })
  publish()
  scheduleDraftPersist(key)
}

/** Run a revision probe and settle one draft's status (and latest revision number). */
function checkRevision(key: string): void {
  const current = sessions.get(key)
  if (current === undefined) return
  void probeRevision(current).then(probe => {
    patch(key, session => {
      if (session.status === 'submitted') return undefined
      const latestRevision = probe.latestRevision ?? session.latestRevision
      let status = session.status
      let error = session.error
      if (probe.result === 'conflict') {
        // A branch draft explicitly targets a non-head revision, so the answer
        // only refreshes the banner metadata; it never becomes a blocking conflict.
        if (session.branch === true) {
          if (session.status === 'checking') status = 'ready'
        } else {
          status = 'conflict'
          error = undefined
        }
      } else if (probe.result === 'ok' && (session.status === 'checking' || session.status === 'conflict' || session.status === 'error')) {
        status = 'ready'
        error = undefined
      }
      if (status === session.status && error === session.error && latestRevision === session.latestRevision) return undefined
      return { ...session, status, error, latestRevision }
    })
  })
}

/**
 * Open (or re-activate) the edit canvas for one rendered card.
 *
 * The first call creates a draft; later calls reactivate the retained draft.
 * A new draft needs room under the per-chat draft cap, and joins the next Send
 * only when the batch still has room (otherwise it starts detached).
 * @param sessionId - chat session owning the card.
 * @param program - extracted render_ui program identity and content.
 * @returns ok, or why editing is unavailable.
 */
export function openArtifactEditor(sessionId: string, program: IntelligentUIProgram): OpenEditorResult {
  if (!supportsBlockEditing(program)) return { ok: false, reason: 'unsupported' }
  const extraction = blocksForProgram(program.program)
  const wrappedProgram = wrapProgramForBlockEditing(program.program, extraction)
  if (wrappedProgram === undefined) return { ok: false, reason: 'unsupported' }
  // Temporary-style cards keep their result-owned snapshot in the draft so the
  // edit request can replay it; such drafts never carry a styleId.
  const temporaryStyle = isStyleSnapshot(program.temporaryStyle) ? program.temporaryStyle : undefined
  const style = program.style ?? temporaryStyle?.baseLayout ?? 'card'
  const styleId = temporaryStyle === undefined ? program.styleId : undefined
  const lineage = lineageOf(program)
  const key = editKey(sessionId, lineage.baseRevisionId)
  const existing = sessions.get(key)

  // Retained draft: show its canvas again without touching the content.
  if (existing !== undefined && existing.status !== 'submitted') {
    void ensureBaseForSession(existing)
    activateKeyFor(sessionId, key)
    patch(key, session => ({
      ...session,
      editing: true,
      style,
      styleId,
      temporaryStyle,
      activeBlockId: undefined,
      activeDraft: '',
      activeDirty: false,
      drawerOpen: false,
      error: undefined,
      propsPreview: undefined,
      propsError: undefined,
      propsBusy: false,
      propsFallback: undefined,
    }))
    if (existing.status === 'conflict') {
      patch(key, session => ({ ...session, status: 'checking', error: undefined }))
      checkRevision(key)
      return { ok: false, reason: 'conflict' }
    }
    return { ok: true }
  }

  // A new draft (or a consumed draft being reused) needs cap room.
  if (draftCount(sessionId, key) >= MAX_ARTIFACT_DRAFTS) return { ok: false, reason: 'limit' }
  const attached = attachedDraftCount(sessionId) < MAX_ARTIFACT_BATCH_REQUESTS

  if (existing === undefined) {
    activateKeyFor(sessionId, key)
    const created: ArtifactEditSession = {
      key,
      sessionId,
      artifactId: lineage.artifactId,
      baseRevisionId: lineage.baseRevisionId,
      baseRevision: lineage.baseRevision,
      requestId: newRequestId(),
      attached,
      branch: false,
      ...program.title === undefined ? {} : { title: program.title },
      style,
      ...styleId === undefined ? {} : { styleId },
      ...temporaryStyle === undefined ? {} : { temporaryStyle },
      program: program.program,
      nestedMode: false,
      strict: false,
      wrappedProgram,
      blocks: extraction.blocks,
      originalOrder: extraction.blocks.map(block => block.blockId),
      targetOrder: extraction.blocks.map(block => block.blockId),
      orderChanged: false,
      selection: [],
      globalInstruction: '',
      styleInstruction: '',
      editing: true,
      drawerOpen: false,
      status: 'checking',
      activeDraft: '',
      activeDirty: false,
    }
    sessions.set(key, created)
    publish()
    void ensureBaseForSession(created)
    checkRevision(key)
    return { ok: true }
  }

  // Submitted draft reused: content was sent, so this is a fresh draft.
  void ensureBaseForSession(existing)
  activateKeyFor(sessionId, key)
  patch(key, session => ({
    ...session,
    requestId: newRequestId(),
    attached,
    branch: false,
    style,
    styleId,
    temporaryStyle,
    latestRevision: undefined,
    selection: [],
    removable: undefined,
    globalInstruction: '',
    styleInstruction: '',
    styleSwitchTarget: undefined,
    styleSwitchTargetLayout: undefined,
    styleSwitchBusy: false,
    styleSwitchError: undefined,
    targetOrder: extraction.blocks.map(block => block.blockId),
    orderChanged: false,
    nestedMode: false,
    nestedOrder: undefined,
    nestedOriginalOrder: undefined,
    nestedOrderChanged: false,
    additions: undefined,
    strict: false,
    structureBusy: false,
    structureError: undefined,
    propsPreview: undefined,
    propsError: undefined,
    propsBusy: false,
    status: 'checking',
    editing: true,
    activeBlockId: undefined,
    activeDraft: '',
    activeDirty: false,
    drawerOpen: false,
    error: undefined,
    wrappedProgram,
    blocks: extraction.blocks,
    program: program.program,
  }))
  checkRevision(key)
  return { ok: true }
}

/**
 * Close the edit canvas. A draft with content survives as a detached draft
 * (and keeps its chip); an empty canvas draft is discarded.
 * @param key - draft key.
 */
export function closeArtifactEditor(key: string): void {
  const session = sessions.get(key)
  if (session === undefined) return
  // A preview probe may still be in flight; closing the canvas must drop its
  // late answer even when the draft survives as a detached draft.
  nextPreviewGeneration(key)
  if (activeKeys.get(session.sessionId) === key) activeKeys.delete(session.sessionId)
  if (!hasArtifactEditContent(session)) {
    sessions.delete(key)
    removeReference(key)
  } else {
    sessions.set(key, { ...session, editing: false, activeBlockId: undefined, activeDraft: '', activeDirty: false, drawerOpen: false, propsPreview: undefined, propsError: undefined })
  }
  publish()
  scheduleChipSync(session.sessionId, true)
}

/** Smallest positive badge number not used by the current selection. */
function nextOrder(session: ArtifactEditSession): number {
  const used = new Set(session.selection.map(item => item.order))
  let order = 1
  while (used.has(order)) order += 1
  return order
}

/** Read one block's saved instruction. */
function instructionFor(session: ArtifactEditSession, blockId: string): string {
  return session.selection.find(item => item.blockId === blockId)?.instruction ?? ''
}

/**
 * Open one block's instruction popover. The block is not added to the request
 * list until its instruction is saved; an existing request loads its text.
 */
export function openArtifactBlockEditor(key: string, blockId: string): void {
  patch(key, session => {
    if (session.status !== 'ready' || !session.editing) return undefined
    return {
      ...session,
      activeBlockId: blockId,
      activeDraft: instructionFor(session, blockId),
      activeDirty: false,
      propsPreview: session.propsPreview?.blockId === blockId ? session.propsPreview : undefined,
      propsError: undefined,
      propsFallback: undefined,
    }
  })
}

/** Close the popover and drop unsaved text. */
export function closeArtifactBlockEditor(key: string): void {
  patch(key, session => session.activeBlockId === undefined ? undefined : {
    ...session,
    activeBlockId: undefined,
    activeDraft: '',
    activeDirty: false,
    propsPreview: undefined,
    propsError: undefined,
  })
}

/** Update the popover draft without persisting it. */
export function updateArtifactBlockDraft(key: string, blockId: string, text: string): void {
  patch(key, session => {
    if (session.activeBlockId !== blockId) return undefined
    return { ...session, activeDraft: text, activeDirty: text.trim() !== instructionFor(session, blockId).trim() }
  })
}

/**
 * Persist one block instruction and close the popover. A non-empty text creates
 * the request (or updates it); an empty text creates nothing, and clears an
 * existing request for that block.
 */
export function saveArtifactBlockInstruction(key: string, blockId: string, text: string): void {
  const session = sessions.get(key)
  if (session === undefined) return
  const instruction = text.trim()
  const existing = session.selection.find(item => item.blockId === blockId)
  let selection: readonly ArtifactEditSession['selection'][number][] = session.selection
  if (instruction === '') {
    selection = session.selection.filter(item => item.blockId !== blockId)
  } else if (existing !== undefined) {
    selection = session.selection.map(item => item.blockId === blockId ? { ...item, instruction } : item)
  } else {
    selection = [...session.selection, { blockId, order: nextOrder(session), instruction }]
  }
  sessions.set(key, { ...session, selection, activeBlockId: undefined, activeDraft: '', activeDirty: false })
  publish()
  scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
}

/** Remove one saved block request; the block itself and the arrangement stay. */
export function clearArtifactBlockInstruction(key: string, blockId: string): void {
  removeArtifactSelection(key, blockId)
}

/** Remove one block from this edit session (deselect). */
export function removeArtifactSelection(key: string, blockId: string): void {
  const session = sessions.get(key)
  if (session === undefined) return
  const removed = session.selection.find(item => item.blockId === blockId)
  if (removed === undefined) return
  const title = session.blocks.find(block => block.blockId === blockId)?.title
  sessions.set(key, {
    ...session,
    selection: session.selection.filter(item => item.blockId !== blockId),
    ...session.activeBlockId === blockId ? { activeBlockId: undefined, activeDraft: '', activeDirty: false } : {},
    removable: { blockId, order: removed.order, instruction: removed.instruction, ...title === undefined ? {} : { title } },
  })
  publish()
  scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
}

/** Restore the most recently removed selection with its original badge number. */
export function undoArtifactRemove(key: string): void {
  const session = sessions.get(key)
  if (session === undefined || session.removable === undefined) return
  const removed = session.removable
  if (session.selection.some(item => item.blockId === removed.blockId)) return
  sessions.set(key, {
    ...session,
    selection: [...session.selection, { blockId: removed.blockId, order: removed.order, instruction: removed.instruction }],
    removable: undefined,
  })
  publish()
  scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
}

/** Apply one target order to a session, deriving orderChanged and publishing. */
function applyTargetOrder(key: string, session: ArtifactEditSession, targetOrder: readonly string[], immediate = true): void {
  const next = [...targetOrder]
  const orderChanged = isReorderedOrder(session.originalOrder, next)
  if (!orderChanged && !session.orderChanged && next.join('\n') === session.targetOrder.join('\n')) return
  sessions.set(key, { ...session, targetOrder: next, orderChanged })
  publish()
  scheduleChipSync(session.sessionId, immediate)
  scheduleDraftPersist(key)
}

/**
 * Next target order for a batch arrangement move, or undefined when it cannot change.
 *
 * Top/bottom keep the selected blocks' relative order. Up/down move every
 * selected block exactly one slot without crossing another selected block:
 * upward moves run in ascending index order and downward moves in descending
 * order, so each selected block only ever swaps with an unselected neighbour.
 * @param order - current target order.
 * @param blockIds - selected block ids; unknown ids are ignored.
 * @param mode - batch move direction.
 * @returns the next order, or undefined for an empty/no-op move.
 */
export function batchMoveTarget(
  order: readonly string[],
  blockIds: readonly string[],
  mode: BatchOrderMode,
): readonly string[] | undefined {
  const selected = new Set(blockIds)
  const picked = order.filter(blockId => selected.has(blockId))
  if (picked.length === 0) return undefined
  let next: string[]
  if (mode === 'top') {
    next = [...picked, ...order.filter(blockId => !selected.has(blockId))]
  } else if (mode === 'bottom') {
    next = [...order.filter(blockId => !selected.has(blockId)), ...picked]
  } else {
    next = [...order]
    const indices = order.flatMap((blockId, index) => selected.has(blockId) ? [index] : [])
    const steps = mode === 'up' ? indices : [...indices].reverse()
    const delta = mode === 'up' ? -1 : 1
    for (const index of steps) {
      const swapWith = index + delta
      if (swapWith < 0 || swapWith >= next.length) continue
      if (selected.has(next[swapWith])) continue
      const moved = next[index]
      next[index] = next[swapWith]
      next[swapWith] = moved
    }
  }
  return next.join('\n') === order.join('\n') ? undefined : next
}

/** Whether one batch arrangement move would change the order. */
export function canBatchMove(order: readonly string[], blockIds: readonly string[], mode: BatchOrderMode): boolean {
  return batchMoveTarget(order, blockIds, mode) !== undefined
}

/**
 * Move one block to an absolute index of the arrangement draft.
 * @param key - edit-session key.
 * @param blockId - block being moved.
 * @param toIndex - zero-based destination index in the target order.
 */
export function moveArtifactBlock(key: string, blockId: string, toIndex: number): void {
  const session = sessions.get(key)
  if (session === undefined) return
  const from = session.targetOrder.indexOf(blockId)
  if (from < 0) return
  const bounded = Math.max(0, Math.min(session.targetOrder.length - 1, Math.trunc(toIndex)))
  if (bounded === from) return
  const next = [...session.targetOrder]
  next.splice(from, 1)
  next.splice(bounded, 0, blockId)
  applyTargetOrder(key, session, next)
}

/**
 * Move one block by a relative number of positions (keyboard reordering).
 * @param key - edit-session key.
 * @param blockId - block being moved.
 * @param delta - negative moves up, positive moves down.
 */
export function moveArtifactBlockBy(key: string, blockId: string, delta: number): void {
  const session = sessions.get(key)
  if (session === undefined) return
  const from = session.targetOrder.indexOf(blockId)
  if (from < 0) return
  moveArtifactBlock(key, blockId, from + delta)
}

/**
 * Move a batch of blocks in the arrangement draft without touching edits,
 * their numbers/colours or the program. Only `targetOrder`/`orderChanged`
 * change, through the same persistence and chip-sync path as one-block moves.
 * @param key - edit-session key.
 * @param blockIds - selected block ids in arrangement order.
 * @param mode - one step up/down, or straight to the top/bottom.
 */
export function moveArtifactBlocks(key: string, blockIds: readonly string[], mode: BatchOrderMode): void {
  const session = sessions.get(key)
  if (session === undefined) return
  const next = batchMoveTarget(session.targetOrder, blockIds, mode)
  if (next === undefined) return
  applyTargetOrder(key, session, next)
}

/**
 * Restore the target order to the base revision's page order. Saved requests,
 * their numbers/colours and the global instruction are untouched.
 * @param key - edit-session key.
 */
export function resetArtifactOrder(key: string): void {
  const session = sessions.get(key)
  if (session === undefined) return
  applyTargetOrder(key, session, session.originalOrder)
}

/** Remove every saved block request but keep the arrangement and global instruction. */
export function clearAllArtifactEdits(key: string): void {
  const session = sessions.get(key)
  if (session === undefined || session.selection.length === 0) return
  sessions.set(key, { ...session, selection: [], removable: undefined })
  publish()
  scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
}

/** Replace the global instruction. */
export function setArtifactGlobalInstruction(key: string, text: string): void {
  const session = sessions.get(key)
  if (session === undefined || session.globalInstruction === text) return
  sessions.set(key, { ...session, globalInstruction: text.slice(0, 4000) })
  publish()
  scheduleChipSync(session.sessionId)
  scheduleDraftPersist(key)
}

/**
 * Replace the natural-language style instruction of one draft.
 *
 * The text is capped at the contract bound and persisted with the draft; the
 * composer chip label follows immediately (style takes precedence over block
 * facts). A draft with a style instruction can no longer carry block edits —
 * serialize rejects that mix before sending.
 * @param key - edit-session key.
 * @param text - new style requirement (may be empty to clear).
 */
export function setArtifactStyleInstruction(key: string, text: string): void {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted') return
  const next = text.slice(0, MAX_STYLE_INSTRUCTION_CHARS)
  if (session.styleInstruction === next) return
  sessions.set(key, { ...session, styleInstruction: next })
  publish()
  scheduleChipSync(session.sessionId)
  scheduleDraftPersist(key)
}

/** Build parent display id -> child display ids groups from a nested block map. */
function orderGroups(blocks: readonly { blockId: string; parentBlockId?: string }[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {}
  for (const block of blocks) {
    if (block.parentBlockId === undefined) continue
    ;(groups[block.parentBlockId] ??= []).push(block.blockId)
  }
  return groups
}

/**
 * Pending nested group orders that differ from the base order.
 *
 * Only the changed groups are worth persisting; the base order is rebuilt from
 * the program on hydrate, so an unchanged group never needs a stored copy.
 * @param session - draft whose nested arrangement is inspected.
 * @returns changed groups, or undefined when every group is at its base order.
 */
function nestedOrderChanges(session: Pick<ArtifactEditSession, 'nestedMode' | 'nestedOrder' | 'nestedOriginalOrder'>): Record<string, readonly string[]> | undefined {
  if (session.nestedMode !== true || session.nestedOrder === undefined) return undefined
  const changed: Record<string, readonly string[]> = {}
  for (const [parent, ids] of Object.entries(session.nestedOrder)) {
    const base = session.nestedOriginalOrder?.[parent]
    if (base !== undefined && base.length === ids.length && base.every((id, index) => id === ids[index])) continue
    changed[parent] = [...ids]
  }
  return Object.keys(changed).length === 0 ? undefined : changed
}

/** Whether any nested group differs from its base order. */
function nestedOrdersDiffer(order: Readonly<Record<string, readonly string[]>> | undefined, base: Readonly<Record<string, readonly string[]>> | undefined): boolean {
  if (order === undefined || base === undefined) return false
  const keys = new Set([...Object.keys(order), ...Object.keys(base)])
  for (const key of keys) {
    const a = order[key] ?? []
    const b = base[key] ?? []
    if (a.length !== b.length || a.some((id, index) => id !== b[index])) return true
  }
  return false
}

/**
 * Toggle nested-container block selection. Nested blocks are only offered when
 * the CST tree finds supported container children; switching modes clears the
 * current selection so display ids cannot collide with root requests.
 * @param key - edit-session key.
 * @param enabled - whether to show nested blocks.
 */
export function setArtifactNestedMode(key: string, enabled: boolean): boolean {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted') return false
  if (enabled) {
    const nested = nestedBlocksForProgram(session.program)
    if (nested === undefined || !nested.hasNested) return false
    if (session.nestedMode === true) return true
    const groups = orderGroups(nested.blocks)
    sessions.set(key, {
      ...session,
      nestedMode: true,
      blocks: nested.blocks,
      nestedOriginalOrder: groups,
      nestedOrder: Object.fromEntries(Object.entries(groups).map(([parent, ids]) => [parent, [...ids]])),
      nestedOrderChanged: false,
      selection: [],
      activeBlockId: undefined,
      activeDraft: '',
      activeDirty: false,
    })
  } else {
    const extraction = blocksForProgram(session.program)
    sessions.set(key, {
      ...session,
      nestedMode: false,
      blocks: extraction.blocks,
      nestedOrder: undefined,
      nestedOriginalOrder: undefined,
      nestedOrderChanged: false,
      selection: [],
      activeBlockId: undefined,
      activeDraft: '',
      activeDirty: false,
    })
  }
  publish()
  scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
  return true
}

/** Toggle strict unselected-block protection for this draft. */
export function setArtifactStrictMode(key: string, enabled: boolean): void {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted') return
  if (session.strict === enabled) return
  sessions.set(key, { ...session, strict: enabled })
  publish()
  scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
}

/** Apply one nested parent group order and publish. */
function applyNestedGroupOrder(key: string, parentBlockId: string, order: readonly string[]): void {
  const session = sessions.get(key)
  if (session === undefined || session.nestedOrder === undefined) return
  const next = { ...session.nestedOrder, [parentBlockId]: [...order] }
  sessions.set(key, {
    ...session,
    nestedOrder: next,
    nestedOrderChanged: nestedOrdersDiffer(next, session.nestedOriginalOrder),
  })
  publish()
  scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
}

/**
 * Move one nested child inside its display parent group.
 * @param key - edit-session key.
 * @param parentBlockId - display id of the parent container block.
 * @param blockId - nested child display id.
 * @param toIndex - target index inside that parent group.
 */
export function moveArtifactNestedBlock(key: string, parentBlockId: string, blockId: string, toIndex: number): void {
  const session = sessions.get(key)
  if (session === undefined) return
  const order = session.nestedOrder?.[parentBlockId]
  if (order === undefined) return
  const from = order.indexOf(blockId)
  if (from < 0) return
  const bounded = Math.max(0, Math.min(order.length - 1, Math.trunc(toIndex)))
  if (bounded === from) return
  const next = [...order]
  next.splice(from, 1)
  next.splice(bounded, 0, blockId)
  applyNestedGroupOrder(key, parentBlockId, next)
}

/** Move one nested child by a relative number of positions. */
export function moveArtifactNestedBlockBy(key: string, parentBlockId: string, blockId: string, delta: number): void {
  const order = sessions.get(key)?.nestedOrder?.[parentBlockId]
  if (order === undefined) return
  const from = order.indexOf(blockId)
  if (from < 0) return
  moveArtifactNestedBlock(key, parentBlockId, blockId, from + delta)
}

/**
 * Move a batch of nested blocks, each inside its own parent group.
 *
 * The selection is partitioned per parent container; every group then applies
 * the same semantics as the top-level batch move (top/bottom keep the selected
 * relative order, up runs ascending and down descending, and a selected block
 * only swaps with an unselected sibling). Groups without a movable selection
 * are left untouched, and the chip/persistence path is the existing nested-order
 * one, so edit request numbers and colours are unaffected.
 * @param key - edit-session key.
 * @param blockIds - selected nested display ids.
 * @param mode - one step up/down, or straight to the top/bottom.
 */
export function moveArtifactNestedBlocks(key: string, blockIds: readonly string[], mode: BatchOrderMode): void {
  const session = sessions.get(key)
  if (session === undefined || session.nestedOrder === undefined) return
  const selected = new Set(blockIds)
  const groups = orderGroups(session.blocks)
  const next: Record<string, readonly string[]> = { ...session.nestedOrder }
  let changed = false
  for (const [parentId, childIds] of Object.entries(groups)) {
    const order = session.nestedOrder[parentId] ?? childIds
    const picked = order.filter(blockId => selected.has(blockId))
    if (picked.length === 0) continue
    const target = batchMoveTarget(order, picked, mode)
    if (target === undefined) continue
    next[parentId] = [...target]
    changed = true
  }
  if (!changed) return
  sessions.set(key, { ...session, nestedOrder: next, nestedOrderChanged: nestedOrdersDiffer(next, session.nestedOriginalOrder) })
  publish()
  scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
}

/** Restore every nested group to its base order. */
export function resetArtifactNestedOrder(key: string): void {
  const session = sessions.get(key)
  if (session === undefined || session.nestedOriginalOrder === undefined) return
  const clone = Object.fromEntries(Object.entries(session.nestedOriginalOrder).map(([parent, ids]) => [parent, [...ids]]))
  sessions.set(key, { ...session, nestedOrder: clone, nestedOrderChanged: false })
  publish()
  scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
}

/**
 * Apply one deterministic structural operation (delete or duplicate) through the
 * Host's authoritative revision route, then surface the result as a local
 * revision card in the current Turn. No model turn is involved.
 * @param key - edit-session key.
 * @param blockId - display block id inside the current canvas.
 * @param op - operation kind.
 * @param turn - latest loaded Turn, used to place the local card.
 */
/** Build the wire operation for one display block; undefined when it cannot be resolved. */
function structureOperationForBlock(
  session: ArtifactEditSession,
  blockId: string,
  op: 'delete' | 'duplicate',
): { operation: { op: 'delete' | 'duplicate'; nodeId: string; sourceDigest: string; toIndex?: number } } | undefined {
  const nested = nestedBlocksForProgram(session.program)
  const target = nested?.blocks.find(block => block.blockId === blockId)
  if (nested === undefined || target?.nodeId === undefined || target.sourceDigest === undefined) return undefined
  if (op === 'delete') return { operation: { op, nodeId: target.nodeId, sourceDigest: target.sourceDigest } }
  const group = target.parentBlockId === undefined
    ? nested.blocks.filter(block => block.parentBlockId === undefined)
    : nested.blocks.filter(block => block.parentBlockId === target.parentBlockId)
  const index = group.findIndex(block => block.blockId === blockId)
  return { operation: { op, nodeId: target.nodeId, sourceDigest: target.sourceDigest, toIndex: Math.max(0, index + 1) } }
}

/** Build a cross-container move operation from one display block and target. */
function moveOperationForBlock(
  session: ArtifactEditSession,
  blockId: string,
  targetParentBlockId: string | 'root',
): { operation: { op: 'move'; nodeId: string; sourceDigest: string; toIndex: number; toParentNodeId: string } } | undefined {
  const nested = nestedBlocksForProgram(session.program)
  const target = nested?.blocks.find(block => block.blockId === blockId)
  if (nested === undefined || target?.nodeId === undefined || target.sourceDigest === undefined) return undefined
  const targetParentNodeId = targetParentBlockId === 'root'
    ? nested.rootNodeId
    : nested.blocks.find(block => block.blockId === targetParentBlockId)?.nodeId
  if (targetParentNodeId === undefined) return undefined
  const children = targetParentBlockId === 'root'
    ? nested.blocks.filter(block => block.parentBlockId === undefined)
    : nested.blocks.filter(block => block.parentBlockId === targetParentBlockId)
  return {
    operation: {
      op: 'move',
      nodeId: target.nodeId,
      sourceDigest: target.sourceDigest,
      toParentNodeId: targetParentNodeId,
      toIndex: children.length,
    },
  }
}

/** One resolved display block of a batch structure operation. */
interface BatchStructureTarget {
  readonly blockId: string
  readonly nodeId: string
  readonly sourceDigest: string
  /** Parent display id; empty for root-level blocks. */
  readonly parentKey: string
  /** Index among the parent's editable children in the base program order. */
  readonly index: number
}

/**
 * Build the wire operations of one batch delete/duplicate.
 *
 * Top-level and nested blocks are both supported. The Host applies one batch
 * atomically in request order and re-resolves every target by base identity, so
 * duplicate targets are grouped per parent container and emitted in descending
 * base-index order within each group with `toIndex = base editable index + 1`:
 * every copy lands directly after its own source, earlier indices stay stable and
 * different parents cannot shift each other. A selection holding a container
 * together with one of its nested blocks is refused (the Host rejects such
 * ancestor pairs), as is any block without a resolvable node id/digest.
 * @param session - edit session whose base program is authoritative.
 * @param blockIds - selected display ids (root or nested).
 * @param op - batch operation kind.
 * @returns send-ordered operations plus display ids in page order, or undefined when the selection cannot be resolved.
 */
function batchStructureOperations(
  session: ArtifactEditSession,
  blockIds: readonly string[],
  op: 'delete' | 'duplicate',
): { operations: { op: 'delete' | 'duplicate'; nodeId: string; sourceDigest: string; toIndex?: number }[]; blockIds: readonly string[] } | undefined {
  const nested = nestedBlocksForProgram(session.program)
  if (nested === undefined) return undefined
  const requested = [...new Set(blockIds)]
  if (requested.length === 0) return undefined
  const selected = new Set(requested)
  // Nested display ids are hierarchical (`b1.2.1`), so a container/descendant
  // overlap is detectable before parsing the program.
  if (requested.some(blockId => requested.some(other => other !== blockId && other.startsWith(`${blockId}.`)))) return undefined
  const byId = new Map(nested.blocks.map(block => [block.blockId, block] as const))
  const targets: BatchStructureTarget[] = []
  for (const blockId of requested) {
    const block = byId.get(blockId)
    if (block?.nodeId === undefined || block.sourceDigest === undefined) return undefined
    const siblings = nested.blocks.filter(candidate => candidate.parentBlockId === block.parentBlockId)
    const index = siblings.findIndex(candidate => candidate.blockId === blockId)
    if (index < 0) return undefined
    targets.push({ blockId, nodeId: block.nodeId, sourceDigest: block.sourceDigest, parentKey: block.parentBlockId ?? '', index })
  }
  const targetById = new Map(targets.map(target => [target.blockId, target] as const))
  const pageOrder = nested.blocks.filter(block => selected.has(block.blockId)).map(block => block.blockId)
  if (op === 'delete') {
    return {
      operations: pageOrder.map(blockId => {
        const target = targetById.get(blockId) as BatchStructureTarget
        return { op, nodeId: target.nodeId, sourceDigest: target.sourceDigest }
      }),
      blockIds: pageOrder,
    }
  }
  const groups = new Map<string, BatchStructureTarget[]>()
  for (const target of targets) {
    const group = groups.get(target.parentKey) ?? []
    group.push(target)
    groups.set(target.parentKey, group)
  }
  const operations = [...groups.values()].flatMap(group => [...group]
    .sort((left, right) => right.index - left.index)
    .map(target => ({ op, nodeId: target.nodeId, sourceDigest: target.sourceDigest, toIndex: target.index + 1 })))
  return { operations, blockIds: pageOrder }
}

/** Minimal line diff; enough to review a structure change. */
function diffProgramLines(before: string, after: string): ArtifactStructurePreviewLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length > 400 || b.length > 400) {
    return [
      { kind: 'remove', text: `(${a.length} lines before)` },
      { kind: 'add', text: `(${b.length} lines after)` },
    ]
  }
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const lines: ArtifactStructurePreviewLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] })
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ kind: 'remove', text: a[i] })
      i += 1
    } else {
      lines.push({ kind: 'add', text: b[j] })
      j += 1
    }
  }
  while (i < a.length) { lines.push({ kind: 'remove', text: a[i] }); i += 1 }
  while (j < b.length) { lines.push({ kind: 'add', text: b[j] }); j += 1 }
  return lines
}

/** Host error code carried by one failed authoritative response body. */
function failureCodeOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const error = (value as { error?: unknown }).error
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * Locale copy for one failed authoritative operation.
 *
 * Structure preview, the structure apply POST and quick adjust share this
 * mapping, so artifact_missing/base_missing always explain the missing
 * registration or evicted record (and the close/reopen, re-render and
 * instruction-edit paths) instead of ending in a blind retry. Other codes keep
 * the operation-specific prompt.
 * @param input - Host error code, which surface failed, and its generic key.
 * @returns the message shown for that operation.
 */
function structureFailureMessage(input: {
  readonly code: string | undefined
  readonly surface: 'structure' | 'props'
  readonly failureKey: string
}): string {
  const { code, surface, failureKey } = input
  if (code === 'artifact_missing' || code === 'base_missing') {
    if (surface === 'props') return translate(code === 'artifact_missing' ? 'edit.propsMissingArtifact' : 'edit.propsNoBase')
    return translate('edit.structureBaseMissing')
  }
  if (surface === 'props' && code === 'base_not_latest') return translate('edit.propsStale')
  if (surface === 'props' && code === 'no_change') return translate('edit.propsNoChange')
  return translate(failureKey)
}

/** Quick-adjust fallback state recorded with the unified missing-base copy. */
function propsFallbackFor(code: string | undefined): 'base_missing' | 'artifact_missing' | undefined {
  return code === 'base_missing' ? 'base_missing' : code === 'artifact_missing' ? 'artifact_missing' : undefined
}

// ---------------------------------------------------------------------------
// Save → total preview → Apply pipeline (task-11)
// ---------------------------------------------------------------------------

/** Build one fresh queued-operation id. */
function pendingOpId(): string {
  return `op_${newRequestId().slice(4)}`
}

/** Queued structure operations of one draft (never undefined). */
export function pendingStructureOpsFor(session: Pick<ArtifactEditSession, 'pendingOps'>): readonly PendingStructureOp[] {
  return session.pendingOps ?? []
}

/** Whether the draft has model-request content besides queued structure ops. */
export function hasModelRequestContent(
  session: Pick<ArtifactEditSession, 'selection' | 'orderChanged' | 'globalInstruction' | 'styleInstruction'> & { readonly nestedOrderChanged?: boolean; readonly additions?: readonly unknown[] },
): boolean {
  return session.selection.length > 0
    || (session.additions?.length ?? 0) > 0
    || session.orderChanged
    || session.nestedOrderChanged === true
    || session.globalInstruction.trim() !== ''
    || session.styleInstruction.trim() !== ''
}

/**
 * Queue structure operations for the Apply round.
 * @param key - edit-session key.
 * @param inputs - operations without their generated id/timestamp.
 */
export function savePendingStructureOps(
  key: string,
  inputs: readonly { readonly op: PendingStructureOp['op']; readonly blockId: string; readonly targetParentBlockId?: string }[],
): SavePendingOpsResult {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted') return { ok: true }
  const current = pendingStructureOpsFor(session)
  const appended = inputs
    .filter(input => input.blockId !== '')
    .map(input => ({ id: pendingOpId(), op: input.op, blockId: input.blockId, ...input.targetParentBlockId === undefined ? {} : { targetParentBlockId: input.targetParentBlockId }, createdAt: Date.now() }))
  if (appended.length === 0) return { ok: true }
  // The limit is enforced here, before writing anything: a caller that queues a
  // 21st operation must hear about it instead of losing the operation silently.
  if (current.length + appended.length > MAX_PENDING_STRUCTURE_OPS) {
    return { ok: false, reason: 'limit', current: current.length, max: MAX_PENDING_STRUCTURE_OPS }
  }
  sessions.set(key, {
    ...session,
    pendingOps: [...current, ...appended],
    applyPreview: undefined,
    structureError: undefined,
  })
  publish()
  scheduleDraftPersist(key)
  scheduleChipSync(session.sessionId, true)
  return { ok: true }
}

/** Remove one queued operation (queue UI). */
export function removePendingStructureOp(key: string, id: string): boolean {
  const session = sessions.get(key)
  if (session === undefined) return false
  const current = pendingStructureOpsFor(session)
  const next = current.filter(op => op.id !== id)
  if (next.length === current.length) return false
  sessions.set(key, { ...session, pendingOps: next.length === 0 ? undefined : next, applyPreview: undefined })
  publish()
  scheduleDraftPersist(key)
  scheduleChipSync(session.sessionId, true)
  return true
}

/** Drop every queued operation (cancel batch / start a new round). */
export function clearPendingStructureOps(key: string): boolean {
  const session = sessions.get(key)
  if (session === undefined || (session.pendingOps?.length ?? 0) === 0) return false
  sessions.set(key, { ...session, pendingOps: undefined, applyPreview: undefined })
  publish()
  scheduleDraftPersist(key)
  scheduleChipSync(session.sessionId, true)
  return true
}

/** Localized label of one queued operation (display block title when known). */
function pendingOpLabel(op: PendingStructureOp, session: ArtifactEditSession): string {
  const block = nestedBlocksForProgram(session.program)?.blocks.find(candidate => candidate.blockId === op.blockId)
    ?? session.blocks.find(candidate => candidate.blockId === op.blockId)
  const name = block?.title !== undefined && block.title.trim() !== '' ? block.title.trim() : op.blockId
  return `${translate(`edit.pendingOp.${op.op}`)} · ${name}`
}

/** Dialog-facing view of the queue. */
function pendingOpPreviews(session: ArtifactEditSession): ApplyPreviewOp[] {
  return pendingStructureOpsFor(session).map(op => ({
    id: op.id,
    op: op.op,
    blockId: op.blockId,
    label: pendingOpLabel(op, session),
    ...op.targetParentBlockId === undefined ? {} : { targetParentBlockId: op.targetParentBlockId },
  }))
}

/** Model-request summary shown in the total preview (and the "need send" decision). */
function modelSummaryOf(session: ArtifactEditSession): ApplyModelSummary {
  const titles = session.selection.map(entry => {
    const block = nestedBlocksForProgram(session.program)?.blocks.find(candidate => candidate.blockId === entry.blockId)
      ?? session.blocks.find(candidate => candidate.blockId === entry.blockId)
    return block?.title !== undefined && block.title.trim() !== '' ? block.title.trim() : entry.blockId
  })
  return {
    requestCount: session.selection.length,
    titles,
    globalInstruction: session.globalInstruction,
    additions: (session.additions ?? []).map(addition => ({ parentBlockId: addition.parentBlockId, instruction: addition.instruction })),
    orderChanged: session.orderChanged,
    nestedOrderChanged: session.nestedOrderChanged === true,
    styleInstruction: session.styleInstruction,
    branch: session.branch === true,
  }
}

/** One structure-capable block plus its revision-scoped CST identity. */
interface StructureBlockTarget {
  readonly blockId: string
  readonly nodeId?: string
  readonly sourceDigest?: string
  readonly parentBlockId?: string
}

/** Structure-capable display blocks of one draft program. */
interface StructureBlockTable {
  readonly blocks: readonly StructureBlockTarget[]
  /** CST node id of the root `Col`, used as the move target for the page root. */
  readonly rootNodeId: string
  /** Whether `blocks` is the full nested display map (nested targets usable). */
  readonly nested: boolean
}

/**
 * Structure-capable block table for one draft program.
 *
 * The nested display map is authoritative whenever it can be built. When it
 * cannot be built without hitting a CST limit, the limit is reported as-is: the
 * Host applies the same depth/node caps, so an over-cap page has no addressable
 * structure operations and saying "too deep" for a shallow-but-huge page would
 * be a lie. When the map fails for any other reason (an unsupported node
 * elsewhere in the page), fall back to the direct root children of a CST built
 * with the same container whitelist as the Host: their node ids and digests
 * match the Host's tree, so root-level delete/duplicate/move stay resolvable.
 * Nested targets are not addressable in fallback mode.
 * @param program - draft base program.
 * @returns the table, or the CST limit that blocked it.
 */
function structureBlockTable(program: string): { readonly table?: StructureBlockTable; readonly limit?: 'depth' | 'nodes' } {
  const nested = nestedBlocksForProgram(program)
  if (nested !== undefined) return { table: { blocks: nested.blocks, rootNodeId: nested.rootNodeId, nested: true } }
  const tree = buildArtifactTree(program, { containerTypes: [...NESTED_CONTAINER_TYPES] })
  if (tree.limitsExceeded !== undefined) return { limit: tree.limitsExceeded === 'too_deep' ? 'depth' : 'nodes' }
  const root = tree.nodes.get(tree.rootNodeId)
  if (root === undefined) return {}
  const blocks: { blockId: string; nodeId: string; sourceDigest: string }[] = []
  let ordinal = 0
  for (const childId of root.children) {
    const node = tree.nodes.get(childId)
    if (node === undefined || !node.editable || node.problem !== undefined) continue
    ordinal += 1
    blocks.push({ blockId: `b${ordinal}`, nodeId: node.nodeId, sourceDigest: node.digest })
  }
  return blocks.length === 0
    ? {}
    : { table: { blocks, rootNodeId: tree.rootNodeId, nested: false } }
}

/**
 * Resolve queued display operations into one stable atomic Host batch.
 *
 * This is the single builder used by both the total preview and the real Apply,
 * so the two requests can never drift.
 *
 * Ordering strategy:
 * - operations are grouped by their source parent, groups keep their first
 *   queue position;
 * - one parent group must contain a single operation kind (delete, duplicate or
 *   move); mixing kinds in one container would make sibling indices ambiguous,
 *   so it is rejected with an `order` conflict instead of guessed;
 * - delete/duplicate groups are emitted in descending base editable index (the
 *   old batch helper's rule), which keeps earlier siblings stable and lets every
 *   duplicate land directly after its own source;
 * - one parent accepts at most one move (append-to-end), also rejected with
 *   `order` when violated;
 * - the Host re-resolves each base nodeId/sourceDigest, so different parents
 *   cannot shift each other.
 * @param program - draft base program.
 * @param ops - queued operations in queue order.
 * @returns wire operations plus conflicts (unresolved/order/ancestor overlap).
 */
export function resolvePendingStructureOperations(
  program: string,
  ops: readonly PendingStructureOp[],
): { readonly operations: readonly DeterministicOperation[]; readonly conflicts: PendingApplyConflict[] } {
  const conflicts: PendingApplyConflict[] = []
  const { table, limit } = structureBlockTable(program)
  if (table === undefined) {
    // The page cannot be read at all (over a CST limit, or an unsupported root):
    // every op is blocked, and a nested move says why instead of pretending the
    // block vanished from the revision. A node-cap page is reported as such,
    // never as a depth problem.
    return {
      operations: [],
      conflicts: ops.map(op => ({
        kind: limit === 'nodes'
          ? 'nodeLimit'
          : limit === 'depth'
            ? op.targetParentBlockId !== undefined && op.targetParentBlockId !== 'root' ? 'nestedTarget' : 'depth'
            : 'unresolved',
        blockId: op.blockId,
      })),
    }
  }
  interface Target { readonly op: PendingStructureOp; readonly nodeId: string; readonly sourceDigest: string; readonly parentKey: string; readonly index: number }
  const targets: Target[] = []
  for (const op of ops) {
    // Root-level fallback mode cannot address nested blocks or nested move
    // targets; report that precisely instead of a misleading "unresolved".
    if (!table.nested && (op.blockId.includes('.') || (op.targetParentBlockId !== undefined && op.targetParentBlockId !== 'root'))) {
      conflicts.push({ kind: 'nestedTarget', blockId: op.blockId })
      continue
    }
    const block = table.blocks.find(candidate => candidate.blockId === op.blockId)
    if (block?.nodeId === undefined || block.sourceDigest === undefined) { conflicts.push({ kind: 'unresolved', blockId: op.blockId }); continue }
    const parentKey = block.parentBlockId ?? 'root'
    const siblings = table.blocks.filter(candidate => (candidate.parentBlockId ?? 'root') === parentKey)
    const index = siblings.findIndex(candidate => candidate.blockId === block.blockId)
    targets.push({ op, nodeId: block.nodeId, sourceDigest: block.sourceDigest, parentKey, index })
  }
  const groups = new Map<string, Target[]>()
  for (const target of targets) {
    const group = groups.get(target.parentKey) ?? []
    group.push(target)
    groups.set(target.parentKey, group)
  }
  const operations: DeterministicOperation[] = []
  for (const [parentKey, group] of groups) {
    if (group.length > 1) {
      const kinds = new Set(group.map(target => target.op.op))
      if (kinds.size > 1) { conflicts.push({ kind: 'order', detail: parentKey }); continue }
      if (kinds.has('move')) { conflicts.push({ kind: 'order', detail: parentKey }); continue }
    }
    const ordered = [...group].sort((left, right) => right.index - left.index)
    for (const target of ordered) {
      if (target.op.op === 'move') {
        const targetParentNodeId = target.op.targetParentBlockId === undefined || target.op.targetParentBlockId === 'root'
          ? table.rootNodeId
          : table.blocks.find(candidate => candidate.blockId === target.op.targetParentBlockId)?.nodeId
        if (targetParentNodeId === undefined) { conflicts.push({ kind: 'unresolved', blockId: target.op.blockId }); continue }
        const targetParentKey = target.op.targetParentBlockId ?? 'root'
        const targetChildCount = targetParentKey === 'root'
          ? table.blocks.filter(candidate => candidate.parentBlockId === undefined).length
          : table.blocks.filter(candidate => candidate.parentBlockId === targetParentKey).length
        // A move inside the current parent appends after the moved block is
        // removed, so the Host validates toIndex against count-1 and requires
        // the redundant toParentNodeId to be omitted.
        const sameParent = target.parentKey === targetParentKey
        const toIndex = targetChildCount - (sameParent ? 1 : 0)
        operations.push(sameParent
          ? { op: 'move', nodeId: target.nodeId, sourceDigest: target.sourceDigest, toIndex }
          : { op: 'move', nodeId: target.nodeId, sourceDigest: target.sourceDigest, toParentNodeId: targetParentNodeId, toIndex })
        continue
      }
      operations.push(target.op.op === 'duplicate'
        ? { op: 'duplicate', nodeId: target.nodeId, sourceDigest: target.sourceDigest, toIndex: target.index + 1 }
        : { op: 'delete', nodeId: target.nodeId, sourceDigest: target.sourceDigest })
    }
  }
  return { operations, conflicts }
}

/** Resolve queued display operations into one atomic Host batch. */
function pendingWireOperations(session: ArtifactEditSession): { readonly operations: readonly DeterministicOperation[]; readonly conflicts: PendingApplyConflict[] } {
  const blocks = nestedBlocksForProgram(session.program)?.blocks ?? session.blocks
  const conflicts: PendingApplyConflict[] = [...detectPendingConflicts({
    ops: pendingStructureOpsFor(session),
    blocks,
    selection: session.selection,
    additions: session.additions,
    styleInstruction: session.styleInstruction,
  })]
  const resolved = resolvePendingStructureOperations(session.program, pendingStructureOpsFor(session))
  conflicts.push(...resolved.conflicts)
  return { operations: resolved.operations, conflicts }
}

/** Display blocks of one program for cross-revision mapping. */
function remapBlocksOf(program: string): readonly RemapBlock[] {
  return (nestedBlocksForProgram(program)?.blocks ?? blocksForProgram(program).blocks) as readonly RemapBlock[]
}

/** Conflicts that block Apply because saved draft references cannot be remapped. */
function remapConflictsFor(session: ArtifactEditSession, afterProgram: string): PendingApplyConflict[] {
  return validateStructureRemap({
    oldBlocks: remapBlocksOf(session.program),
    newBlocks: remapBlocksOf(afterProgram),
    ops: pendingStructureOpsFor(session),
    selection: session.selection,
    additions: session.additions,
    nestedOrder: session.nestedOrder,
  })
}

/** Fetch one authoritative structure dry-run for the preview dialog (no revision). */
async function fetchStructureDryRun(
  session: ArtifactEditSession,
  operations: readonly DeterministicOperation[],
): Promise<{ readonly ok: true; readonly program: string; readonly changedBlockIds: readonly string[] } | { readonly ok: false; readonly message: string }> {
  await ensureBaseForSession(session)
  try {
    const response = await fetch(ARTIFACT_STRUCTURE_ROUTE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        artifactId: session.artifactId,
        baseRevisionId: session.baseRevisionId,
        operationId: newRequestId(),
        operations,
        preview: true,
        ...session.branch === true ? { branch: true } : {},
        ...session.title === undefined ? {} : { title: session.title },
        style: session.style,
        ...session.styleId === undefined ? {} : { styleId: session.styleId },
        ...session.temporaryStyle === undefined ? {} : { temporaryStyle: session.temporaryStyle },
      }),
    })
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const code = failureCodeOf(value)
      invalidateBaseAfterMiss(session, code)
      return { ok: false, message: structureFailureMessage({ code, surface: 'structure', failureKey: 'edit.structureFailed' }) }
    }
    if (!isArtifactStructurePreview(value)) return { ok: false, message: translate('edit.structureFailed') }
    return { ok: true, program: value.preview.program, changedBlockIds: value.preview.changedBlockIds }
  } catch {
    return { ok: false, message: translate('edit.structureFailed') }
  }
}

/**
 * Preview generation per draft.
 *
 * A preview that is cancelled (or restarted) while its dry-run is in flight must
 * not reopen the dialog when the late answer lands: every request captures the
 * current generation and is allowed to write state only when it is still the
 * newest one for that key.
 */
const previewGenerations = new Map<string, number>()

/** Bump and return the preview generation of one draft. */
function nextPreviewGeneration(key: string): number {
  const generation = (previewGenerations.get(key) ?? 0) + 1
  previewGenerations.set(key, generation)
  return generation
}

/** Whether one captured generation is still the newest for its draft. */
function previewGenerationCurrent(key: string, generation: number): boolean {
  return previewGenerations.get(key) === generation && sessions.has(key)
}

/**
 * Build the total Apply preview: queued structure operations, their dry-run
 * diff, the model-request summary and every blocking conflict.
 *
 * The model-side contract checks run even with zero queued operations, so the
 * dialog can disable confirm for a request the send codec would refuse
 * (style/block mix, empty instruction, temporary-style order-only, stale base).
 * @param key - edit-session key.
 * @returns the preview state stored on the session (also returned for the caller).
 */
export async function previewPendingStructureOps(key: string): Promise<ApplyPreviewState | undefined> {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted') return undefined
  const generation = nextPreviewGeneration(key)
  const ops = pendingStructureOpsFor(session)
  const model = modelSummaryOf(session)
  const previewOps = pendingOpPreviews(session)
  const modelConflicts = modelRequestConflicts(session)
  if (ops.length === 0) {
    // A model-only round still has to know whether the base moved. The store may
    // not have observed the head advancement yet, so probe it here (read-only)
    // and fold a stale conflict into the preview instead of letting the user
    // confirm against an outdated revision.
    const probe = await probeRevision(session)
    if (!previewGenerationCurrent(key, generation)) return undefined
    const current = sessions.get(key)
    if (current === undefined) return undefined
    if (pendingStructureOpsFor(current).length > 0) {
      // The user queued a structure operation while the probe was in flight;
      // preview the queue that exists now instead of confirming an empty round.
      return previewPendingStructureOps(key)
    }
    let status = current.status
    let latestRevision = current.latestRevision
    if (probe.result === 'conflict' && current.branch !== true) {
      status = 'conflict'
      latestRevision = probe.latestRevision ?? latestRevision
    } else if (probe.result === 'ok' && (current.status === 'checking' || current.status === 'conflict' || current.status === 'error')) {
      status = 'ready'
      latestRevision = probe.latestRevision ?? latestRevision
    }
    const probed: ArtifactEditSession = { ...current, status, ...latestRevision === undefined ? {} : { latestRevision } }
    const conflicts = modelRequestConflicts(probed)
    const state: ApplyPreviewState = { status: 'ready', ops: [], model: modelSummaryOf(probed), conflicts, structureReady: true }
    sessions.set(key, { ...probed, applyPreview: state })
    publish()
    return state
  }
  const built = pendingWireOperations(session)
  const structureConflicts = [...built.conflicts]
  const loading: ApplyPreviewState = {
    status: 'loading',
    ops: previewOps,
    model,
    conflicts: [...modelConflicts, ...structureConflicts],
    structureReady: structureConflicts.length === 0,
  }
  sessions.set(key, { ...session, applyPreview: loading })
  publish()
  if (structureConflicts.length > 0) {
    const state: ApplyPreviewState = { ...loading, status: 'ready' }
    sessions.set(key, { ...sessions.get(key) ?? session, applyPreview: state })
    publish()
    return state
  }
  const dryRun = await fetchStructureDryRun(session, built.operations)
  if (!previewGenerationCurrent(key, generation)) return undefined
  const current = sessions.get(key)
  if (current === undefined) return undefined
  const remapConflicts = dryRun.ok ? remapConflictsFor(current, dryRun.program) : []
  const structureReady = dryRun.ok && built.conflicts.length === 0 && remapConflicts.length === 0
  const conflicts = [...modelConflicts, ...built.conflicts, ...remapConflicts]
  const state: ApplyPreviewState = dryRun.ok
    ? { status: 'ready', ops: previewOps, model, conflicts, structureReady, afterProgram: dryRun.program, changedBlockIds: dryRun.changedBlockIds, diff: diffProgramLines(current.program, dryRun.program) }
    : { status: 'failed', ops: previewOps, model, conflicts: [...modelConflicts, ...built.conflicts], structureReady: true, error: dryRun.message }
  sessions.set(key, { ...current, applyPreview: state, structureError: undefined })
  publish()
  return state
}

/** Close the total Apply preview without applying anything. */
export function cancelApplyPreview(key: string): void {
  // Invalidate any in-flight dry-run first: its answer must not reopen the dialog.
  nextPreviewGeneration(key)
  const session = sessions.get(key)
  if (session === undefined || session.applyPreview === undefined) return
  sessions.set(key, { ...session, applyPreview: undefined })
  publish()
}

/**
 * Record what happened to the model request after a structural Apply. The
 * draft has already been rekeyed, so the notice is stored on the new session
 * and survives the card swap that the new revision triggers.
 * @param key - edit-session key (the rekeyed draft).
 * @param outcome - auto-submit result.
 */
export function noteArtifactApplyOutcome(key: string, outcome: ApplyOutcomeNotice): void {
  const session = sessions.get(key)
  if (session === undefined || session.applyNotice === outcome) return
  sessions.set(key, { ...session, applyNotice: outcome })
  publish()
}

/** Locale key of one post-Apply notice. */
export function applyNoticeLocaleKey(notice: ApplyOutcomeNotice): string {
  switch (notice) {
    case 'submitted': return 'edit.applyNotice.submitted'
    case 'manual': return 'edit.applyNotice.manual'
    case 'extraText': return 'edit.applyNotice.extraText'
    case 'detached': return 'edit.applyNotice.detached'
    case 'rebaseFailed': return 'edit.applyNotice.rebaseFailed'
  }
}

/** Localized copy of one post-Apply notice. */
export function applyNoticeMessage(notice: ApplyOutcomeNotice): string {
  return translate(applyNoticeLocaleKey(notice))
}

/**
 * Post-Apply notices waiting for one chat.
 *
 * These are chat-scoped on purpose: an Apply (or a quick-props revision) can
 * consume the draft that owned the mounted panel, so the notice must render on
 * a surface that survives the card swap instead of only inside the old panel.
 * @param sessionId - chat session whose notices are listed.
 * @returns draft key plus notice, in store order.
 */
export function artifactApplyNotices(sessionId: string): { readonly key: string; readonly notice: ApplyOutcomeNotice }[] {
  const notices: { key: string; notice: ApplyOutcomeNotice }[] = []
  for (const [key, session] of sessions) {
    if (session.sessionId !== sessionId || session.applyNotice === undefined) continue
    notices.push({ key, notice: session.applyNotice })
  }
  return notices
}

/** Dismiss the post-Apply notice of one draft. */
export function dismissArtifactApplyNotice(key: string): void {
  const session = sessions.get(key)
  if (session === undefined || session.applyNotice === undefined) return
  sessions.set(key, { ...session, applyNotice: undefined })
  publish()
}

/**
 * Result of moving a draft onto a new structure revision.
 *
 * Failures are explicit so every caller has to decide what happens to the
 * recorded revision and the old draft: a structure Apply keeps the queue and
 * reports a conflict, a quick-props revision keeps the draft on its old base and
 * shows a dismissible notice instead of silently leaving a stale canvas.
 */
export type RebaseResult =
  | {
      readonly ok: true
      readonly key: string
      readonly referenceId: string
      readonly session: ArtifactEditSession
    }
  | { readonly ok: false; readonly reason: 'mapping' | 'queue' }

/**
 * Move one draft onto the revision a structure batch produced.
 *
 * New session/reference/chip are established first, then the old draft is
 * removed (session, reference, persisted record, chip). That order guarantees
 * the composer never shows a chip pointing at a deleted draft, which the
 * auto-submit probe relies on.
 * @param oldKey - draft key before the batch.
 * @param oldSession - draft snapshot before the batch.
 * @param result - authoritative structure result.
 * @param appliedOps - queued operations that produced the revision, or
 *   `undefined` when the revision came from another route (quick props) and the
 *   queued operations must be carried over (remapped) instead of consumed.
 * @returns the new key/reference/session, or the reason the draft cannot move.
 */
function rebaseDraftAfterStructure(
  oldKey: string,
  oldSession: ArtifactEditSession,
  result: ArtifactStructureResult,
  appliedOps: readonly PendingStructureOp[] | undefined,
): RebaseResult {
  const rootExtraction = blocksForProgram(result.program)
  const wrappedProgram = wrapProgramForBlockEditing(result.program, rootExtraction)
  const nested = nestedBlocksForProgram(result.program)
  const oldBlocks = nestedBlocksForProgram(oldSession.program)?.blocks ?? oldSession.blocks
  const newBlocks = nested?.blocks ?? rootExtraction.blocks
  const mapping = mapOldToNewBlocks(oldBlocks, newBlocks, appliedOps ?? [])
  // Never drop a saved request/addition because the post-batch structure cannot
  // be paired: the caller keeps the old draft and reports the conflict instead.
  if (appliedOps !== undefined && (remapConflictsFor(oldSession, result.program).length > 0 || !mapping.reliable)) {
    return { ok: false, reason: 'mapping' }
  }
  if (appliedOps === undefined) {
    // Quick-props revisions keep the queue; every queued op must remap cleanly.
    const queueMapped = pendingStructureOpsFor(oldSession).every(op => mapping.mapping.has(op.blockId)
      && (op.targetParentBlockId === undefined || op.targetParentBlockId === 'root' || mapping.mapping.has(op.targetParentBlockId)))
    if (!mapping.reliable) return { ok: false, reason: 'mapping' }
    if (!queueMapped) return { ok: false, reason: 'queue' }
  }
  // Nested mode owns its own authoritative block table: the display map of the
  // resulting program, not the root-level extraction. Keeping the root table
  // would drop every nested child from `blocks`, so a remapped nested selection
  // could no longer resolve its node identity and the nested UI would vanish.
  const nestedMode = oldSession.nestedMode === true && nested !== undefined
  const blocks = nestedMode && nested !== undefined ? nested.blocks : rootExtraction.blocks
  const selection = remapSelection(oldSession.selection, mapping.mapping).selection
  const additions = remapAdditions(oldSession.additions ?? [], mapping.mapping).additions
  // Invariant of a usable draft: every remapped saved reference must resolve to
  // a block of the new authoritative table. Otherwise the request could not carry
  // its node identity (missing nested table) and Apply must not create it.
  const newBlockIds = new Set(blocks.map(block => block.blockId))
  if (selection.some(entry => !newBlockIds.has(entry.blockId))
    || additions.some(addition => !newBlockIds.has(addition.parentBlockId))) {
    return { ok: false, reason: 'mapping' }
  }
  const rootIds = rootExtraction.blocks.map(block => block.blockId)
  const target = remapTargetOrder(oldSession.targetOrder, mapping.mapping, rootExtraction.blocks)
  const nestedState = remapNestedOrder({ nestedOrder: oldSession.nestedOrder, mapping: mapping.mapping, newBlocks: blocks })
  // The pending nested order must cover every parent container, changed or not:
  // the panel reads it as the authoritative order and a missing group would make
  // unchanged children unreachable. Changed groups overlay the rebuilt base.
  const nestedOrder = nestedMode
    ? Object.fromEntries(Object.entries(nestedState.nestedOriginalOrder).map(([parent, ids]) => [parent, [...(nestedState.nestedOrder[parent] ?? ids)]]))
    : undefined
  const nestedOrderChanged = nestedOrder !== undefined && nestedOrdersDiffer(nestedOrder, nestedState.nestedOriginalOrder)
  // A consumed Apply round never replays its operations. A quick-props revision
  // is a different route: the queue is still pending, so remap it onto the new
  // block ids instead of dropping it.
  const pendingOps: PendingStructureOp[] = appliedOps !== undefined
    ? []
    : pendingStructureOpsFor(oldSession).flatMap(op => {
        const blockId = mapping.mapping.get(op.blockId)
        if (blockId === undefined) return []
        const targetParentBlockId = op.targetParentBlockId === undefined || op.targetParentBlockId === 'root'
          ? op.targetParentBlockId
          : mapping.mapping.get(op.targetParentBlockId)
        return [{
          id: op.id,
          op: op.op,
          blockId,
          ...targetParentBlockId === undefined ? {} : { targetParentBlockId },
          createdAt: op.createdAt,
        }]
      })
  const key = editKey(oldSession.sessionId, result.revisionId)
  const reference = referenceForSession(key)
  // The user's attachment decision survives the rebase: a detached draft stays
  // out of the next Send (no re-inserted chip, no auto-submit), and an attached
  // one must still fit the batch cap before its chip is inserted.
  const attached = oldSession.attached === true
    && attachedDraftCount(oldSession.sessionId, oldKey) < MAX_ARTIFACT_BATCH_REQUESTS
  const next: ArtifactEditSession = {
    key,
    sessionId: oldSession.sessionId,
    artifactId: result.artifactId,
    baseRevisionId: result.revisionId,
    baseRevision: result.revision,
    requestId: newRequestId(),
    attached,
    branch: oldSession.branch ?? false,
    latestRevision: result.revision,
    ...(result.title ?? oldSession.title) === undefined ? {} : { title: result.title ?? oldSession.title },
    style: result.style,
    ...result.styleId === undefined ? {} : { styleId: result.styleId },
    ...result.temporaryStyle === undefined ? {} : { temporaryStyle: result.temporaryStyle },
    program: result.program,
    ...nestedMode ? { nestedMode: true as const } : {},
    ...oldSession.strict === true ? { strict: true as const } : {},
    ...wrappedProgram === undefined ? {} : { wrappedProgram },
    blocks,
    originalOrder: rootIds,
    targetOrder: target.targetOrder.length === 0 ? rootIds : [...target.targetOrder],
    orderChanged: target.targetOrder.length === 0 ? false : target.orderChanged,
    ...nestedOrder === undefined ? {} : { nestedOrder, nestedOriginalOrder: nestedState.nestedOriginalOrder, nestedOrderChanged },
    selection,
    ...additions.length === 0 ? {} : { additions },
    ...pendingOps.length === 0 ? {} : { pendingOps },
    globalInstruction: oldSession.globalInstruction,
    styleInstruction: oldSession.styleInstruction,
    editing: true,
    drawerOpen: false,
    status: 'ready',
    activeDraft: '',
    activeDirty: false,
  }
  sessions.set(key, next)
  if (bridge !== undefined && next.attached && hasArtifactEditContent(next)) {
    bridge.upsertChip(next.sessionId, reference, chipLabelForSession(next))
  }
  const oldReference = referenceOf(oldKey)
  sessions.delete(oldKey)
  references.delete(oldReference)
  removePersistedDraft(oldKey, oldSession.sessionId)
  if (bridge !== undefined) bridge.removeChip(oldSession.sessionId, oldReference)
  activeKeys.set(oldSession.sessionId, key)
  scheduleDraftPersist(key)
  publish()
  scheduleChipSync(oldSession.sessionId, true)
  return { ok: true, key, referenceId: reference, session: next }
}

/** One authoritative structure batch: request and validate without recording a revision. */
async function requestStructureOperation(
  session: ArtifactEditSession,
  operations: readonly DeterministicOperation[],
  failureKey: string,
  surface: 'structure' | 'props' = 'structure',
): Promise<{ readonly ok: true; readonly result: ArtifactStructureResult } | { readonly ok: false; readonly message: string; readonly code?: string; readonly fallback?: 'base_missing' | 'artifact_missing' }> {
  await ensureBaseForSession(session)
  try {
    const response = await fetch(ARTIFACT_STRUCTURE_ROUTE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        artifactId: session.artifactId,
        baseRevisionId: session.baseRevisionId,
        operationId: newRequestId(),
        operations,
        ...session.branch === true ? { branch: true } : {},
        ...session.title === undefined ? {} : { title: session.title },
        style: session.style,
        ...session.styleId === undefined ? {} : { styleId: session.styleId },
        ...session.temporaryStyle === undefined ? {} : { temporaryStyle: session.temporaryStyle },
      }),
    })
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined)
      const code = failureCodeOf(body)
      invalidateBaseAfterMiss(session, code)
      return {
        ok: false,
        message: structureFailureMessage({ code, surface, failureKey }),
        ...code === undefined ? {} : { code },
        ...surface === 'props' && propsFallbackFor(code) !== undefined ? { fallback: propsFallbackFor(code) } : {},
      }
    }
    const value: unknown = await response.json()
    if (value !== null && typeof value === 'object' && (value as { ok?: unknown }).ok === true) {
      const result = (value as { result?: unknown }).result
      if (isArtifactStructureResult(result)) return { ok: true, result }
    }
    return { ok: false, message: translate(failureKey) }
  } catch {
    return { ok: false, message: translate(failureKey) }
  }
}

/** Record one structure result as the local revision card of the current Turn. */
function recordStructureRevision(session: ArtifactEditSession, result: ArtifactStructureResult, turn: number | undefined, kind: 'structure' | 'props'): void {
  addLocalRevision(session.sessionId, {
    kind,
    artifactId: result.artifactId,
    sourceRevisionId: result.baseRevisionId,
    revisionId: result.revisionId,
    revision: result.revision,
    program: result.program,
    ...result.title === undefined ? {} : { title: result.title },
    style: result.style,
    ...result.styleId === undefined ? {} : { styleId: result.styleId },
    ...result.temporaryStyle === undefined ? {} : { temporaryStyle: result.temporaryStyle },
    ...turn === undefined ? {} : { turn },
    createdAt: Date.now(),
  })
}

/**
 * Apply the current edit round.
 * @param key - edit-session key.
 * @param turn - latest loaded Turn (places the local revision card).
 * @returns what the card should do next.
 */
export async function applyEditRound(key: string, turn?: number): Promise<ApplyRoundResult> {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted' || session.structureBusy === true) {
    return { status: 'error', error: translate('edit.structureFailed') }
  }
  const ops = pendingStructureOpsFor(session)
  // The model side is validated before any Host call, with the same checks the
  // send codec uses. A model-only round (zero queued operations) must not report
  // `needSend` for a draft that could never be serialized (style/block mix,
  // empty instruction, temporary-style order-only, stale head).
  const modelConflicts = modelRequestConflicts(session)
  if (ops.length === 0) {
    if (modelConflicts.length > 0) {
      const state: ApplyPreviewState = { status: 'ready', ops: [], model: modelSummaryOf(session), conflicts: modelConflicts, structureReady: true }
      sessions.set(key, { ...session, applyPreview: state })
      publish()
      return { status: 'error', conflicts: modelConflicts, error: modelConflictMessage(modelConflicts) }
    }
    if (!hasModelRequestContent(session)) return { status: 'done' }
    // Authoritative last check: an edit round may have been opened on a stale
    // base while the card's status was still settling, so never hand a doomed
    // request to the auto-submit probe.
    const probe = await probeRevision(session)
    if (probe.result === 'conflict' && session.branch !== true) {
      const current = sessions.get(key) ?? session
      sessions.set(key, { ...current, status: 'conflict', latestRevision: probe.latestRevision ?? current.latestRevision })
      publish()
      return { status: 'error', error: translate('edit.conflictSend'), conflicts: [{ kind: 'stale' }] }
    }
    // No structure revision is produced, so the draft keeps its key and chip;
    // the card only needs the reference to auto-submit the model request.
    return { status: 'needSend', newKey: key, referenceId: referenceForSession(key) }
  }
  const built = pendingWireOperations(session)
  const applyConflicts = [...modelConflicts, ...built.conflicts]
  if (applyConflicts.length > 0) {
    const state: ApplyPreviewState = { status: 'ready', ops: pendingOpPreviews(session), model: modelSummaryOf(session), conflicts: applyConflicts, structureReady: built.conflicts.length === 0 }
    sessions.set(key, { ...sessions.get(key) ?? session, applyPreview: state })
    publish()
    return { status: 'error', conflicts: applyConflicts, ...modelConflicts.length === 0 ? {} : { error: modelConflictMessage(modelConflicts) } }
  }
  // A total preview the user just confirmed already carries the authoritative
  // dry-run program; capture it before clearing the dialog state below, then
  // reuse it as the preflight so the dialog + Apply does not charge the Host a
  // second dry-run. The queue identity is re-checked below against the current
  // pending ops, so a preview that no longer matches is never trusted.
  const currentPreview = session.applyPreview
  sessions.set(key, { ...session, structureBusy: true, structureError: undefined, applyPreview: undefined })
  publish()
  const previewMatchesQueue = currentPreview?.status === 'ready'
    && currentPreview.structureReady
    && currentPreview.afterProgram !== undefined
    && currentPreview.ops.length === ops.length
    && currentPreview.ops.every((op, index) => op.id === ops[index].id)
  const preflight = previewMatchesQueue
    ? { ok: true as const, program: currentPreview.afterProgram as string, changedBlockIds: currentPreview.changedBlockIds ?? [] }
    : await fetchStructureDryRun(session, built.operations)
  if (!preflight.ok) {
    const current = sessions.get(key)
    if (current !== undefined) {
      sessions.set(key, { ...current, structureBusy: false, structureError: preflight.message })
      publish()
    }
    return { status: 'error', error: preflight.message }
  }
  const preflightConflicts = [...built.conflicts, ...remapConflictsFor(sessions.get(key) ?? session, preflight.program)]
  if (preflightConflicts.length > 0) {
    const current = sessions.get(key) ?? session
    const state: ApplyPreviewState = { status: 'ready', ops: pendingOpPreviews(current), model: modelSummaryOf(current), conflicts: preflightConflicts, structureReady: false, afterProgram: preflight.program, changedBlockIds: preflight.changedBlockIds, diff: diffProgramLines(current.program, preflight.program) }
    sessions.set(key, { ...current, structureBusy: false, applyPreview: state })
    publish()
    return { status: 'error', conflicts: preflightConflicts }
  }
  const outcome = await requestStructureOperation(session, built.operations, 'edit.structureFailed')
  if (!outcome.ok) {
    const current = sessions.get(key)
    if (current !== undefined) {
      sessions.set(key, { ...current, structureBusy: false, structureError: outcome.message })
      publish()
    }
    return { status: 'error', error: outcome.message }
  }
  const current = sessions.get(key)
  if (current === undefined) return { status: 'error', error: translate('edit.structureFailed') }
  const rebased = rebaseDraftAfterStructure(key, current, outcome.result, ops)
  if (!rebased.ok) {
    // The Host result disagreed with the preflight; keep the draft/queue and
    // surface the conflict instead of writing a half-mapped request.
    const latest = sessions.get(key) ?? current
    sessions.set(key, { ...latest, structureBusy: false, structureError: translate('edit.mappingBlocked') })
    publish()
    return { status: 'error', error: translate('edit.mappingBlocked') }
  }
  recordStructureRevision(session, outcome.result, turn, 'structure')
  if (hasModelRequestContent(rebased.session)) return { status: 'needSend', newKey: rebased.key, referenceId: rebased.referenceId }
  markSubmitted(rebased.key)
  return { status: 'done', newKey: rebased.key, referenceId: rebased.referenceId }
}

/** One structural block whose properties the quick adjust controls can rewrite. */
export interface BlockPropsState {
  readonly blockId: string
  readonly nodeId: string
  readonly sourceDigest: string
  readonly componentType: 'Divider' | 'Spacer'
  readonly props: ArtifactBlockProps
  /** Whether the current props are fully expressible in the quick-adjust UI. */
  readonly support: ArtifactBlockPropsSupport
}

/**
 * Resolve the CST node behind one display block id using the same block table
 * the canvas uses for the current mode:
 *
 * - top level: `block.rootIndex` addresses the root `Col` child directly, so
 *   shared/opaque siblings cannot shift the identity (unlike the nested map);
 * - nested mode: the nested display map is authoritative for both the canvas
 *   and the panel, so its node id is used unchanged.
 *
 * @param session - edit session snapshot.
 * @param tree - CST tree of the session program.
 * @param blockId - display block id.
 * @returns the CST node, or undefined when unavailable.
 */
function blockNodeForId(session: ArtifactEditSession, tree: ReturnType<typeof buildArtifactTree>, blockId: string) {
  if (session.nestedMode === true) {
    const nested = nestedBlocksForProgram(session.program)
    const block = nested?.blocks.find(candidate => candidate.blockId === blockId)
    return block?.nodeId === undefined ? undefined : tree.nodes.get(block.nodeId)
  }
  const block = session.blocks.find(candidate => candidate.blockId === blockId)
  if (block === undefined) return undefined
  for (const node of tree.nodes.values()) {
    if (node.parentNodeId === tree.rootNodeId && node.childIndex === block.rootIndex) return node
  }
  return undefined
}

/**
 * Resolve the CST identity, current properties and quick-adjust support of one
 * Divider/Spacer block.
 * @param session - edit session snapshot.
 * @param blockId - display block id.
 * @returns the target, or undefined when the block is not a quick-adjustable
 *   Divider/Spacer, is shared/opaque/scoped, or the program cannot be parsed.
 */
export function blockPropsState(session: ArtifactEditSession, blockId: string): BlockPropsState | undefined {
  const tree = buildArtifactTree(session.program, { containerTypes: [...NESTED_CONTAINER_TYPES] })
  if (tree.problems.length > 0) return undefined
  const node = blockNodeForId(session, tree, blockId)
  if (node === undefined || !node.editable || node.shared || node.opaque || node.scoped) return undefined
  if (!isArtifactBlockPropComponent(node.componentType)) return undefined
  return {
    blockId,
    nodeId: node.nodeId,
    sourceDigest: node.digest,
    componentType: node.componentType,
    props: artifactBlockPropsFromNode(node.componentType, node.props),
    support: describeArtifactBlockPropsSupport(node.componentType, node.props),
  }
}

/**
 * Preview a property bag on the canvas without recording anything. The view
 * rewraps the rewritten program for the edit-mode renderer.
 * @param key - edit-session key.
 * @param blockId - display block id.
 * @param props - the pending property bag.
 */
export function previewArtifactBlockProps(key: string, blockId: string, props: ArtifactBlockProps): void {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted' || session.propsBusy === true) return
  const target = blockPropsState(session, blockId)
  if (target === undefined || !target.support.ok) {
    sessions.set(key, { ...session, propsPreview: undefined, propsError: translate('edit.propsFailed') })
    publish()
    return
  }
  const problem = describeArtifactBlockPropsProblem(target.componentType, props)
  if (problem !== undefined) {
    sessions.set(key, { ...session, propsPreview: undefined, propsError: translate('edit.propsFailed') })
    publish()
    return
  }
  const replaced = replaceNodeContent(session.program, target.nodeId, serializeArtifactBlockProps(target.componentType, props), {
    containerTypes: [...NESTED_CONTAINER_TYPES],
  })
  if (replaced.ok === false) {
    sessions.set(key, { ...session, propsPreview: undefined, propsError: translate('edit.propsFailed') })
    publish()
    return
  }
  const preview: ArtifactBlockPropsPreview = {
    blockId,
    nodeId: target.nodeId,
    componentType: target.componentType,
    props,
    program: replaced.program,
  }
  sessions.set(key, { ...session, propsPreview: preview, propsError: undefined })
  publish()
}

/** Drop the canvas-only property preview (cancel, close, switch target). */
export function clearArtifactBlockPropsPreview(key: string): void {
  const session = sessions.get(key)
  if (session === undefined || session.propsPreview === undefined) return
  sessions.set(key, { ...session, propsPreview: undefined, propsError: undefined })
  publish()
}

/**
 * Apply one Divider/Spacer property bag through the deterministic Host route.
 * Pending block instructions or reordering must be sent or cleared first, since
 * this route records a revision of its own and the canvas closes afterwards.
 * @param key - edit-session key.
 * @param blockId - display block id.
 * @param props - the property bag to persist.
 * @param turn - latest loaded Turn, used to place the local revision card.
 */
export async function applyArtifactBlockProps(key: string, blockId: string, props: ArtifactBlockProps, turn?: number): Promise<void> {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted' || session.propsBusy === true) return
  const target = blockPropsState(session, blockId)
  if (target === undefined || !target.support.ok) {
    sessions.set(key, { ...session, propsError: translate('edit.propsFailed') })
    publish()
    return
  }
  const problem = describeArtifactBlockPropsProblem(target.componentType, props)
  if (problem !== undefined) {
    sessions.set(key, { ...session, propsError: translate('edit.propsFailed') })
    publish()
    return
  }
  if (serializeArtifactBlockProps(target.componentType, target.props) === serializeArtifactBlockProps(target.componentType, props)) {
    sessions.set(key, { ...session, propsPreview: undefined, propsError: translate('edit.propsNoChange') })
    publish()
    return
  }
  sessions.set(key, { ...session, propsPreview: undefined, propsError: undefined, propsBusy: true })
  publish()
  try {
    const outcome = await requestStructureOperation(session, [{
      op: 'props',
      nodeId: target.nodeId,
      sourceDigest: target.sourceDigest,
      props,
    }], 'edit.propsFailed', 'props')
    if (!outcome.ok) {
      const current = sessions.get(key)
      if (current !== undefined) {
        sessions.set(key, {
          ...current,
          propsBusy: false,
          ...outcome.fallback === undefined ? {} : { propsFallback: outcome.fallback },
          propsError: outcome.message,
        })
        publish()
      }
      return
    }
    // The revision is authoritative now; keep every saved request by moving the
    // draft onto it instead of dropping the draft (task-11). The queue is not
    // consumed by a props revision, so its operations are remapped, not dropped.
    recordStructureRevision(session, outcome.result, turn, 'props')
    const current = sessions.get(key) ?? session
    if (hasModelRequestContent(current) || pendingStructureOpsFor(current).length > 0) {
      const rebased = rebaseDraftAfterStructure(key, current, outcome.result, undefined)
      if (!rebased.ok) {
        // The revision is recorded, but the saved draft cannot move onto it. Keep
        // the draft/chip on the old revision and explain it; silently leaving the
        // canvas on a stale base would make the next request fail without context.
        noteArtifactApplyOutcome(key, 'rebaseFailed')
      }
    } else {
      markSubmitted(key)
    }
  } finally {
    const current = sessions.get(key)
    if (current !== undefined && current.status !== 'submitted' && current.propsBusy === true) {
      sessions.set(key, { ...current, propsBusy: false })
      publish()
    }
  }
}

type DeterministicOperation =
  | { op: 'delete' | 'duplicate' | 'move'; nodeId: string; sourceDigest: string; toIndex?: number; toParentNodeId?: string }
  | { op: 'props'; nodeId: string; sourceDigest: string; props: ArtifactBlockProps }

/**
 * Whether one deterministic style target is already the revision's identity.
 *
 * Mirrors the Host's no-op rule: a temporary skin never matches a durable
 * target (a switch drops it), a built-in target matches only a revision without
 * a saved template, and a template target matches the recorded styleId.
 * @param session - draft holding the base revision's recorded style identity.
 * @param target - candidate durable target.
 * @returns true when applying the target would record no change.
 */
export function isCurrentStyleTarget(
  session: Pick<ArtifactEditSession, 'style' | 'styleId' | 'temporaryStyle'>,
  target: ArtifactStyleTarget,
  templateLayout?: 'card' | 'article' | 'free',
): boolean {
  if (session.temporaryStyle !== undefined) return false
  if (target.kind === 'builtin') return session.styleId === undefined && session.style === target.layout
  // The Host compares the target's resolved layout AND styleId, not the id alone.
  return session.styleId === target.styleId && (templateLayout === undefined || session.style === templateLayout)
}

/** Whether two switch selections name the same built-in/template identity. */
function sameArtifactStyleTarget(
  left: ArtifactStyleTarget | undefined,
  leftLayout: 'card' | 'article' | 'free' | undefined,
  right: ArtifactStyleTarget | undefined,
  rightLayout: 'card' | 'article' | 'free' | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  if (leftLayout !== rightLayout) return false
  return left.kind === 'builtin'
    ? right.kind === 'builtin' && left.layout === right.layout
    : right.kind === 'template' && left.styleId === right.styleId
}

/**
 * Select (or clear) the pending deterministic style switch target of one draft.
 * Selection only moves the picker; the request is sent on the explicit Apply.
 * @param key - edit-session key.
 * @param target - durable target, or undefined to clear the selection.
 */
export function setArtifactStyleSwitchTarget(
  key: string,
  target: ArtifactStyleTarget | undefined,
  layout?: 'card' | 'article' | 'free',
): void {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted' || session.styleSwitchBusy === true) return
  if (target !== undefined && describeStyleTargetProblem(target) !== undefined) return
  const nextLayout = target === undefined ? undefined : layout
  if (session.styleSwitchTarget === target && session.styleSwitchTargetLayout === nextLayout && session.styleSwitchError === undefined) return
  const targetChanged = session.styleSwitchTarget === undefined || nextLayout === undefined
    || !sameArtifactStyleTarget(session.styleSwitchTarget, session.styleSwitchTargetLayout, target, nextLayout)
  sessions.set(key, {
    ...session,
    styleSwitchTarget: target,
    styleSwitchTargetLayout: nextLayout,
    styleSwitchError: undefined,
    ...targetChanged ? { styleSwitchOperationId: undefined } : {},
  })
  publish()
}

/** Localized message for one deterministic style switch failure code. */
function styleSwitchFailureMessage(code: string | undefined): string {
  switch (code) {
    case 'style_missing': return translate('edit.styleSwitchMissing')
    case 'article_unavailable': return translate('edit.styleSwitchArticle')
    case 'base_not_latest': return translate('edit.styleSwitchStale')
    case 'base_style_mismatch': return translate('edit.styleSwitchMismatch')
    case 'no_change': return translate('edit.styleSwitchNoChange')
    case 'artifact_missing': return translate('edit.propsMissingArtifact')
    case 'base_missing': return translate('edit.propsNoBase')
    default: return translate('edit.styleSwitchFailed')
  }
}

/**
 * Apply the selected deterministic style switch through the Host's structure
 * route: zero model turn, the same program, and a new recorded style identity.
 *
 * Dirty drafts are refused before any request (block edits and a style switch
 * cannot be combined in one revision). Success adds a local revision card of
 * kind `style` in the current Turn and consumes the draft.
 * @param key - edit-session key.
 * @param turn - latest loaded Turn, used to place the local card.
 * @param onMissingStyle - catalog refresh hook for a `style_missing` answer.
 */
export async function applyArtifactStyleSwitch(
  key: string,
  turn?: number,
  onMissingStyle?: () => void,
): Promise<void> {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted' || session.styleSwitchBusy === true) return
  const chosen = session.styleSwitchTarget
  if (chosen === undefined || describeStyleTargetProblem(chosen) !== undefined) return
  const fail = (message: string, keepOperationId = false): void => {
    const current = sessions.get(key)
    if (current === undefined) return
    sessions.set(key, {
      ...current,
      styleSwitchBusy: false,
      styleSwitchError: message,
      ...keepOperationId ? {} : { styleSwitchOperationId: undefined },
    })
    publish()
  }
  // The edit canvas shows the older-revision banner; an explicit branch is the
  // only path that may record on top of an old base. Skip the request otherwise.
  if (session.status === 'conflict' && session.branch !== true) {
    fail(translate('edit.styleSwitchStale'))
    return
  }
  const chosenLayout = chosen.kind === 'builtin' ? chosen.layout : session.styleSwitchTargetLayout
  if (chosen.kind === 'template' && chosenLayout === undefined) {
    fail(translate('edit.styleSwitchFailed'))
    return
  }
  if (chosenLayout === 'article' && describeArticleLayoutProblem(session.program) !== undefined) {
    fail(translate('edit.styleSwitchArticle'))
    return
  }
  if (hasArtifactEditContent(session) || session.activeDirty === true || session.activeDraft.trim() !== '') {
    fail(translate('edit.styleSwitchDirty'))
    return
  }
  if (isCurrentStyleTarget(session, chosen, session.styleSwitchTargetLayout)) {
    fail(translate('edit.styleSwitchNoChange'))
    return
  }
  // Reuse the operation id after a lost response: the Host idempotency ledger
  // returns the recorded result instead of turning the retry into base_not_latest.
  const operationId = session.styleSwitchOperationId ?? newRequestId()
  sessions.set(key, { ...session, styleSwitchBusy: true, styleSwitchError: undefined, styleSwitchOperationId: operationId })
  publish()
  await ensureBaseForSession(session)
  try {
    const response = await fetch(ARTIFACT_STRUCTURE_ROUTE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        artifactId: session.artifactId,
        baseRevisionId: session.baseRevisionId,
        operationId,
        operations: [],
        targetStyle: chosen,
        sessionStyleScope: session.sessionId,
        ...session.branch === true ? { branch: true } : {},
        ...session.title === undefined ? {} : { title: session.title },
        style: session.style,
        ...session.styleId === undefined || session.temporaryStyle !== undefined ? {} : { styleId: session.styleId },
        ...session.temporaryStyle === undefined ? {} : { temporaryStyle: session.temporaryStyle },
      }),
    })
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined)
      const code = failureCodeOf(body)
      invalidateBaseAfterMiss(session, code)
      if (code === 'style_missing') {
        onMissingStyle?.()
        // The catalog is refreshing: drop the vanished selection so Apply is
        // not immediately repeatable against a style that no longer exists.
        const current = sessions.get(key)
        if (current !== undefined) {
          sessions.set(key, { ...current, styleSwitchTarget: undefined, styleSwitchTargetLayout: undefined })
        }
      }
      // A late stale answer must enter the same visual state as a pre-known
      // stale base; otherwise the single status line still says "ready" while
      // the error below it says the base is no longer latest.
      if (code === 'base_not_latest' && session.branch !== true) {
        const current = sessions.get(key)
        if (current !== undefined) sessions.set(key, { ...current, status: 'conflict' })
      }
      fail(styleSwitchFailureMessage(code), code === undefined)
      return
    }
    const value: unknown = await response.json()
    const result = value !== null && typeof value === 'object' && (value as { ok?: unknown }).ok === true
      ? (value as { result?: unknown }).result
      : undefined
    if (isArtifactStructureResult(result)) {
      addLocalRevision(session.sessionId, {
        kind: 'style',
        artifactId: result.artifactId,
        sourceRevisionId: result.baseRevisionId,
        revisionId: result.revisionId,
        revision: result.revision,
        program: result.program,
        ...result.title === undefined ? {} : { title: result.title },
        style: result.style,
        ...result.styleId === undefined ? {} : { styleId: result.styleId },
        ...result.temporaryStyle === undefined ? {} : { temporaryStyle: result.temporaryStyle },
        ...turn === undefined ? {} : { turn },
        createdAt: Date.now(),
      })
      const current = sessions.get(key)
      if (current !== undefined) sessions.set(key, { ...current, styleSwitchBusy: false })
      markSubmitted(key)
      return
    }
    fail(translate('edit.styleSwitchFailed'), true)
  } catch {
    fail(translate('edit.styleSwitchFailed'), true)
  }
}

/** Save (or replace) a model-generated addition for one nested container. */
export function saveArtifactBlockAddition(key: string, parentBlockId: string, instruction: string): void {
  const session = sessions.get(key)
  if (session === undefined || session.nestedMode !== true) return
  const text = instruction.trim()
  if (text === '' || text.length > MAX_BLOCK_INSTRUCTION_CHARS) return
  const nested = nestedBlocksForProgram(session.program)
  const parent = nested?.blocks.find(block => block.blockId === parentBlockId)
  if (nested === undefined || parent === undefined) return
  if (!(NESTED_CONTAINER_TYPES as readonly string[]).includes(parent.componentType)) return
  const existing = session.additions ?? []
  const without = existing.filter(addition => addition.parentBlockId !== parentBlockId)
  if (without.length >= MAX_ARTIFACT_ADDITIONS) return
  sessions.set(key, { ...session, additions: [...without, { parentBlockId, instruction: text }] })
  publish()
  scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
}

/** Remove the pending addition of one nested container. */
export function removeArtifactBlockAddition(key: string, parentBlockId: string): void {
  const session = sessions.get(key)
  if (session === undefined || session.additions === undefined) return
  const next = session.additions.filter(addition => addition.parentBlockId !== parentBlockId)
  if (next.length === session.additions.length) return
  sessions.set(key, { ...session, additions: next.length === 0 ? undefined : next })
  publish()
  scheduleChipSync(session.sessionId, true)
  scheduleDraftPersist(key)
}

/** Open or close the narrow-viewport request drawer. */
export function setArtifactDrawerOpen(key: string, open: boolean): void {
  patch(key, session => session.drawerOpen === open ? undefined : { ...session, drawerOpen: open })
}

/** Re-run the revision probe after a conflict or error. */
export function retryArtifactRevisionCheck(key: string): void {
  patch(key, session => ({ ...session, status: 'checking', error: undefined }))
  checkRevision(key)
}

/**
 * Turn a conflicting draft into a branch edit based on its (older) revision.
 *
 * Only a draft that is actually blocked by a conflict can branch, and the
 * latest revision number must be known so the banner can name the head. The
 * status becomes ready again and the composer chip gains the branch suffix;
 * sending is no longer blocked by a head mismatch because the Host records a
 * new revision instead of overwriting the head.
 * @param key - edit-session key.
 * @returns whether the draft switched to branch mode.
 */
export function enableBranch(key: string): boolean {
  const session = sessions.get(key)
  if (session === undefined || session.status !== 'conflict' || session.latestRevision === undefined) return false
  sessions.set(key, { ...session, branch: true, status: 'ready', error: undefined })
  publish()
  scheduleChipSync(session.sessionId, true)
  return true
}

/**
 * Silent revision probe for the edit view's polling (interval plus window
 * focus/visibility). Conservative by design: only a fresh `conflict` changes
 * state; an `ok` answer never auto-clears a conflict (the user retries
 * explicitly), and an unknown host/network answer is ignored. Submitted
 * sessions are skipped and the popover/active/draft state is left untouched.
 * @param key - edit-session key.
 */
export async function probeArtifactRevisionStatus(key: string): Promise<void> {
  const session = sessions.get(key)
  if (session === undefined || session.status === 'submitted') return
  const probe = await probeRevision(session)
  patch(key, current => {
    if (current.status === 'submitted') return undefined
    const latestRevision = probe.latestRevision ?? current.latestRevision
    // Only a conflict may change the status (and never auto-clears one); a
    // branch draft ignores conflicts because its old base is intentional.
    const status = probe.result === 'conflict' && current.branch !== true ? 'conflict' : current.status
    if (status === current.status && latestRevision === current.latestRevision) return undefined
    return { ...current, status, latestRevision }
  })
}

/** Mark a draft as sent: drop its chip, leave the canvas and free its batch slot. */
function markSubmitted(key: string): void {
  const session = sessions.get(key)
  if (session === undefined) return
  nextPreviewGeneration(key)
  sessions.set(key, {
    ...session,
    status: 'submitted',
    submittedAt: Date.now(),
    submitFailed: false,
    propsPreview: undefined,
    propsError: undefined,
    propsBusy: false,
    branch: false,
    editing: false,
    attached: false,
    activeBlockId: undefined,
    activeDraft: '',
    activeDirty: false,
    drawerOpen: false,
    styleSwitchTarget: undefined,
    styleSwitchTargetLayout: undefined,
    styleSwitchBusy: false,
    styleSwitchError: undefined,
  })
  if (activeKeys.get(session.sessionId) === key) activeKeys.delete(session.sessionId)
  pruneSubmitted(session.sessionId)
  publish()
  scheduleChipSync(session.sessionId, true)
}

/** Retain at most this many unresolved submitted drafts per chat. */
const MAX_SUBMITTED_DRAFTS = 12

/** Drop the oldest unresolved submitted drafts beyond the retention cap. */
function pruneSubmitted(sessionId: string): void {
  const submitted = [...sessions].filter(([, session]) =>
    session.sessionId === sessionId && session.status === 'submitted')
    .sort((a, b) => (a[1].submittedAt ?? 0) - (b[1].submittedAt ?? 0))
  const excess = submitted.slice(0, Math.max(0, submitted.length - MAX_SUBMITTED_DRAFTS))
  for (const [key] of excess) sessions.delete(key)
}

/** Request ids of submitted drafts that a later revision has not fulfilled yet. */
export function submittedDraftsFor(sessionId: string): { key: string; requestId: string; artifactId: string; baseRevisionId: string }[] {
  const pending: { key: string; requestId: string; artifactId: string; baseRevisionId: string }[] = []
  for (const [key, session] of sessions) {
    if (session.sessionId !== sessionId || session.status !== 'submitted') continue
    pending.push({ key, requestId: session.requestId, artifactId: session.artifactId, baseRevisionId: session.baseRevisionId })
  }
  return pending
}

/**
 * Reconcile the drafts submitted by one finished Turn with the revisions that
 * actually landed. Fulfilled drafts disappear; unfulfilled drafts return as
 * detached, editable drafts marked `submitFailed`, with a fresh request id so a
 * retry cannot collide with a stale pending request.
 * @param sessionId - chat session that owned the submitted drafts.
 * @param committedRequestIds - request ids of revisions in this Turn.
 * @returns number of restored drafts.
 */
export function reconcileArtifactSubmissions(
  sessionId: string,
  committedRequestIds: readonly string[],
  window: { since?: number; until?: number } = {},
): number {
  const committed = new Set(committedRequestIds)
  let restored = 0
  for (const [key, session] of [...sessions]) {
    if (session.sessionId !== sessionId || session.status !== 'submitted') continue
    // Only drafts submitted for the Turn being reconciled. Historical closed
    // Turns revisit the same store, so a time window keeps them from claiming a
    // newer submission.
    const submittedAt = session.submittedAt
    if (submittedAt === undefined) continue
    if (window.since !== undefined && submittedAt < window.since) continue
    if (window.until !== undefined && submittedAt > window.until) continue
    if (committed.has(session.requestId)) {
      sessions.delete(key)
      for (const [reference, referenceKey] of references) {
        if (referenceKey === key) references.delete(reference)
      }
      continue
    }
    sessions.set(key, {
      ...session,
      status: 'ready',
      submitFailed: true,
      attached: false,
      requestId: newRequestId(),
      submittedAt: undefined,
      editing: false,
      activeBlockId: undefined,
      activeDraft: '',
      activeDirty: false,
      drawerOpen: false,
    })
    scheduleDraftPersist(key)
    restored += 1
  }
  if (restored > 0 || committed.size > 0) {
    publish()
    scheduleChipSync(sessionId, true)
  }
  return restored
}

/** One draft's model-request envelope, or the local contract problem blocking it. */
type ModelRequestOutcome =
  | { readonly ok: true; readonly request: ArtifactEditRequest }
  | { readonly ok: false; readonly problem: 'empty' | 'empty_instruction' | 'invalid' | 'temporary_order' | 'style_mixed' | 'style_unsupported' }

/**
 * Build the model-request envelope of one draft without any side effect.
 *
 * This is the single contract check behind the normal Send and the total Apply
 * preflight: both call it, so the preview can never disagree with the real send,
 * and a preview never marks the draft submitted.
 * @param session - draft whose pending model request is assembled.
 * @returns the request, or the local problem that blocks it.
 */
function buildModelRequest(session: ArtifactEditSession): ModelRequestOutcome {
  const globalInstruction = session.globalInstruction.trim()
  const styleInstruction = session.styleInstruction.trim()
  if (session.selection.length === 0
    && (session.additions?.length ?? 0) === 0
    && !session.orderChanged
    && session.nestedOrderChanged !== true
    && globalInstruction === ''
    && styleInstruction === '') return { ok: false, problem: 'empty' }
  if (session.selection.some(item => item.instruction.trim() === '')) return { ok: false, problem: 'empty_instruction' }
  // A style instruction sends its own envelope and can never be combined with
  // block content/arrangement/global requirements (the Host has one apply path
  // per request kind). An old Host that cannot parse style envelopes refuses it.
  const hasBlockContent = session.selection.length > 0
    || (session.additions?.length ?? 0) > 0
    || session.orderChanged
    || session.nestedOrderChanged === true
    || globalInstruction !== ''
  if (styleInstruction !== '') {
    if (styleEditSupported === false) return { ok: false, problem: 'style_unsupported' }
    if (hasBlockContent) return { ok: false, problem: 'style_mixed' }
    const styleRequest: ArtifactStyleEditRequest = {
      kind: ARTIFACT_STYLE_EDIT_KIND,
      schemaVersion: 1,
      requestId: session.requestId,
      artifactId: session.artifactId,
      baseRevisionId: session.baseRevisionId,
      baseRevision: session.baseRevision,
      ...session.branch === true ? { branch: true } : {},
      ...session.title === undefined ? {} : { title: session.title },
      style: session.style,
      ...session.styleId === undefined || session.temporaryStyle !== undefined ? {} : { styleId: session.styleId },
      ...session.temporaryStyle === undefined ? {} : { temporaryStyle: session.temporaryStyle },
      styleInstruction,
      program: session.program,
    }
    if (describeEditRequestProblem(styleRequest) !== undefined) return { ok: false, problem: 'invalid' }
    return { ok: true, request: styleRequest }
  }
  const edits: ArtifactBlockEdit[] = [...session.selection]
    .sort((a, b) => a.order - b.order)
    .map(item => {
      const block = session.blocks.find(candidate => candidate.blockId === item.blockId)
      return {
        blockId: item.blockId,
        nodePath: block?.nodePath ?? `root[${Math.max(0, item.order - 1)}]`,
        originalIndex: block?.originalIndex ?? item.order,
        selectionOrder: item.order,
        componentType: block?.componentType ?? 'Card',
        ...block?.title === undefined ? {} : { title: block.title },
        ...block?.nodeId === undefined ? {} : { nodeId: block.nodeId },
        ...block?.sourceDigest === undefined ? {} : { sourceDigest: block.sourceDigest },
        ...block?.parentBlockId === undefined ? {} : { parentBlockId: block.parentBlockId },
        ...block?.depth === undefined ? {} : { depth: block.depth },
        instruction: item.instruction.trim(),
      }
    })
  // A temporary-style artifact cannot fall back to the full-program render_ui
  // path (it would need on-demand authorization), so reorder/global-only
  // requests are rejected before any probe.
  if (session.temporaryStyle !== undefined && edits.length === 0 && (session.additions?.length ?? 0) === 0) return { ok: false, problem: 'temporary_order' }
  const orderByParent: Record<string, string[]> = {}
  if (session.nestedOrderChanged === true && session.nestedOrder !== undefined && session.nestedOriginalOrder !== undefined) {
    const nested = nestedBlocksForProgram(session.program)
    if (nested !== undefined) {
      const byDisplay = new Map(nested.blocks.map(block => [block.blockId, block]))
      for (const [parentDisplay, order] of Object.entries(session.nestedOrder)) {
        const base = session.nestedOriginalOrder[parentDisplay]
        if (base === undefined || order.length !== base.length || order.every((id, index) => id === base[index])) continue
        const parentBlock = byDisplay.get(parentDisplay)
        if (parentBlock?.nodeId === undefined) continue
        const nodeOrder = order.map(id => byDisplay.get(id)?.nodeId).filter((id): id is string => id !== undefined)
        if (nodeOrder.length === order.length) orderByParent[parentBlock.nodeId] = nodeOrder
      }
    }
  }
  const additions: { parentBlockId: string; parentNodeId: string; index: number; instruction: string }[] = []
  if ((session.additions?.length ?? 0) > 0) {
    const nested = nestedBlocksForProgram(session.program)
    if (nested !== undefined) {
      for (const addition of session.additions ?? []) {
        const parent = nested.blocks.find(block => block.blockId === addition.parentBlockId)
        if (parent?.nodeId === undefined) continue
        const index = nested.blocks.filter(block => block.parentBlockId === parent.blockId).length
        additions.push({ parentBlockId: parent.blockId, parentNodeId: parent.nodeId, index, instruction: addition.instruction })
      }
    }
  }
  const request: ArtifactEditRequest = {
    schemaVersion: 1,
    requestId: session.requestId,
    artifactId: session.artifactId,
    baseRevisionId: session.baseRevisionId,
    baseRevision: session.baseRevision,
    ...session.branch === true ? { branch: true } : {},
    ...session.title === undefined ? {} : { title: session.title },
    style: session.style,
    ...session.styleId === undefined || session.temporaryStyle !== undefined ? {} : { styleId: session.styleId },
    ...session.temporaryStyle === undefined ? {} : { temporaryStyle: session.temporaryStyle },
    edits,
    ...additions.length === 0 ? {} : { additions },
    targetOrder: [...session.targetOrder],
    ...Object.keys(orderByParent).length === 0 ? {} : { orderByParent },
    ...session.orderChanged ? { orderChanged: true } : {},
    ...session.strict === true ? { strict: true } : {},
    ...globalInstruction === '' ? {} : { globalInstruction },
    program: session.program,
  }
  if (describeEditRequestProblem(request) !== undefined) return { ok: false, problem: 'invalid' }
  return { ok: true, request }
}

/** Model-side conflict kinds of one local request problem. */
function modelConflictKindFor(problem: Exclude<ModelRequestOutcome, { ok: true }>['problem']): PendingApplyConflict['kind'] | undefined {
  switch (problem) {
    case 'empty_instruction': return 'instruction'
    case 'style_mixed': return 'styleMixed'
    case 'style_unsupported': return 'styleUnsupported'
    case 'temporary_order': return 'temporaryOrder'
    case 'invalid': return 'invalid'
    case 'empty': return undefined
  }
}

/**
 * Local (network-free) model-side conflicts of one draft's pending request.
 *
 * The total Apply preview and the real Apply round share this check, so a
 * request the send codec would refuse can never reach the confirm button, and a
 * model-only Apply cannot report `needSend` for an unsendable draft.
 * @param session - draft to validate.
 * @returns conflicts that block Apply until the user fixes the draft.
 */
export function modelRequestConflicts(session: ArtifactEditSession): PendingApplyConflict[] {
  const conflicts: PendingApplyConflict[] = []
  if (session.status === 'conflict' && session.branch !== true) conflicts.push({ kind: 'stale' })
  if (!hasModelRequestContent(session)) return conflicts
  const built = buildModelRequest(session)
  if (built.ok) return conflicts
  const kind = modelConflictKindFor(built.problem)
  if (kind !== undefined) conflicts.push({ kind })
  return conflicts
}

/** Localized error copy of one model-side conflict list. */
function modelConflictMessage(conflicts: readonly PendingApplyConflict[]): string {
  const kind = conflicts[0]?.kind
  switch (kind) {
    case 'stale': return translate('edit.conflictSend')
    case 'styleMixed': return translate('edit.styleMixed')
    case 'temporaryOrder': return translate('edit.errorTemporaryOrder')
    case 'styleUnsupported': return translate('edit.styleUnavailable')
    default: return translate('edit.errorInvalid')
  }
}

/** Problem codes serialize may report. */
type SerializeProblem = Extract<SerializeOutcome, { ok: false }>['problem']

/** Outcome of the network-checked sendability probe (never consumes the draft). */
export type SendableOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly problem: SerializeProblem; readonly message: string }

/** Resolve one chip reference to its live, unsent draft. */
function resolveDraftForReference(referenceId: string): { readonly key: string; readonly session: ArtifactEditSession } | { readonly problem: SerializeProblem } {
  // An empty reference never named an edit session (internal caller bug);
  // every other unresolved id is a real chip whose session is gone — stale.
  if (referenceId.trim() === '') return { problem: 'missing' }
  // A chip restored with the draft arrives before the edit store rehydrates:
  // the deterministic reference names the draft key, so hydrate it lazily.
  if (!references.has(referenceId) && referenceId.startsWith(`${ARTIFACT_EDIT_SOURCE}:`)) {
    ensureArtifactDraft(referenceId.slice(ARTIFACT_EDIT_SOURCE.length + 1))
  }
  const key = references.get(referenceId)
  if (key === undefined) return { problem: 'stale' }
  const session = sessions.get(key)
  if (session === undefined) return { problem: 'stale' }
  // A consumed draft's chip may survive one more submission attempt when the
  // composer was busy while the store removed it; never send the same draft twice.
  if (session.status === 'submitted') return { problem: 'stale' }
  return { key, session }
}

/** Local queue/contract problem of one draft, checked before any probe. */
function localSendProblem(session: ArtifactEditSession): SerializeProblem | undefined {
  // An unapplied queue must never be dropped by a normal Send: the model
  // request would be committed and the structure operations would disappear
  // with the consumed draft. The user has to Apply (or clear) the queue first.
  if (pendingStructureOpsFor(session).length > 0) return 'pending_apply'
  const built = buildModelRequest(session)
  return built.ok ? undefined : built.problem
}

/**
 * Check whether one chip reference can be sent right now without consuming it.
 *
 * The post-Apply auto-submit asks this before pressing Send: an invalid, mixed,
 * empty-instruction, queued, stale or conflicting draft downgrades to a manual
 * send instead of reporting a send that cannot happen.
 * @param referenceId - chip reference id.
 * @returns ok, or the exact problem plus its localized message.
 */
export async function checkArtifactEditSendable(referenceId: string): Promise<SendableOutcome> {
  const resolved = resolveDraftForReference(referenceId)
  if ('problem' in resolved) return { ok: false, problem: resolved.problem, message: editProblemMessage(resolved.problem) }
  const local = localSendProblem(resolved.session)
  if (local !== undefined) return { ok: false, problem: local, message: editProblemMessage(local) }
  // Branch drafts are allowed to target an older base; the Host re-validates
  // the branch on apply. Non-branch drafts keep the strict latest-head guard.
  const probe = await probeRevision(resolved.session)
  if (probe.result === 'conflict' && resolved.session.branch !== true) {
    return { ok: false, problem: 'conflict', message: editProblemMessage('conflict') }
  }
  return { ok: true }
}

/** Whether one chip reference's draft has actually been consumed by a send. */
export function isArtifactEditSubmitted(referenceId: string): boolean {
  const key = references.get(referenceId)
  return key !== undefined && sessions.get(key)?.status === 'submitted'
}

/**
 * Assemble the structured request for one chip reference and validate it for
 * sending. Called by the composer reference codec; a conflict blocks the send.
 * @param referenceId - chip reference id.
 * @returns the request or a machine-readable problem.
 */
export async function serializeArtifactEditRequest(referenceId: string): Promise<SerializeOutcome> {
  const resolved = resolveDraftForReference(referenceId)
  if ('problem' in resolved) return { ok: false, problem: resolved.problem }
  const { key, session } = resolved
  const local = localSendProblem(session)
  if (local !== undefined) return { ok: false, problem: local }
  const built = buildModelRequest(session)
  if (!built.ok) return { ok: false, problem: built.problem }
  // Branch drafts are allowed to target an older base; the Host re-validates
  // the branch on apply. Non-branch drafts keep the strict latest-head guard.
  const probe = await probeRevision(session)
  if (probe.result === 'conflict' && session.branch !== true) return { ok: false, problem: 'conflict' }
  markSubmitted(key)
  return { ok: true, request: built.request }
}

/** Open the card that owns one chip reference, if its draft still exists. */
export function openArtifactRequest(referenceId: string): boolean {
  const key = references.get(referenceId)
  if (key === undefined) return false
  if (sessions.get(key) === undefined) return false
  return activateDraft(key)
}

/** Localized message for one serialize problem, shown through the composer notice. */
export function editProblemMessage(problem: Extract<SerializeOutcome, { ok: false }>['problem']): string {
  const t = translate
  switch (problem) {
    case 'empty': return t('edit.errorEmpty')
    case 'empty_instruction': return t('edit.errorInvalid')
    case 'conflict': return t('edit.conflictSend')
    case 'stale': return t('edit.errorStale')
    case 'missing': return t('edit.errorSend', { error: t('edit.errorCheck') })
    case 'invalid': return t('edit.errorInvalid')
    case 'temporary_order': return t('edit.errorTemporaryOrder')
    case 'style_mixed': return t('edit.styleMixed')
    case 'style_unsupported': return t('edit.styleUnavailable')
    case 'pending_apply': return t('edit.errorPendingApply')
  }
}

/** Content facts that decide the composer chip summary. */
export interface EditChipFacts {
  readonly count: number
  readonly reordered: boolean
  readonly hasGlobal: boolean
  /** Natural-language style edit takes precedence over block facts. */
  readonly style?: boolean
}

/**
 * Localized composer chip summary for the current request shape:
 * order-only, N content edits, or N edits + arrangement (plus optional global note).
 * A style edit is always labelled first: it cannot be combined with block content.
 * @param facts - request counts and flags.
 * @returns the summary label.
 */
export function editChipLabel(facts: EditChipFacts): string {
  const t = translate
  if (facts.style === true) return t('edit.chipTail.style')
  let base = t('edit.chip.order')
  if (facts.count > 0 && facts.reordered) base = t('edit.chip.mixed', { count: facts.count })
  else if (facts.count > 0) base = t('edit.chip.edits', { count: facts.count })
  else if (!facts.reordered) base = t('edit.chip.global')
  return facts.hasGlobal && (facts.count > 0 || facts.reordered) ? `${base}${t('edit.chip.suffix')}` : base
}

/**
 * Composer chip label for one draft: `编辑 {title} · 修订 N · {summary}`.
 * The title falls back to the panel title so multiple chips stay distinguishable
 * even for untitled artifacts.
 * @param session - draft whose chip label is requested.
 * @returns the localized label.
 */
export function chipLabelForSession(session: Pick<ArtifactEditSession, 'title' | 'baseRevision' | 'selection' | 'orderChanged' | 'globalInstruction' | 'styleInstruction' | 'branch'> & { readonly nestedOrderChanged?: boolean; readonly additions?: readonly { readonly parentBlockId: string; readonly instruction: string }[]; readonly pendingOps?: readonly unknown[] }): string {
  const t = translate
  const title = session.title !== undefined && session.title.trim() !== '' ? session.title : t('edit.panelTitle')
  const count = session.selection.length + (session.additions?.length ?? 0)
  const reordered = session.orderChanged || session.nestedOrderChanged === true
  const hasGlobal = session.globalInstruction.trim() !== ''
  const hasStyle = session.styleInstruction.trim() !== ''
  const opsCount = session.pendingOps?.length ?? 0
  const hasModelContent = hasStyle || count > 0 || reordered || hasGlobal
  let summary = hasStyle
    ? t('edit.chipTail.style')
    : count > 0 && reordered
      ? t('edit.chipTail.mixed', { count })
      : count > 0
        ? t('edit.chipTail.edits', { count })
        : reordered
          ? t('edit.chipTail.order')
          : t('edit.chipTail.global')
  if (!hasStyle && hasGlobal && (count > 0 || reordered)) summary = `${summary}${t('edit.chipTail.suffix')}`
  // A queue-only draft says so instead of pretending to be a global note.
  if (opsCount > 0) {
    const ops = t('edit.chipTail.ops', { count: opsCount })
    summary = hasModelContent ? `${summary} · ${ops}` : ops
  }
  const branchSuffix = session.branch === true ? t('edit.chip.branchSuffix') : ''
  return `${t('edit.entry')} ${title} · ${t('edit.revision', { n: session.baseRevision })} · ${summary}${branchSuffix}`
}

/**
 * Record whether the mounted editor of one draft holds unsaved local work.
 * Cleanup clearing is idempotent, so unmounting cannot leave a stale block.
 * @param key - edit-session key.
 * @param dirty - current panel-local dirty flag.
 */
export function setArtifactPanelDirty(key: string, dirty: boolean): void {
  const session = sessions.get(key)
  if (session === undefined || (session.panelDirty === true) === dirty) return
  sessions.set(key, { ...session, ...dirty ? { panelDirty: true as const } : { panelDirty: undefined } })
  publish()
}

/** Whether any draft of this chat currently contributes a composer chip. */
export function hasPendingArtifactRequest(sessionId: string): boolean {
  for (const session of sessions.values()) {
    if (session.sessionId !== sessionId || session.status === 'submitted') continue
    if (session.attached && hasArtifactEditContent(session)) return true
  }
  return false
}

export type { ArtifactEditSession, OpenEditorResult }
