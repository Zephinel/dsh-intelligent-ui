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
import { useSyncExternalStore } from 'react'
import {
  ARTIFACT_EDIT_SOURCE,
  ARTIFACT_REVISION_ROUTE_PATH,
  MAX_ARTIFACT_BATCH_REQUESTS,
  MAX_ARTIFACT_DRAFTS,
  describeEditRequestProblem,
  isArtifactRevisionStatus,
  isReorderedOrder,
  type ArtifactBlock,
  type ArtifactBlockEdit,
  type ArtifactEditRequest,
} from '../../shared/artifact-edit.ts'
import { extractArtifactBlocks, wrapProgramForBlockEditing } from '../../shared/artifact-blocks.ts'
import type { IntelligentUIProgram } from '../../shared/intelligent-ui.ts'
import { fallbackT, type Translate } from '../../shared/locales.ts'
import type { ArtifactEditSession, OpenEditorResult } from './contracts.ts'

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
    readonly problem: 'empty' | 'empty_instruction' | 'conflict' | 'invalid' | 'stale' | 'missing'
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

/** Whether one draft currently holds unsent edit content. */
export function hasArtifactEditContent(
  session: Pick<ArtifactEditSession, 'selection' | 'orderChanged' | 'globalInstruction'>,
): boolean {
  return session.selection.length > 0 || session.orderChanged || session.globalInstruction.trim() !== ''
}

/** Whether a draft counts against the per-chat draft cap and shows in the switcher. */
function isUserDraft(session: ArtifactEditSession): boolean {
  // Attachment only matters once a draft has content to send; an empty canvas
  // draft is transient and never counts.
  return session.status !== 'submitted' && hasArtifactEditContent(session)
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
function attachedDraftCount(sessionId: string): number {
  let count = 0
  for (const session of sessions.values()) {
    if (session.sessionId !== sessionId || session.status === 'submitted') continue
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

/** Read one draft snapshot without subscribing. */
export function editSessionFor(sessionId: string, baseRevisionId: string): ArtifactEditSession | undefined {
  return sessions.get(editKey(sessionId, baseRevisionId))
}

/** Read one draft by its session key without subscribing. */
export function draftSessionFor(key: string): ArtifactEditSession | undefined {
  return sessions.get(key)
}

/** Subscribe one card to its own edit draft. */
export function useArtifactEditSession(sessionId: string, baseRevisionId: string): ArtifactEditSession | undefined {
  const store = useArtifactEditStore()
  return store.sessions.get(editKey(sessionId, baseRevisionId))
}

/** The draft key currently shown in the edit canvas for one chat, if any. */
export function activeDraftKeyFor(sessionId: string): string | undefined {
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

/** Whether a card offers block editing at all. */
export function supportsBlockEditing(program: IntelligentUIProgram): boolean {
  if (program.running) return false
  if (program.styleSource === 'temporary') return false
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

/** Revision probe; unknown host/network states are non-blocking. */
async function probeRevision(session: ArtifactEditSession): Promise<'ok' | 'conflict' | 'unknown'> {
  if (typeof fetch !== 'function') return 'unknown'
  const query = `?artifactId=${encodeURIComponent(session.artifactId)}&revisionId=${encodeURIComponent(session.baseRevisionId)}`
  try {
    const response = await fetch(`${ARTIFACT_REVISION_ROUTE_PATH}${query}`, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (!response.ok) return 'unknown'
    const value: unknown = await response.json()
    if (!isArtifactRevisionStatus(value)) return 'unknown'
    return value.conflict ? 'conflict' : 'ok'
  } catch {
    return 'unknown'
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
  const session = sessions.get(key)
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
  return true
}

/**
 * Discard one draft for good (content, chip and canvas state).
 * @param key - draft key.
 */
export function discardDraft(key: string): void {
  const session = sessions.get(key)
  if (session === undefined) return
  const reference = referenceOf(key)
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
}

/** Run a revision probe and settle one draft's status. */
function checkRevision(key: string): void {
  const current = sessions.get(key)
  if (current === undefined) return
  void probeRevision(current).then(result => {
    patch(key, session => {
      if (session.status === 'submitted') return session
      if (result === 'conflict') return { ...session, status: 'conflict', error: undefined }
      return session.status === 'checking' || session.status === 'conflict' || session.status === 'error'
        ? { ...session, status: 'ready', error: undefined }
        : session
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
  const lineage = lineageOf(program)
  const key = editKey(sessionId, lineage.baseRevisionId)
  const existing = sessions.get(key)

  // Retained draft: show its canvas again without touching the content.
  if (existing !== undefined && existing.status !== 'submitted') {
    activateKeyFor(sessionId, key)
    patch(key, session => ({
      ...session,
      editing: true,
      activeBlockId: undefined,
      activeDraft: '',
      activeDirty: false,
      drawerOpen: false,
      error: undefined,
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
      ...program.title === undefined ? {} : { title: program.title },
      style: program.style ?? 'card',
      ...program.styleId === undefined ? {} : { styleId: program.styleId },
      program: program.program,
      wrappedProgram,
      blocks: extraction.blocks,
      originalOrder: extraction.blocks.map(block => block.blockId),
      targetOrder: extraction.blocks.map(block => block.blockId),
      orderChanged: false,
      selection: [],
      globalInstruction: '',
      editing: true,
      drawerOpen: false,
      status: 'checking',
      activeDraft: '',
      activeDirty: false,
    }
    sessions.set(key, created)
    publish()
    checkRevision(key)
    return { ok: true }
  }

  // Submitted draft reused: content was sent, so this is a fresh draft.
  activateKeyFor(sessionId, key)
  patch(key, session => ({
    ...session,
    requestId: newRequestId(),
    attached,
    selection: [],
    removable: undefined,
    globalInstruction: '',
    targetOrder: extraction.blocks.map(block => block.blockId),
    orderChanged: false,
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
  if (activeKeys.get(session.sessionId) === key) activeKeys.delete(session.sessionId)
  if (!hasArtifactEditContent(session)) {
    sessions.delete(key)
    removeReference(key)
  } else {
    sessions.set(key, { ...session, editing: false, activeBlockId: undefined, activeDraft: '', activeDirty: false, drawerOpen: false })
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
}

/** Apply one target order to a session, deriving orderChanged and publishing. */
function applyTargetOrder(key: string, session: ArtifactEditSession, targetOrder: readonly string[], immediate = true): void {
  const next = [...targetOrder]
  const orderChanged = isReorderedOrder(session.originalOrder, next)
  if (!orderChanged && !session.orderChanged && next.join('\n') === session.targetOrder.join('\n')) return
  sessions.set(key, { ...session, targetOrder: next, orderChanged })
  publish()
  scheduleChipSync(session.sessionId, immediate)
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
}

/** Replace the global instruction. */
export function setArtifactGlobalInstruction(key: string, text: string): void {
  const session = sessions.get(key)
  if (session === undefined || session.globalInstruction === text) return
  sessions.set(key, { ...session, globalInstruction: text.slice(0, 4000) })
  publish()
  scheduleChipSync(session.sessionId)
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
  const result = await probeRevision(session)
  if (result !== 'conflict') return
  patch(key, current => current.status === 'submitted' || current.status === 'conflict'
    ? undefined
    : { ...current, status: 'conflict' })
}

/** Mark a draft as sent: drop its chip, leave the canvas and free its batch slot. */
function markSubmitted(key: string): void {
  const session = sessions.get(key)
  if (session === undefined) return
  sessions.set(key, {
    ...session,
    status: 'submitted',
    submittedAt: Date.now(),
    submitFailed: false,
    editing: false,
    attached: false,
    activeBlockId: undefined,
    activeDraft: '',
    activeDirty: false,
    drawerOpen: false,
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
    restored += 1
  }
  if (restored > 0 || committed.size > 0) {
    publish()
    scheduleChipSync(sessionId, true)
  }
  return restored
}

/**
 * Assemble the structured request for one chip reference and validate it for
 * sending. Called by the composer reference codec; a conflict blocks the send.
 * @param referenceId - chip reference id.
 * @returns the request or a machine-readable problem.
 */
export async function serializeArtifactEditRequest(referenceId: string): Promise<SerializeOutcome> {
  // An empty reference never named an edit session (internal caller bug);
  // every other unresolved id is a real chip whose session is gone — stale.
  if (referenceId.trim() === '') return { ok: false, problem: 'missing' }
  const key = references.get(referenceId)
  if (key === undefined) return { ok: false, problem: 'stale' }
  const session = sessions.get(key)
  if (session === undefined) return { ok: false, problem: 'stale' }
  // A consumed draft's chip may survive one more submission attempt when the
  // composer was busy while the store removed it; never send the same draft twice.
  if (session.status === 'submitted') return { ok: false, problem: 'stale' }
  const globalInstruction = session.globalInstruction.trim()
  if (session.selection.length === 0 && !session.orderChanged && globalInstruction === '') return { ok: false, problem: 'empty' }
  if (session.selection.some(item => item.instruction.trim() === '')) return { ok: false, problem: 'empty_instruction' }
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
        instruction: item.instruction.trim(),
      }
    })
  const request: ArtifactEditRequest = {
    schemaVersion: 1,
    requestId: session.requestId,
    artifactId: session.artifactId,
    baseRevisionId: session.baseRevisionId,
    baseRevision: session.baseRevision,
    ...session.title === undefined ? {} : { title: session.title },
    style: session.style,
    ...session.styleId === undefined ? {} : { styleId: session.styleId },
    edits,
    targetOrder: [...session.targetOrder],
    ...session.orderChanged ? { orderChanged: true } : {},
    ...globalInstruction === '' ? {} : { globalInstruction },
    program: session.program,
  }
  if (describeEditRequestProblem(request) !== undefined) return { ok: false, problem: 'invalid' }
  const revision = await probeRevision(session)
  if (revision === 'conflict') return { ok: false, problem: 'conflict' }
  markSubmitted(key)
  return { ok: true, request }
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
  }
}

/** Content facts that decide the composer chip summary. */
export interface EditChipFacts {
  readonly count: number
  readonly reordered: boolean
  readonly hasGlobal: boolean
}

/**
 * Localized composer chip summary for the current request shape:
 * order-only, N content edits, or N edits + arrangement (plus optional global note).
 * @param facts - request counts and flags.
 * @returns the summary label.
 */
export function editChipLabel(facts: EditChipFacts): string {
  const t = translate
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
export function chipLabelForSession(session: Pick<ArtifactEditSession, 'title' | 'baseRevision' | 'selection' | 'orderChanged' | 'globalInstruction'>): string {
  const t = translate
  const title = session.title !== undefined && session.title.trim() !== '' ? session.title : t('edit.panelTitle')
  const count = session.selection.length
  const reordered = session.orderChanged
  const hasGlobal = session.globalInstruction.trim() !== ''
  let summary = count > 0 && reordered
    ? t('edit.chipTail.mixed', { count })
    : count > 0
      ? t('edit.chipTail.edits', { count })
      : reordered
        ? t('edit.chipTail.order')
        : t('edit.chipTail.global')
  if (hasGlobal && (count > 0 || reordered)) summary = `${summary}${t('edit.chipTail.suffix')}`
  return `${t('edit.entry')} ${title} · ${t('edit.revision', { n: session.baseRevision })} · ${summary}`
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
