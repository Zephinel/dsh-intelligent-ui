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
 * the card itself (header, revision badge, collapse) stays in place.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { RemixIcon } from '../lib/components/remix-icon.tsx'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MAX_ARTIFACT_BATCH_REQUESTS, MAX_ARTIFACT_DRAFTS } from '../shared/artifact-edit.ts'
import { MODE_PROJECTION_KEY, type IntelligentUIModeView, type IntelligentUIProgram } from '../shared/intelligent-ui.ts'
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
import { ensureArtifactBase } from './artifact-edit/artifact-base.ts'
import { addLocalRevision, fetchArtifactStatus, localRevisionProgram, removeLocalRevision, restoreRevision, useLocalRevisions, type LocalArtifactRevision } from './artifact-edit/local-revisions.ts'
import { isEditViewportWideEnough, MIN_EDIT_WIDTH, type ArtifactEditActions, type ArtifactEditSession, type ArtifactStyleTargetOption } from './artifact-edit/contracts.ts'
import {
  activateDraft as activateArtifactDraft,
  attachDraft as attachArtifactDraft,
  activeDraftKeyFor,
  blocksForProgram,
  closeArtifactBlockEditor,
  applyArtifactStructure,
  closeArtifactEditor,
  clearAllArtifactEdits,
  clearArtifactBlockInstruction,
  discardDraft as discardArtifactDraft,
  enableBranch as enableArtifactBranch,
  hasArtifactEditContent,
  moveArtifactBlock,
  moveArtifactNestedBlock,
  moveArtifactNestedBlockBy,
  moveArtifactBlockTo,
  applyArtifactBlockProps,
  applyArtifactStyleSwitch,
  setArtifactStyleSwitchTarget,
  clearArtifactBlockPropsPreview,
  previewArtifactBlockProps,
  cancelArtifactStructurePreview,
  confirmArtifactStructurePreview,
  previewArtifactStructure,
  previewMoveArtifactBlockTo,
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
  reconcileArtifactSubmissions,
  supportsBlockEditing,
  undoArtifactRemove,
  updateArtifactBlockDraft,
  useArtifactEditSession,
  useArtifactEditStore,
} from './artifact-edit/store.ts'

/** Runtime kept mounted after exit so the panel can play its exit animation. */
const EDITOR_CLOSE_ANIMATION_MS = 320

/** Session-bound, Turn-keyed program source supplied by the plugin's registration. */
export interface IntelligentUICardsInjected {
  readonly sessionId: string
  readonly styles: StyleCatalog
  readonly styleActions?: StyleActions
  readonly adjustStyle?: (program: IntelligentUIProgram) => Promise<string | null>
  readonly readInput?: ComposerAccess['readInput']
  readonly focusComposer?: ComposerAccess['focusComposer']
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
  turn, inputActions, usePrograms, sessionId, styles, styleActions = defaultStyleActions, adjustStyle, readInput, focusComposer, useProjection, t = fallbackT,
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
  const localRevisions = useLocalRevisions(sessionId)
  const localPrograms = useMemo(() => localRevisions
    .filter(revision => revision.turn === turn.turn)
    .map(localRevisionProgram), [localRevisions, turn.turn])
  const allPrograms = useMemo(() => [...programs, ...localPrograms], [programs, localPrograms])
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
  return (
    <div className="dsh-iui-cards" data-dsh-intelligent-ui-list>
      {allPrograms.map(program => {
        const templates = catalog.status === 'unavailable' ? [] : catalog.templates
        const theme = resolveCardTheme(program, templates, sessionStyle)
        return (
          <IntelligentUICard
            key={program.callId}
            program={program}
            sessionId={sessionId}
            turnNumber={turn.turn}
            onToAssistant={toAssistant}
            t={t}
            scheme={scheme}
            onAdjust={adjustStyle === undefined ? undefined : adjust}
            styleEditSupported={styleEditSupported}
            styleSwitchSupported={styleSwitchSupported}
            styleTargets={styleSwitchTargets}
            refreshStyleCatalog={refreshStyleCatalog}
            // Saving a style needs a palette to copy, so a theme-less snapshot cannot offer it.
            saveAction={program.temporaryStyle?.theme === undefined ? undefined : <SaveResultAction resultId={program.callId}
              snapshot={program.temporaryStyle} sessionId={sessionId} actions={styleActions} styles={styles} disabled={program.running} t={t} />}
            // Snapshot theme wins; a theme-less snapshot inherits the session's
            // selected template, then the built-in theme.
            themeStyle={theme === undefined ? undefined : resolveStyleThemeVars(theme, scheme) as CSSProperties}
          />
        )
      })}
    </div>
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
}

/**
 * One full-width card: a native header with title and collapse control, and
 * the renderer body. The body never clips; the renderer owns horizontal
 * scrolling for wide tables and charts.
 * @param props - extracted program, the composer continuation callback, and the locale seat.
 * @returns the card.
 */
function IntelligentUICard({ program, sessionId, turnNumber, onToAssistant, t, themeStyle, scheme, onAdjust, saveAction, styleEditSupported = false, styleSwitchSupported = false, styleTargets, refreshStyleCatalog }: IntelligentUICardProps): ReactElement {
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
  const baseRevisionId = program.revisionId ?? program.callId
  // B2-6: a new revision card restores the runtime state of the revision it was
  // edited from; the mount reports its own latest state back for the next edit.
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
  const editKey = `${sessionId}:${baseRevisionId}`
  const editSession = useArtifactEditSession(sessionId, baseRevisionId)
  const editStore = useArtifactEditStore()
  const editing = editSession?.editing === true
  // The edit view stays mounted for one short exit animation after `editing`
  // flips false; the timer is cancelled if the user re-enters edit mode first.
  const [editorMounted, setEditorMounted] = useState(editing)
  const [editorClosing, setEditorClosing] = useState(false)
  const lastEditSessionRef = useRef<ArtifactEditSession | undefined>(undefined)
  useEffect(() => {
    if (editSession !== undefined) lastEditSessionRef.current = editSession
  }, [editSession])
  useEffect(() => {
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
  }, [editing, editorMounted, editStore, editKey, sessionId])
  const hasDraft = editSession !== undefined && hasArtifactEditContent(editSession)
  const showDraftBadge = editSession !== undefined && !editing && editSession.status !== 'submitted' && hasDraft
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
  const editable = !program.running && blocks.length > 0 && supportsBlockEditing(program)
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
    applyStructure: (blockId, op) => { void applyArtifactStructure(editKey, blockId, op, turnNumber) },
    moveNestedBlock: (parentBlockId, blockId, toIndex) => { moveArtifactNestedBlock(editKey, parentBlockId, blockId, toIndex) },
    moveNestedBlockBy: (parentBlockId, blockId, delta) => { moveArtifactNestedBlockBy(editKey, parentBlockId, blockId, delta) },
    resetNestedOrder: () => { resetArtifactNestedOrder(editKey) },
    saveBlockAddition: (parentBlockId, instruction) => { saveArtifactBlockAddition(editKey, parentBlockId, instruction) },
    removeBlockAddition: (parentBlockId) => { removeArtifactBlockAddition(editKey, parentBlockId) },
    moveBlockTo: (blockId, targetParentBlockId) => { moveArtifactBlockTo(editKey, blockId, targetParentBlockId, turnNumber) },
    previewStructure: (blockId, op) => { previewArtifactStructure(editKey, blockId, op) },
    previewMoveBlockTo: (blockId, targetParentBlockId) => { previewMoveArtifactBlockTo(editKey, blockId, targetParentBlockId) },
    confirmStructurePreview: () => { confirmArtifactStructurePreview(editKey, turnNumber) },
    cancelStructurePreview: () => { cancelArtifactStructurePreview(editKey) },
    enableBranch: () => { enableArtifactBranch(editKey) },
    activateDraft: key => { activateArtifactDraft(key) },
    attachDraft: key => { attachArtifactDraft(key) },
    discardDraft: key => { discardArtifactDraft(key) },
  }), [editKey, turnNumber, refreshStyleCatalog])

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
            type="button"
            className="dsh-iui-head-icon"
            data-dsh-iui-history-open
            data-history-trigger="icon"
            aria-label={t('edit.historyOpen')}
            title={t('edit.historyOpen')}
            onClick={() => { setHistoryOpen(true) }}
          >
            <RemixIcon name="history-line" size={14} />
          </button>
          {program.revision !== undefined && program.revision > 1
            ? <button
                type="button"
                className="dsh-iui-revision dsh-iui-revision-button"
                data-dsh-iui-revision
                data-dsh-iui-history-open
                data-history-trigger="badge"
                aria-label={t('edit.historyOpen')}
                title={t('edit.historyOpen')}
                onClick={() => { setHistoryOpen(true) }}
              >{t('edit.revision', { n: program.revision })}</button>
            : null}
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
        {editorMounted && (editSession ?? lastEditSessionRef.current) !== undefined ? (
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
              />
            </div>
          </RendererBoundary>
        )}
      </div>
      {program.temporaryStyle ? (
        <div className="dsh-iui-result-actions">
          {/* The in-canvas style section replaces the legacy on-demand adjust
              action only when the Host supports it AND this card is editable;
              otherwise the footer keeps the old fallback. */}
          {onAdjust === undefined || (styleEditSupported && editable) ? null : <button type="button" disabled={adjusting || program.running} onClick={() => { void adjust() }}>{t('onDemand.adjust')}</button>}
          {saveAction}
          {error === null ? null : <span className="dsh-iui-style-error" role="alert">{error}</span>}
        </div>
      ) : null}
      {historyOpen
        ? <ArtifactHistory
            t={t}
            artifactId={restoreArtifactId}
            currentRevisionId={restoreRevisionId}
            program={program.program}
            blocks={blocksById}
            onClose={() => { setHistoryOpen(false) }}
            onRestored={revision => { handleHistoryRestored(revision); setHistoryOpen(false) }}
            onDeleted={revisionId => { removeLocalRevision(sessionId, revisionId) }}
          />
        : null}
    </section>
  )
}
