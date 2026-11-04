/**
 * Browser-side edit-session store for Artifact block editing.
 *
 * One edit session is keyed by `${sessionId}:${baseRevisionId}` and owns the
 * selected blocks, their instructions, the global instruction and the transient
 * popover/panel state. The store also keeps the composer's structured chip in
 * step: every change re-publishes a compact chip label through the injected
 * composer bridge, and the chip's reference codec asks the store to assemble the
 * structured request at send time.
 *
 * Only one session per chat session can be in edit mode at a time; saved
 * requests for other revisions may still exist if the user closed the editor
 * without sending, and the chip always reflects the most recently active one.
 */
import { useSyncExternalStore } from 'react'
import {
  ARTIFACT_EDIT_SOURCE,
  ARTIFACT_REVISION_ROUTE_PATH,
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
import type { ArtifactEditSession } from './contracts.ts'

/** Composer integration the store talks to; registered by the chip module. */
export interface ArtifactComposerBridge {
  /** Whether the draft can accept a chip edit right now. */
  readonly canEditChip: (sessionId: string) => boolean
  /** Insert or replace the structured edit chip with its localized label. */
  readonly upsertChip: (sessionId: string, referenceId: string, label: string) => void
  /** Remove the structured chip when the request set becomes empty. */
  readonly removeChip: (sessionId: string) => void
  /** Return to the card that owns the request (chip click). */
  readonly openRequest: (sessionId: string, referenceId: string) => void
}

/** Result of trying to enter edit mode for one rendered card. */
export type OpenEditorResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'unsupported' | 'conflict' | 'empty' }

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
/** Most recently active edit session per chat session; the chip mirrors it. */
const lastActive = new Map<string, string>()
let snapshot: SessionMapSnapshot = { sessions: new Map() }
let bridge: ArtifactComposerBridge | undefined
let translate: Translate = fallbackT

function publish(): void {
  const next = new Map<string, ArtifactEditSession>()
  for (const [key, value] of sessions) {
    if (value.editing || value.selection.length > 0 || value.orderChanged || value.globalInstruction.trim() !== '' || value.status === 'submitted') next.set(key, value)
  }
  for (const [key, value] of [...sessions]) {
    if (!next.has(key) && value.status !== 'submitted') sessions.delete(key)
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

/** Read one session snapshot without subscribing. */
export function editSessionFor(sessionId: string, baseRevisionId: string): ArtifactEditSession | undefined {
  return sessions.get(editKey(sessionId, baseRevisionId))
}

/** Subscribe one card to its own edit session. */
export function useArtifactEditSession(sessionId: string, baseRevisionId: string): ArtifactEditSession | undefined {
  const store = useArtifactEditStore()
  return store.sessions.get(editKey(sessionId, baseRevisionId))
}

/** Read the single session currently in edit mode for a chat session. */
export function editingSessionFor(sessionId: string): ArtifactEditSession | undefined {
  for (const session of sessions.values()) {
    if (session.sessionId === sessionId && session.editing) return session
  }
  return undefined
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
  const reference = `${ARTIFACT_EDIT_SOURCE}:${key}`
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

/** Close every other editing session for the same chat session. */
function closeOtherEditors(sessionId: string, key: string): void {
  for (const [existingKey, session] of sessions) {
    if (existingKey !== key && session.sessionId === sessionId && session.editing) {
      sessions.set(existingKey, { ...session, editing: false, activeBlockId: undefined, activeDraft: '', activeDirty: false, drawerOpen: false })
    }
  }
}

/** Cancel the debounced chip sync for one session. */
function clearChipTimer(sessionId: string): void {
  const timer = chipTimers.get(sessionId)
  if (timer !== undefined) { clearTimeout(timer); chipTimers.delete(sessionId) }
}

/** Publish the chip state for one chat session, debounced for typed text. */
function scheduleChipSync(sessionId: string, immediate = false): void {
  if (bridge === undefined) return
  clearChipTimer(sessionId)
  const run = (): void => {
    chipTimers.delete(sessionId)
    const active = activeSessionFor(sessionId)
    if (active === undefined || (active.selection.length === 0 && !active.orderChanged && active.globalInstruction.trim() === '')) {
      bridge.removeChip(sessionId)
      return
    }
    bridge.upsertChip(sessionId, referenceForSession(active.key), editChipLabel({
      count: active.selection.length,
      reordered: active.orderChanged,
      hasGlobal: active.globalInstruction.trim() !== '',
    }))
  }
  if (immediate) run()
  else chipTimers.set(sessionId, setTimeout(run, 250))
}

/** The session whose chip represents one chat session. */
function activeSessionFor(sessionId: string): ArtifactEditSession | undefined {
  const editing = editingSessionFor(sessionId)
  if (editing !== undefined) return editing
  const preferred = lastActive.get(sessionId)
  const known = preferred === undefined ? undefined : sessions.get(preferred)
  if (known !== undefined && (known.selection.length > 0 || known.orderChanged || known.globalInstruction.trim() !== '')) return known
  for (const session of sessions.values()) {
    if (session.sessionId !== sessionId) continue
    if (session.selection.length === 0 && !session.orderChanged && session.globalInstruction.trim() === '') continue
    return session
  }
  return undefined
}

/** Run a revision probe and settle the session status. */
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

/** Assemble the append chip reference for one key. */
function referenceIdOf(key: string): string {
  return referenceForSession(key)
}

/**
 * Enter edit mode for one rendered card.
 * @param sessionId - chat session owning the card.
 * @param program - extracted render_ui program identity and content.
 * @returns ok, or why editing is unavailable.
 */
export function openArtifactEditor(sessionId: string, program: IntelligentUIProgram): OpenEditorResult {
  if (!supportsBlockEditing(program)) return { ok: false, reason: program.styleSource === 'temporary' ? 'unsupported' : 'unsupported' }
  const extraction = blocksForProgram(program.program)
  const wrappedProgram = wrapProgramForBlockEditing(program.program, extraction)
  if (wrappedProgram === undefined) return { ok: false, reason: 'unsupported' }
  const lineage = lineageOf(program)
  const key = editKey(sessionId, lineage.baseRevisionId)
  lastActive.set(sessionId, key)
  closeOtherEditors(sessionId, key)
  const existing = sessions.get(key)
  if (existing !== undefined && existing.status === 'conflict') {
    patch(key, session => ({ ...session, editing: true, status: 'checking', error: undefined }))
    checkRevision(key)
    return { ok: false, reason: 'conflict' }
  }
  if (existing === undefined) {
    const created: ArtifactEditSession = {
      key,
      sessionId,
      artifactId: lineage.artifactId,
      baseRevisionId: lineage.baseRevisionId,
      baseRevision: lineage.baseRevision,
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
  const reset = existing.status === 'submitted'
  patch(key, session => ({
    ...session,
    ...reset ? {
      selection: [],
      globalInstruction: '',
      targetOrder: session.originalOrder,
      orderChanged: false,
      status: 'checking' as const,
    } : {},
    editing: true,
    drawerOpen: false,
    activeBlockId: undefined,
    activeDraft: '',
    activeDirty: false,
    error: undefined,
    wrappedProgram: wrapProgramForBlockEditing(program.program, extraction) ?? session.wrappedProgram,
    blocks: extraction.blocks,
    program: program.program,
  }))
  if (!reset || existing.status === 'submitted') checkRevision(key)
  publish()
  return { ok: true }
}

/** Exit edit mode; saved requests and the composer chip remain. */
export function closeArtifactEditor(key: string): void {
  const session = sessions.get(key)
  if (session === undefined) return
  if (session.selection.length === 0 && !session.orderChanged && session.globalInstruction.trim() === '') {
    sessions.delete(key)
    references.delete(referenceIdOf(key))
    if (lastActive.get(session.sessionId) === key) lastActive.delete(session.sessionId)
  } else {
    sessions.set(key, { ...session, editing: false, activeBlockId: undefined, activeDraft: '', activeDirty: false, drawerOpen: false })
  }
  publish()
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

/** Mark a session as sent: drop the chip and leave edit mode. */
function markSubmitted(key: string): void {
  const session = sessions.get(key)
  if (session === undefined) return
  sessions.set(key, { ...session, status: 'submitted', editing: false, activeBlockId: undefined, activeDraft: '', activeDirty: false, drawerOpen: false })
  if (lastActive.get(session.sessionId) === key) lastActive.delete(session.sessionId)
  if (bridge !== undefined) bridge.removeChip(session.sessionId)
  publish()
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

/** Open the card that owns one chip reference, if it is still mounted. */
export function openArtifactRequest(referenceId: string): boolean {
  const key = references.get(referenceId)
  if (key === undefined) return false
  const session = sessions.get(key)
  if (session === undefined) return false
  closeOtherEditors(session.sessionId, key)
  sessions.set(key, { ...session, editing: true, status: session.status === 'conflict' ? 'checking' : session.status })
  publish()
  if (sessions.get(key)?.status === 'checking') checkRevision(key)
  return true
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

/** Content facts that decide the composer chip label. */
export interface EditChipFacts {
  readonly count: number
  readonly reordered: boolean
  readonly hasGlobal: boolean
}

/**
 * Localized composer chip label for the current request shape:
 * order-only, N content edits, or N edits + arrangement (plus optional global note).
 * @param facts - request counts and flags.
 * @returns the chip label.
 */
export function editChipLabel(facts: EditChipFacts): string {
  const t = translate
  let base = t('edit.chip.order')
  if (facts.count > 0 && facts.reordered) base = t('edit.chip.mixed', { count: facts.count })
  else if (facts.count > 0) base = t('edit.chip.edits', { count: facts.count })
  else if (!facts.reordered) base = t('edit.chip.global')
  return facts.hasGlobal && (facts.count > 0 || facts.reordered) ? `${base}${t('edit.chip.suffix')}` : base
}

/** Whether any session for this chat session currently shows the chip. */
export function hasPendingArtifactRequest(sessionId: string): boolean {
  return activeSessionFor(sessionId) !== undefined
}

export type { ArtifactEditSession }
