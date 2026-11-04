/**
 * Anchored instruction popover for one selected Artifact block.
 *
 * The popover renders into `document.body` (a fixed-position portal) so the
 * card's clipping and scroll containers cannot cut it, and it measures the
 * block wrapper's live `[data-dsh-iui-block]` element to sit next to the block
 * it edits. Placement prefers below-right, flips above when the viewport is
 * short, clamps to the edges and scrolls internally when the available height
 * is not enough.
 *
 * The popover is non-modal: the block canvas keeps its selection overlay, while
 * the popover owns Escape, outside-pointer dismissal and focus return. Unsaved
 * text asks for an inline discard confirmation instead of a page-level dialog.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { blockKindLabel, type ArtifactEditActions, type ArtifactEditSession } from './contracts.ts'
import type { Translate } from '../../shared/locales.ts'

/** Props of the block instruction popover. */
export interface BlockPopoverProps {
  readonly t: Translate
  readonly session: ArtifactEditSession
  readonly actions: ArtifactEditActions
  readonly scheme?: 'light' | 'dark'
}

/** Gap between the anchor block and the popover. */
const ANCHOR_GAP = 8
/** Smallest distance kept from every viewport edge. */
const VIEWPORT_MARGIN = 12
/** Below this much room a popover flips above the block. */
const MIN_USABLE_HEIGHT = 160

interface Placement {
  readonly left: number
  readonly top: number
  readonly maxHeight: number
}

/** Query the block wrapper that owns one block id. */
function blockElement(blockId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-dsh-iui-block="${blockId}"]`)
}

/** Style of the popover before its first measurement; transparent but focusable. */
const UNPLACED: CSSProperties = { left: 0, top: 0, opacity: 0, pointerEvents: 'none' }

/**
 * One anchored popover; mounted only while a block is active.
 * @param props - locale seat, edit session, actions and the resolved scheme.
 * @returns the portal, or null when no block is active.
 */
export function BlockPopover({ t, session, actions, scheme }: BlockPopoverProps): ReactElement | null {
  const blockId = session.activeBlockId
  if (blockId === undefined) return null
  return <BlockPopoverBody t={t} session={session} actions={actions} scheme={scheme} blockId={blockId} />
}

interface BlockPopoverBodyProps extends BlockPopoverProps {
  readonly blockId: string
}

/** The mounted popover body; all hooks live here so the export stays hook-free. */
function BlockPopoverBody({ t, session, actions, scheme, blockId }: BlockPopoverBodyProps): ReactElement {
  const panel = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const textareaId = useId()
  const [placement, setPlacement] = useState<Placement | null>(null)
  const [discardConfirm, setDiscardConfirm] = useState(false)
  /** Restore focus to the block only when the close came from the popover. */
  const restoreFocus = useRef(true)
  const dirtyRef = useRef(session.activeDirty)
  dirtyRef.current = session.activeDirty
  const confirmRef = useRef(discardConfirm)
  confirmRef.current = discardConfirm
  const previousBlock = useRef(blockId)

  const block = session.blocks.find(candidate => candidate.blockId === blockId)
  const entry = session.selection.find(candidate => candidate.blockId === blockId)
  const order = entry?.order ?? 1
  const savedInstruction = entry?.instruction.trim() ?? ''
  const kindLabel = blockKindLabel(block?.kind ?? 'content', t)
  const nameText = block?.title ?? kindLabel
  const originalIndex = block?.originalIndex ?? order
  const colorIndex = ((order - 1) % 6) + 1

  const close = useCallback((): void => { actions.closeBlockEditor() }, [actions])

  useLayoutEffect(() => {
    const place = (): void => {
      const anchor = blockElement(blockId)
      const popup = panel.current
      if (anchor === null || popup === null) return
      const rect = anchor.getBoundingClientRect()
      const popupWidth = popup.offsetWidth
      const popupHeight = popup.offsetHeight
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const belowRoom = viewportHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN
      const aboveRoom = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN
      const preferBelow = belowRoom >= MIN_USABLE_HEIGHT || belowRoom >= aboveRoom
      const room = preferBelow ? belowRoom : aboveRoom
      const maxHeight = Math.max(MIN_USABLE_HEIGHT, Math.min(room, viewportHeight - VIEWPORT_MARGIN * 2))
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, viewportWidth - popupWidth - VIEWPORT_MARGIN))
      const top = preferBelow
        ? Math.min(rect.bottom + ANCHOR_GAP, viewportHeight - VIEWPORT_MARGIN - maxHeight)
        : Math.max(VIEWPORT_MARGIN, rect.top - ANCHOR_GAP - Math.min(popupHeight, maxHeight))
      setPlacement(current => current !== null && current.left === left && current.top === top && current.maxHeight === maxHeight
        ? current
        : { left, top, maxHeight })
    }
    place()
    const observer = new ResizeObserver(place)
    if (panel.current !== null) observer.observe(panel.current)
    const anchor = blockElement(blockId)
    if (anchor !== null) observer.observe(anchor)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [blockId])

  // A new target reuses this instance; reset transient UI and refocus the editor.
  useEffect(() => {
    setDiscardConfirm(false)
    if (previousBlock.current === blockId) return
    previousBlock.current = blockId
    textarea.current?.focus({ preventScroll: true })
  }, [blockId])

  // Focus bookkeeping: closing from the popover returns focus to the block.
  useEffect(() => () => {
    if (!restoreFocus.current) return
    blockElement(blockId)?.focus({ preventScroll: true })
  }, [blockId])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panel.current?.contains(target)) return
      // Block clicks belong to the block wrapper; they select the new target.
      if (target instanceof Element && target.closest('[data-dsh-iui-block]') !== null) return
      restoreFocus.current = false
      actions.closeBlockEditor()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (confirmRef.current) {
        setDiscardConfirm(false)
        textarea.current?.focus({ preventScroll: true })
        return
      }
      if (dirtyRef.current) {
        setDiscardConfirm(true)
        return
      }
      actions.closeBlockEditor()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [actions])

  const requestClose = (): void => {
    if (session.activeDirty) {
      setDiscardConfirm(true)
      return
    }
    close()
  }

  return createPortal(
    <div
      ref={panel}
      className={`dsh-iui-edit-popover dsh-iui-edit-color-${colorIndex}`}
      role="dialog"
      aria-label={t('edit.editBlock', { n: order })}
      data-dsh-iui-edit-popover
      data-block-id={blockId}
      data-dsh-iui-edit-scheme={scheme}
      style={placement === null ? UNPLACED : { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }}
    >
      <div className="dsh-iui-edit-popover-head">
        <span className="dsh-iui-edit-badge" aria-hidden="true">{order}</span>
        <span className="dsh-iui-edit-popover-title">{t('edit.editBlock', { n: order })}</span>
      </div>

      <div className="dsh-iui-edit-popover-scroll">
        <dl className="dsh-iui-edit-popover-meta">
          <div className="dsh-iui-edit-popover-meta-row">
            <dt>{t('edit.blockName')}</dt>
            <dd>{nameText}</dd>
          </div>
          <div className="dsh-iui-edit-popover-meta-row">
            <dt>{t('edit.blockType')}</dt>
            <dd>{kindLabel}</dd>
          </div>
          <div className="dsh-iui-edit-popover-meta-row">
            <dt>{t('edit.blockPosition')}</dt>
            <dd>{t('edit.positionN', { n: originalIndex })}</dd>
          </div>
        </dl>

        <label className="dsh-iui-edit-popover-label" htmlFor={textareaId}>{t('edit.instruction')}</label>
        <textarea
          ref={textarea}
          id={textareaId}
          className="dsh-iui-edit-textarea"
          data-dsh-iui-edit-instruction
          rows={4}
          maxLength={2000}
          autoFocus
          value={session.activeDraft}
          placeholder={t('edit.instructionPlaceholder')}
          onChange={event => { actions.updateBlockDraft(blockId, event.target.value) }}
        />
        {savedInstruction === '' ? null : (
          <button
            type="button"
            className="dsh-iui-edit-link dsh-iui-edit-popover-clear"
            data-dsh-iui-edit-clear
            onClick={() => { setDiscardConfirm(false); actions.clearBlockInstruction(blockId) }}
          >
            {t('edit.clear')}
          </button>
        )}
      </div>

      <div className="dsh-iui-edit-popover-footer">
        {discardConfirm ? (
          <div className="dsh-iui-edit-confirm">
            <p className="dsh-iui-edit-confirm-text" role="alert">{t('edit.unsavedConfirm')}</p>
            <div className="dsh-iui-edit-popover-actions">
              <button
                type="button"
                className="dsh-iui-edit-button"
                data-dsh-iui-edit-keep
                onClick={() => { setDiscardConfirm(false); textarea.current?.focus({ preventScroll: true }) }}
              >
                {t('edit.keepEditing')}
              </button>
              <button type="button" className="dsh-iui-edit-button dsh-iui-edit-button-danger" data-dsh-iui-edit-discard onClick={close}>
                {t('edit.discard')}
              </button>
            </div>
          </div>
        ) : (
          <div className="dsh-iui-edit-popover-actions">
            <button type="button" className="dsh-iui-edit-button" data-dsh-iui-edit-cancel onClick={requestClose}>{t('edit.cancel')}</button>
            <button
              type="button"
              className="dsh-iui-edit-button dsh-iui-edit-button-primary"
              data-dsh-iui-edit-save
              onClick={() => { actions.saveBlockInstruction(blockId, session.activeDraft) }}
            >
              {t('edit.save')}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
