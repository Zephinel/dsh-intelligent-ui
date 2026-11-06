/**
 * Edit-mode view for one rendered Artifact card.
 *
 * The view is the visible half of block editing: it owns the edit toolbar, the
 * read-only block canvas, the block instruction popover and the request panel.
 * All state transitions stay in the edit-session store; this component only
 * renders the session snapshot and forwards user intent through
 * `ArtifactEditActions`.
 *
 * The card chrome (`.dsh-iui-card`, header, `.dsh-iui-body` padding) stays
 * outside this component: the DSH card mounts the view where its renderer used
 * to be, so entering and leaving edit mode keeps one card and one body.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { BlockSlotContext, BlockSlotPathContext, type BlockSlotContextValue } from '../../lib/components/block-slot.tsx'
import { wrapProgramForBlockEditing } from '../../shared/artifact-blocks.ts'
import { OpenUIRenderer } from '../../lib/render.tsx'
import { isEditViewportWideEnough, MIN_EDIT_WIDTH, type ArtifactEditViewProps } from './contracts.ts'
import { BlockOverlay } from './BlockOverlay.tsx'
import { InfoTip } from './InfoTip.tsx'
import { BlockPopover } from './BlockPopover.tsx'
import { EditPanel } from './EditPanel.tsx'
import { blocksForProgram, probeArtifactRevisionStatus } from './store.ts'
import { nestedBlocksForProgram } from './nested.ts'
import { runtimeStateForProgram } from '../runtime-state.ts'
import { claimEditLease, hasForeignLease, queryEditLeases, releaseEditLease, renewEditLease, useForeignEditLease } from './tabs.ts'
import './artifact-edit.css'

/** Edit view props plus the exit-animation flag owned by the card. */
type ArtifactEditViewClosingProps = ArtifactEditViewProps & {
  readonly closing?: boolean
  /** Opens the per-artifact revision history dialog (card-level state). */
  readonly onOpenHistory?: () => void
}

/** Toolbar and canvas for one card in edit mode, plus its request panel. */
export function ArtifactEditView({
  t,
  session,
  actions,
  themeStyle,
  scheme,
  onToAssistant,
  closing = false,
  onOpenHistory,
}: ArtifactEditViewClosingProps): ReactElement {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null)
  const [tooNarrow, setTooNarrow] = useState<boolean>(
    typeof window === 'undefined' ? false : !isEditViewportWideEnough(window.innerWidth),
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = (): void => { setTooNarrow(!isEditViewportWideEnough(window.innerWidth)) }
    window.addEventListener('resize', onResize)
    onResize()
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  // Background revision check: a concurrent edit (another tab/operation) turns
  // into the existing conflict banner before the user tries to send.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (session.status !== 'ready') return
    const probe = (): void => { void probeArtifactRevisionStatus(session.key) }
    const onVisibility = (): void => { if (document.visibilityState === 'visible') probe() }
    const timer = window.setInterval(probe, 15_000)
    window.addEventListener('focus', probe)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', probe)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [session.key, session.status])
  // B2-6: the edit canvas is frozen: it shows the state captured for the base
  // revision (falling back to the artifact's latest snapshot) and never writes.
  const editRuntimeState = useMemo(() => runtimeStateForProgram({
    artifactId: session.artifactId,
    revisionId: session.baseRevisionId,
    baseRevisionId: session.baseRevisionId,
    callId: session.baseRevisionId,
  }), [session.artifactId, session.baseRevisionId])
  const blockCount = session.blocks.length
  const requestCount = session.selection.length
  // M4-1: nested blocks are opt-in per canvas. The CST map resolves renderer
  // paths to display block ids for the nested edit library.
  const nested = useMemo(() => nestedBlocksForProgram(session.program), [session.program])
  const canNest = nested?.hasNested === true
  const nestedPathContext = useMemo(() => nested === undefined || !session.nestedMode
    ? undefined
    : {
        parentPath: '',
        resolve: (path: string) => {
          const block = nested.byPath.get(path)
          return block === undefined
            ? undefined
            : { blockId: block.blockId, nodeId: block.nodeId ?? path, blockIndex: block.originalIndex }
        },
      }, [nested, session.nestedMode])
  const conflict = session.status === 'conflict'
  const checking = session.status === 'checking'
  // The arrangement draft is previewed live: the block slots are reordered in
  // the edit canvas only, while the stored revision and the exported card keep
  // their real order until the user sends the request.
  const program = useMemo(() => {
    const preview = session.propsPreview?.program
    if (preview === undefined && !session.orderChanged) return session.wrappedProgram ?? session.program
    // The preview program keeps every root child in place, so the base
    // extraction/ids still address the same blocks when rewrapping.
    const extraction = blocksForProgram(session.program)
    return wrapProgramForBlockEditing(
      preview ?? session.program,
      extraction,
      session.orderChanged ? session.targetOrder : undefined,
    )
      ?? session.wrappedProgram
      ?? session.program
  }, [session.program, session.wrappedProgram, session.orderChanged, session.targetOrder, session.propsPreview])

  // One stable context value per session patch; the block wrapper reads it
  // during render, so selection changes must produce a new object.
  const slots = useMemo<BlockSlotContextValue>(() => ({
    labels: {
      select: t('edit.select'),
      edit: t('edit.instruction'),
      deselect: t('edit.deselect'),
      selected: t('edit.selected'),
    },
    selection: (blockId: string) => {
      const entry = session.selection.find(item => item.blockId === blockId)
      return entry === undefined ? undefined : { order: entry.order, active: session.activeBlockId === blockId }
    },
    isActive: (blockId: string) => session.activeBlockId === blockId,
    onSelect: (blockId: string) => { actions.openBlockEditor(blockId) },
    onEdit: (blockId: string) => { actions.openBlockEditor(blockId) },
    onDeselect: (blockId: string) => { actions.removeSelection(blockId) },
  }), [t, actions, session.selection, session.activeBlockId])

  // Soft cross-tab lease: claim only after other tabs answer a query, and keep
  // the lease refreshed while the canvas is open. The Host revision check stays
  // authoritative; this only surfaces the other tab before work is overwritten.
  const foreignLease = useForeignEditLease(session.key, session.editing)
  useEffect(() => {
    if (!session.editing) return
    queryEditLeases()
    const claim = window.setTimeout(() => {
      if (!hasForeignLease(session.key)) claimEditLease(session.key)
    }, 400)
    const renew = window.setInterval(() => { renewEditLease(session.key) }, 10_000)
    return () => {
      window.clearTimeout(claim)
      window.clearInterval(renew)
      releaseEditLease(session.key)
    }
  }, [session.key, session.editing])

  // Below MIN_EDIT_WIDTH the two-pane editor is not usable; keep the session
  // alive but show the same explanation the card shows before entering.
  if (tooNarrow) {
    return (
      <div className="dsh-iui-edit-narrow" role="status" data-dsh-iui-edit-narrow>
        <strong className="dsh-iui-edit-narrow-title">{t('edit.narrowTitle')}</strong>
        <p className="dsh-iui-edit-narrow-body">{t('edit.narrowBody', { width: MIN_EDIT_WIDTH })}</p>
        <button type="button" className="dsh-iui-edit-button" data-dsh-iui-edit-narrow-exit onClick={() => { actions.closeEditor() }}>
          {t('edit.exit')}
        </button>
      </div>
    )
  }

  return (
    <div className="dsh-iui-edit-view" data-dsh-iui-edit-view data-dsh-iui-edit-scheme={scheme} data-dsh-iui-edit-props-preview={session.propsPreview?.blockId} data-closing={closing ? 'true' : undefined}>
      <div className="dsh-iui-edit-toolbar">
        <div className="dsh-iui-edit-toolbar-row">
          <span className="dsh-iui-edit-toolbar-title">{t('edit.title')}</span>
          <span className="dsh-iui-edit-count">{t('edit.availableBlocks', { count: blockCount })}</span>
          {session.orderChanged ? <span className="dsh-iui-edit-preview" data-dsh-iui-edit-preview>{t('edit.previewOrder')}</span> : null}
          {canNest
            ? (
              <>
                <span className="dsh-iui-edit-mode-state" data-dsh-iui-edit-mode-state>
                  {session.nestedMode === true ? t('edit.modeNested') : t('edit.modeTop')}
                </span>
                <button
                  type="button"
                  className="dsh-iui-edit-button"
                  data-dsh-iui-edit-nested
                  aria-pressed={session.nestedMode === true}
                  onClick={() => { actions.setNestedMode(session.key, session.nestedMode !== true) }}
                >{session.nestedMode === true ? t('edit.switchToTop') : t('edit.switchToNested')}</button>
                <InfoTip label={t('edit.aboutNested')} text={t('edit.nestedHint')} testId="nested" />
              </>
            )
            : null}
          <button
            type="button"
            className="dsh-iui-edit-button dsh-iui-edit-strict"
            data-dsh-iui-edit-strict
            aria-pressed={session.strict === true}
            disabled={session.status === 'submitted' || session.status === 'error'}
            onClick={() => { actions.setStrictMode(session.key, session.strict !== true) }}
          >{session.strict === true ? t('edit.strictEnabled') : t('edit.strictDisabled')}</button>
          <InfoTip label={t('edit.aboutStrict')} text={t('edit.strictHint')} testId="strict" />
          <span className="dsh-iui-edit-toolbar-spacer" />
          <button
            type="button"
            className="dsh-iui-edit-button dsh-iui-edit-drawer-toggle"
            data-dsh-iui-edit-drawer-toggle
            aria-expanded={session.drawerOpen}
            onClick={() => { actions.setDrawerOpen(!session.drawerOpen) }}
          >
            {t('edit.drawerOpen', { count: requestCount })}
          </button>
          <button type="button" className="dsh-iui-edit-button" data-dsh-iui-edit-exit onClick={() => { actions.closeEditor() }}>
            {t('edit.exit')}
          </button>
        </div>
        <p className="dsh-iui-edit-banner">{t('edit.banner')}</p>
      </div>

      {foreignLease ? (
        <div className="dsh-iui-edit-lease" role="status" data-dsh-iui-edit-lease-conflict>
          <div>
            <p className="dsh-iui-edit-conflict-title">{t('edit.leaseConflictTitle')}</p>
            <p className="dsh-iui-edit-conflict-body">{t('edit.leaseConflictBody')}</p>
          </div>
          <button
            type="button"
            className="dsh-iui-edit-button"
            data-dsh-iui-edit-lease-takeover
            onClick={() => { claimEditLease(session.key, true) }}
          >
            {t('edit.leaseTakeover')}
          </button>
        </div>
      ) : null}

      {conflict && session.branch !== true ? (
        <div className="dsh-iui-edit-conflict" role="alert" data-dsh-iui-edit-conflict>
          <p className="dsh-iui-edit-conflict-title">{t('edit.conflictTitle', { n: session.baseRevision })}</p>
          <p className="dsh-iui-edit-conflict-body">{t('edit.conflictBody', { n: session.baseRevision, latest: session.latestRevision ?? '—' })}</p>
          <p className="dsh-iui-edit-conflict-hint">{t('edit.conflictBranchHint', { n: session.baseRevision, latest: session.latestRevision ?? '—' })}</p>
          <div className="dsh-iui-edit-conflict-actions">
            <button
              type="button"
              className="dsh-iui-edit-button dsh-iui-edit-button-primary"
              data-dsh-iui-edit-branch
              onClick={() => { actions.enableBranch(session.key) }}
            >
              {t('edit.branchAction', { n: session.baseRevision })}
            </button>
            <button type="button" className="dsh-iui-edit-button" data-dsh-iui-edit-retry onClick={() => { actions.retryCheck() }}>
              {t('edit.retry')}
            </button>
            <button type="button" className="dsh-iui-edit-button" onClick={() => { actions.closeEditor() }}>
              {t('edit.exit')}
            </button>
          </div>
        </div>
      ) : null}

      {session.branch === true ? (
        <div className="dsh-iui-edit-branch-note" role="status" data-dsh-iui-edit-branch-note>
          <p className="dsh-iui-edit-conflict-title">{t('edit.branchBannerTitle', { n: session.baseRevision })}</p>
          <p className="dsh-iui-edit-conflict-body">
            {t('edit.branchBannerBody', { latest: session.latestRevision ?? '—', next: (session.latestRevision ?? session.baseRevision) + 1 })}
          </p>
        </div>
      ) : null}

      {checking ? <p className="dsh-iui-edit-checking" role="status">{t('edit.checking')}</p> : null}
      {!checking && session.status === 'error' && session.error !== undefined
        ? <p className="dsh-iui-edit-checking" role="alert">{session.error}</p>
        : null}

      <div ref={canvasRef} className="dsh-iui-edit-canvas" aria-busy={checking ? true : undefined}>
        <BlockSlotContext.Provider value={slots}>
          {session.nestedMode === true && nestedPathContext !== undefined ? (
            <BlockSlotPathContext.Provider value={nestedPathContext}>
              <OpenUIRenderer
                program={session.propsPreview?.program ?? session.program}
                title={session.title}
                scopeId={session.baseRevisionId}
                nestedBlockSlots
                themeStyle={themeStyle}
                scheme={scheme}
                onToAssistant={onToAssistant}
                t={t}
                runtimeState={editRuntimeState}
              />
            </BlockSlotPathContext.Provider>
          ) : (
            <OpenUIRenderer
              program={program}
              title={session.title}
              scopeId={session.baseRevisionId}
              blockSlots
              themeStyle={themeStyle}
              scheme={scheme}
              onToAssistant={onToAssistant}
              t={t}
              runtimeState={editRuntimeState}
            />
          )}
        </BlockSlotContext.Provider>
        <BlockOverlay
          t={t}
          session={session}
          actions={actions}
          scheme={scheme}
          canvasRef={canvasRef}
          hoveredBlockId={hoveredBlockId}
          onHoverBlock={setHoveredBlockId}
        />
      </div>
      <p className="dsh-iui-edit-frozen">{t('edit.frozenHint')}</p>

      <EditPanel
        t={t}
        session={session}
        actions={actions}
        closing={closing}
        onOpenHistory={onOpenHistory}
        hoveredBlockId={hoveredBlockId}
        onHoverBlock={setHoveredBlockId}
      />
      {session.activeBlockId === undefined
        ? null
        : <BlockPopover t={t} session={session} actions={actions} scheme={scheme} />}
    </div>
  )
}
