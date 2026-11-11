/**
 * Client-side revision version store for one chat session (M1: active stage).
 *
 * One artifact can have several transcript cards (one per Turn that recorded a
 * revision) plus client-local revision cards. M1 keeps a single **active stage**
 * per artifact: that card renders the currently selected revision (default: the
 * latest known one), while other cards are either a compact notice row (newer
 * revisions suppressed because the stage is visible) or a frozen historical card
 * that keeps rendering its own revision with a hint pointing at the stage.
 *
 * The store is memory-only: refreshing/reopening a session starts empty and the
 * loaded cards converge again (D6 "back to latest"). No Host route, durable
 * field or revision enum value is involved. Selection is exposed through
 * `selectArtifactRevision` for the M2 version bar.
 *
 * Visibility is reported by the stage card's IntersectionObserver; registration
 * itself is a pure reducer so the rules are unit-testable without React or DOM.
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { IntelligentUIProgram, RenderLayout } from '../../shared/intelligent-ui.ts'
import type { StyleSnapshot } from '../../shared/style-templates.ts'
import type { RevisionFallback } from './revision-fallbacks.ts'

/** Role one artifact card plays in the current version layout. */
export type ArtifactCardRole = 'stage' | 'notice' | 'frozen'

/** How one revision came into existence; drives labels and limits. */
export type ArtifactRevisionSource = 'initial' | 'edit' | 'structure' | 'restore' | 'style' | 'props' | 'local'

/** One known revision of an artifact, with its program and presentation meta. */
export interface ArtifactVersionRecord {
  readonly revisionId: string
  /** Root artifact identity the revision belongs to. */
  readonly artifactId: string
  /** 1-based revision number; an unnumbered initial render counts as revision 1. */
  readonly revision: number
  readonly program: string
  readonly title?: string
  readonly style: RenderLayout
  readonly styleId?: string
  readonly temporaryStyle?: StyleSnapshot
  readonly baseRevisionId?: string
  readonly editedBlockIds?: readonly string[]
  /** Set when the revision is a client-owned local revision card. */
  readonly localRevision?: boolean
  readonly localRevisionKind?: 'restore' | 'structure' | 'props' | 'style'
  readonly requestId?: string
  /** Card that first registered this revision (used to find its native owner). */
  readonly callId: string
  /** Turn that first registered this revision, when known. */
  readonly turn?: number
  /** Monotonic registration order, used to break revision-number ties. */
  readonly seq: number
  /**
   * Set when this record became the displayed revision through a deletion
   * fallback: the deleted revision id. The stage synthesizes `fallbackFrom`
   * from it so a stage displaying a fetched revision stays read-only after the
   * displayed revision is deleted.
   */
  readonly redirectedFrom?: string
}

/** One mounted card of an artifact, independent of the revision it names. */
export interface ArtifactVersionCard {
  readonly cardId: string
  readonly revisionId: string
  /** 1-based revision number of the card's own revision. */
  readonly revision: number
  readonly turn?: number
  readonly seq: number
  readonly source?: ArtifactRevisionSource
}

/** Everything the version store knows about one artifact. */
export interface ArtifactVersionState {
  /** Known revisions by revision id (programs are kept in memory). */
  readonly revisions: ReadonlyMap<string, ArtifactVersionRecord>
  /** Mounted cards by card id (transcript callId or local revision id). */
  readonly cards: ReadonlyMap<string, ArtifactVersionCard>
  readonly latestRevisionId?: string
  readonly selectedRevisionId?: string
  readonly stageCardId?: string
  /** Whether the stage card currently intersects the viewport (observer-reported). */
  readonly stageVisible: boolean
  /** Last registration sequence used by this artifact. */
  readonly seq: number
}

/** Input for one card registration from the render layer. */
export interface ArtifactVersionCardSpec {
  readonly cardId: string
  readonly artifactId: string
  readonly revisionId: string
  /** 1-based revision number; absent means the initial render (revision 1). */
  readonly revision?: number
  readonly turn?: number
  readonly program: string
  readonly title?: string
  readonly style: RenderLayout
  readonly styleId?: string
  readonly temporaryStyle?: StyleSnapshot
  readonly baseRevisionId?: string
  readonly editedBlockIds?: readonly string[]
  readonly localRevision?: boolean
  readonly localRevisionKind?: 'restore' | 'structure' | 'props' | 'style'
  readonly requestId?: string
  readonly source?: ArtifactRevisionSource
}

/** One revision record upserted without a mounted card (M2 on-demand programs). */
export interface ArtifactVersionRecordInput {
  readonly revisionId: string
  readonly artifactId: string
  readonly revision: number
  readonly program: string
  readonly title?: string
  readonly style: RenderLayout
  readonly styleId?: string
  readonly temporaryStyle?: StyleSnapshot
  readonly baseRevisionId?: string
  readonly editedBlockIds?: readonly string[]
  readonly localRevision?: boolean
  readonly localRevisionKind?: 'restore' | 'structure' | 'props' | 'style'
  readonly requestId?: string
  readonly turn?: number
}

/** Empty artifact state; stable so cards render before their effect registers. */
export const EMPTY_ARTIFACT_VERSION_STATE: ArtifactVersionState = {
  revisions: new Map(),
  cards: new Map(),
  stageVisible: false,
  seq: 0,
}

/** Artifact state with `cardId`'s registration applied. */
export function registerCardInState(
  state: ArtifactVersionState,
  spec: ArtifactVersionCardSpec,
  seq: number,
): ArtifactVersionState {
  const card: ArtifactVersionCard = {
    cardId: spec.cardId,
    revisionId: spec.revisionId,
    revision: spec.revision ?? 1,
    ...spec.turn === undefined ? {} : { turn: spec.turn },
    seq,
    ...spec.source === undefined ? {} : { source: spec.source },
  }
  const cards = new Map(state.cards)
  cards.set(card.cardId, card)
  const revisions = new Map(state.revisions)
  const previous = revisions.get(spec.revisionId)
  const record: ArtifactVersionRecord = {
    revisionId: spec.revisionId,
    artifactId: spec.artifactId,
    revision: spec.revision ?? previous?.revision ?? 1,
    program: spec.program,
    ...spec.title === undefined ? {} : { title: spec.title },
    style: spec.style,
    ...spec.styleId === undefined ? {} : { styleId: spec.styleId },
    ...spec.temporaryStyle === undefined ? {} : { temporaryStyle: spec.temporaryStyle },
    ...spec.baseRevisionId === undefined ? {} : { baseRevisionId: spec.baseRevisionId },
    ...spec.editedBlockIds === undefined ? {} : { editedBlockIds: spec.editedBlockIds },
    ...spec.localRevision === true ? { localRevision: true } : {},
    ...spec.localRevisionKind === undefined ? {} : { localRevisionKind: spec.localRevisionKind },
    ...spec.requestId === undefined ? {} : { requestId: spec.requestId },
    callId: previous?.callId ?? spec.cardId,
    ...spec.turn === undefined && previous?.turn === undefined ? {} : { turn: spec.turn ?? previous?.turn },
    seq: previous?.seq ?? seq,
    ...previous?.redirectedFrom === undefined ? {} : { redirectedFrom: previous.redirectedFrom },
  }
  revisions.set(record.revisionId, record)
  const latest = latestRecord(revisions)
  const next: ArtifactVersionState = {
    ...state,
    revisions,
    cards,
    seq,
    ...latest === undefined ? {} : { latestRevisionId: latest.revisionId },
  }
  // First card of an artifact becomes the stage and selects the latest revision.
  if (state.stageCardId === undefined) {
    return {
      ...next,
      stageCardId: card.cardId,
      selectedRevisionId: latest?.revisionId,
      stageVisible: false,
    }
  }
  // The stage card re-registering (for example after a fallback redirect) keeps
  // its role; only the displayed revision selection is repaired.
  if (state.stageCardId === card.cardId) {
    const selected = state.selectedRevisionId !== undefined && revisions.has(state.selectedRevisionId)
      ? state.selectedRevisionId
      : latest?.revisionId
    return { ...next, ...selected === undefined ? {} : { selectedRevisionId: selected } }
  }
  const previousLatest = state.latestRevisionId === undefined ? undefined : state.revisions.get(state.latestRevisionId)
  const newer = record.revisionId !== previousLatest?.revisionId && isNewer(record, previousLatest)
  if (!newer) return next
  // A visible stage updates in place: the new revision becomes latest/selected
  // and this card stays a compact notice row.
  if (state.stageVisible) return { ...next, selectedRevisionId: latest?.revisionId }
  // An invisible (or unmounted) stage hands over: this card becomes the stage,
  // the previous stage turns frozen and nothing scrolls.
  return {
    ...next,
    stageCardId: card.cardId,
    selectedRevisionId: latest?.revisionId,
    stageVisible: false,
  }
}

/**
 * Artifact state with an already-registered card's spec refreshed.
 *
 * A card whose program changed (fallback redirect, restyle, a re-parsed Turn)
 * must keep the role and stage ownership it already has: unlike a fresh
 * registration it never promotes itself or hands the stage over. Latest and the
 * selection are recomputed so a deleted selected revision still repoints at a
 * live record.
 * @param state - current artifact state.
 * @param spec - refreshed card spec (same cardId).
 * @param seq - monotonic registration sequence.
 * @returns state with the refreshed card, stable stage role and repaired selection.
 */
export function updateCardInState(
  state: ArtifactVersionState,
  spec: ArtifactVersionCardSpec,
  seq: number,
): ArtifactVersionState {
  if (!state.cards.has(spec.cardId)) return registerCardInState(state, spec, seq)
  const registered = registerCardInState(state, spec, seq)
  const selected = registered.selectedRevisionId !== undefined && registered.revisions.has(registered.selectedRevisionId)
    ? registered.selectedRevisionId
    : registered.latestRevisionId
  return {
    ...registered,
    stageCardId: state.stageCardId,
    stageVisible: state.stageVisible,
    ...selected === undefined ? {} : { selectedRevisionId: selected },
  }
}

/**
 * Artifact state with one card removed.
 *
 * A removed stage hands over to the newest remaining card and keeps selecting
 * the latest known revision (that revision's program can outlive its own card).
 * When the last card of an artifact unmounts, the artifact is forgotten: the
 * next loaded card converges from what is loaded again, which is what makes a
 * full remount/reload land on the newest loaded revision instead of an old one.
 */
export function unregisterCardInState(state: ArtifactVersionState, cardId: string): ArtifactVersionState {
  if (!state.cards.has(cardId)) return state
  const cards = new Map(state.cards)
  cards.delete(cardId)
  const next: ArtifactVersionState = { ...state, cards }
  if (state.stageCardId !== cardId) return next
  const replacement = newestCard(cards)
  if (replacement === undefined) {
    return {
      revisions: new Map(),
      cards,
      stageVisible: false,
      seq: state.seq,
      stageCardId: undefined,
      latestRevisionId: undefined,
      selectedRevisionId: undefined,
    }
  }
  const latest = latestRecord(state.revisions)
  return {
    ...next,
    stageCardId: replacement.cardId,
    selectedRevisionId: latest?.revisionId ?? replacement.revisionId,
    stageVisible: false,
  }
}

/** Artifact state with the stage visibility updated. */
export function setStageVisibilityInState(state: ArtifactVersionState, visible: boolean): ArtifactVersionState {
  return state.stageVisible === visible ? state : { ...state, stageVisible: visible }
}

/** Artifact state with another revision selected (M2 entry point). */
export function selectRevisionInState(state: ArtifactVersionState, revisionId: string): ArtifactVersionState {
  if (!state.revisions.has(revisionId) || state.selectedRevisionId === revisionId) return state
  return { ...state, selectedRevisionId: revisionId }
}

/**
 * Artifact state after a revision is deleted.
 *
 * The deleted record is dropped; when a prepared rollback fallback is supplied
 * its revision is (re)registered so the stage can render a live revision instead
 * of a dangling one. Latest is recomputed from the remaining records. When the
 * deleted revision was the selected one, the fallback target becomes selected so
 * the stage matches the deletion confirmation ("this card rolls back to revision
 * N"); a deletion without a displayed fallback keeps the selection when it still
 * names a live record and otherwise repoints at the latest one.
 */
export function forgetRevisionInState(
  state: ArtifactVersionState,
  revisionId: string,
  fallback?: RevisionFallback,
  seq = state.seq + 1,
): ArtifactVersionState {
  if (!state.revisions.has(revisionId)) return state
  const revisions = new Map(state.revisions)
  revisions.delete(revisionId)
  if (fallback !== undefined) {
    const previous = revisions.get(fallback.revisionId)
    revisions.set(fallback.revisionId, {
      revisionId: fallback.revisionId,
      artifactId: fallback.artifactId,
      revision: fallback.revision,
      program: fallback.program,
      ...fallback.title === undefined ? {} : { title: fallback.title },
      style: fallback.style,
      ...fallback.styleId === undefined ? {} : { styleId: fallback.styleId },
      ...fallback.temporaryStyle === undefined ? {} : { temporaryStyle: fallback.temporaryStyle },
      ...fallback.baseRevisionId === undefined ? {} : { baseRevisionId: fallback.baseRevisionId },
      callId: previous?.callId ?? fallback.revisionId,
      seq: previous?.seq ?? seq,
      // The displayed revision changed through a deletion fallback. The stage
      // card's own program may belong to another revision (it can display a
      // fetched revision), so stageProgramFor must read this from the record.
      redirectedFrom: revisionId,
    })
  }
  const latest = latestRecord(revisions)
  const wasSelected = state.selectedRevisionId === revisionId
  // The deletion confirmation names the prepared rollback target, so a deleted
  // displayed revision must select that target instead of silently advancing to
  // the latest one (which may be a newer revision the user never chose).
  const fallbackSelected = fallback !== undefined && revisions.has(fallback.revisionId) ? fallback.revisionId : undefined
  const selected = wasSelected
    ? fallbackSelected ?? latest?.revisionId
    : state.selectedRevisionId !== undefined && revisions.has(state.selectedRevisionId)
      ? state.selectedRevisionId
      : latest?.revisionId
  return {
    ...state,
    revisions,
    ...latest === undefined ? {} : { latestRevisionId: latest.revisionId },
    ...selected === undefined ? {} : { selectedRevisionId: selected },
  }
}

/**
 * Role one mounted card plays.
 *
 * The stage card is the stage; cards displaying a newer revision than the
 * stage's own revision are suppression notices; the rest are frozen historical
 * cards. Equal revisions fall back to turn order (a later Turn is a notice).
 */
export function artifactCardRole(state: ArtifactVersionState, cardId: string): ArtifactCardRole | undefined {
  const card = state.cards.get(cardId)
  if (card === undefined) return undefined
  if (state.stageCardId === undefined) return 'stage'
  if (state.stageCardId === cardId) return 'stage'
  const stage = state.cards.get(state.stageCardId)
  if (stage === undefined) return 'stage'
  if (card.revision > stage.revision) return 'notice'
  if (card.revision < stage.revision) return 'frozen'
  return (card.turn ?? 0) > (stage.turn ?? 0) ? 'notice' : 'frozen'
}

/** Latest known revision record (highest revision number, then registration order). */
export function latestRecord(revisions: ReadonlyMap<string, ArtifactVersionRecord>): ArtifactVersionRecord | undefined {
  let latest: ArtifactVersionRecord | undefined
  for (const record of revisions.values()) {
    if (latest === undefined || isNewer(record, latest)) latest = record
  }
  return latest
}

/** Whether `left` outranks `right` as a revision (number first, then seq). */
function isNewer(
  left: Pick<ArtifactVersionRecord, 'revision' | 'seq'> | undefined,
  right: Pick<ArtifactVersionRecord, 'revision' | 'seq'> | undefined,
): boolean {
  if (left === undefined) return false
  if (right === undefined) return true
  return left.revision !== right.revision ? left.revision > right.revision : left.seq > right.seq
}

/** Newest mounted card by revision, then turn, then registration order. */
function newestCard(cards: ReadonlyMap<string, ArtifactVersionCard>): ArtifactVersionCard | undefined {
  let newest: ArtifactVersionCard | undefined
  for (const card of cards.values()) {
    if (newest === undefined) {
      newest = card
      continue
    }
    if (card.revision !== newest.revision) {
      if (card.revision > newest.revision) newest = card
      continue
    }
    if ((card.turn ?? 0) !== (newest.turn ?? 0)) {
      if ((card.turn ?? 0) > (newest.turn ?? 0)) newest = card
      continue
    }
    if (card.seq > newest.seq) newest = card
  }
  return newest
}

/**
 * Artifact state with one revision record upserted without a card (M2 on-demand
 * program fetch). Latest is recomputed so a fetched newer record is selectable;
 * the selection and stage card stay untouched.
 */
export function registerRevisionInState(
  state: ArtifactVersionState,
  input: ArtifactVersionRecordInput,
  seq: number,
): ArtifactVersionState {
  const revisions = new Map(state.revisions)
  const previous = revisions.get(input.revisionId)
  revisions.set(input.revisionId, {
    revisionId: input.revisionId,
    artifactId: input.artifactId,
    revision: input.revision,
    program: input.program,
    ...input.title === undefined ? {} : { title: input.title },
    style: input.style,
    ...input.styleId === undefined ? {} : { styleId: input.styleId },
    ...input.temporaryStyle === undefined ? {} : { temporaryStyle: input.temporaryStyle },
    ...input.baseRevisionId === undefined ? {} : { baseRevisionId: input.baseRevisionId },
    ...input.editedBlockIds === undefined ? {} : { editedBlockIds: input.editedBlockIds },
    ...input.localRevision === true ? { localRevision: true } : {},
    ...input.localRevisionKind === undefined ? {} : { localRevisionKind: input.localRevisionKind },
    ...input.requestId === undefined ? {} : { requestId: input.requestId },
    callId: previous?.callId ?? input.revisionId,
    ...input.turn === undefined && previous?.turn === undefined ? {} : { turn: input.turn ?? previous?.turn },
    seq: previous?.seq ?? seq,
  })
  const latest = latestRecord(revisions)
  return {
    ...state,
    revisions,
    seq,
    ...latest === undefined ? {} : { latestRevisionId: latest.revisionId },
  }
}

/**
 * Build the program the stage card renders for one selected revision.
 *
 * The card keeps its own `callId` (stable DOM identity, `data-dsh-iui-call-id`)
 * while every program/revision identity comes from the selected revision, so
 * editing, history and runtime state address the revision the user sees.
 * @param cardProgram - the stage card's original program (DOM identity/running state).
 * @param record - selected revision record.
 * @returns the synthesized stage program.
 */
export function stageProgramFor(cardProgram: IntelligentUIProgram, record: ArtifactVersionRecord): IntelligentUIProgram {
  const styleSource = record.temporaryStyle !== undefined
    ? 'temporary' as const
    : record.styleId !== undefined ? 'template' as const : undefined
  // A fallback-redirected card must stay read-only only while the stage actually
  // displays the revision it fell back to: the marker drives edit/draft/runtime-
  // state/Save suppression. Selecting another revision restores normal editing.
  // The card-level marker belongs to the card's own redirected revision; a stage
  // displaying a fetched revision has no card-level redirect, so the record
  // marker written by forgetRevisionInState covers that case (that record *is*
  // the fallback target).
  const fallbackTarget = cardProgram.fallbackFrom === undefined ? undefined : cardProgram.revisionId
  const fallbackFrom = fallbackTarget !== undefined && fallbackTarget === record.revisionId
    ? cardProgram.fallbackFrom
    : record.redirectedFrom
  return {
    callId: cardProgram.callId,
    program: record.program,
    ...record.title === undefined ? {} : { title: record.title },
    style: record.style,
    ...record.styleId === undefined ? {} : { styleId: record.styleId },
    ...record.temporaryStyle === undefined ? {} : { temporaryStyle: record.temporaryStyle },
    ...styleSource === undefined ? {} : { styleSource },
    artifactId: record.artifactId,
    revisionId: record.revisionId,
    ...record.baseRevisionId === undefined ? {} : { baseRevisionId: record.baseRevisionId },
    revision: record.revision,
    ...record.editedBlockIds === undefined ? {} : { editedBlockIds: record.editedBlockIds },
    ...record.requestId === undefined ? {} : { requestId: record.requestId },
    ...record.localRevision === true ? { localRevision: true } : {},
    ...record.localRevisionKind === undefined ? {} : { localRevisionKind: record.localRevisionKind },
    ...fallbackFrom === undefined ? {} : { fallbackFrom },
    running: cardProgram.running,
  }
}

// ---------------------------------------------------------------------------
// Module store (React external store)
// ---------------------------------------------------------------------------

type Listener = () => void
const artifacts = new Map<string, ArtifactVersionState>()
const listeners = new Set<Listener>()
let artifactSnapshotCache = new Map<string, ArtifactVersionState>()
let selectedSnapshotCache = new Map<string, ReadonlySet<string>>()
let enabled = true
let seqCounter = 0

function stateKey(sessionId: string, artifactId: string): string {
  return `${sessionId}\u0000${artifactId}`
}

function artifactIdOfKey(key: string): string {
  return key.slice(key.indexOf('\u0000') + 1)
}

function publish(): void {
  artifactSnapshotCache = new Map()
  // The selected-id snapshot is content-compared below; keeping the cache lets
  // unchanged sessions keep the same Set identity and skip TurnTail rerenders.
  for (const listener of listeners) listener()
}

function commit(sessionId: string, artifactId: string, next: ArtifactVersionState): void {
  artifacts.set(stateKey(sessionId, artifactId), next)
  publish()
}

/** Whether the M1 stage behavior is enabled (production default true). */
export function isArtifactVersionStageEnabled(): boolean {
  return enabled
}

/**
 * Toggle the stage behavior. Disabling is a **test-only** switch used by the
 * browser harness to keep pre-M1 card-per-revision assertions meaningful; the
 * production client never calls it with `false`.
 */
export function setArtifactVersionStageEnabled(next: boolean): void {
  if (enabled === next) return
  enabled = next
  artifacts.clear()
  publish()
}

/** Drop every store entry (unit-test isolation; also used when disabling). */
export function resetArtifactVersions(): void {
  artifacts.clear()
  seqCounter = 0
  publish()
}

/** Current version state of one artifact. */
export function artifactVersionFor(sessionId: string, artifactId: string): ArtifactVersionState {
  return artifacts.get(stateKey(sessionId, artifactId)) ?? EMPTY_ARTIFACT_VERSION_STATE
}

/** Subscribe to any artifact version change in this client. */
export function subscribeArtifactVersions(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Reactive artifact version state for one card. */
export function useArtifactVersion(sessionId: string, artifactId: string): ArtifactVersionState {
  const read = useCallback(() => {
    const key = stateKey(sessionId, artifactId)
    const cached = artifactSnapshotCache.get(key)
    if (cached !== undefined) return cached
    const next = artifactVersionFor(sessionId, artifactId)
    artifactSnapshotCache.set(key, next)
    return next
  }, [sessionId, artifactId])
  return useSyncExternalStore(subscribeArtifactVersions, read, read)
}

/**
 * Register one mounted card; returns its unregister function for effect cleanup.
 * A no-op while the stage behavior is disabled (test harness switch).
 */
export function registerArtifactVersionCard(sessionId: string, spec: ArtifactVersionCardSpec): () => void {
  if (!enabled) return () => undefined
  seqCounter += 1
  const current = artifactVersionFor(sessionId, spec.artifactId)
  commit(sessionId, spec.artifactId, registerCardInState(current, spec, seqCounter))
  let released = false
  return () => {
    if (released) return
    released = true
    const state = artifacts.get(stateKey(sessionId, spec.artifactId))
    if (state === undefined) return
    commit(sessionId, spec.artifactId, unregisterCardInState(state, spec.cardId))
  }
}

/**
 * Refresh one mounted card's registration without releasing its role (F2/M2).
 * @param sessionId - chat session owning the card list.
 * @param artifactId - root artifact identity.
 * @param spec - refreshed card spec (same cardId).
 */
export function updateArtifactVersionCard(sessionId: string, artifactId: string, spec: ArtifactVersionCardSpec): void {
  if (!enabled) return
  seqCounter += 1
  const current = artifactVersionFor(sessionId, artifactId)
  commit(sessionId, artifactId, updateCardInState(current, spec, seqCounter))
}

/** Report the stage card's viewport intersection; stale cards are ignored. */
export function setArtifactStageVisibility(sessionId: string, artifactId: string, cardId: string, visible: boolean): void {
  if (!enabled) return
  const state = artifacts.get(stateKey(sessionId, artifactId))
  if (state === undefined || state.stageCardId !== cardId) return
  const next = setStageVisibilityInState(state, visible)
  if (next === state) return
  commit(sessionId, artifactId, next)
}

/**
 * Select one known revision for an artifact (M2 entry point; no Host write).
 * @param sessionId - chat session owning the card list.
 * @param artifactId - root artifact identity.
 * @param revisionId - revision to display in the stage.
 * @returns whether the selection changed.
 */
export function selectArtifactRevision(sessionId: string, artifactId: string, revisionId: string): boolean {
  if (!enabled) return false
  const state = artifacts.get(stateKey(sessionId, artifactId))
  if (state === undefined) return false
  const next = selectRevisionInState(state, revisionId)
  if (next === state) return false
  commit(sessionId, artifactId, next)
  return true
}

/**
 * Forget a deleted revision and repoint latest/selection at a live record.
 * @param sessionId - chat session.
 * @param artifactId - root artifact identity.
 * @param revisionId - deleted revision id.
 * @param fallback - prepared revision-fallback record, when one was written.
 */
export function forgetArtifactRevision(
  sessionId: string,
  artifactId: string,
  revisionId: string,
  fallback?: RevisionFallback,
): void {
  if (!enabled) return
  const state = artifacts.get(stateKey(sessionId, artifactId))
  if (state === undefined) return
  commit(sessionId, artifactId, forgetRevisionInState(state, revisionId, fallback))
}

/** Selected (and latest) revision ids of every artifact in one session. */
export function selectedArtifactRevisionIds(sessionId: string): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const [key, state] of artifacts) {
    if (!key.startsWith(`${sessionId}\u0000`)) continue
    if (state.selectedRevisionId !== undefined) ids.add(state.selectedRevisionId)
    if (state.latestRevisionId !== undefined) ids.add(state.latestRevisionId)
  }
  const cached = selectedSnapshotCache.get(sessionId)
  if (cached !== undefined && cached.size === ids.size && [...ids].every(id => cached.has(id))) return cached
  selectedSnapshotCache.set(sessionId, ids)
  return ids
}

/** Reactive selected/latest revision ids of one session (for delete guards). */
export function useSelectedArtifactRevisionIds(sessionId: string): ReadonlySet<string> {
  const read = useCallback(() => selectedArtifactRevisionIds(sessionId), [sessionId])
  return useSyncExternalStore(subscribeArtifactVersions, read, read)
}

/**
 * Register one revision record that has no mounted card yet (M2 on-demand
 * program fetch after selecting a historical revision).
 * @param sessionId - chat session.
 * @param artifactId - root artifact identity.
 * @param input - revision program/meta to remember.
 */
export function registerArtifactRevision(sessionId: string, artifactId: string, input: ArtifactVersionRecordInput): void {
  if (!enabled) return
  seqCounter += 1
  const current = artifactVersionFor(sessionId, artifactId)
  commit(sessionId, artifactId, registerRevisionInState(current, input, seqCounter))
}

/** Artifact ids currently owning a stage in one session (debugging/tests). */
export function stagedArtifactIds(sessionId: string): readonly string[] {
  const ids: string[] = []
  for (const [key, state] of artifacts) {
    if (!key.startsWith(`${sessionId}\u0000`)) continue
    if (state.stageCardId !== undefined) ids.push(artifactIdOfKey(key))
  }
  return ids
}
