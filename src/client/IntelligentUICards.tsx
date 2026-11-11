/**
 * Turn-tail cards for `render_ui` answers, plus the compact process row that
 * keeps the raw program out of the Tool list.
 *
 * Placement mirrors ui-plan / ui-deliverables: the plugin registers a
 * `conversation.chat.turnTail` list entry (session scope) whose inject factory
 * binds the Session's Chat target and reads the closing Turn's `tool-call`
 * nodes through the keyed `programs` hook. The slot owner passes the resolved
 * Turn location; components never see `ctx`.
 *
 * A card whose program exposes recognizable root blocks also offers block
 * editing: entering edit mode swaps the read-only body for the edit view while
 * the card itself (header, history entry, collapse) stays in place.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { RemixIcon } from '../lib/components/remix-icon.tsx'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MAX_ARTIFACT_BATCH_REQUESTS, MAX_ARTIFACT_DRAFTS } from '../shared/artifact-edit.ts'
import { MODE_PROJECTION_KEY, resultIdOf, type IntelligentUIModeView, type IntelligentUIProgram } from '../shared/intelligent-ui.ts'
import type { ArtifactStyleTarget } from '../shared/artifact-structure.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'
import { OpenUIRenderer } from '../lib/render.tsx'
import { resolveStyleThemeVars } from '../lib/style-theme.ts'
import { resolveCardTheme } from './export-html-plan.ts'
import type { StyleCatalog } from './styles.ts'
import { useStyleScheme } from './theme-mode.ts'
import { programsFromToolNodes, type ToolCallNode } from './programs.ts'
import { recordRuntimeState, runtimeStateForProgram } from './runtime-state.ts'
import { RendererBoundary } from './RendererBoundary.tsx'
import { fillComposer, type ComposerAccess } from './composer.ts'
import { SaveResultAction } from './SaveResultAction.tsx'
import { styleActions as defaultStyleActions, type StyleActions } from './style-actions.ts'
import { ArtifactEditView } from './artifact-edit/ArtifactEditView.tsx'
import { ArtifactHistory } from './artifact-edit/ArtifactHistory.tsx'
import { ArtifactVersionBar } from './artifact-edit/ArtifactVersionBar.tsx'
import { captureCardThumbnail, scheduleLazyThumbnail } from './artifact-edit/artifact-thumbnail-capture.ts'
import { deleteRevisionThumbnails, oppositeThumbnailScheme, saveArtifactThumbnail } from './artifact-edit/artifact-thumbnails.ts'
import { playStageFlip, type FlipRect } from './artifact-edit/stage-flip.ts'
import { ensureArtifactBase } from './artifact-edit/artifact-base.ts'
import { addLocalRevision, fetchArtifactStatus, localRevisionProgram, removeLocalRevision, restoreRevision, useLocalRevisions, type LocalArtifactRevision } from './artifact-edit/local-revisions.ts'
import { applyRevisionFallback, liveFallbackTargetIds, namedRevisionIds, recordRevisionFallback, resolveRevisionFallback, revisionFallbackMap, useRevisionFallbacks } from './artifact-edit/revision-fallbacks.ts'
import {
  artifactCardRole,
  forgetArtifactRevision,
  isArtifactVersionStageEnabled,
  registerArtifactVersionCard,
  updateArtifactVersionCard,
  selectArtifactRevision,
  setArtifactStageVisibility,
  stageProgramFor,
  useArtifactVersion,
  useSelectedArtifactRevisionIds,
  type ArtifactVersionCardSpec,
  type ArtifactCardRole,
} from './artifact-edit/artifact-version.ts'
import { isEditViewportWideEnough, MIN_EDIT_WIDTH, type ArtifactEditActions, type ArtifactEditSession, type ArtifactStyleTargetOption } from './artifact-edit/contracts.ts'
import type { ImageSourceResolver } from '../shared/image-source.ts'
import type { StyleTemplate } from '../shared/style-templates.ts'
import {
  activateDraft as activateArtifactDraft,
  attachDraft as attachArtifactDraft,
  activeDraftKeyFor,
  checkArtifactEditSendable,
  draftSessionFor,
  isArtifactEditSubmitted,
  unsentDraftRevisionIds,
  useArtifactEditStore,
  blocksForProgram,
  closeArtifactBlockEditor,
  applyEditRound,
  cancelApplyPreview as cancelArtifactApplyPreview,
  clearPendingStructureOps,
  closeArtifactEditor,
  clearAllArtifactEdits,
  previewPendingStructureOps,
  removePendingStructureOp,
  savePendingStructureOps,
  clearArtifactBlockInstruction,
  discardDraft as discardArtifactDraft,
  enableBranch as enableArtifactBranch,
  dismissArtifactApplyNotice,
  hasArtifactEditContent,
  noteArtifactApplyOutcome,
  moveArtifactBlock,
  moveArtifactBlocks,
  moveArtifactNestedBlock,
  moveArtifactNestedBlocks,
  moveArtifactNestedBlockBy,
  applyArtifactBlockProps,
  applyArtifactStyleSwitch,
  setArtifactStyleSwitchTarget,
  clearArtifactBlockPropsPreview,
  previewArtifactBlockProps,
  moveArtifactBlockBy,
  openArtifactBlockEditor,
  openArtifactEditor,
  removeArtifactSelection,
  resetArtifactOrder,
  resetArtifactNestedOrder,
  saveArtifactBlockAddition,
  removeArtifactBlockAddition,
  retryArtifactRevisionCheck,
  saveArtifactBlockInstruction,
  setArtifactDrawerOpen,
  setArtifactNestedMode,
  setArtifactStrictMode,
  setArtifactGlobalInstruction,
  setArtifactStyleEditSupported,
  setArtifactStyleInstruction,
  setArtifactPanelDirty,
  reconcileArtifactSubmissions,
  supportsBlockEditing,
  undoArtifactRemove,
  updateArtifactBlockDraft,
  useArtifactEditSession,
  useArtifactEditStore,
} from './artifact-edit/store.ts'
import { composerHasPlainText, requestArtifactAutoSubmit } from './artifact-edit/composer.ts'

/** Runtime kept mounted after exit so the panel can play its exit animation. */
const EDITOR_CLOSE_ANIMATION_MS = 320
/** Stable empty set for optional props that require a revision-id set. */
const EMPTY_ID_SET: ReadonlySet<string> = new Set()

/** Session-bound, Turn-keyed program source supplied by the plugin's registration. */
export interface IntelligentUICardsInjected {
  readonly sessionId: string
  readonly styles: StyleCatalog
  readonly styleActions?: StyleActions
  readonly adjustStyle?: (program: IntelligentUIProgram) => Promise<string | null>
  readonly readInput?: ComposerAccess['readInput']
  readonly focusComposer?: ComposerAccess['focusComposer']
  /** Reads one local image path for `Image`/Markdown in this Session's cards. */
  readonly resolveImage?: ImageSourceResolver
  readonly keyedHooks: {
    /**
     * The closing Turn's root Tool nodes in anchor order.
     * @param turn - resolved owning Turn as a string key.
     */
    readonly programs: (turn: string) => ObservableSnapshot<readonly ToolCallNode[]>
  }
}

/** Session projection reader supplied by the slot kit to every session-scoped slot. */
type SessionProjectionReader = (key: string) => IntelligentUIModeView | undefined

/** Harness/no-projection fallback; a stable function keeps the render hook order fixed. */
const noProjection: SessionProjectionReader = () => undefined

/**
 * Render every `render_ui` program recorded by the closing Turn.
 * @param props - closing Turn, Session input actions, injected program hook, projection reader and locale seat.
 * @returns one card per program, or null for a Turn that called no render_ui tool.
 */
export function IntelligentUICards({
  turn, inputActions, usePrograms, sessionId, styles, styleActions = defaultStyleActions, adjustStyle, readInput, focusComposer, resolveImage, useProjection, t = fallbackT,
}: PropsRuntime<'conversation.chat.turnTail'>
  & InjectFace<IntelligentUICardsInjected>
  & { readonly t?: Translate; readonly useProjection?: SessionProjectionReader }): ReactNode {
  const nodes = usePrograms(String(turn.turn))
  const programs = useMemo(() => programsFromToolNodes(nodes), [nodes])
  // Once the Turn is closed, submitted edit drafts either found their revision
  // in this Turn's cards or come back as failed drafts for an explicit retry.
  const reconciledTurn = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (turn.status !== 'closed') return
    const token = `${turn.turn}:${turn.end?.seq ?? 'closed'}`
    if (reconciledTurn.current === token) return
    reconciledTurn.current = token
    const until = turn.end?.time ?? Date.now()
    const since = turn.start?.time === undefined ? undefined : turn.start.time - 5000
    reconcileArtifactSubmissions(
      sessionId,
      programs.flatMap(program => program.requestId === undefined ? [] : [program.requestId]),
      { since, until },
    )
  }, [turn.status, turn.turn, turn.end?.seq, turn.end?.time, turn.start?.time, sessionId, programs])
  // Client-owned revision cards (restored without a model turn) belong to the
  // Turn that triggered the restore, so each one renders exactly once.
  const editStore = useArtifactEditStore()
  const draftRevisionIds = useMemo(() => unsentDraftRevisionIds(editStore.sessions, sessionId), [editStore, sessionId])
  const localRevisions = useLocalRevisions(sessionId)
  const localRevisionIds = useMemo(() => new Set(localRevisions.map(revision => revision.revisionId)), [localRevisions])
  const localPrograms = useMemo(() => localRevisions
    .filter(revision => revision.turn === turn.turn)
    .map(localRevisionProgram), [localRevisions, turn.turn])
  // A card whose rendered revision was deleted from history keeps its transcript
  // identity but renders the newest older revision instead (persisted fallback).
  const revisionFallbacks = useRevisionFallbacks(sessionId)
  const fallbacksByDeletedId = useMemo(() => revisionFallbackMap(revisionFallbacks), [revisionFallbacks])
  // Revisions some card currently rolls back to; deleting one without a new
  // target would strand that card on a deleted record. Dead records (whose
  // deleted revision no rendered program names anymore) are ignored. A stage can
  // display a revision whose own card is unloaded, so the selected/latest ids
  // count as rendered too.
  const selectedRevisionIds = useSelectedArtifactRevisionIds(sessionId)
  const renderedRevisionIds = useMemo(() => {
    const ids = new Set(namedRevisionIds([...programs, ...localPrograms]))
    for (const revisionId of selectedRevisionIds) ids.add(revisionId)
    return ids
  }, [programs, localPrograms, selectedRevisionIds])
  const fallbackTargetIds = useMemo(
    () => liveFallbackTargetIds(revisionFallbacks, renderedRevisionIds),
    [revisionFallbacks, renderedRevisionIds],
  )
  const redirectedPrograms = useMemo(() => programs.map(program => {
    const fallback = resolveRevisionFallback(fallbacksByDeletedId, program.revisionId)
    return fallback === undefined ? program : applyRevisionFallback(program, fallback)
  }), [programs, fallbacksByDeletedId])
  const allPrograms = useMemo(() => [...redirectedPrograms, ...localPrograms], [redirectedPrograms, localPrograms])
  const catalog = useSyncExternalStore(styles.subscribe, styles.getSnapshot, styles.getSnapshot)
  const scheme = useStyleScheme()
  // A theme-less result snapshot inherits the session's selected template; the
  // projection publishes the effective style id (a template id for saved styles).
  const modeView = (useProjection ?? noProjection)(MODE_PROJECTION_KEY)
  const sessionStyle = modeView?.style
  // B1 capability: an old Host without the bit keeps the legacy on-demand style
  // fallback; a pending style instruction is dropped so it is never sent to a
  // Host that cannot parse the style envelope.
  const styleEditSupported = modeView?.styleEdit === true
  const styleEditKnown = modeView !== undefined && modeView !== null
  useEffect(() => {
    if (styleEditKnown) setArtifactStyleEditSupported(styleEditSupported)
  }, [styleEditKnown, styleEditSupported])
  // B2 capability: deterministic style switching uses the same edit-panel style
  // section but a separate apply model (zero model turn, explicit Apply).
  const styleSwitchSupported = modeView?.styleSwitch === true
  // Durable targets: built-in Card/Article first, then the visible saved
  // templates (global plus this session's own).
  const styleSwitchTargets = useMemo<readonly ArtifactStyleTargetOption[]>(() => {
    if (!styleSwitchSupported) return []
    const builtins: ArtifactStyleTargetOption[] = [
      { target: { kind: 'builtin', layout: 'card' }, name: t('edit.historyStyleCard'), layout: 'card' },
      { target: { kind: 'builtin', layout: 'article' }, name: t('edit.historyStyleArticle'), layout: 'article', requiresArticleLayout: true },
    ]
    const templates = catalog.status === 'unavailable' ? [] : catalog.templates
    return [
      ...builtins,
      ...templates.map(template => ({
        target: { kind: 'template', styleId: template.id } as const,
        name: template.name,
        layout: template.baseLayout,
        ...(template.baseLayout === 'article' ? { requiresArticleLayout: true } : {}),
        theme: template.theme,
      })),
    ]
  }, [styleSwitchSupported, catalog, t])
  const refreshStyleCatalog = useCallback((): void => { void styles.refresh() }, [styles])
  useEffect(() => { void styles.ensure(sessionId) }, [styles, sessionId])
  // The renderer calls this when an in-card action should continue in the
  // composer: seed the draft with the model-authored message and submit it.
  const toAssistant = useCallback((message: string): void => {
    const actions = inputActions as InputActions | undefined
    if (actions === undefined) return
    try {
      actions.setDraft(message)
      actions.submit()
    } catch (error) {
      console.warn('[intelligent-ui] could not start a follow-up message', error)
    }
  }, [inputActions])
  const adjust = async (program: IntelligentUIProgram): Promise<string | null> => {
    const failure = await adjustStyle!(program)
    if (failure !== null) return t('onDemand.adjustError', { error: failure })
    const filled = inputActions !== undefined && readInput !== undefined
      && fillComposer(inputActions, readInput(), t('onDemand.adjustPrefix'), true)
    focusComposer?.()
    return filled ? null : t('onDemand.fillError')
  }
  if (allPrograms.length === 0) return null
  const documentRendered = allPrograms.some(isDocumentProgram)
  return (
    <div className="dsh-iui-cards" data-dsh-intelligent-ui-list data-dsh-iui-document-mode={documentRendered ? 'true' : undefined}>
      {allPrograms.map(program => isDocumentProgram(program) ? (
        <DocumentCard
          key={program.callId}
          program={program}
          scheme={scheme}
          t={t}
          onToAssistant={toAssistant}
          resolveImage={resolveImage}
        />
      ) : (
        <ArtifactVersionGate
          key={program.callId}
          sessionId={sessionId}
          turnNumber={turn.turn}
          program={program}
          templates={catalog.status === 'unavailable' ? [] : catalog.templates}
          sessionStyle={sessionStyle}
          scheme={scheme}
          t={t}
          onToAssistant={toAssistant}
          onAdjust={adjustStyle === undefined ? undefined : adjust}
          styleEditSupported={styleEditSupported}
          styleSwitchSupported={styleSwitchSupported}
          styleTargets={styleSwitchTargets}
          refreshStyleCatalog={refreshStyleCatalog}
          resolveImage={resolveImage}
          localRevisionIds={localRevisionIds}
          draftRevisionIds={draftRevisionIds}
          fallbackTargetIds={fallbackTargetIds}
          renderedRevisionIds={renderedRevisionIds}
          styleActions={styleActions}
          styles={styles}
          readInput={readInput}
          inputActions={inputActions}
        />
      ))}
    </div>
  )
}

/**
 * Whether one recorded program is an experimental document-mode answer. Only an
 * ordinary free-layout render can be one: on-demand results, artifact revisions
 * and saved-template pages keep the card chrome their flows depend on.
 * @param program - the extracted render_ui program.
 * @returns true when the Host recorded the document answer mode for this render.
 */
function isDocumentProgram(program: IntelligentUIProgram): boolean {
  return program.document === true
    && program.temporaryStyle === undefined
    && program.styleId === undefined
    && program.artifactId === undefined
    && program.revisionId === undefined
}

/**
 * One experimental document-mode answer: the rendered page reads as the chat
 * message body, so it has no card header, collapse control, border or actions.
 * @param props - extracted program, theme scheme, continuation callback and locale seat.
 * @returns the chrome-less document section.
 */
function DocumentCard({ program, scheme, onToAssistant, t, resolveImage }: {
  readonly program: IntelligentUIProgram
  readonly scheme: 'light' | 'dark'
  readonly onToAssistant: (message: string) => void
  readonly t: Translate
  readonly resolveImage?: ImageSourceResolver
}): ReactElement {
  const runtimeProgramRef = useMemo(() => ({
    artifactId: program.artifactId ?? program.callId,
    revisionId: program.revisionId ?? program.callId,
    baseRevisionId: program.baseRevisionId,
    callId: program.callId,
  }), [program.artifactId, program.revisionId, program.baseRevisionId, program.callId])
  const runtimeState = useMemo(() => runtimeStateForProgram(runtimeProgramRef), [runtimeProgramRef])
  const handleRuntimeStateChange = useCallback((state: Record<string, unknown>) => {
    recordRuntimeState(runtimeProgramRef, state)
  }, [runtimeProgramRef])
  return (
    <section
      className="dsh-iui-document"
      data-dsh-intelligent-ui="document"
      data-dsh-iui-document="true"
      data-dsh-iui-call-id={program.callId}
    >
      <RendererBoundary t={t}>
        <OpenUIRenderer
          program={program.program}
          title={program.title}
          scopeId={program.callId}
          onToAssistant={onToAssistant}
          scheme={scheme}
          t={t}
          runtimeState={runtimeState}
          onRuntimeStateChange={handleRuntimeStateChange}
          resolveImage={resolveImage}
        />
      </RendererBoundary>
    </section>
  )
}

/** Smooth scrolling unless the user asked for reduced motion. */
function scrollBehavior(): ScrollBehavior {
  if (typeof window.matchMedia !== 'function') return 'auto'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** Short card-header badge for one retained (non-active) draft. */
function draftBadgeLabel(session: ArtifactEditSession, t: Translate): string {
  if (session.status === 'conflict') return t('edit.conflictTitle')
  if (session.submitFailed === true) return t('edit.draftFailed')
  if (session.styleInstruction.trim() !== '') return `${t('edit.pendingDrafts')} · ${t('edit.chipTail.style')}`
  const count = session.selection.length
  if (count > 0) return `${t('edit.pendingDrafts')} · ${t('edit.requestsCount', { count })}`
  if (session.orderChanged) return `${t('edit.pendingDrafts')} · ${t('edit.summaryOrderChanged')}`
  return `${t('edit.pendingDrafts')} · ${t('edit.summaryGlobal')}`
}

/** Whether two durable style targets name the same identity. */
function isSameStyleTarget(left: ArtifactStyleTarget, right: ArtifactStyleTarget): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'builtin') return right.kind === 'builtin' && left.layout === right.layout
  return right.kind === 'template' && left.styleId === right.styleId
}

/** Scroll the active stage card of one artifact into view and focus it. */
function stageCardSelector(artifactId: string): string {
  const escaped = typeof CSS === 'undefined' ? artifactId.replace(/["\\]/g, '\\$&') : CSS.escape(artifactId)
  return `[data-dsh-iui-stage-card][data-artifact-id="${escaped}"]`
}

/** Scroll the active stage card of one artifact into view and focus it. */
function scrollToStageCard(artifactId: string): void {
  if (typeof document === 'undefined') return
  const element = document.querySelector<HTMLElement>(stageCardSelector(artifactId))
  if (element === null) return
  element.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
  element.focus({ preventScroll: true })
}

/** Revision provenance recorded with the version store entry. */
function versionSourceOf(program: IntelligentUIProgram): 'initial' | 'edit' | 'local' {
  if (program.localRevision === true) return 'local'
  return program.revision === undefined || program.revision <= 1 ? 'initial' : 'edit'
}

interface ArtifactVersionGateProps {
  readonly sessionId: string
  readonly turnNumber: number
  readonly program: IntelligentUIProgram
  readonly templates: readonly StyleTemplate[]
  readonly sessionStyle?: string
  readonly scheme: 'light' | 'dark'
  readonly t: Translate
  readonly onToAssistant: (message: string) => void
  readonly onAdjust?: (program: IntelligentUIProgram) => Promise<string | null>
  readonly styleEditSupported: boolean
  readonly styleSwitchSupported: boolean
  readonly styleTargets: readonly ArtifactStyleTargetOption[]
  readonly refreshStyleCatalog: () => void
  readonly resolveImage?: ImageSourceResolver
  readonly localRevisionIds: ReadonlySet<string>
  readonly draftRevisionIds: ReadonlySet<string>
  readonly fallbackTargetIds: ReadonlySet<string>
  readonly renderedRevisionIds: ReadonlySet<string>
  readonly styleActions: StyleActions
  readonly styles: StyleCatalog
  /** Composer reader plus Send verb for the post-Apply auto-submit probe. */
  readonly readInput?: ComposerAccess['readInput']
  readonly inputActions?: InputActions
}

/**
 * Version-gate for one card: registers it in the artifact version store and
 * renders the role the store assigns (stage / compact notice / frozen history
 * card). When the stage behavior is disabled (the browser harness switch) the
 * card renders exactly as before.
 * @param props - card program plus the shared card chrome props.
 * @returns one card, a notice row, or nothing while the store has no role yet.
 */
function ArtifactVersionGate(props: ArtifactVersionGateProps): ReactElement | null {
  const { program, sessionId, turnNumber, t } = props
  const artifactId = program.artifactId ?? program.callId
  const cardId = program.callId
  // Re-parsing a Turn's tool nodes produces fresh program objects, so the
  // registration spec is memoized on the primitive fields that matter: a card is
  // not unregistered/re-registered (which would drop its stage visibility)
  // unless its revision program or metadata actually changed.
  const temporaryStyleKey = program.temporaryStyle === undefined ? '' : JSON.stringify(program.temporaryStyle)
  const editedBlockIdsKey = program.editedBlockIds === undefined ? '' : program.editedBlockIds.join(',')
  const spec = useMemo<ArtifactVersionCardSpec>(() => ({
    cardId,
    artifactId,
    revisionId: program.revisionId ?? program.callId,
    ...program.revision === undefined ? {} : { revision: program.revision },
    turn: turnNumber,
    program: program.program,
    ...program.title === undefined ? {} : { title: program.title },
    style: program.style ?? 'card',
    ...program.styleId === undefined ? {} : { styleId: program.styleId },
    ...program.temporaryStyle === undefined ? {} : { temporaryStyle: program.temporaryStyle },
    ...program.baseRevisionId === undefined ? {} : { baseRevisionId: program.baseRevisionId },
    ...program.editedBlockIds === undefined ? {} : { editedBlockIds: program.editedBlockIds },
    ...program.localRevision === true ? { localRevision: true } : {},
    ...program.localRevisionKind === undefined ? {} : { localRevisionKind: program.localRevisionKind },
    ...program.requestId === undefined ? {} : { requestId: program.requestId },
    source: versionSourceOf(program),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by serialized fields above
  }), [
    artifactId,
    cardId,
    program.callId,
    program.program,
    program.title,
    program.style,
    program.styleId,
    program.baseRevisionId,
    program.revision,
    program.revisionId,
    program.requestId,
    program.localRevision,
    program.localRevisionKind,
    temporaryStyleKey,
    editedBlockIdsKey,
    turnNumber,
  ])
  // F2: a spec refresh (fallback redirect, restyle, re-parsed Turn) updates the
  // existing registration in place; only unmount releases it. Unregistering first
  // would hand the stage over to another card and leave a read-only duplicate.
  const registrationRef = useRef<{ sessionId: string; spec: ArtifactVersionCardSpec; unregister: () => void } | null>(null)
  useLayoutEffect(() => {
    if (!isArtifactVersionStageEnabled()) return
    const previous = registrationRef.current
    if (previous !== null && previous.sessionId === sessionId) {
      if (previous.spec === spec) return
      previous.spec = spec
      updateArtifactVersionCard(sessionId, artifactId, spec)
      return
    }
    if (previous !== null) {
      previous.unregister()
      registrationRef.current = null
    }
    registrationRef.current = { sessionId, spec, unregister: registerArtifactVersionCard(sessionId, spec) }
  }, [sessionId, artifactId, spec])
  useLayoutEffect(() => () => {
    registrationRef.current?.unregister()
    registrationRef.current = null
  }, [])
  const state = useArtifactVersion(sessionId, artifactId)
  const reportVisibility = useCallback((visible: boolean): void => {
    setArtifactStageVisibility(sessionId, artifactId, cardId, visible)
  }, [sessionId, artifactId, cardId])
  const scrollToStage = useCallback((): void => { scrollToStageCard(artifactId) }, [artifactId])
  const stageEnabled = isArtifactVersionStageEnabled()
  const role: ArtifactCardRole | undefined = stageEnabled ? artifactCardRole(state, cardId) : undefined
  const cardRecord = state.cards.get(cardId)
  if (stageEnabled && role === 'notice') {
    const revision = cardRecord?.revision ?? 1
    return (
      <button
        type="button"
        className="dsh-iui-revision-notice"
        data-dsh-iui-revision-notice
        data-dsh-iui-artifact-id={artifactId}
        data-dsh-iui-revision-id={cardRecord?.revisionId ?? program.revisionId ?? program.callId}
        aria-label={t('version.noticeAction', { n: revision })}
        title={t('version.noticeAction', { n: revision })}
        onClick={scrollToStage}
      >
        <RemixIcon name="history-line" size={14} />
        <span className="dsh-iui-revision-notice-text">{t('version.notice', { n: revision })}</span>
        <span className="dsh-iui-revision-notice-arrow" aria-hidden="true"><RemixIcon name="arrow-up-s-line" size={13} /></span>
      </button>
    )
  }
  const selectedRecord = state.selectedRevisionId === undefined ? undefined : state.revisions.get(state.selectedRevisionId)
  const effective = stageEnabled && role === 'stage' && selectedRecord !== undefined
    ? stageProgramFor(program, selectedRecord)
    : program
  const theme = resolveCardTheme(effective, props.templates, props.sessionStyle)
  // The stage is the single editing surface: when it displays a revision that a
  // frozen card natively owns, that historical card goes read-only instead, so
  // only one card ever mounts the revision's edit canvas (D10 old-version editing).
  const readOnlyFrozen = stageEnabled && role === 'frozen'
    && state.selectedRevisionId !== undefined && state.selectedRevisionId === cardRecord?.revisionId
  const staleHint = stageEnabled && role === 'frozen'
    ? <button
        type="button"
        className="dsh-iui-stage-stale-hint"
        data-dsh-iui-stage-stale-hint
        aria-label={t('version.staleHintAction')}
        title={t('version.staleHintAction')}
        onClick={scrollToStage}
      >
        <span className="dsh-iui-stage-stale-icon" aria-hidden="true"><RemixIcon name="arrow-down-s-line" size={13} /></span>
        {t('version.staleHint')}
      </button>
    : undefined
  return (
    <IntelligentUICard
      program={effective}
      sessionId={sessionId}
      turnNumber={turnNumber}
      onToAssistant={props.onToAssistant}
      t={t}
      scheme={props.scheme}
      onAdjust={props.onAdjust}
      styleEditSupported={props.styleEditSupported}
      styleSwitchSupported={props.styleSwitchSupported}
      styleTargets={props.styleTargets}
      refreshStyleCatalog={props.refreshStyleCatalog}
      resolveImage={props.resolveImage}
      localRevisionIds={props.localRevisionIds}
      draftRevisionIds={props.draftRevisionIds}
      fallbackTargetIds={props.fallbackTargetIds}
      renderedRevisionIds={props.renderedRevisionIds}
      versionRole={stageEnabled ? role : undefined}
      artifactIdentity={stageEnabled ? artifactId : undefined}
      stageVisible={state.stageVisible}
      onStageVisibleChange={stageEnabled && role === 'stage' ? reportVisibility : undefined}
      staleHint={staleHint}
      readOnly={readOnlyFrozen}
      templates={props.templates}
      sessionStyle={props.sessionStyle}
      versionBarAvailable={stageEnabled && role === 'stage'}
      captureThumbnail={stageEnabled && role === 'stage' && selectedRecord !== undefined && effective.running !== true
        ? { artifactId, revisionId: selectedRecord.revisionId, scheme: props.scheme }
        : undefined}
      // Saving a style needs a palette to copy, so a theme-less snapshot cannot offer it.
      saveAction={effective.fallbackFrom !== undefined || effective.temporaryStyle?.theme === undefined ? undefined : <SaveResultAction resultId={resultIdOf(effective)}
        snapshot={effective.temporaryStyle} sessionId={sessionId} actions={props.styleActions} styles={props.styles} disabled={effective.running} t={t} />}
      // Snapshot theme wins; a theme-less snapshot inherits the session's
      // selected template, then the built-in theme.
      themeStyle={theme === undefined ? undefined : resolveStyleThemeVars(theme, props.scheme) as CSSProperties}
      readInput={props.readInput}
      inputActions={props.inputActions}
    />
  )
}

interface IntelligentUICardProps {
  readonly program: IntelligentUIProgram
  readonly sessionId: string
  /** Loaded Turn that owns this card; restored local cards render in the same Turn. */
  readonly turnNumber: number
  readonly onToAssistant: (message: string) => void
  readonly t: Translate
  readonly themeStyle?: CSSProperties
  readonly scheme: 'light' | 'dark'
  readonly onAdjust?: (program: IntelligentUIProgram) => Promise<string | null>
  readonly saveAction?: ReactNode
  /** Host supports revision-bound style editing inside the edit canvas. */
  readonly styleEditSupported?: boolean
  /** Host supports deterministic zero-model style switching. */
  readonly styleSwitchSupported?: boolean
  /** Durable targets offered by the switch picker. */
  readonly styleTargets?: readonly ArtifactStyleTargetOption[]
  /** Catalog refresh hook used when the Host reports a missing style. */
  readonly refreshStyleCatalog?: () => void
  /** Reads one local image path for `Image`/Markdown in this card. */
  readonly resolveImage?: ImageSourceResolver
  /** Revision ids owned by client-local revision cards (deletion removes them). */
  readonly localRevisionIds?: ReadonlySet<string>
  /** Revision ids that an unsent draft in this chat is editing. */
  readonly draftRevisionIds?: ReadonlySet<string>
  /** Revisions that a persisted card fallback currently renders. */
  readonly fallbackTargetIds?: ReadonlySet<string>
  /** Revision identities still named by the rendered card programs. */
  readonly renderedRevisionIds?: ReadonlySet<string>
  /** Active-stage role from the version store; absent when the stage is disabled. */
  readonly versionRole?: ArtifactCardRole
  /** Root artifact identity the stage belongs to (stage cards only). */
  readonly artifactIdentity?: string
  /** Whether the stage card currently intersects the viewport. */
  readonly stageVisible?: boolean
  /** Reports the stage card's viewport intersection to the version store. */
  readonly onStageVisibleChange?: (visible: boolean) => void
  /** Light hint on a frozen historical card pointing at the active stage. */
  readonly staleHint?: ReactNode
  /** Suppress editing (a stage displaying a revision another card natively owns). */
  readonly readOnly?: boolean
  /** Visible saved templates, used by lazy version-bar thumbnail renders. */
  readonly templates?: readonly StyleTemplate[]
  /** Session-selected template id, used by lazy version-bar thumbnail renders. */
  readonly sessionStyle?: string
  /** The M1 stage card: its history icon opens the version bar. */
  readonly versionBarAvailable?: boolean
  /** Displayed revision to auto-capture as a version-bar thumbnail. */
  readonly captureThumbnail?: { readonly artifactId: string; readonly revisionId: string; readonly scheme: 'light' | 'dark' }
  /** Composer reader plus Send verb for the post-Apply auto-submit probe. */
  readonly readInput?: ComposerAccess['readInput']
  readonly inputActions?: InputActions
}

/**
 * One full-width card: a native header with title and collapse control, and
 * the renderer body. The body never clips; the renderer owns horizontal
 * scrolling for wide tables and charts.
 * @param props - extracted program, the composer continuation callback, and the locale seat.
 * @returns the card.
 */
function IntelligentUICard({ program, sessionId, turnNumber, onToAssistant, t, themeStyle, scheme, onAdjust, saveAction, styleEditSupported = false, styleSwitchSupported = false, styleTargets, refreshStyleCatalog, resolveImage, localRevisionIds, draftRevisionIds, fallbackTargetIds, renderedRevisionIds, versionRole, artifactIdentity, stageVisible, onStageVisibleChange, staleHint, readOnly = false, templates, sessionStyle, versionBarAvailable = false, captureThumbnail, readInput, inputActions }: IntelligentUICardProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Block editing needs a usable two-pane width; tiny viewports get a hint.
  const [narrowNotice, setNarrowNotice] = useState(false)
  // Multi-draft notices: draft cap reached, and a detached draft (chip removed).
  const [limitNotice, setLimitNotice] = useState(false)
  const [detachedNotice, setDetachedNotice] = useState(false)
  const [restoreState, setRestoreState] = useState<'checking' | 'available' | 'busy' | 'done' | 'error' | 'hidden'>('checking')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versionBarOpen, setVersionBarOpen] = useState(false)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const [restoredRevision, setRestoredRevision] = useState<number | undefined>()
  /** Transient switch preview target; swaps the edit-canvas skin with no request. */
  const [stylePreview, setStylePreview] = useState<ArtifactStyleTarget | undefined>(undefined)
  const cardRef = useRef<HTMLElement>(null)
  const skipActivationScroll = useRef(false)
  const adjust = async (): Promise<void> => {
    if (onAdjust === undefined || adjusting) return
    setAdjusting(true)
    setError(null)
    try { setError(await onAdjust(program)) }
    catch (reason) { setError(t('onDemand.adjustError', { error: reason instanceof Error ? reason.message : String(reason) })) }
    finally { setAdjusting(false) }
  }
  const bodyId = useId()
  const title = program.title !== undefined && program.title.trim() !== '' ? program.title : t('card.title')
  const style = program.style ?? 'card'
  // One history entry: the clock icon carries the revision number once the card
  // renders an edited revision, so the old standalone revision badge is gone.
  const historyRevision = program.revision !== undefined && program.revision > 1 ? program.revision : undefined
  const historyLabel = historyRevision === undefined
    ? t('edit.historyOpen')
    : `${t('edit.historyOpen')} · ${t('edit.revision', { n: historyRevision })}`
  const baseRevisionId = program.revisionId ?? program.callId
  // B2-6: a new revision card restores the runtime state of the revision it was
  // edited from; the mount reports its own latest state back for the next edit.
  const runtimeProgramRef = useMemo(() => program.fallbackFrom !== undefined ? undefined : ({
    artifactId: program.artifactId ?? program.callId,
    revisionId: program.revisionId ?? program.callId,
    baseRevisionId: program.baseRevisionId,
    callId: program.callId,
  }), [program.artifactId, program.revisionId, program.baseRevisionId, program.callId, program.fallbackFrom])
  const runtimeState = useMemo(() => runtimeProgramRef === undefined ? undefined : runtimeStateForProgram(runtimeProgramRef), [runtimeProgramRef])
  const handleRuntimeStateChange = useCallback((state: Record<string, unknown>) => {
    if (runtimeProgramRef !== undefined) recordRuntimeState(runtimeProgramRef, state)
  }, [runtimeProgramRef])
  const editKey = `${sessionId}:${baseRevisionId}`
  const editSession = useArtifactEditSession(sessionId, baseRevisionId)
  const editStore = useArtifactEditStore()
  // A redirected card renders a revision another card may own. It must not join
  // that revision's shared edit session, or two cards mount the same canvas.
  // The same applies to a stage that displays a revision a frozen card owns.
  const readOnlyCard = readOnly || program.fallbackFrom !== undefined
  const editing = !readOnlyCard && editSession?.editing === true
  // The edit view stays mounted for one short exit animation after `editing`
  // flips false; the timer is cancelled if the user re-enters edit mode first.
  const [editorMounted, setEditorMounted] = useState(editing)
  const [editorClosing, setEditorClosing] = useState(false)
  const lastEditSessionRef = useRef<ArtifactEditSession | undefined>(undefined)
  useEffect(() => {
    if (editSession !== undefined) lastEditSessionRef.current = editSession
  }, [editSession])
  useEffect(() => {
    if (readOnlyCard) {
      setEditorClosing(false)
      setEditorMounted(false)
      return
    }
    if (editing) {
      setEditorClosing(false)
      setEditorMounted(true)
      return
    }
    if (!editorMounted) return
    // Switching the edit canvas to another draft replaces this editor
    // immediately; only a real close (no active draft key) animates out.
    const activeKey = activeDraftKeyFor(sessionId)
    if (activeKey !== undefined && activeKey !== editKey) {
      setEditorClosing(false)
      setEditorMounted(false)
      return
    }
    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setEditorClosing(false)
      setEditorMounted(false)
      return
    }
    setEditorClosing(true)
    const timer = window.setTimeout(() => {
      setEditorClosing(false)
      setEditorMounted(false)
    }, EDITOR_CLOSE_ANIMATION_MS)
    return () => { window.clearTimeout(timer) }
  }, [editing, editorMounted, editStore, editKey, sessionId, readOnlyCard])
  // The stage card reports its viewport intersection so a later revision can be
  // rendered in place (visible) or promoted to a new stage card (invisible).
  useEffect(() => {
    const notify = onStageVisibleChange
    const element = cardRef.current
    if (notify === undefined || element === null || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1]
      if (entry !== undefined) notify(entry.isIntersecting)
    }, { rootMargin: '0px 0px 24px 0px', threshold: 0 })
    observer.observe(element)
    return () => { observer.disconnect(); notify(false) }
  }, [onStageVisibleChange])

  const hasDraft = editSession !== undefined && hasArtifactEditContent(editSession)
  const showDraftBadge = !readOnlyCard && editSession !== undefined && !editing
    && editSession.status !== 'submitted' && hasDraft
  const attachedDraftTotal = useMemo(() => {
    let count = 0
    for (const candidate of editStore.sessions.values()) {
      if (candidate.sessionId !== sessionId || candidate.status === 'submitted') continue
      if (candidate.attached && hasArtifactEditContent(candidate)) count += 1
    }
    return count
  }, [editStore, sessionId])
  const blocks = useMemo(() => blocksForProgram(program.program).blocks, [program.program])
  const blocksById = useMemo(() => new Map(blocks.map(block => [block.blockId, block])), [blocks])
  // A redirected card is read-only: the fallback revision may already have a
  // native card that owns its edit session (both would share the same edit key).
  const editable = !readOnlyCard && !program.running
    && blocks.length > 0 && supportsBlockEditing(program)
  // A hovered/focused/selected switch row previews its durable skin in the edit
  // canvas only; nothing is posted until the explicit Apply.
  const stylePreviewOption = stylePreview === undefined
    ? undefined
    : styleTargets?.find(option => isSameStyleTarget(option.target, stylePreview))
  const editorLayout = editing && stylePreview !== undefined
    ? (stylePreviewOption?.layout ?? (stylePreview.kind === 'builtin' ? stylePreview.layout : style))
    : style
  const editorThemeStyle = editing && stylePreview !== undefined
    ? (stylePreviewOption?.theme === undefined ? undefined : resolveStyleThemeVars(stylePreviewOption.theme, scheme) as CSSProperties)
    : themeStyle
  const editActions = useMemo<ArtifactEditActions>(() => ({
    openBlockEditor: blockId => { openArtifactBlockEditor(editKey, blockId) },
    closeBlockEditor: () => { closeArtifactBlockEditor(editKey) },
    updateBlockDraft: (blockId, text) => { updateArtifactBlockDraft(editKey, blockId, text) },
    saveBlockInstruction: (blockId, text) => { saveArtifactBlockInstruction(editKey, blockId, text) },
    clearBlockInstruction: blockId => { clearArtifactBlockInstruction(editKey, blockId) },
    previewBlockProps: (blockId, props) => { previewArtifactBlockProps(editKey, blockId, props) },
    clearBlockPropsPreview: () => { clearArtifactBlockPropsPreview(editKey) },
    applyBlockProps: (blockId, props) => { void applyArtifactBlockProps(editKey, blockId, props, turnNumber) },
    removeSelection: blockId => { removeArtifactSelection(editKey, blockId) },
    undoRemove: () => { undoArtifactRemove(editKey) },
    moveBlock: (blockId, toIndex) => { moveArtifactBlock(editKey, blockId, toIndex) },
    moveBlockBy: (blockId, delta) => { moveArtifactBlockBy(editKey, blockId, delta) },
    moveBlocks: (blockIds, mode) => { moveArtifactBlocks(editKey, blockIds, mode) },
    moveNestedBlocks: (blockIds, mode) => { moveArtifactNestedBlocks(editKey, blockIds, mode) },
    resetOrder: () => { resetArtifactOrder(editKey) },
    clearAllEdits: () => { clearAllArtifactEdits(editKey) },
    setGlobalInstruction: text => { setArtifactGlobalInstruction(editKey, text) },
    setStyleInstruction: text => { setArtifactStyleInstruction(editKey, text) },
    selectStyleTarget: (target, layout) => { setArtifactStyleSwitchTarget(editKey, target, layout) },
    applyStyleSwitch: () => {
      setStylePreview(undefined)
      void applyArtifactStyleSwitch(editKey, turnNumber, refreshStyleCatalog)
    },
    closeEditor: () => { closeArtifactEditor(editKey) },
    setDrawerOpen: open => { setArtifactDrawerOpen(editKey, open) },
    retryCheck: () => { retryArtifactRevisionCheck(editKey) },
    setNestedMode: (key, enabled) => { setArtifactNestedMode(key, enabled) },
    setStrictMode: (key, enabled) => { setArtifactStrictMode(key, enabled) },
    moveNestedBlock: (parentBlockId, blockId, toIndex) => { moveArtifactNestedBlock(editKey, parentBlockId, blockId, toIndex) },
    moveNestedBlockBy: (parentBlockId, blockId, delta) => { moveArtifactNestedBlockBy(editKey, parentBlockId, blockId, delta) },
    resetNestedOrder: () => { resetArtifactNestedOrder(editKey) },
    saveBlockAddition: (parentBlockId, instruction) => { saveArtifactBlockAddition(editKey, parentBlockId, instruction) },
    removeBlockAddition: (parentBlockId) => { removeArtifactBlockAddition(editKey, parentBlockId) },
    savePendingOps: inputs => savePendingStructureOps(editKey, inputs),
    removePendingOp: id => { removePendingStructureOp(editKey, id) },
    clearPendingOps: () => { clearPendingStructureOps(editKey) },
    previewApply: () => previewPendingStructureOps(editKey),
    cancelApplyPreview: () => { cancelArtifactApplyPreview(editKey) },
    applyRound: async () => {
      const result = await applyEditRound(editKey, turnNumber)
      if (result.status !== 'needSend' || result.referenceId === undefined || result.newKey === undefined) return result
      const rebased = draftSessionFor(result.newKey)
      // A detached draft must not send itself: the user removed its chip on
      // purpose, so the round only leaves the request for an explicit attach and
      // says so instead of silently doing nothing.
      if (rebased?.attached !== true) {
        noteArtifactApplyOutcome(result.newKey, 'detached')
        return { ...result, autoSubmit: 'detached' as const }
      }
      const state = readInput?.()
      if (state !== undefined && composerHasPlainText(state)) {
        noteArtifactApplyOutcome(result.newKey, 'extraText')
        return { ...result, autoSubmit: 'extraText' as const }
      }
      // Only ask the composer to Send a request the chip codec would accept;
      // otherwise the user keeps the chip and sends after fixing the draft.
      const sendable = await checkArtifactEditSendable(result.referenceId)
      if (!sendable.ok) {
        noteArtifactApplyOutcome(result.newKey, 'manual')
        return { ...result, autoSubmit: 'manual' as const }
      }
      const submitted = await requestArtifactAutoSubmit({
        readInput: () => readInput?.(),
        isSubmitted: referenceId => isArtifactEditSubmitted(referenceId),
        ...(inputActions as { submit?: () => void } | undefined)?.submit === undefined
          ? {}
          : { submit: (inputActions as { submit: () => void }).submit },
      }, sessionId, result.referenceId)
      noteArtifactApplyOutcome(result.newKey, submitted ? 'submitted' : 'manual')
      return { ...result, autoSubmit: submitted ? 'submitted' as const : 'manual' as const }
    },
    setPanelDirty: dirty => { setArtifactPanelDirty(editKey, dirty) },
    dismissApplyNotice: () => { dismissArtifactApplyNotice(editKey) },
    enableBranch: () => { enableArtifactBranch(editKey) },
    activateDraft: key => { activateArtifactDraft(key) },
    attachDraft: key => { attachArtifactDraft(key) },
    discardDraft: (key, confirm) => { discardArtifactDraft(key, confirm) },
  }), [editKey, turnNumber, refreshStyleCatalog, readInput, inputActions, sessionId])

  // Capture one thumbnail for the revision the stage displays (M2/D9): fonts,
  // two frames and the capture module's short settle budget run asynchronously;
  // failure only leaves the version bar placeholder. Re-captures when the
  // displayed revision, the scheme or the editing state changes.
  useEffect(() => {
    const target = captureThumbnail
    if (target === undefined) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled || editing) return
        const element = cardRef.current
        if (element === null) return
        const thumbnail = await captureCardThumbnail(element)
        if (cancelled || thumbnail === undefined) return
        const capturedScheme = target.scheme
        saveArtifactThumbnail({ artifactId: target.artifactId, revisionId: target.revisionId, scheme: capturedScheme }, thumbnail)
        // D5: keep one image per scheme. The live card only exists in the current
        // scheme, so the other one is rendered off-screen with its own theme vars.
        const otherScheme = oppositeThumbnailScheme(capturedScheme)
        const theme = resolveCardTheme(program, templates ?? [], sessionStyle)
        scheduleLazyThumbnail({
          parts: { artifactId: target.artifactId, revisionId: target.revisionId, scheme: otherScheme },
          program: program.program,
          ...program.title === undefined ? {} : { title: program.title },
          style: program.style ?? 'card',
          ...theme === undefined ? {} : { themeStyle: resolveStyleThemeVars(theme, otherScheme) as CSSProperties },
          scheme: otherScheme,
          t,
          ...resolveImage === undefined ? {} : { resolveImage },
        })
      })()
    }, 80)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [captureThumbnail?.artifactId, captureThumbnail?.revisionId, captureThumbnail?.scheme, editing])

  // Leaving edit mode always drops a transient switch preview.
  useEffect(() => {
    if (!editing) setStylePreview(undefined)
  }, [editing])

  // Switching the active draft (from this card or the panel switcher) brings
  // the newly active card back into view. Opening the canvas from this card's
  // own entry is already in view, so it skips the jump.
  useEffect(() => {
    if (!editing) return
    if (skipActivationScroll.current) { skipActivationScroll.current = false; return }
    cardRef.current?.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
  }, [editing])

  // A just-activated draft that could not join the batch says so inline.
  useEffect(() => {
    if (!editing || editSession === undefined) { setDetachedNotice(false); return }
    setDetachedNotice(!editSession.attached)
  }, [editing, editSession?.attached, editSession?.key])

  // Offer the zero-model restore only for revisions that are no longer the head.
  const restoreArtifactId = program.artifactId ?? program.callId
  const restoreRevisionId = program.revisionId ?? program.callId
  useEffect(() => {
    if (program.localRevision === true || program.running) return
    let cancelled = false
    void fetchArtifactStatus(restoreArtifactId, restoreRevisionId).then(status => {
      if (cancelled) return
      setRestoreState(status?.conflict === true ? 'available' : 'hidden')
    })
    return () => { cancelled = true }
  }, [restoreArtifactId, restoreRevisionId, program.localRevision, program.running])
  const restore = async (): Promise<void> => {
    if (restoreState !== 'available') return
    setRestoreState('busy')
    // Restore records Host state for this artifact: register the rendered base
    // first (one shared request per card; no-op once the Host knows it).
    await ensureArtifactBase({ artifactId: restoreArtifactId, revisionId: restoreRevisionId, program: program.program })
    const revision = await restoreRevision({ artifactId: restoreArtifactId, sourceRevisionId: restoreRevisionId, program: program.program })
    if (revision === undefined) { setRestoreState('error'); return }
    addLocalRevision(sessionId, { ...revision, turn: turnNumber })
    setRestoredRevision(revision.revision)
    setRestoreState('done')
  }
  // A restore triggered from the history dialog reuses the same local-revision
  // pipeline as the inline restore action; addLocalRevision renders the card.
  const handleHistoryRestored = (revision: LocalArtifactRevision): void => {
    addLocalRevision(sessionId, { ...revision, turn: turnNumber })
    setRestoredRevision(revision.revision)
    setRestoreState('done')
  }

  /** Close the version bar; an explicit close returns focus to its trigger. */
  const closeVersionBar = useCallback((restoreFocus: boolean): void => {
    setVersionBarOpen(false)
    if (!restoreFocus) return
    window.requestAnimationFrame(() => { historyButtonRef.current?.focus({ preventScroll: true }) })
  }, [])

  /** Apply a version-bar selection to the stage, then play the FLIP hand-off. */
  const handleVersionSelect = useCallback((revisionId: string, animation?: { readonly start: FlipRect; readonly imageUrl: string }): void => {
    setVersionBarOpen(false)
    const changed = selectArtifactRevision(sessionId, restoreArtifactId, revisionId)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!changed) { historyButtonRef.current?.focus({ preventScroll: true }); return }
        const stage = cardRef.current
        if (stage === null) return
        if (animation !== undefined) void playStageFlip({ start: animation.start, imageUrl: animation.imageUrl, stageElement: stage })
        stage.focus({ preventScroll: true })
      })
    })
  }, [sessionId, restoreArtifactId])

  const toggleEditing = (): void => {
    if (editing) { closeArtifactEditor(editKey); return }
    if (typeof window !== 'undefined' && !isEditViewportWideEnough(window.innerWidth)) {
      setNarrowNotice(true)
      return
    }
    setNarrowNotice(false)
    skipActivationScroll.current = true
    const result = openArtifactEditor(sessionId, program)
    if (result.ok) {
      setLimitNotice(false)
      return
    }
    skipActivationScroll.current = false
    if (result.reason === 'limit') setLimitNotice(true)
  }
  return (
    <section
      ref={cardRef}
      className="dsh-iui-card"
      data-dsh-intelligent-ui="card"
      data-dsh-iui-call-id={program.callId}
      data-dsh-iui-stage-card={versionRole === 'stage' ? 'true' : undefined}
      data-dsh-iui-stage-visible={versionRole === 'stage' ? (stageVisible === true ? 'true' : 'false') : undefined}
      data-artifact-id={artifactIdentity}
      tabIndex={versionRole === 'stage' ? -1 : undefined}
      data-dsh-iui-style={style}
      data-dsh-iui-style-id={program.styleId}
      data-dsh-iui-temp-style={program.temporaryStyle ? 'true' : undefined}
      data-dsh-iui-running={program.running ? 'true' : undefined}
      data-dsh-iui-collapsed={collapsed ? 'true' : undefined}
      data-dsh-iui-editing={editing ? 'true' : undefined}
    >
      <div className="dsh-iui-card-head">
        <button
          type="button"
          className="dsh-iui-header"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => { if (!editing) setCollapsed(value => !value) }}
        >
          <span className="dsh-iui-icon" aria-hidden="true"><RemixIcon name="sparkling-fill" size={14} /></span>
          <span className="dsh-iui-title" data-dsh-iui-title>{title}</span>
          {program.temporaryStyle && <span className="dsh-iui-temporary-badge" title={program.temporaryStyle.suggestedName}>{t('onDemand.badge')}</span>}
          {program.running && <span className="dsh-iui-state">{t('state.rendering')}</span>}
          <span className="dsh-iui-chevron" aria-hidden="true"><RemixIcon name="arrow-down-s-line" size={14} /></span>
        </button>
        <div className="dsh-iui-head-actions">
          {showDraftBadge
            ? <span
                className="dsh-iui-draft-badge"
                data-dsh-iui-draft-badge
                data-state={editSession.status === 'conflict' ? 'conflict' : editSession.submitFailed === true ? 'failed' : editSession.attached ? 'attached' : 'detached'}
                title={t('edit.draftSaved')}
              >{draftBadgeLabel(editSession, t)}</span>
            : null}
          {showDraftBadge && editSession !== undefined && !editSession.attached
            ? <button
                type="button"
                className="dsh-iui-draft-attach"
                data-dsh-iui-draft-attach
                title={t('edit.attachDraft')}
                disabled={attachedDraftTotal >= MAX_ARTIFACT_BATCH_REQUESTS}
                onClick={() => { attachArtifactDraft(editKey) }}
              >{t('edit.attachDraft')}</button>
            : null}
          {program.localRevision === true
            ? <span className="dsh-iui-revision" data-dsh-iui-local-revision>{t(program.localRevisionKind === 'structure' ? 'edit.structureRevision' : program.localRevisionKind === 'props' ? 'edit.propsRevision' : program.localRevisionKind === 'style' ? 'edit.styleRevision' : 'edit.localRevision')}</span>
            : null}
          {restoreState === 'available'
            ? <button
                type="button"
                className="dsh-iui-draft-attach"
                data-dsh-iui-restore
                title={t('edit.restoreAction')}
                onClick={() => { void restore() }}
              >{t('edit.restoreAction')}</button>
            : null}
          {restoreState === 'busy'
            ? <span className="dsh-iui-state" data-dsh-iui-restore-busy>{t('edit.restoreAction')}</span>
            : null}
          {restoreState === 'done' && restoredRevision !== undefined
            ? <span className="dsh-iui-state" data-dsh-iui-restore-done>{t('edit.restoreDone', { n: restoredRevision })}</span>
            : null}
          {restoreState === 'error'
            ? <span className="dsh-iui-state" data-dsh-iui-restore-error>{t('edit.restoreFailed')}</span>
            : null}
          <button
            ref={historyButtonRef}
            type="button"
            className="dsh-iui-head-icon dsh-iui-history-open"
            data-dsh-iui-history-open
            data-dsh-iui-version-open={versionBarAvailable ? 'true' : undefined}
            data-history-trigger="icon"
            aria-label={historyLabel}
            title={historyLabel}
            onClick={() => { if (versionBarAvailable) setVersionBarOpen(true); else setHistoryOpen(true) }}
          >
            <RemixIcon name="history-line" size={14} />
            {historyRevision === undefined
              ? null
              : <span className="dsh-iui-history-count" data-dsh-iui-history-count aria-hidden="true">{historyRevision}</span>}
          </button>
          {editable
            ? <button
                type="button"
                className={`dsh-iui-edit-entry${editing ? ' dsh-iui-edit-exit' : ''}`}
                data-dsh-iui-edit-entry
                aria-pressed={editing}
                onClick={toggleEditing}
              >{editing ? t('edit.exit') : t('edit.entry')}</button>
            : null}
        </div>
      </div>
      {staleHint === undefined ? null : (
        <div className="dsh-iui-stage-stale" data-dsh-iui-stage-stale>{staleHint}</div>
      )}
      {narrowNotice && !editing
        ? <div className="dsh-iui-edit-narrow-notice" role="status" data-dsh-iui-edit-narrow-notice>
            <div className="dsh-iui-edit-narrow-copy">
              <strong>{t('edit.narrowTitle')}</strong>
              <span>{t('edit.narrowBody', { width: MIN_EDIT_WIDTH })}</span>
            </div>
            <button type="button" className="dsh-iui-edit-narrow-dismiss" onClick={() => { setNarrowNotice(false) }}>
              {t('edit.narrowDismiss')}
            </button>
          </div>
        : null}
      {limitNotice
        ? <div className="dsh-iui-edit-narrow-notice" role="status" data-dsh-iui-draft-limit>
            <div className="dsh-iui-edit-narrow-copy">
              <strong>{t('edit.pendingDrafts')}</strong>
              <span>{t('edit.draftLimit', { max: MAX_ARTIFACT_DRAFTS })}</span>
            </div>
            <button type="button" className="dsh-iui-edit-narrow-dismiss" onClick={() => { setLimitNotice(false) }}>
              {t('edit.narrowDismiss')}
            </button>
          </div>
        : null}
      {detachedNotice && editing && editSession !== undefined && !editSession.attached
        ? <div className="dsh-iui-edit-narrow-notice" role="status" data-dsh-iui-draft-detached>
            <div className="dsh-iui-edit-narrow-copy">
              <strong>{t('edit.pendingDrafts')}</strong>
              <span>{t('edit.draftDetached')}</span>
            </div>
            <button
              type="button"
              className="dsh-iui-edit-narrow-dismiss"
              data-dsh-iui-draft-attach
              disabled={attachedDraftTotal >= MAX_ARTIFACT_BATCH_REQUESTS}
              onClick={() => { attachArtifactDraft(editKey) }}
            >
              {t('edit.attachDraft')}
            </button>
          </div>
        : null}
      <div className="dsh-iui-body" data-dsh-iui-body id={bodyId} hidden={collapsed && !editing}>
        {!readOnlyCard && editorMounted && (editSession ?? lastEditSessionRef.current) !== undefined ? (
          <div className={editorLayout === 'article' ? 'dsh-iui-article' : undefined}>
            <ArtifactEditView
              t={t}
              session={(editSession ?? lastEditSessionRef.current) as ArtifactEditSession}
              actions={editActions}
              themeStyle={editorThemeStyle}
              scheme={scheme}
              onToAssistant={onToAssistant}
              styleEditSupported={styleEditSupported}
              styleSwitchSupported={styleSwitchSupported}
              styleTargets={styleTargets}
              onPreviewStyleTarget={setStylePreview}
              closing={editorClosing && !editing}
              onOpenHistory={() => { setHistoryOpen(true) }}
              resolveImage={resolveImage}
            />
          </div>
        ) : (
          <RendererBoundary t={t}>
            <div className={style === 'article' ? 'dsh-iui-article' : undefined}>
              <OpenUIRenderer
                program={program.program}
                title={program.title}
                scopeId={program.callId}
                onToAssistant={onToAssistant}
                themeStyle={themeStyle}
                scheme={scheme}
                t={t}
                runtimeState={runtimeState}
                onRuntimeStateChange={handleRuntimeStateChange}
                resolveImage={resolveImage}
              />
            </div>
          </RendererBoundary>
        )}
      </div>
      {program.temporaryStyle !== undefined && (
        (onAdjust !== undefined && program.fallbackFrom === undefined && !(styleEditSupported && editable))
        || saveAction !== undefined || error !== null) ? (
        <div className="dsh-iui-result-actions">
          {/* The in-canvas style section replaces the legacy on-demand adjust
              action only when the Host supports it AND this card is editable;
              otherwise the footer keeps the old fallback. */}
          {onAdjust === undefined || program.fallbackFrom !== undefined || (styleEditSupported && editable) ? null : <button type="button" disabled={adjusting || program.running} onClick={() => { void adjust() }}>{t('onDemand.adjust')}</button>}
          {saveAction}
          {error === null ? null : <span className="dsh-iui-style-error" role="alert">{error}</span>}
        </div>
      ) : null}
      {versionBarOpen && versionBarAvailable
        ? <ArtifactVersionBar
            t={t}
            sessionId={sessionId}
            artifactId={restoreArtifactId}
            currentRevisionId={restoreRevisionId}
            scheme={scheme}
            program={program.program}
            templates={templates}
            sessionStyle={sessionStyle}
            resolveImage={resolveImage}
            draftRevisionIds={draftRevisionIds ?? EMPTY_ID_SET}
            anchor={historyButtonRef.current}
            onClose={() => { closeVersionBar(true) }}
            onOpenDetails={() => { setVersionBarOpen(false); setHistoryOpen(true) }}
            onSelectRevision={handleVersionSelect}
          />
        : null}
      {historyOpen
        ? <ArtifactHistory
            t={t}
            artifactId={restoreArtifactId}
            currentRevisionId={restoreRevisionId}
            // Only a card whose own identity is the local revision is a local card;
            // the stage synthesizes local revisions with the stage card's own callId.
            renderedRevisionLocal={program.localRevision === true && program.callId === program.revisionId}
            localRevisionIds={localRevisionIds}
            draftRevisionIds={draftRevisionIds}
            fallbackTargetIds={fallbackTargetIds}
            renderedRevisionIds={renderedRevisionIds}
            program={program.program}
            blocks={blocksById}
            onClose={() => { setHistoryOpen(false) }}
            onRestored={revision => { handleHistoryRestored(revision); setHistoryOpen(false) }}
            onDeleted={(revisionId, fallback) => {
              // A transcript card rolls back to the prepared older revision; a
              // local revision card is simply removed with its history row. The
              // version store drops the record so the stage can never display a
              // dangling revision (it falls back to latest/remaining records).
              if (fallback !== undefined) recordRevisionFallback(sessionId, fallback)
              forgetArtifactRevision(sessionId, restoreArtifactId, revisionId, fallback)
              deleteRevisionThumbnails(restoreArtifactId, revisionId)
              removeLocalRevision(sessionId, revisionId)
            }}
          />
        : null}
    </section>
  )
}
