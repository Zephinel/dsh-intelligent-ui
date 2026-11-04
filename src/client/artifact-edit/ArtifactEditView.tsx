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
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { BlockSlotContext, type BlockSlotContextValue } from '../../lib/components/block-slot.tsx'
import { wrapProgramForBlockEditing } from '../../shared/artifact-blocks.ts'
import { OpenUIRenderer } from '../../lib/render.tsx'
import { isEditViewportWideEnough, MIN_EDIT_WIDTH, type ArtifactEditViewProps } from './contracts.ts'
import { BlockPopover } from './BlockPopover.tsx'
import { EditPanel } from './EditPanel.tsx'
import { blocksForProgram, probeArtifactRevisionStatus } from './store.ts'
import './artifact-edit.css'

/** Toolbar and canvas for one card in edit mode, plus its request panel. */
export function ArtifactEditView({
  t,
  session,
  actions,
  themeStyle,
  scheme,
  onToAssistant,
}: ArtifactEditViewProps): ReactElement {
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
  const blockCount = session.blocks.length
  const requestCount = session.selection.length
  const conflict = session.status === 'conflict'
  const checking = session.status === 'checking'
  // The arrangement draft is previewed live: the block slots are reordered in
  // the edit canvas only, while the stored revision and the exported card keep
  // their real order until the user sends the request.
  const program = useMemo(() => {
    if (!session.orderChanged) return session.wrappedProgram ?? session.program
    const extraction = blocksForProgram(session.program)
    return wrapProgramForBlockEditing(session.program, extraction, session.targetOrder)
      ?? session.wrappedProgram
      ?? session.program
  }, [session.program, session.wrappedProgram, session.orderChanged, session.targetOrder])

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
    <div className="dsh-iui-edit-view" data-dsh-iui-edit-view data-dsh-iui-edit-scheme={scheme}>
      <div className="dsh-iui-edit-toolbar">
        <div className="dsh-iui-edit-toolbar-row">
          <span className="dsh-iui-edit-toolbar-title">{t('edit.title')}</span>
          <span className="dsh-iui-edit-count">{t('edit.availableBlocks', { count: blockCount })}</span>
          {session.orderChanged ? <span className="dsh-iui-edit-preview" data-dsh-iui-edit-preview>{t('edit.previewOrder')}</span> : null}
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

      {conflict ? (
        <div className="dsh-iui-edit-conflict" role="alert" data-dsh-iui-edit-conflict>
          <p className="dsh-iui-edit-conflict-title">{t('edit.conflictTitle')}</p>
          <p className="dsh-iui-edit-conflict-body">{t('edit.conflictBody')}</p>
          <div className="dsh-iui-edit-conflict-actions">
            <button type="button" className="dsh-iui-edit-button" data-dsh-iui-edit-retry onClick={() => { actions.retryCheck() }}>
              {t('edit.retry')}
            </button>
            <button type="button" className="dsh-iui-edit-button" onClick={() => { actions.closeEditor() }}>
              {t('edit.exit')}
            </button>
          </div>
        </div>
      ) : null}

      {checking ? <p className="dsh-iui-edit-checking" role="status">{t('edit.checking')}</p> : null}
      {!checking && session.status === 'error' && session.error !== undefined
        ? <p className="dsh-iui-edit-checking" role="alert">{session.error}</p>
        : null}

      <div className="dsh-iui-edit-canvas" aria-busy={checking ? true : undefined}>
        <BlockSlotContext.Provider value={slots}>
          <OpenUIRenderer
            program={program}
            title={session.title}
            scopeId={session.baseRevisionId}
            blockSlots
            themeStyle={themeStyle}
            scheme={scheme}
            onToAssistant={onToAssistant}
            t={t}
          />
        </BlockSlotContext.Provider>
      </div>
      <p className="dsh-iui-edit-frozen">{t('edit.frozenHint')}</p>

      <EditPanel t={t} session={session} actions={actions} />
      {session.activeBlockId === undefined
        ? null
        : <BlockPopover t={t} session={session} actions={actions} scheme={scheme} />}
    </div>
  )
}
