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
import { IconChevronDownOutlineRegular, IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MAX_ARTIFACT_BATCH_REQUESTS, MAX_ARTIFACT_DRAFTS } from '../shared/artifact-edit.ts'
import { MODE_PROJECTION_KEY, type IntelligentUIModeView, type IntelligentUIProgram } from '../shared/intelligent-ui.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'
import { OpenUIRenderer } from '../lib/render.tsx'
import { resolveStyleThemeVars } from '../lib/style-theme.ts'
import { resolveCardTheme } from './export-html-plan.ts'
import type { StyleCatalog } from './styles.ts'
import { useStyleScheme } from './theme-mode.ts'
import { programsFromToolNodes, type ToolCallNode } from './programs.ts'
import { RendererBoundary } from './RendererBoundary.tsx'
import { fillComposer, type ComposerAccess } from './composer.ts'
import { SaveResultAction } from './SaveResultAction.tsx'
import { styleActions as defaultStyleActions, type StyleActions } from './style-actions.ts'
import { ArtifactEditView } from './artifact-edit/ArtifactEditView.tsx'
import { isEditViewportWideEnough, MIN_EDIT_WIDTH, type ArtifactEditActions, type ArtifactEditSession } from './artifact-edit/contracts.ts'
import {
  activateDraft as activateArtifactDraft,
  attachDraft as attachArtifactDraft,
  blocksForProgram,
  closeArtifactBlockEditor,
  closeArtifactEditor,
  clearAllArtifactEdits,
  clearArtifactBlockInstruction,
  discardDraft as discardArtifactDraft,
  hasArtifactEditContent,
  moveArtifactBlock,
  moveArtifactBlockBy,
  openArtifactBlockEditor,
  openArtifactEditor,
  removeArtifactSelection,
  resetArtifactOrder,
  retryArtifactRevisionCheck,
  saveArtifactBlockInstruction,
  setArtifactDrawerOpen,
  setArtifactGlobalInstruction,
  supportsBlockEditing,
  undoArtifactRemove,
  updateArtifactBlockDraft,
  useArtifactEditSession,
  useArtifactEditStore,
} from './artifact-edit/store.ts'

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
  const catalog = useSyncExternalStore(styles.subscribe, styles.getSnapshot, styles.getSnapshot)
  const scheme = useStyleScheme()
  // A theme-less result snapshot inherits the session's selected template; the
  // projection publishes the effective style id (a template id for saved styles).
  const sessionStyle = (useProjection ?? noProjection)(MODE_PROJECTION_KEY)?.style
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
  if (programs.length === 0) return null
  return (
    <div className="dsh-iui-cards" data-dsh-intelligent-ui-list>
      {programs.map(program => {
        const templates = catalog.status === 'unavailable' ? [] : catalog.templates
        const theme = resolveCardTheme(program, templates, sessionStyle)
        return (
          <IntelligentUICard
            key={program.callId}
            program={program}
            sessionId={sessionId}
            onToAssistant={toAssistant}
            t={t}
            scheme={scheme}
            onAdjust={adjustStyle === undefined ? undefined : adjust}
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
  const count = session.selection.length
  if (count > 0) return `${t('edit.pendingDrafts')} · ${t('edit.requestsCount', { count })}`
  if (session.orderChanged) return `${t('edit.pendingDrafts')} · ${t('edit.summaryOrderChanged')}`
  return `${t('edit.pendingDrafts')} · ${t('edit.summaryGlobal')}`
}

interface IntelligentUICardProps {
  readonly program: IntelligentUIProgram
  readonly sessionId: string
  readonly onToAssistant: (message: string) => void
  readonly t: Translate
  readonly themeStyle?: CSSProperties
  readonly scheme: 'light' | 'dark'
  readonly onAdjust?: (program: IntelligentUIProgram) => Promise<string | null>
  readonly saveAction?: ReactNode
}

/**
 * One full-width card: a native header with title and collapse control, and
 * the renderer body. The body never clips; the renderer owns horizontal
 * scrolling for wide tables and charts.
 * @param props - extracted program, the composer continuation callback, and the locale seat.
 * @returns the card.
 */
function IntelligentUICard({ program, sessionId, onToAssistant, t, themeStyle, scheme, onAdjust, saveAction }: IntelligentUICardProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Block editing needs a usable two-pane width; tiny viewports get a hint.
  const [narrowNotice, setNarrowNotice] = useState(false)
  // Multi-draft notices: draft cap reached, and a detached draft (chip removed).
  const [limitNotice, setLimitNotice] = useState(false)
  const [detachedNotice, setDetachedNotice] = useState(false)
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
  const editKey = `${sessionId}:${baseRevisionId}`
  const editSession = useArtifactEditSession(sessionId, baseRevisionId)
  const editStore = useArtifactEditStore()
  const editing = editSession?.editing === true
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
  const editable = !program.running && blocks.length > 0 && supportsBlockEditing(program)
  const editActions = useMemo<ArtifactEditActions>(() => ({
    openBlockEditor: blockId => { openArtifactBlockEditor(editKey, blockId) },
    closeBlockEditor: () => { closeArtifactBlockEditor(editKey) },
    updateBlockDraft: (blockId, text) => { updateArtifactBlockDraft(editKey, blockId, text) },
    saveBlockInstruction: (blockId, text) => { saveArtifactBlockInstruction(editKey, blockId, text) },
    clearBlockInstruction: blockId => { clearArtifactBlockInstruction(editKey, blockId) },
    removeSelection: blockId => { removeArtifactSelection(editKey, blockId) },
    undoRemove: () => { undoArtifactRemove(editKey) },
    moveBlock: (blockId, toIndex) => { moveArtifactBlock(editKey, blockId, toIndex) },
    moveBlockBy: (blockId, delta) => { moveArtifactBlockBy(editKey, blockId, delta) },
    resetOrder: () => { resetArtifactOrder(editKey) },
    clearAllEdits: () => { clearAllArtifactEdits(editKey) },
    setGlobalInstruction: text => { setArtifactGlobalInstruction(editKey, text) },
    closeEditor: () => { closeArtifactEditor(editKey) },
    setDrawerOpen: open => { setArtifactDrawerOpen(editKey, open) },
    retryCheck: () => { retryArtifactRevisionCheck(editKey) },
    activateDraft: key => { activateArtifactDraft(key) },
    attachDraft: key => { attachArtifactDraft(key) },
    discardDraft: key => { discardArtifactDraft(key) },
  }), [editKey])

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
          <span className="dsh-iui-icon" aria-hidden="true"><IconSparkleRegular size={14} /></span>
          <span className="dsh-iui-title" data-dsh-iui-title>{title}</span>
          {program.temporaryStyle && <span className="dsh-iui-temporary-badge" title={program.temporaryStyle.suggestedName}>{t('onDemand.badge')}</span>}
          {program.running && <span className="dsh-iui-state">{t('state.rendering')}</span>}
          <span className="dsh-iui-chevron" aria-hidden="true"><IconChevronDownOutlineRegular size={14} /></span>
        </button>
        <div className="dsh-iui-head-actions">
          {showDraftBadge
            ? <span
                className="dsh-iui-draft-badge"
                data-dsh-iui-draft-badge
                data-state={editSession.status === 'conflict' ? 'conflict' : editSession.attached ? 'attached' : 'detached'}
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
          {program.revision !== undefined && program.revision > 1
            ? <span className="dsh-iui-revision" data-dsh-iui-revision>{t('edit.revision', { n: program.revision })}</span>
            : null}
          {editable
            ? <button
                type="button"
                className="dsh-iui-edit-entry"
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
        {editing && editSession !== undefined ? (
          <div className={style === 'article' ? 'dsh-iui-article' : undefined}>
            <ArtifactEditView
              t={t}
              session={editSession}
              actions={editActions}
              themeStyle={themeStyle}
              scheme={scheme}
              onToAssistant={onToAssistant}
            />
          </div>
        ) : (
          <RendererBoundary t={t}>
            <div className={style === 'article' ? 'dsh-iui-article' : undefined}>
              <OpenUIRenderer program={program.program} title={program.title} scopeId={program.callId} onToAssistant={onToAssistant} themeStyle={themeStyle} scheme={scheme} t={t} />
            </div>
          </RendererBoundary>
        )}
      </div>
      {program.temporaryStyle ? (
        <div className="dsh-iui-result-actions">
          {onAdjust === undefined ? null : <button type="button" disabled={adjusting || program.running} onClick={() => { void adjust() }}>{t('onDemand.adjust')}</button>}
          {saveAction}
          {error === null ? null : <span className="dsh-iui-style-error" role="alert">{error}</span>}
        </div>
      ) : null}
    </section>
  )
}
