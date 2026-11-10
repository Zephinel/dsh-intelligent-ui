/**
 * Edit panel for one Artifact edit session.
 *
 * The panel is the design's right column and has four stacked sections inside
 * one scroll column: saved block requests (conditional), the always-visible
 * block arrangement draft, the global instruction and the send summary. The
 * header owns the rail width (expand/collapse) and the narrow-viewport close.
 *
 * Arrangement is a pointer-drag list: the grip starts a drag, row midpoints pick
 * the insertion index and only the drop calls `actions.moveBlock`; keyboard
 * users reorder from the same grip with the arrow keys, Home and End. A row body
 * only locates its block in the read-only canvas (scroll + flash); it never
 * opens the popover. Hovering a row that already has a saved request shows a
 * compact request card, portaled to the body and anchored beside the rail.
 *
 * Markup stays one tree; CSS owns the desktop docked rail and the narrow-viewport
 * bottom sheet.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import { blockKindLabel, type ApplyOutcomeNotice, type ArtifactEditActions, type ArtifactEditSession, type ArtifactStyleTargetOption, type BatchOrderMode, type PendingApplyConflict, type PendingStructureOp } from './contracts.ts'
import { MAX_ARTIFACT_STRUCTURE_OPERATIONS, type ArtifactStyleTarget } from '../../shared/artifact-structure.ts'
import { canBatchMove, hasArtifactEditContent, isCurrentStyleTarget } from './store.ts'
import { MAX_PENDING_STRUCTURE_OPS } from './remap.ts'
import { describeArticleLayoutProblem } from '../../shared/article-layout.ts'
import { styleSwitchBlocker as describeStyleSwitchBlocker, styleTargetDisableReason } from './style-targets.ts'
import { MAX_STYLE_INSTRUCTION_CHARS, type ArtifactBlock, type ArtifactBlockKind } from '../../shared/artifact-edit.ts'
import { NESTED_CONTAINER_TYPES } from '../../shared/artifact-containers.ts'
import type { Translate } from '../../shared/locales.ts'
import { RemixIcon, type RemixIconName } from '../../lib/components/remix-icon.tsx'
import { applyEditChatContentWidth, type ChatContentWidthController } from './panel-width.ts'
import { blockAnchorElement } from './block-geometry.ts'

/** Whether two durable style targets name the same identity. */
function sameStyleTarget(left: ArtifactStyleTarget, right: ArtifactStyleTarget): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'builtin') return right.kind === 'builtin' && left.layout === right.layout
  return right.kind === 'template' && left.styleId === right.styleId
}

/** Props of the edit panel; the card supplies both the snapshot and actions. */
export interface EditPanelProps {
  readonly t: Translate
  readonly session: ArtifactEditSession
  readonly actions: ArtifactEditActions
  /** True while the parent card plays the exit animation before unmounting. */
  readonly closing?: boolean
  /** Opens the revision history dialog; omitted when no history UI is mounted. */
  readonly onOpenHistory?: () => void
  /** Block hovered in the canvas, mirrored as a row highlight. */
  readonly hoveredBlockId?: string | null
  /** Reports row hover to the canvas overlay (bidirectional hover sync). */
  readonly onHoverBlock?: (blockId: string | null) => void
  /** Host supports revision-bound style editing; the style section is hidden otherwise. */
  readonly styleEditSupported?: boolean
  /** Host supports deterministic (zero-model) style switching. */
  readonly styleSwitchSupported?: boolean
  /** Durable switch targets resolved by the card (built-ins first, saved after). */
  readonly styleTargets?: readonly ArtifactStyleTargetOption[]
  /** Reports the transiently previewed target so the card can swap the canvas skin. */
  readonly onPreviewStyleTarget?: (target: ArtifactStyleTarget | undefined) => void
}

/** Number of hues in the shared selection palette. */
const COLOR_COUNT = 6
/** Delay before a hovering row shows its request card. */
const HOVER_SHOW_DELAY = 180
/** Grace period for moving the pointer from a row into its request card. */
const HOVER_HIDE_DELAY = 160
/** Duration of the locate flash on a canvas block. */
const FLASH_DURATION = 900
/** Pointer travel that turns a grip press into a drag. */
const DRAG_THRESHOLD = 4
/** Distance kept from the viewport edge. */
const CARD_MARGIN = 8

/** Query the edit-canvas overlay element for one block id. */
function blockElement(blockId: string): HTMLElement | null {
  return blockAnchorElement(blockId)
}

/** Query the arrangement row that anchors one request card. */
function arrangementRowElement(blockId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-dsh-iui-edit-arrangement-row][data-block-id="${blockId}"]`)
}

/** Scroll behavior that respects the user's motion preference. */
function scrollBehavior(): ScrollBehavior {
  if (typeof window.matchMedia !== 'function') return 'auto'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** One panel icon; the shared Remix set keeps every action visually consistent. */
function Glyph({ name, size = 15, className }: {
  readonly name: RemixIconName
  readonly size?: number
  readonly className?: string
}): ReactElement {
  return <RemixIcon name={name} size={size} className={className} />
}

/** Block-kind icon used by the arrangement rows and the hover card. */
const TYPE_GLYPHS: Readonly<Record<ArtifactBlockKind, RemixIconName>> = {
  table: 'table-line',
  chart: 'bar-chart-line',
  interactive: 'cursor-line',
  card: 'window-line',
  section: 'separator',
  drawing: 'brush-line',
  media: 'image-line',
  container: 'layout-line',
  divider: 'separator',
  spacer: 'layout-line',
  toc: 'file-text-line',
  heading: 'font-size',
  caption: 'file-text-line',
  text: 'file-text-line',
}

/** Small per-kind block glyph, matching the design's list icons. */
function TypeGlyph({ kind }: { readonly kind: ArtifactBlockKind }): ReactElement {
  return <Glyph name={TYPE_GLYPHS[kind] ?? 'file-text-line'} />
}

/** Six-dot drag handle. */
function GripGlyph(): ReactElement {
  return <Glyph name="draggable" size={14} />
}

/** Reset-order glyph. */
function ResetGlyph(): ReactElement {
  return <Glyph name="refresh-line" size={13} />
}

/** Multi-select glyph for the batch-mode toggle. */
function BatchGlyph(): ReactElement {
  return <Glyph name="checkbox-circle-fill" size={13} />
}

/** Check glyph inside the batch selection control. */
function CheckGlyph(): ReactElement {
  return <Glyph name="check-line" size={12} />
}

/** Close glyph for the narrow drawer control. */
function CloseGlyph(): ReactElement {
  return <Glyph name="close-line" size={13} />
}

/** Pencil glyph for edit actions. */
function EditGlyph(): ReactElement {
  return <Glyph name="edit-line" size={14} />
}

/** Trash glyph for request deletion. */
function TrashGlyph(): ReactElement {
  return <Glyph name="delete-bin-line" size={13} />
}

/** Overlapping-cards glyph for structural duplicate. */
function DuplicateGlyph(): ReactElement {
  return <Glyph name="file-copy-line" size={13} />
}

/** Plus glyph for the add-block action. */
function PlusGlyph(): ReactElement {
  return <Glyph name="add-line" size={12} />
}

/** Arrow-into-frame glyph for the move-to action. */
function MoveGlyph(): ReactElement {
  return <Glyph name="drag-move-line" size={13} />
}

/** Position of the anchored request card in viewport coordinates. */
interface CardPlacement {
  readonly left: number
  readonly top: number
  readonly maxHeight: number
}

/**
 * Compact request card shown while hovering an arrangement row that already has
 * a saved request. It sits beside the rail, never over it, and stays open while
 * the pointer is over the row or the card.
 * @param props - locale seat, block, its request, and card actions.
 * @returns the body-portaled card.
 */
function RequestHoverCard({ t, block, order, instruction, onEnter, onLeave }: {
  readonly t: Translate
  readonly block: ArtifactBlock
  readonly order: number
  readonly instruction: string
  readonly onEnter: () => void
  readonly onLeave: () => void
}): ReactElement {
  const panel = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<CardPlacement | null>(null)
  const title = block.title !== undefined && block.title.trim() !== '' ? block.title : blockKindLabel(block.kind, t)

  useEffect(() => {
    const place = (): void => {
      const anchor = arrangementRowElement(block.blockId)
      const card = panel.current
      if (anchor === null || card === null) return
      const rect = anchor.getBoundingClientRect()
      const width = card.offsetWidth
      const height = card.offsetHeight
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      // The rail is docked on the right, so the card opens to the left of it.
      let left = rect.left - width - CARD_MARGIN
      if (left < CARD_MARGIN) left = Math.min(rect.right + CARD_MARGIN, viewportWidth - width - CARD_MARGIN)
      left = Math.max(CARD_MARGIN, left)
      const maxHeight = Math.max(120, viewportHeight - CARD_MARGIN * 2)
      const top = Math.max(CARD_MARGIN, Math.min(rect.top, viewportHeight - CARD_MARGIN - Math.min(height, maxHeight)))
      setPlacement(current => current !== null && current.left === left && current.top === top && current.maxHeight === maxHeight
        ? current
        : { left, top, maxHeight })
    }
    place()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : undefined
    if (panel.current !== null) observer?.observe(panel.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [block.blockId])

  const style: CSSProperties = placement === null
    ? { left: 0, top: 0, opacity: 0, pointerEvents: 'none' }
    : { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }

  return createPortal(
    <div
      ref={panel}
      className={`dsh-iui-edit-hover-card dsh-iui-edit-color-${((order - 1) % COLOR_COUNT) + 1}`}
      role="dialog"
      aria-label={`${t('edit.requirement')}: ${title}`}
      data-dsh-iui-edit-hover-card
      data-block-id={block.blockId}
      style={style}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="dsh-iui-edit-card-head">
        <span className="dsh-iui-edit-badge" aria-hidden="true">{order}</span>
        <span className="dsh-iui-edit-card-glyph"><TypeGlyph kind={block.kind} /></span>
        <span className="dsh-iui-edit-card-title">{title}</span>
      </div>
      <p className="dsh-iui-edit-card-label">{t('edit.requirement')}</p>
      <p className="dsh-iui-edit-card-body">{instruction}</p>
    </div>,
    document.body,
  )
}

/**
 * One saved request row: order badge, block title, its instruction and the
 * edit/delete actions. Clicking the row body also opens the instruction popover.
 * @param props - locale seat, block, its request entry and handlers.
 * @returns the list row.
 */
function RequestRow({ t, block, order, instruction, onOpen, onEdit, onDelete, hovered, onHoverBlock }: {
  readonly t: Translate
  readonly block: ArtifactBlock
  readonly order: number
  readonly instruction: string
  readonly onOpen: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly hovered: boolean
  readonly onHoverBlock: (blockId: string | null) => void
}): ReactElement {
  const title = block.title !== undefined && block.title.trim() !== '' ? block.title : blockKindLabel(block.kind, t)
  return (
    <li
      className={`dsh-iui-edit-request-row dsh-iui-edit-color-${((order - 1) % COLOR_COUNT) + 1}${hovered ? ' is-hover-linked' : ''}`}
      data-dsh-iui-edit-request-row
      data-block-id={block.blockId}
      data-hover-linked={hovered ? 'true' : undefined}
      onPointerEnter={() => { onHoverBlock(block.blockId) }}
      onPointerLeave={() => { onHoverBlock(null) }}
    >
      <button type="button" className="dsh-iui-edit-request-open" onClick={onOpen}>
        <span className="dsh-iui-edit-request-index" aria-hidden="true">
          <span className="dsh-iui-edit-request-tick" />
          <span className="dsh-iui-edit-request-number">{order}</span>
        </span>
        <span className="dsh-iui-edit-request-text">
          <span className="dsh-iui-edit-request-title">{title}</span>
          <span className="dsh-iui-edit-request-instruction">{instruction}</span>
        </span>
      </button>
      <span className="dsh-iui-edit-request-actions">
        <button
          type="button"
          className="dsh-iui-edit-icon-button"
          data-dsh-iui-edit-request-edit
          aria-label={`${t('edit.openRequirement')}: ${title}`}
          title={t('edit.openRequirement')}
          onClick={onEdit}
        >
          <EditGlyph />
        </button>
        <button
          type="button"
          className="dsh-iui-edit-icon-button dsh-iui-edit-icon-button-danger"
          data-dsh-iui-edit-request-delete
          aria-label={`${t('edit.removeRequest')}: ${title} — ${t('edit.removeRequestHint')}`}
          title={`${t('edit.removeRequest')} — ${t('edit.removeRequestHint')}`}
          onClick={onDelete}
        >
          <TrashGlyph />
        </button>
      </span>
    </li>
  )
}

/** Pointer-drag bookkeeping for one arrangement list (root or nested group). */
interface DragState {
  readonly blockId: string
  /** Display id of the nested parent group; omitted for the root list. */
  readonly parentId?: string
  readonly startY: number
  readonly grip: HTMLButtonElement
  /** The list element that owns this drag (root or one nested group). */
  readonly list: HTMLElement
  /** Row selector for the list (`[data-dsh-iui-edit-nested-row]` or root). */
  readonly rowSelector: string
  moved: boolean
}

/** Insertion line computed from the row midpoints, relative to the list. */
interface DropTarget {
  readonly index: number
  readonly y: number
  /** Nested parent group; omitted for the root list. */
  readonly parentId?: string
}

/** Open "move to container" menu, anchored in viewport coordinates. */
interface MoveMenuState {
  readonly blockId: string
  readonly left: number
  readonly top: number
}

/** One candidate target of the move-to menu. */
interface MoveTarget {
  readonly id: string
  readonly title: string
  readonly meta: string
}

/** Focusable descendants used by the preview dialog focus trap. */
const PREVIEW_FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** One structure operation kept in the panel-local batch draft. */
interface BatchStructureOp {
  /** Panel-local id (the store assigns the persisted id on save). */
  readonly id: string
  readonly op: 'delete' | 'duplicate'
  readonly blockId: string
}

/** Menu geometry used for placement and viewport clamping. */
const MOVE_MENU_WIDTH = 228
const MOVE_MENU_MAX_HEIGHT = 280
const MOVE_MENU_ROW_HEIGHT = 30

/** One nested container shown in the nested arrangement tree. */
interface NestedGroup {
  readonly parent: ArtifactBlock
  /** Child display ids in the pending nested order (already sanitized). */
  readonly childIds: readonly string[]
}

/** How long a structural error stays visible before auto-dismissing. */
const STRUCTURE_ERROR_TIMEOUT_MS = 8000

/** Order actions shown by the batch toolbar, in display order. */
const BATCH_ORDER_ACTIONS: readonly { mode: BatchOrderMode; labelKey: string }[] = [
  { mode: 'up', labelKey: 'edit.batchMoveUp' },
  { mode: 'down', labelKey: 'edit.batchMoveDown' },
  { mode: 'top', labelKey: 'edit.batchMoveTop' },
  { mode: 'bottom', labelKey: 'edit.batchMoveBottom' },
]

/**
 * One compact overflow action menu per arrangement row.
 *
 * A single 24px trigger keeps the row title readable at every panel width and
 * works on touch; the menu carries locate/edit/duplicate/move/delete with a
 * persistent two-step delete confirmation.
 * @param props - locale, target block, busy/confirm state and handlers.
 * @returns the trigger and its portaled menu.
 */
function StructureActions({ t, blockId, title, busy, confirming, moveOpen, onEdit, onDuplicate, onRequestDelete, onCancelDelete, onConfirmDelete, onMove, onLocate }: {
  readonly t: Translate
  readonly blockId: string
  readonly title: string
  readonly busy: boolean
  readonly confirming: boolean
  readonly moveOpen: boolean
  readonly onEdit: () => void
  readonly onDuplicate: (anchor: HTMLButtonElement) => void
  readonly onRequestDelete: (anchor: HTMLButtonElement) => void
  readonly onCancelDelete: () => void
  readonly onConfirmDelete: () => void
  readonly onMove: (anchor: HTMLButtonElement) => void
  readonly onLocate: () => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  const menuId = useId()
  const width = 208

  const close = (restoreFocus: boolean): void => {
    setOpen(false)
    if (!restoreFocus || typeof window === 'undefined') return
    window.requestAnimationFrame(() => { triggerRef.current?.focus({ preventScroll: true }) })
  }

  const dismiss = (restoreFocus: boolean): void => {
    if (confirming) onCancelDelete()
    close(restoreFocus)
  }

  // Keep the confirmation step in the open menu; close it when the parent clears it.
  useEffect(() => {
    if (confirming && !wasConfirming.current) {
      wasConfirming.current = true
      setOpen(true)
      return
    }
    if (!confirming && wasConfirming.current) {
      wasConfirming.current = false
      setOpen(false)
    }
  }, [confirming])

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (trigger === null) return
    const place = (): void => {
      const rect = trigger.getBoundingClientRect()
      const height = menuRef.current?.offsetHeight ?? (confirming ? 92 : 190)
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      const below = rect.bottom + 4
      const top = below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, rect.top - height - 4)
      setPlacement({ left, top })
    }
    place()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
    observer?.observe(trigger)
    if (menuRef.current !== null) observer?.observe(menuRef.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const frame = requestAnimationFrame(() => {
      ;(confirming ? cancelRef.current : firstItemRef.current)?.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, confirming])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (triggerRef.current?.contains(target as Node) === true) return
      if (menuRef.current?.contains(target as Node) === true) return
      dismiss(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      dismiss(true)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onOtherMenu = (event: Event): void => {
      const detail = (event as CustomEvent<{ blockId?: string }>).detail
      if (detail?.blockId === blockId) return
      dismiss(false)
    }
    document.addEventListener('dsh-iui:row-menu-open', onOtherMenu)
    return () => { document.removeEventListener('dsh-iui:row-menu-open', onOtherMenu) }
  }, [open, blockId, confirming])

  useEffect(() => {
    if (!open) return
    const onFocusOut = (event: FocusEvent): void => {
      const next = event.relatedTarget
      if (next instanceof Node && (menuRef.current?.contains(next) || triggerRef.current?.contains(next))) return
      dismiss(false)
    }
    document.addEventListener('focusout', onFocusOut, true)
    return () => { document.removeEventListener('focusout', onFocusOut, true) }
  }, [open, confirming])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Tab') {
      if (confirming) {
        const choices = [...(menuRef.current?.querySelectorAll<HTMLElement>('[data-dsh-iui-edit-structure-cancel], [data-dsh-iui-edit-structure-confirm-delete]') ?? [])]
        const index = choices.indexOf(document.activeElement as HTMLElement)
        const leaving = (!event.shiftKey && index === choices.length - 1) ||
          (event.shiftKey && index === 0)
        if (!leaving) return
      }
      // Focus the trigger before the menu unmounts so the browser's default Tab
      // continues from a real, connected element instead of document.body.
      triggerRef.current?.focus({ preventScroll: true })
      dismiss(false)
      return
    }
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [data-dsh-iui-edit-structure-cancel], [data-dsh-iui-edit-structure-confirm-delete]') ?? [])]
      .filter(item => !item.hasAttribute('disabled'))
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = current < 0 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length
      items[next]?.focus()
    }
  }

  const anchor = (): HTMLButtonElement | null => triggerRef.current

  const run = (action: () => void, restoreFocus = false): void => {
    close(false)
    action()
    if (!restoreFocus || typeof window === 'undefined') return
    window.requestAnimationFrame(() => { triggerRef.current?.focus({ preventScroll: true }) })
  }

  return (
    <span className="dsh-iui-edit-structure-actions">
      <button
        ref={triggerRef}
        type="button"
        className="dsh-iui-edit-row-menu-trigger"
        data-dsh-iui-edit-row-menu
        data-block-id={blockId}
        disabled={busy}
        aria-label={`${t('edit.moreActions')}: ${title}`}
        aria-haspopup="menu"
        aria-expanded={open || moveOpen}
        aria-controls={open ? menuId : undefined}
        title={t('edit.moreActions')}
        onClick={event => {
          event.stopPropagation()
          if (open) close(true)
          else {
            document.dispatchEvent(new CustomEvent('dsh-iui:row-menu-open', { detail: { blockId } }))
            setOpen(true)
          }
        }}
      >
        <RemixIcon name="more-line" size={15} />
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="dsh-iui-edit-row-menu"
          data-dsh-iui-edit-row-menu-panel
          role={confirming ? 'dialog' : 'menu'}
          aria-label={`${t('edit.moreActions')}: ${title}`}
          style={placement === null ? { left: 0, top: 0, width, opacity: 0 } : { ...placement, width }}
          onKeyDown={onMenuKeyDown}
          onClick={event => { event.stopPropagation() }}
        >
          {confirming ? (
            <div
              className="dsh-iui-edit-structure-confirm"
              data-dsh-iui-edit-structure-confirm
              role="group"
              aria-label={t('edit.structureConfirmQuestion')}
            >
              <p className="dsh-iui-edit-row-menu-question">{t('edit.structureConfirmQuestion')}</p>
              <div className="dsh-iui-edit-row-menu-confirm-actions">
                <button
                  ref={cancelRef}
                  type="button"
                  className="dsh-iui-edit-row-menu-button"
                  data-dsh-iui-edit-structure-cancel
                  disabled={busy}
                  onClick={() => { onCancelDelete(); close(true) }}
                >{t('edit.structureCancel')}</button>
                <button
                  type="button"
                  className="dsh-iui-edit-row-menu-button is-danger"
                  data-dsh-iui-edit-structure-confirm-delete
                  disabled={busy}
                  onClick={() => { onConfirmDelete(); close(false) }}
                >{t('edit.structureDeleteNow')}</button>
              </div>
            </div>
          ) : (
            <>
              <button
                ref={firstItemRef}
                type="button"
                className="dsh-iui-edit-row-menu-item"
                role="menuitem"
                data-dsh-iui-edit-locate
                data-block-id={blockId}
                disabled={busy}
                onClick={() => run(onLocate, true)}
              >
                <RemixIcon name="map-pin-line" size={14} /><span>{t('edit.locate')}</span>
              </button>
              <button
                type="button"
                className="dsh-iui-edit-row-menu-item"
                role="menuitem"
                data-dsh-iui-edit-structure-edit
                data-block-id={blockId}
                disabled={busy}
                onClick={() => run(onEdit)}
              >
                <EditGlyph /><span>{t('edit.openRequirement')}</span>
              </button>
              <button
                type="button"
                className="dsh-iui-edit-row-menu-item"
                role="menuitem"
                data-dsh-iui-edit-structure-duplicate
                data-block-id={blockId}
                disabled={busy}
                onClick={() => { const target = anchor(); close(false); onDuplicate(target as HTMLButtonElement) }}
              >
                <DuplicateGlyph /><span>{t('edit.structureDuplicate')}</span>
              </button>
              <button
                type="button"
                className="dsh-iui-edit-row-menu-item"
                role="menuitem"
                data-dsh-iui-edit-move
                data-block-id={blockId}
                disabled={busy}
                onClick={() => { const target = anchor(); close(false); onMove(target as HTMLButtonElement) }}
              >
                <MoveGlyph /><span>{t('edit.moveBlock')}</span>
              </button>
              <div className="dsh-iui-edit-row-menu-sep" aria-hidden="true" />
              <button
                type="button"
                className="dsh-iui-edit-row-menu-item is-danger"
                role="menuitem"
                data-dsh-iui-edit-structure-delete
                data-block-id={blockId}
                disabled={busy}
                onClick={() => onRequestDelete(anchor() as HTMLButtonElement)}
              >
                <TrashGlyph /><span>{t('edit.structureDelete')}</span>
              </button>
            </>
          )}
        </div>,
        document.body,
      ) : null}
    </span>
  )
}

/**
 * One batch action toolbar, shared by the root and nested arrangement sections.
 *
 * The two lists only differ in their data hooks (`data-dsh-iui-edit-batch-*`
 * versus `data-dsh-iui-edit-nested-batch-*`); controls, disabled semantics and
 * the accessibility shape stay identical.
 * @param props - locale seat, list scope, selection facts and handlers.
 * @returns the toolbar rendered below the arrangement hint.
 */
function BatchToolbar({ t, nested, count, allSelected, canMove, structureDisabled, structureHint, overLimit, pendingOps, pendingLabels, onSelectAll, onClear, onSave, onCancel, onRemovePending, onOrder, onStructure }: {
  readonly t: Translate
  readonly nested: boolean
  readonly count: number
  readonly allSelected: boolean
  readonly canMove: Readonly<Record<BatchOrderMode, boolean>>
  readonly structureDisabled: boolean
  readonly structureHint?: string
  readonly overLimit: boolean
  readonly pendingOps: number
  readonly pendingLabels: readonly { readonly id: string; readonly label: string }[]
  readonly onSelectAll: () => void
  readonly onClear: () => void
  readonly onSave: () => void
  readonly onCancel: () => void
  readonly onRemovePending: (id: string) => void
  readonly onOrder: (mode: BatchOrderMode) => void
  readonly onStructure: (op: 'delete' | 'duplicate', anchor: HTMLElement) => void
}): ReactElement {
  const prefix = nested ? 'data-dsh-iui-edit-nested-batch' : 'data-dsh-iui-edit-batch'
  const hook = (suffix: string, value = ''): Record<string, string> => ({ [`${prefix}-${suffix}`]: value })
  return (
    <div className="dsh-iui-edit-batch" {...hook('bar')} role="group" aria-label={t('edit.batchToolbarLabel')}>
      <div className="dsh-iui-edit-batch-row">
        <span className="dsh-iui-edit-batch-count" role="status" aria-live="polite" {...hook('count')}>
          {t('edit.batchSelectedCount', { count })}
        </span>
        <span className="dsh-iui-edit-section-spacer" />
        <button
          type="button"
          className="dsh-iui-edit-batch-action"
          {...hook('select-all')}
          disabled={allSelected}
          aria-label={t('edit.batchSelectAll')}
          title={t('edit.batchSelectAll')}
          onClick={onSelectAll}
        >{t('edit.batchSelectAll')}</button>
        <button
          type="button"
          className="dsh-iui-edit-batch-action"
          {...hook('clear')}
          disabled={count === 0}
          aria-label={t('edit.batchClear')}
          title={t('edit.batchClear')}
          onClick={onClear}
        >{t('edit.batchClear')}</button>
      </div>
      <div className="dsh-iui-edit-batch-group" role="group" aria-label={t('edit.batchOrderGroup')}>
        {BATCH_ORDER_ACTIONS.map(action => {
          const label = t(action.labelKey)
          return (
            <button
              key={action.mode}
              type="button"
              className="dsh-iui-edit-batch-action"
              {...hook('order', action.mode)}
              disabled={!canMove[action.mode]}
              aria-label={label}
              title={count === 0 ? t('edit.batchNeedSelection') : label}
              onClick={() => { onOrder(action.mode) }}
            >{label}</button>
          )
        })}
      </div>
      <div className="dsh-iui-edit-batch-group" role="group" aria-label={t('edit.batchStructureGroup')}>
        <button
          type="button"
          className="dsh-iui-edit-batch-action"
          {...hook('duplicate')}
          disabled={structureDisabled}
          aria-label={t('edit.batchDuplicate')}
          title={structureHint ?? t('edit.batchDuplicate')}
          onClick={event => { onStructure('duplicate', event.currentTarget) }}
        >
          <DuplicateGlyph />{t('edit.batchDuplicate')}
        </button>
        <button
          type="button"
          className="dsh-iui-edit-batch-action is-danger"
          {...hook('delete')}
          disabled={structureDisabled}
          aria-label={t('edit.batchDelete')}
          title={structureHint ?? t('edit.batchDelete')}
          onClick={event => { onStructure('delete', event.currentTarget) }}
        >
          <TrashGlyph />{t('edit.batchDelete')}
        </button>
      </div>
      {overLimit ? (
        <p className="dsh-iui-edit-batch-limit" role="alert" {...hook('limit')}>
          {t('edit.batchLimit', { max: MAX_ARTIFACT_STRUCTURE_OPERATIONS, count })}
        </p>
      ) : null}
      <div className="dsh-iui-edit-batch-pending" {...hook('pending')} role="status" aria-live="polite">
        <span className="dsh-iui-edit-batch-pending-label">
          {t('edit.batchPending', { count: pendingOps })}
        </span>
        {pendingLabels.length === 0 ? null : (
          <ul className="dsh-iui-edit-batch-pending-list">
            {pendingLabels.map(entry => (
              <li key={entry.id} className="dsh-iui-edit-batch-pending-item" {...hook('pending-item')} data-op-id={entry.id} title={entry.label}>
                <span className="dsh-iui-edit-batch-pending-text">{entry.label}</span>
                <button
                  type="button"
                  className="dsh-iui-edit-batch-pending-remove"
                  {...hook('pending-remove')}
                  data-op-id={entry.id}
                  aria-label={`${t('edit.batchPendingRemove')}: ${entry.label}`}
                  title={t('edit.batchPendingRemove')}
                  onClick={() => { onRemovePending(entry.id) }}
                >
                  <CloseGlyph />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="dsh-iui-edit-batch-actions">
        <button
          type="button"
          className="dsh-iui-edit-batch-action"
          {...hook('cancel')}
          aria-label={t('edit.batchCancel')}
          title={t('edit.batchCancel')}
          onClick={onCancel}
        >{t('edit.batchCancel')}</button>
        <button
          type="button"
          className="dsh-iui-edit-batch-action dsh-iui-edit-batch-save"
          {...hook('save')}
          aria-label={t('edit.batchSave')}
          title={t('edit.batchSave')}
          onClick={onSave}
        >{t('edit.batchSave')}</button>
      </div>
    </div>
  )
}

/** Artifact edit panel: requests, block arrangement, global instruction, summary. */
export function EditPanel({ t, session, actions, closing = false, onOpenHistory, hoveredBlockId = null, onHoverBlock, styleEditSupported = false, styleSwitchSupported = false, styleTargets = [], onPreviewStyleTarget }: EditPanelProps): ReactElement {
  const globalId = useId()
  const stylePanelId = useId()
  const applyTitleId = useId()
  const [styleOpen, setStyleOpen] = useState(false)
  const styleToggleRef = useRef<HTMLButtonElement>(null)
  const styleTextareaRef = useRef<HTMLTextAreaElement>(null)
  const styleSwitchRef = useRef<HTMLDivElement>(null)
  /** Suppresses the preview fired by the programmatic focus when the section opens. */
  const suppressSwitchPreview = useRef(false)
  const [hoverBlockId, setHoverBlockId] = useState<string | null>(null)
  const [dragBlockId, setDragBlockId] = useState<string | null>(null)
  const [dragParentId, setDragParentId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const dropRef = useRef<DropTarget | null>(null)
  const dragCleanup = useRef<(() => void) | null>(null)
  const showTimer = useRef<number | null>(null)
  const hideTimer = useRef<number | null>(null)
  const flashTimers = useRef(new Map<string, number>())

  const blocks = useMemo(
    () => new Map<string, ArtifactBlock>(session.blocks.map(block => [block.blockId, block] as const)),
    [session.blocks],
  )
  const requests = useMemo(
    () => new Map(session.selection.map(entry => [entry.blockId, entry] as const)),
    [session.selection],
  )
  const orderedRequests = useMemo(
    () => [...session.selection].sort((left, right) => left.order - right.order),
    [session.selection],
  )
  const structureBusy = session.structureBusy === true
  const structureError = session.structureError
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [dismissedStructureError, setDismissedStructureError] = useState<string | null>(null)
  const [addFormParentId, setAddFormParentId] = useState<string | null>(null)
  const [addDraft, setAddDraft] = useState('')
  const [moveMenu, setMoveMenu] = useState<MoveMenuState | null>(null)
  // Batch arrangement modes are transient panel UI state: they never persist and
  // each selection is a list of display block ids only. The root and nested
  // modes are mutually exclusive. Structure operations selected in batch mode
  // stay in a panel-local draft until "保存批量操作" queues them.
  const [batchMode, setBatchMode] = useState(false)
  const [batchSelection, setBatchSelection] = useState<readonly string[]>([])
  const [batchOps, setBatchOps] = useState<readonly BatchStructureOp[]>([])
  const batchToggleRef = useRef<HTMLButtonElement>(null)
  const batchOrderSnapshot = useRef<readonly string[] | null>(null)
  const batchOpSeq = useRef(0)
  const [nestedBatchMode, setNestedBatchMode] = useState(false)
  const [nestedBatchSelection, setNestedBatchSelection] = useState<readonly string[]>([])
  const [nestedBatchOps, setNestedBatchOps] = useState<readonly BatchStructureOp[]>([])
  const nestedBatchToggleRef = useRef<HTMLButtonElement>(null)
  const nestedOrderSnapshot = useRef<Readonly<Record<string, readonly string[]>> | null>(null)
  // The total Apply preview replaces the old single-operation preview dialog.
  const applyTriggerRef = useRef<HTMLElement | null>(null)
  const applyRestoreFocusRef = useRef<HTMLElement | null>(null)
  const applyHadOpenRef = useRef(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | undefined>(undefined)
  const [applyHint, setApplyHint] = useState('')
  // The global instruction is a local draft: only the explicit Save writes the
  // session (and therefore the composer chip summary).
  const [globalDraft, setGlobalDraft] = useState(session.globalInstruction)
  const [liveMessage, setLiveMessage] = useState('')
  const liveSequenceRef = useRef(0)
  const a11yHintId = useId()
  const moveMenuHintId = useId()
  const addHintId = useId()
  const moveMenuRef = useRef<HTMLDivElement>(null)
  const applyDialogRef = useRef<HTMLDivElement>(null)
  const applyCancelRef = useRef<HTMLButtonElement>(null)
  const moveAnchorRef = useRef<HTMLButtonElement | null>(null)
  // Nested edit mode: one group per container with at least two editable
  // direct children. The pending order falls back to the base order, and any
  // child missing from the pending record is appended so no row disappears.
  const nestedGroups = useMemo<NestedGroup[]>(() => {
    if (session.nestedMode !== true) return []
    const childrenByParent = new Map<string, string[]>()
    for (const block of session.blocks) {
      if (block.parentBlockId === undefined) continue
      const children = childrenByParent.get(block.parentBlockId) ?? []
      children.push(block.blockId)
      childrenByParent.set(block.parentBlockId, children)
    }
    const groups: NestedGroup[] = []
    for (const block of session.blocks) {
      const childIds = childrenByParent.get(block.blockId)
      if (childIds === undefined || childIds.length < 1) continue
      const target = session.nestedOrder?.[block.blockId] ?? session.nestedOriginalOrder?.[block.blockId] ?? childIds
      const ordered = [
        ...target.filter(childId => childIds.includes(childId)),
        ...childIds.filter(childId => !target.includes(childId)),
      ]
      groups.push({ parent: block, childIds: ordered })
    }
    return groups
  }, [session.nestedMode, session.blocks, session.nestedOrder, session.nestedOriginalOrder])
  // Move-to candidates: root plus every allowlisted container block, minus the
  // block itself, its descendants and the parent it already lives in.
  const nestedContainerIds = useMemo(
    () => new Set(session.blocks.filter(block => (NESTED_CONTAINER_TYPES as readonly string[]).includes(block.componentType)).map(block => block.blockId)),
    [session.blocks],
  )
  const childrenByParent = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const block of session.blocks) {
      if (block.parentBlockId === undefined) continue
      const children = map.get(block.parentBlockId) ?? []
      children.push(block.blockId)
      map.set(block.parentBlockId, children)
    }
    return map
  }, [session.blocks])
  const moveTargetsFor = (blockId: string): MoveTarget[] => {
    const block = blocks.get(blockId)
    if (block === undefined) return []
    const excluded = new Set<string>([blockId])
    const queue = [...(childrenByParent.get(blockId) ?? [])]
    while (queue.length > 0) {
      const descendant = queue.shift() as string
      excluded.add(descendant)
      queue.push(...(childrenByParent.get(descendant) ?? []))
    }
    // The Host rejects moving into descendants and into ancestor/descendant
    // containers (their children slots are nested); exclude the whole ancestor
    // chain and do not offer the root target (root is an ancestor for any
    // nested source). Same-parent moves are expressed by ordering instead.
    let ancestor = block.parentBlockId
    while (ancestor !== undefined) {
      excluded.add(ancestor)
      ancestor = blocks.get(ancestor)?.parentBlockId
    }
    const targets: MoveTarget[] = []
    // A container inside the source parent is an ancestor/descendant container
    // pair for the Host's cross-move validation: moving from the parent's slot
    // into one of its own descendant containers is rejected.
    const sourceParent = block.parentBlockId
    const isInsideSourceParent = (candidateId: string): boolean => {
      if (sourceParent === undefined) return false
      let cursor = blocks.get(candidateId)?.parentBlockId
      while (cursor !== undefined) {
        if (cursor === sourceParent) return true
        cursor = blocks.get(cursor)?.parentBlockId
      }
      return false
    }
    for (const candidate of session.blocks) {
      if (!nestedContainerIds.has(candidate.blockId) || excluded.has(candidate.blockId)) continue
      if (isInsideSourceParent(candidate.blockId)) continue
      const title = candidate.title !== undefined && candidate.title.trim() !== '' ? candidate.title : blockKindLabel(candidate.kind, t)
      targets.push({ id: candidate.blockId, title, meta: blockKindLabel(candidate.kind, t) })
    }
    return targets
  }
  const moveTargets = moveMenu === null ? [] : moveTargetsFor(moveMenu.blockId)
  /** Localized display name of one block in the current canvas. */
  const blockLabel = (blockId: string): string => {
    const block = blocks.get(blockId)
    if (block === undefined) return blockId
    return block.title !== undefined && block.title.trim() !== '' ? block.title : blockKindLabel(block.kind, t)
  }
  const pendingOps = session.pendingOps ?? []
  const pendingOpEntries = pendingOps.map(op => ({
    id: op.id,
    label: `${t(`edit.pendingOp.${op.op}`)} · ${blockLabel(op.blockId)}`,
  }))
  const batchPendingEntries = batchOps.map(op => ({
    id: op.id,
    label: `${t(`edit.pendingOp.${op.op}`)} · ${blockLabel(op.blockId)}`,
  }))
  const nestedBatchPendingEntries = nestedBatchOps.map(op => ({
    id: op.id,
    label: `${t(`edit.pendingOp.${op.op}`)} · ${blockLabel(op.blockId)}`,
  }))
  const globalDirty = globalDraft !== session.globalInstruction
  const hasSavedContent = hasArtifactEditContent(session)
  const hasBlockOrGlobalContent = session.selection.length > 0
    || (session.additions?.length ?? 0) > 0
    || session.orderChanged
    || session.nestedOrderChanged === true
    || session.globalInstruction.trim() !== ''
  const styleOnly = session.styleInstruction.trim() !== '' && !hasBlockOrGlobalContent
  const hasModelContent = hasBlockOrGlobalContent || session.styleInstruction.trim() !== ''
  const batchUnsaved = batchMode || nestedBatchMode
  const canApply = hasSavedContent && !structureBusy && !applyBusy
  const applyPreview = session.applyPreview
  const applyPreviewReady = applyPreview !== undefined && applyPreview.status === 'ready'
  const applyConflicts = applyPreview?.conflicts ?? []
  const applyBlocked = applyConflicts.length > 0 || applyPreview?.structureReady === false
  const applyConfirmLabel = applyPreview === undefined || applyPreview.ops.length === 0
    ? t('edit.applyPreviewConfirmModel')
    : hasModelContent ? t('edit.applyPreviewConfirmMixed') : t('edit.applyPreviewConfirm')
  /** One localized conflict line for the preview dialog. */
  const conflictText = (conflict: PendingApplyConflict): string => {
    const block = conflict.blockId === undefined ? '' : blockLabel(conflict.blockId)
    switch (conflict.kind) {
      case 'selection': return t('edit.applyConflict.selection', { block })
      case 'addition': return t('edit.applyConflict.addition', { block })
      case 'styleMixed': return t('edit.applyConflict.styleMixed')
      case 'overlap': return t('edit.applyConflict.overlap')
      case 'duplicate': return t('edit.applyConflict.duplicate', { block })
      case 'limit': return t('edit.applyConflict.limit', { max: MAX_PENDING_STRUCTURE_OPS })
      case 'unresolved': return t('edit.applyConflict.unresolved', { block })
      case 'target': return t('edit.applyConflict.target', { block })
      case 'order': return t('edit.applyConflict.order')
      case 'depth': return t('edit.applyConflict.depth')
      case 'nestedTarget': return t('edit.applyConflict.nestedTarget')
      default: return t('edit.applyConflict.unresolved', { block })
    }
  }
  /** Locale key of one post-Apply notice. */
  const applyNoticeKey = (notice: ApplyOutcomeNotice): string => {
    switch (notice) {
      case 'submitted': return 'edit.applyNotice.submitted'
      case 'manual': return 'edit.applyNotice.manual'
      case 'extraText': return 'edit.applyNotice.extraText'
      case 'rebaseFailed': return 'edit.applyNotice.rebaseFailed'
    }
  }
  const hoverEntry = hoverBlockId === null ? undefined : requests.get(hoverBlockId)
  const hoverBlock = hoverBlockId === null ? undefined : blocks.get(hoverBlockId)
  const removedName = (() => {
    const removed = session.removable
    if (removed === undefined) return ''
    const block = blocks.get(removed.blockId)
    if (block === undefined) return `#${removed.order}`
    return block.title ?? blockKindLabel(block.kind, t)
  })()

  // B1 style section facts: the recorded skin, the live instruction and the
  // mixed guard that mirrors the store's style_mixed rule.
  const styleHasContent = session.styleInstruction.trim() !== ''
  const styleBlockContent = session.selection.length > 0
    || (session.additions?.length ?? 0) > 0
    || session.orderChanged
    || session.nestedOrderChanged === true
    || session.globalInstruction.trim() !== ''
  const styleMixed = styleHasContent && styleBlockContent
  const styleSkinLabel = session.temporaryStyle !== undefined
    ? t('edit.styleSkinTemporary')
    : session.styleId !== undefined
      ? t('edit.styleSkinSaved')
      : t('edit.styleSkinBuiltin')
  const styleLayoutLabel = session.style === 'card'
    ? t('edit.historyStyleCard')
    : session.style === 'article' ? t('edit.historyStyleArticle') : t('edit.historyStyleFree')
  const styleCurrentLabel = `${styleSkinLabel} · ${styleLayoutLabel}`
  const styleCurrentOption = styleTargets.find(option => isCurrentStyleTarget(session, option.target, option.layout))
  const styleHeaderTheme = session.temporaryStyle?.theme ?? styleCurrentOption?.theme
  const styleNewResultHint = session.temporaryStyle !== undefined
    ? t('edit.styleNewResultTemporary')
    : t('edit.styleNewResult')
  // B2 switch facts: capability + resolved targets, the pending selection and
  // the Host's current-identity no-op rule.
  const styleSwitchAvailable = styleSwitchSupported && styleTargets.length > 0
  const styleSwitchChosen = session.styleSwitchTarget
  const styleSwitchChosenLayout = session.styleSwitchTargetLayout
  const styleSwitchCurrent = styleSwitchChosen !== undefined && isCurrentStyleTarget(session, styleSwitchChosen, styleSwitchChosenLayout)
  // A pending natural-language style instruction owns the section's send path:
  // disabling Apply up front explains the conflict instead of failing after click.
  // One predicate shared with the Host: an Article target is disabled before
  // selection when the current program cannot become an article page.
  const articleProblem = useMemo(
    () => styleSwitchAvailable && styleTargets.some(option => option.requiresArticleLayout === true)
      ? describeArticleLayoutProblem(session.program)
      : undefined,
    [session.program, styleSwitchAvailable, styleTargets],
  )
  const styleChosenOption = styleSwitchChosen === undefined
    ? undefined
    : styleTargets.find(option => sameStyleTarget(option.target, styleSwitchChosen) && option.layout === styleSwitchChosenLayout)
  const styleChosenDisabled = styleChosenOption === undefined ? undefined : styleTargetDisableReason(styleChosenOption, articleProblem)
  const styleBlockDirty = styleBlockContent || session.activeDirty === true || session.activeDraft.trim() !== ''
  const styleBlocker = describeStyleSwitchBlocker({
    status: session.status,
    branch: session.branch === true,
    busy: session.styleSwitchBusy === true,
    hasTarget: styleSwitchChosen !== undefined,
    targetDisabled: styleChosenDisabled !== undefined,
    current: styleSwitchCurrent,
    dirty: styleBlockDirty,
    instruction: styleHasContent,
  })
  const styleSwitchCanApply = styleSwitchChosen !== undefined && styleBlocker === undefined
  const styleStatusId = `${stylePanelId}-switch-status`
  const articleNoteId = `${stylePanelId}-article-note`
  const styleStatusKey = styleBlocker === 'checking' ? 'edit.styleStatusChecking'
    : styleBlocker === 'stale' ? 'edit.styleStatusStale'
    : styleBlocker === 'busy' ? 'edit.styleSwitchBusy'
    : styleBlocker === 'dirty' ? 'edit.styleStatusDirty'
    : styleBlocker === 'instruction' ? 'edit.styleStatusInstruction'
    : styleBlocker === 'no_target' ? 'edit.styleStatusNoTarget'
    : styleBlocker === 'unavailable' ? 'edit.styleStatusUnavailable'
    : styleBlocker === 'current' ? 'edit.styleStatusCurrent'
    : session.branch === true ? 'edit.styleStatusBranch'
    : session.temporaryStyle !== undefined ? 'edit.styleStatusTemporary'
    : 'edit.styleStatusReady'
  const collapseStyleSection = (): void => {
    onPreviewStyleTarget?.(undefined)
    setStyleOpen(false)
    styleToggleRef.current?.focus()
  }
  const previewSwitchOption = (option: ArtifactStyleTargetOption): void => { onPreviewStyleTarget?.(option.target) }
  const previewSelectedSwitch = (): void => { onPreviewStyleTarget?.(styleSwitchChosen) }
  // Expanding moves focus into the primary control: the switch radios when the
  // Host supports deterministic switching, otherwise the natural-language field.
  // Collapsing returns focus to the disclosure button (Escape uses the helper).
  useEffect(() => {
    if (!styleOpen) return
    let release: number | undefined
    const frame = window.requestAnimationFrame(() => {
      if (styleSwitchAvailable) {
        // Opening the section focuses a radio, but that programmatic focus must
        // not preview a different skin: keep the recorded canvas until the user
        // hovers, focuses by keyboard or selects. A macrotask release is used
        // because reduced-motion/background tabs may throttle rAF.
        suppressSwitchPreview.current = true
        const radios = styleSwitchRef.current?.querySelectorAll<HTMLInputElement>('[data-dsh-iui-edit-style-target]')
        const options = radios === undefined ? [] : [...radios]
        const target = options.find(radio => radio.checked)
          ?? options.find(radio => radio.getAttribute('data-current') === 'true')
          ?? options[0]
        target?.focus({ preventScroll: true })
        release = window.setTimeout(() => { suppressSwitchPreview.current = false }, 0)
        return
      }
      styleTextareaRef.current?.focus({ preventScroll: true })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (release !== undefined) window.clearTimeout(release)
    }
  }, [styleOpen, styleSwitchAvailable])
  // A transient preview never survives leaving the section.
  useEffect(() => () => { onPreviewStyleTarget?.(undefined) }, [onPreviewStyleTarget])

  const clearHoverTimers = (): void => {
    if (showTimer.current !== null) { window.clearTimeout(showTimer.current); showTimer.current = null }
    if (hideTimer.current !== null) { window.clearTimeout(hideTimer.current); hideTimer.current = null }
  }
  const closeHover = (): void => {
    clearHoverTimers()
    setHoverBlockId(null)
  }

  // While the docked panel is open, narrow the chat content in lockstep with the
  // panel animation; on closing, animate the width back before unmount restores
  // the shell's inline preference.
  const widthControllerRef = useRef<ChatContentWidthController | null>(null)
  const widthClosingRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const controller = applyEditChatContentWidth()
    widthControllerRef.current = controller
    return () => {
      widthControllerRef.current = null
      controller.dispose()
    }
  }, [])
  useEffect(() => {
    const controller = widthControllerRef.current
    if (controller === null) return
    if (closing && !widthClosingRef.current) {
      widthClosingRef.current = true
      controller.close()
      return
    }
    if (!closing && widthClosingRef.current) {
      widthClosingRef.current = false
      controller.open()
    }
  }, [closing])

  useEffect(() => () => {
    dragCleanup.current?.()
    clearHoverTimers()
    for (const timer of flashTimers.current.values()) window.clearTimeout(timer)
    flashTimers.current.clear()
  }, [])

  // Switching the edited revision (or leaving nested mode) closes the matching
  // batch mode and drops its local structure draft; neither mode is ever
  // persisted (unmounting the panel clears them as well).
  useEffect(() => {
    setBatchMode(false)
    setBatchSelection(current => current.length === 0 ? current : [])
    setBatchOps(current => current.length === 0 ? current : [])
    batchOrderSnapshot.current = null
    setNestedBatchMode(false)
    setNestedBatchSelection(current => current.length === 0 ? current : [])
    setNestedBatchOps(current => current.length === 0 ? current : [])
    nestedOrderSnapshot.current = null
    setApplyBusy(false)
    setApplyError(undefined)
    setApplyHint('')
    setGlobalDraft(session.globalInstruction)
  }, [session.key])

  useEffect(() => {
    setNestedBatchMode(false)
    setNestedBatchSelection(current => current.length === 0 ? current : [])
    setNestedBatchOps(current => current.length === 0 ? current : [])
    nestedOrderSnapshot.current = null
  }, [session.nestedMode])

  // Escape closes the hover card (the instruction popover owns its own Escape).
  useEffect(() => {
    if (hoverBlockId === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      closeHover()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [hoverBlockId])

  /**
   * Announce one short status through the polite live region. Clearing first
   * and setting on the next frame makes repeated identical messages audible;
   * the sequence guard drops stale frames when several announcements race.
   */
  const announce = (message: string): void => {
    liveSequenceRef.current += 1
    const sequence = liveSequenceRef.current
    setLiveMessage('')
    if (typeof window === 'undefined') { setLiveMessage(message); return }
    window.requestAnimationFrame(() => {
      if (liveSequenceRef.current === sequence) setLiveMessage(message)
    })
  }

  const clearDeleteConfirm = (): void => {
    setConfirmDeleteId(null)
  }
  const applyDialogBusy = applyPreview?.status === 'loading'
  const rowActionsBusy = structureBusy || applyBusy || applyDialogBusy
  /** Queue one structure operation and announce it; nothing is written yet. */
  const enqueueStructure = (inputs: readonly { readonly op: PendingStructureOp['op']; readonly blockId: string; readonly targetParentBlockId?: string }[]): void => {
    if (inputs.length === 0) return
    const saved = actions.savePendingOps(inputs)
    clearDeleteConfirm()
    setApplyHint('')
    if (saved.ok === false) {
      // The queue refused the operation: keep the draft untouched and say so
      // instead of announcing a success the user cannot see.
      const message = t('edit.pendingLimit', { max: saved.max })
      setApplyError(message)
      announce(message)
      return
    }
    setApplyError(undefined)
    const labels = inputs.map(input => `${t(`edit.pendingOp.${input.op}`)} · ${blockLabel(input.blockId)}`)
    announce(t('edit.a11yQueued', { items: labels.join(t('edit.listSeparator')) }))
  }
  const duplicateBlock = (blockId: string): void => {
    if (rowActionsBusy) return
    enqueueStructure([{ op: 'duplicate', blockId }])
  }
  const requestDeleteBlock = (blockId: string, _anchor: HTMLButtonElement | null): void => {
    if (rowActionsBusy) return
    // Persistent two-step confirmation: no timeout, only an explicit cancel,
    // delete, outside interaction, Escape, preview or busy state ends it.
    setConfirmDeleteId(blockId)
    announce(t('edit.a11yDeleteConfirm'))
  }
  const cancelDeleteConfirm = (): void => {
    clearDeleteConfirm()
  }
  const confirmDeleteBlock = (blockId: string): void => {
    if (confirmDeleteId !== blockId) return
    enqueueStructure([{ op: 'delete', blockId }])
    // The confirmation lives inside the row menu; put focus back on the row's
    // overflow trigger once that menu closes.
    window.requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-dsh-iui-edit-arrangement-row][data-block-id="${blockId}"], [data-dsh-iui-edit-nested-row][data-block-id="${blockId}"]`)
      row?.querySelector<HTMLElement>('[data-dsh-iui-edit-row-menu]')?.focus({ preventScroll: true })
    })
  }

  const closeAddForm = (): void => {
    setAddFormParentId(null)
    setAddDraft('')
  }
  const toggleAddForm = (parentId: string): void => {
    if (addFormParentId === parentId && addDraft.trim() === '') {
      closeAddForm()
      return
    }
    setAddFormParentId(current => current === parentId ? null : parentId)
    setAddDraft('')
  }
  const saveAddition = (parentId: string): void => {
    const instruction = addDraft.trim()
    if (instruction === '') return
    actions.saveBlockAddition(parentId, instruction)
    closeAddForm()
    announce(t('edit.a11yAdded'))
  }
  const closeMoveMenu = (): void => { setMoveMenu(null) }
  const openMoveMenu = (blockId: string, anchor: HTMLButtonElement): void => {
    clearDeleteConfirm()
    moveAnchorRef.current = anchor
    const rect = anchor.getBoundingClientRect()
    const count = Math.max(1, moveTargetsFor(blockId).length)
    const estimatedHeight = Math.min(MOVE_MENU_MAX_HEIGHT, 34 + count * MOVE_MENU_ROW_HEIGHT)
    const left = Math.max(CARD_MARGIN, Math.min(rect.left, window.innerWidth - MOVE_MENU_WIDTH - CARD_MARGIN))
    let top = rect.bottom + 4
    if (top + estimatedHeight > window.innerHeight - CARD_MARGIN) top = Math.max(CARD_MARGIN, rect.top - estimatedHeight - 4)
    setMoveMenu({ blockId, left, top })
  }
  const moveMenuTargets = (): HTMLButtonElement[] => {
    const menu = moveMenuRef.current
    return menu === null ? [] : [...menu.querySelectorAll<HTMLButtonElement>('[data-dsh-iui-edit-move-target]')]
  }
  const onMoveMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMoveMenu()
      moveAnchorRef.current?.focus({ preventScroll: true })
      return
    }
    if (event.key === 'Tab') {
      moveAnchorRef.current?.focus({ preventScroll: true })
      closeMoveMenu()
      return
    }
    const targets = moveMenuTargets()
    if (targets.length === 0) return
    const active = document.activeElement
    const current = active instanceof HTMLElement ? targets.findIndex(target => target === active) : -1
    const focusAt = (position: number): void => {
      event.preventDefault()
      targets[(position + targets.length) % targets.length].focus({ preventScroll: true })
    }
    if (event.key === 'ArrowDown') { focusAt(current + 1); return }
    if (event.key === 'ArrowUp') { focusAt(current - 1); return }
    if (event.key === 'Home') { focusAt(0); return }
    if (event.key === 'End') { focusAt(targets.length - 1); return }
    if ((event.key === 'Enter' || event.key === ' ') && current >= 0) {
      event.preventDefault()
      event.stopPropagation()
      targets[current].click()
    }
  }
  const chooseMoveTarget = (targetId: string): void => {
    if (moveMenu === null) return
    const blockId = moveMenu.blockId
    const anchor = moveAnchorRef.current
    closeMoveMenu()
    enqueueStructure([{ op: 'move', blockId, targetParentBlockId: targetId }])
    window.requestAnimationFrame(() => { if (anchor !== null && anchor.isConnected) anchor.focus({ preventScroll: true }) })
  }

  // Batch selection is pruned against the live arrangement draft, so a block
  // that disappears from the draft can never be sent in a batch operation.
  const batchSelected = useMemo(() => {
    const available = new Set(session.targetOrder)
    return batchSelection.filter(blockId => available.has(blockId))
  }, [batchSelection, session.targetOrder])
  const batchSelectedSet = useMemo(() => new Set(batchSelected), [batchSelected])
  const batchCanMove: Readonly<Record<BatchOrderMode, boolean>> = useMemo(() => ({
    up: canBatchMove(session.targetOrder, batchSelected, 'up'),
    down: canBatchMove(session.targetOrder, batchSelected, 'down'),
    top: canBatchMove(session.targetOrder, batchSelected, 'top'),
    bottom: canBatchMove(session.targetOrder, batchSelected, 'bottom'),
  }), [session.targetOrder, batchSelected])
  const batchOverLimit = batchSelected.length > MAX_ARTIFACT_STRUCTURE_OPERATIONS
  const batchStructureDisabled = batchSelected.length === 0 || batchOverLimit || rowActionsBusy
  const batchStructureHint = batchOverLimit
    ? t('edit.batchLimit', { max: MAX_ARTIFACT_STRUCTURE_OPERATIONS, count: batchSelected.length })
    : batchSelected.length === 0 ? t('edit.batchNeedSelection') : undefined

  // Nested batch selection follows the pending per-parent order; the toolbar's
  // order actions are available only when at least one group can move.
  const nestedBlockIds = useMemo(() => nestedGroups.flatMap(group => group.childIds), [nestedGroups])
  const nestedBatchSelected = useMemo(() => {
    const available = new Set(nestedBlockIds)
    return nestedBatchSelection.filter(blockId => available.has(blockId))
  }, [nestedBatchSelection, nestedBlockIds])
  const nestedBatchSelectedSet = useMemo(() => new Set(nestedBatchSelected), [nestedBatchSelected])
  const nestedSelectedGroups = useMemo(() => {
    const selected = new Set(nestedBatchSelected)
    return nestedGroups
      .map(group => ({ order: group.childIds, picked: group.childIds.filter(blockId => selected.has(blockId)) }))
      .filter(group => group.picked.length > 0)
  }, [nestedGroups, nestedBatchSelected])
  const nestedBatchCanMove: Readonly<Record<BatchOrderMode, boolean>> = useMemo(() => {
    const can = (mode: BatchOrderMode): boolean => nestedSelectedGroups.some(group => canBatchMove(group.order, group.picked, mode))
    return { up: can('up'), down: can('down'), top: can('top'), bottom: can('bottom') }
  }, [nestedSelectedGroups])
  // A container together with one of its own nested blocks cannot share one
  // atomic Host batch, so structure actions are refused before the preview.
  const nestedBatchOverlap = useMemo(() => nestedBatchSelected.some(blockId =>
    nestedBatchSelected.some(other => other !== blockId && other.startsWith(`${blockId}.`)),
  ), [nestedBatchSelected])
  const nestedBatchOverLimit = nestedBatchSelected.length > MAX_ARTIFACT_STRUCTURE_OPERATIONS
  const nestedBatchStructureDisabled = nestedBatchSelected.length === 0 || nestedBatchOverlap || nestedBatchOverLimit || rowActionsBusy
  const nestedBatchStructureHint = nestedBatchOverlap
    ? t('edit.batchNestedOverlap')
    : nestedBatchOverLimit
      ? t('edit.batchLimit', { max: MAX_ARTIFACT_STRUCTURE_OPERATIONS, count: nestedBatchSelected.length })
      : nestedBatchSelected.length === 0 ? t('edit.batchNeedSelection') : undefined

  /** Restore one order snapshot by moving only the blocks that moved. */
  const restoreTargetOrder = (snapshot: readonly string[], current: readonly string[]): void => {
    const working = [...current]
    snapshot.forEach((blockId, index) => {
      const from = working.indexOf(blockId)
      if (from < 0 || from === index) return
      actions.moveBlock(blockId, index)
      working.splice(from, 1)
      working.splice(index, 0, blockId)
    })
  }
  const restoreNestedOrder = (snapshot: Readonly<Record<string, readonly string[]>>): void => {
    for (const [parentId, order] of Object.entries(snapshot)) {
      const current = session.nestedOrder?.[parentId] ?? session.nestedOriginalOrder?.[parentId] ?? []
      const working = [...current]
      order.forEach((blockId, index) => {
        const from = working.indexOf(blockId)
        if (from < 0 || from === index) return
        actions.moveNestedBlock(parentId, blockId, index)
        working.splice(from, 1)
        working.splice(index, 0, blockId)
      })
    }
  }
  const clearBatchDraft = (): void => {
    setBatchSelection([])
    setBatchOps([])
    batchOrderSnapshot.current = null
  }
  const clearNestedBatchDraft = (): void => {
    setNestedBatchSelection([])
    setNestedBatchOps([])
    nestedOrderSnapshot.current = null
  }
  /** Cancel the root batch mode: restore the order snapshot and drop the draft. */
  const cancelBatchMode = (restoreFocus: boolean): void => {
    const snapshot = batchOrderSnapshot.current
    if (snapshot !== null) restoreTargetOrder(snapshot, session.targetOrder)
    clearBatchDraft()
    setBatchMode(false)
    clearDeleteConfirm()
    closeHover()
    announce(t('edit.a11yBatchCancelled'))
    if (!restoreFocus) return
    window.requestAnimationFrame(() => { batchToggleRef.current?.focus({ preventScroll: true }) })
  }
  const cancelNestedBatchMode = (restoreFocus: boolean): void => {
    const snapshot = nestedOrderSnapshot.current
    if (snapshot !== null) restoreNestedOrder(snapshot)
    clearNestedBatchDraft()
    setNestedBatchMode(false)
    clearDeleteConfirm()
    closeHover()
    announce(t('edit.a11yBatchCancelled'))
    if (!restoreFocus) return
    window.requestAnimationFrame(() => { nestedBatchToggleRef.current?.focus({ preventScroll: true }) })
  }
  /** Save the root batch draft: order is already in the draft, ops join the queue. */
  const saveBatchMode = (): void => {
    if (rowActionsBusy) return
    const saved = batchOps.length > 0 ? actions.savePendingOps(batchOps) : { ok: true }
    if (saved.ok === false) {
      const message = t('edit.pendingLimit', { max: saved.max })
      setApplyError(message)
      announce(message)
      return
    }
    clearBatchDraft()
    setBatchMode(false)
    clearDeleteConfirm()
    closeHover()
    setApplyHint('')
    setApplyError(undefined)
    announce(t('edit.a11yBatchSaved'))
    window.requestAnimationFrame(() => { batchToggleRef.current?.focus({ preventScroll: true }) })
  }
  const saveNestedBatchMode = (): void => {
    if (rowActionsBusy) return
    const saved = nestedBatchOps.length > 0 ? actions.savePendingOps(nestedBatchOps) : { ok: true }
    if (saved.ok === false) {
      const message = t('edit.pendingLimit', { max: saved.max })
      setApplyError(message)
      announce(message)
      return
    }
    clearNestedBatchDraft()
    setNestedBatchMode(false)
    clearDeleteConfirm()
    closeHover()
    setApplyHint('')
    setApplyError(undefined)
    announce(t('edit.a11yBatchSaved'))
    window.requestAnimationFrame(() => { nestedBatchToggleRef.current?.focus({ preventScroll: true }) })
  }
  const toggleBatchMode = (): void => {
    if (batchMode) { cancelBatchMode(true); return }
    // The two batch modes are mutually exclusive.
    if (nestedBatchMode) cancelNestedBatchMode(false)
    closeHover()
    clearDeleteConfirm()
    closeMoveMenu()
    batchOrderSnapshot.current = [...session.targetOrder]
    setBatchMode(true)
    setBatchSelection([])
    setBatchOps([])
    announce(t('edit.a11yBatchEntered'))
  }
  const toggleNestedBatchMode = (): void => {
    if (nestedBatchMode) { cancelNestedBatchMode(true); return }
    if (batchMode) cancelBatchMode(false)
    closeHover()
    clearDeleteConfirm()
    closeMoveMenu()
    nestedOrderSnapshot.current = Object.fromEntries(
      nestedGroups.map(group => [group.parent.blockId, [...group.childIds]]),
    )
    setNestedBatchMode(true)
    setNestedBatchSelection([])
    setNestedBatchOps([])
    announce(t('edit.a11yBatchEntered'))
  }
  /** Append selected blocks to the panel-local batch draft (no Host request). */
  const queueBatchStructure = (op: 'delete' | 'duplicate', selected: readonly string[], nested: boolean): void => {
    if (selected.length === 0) return
    const entries = selected.map(blockId => {
      batchOpSeq.current += 1
      return { id: `batch_${batchOpSeq.current}`, op, blockId }
    })
    if (nested) setNestedBatchOps(current => [...current, ...entries])
    else setBatchOps(current => [...current, ...entries])
    const labels = entries.map(entry => `${t(`edit.pendingOp.${entry.op}`)} · ${blockLabel(entry.blockId)}`)
    announce(t('edit.a11yBatchQueued', { items: labels.join(t('edit.listSeparator')) }))
  }
  const toggleBatchBlock = (blockId: string): void => {
    setBatchSelection(current => current.includes(blockId)
      ? current.filter(id => id !== blockId)
      : [...current, blockId])
  }
  const selectAllBatchBlocks = (): void => { setBatchSelection([...session.targetOrder]) }
  const clearBatchSelection = (): void => { setBatchSelection([]) }
  const removeBatchOp = (id: string, nested: boolean): void => {
    if (nested) setNestedBatchOps(current => current.filter(entry => entry.id !== id))
    else setBatchOps(current => current.filter(entry => entry.id !== id))
  }
  const runBatchOrder = (mode: BatchOrderMode): void => {
    if (batchSelected.length === 0) return
    actions.moveBlocks(batchSelected, mode)
    announce(t('edit.a11yBatchReordered'))
  }
  const runBatchStructure = (op: 'delete' | 'duplicate', _anchor: HTMLElement | null): void => {
    if (batchStructureDisabled) return
    clearDeleteConfirm()
    closeHover()
    queueBatchStructure(op, batchSelected, false)
  }
  const toggleNestedBatchBlock = (blockId: string): void => {
    setNestedBatchSelection(current => current.includes(blockId)
      ? current.filter(id => id !== blockId)
      : [...current, blockId])
  }
  const selectAllNestedBatchBlocks = (): void => { setNestedBatchSelection([...nestedBlockIds]) }
  const clearNestedBatchSelection = (): void => { setNestedBatchSelection([]) }
  const runNestedBatchOrder = (mode: BatchOrderMode): void => {
    if (nestedBatchSelected.length === 0) return
    actions.moveNestedBlocks(nestedBatchSelected, mode)
    announce(t('edit.a11yBatchReordered'))
  }
  const runNestedBatchStructure = (op: 'delete' | 'duplicate', _anchor: HTMLElement | null): void => {
    if (nestedBatchStructureDisabled) return
    clearDeleteConfirm()
    closeHover()
    queueBatchStructure(op, nestedBatchSelected, true)
  }

  // The add form only belongs to nested mode; escaping it cancels the draft.
  useEffect(() => {
    if (session.nestedMode === true) return
    closeAddForm()
    closeMoveMenu()
  }, [session.nestedMode])

  // Opening the move menu puts focus on the first target (or the menu itself
  // when there is no target) so arrow-key navigation works immediately.
  useEffect(() => {
    if (moveMenu === null) return
    const frame = window.requestAnimationFrame(() => {
      const menu = moveMenuRef.current
      if (menu === null) return
      const first = menu.querySelector<HTMLButtonElement>('[data-dsh-iui-edit-move-target]')
      if (first !== null) first.focus({ preventScroll: true })
      else menu.focus({ preventScroll: true })
    })
    return () => { window.cancelAnimationFrame(frame) }
  }, [moveMenu])

  // A structural operation cancels transient menus.
  useEffect(() => {
    if (!structureBusy) return
    clearDeleteConfirm()
    closeAddForm()
    closeMoveMenu()
  }, [structureBusy])

  // The move menu closes on outside pointerdown, Escape, scroll and resize.
  useEffect(() => {
    if (moveMenu === null) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && (target.closest('[data-dsh-iui-edit-move-menu]') !== null || target.closest('[data-dsh-iui-edit-move]') !== null)) return
      closeMoveMenu()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeMoveMenu()
      moveAnchorRef.current?.focus({ preventScroll: true })
    }
    const onScroll = (): void => { closeMoveMenu() }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [moveMenu])

  /** Open the total Apply preview (fetches the authoritative structure dry-run). */
  const openApplyPreview = (trigger: HTMLElement | null): void => {
    if (rowActionsBusy) return
    if (batchUnsaved) {
      setApplyHint(t('edit.applyHintBatch'))
      announce(t('edit.a11yApplyBlocked'))
      return
    }
    if (globalDirty) {
      setApplyHint(t('edit.applyHintGlobal'))
      announce(t('edit.a11yApplyBlocked'))
      return
    }
    if (!hasSavedContent) {
      setApplyHint(t('edit.applyHintEmpty'))
      return
    }
    setApplyHint('')
    setApplyError(undefined)
    applyTriggerRef.current = trigger
    actions.dismissApplyNotice()
    announce(t('edit.a11yApplyPreviewOpened'))
    void actions.previewApply()
  }
  const retryApplyPreview = (): void => {
    if (applyDialogBusy || applyBusy) return
    setApplyError(undefined)
    void actions.previewApply()
  }
  const cancelApplyPreview = (): void => {
    if (applyBusy) return
    actions.cancelApplyPreview()
    announce(t('edit.a11yApplyPreviewClosed'))
  }
  const confirmApply = async (): Promise<void> => {
    if (applyBusy || applyPreview === undefined || applyPreview.status !== 'ready' || applyBlocked) return
    setApplyBusy(true)
    setApplyError(undefined)
    announce(t('edit.a11yApplyStarted'))
    // Keep the confirmed preview on the session while the round starts: the
    // store reuses its program as the Apply preflight, so confirming a total
    // preview sends one dry-run and one real apply instead of charging the Host
    // a second dry-run. A successful round clears the preview itself (the
    // dialog closes immediately); the model-only path keeps it until here.
    const result = await actions.applyRound()
    if (result.status !== 'error') actions.cancelApplyPreview()
    setApplyBusy(false)
    if (result.status === 'error') {
      setApplyError(result.error ?? t('edit.structureFailed'))
      announce(t('edit.a11yApplyFailed'))
    }
  }
  const trapApplyFocus = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const dialog = applyDialogRef.current
    if (dialog === null) return
    const focusable = [...dialog.querySelectorAll<HTMLElement>(PREVIEW_FOCUSABLE)]
    if (focusable.length === 0) { event.preventDefault(); return }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey) {
      if (document.activeElement === first || !dialog.contains(document.activeElement)) { event.preventDefault(); last.focus() }
      return
    }
    if (document.activeElement === last || !dialog.contains(document.activeElement)) { event.preventDefault(); first.focus() }
  }

  // Apply preview dialog: remember the trigger, move focus in (non-destructive
  // first) and restore it when the dialog disappears.
  useEffect(() => {
    const current = session.applyPreview
    if (current !== undefined) {
      if (!applyHadOpenRef.current) {
        applyHadOpenRef.current = true
        const active = document.activeElement
        applyRestoreFocusRef.current = applyTriggerRef.current ?? (active instanceof HTMLElement ? active : null)
        clearDeleteConfirm()
        closeMoveMenu()
        window.requestAnimationFrame(() => { applyCancelRef.current?.focus({ preventScroll: true }) })
      }
      return
    }
    if (!applyHadOpenRef.current) return
    applyHadOpenRef.current = false
    const restore = applyRestoreFocusRef.current
    applyRestoreFocusRef.current = null
    applyTriggerRef.current = null
    if (restore !== null && restore.isConnected) window.requestAnimationFrame(() => { restore.focus({ preventScroll: true }) })
  }, [session.applyPreview])

  // Escape cancels the preview unless an apply is already in flight.
  useEffect(() => {
    if (session.applyPreview === undefined) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (applyBusy) return
      cancelApplyPreview()
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [session.applyPreview, applyBusy])

  // The post-Apply notice arrives on the rekeyed draft (a different panel
  // instance), so announce it here as well as rendering it in the Apply bar.
  useEffect(() => {
    const notice = session.applyNotice
    if (notice === undefined) return
    announce(t(applyNoticeKey(notice)))
  }, [session.applyNotice])

  // A structural operation disables the actions and cancels a pending confirm.
  useEffect(() => {
    if (structureBusy) clearDeleteConfirm()
  }, [structureBusy])

  // Structural errors show inline and auto-dismiss; a dismissal is per message.
  useEffect(() => {
    if (structureError === undefined) { setDismissedStructureError(null); return }
    const timer = window.setTimeout(() => { setDismissedStructureError(structureError) }, STRUCTURE_ERROR_TIMEOUT_MS)
    return () => { window.clearTimeout(timer) }
  }, [structureError])

  // A pending delete confirmation cancels on any click outside its button or Escape.
  useEffect(() => {
    if (confirmDeleteId === null) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-dsh-iui-edit-structure-confirm]') !== null) return
      clearDeleteConfirm()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      clearDeleteConfirm()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [confirmDeleteId])

  const computeDrop = (clientY: number): DropTarget | null => {
    const drag = dragRef.current
    if (drag === null) return null
    const list = drag.list
    const listRect = list.getBoundingClientRect()
    const rows = Array.from(list.querySelectorAll<HTMLElement>(drag.rowSelector))
      .filter(row => row.dataset.blockId !== drag.blockId)
    if (rows.length === 0) return null
    const last = rows[rows.length - 1].getBoundingClientRect()
    let index = rows.length
    let y = last.bottom - listRect.top
    for (let position = 0; position < rows.length; position += 1) {
      const rect = rows[position].getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) {
        index = position
        y = rect.top - listRect.top
        break
      }
    }
    return { index, y, ...drag.parentId === undefined ? {} : { parentId: drag.parentId } }
  }

  const locate = (blockId: string): void => {
    const element = blockElement(blockId)
    if (element === null) return
    element.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
    element.setAttribute('data-dsh-iui-block-flash', 'true')
    const existing = flashTimers.current.get(blockId)
    if (existing !== undefined) window.clearTimeout(existing)
    const timer = window.setTimeout(() => {
      element.removeAttribute('data-dsh-iui-block-flash')
      flashTimers.current.delete(blockId)
    }, FLASH_DURATION)
    flashTimers.current.set(blockId, timer)
  }

  const scheduleHover = (blockId: string): void => {
    if (batchMode) return
    if (dragRef.current !== null) return
    if (session.activeBlockId !== undefined) return
    if (!requests.has(blockId)) return
    clearHoverTimers()
    if (hoverBlockId === blockId) return
    showTimer.current = window.setTimeout(() => {
      showTimer.current = null
      setHoverBlockId(blockId)
    }, HOVER_SHOW_DELAY)
  }
  const keepHover = (): void => {
    if (hideTimer.current !== null) { window.clearTimeout(hideTimer.current); hideTimer.current = null }
  }
  const scheduleHoverHide = (): void => {
    if (showTimer.current !== null) { window.clearTimeout(showTimer.current); showTimer.current = null }
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null
      setHoverBlockId(null)
    }, HOVER_HIDE_DELAY)
  }

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, blockId: string, parentId?: string, order?: readonly string[]): void => {
    if (dragRef.current !== null) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const list = event.currentTarget.closest<HTMLElement>('ul')
    const siblings = order ?? (parentId === undefined ? session.targetOrder : [])
    if (list === null || siblings.length < 2) return
    event.preventDefault()
    event.stopPropagation()
    closeHover()
    const grip = event.currentTarget
    const pointerId = event.pointerId
    try { grip.setPointerCapture(pointerId) } catch { /* capture is an optimization only */ }
    dragRef.current = {
      blockId,
      ...parentId === undefined ? {} : { parentId },
      startY: event.clientY,
      grip,
      list,
      rowSelector: parentId === undefined ? '[data-dsh-iui-edit-arrangement-row]' : '[data-dsh-iui-edit-nested-row]',
      moved: false,
    }
    dropRef.current = null
    let cleanup = (): void => undefined
    const finish = (commit: boolean): void => {
      const drag = dragRef.current
      const target = dropRef.current
      try { drag?.grip.releasePointerCapture(pointerId) } catch { /* already released */ }
      dragRef.current = null
      dropRef.current = null
      cleanup()
      setDragBlockId(null)
      setDragParentId(null)
      setDropTarget(null)
      if (commit && drag !== null && drag.moved && target !== null) {
        if (drag.parentId === undefined) actions.moveBlock(drag.blockId, target.index)
        else actions.moveNestedBlock(drag.parentId, drag.blockId, target.index)
        announce(drag.parentId === undefined
          ? t('edit.a11yReorderedRoot', { index: target.index + 1 })
          : t('edit.a11yReorderedNested', { index: target.index + 1 }))
      }
    }
    const onMove = (moveEvent: PointerEvent): void => {
      const drag = dragRef.current
      if (drag === null) return
      if (!drag.moved && Math.abs(moveEvent.clientY - drag.startY) < DRAG_THRESHOLD) return
      drag.moved = true
      moveEvent.preventDefault()
      const next = computeDrop(moveEvent.clientY)
      dropRef.current = next
      setDropTarget(current => current !== null && next !== null && current.index === next.index && current.y === next.y && current.parentId === next.parentId
        ? current
        : next)
    }
    const onUp = (): void => { finish(true) }
    const onCancel = (): void => { finish(false) }
    const onKey = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== 'Escape') return
      keyEvent.preventDefault()
      keyEvent.stopPropagation()
      finish(false)
    }
    cleanup = (): void => {
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onCancel, true)
      document.removeEventListener('keydown', onKey, true)
      dragCleanup.current = null
    }
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onCancel, true)
    document.addEventListener('keydown', onKey, true)
    dragCleanup.current = cleanup
    setDragBlockId(blockId)
    setDragParentId(parentId ?? null)
    setDropTarget(null)
  }

  const onGripKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    blockId: string,
    parentId: string | undefined,
    order: readonly string[],
  ): void => {
    const index = order.indexOf(blockId)
    if (index < 0) return
    const last = order.length - 1
    const announcePosition = (position: number): void => {
      announce(parentId === undefined
        ? t('edit.a11yReorderedRoot', { index: position })
        : t('edit.a11yReorderedNested', { index: position }))
    }
    const moveBy = (delta: number): void => {
      announcePosition(index + delta + 1)
      if (parentId === undefined) actions.moveBlockBy(blockId, delta)
      else actions.moveNestedBlockBy(parentId, blockId, delta)
    }
    const moveTo = (toIndex: number): void => {
      announcePosition(toIndex + 1)
      if (parentId === undefined) actions.moveBlock(blockId, toIndex)
      else actions.moveNestedBlock(parentId, blockId, toIndex)
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation()
      if (index > 0) moveBy(-1)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault(); event.stopPropagation()
      if (index < last) moveBy(1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault(); event.stopPropagation()
      if (index !== 0) moveTo(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault(); event.stopPropagation()
      if (index !== last) moveTo(last)
    }
  }

  return (
    <aside
      className="dsh-iui-edit-panel"
      aria-label={t('edit.panelTitle')}
      data-dsh-iui-edit-panel
      data-closing={closing ? 'true' : undefined}
      data-open={session.drawerOpen ? 'true' : 'false'}
      data-status={session.status}
    >
      <span id={a11yHintId} className="dsh-iui-edit-a11y-hint" data-dsh-iui-edit-a11y-hint>{t('edit.a11yDragHint')}</span>
      <div className="dsh-iui-edit-a11y-live" role="status" aria-live="polite" aria-atomic="true" data-dsh-iui-edit-live>{liveMessage}</div>
      <header className="dsh-iui-edit-panel-head">
        <span className="dsh-iui-edit-panel-title">{t('edit.panelTitle')}</span>
        {onOpenHistory === undefined ? null : (
          <button
            type="button"
            className="dsh-iui-edit-panel-history"
            data-dsh-iui-history-open
            data-history-trigger="panel"
            aria-label={t('edit.historyOpen')}
            title={t('edit.historyOpen')}
            onClick={onOpenHistory}
          >
            <RemixIcon name="history-line" size={14} />
          </button>
        )}
        <span className="dsh-iui-edit-panel-spacer" />
        <button
          type="button"
          className="dsh-iui-edit-panel-exit dsh-iui-edit-exit"
          data-dsh-iui-edit-exit-panel
          data-dsh-iui-edit-exit
          aria-label={t('edit.exit')}
          title={t('edit.exit')}
          onClick={() => { closeHover(); actions.closeEditor() }}
        >
          {t('edit.exit')}
        </button>
        <button
          type="button"
          className="dsh-iui-edit-panel-close"
          data-dsh-iui-edit-panel-close
          aria-label={t('edit.drawerClose')}
          title={t('edit.drawerClose')}
          onClick={() => { closeHover(); actions.setDrawerOpen(false) }}
        >
          <CloseGlyph />
        </button>
      </header>

      <div className="dsh-iui-edit-panel-scroll">
        {!styleEditSupported ? null : (
          <section className="dsh-iui-edit-style" aria-label={t('edit.styleSection')} data-dsh-iui-edit-style-section>
            <div className="dsh-iui-edit-style-head">
              <span className="dsh-iui-edit-section-title">{t('edit.styleSection')}</span>
              {styleHeaderTheme === undefined ? null : (
                <span
                  className="dsh-iui-edit-style-head-swatch"
                  aria-hidden="true"
                  data-dsh-iui-edit-style-head-swatch
                  style={{
                    '--swatch-canvas': styleHeaderTheme.light.canvas,
                    '--swatch-accent': styleHeaderTheme.light.accent,
                  } as CSSProperties}
                />
              )}
              <span className="dsh-iui-edit-style-current" data-dsh-iui-edit-style-current>{t('edit.styleCurrent', { style: styleCurrentLabel })}</span>
              {styleHasContent ? <span className="dsh-iui-edit-style-head-pending" data-dsh-iui-edit-style-pending-note>{t('edit.styleInstructionPending')}</span> : null}
              <span className="dsh-iui-edit-section-spacer" />
              <button
                ref={styleToggleRef}
                type="button"
                className="dsh-iui-edit-section-action"
                data-dsh-iui-edit-style-toggle
                aria-expanded={styleOpen}
                aria-controls={stylePanelId}
                onClick={() => { if (styleOpen) collapseStyleSection(); else setStyleOpen(true) }}
              >
                {t('edit.styleAdjustAction')}
                <RemixIcon name={styleOpen ? 'arrow-up-s-line' : 'arrow-down-s-line'} size={12} />
              </button>
            </div>
            {styleOpen ? (
              <div
                className="dsh-iui-edit-style-body"
                id={stylePanelId}
                data-dsh-iui-edit-style-panel
                onKeyDown={event => {
                  suppressSwitchPreview.current = false
                  if (!styleSwitchAvailable || event.key !== 'Escape') return
                  event.preventDefault()
                  event.stopPropagation()
                  collapseStyleSection()
                }}
              >
                {!styleSwitchAvailable ? null : (
                  <div
                    ref={styleSwitchRef}
                    className="dsh-iui-edit-style-switch"
                    data-dsh-iui-edit-style-switch
                    aria-busy={session.styleSwitchBusy === true ? true : undefined}
                    onPointerDown={() => { suppressSwitchPreview.current = false }}
                    onPointerLeave={previewSelectedSwitch}
                  >
                    <span className="dsh-iui-edit-style-switch-title">{t('edit.styleSwitchGroup')}</span>
                    <div className="dsh-iui-edit-style-targets" role="radiogroup" aria-label={t('edit.styleSwitchGroup')}>
                      {styleTargets.map((option, index) => {
                        const checked = styleSwitchChosen !== undefined && sameStyleTarget(option.target, styleSwitchChosen)
                        const current = isCurrentStyleTarget(session, option.target, option.layout)
                        const saved = option.target.kind === 'template'
                        const firstSaved = saved && styleTargets.findIndex(candidate => candidate.target.kind === 'template') === index
                        const disabledReason = styleTargetDisableReason(option, articleProblem)
                        const layoutLabel = option.layout === 'card'
                          ? t('edit.historyStyleCard')
                          : option.layout === 'article' ? t('edit.historyStyleArticle') : t('edit.historyStyleFree')
                        return (
                          <div className="dsh-iui-edit-style-target-group" key={`${option.target.kind}:${option.target.kind === 'template' ? option.target.styleId : option.layout}`}>
                            {index === 0 && !saved ? (
                              <span className="dsh-iui-edit-style-group-label" data-dsh-iui-edit-style-builtin-group>{t('edit.styleBuiltinGroup')}</span>
                            ) : null}
                            {firstSaved ? (
                              <div className="dsh-iui-edit-style-group-separator" role="presentation">
                                <span className="dsh-iui-edit-style-group-label" data-dsh-iui-edit-style-saved-group>{t('edit.styleSavedGroup')}</span>
                              </div>
                            ) : null}
                            <label
                              className={`dsh-iui-edit-style-target${checked ? ' is-checked' : ''}${current ? ' is-current' : ''}${disabledReason === undefined ? '' : ' is-disabled'}`}
                              onPointerEnter={() => { if (disabledReason === undefined) previewSwitchOption(option) }}
                              onFocus={() => {
                                if (disabledReason !== undefined || suppressSwitchPreview.current) return
                                previewSwitchOption(option)
                              }}
                              onBlur={previewSelectedSwitch}
                            >
                              <input
                                type="radio"
                                className="dsh-iui-edit-style-radio"
                                name={`${stylePanelId}-switch`}
                                data-dsh-iui-edit-style-target
                                data-target-kind={option.target.kind}
                                data-target-layout={option.layout}
                                data-target-style-id={option.target.kind === 'template' ? option.target.styleId : undefined}
                                data-current={current ? 'true' : undefined}
                                checked={checked}
                                disabled={disabledReason !== undefined}
                                aria-describedby={disabledReason === undefined ? undefined : articleNoteId}
                                onChange={() => {
                                  if (disabledReason !== undefined) return
                                  actions.selectStyleTarget(option.target, option.layout)
                                  if (!suppressSwitchPreview.current) previewSwitchOption(option)
                                }}
                              />
                              <span
                                className="dsh-iui-edit-style-swatch"
                                data-layout={option.layout}
                                aria-hidden="true"
                                style={option.theme === undefined ? undefined : {
                                  '--swatch-canvas': option.theme.light.canvas,
                                  '--swatch-accent': option.theme.light.accent,
                                } as CSSProperties}
                              />
                              <span className="dsh-iui-edit-style-target-name">{option.name}</span>
                              <span className="dsh-iui-edit-style-target-meta">{layoutLabel}</span>
                              {current ? <span className="dsh-iui-edit-style-current-badge" data-dsh-iui-edit-style-current-badge>{t('edit.styleSwitchCurrentBadge')}</span> : null}
                            </label>
                          </div>
                        )
                      })}
                    </div>
                    {styleTargets.some(option => styleTargetDisableReason(option, articleProblem) === 'article') ? (
                      <p id={articleNoteId} className="dsh-iui-edit-style-hint" data-dsh-iui-edit-style-article-note>{t('edit.styleTargetArticle')}</p>
                    ) : null}
                    <p id={styleStatusId} className="dsh-iui-edit-style-status" role="status" data-dsh-iui-edit-style-status>{t(styleStatusKey)}</p>
                    <div className="dsh-iui-edit-style-switch-foot">
                      <button
                        type="button"
                        className="dsh-iui-edit-style-apply"
                        data-dsh-iui-edit-style-apply
                        disabled={!styleSwitchCanApply}
                        aria-describedby={styleStatusId}
                        title={styleBlocker === undefined ? undefined : t(styleStatusKey)}
                        onClick={() => { onPreviewStyleTarget?.(undefined); actions.applyStyleSwitch() }}
                      >
                        {session.styleSwitchBusy === true ? t('edit.styleSwitchBusy') : t('edit.styleSwitchApply')}
                      </button>
                    </div>
                    {session.styleSwitchError === undefined ? null : (
                      <p className="dsh-iui-edit-style-switch-error" role="alert" data-dsh-iui-edit-style-switch-error>{session.styleSwitchError}</p>
                    )}
                  </div>
                )}
                {!styleSwitchAvailable ? null : <div className="dsh-iui-edit-style-divider" role="presentation" />}
                <label className="dsh-iui-edit-style-label" htmlFor={`${stylePanelId}-input`}>{t('edit.styleInstructionLabel')}</label>
                <textarea
                  ref={styleTextareaRef}
                  id={`${stylePanelId}-input`}
                  className="dsh-iui-edit-textarea dsh-iui-edit-style-textarea"
                  data-dsh-iui-edit-style
                  rows={3}
                  maxLength={MAX_STYLE_INSTRUCTION_CHARS}
                  value={session.styleInstruction}
                  placeholder={t('edit.styleInstructionHint')}
                  onChange={event => { actions.setStyleInstruction(event.target.value) }}
                  onKeyDown={event => {
                    if (event.key !== 'Escape') return
                    event.preventDefault()
                    event.stopPropagation()
                    collapseStyleSection()
                  }}
                />
                <p className="dsh-iui-edit-style-hint">{t('edit.styleAdjustHint')}</p>
                <div className="dsh-iui-edit-style-foot">
                  <span className="dsh-iui-edit-style-note" data-dsh-iui-edit-style-note>{styleNewResultHint}</span>
                  <button
                    type="button"
                    className="dsh-iui-edit-section-action"
                    data-dsh-iui-edit-style-clear
                    disabled={!styleHasContent}
                    onClick={() => { actions.setStyleInstruction(''); announce(t('edit.a11yStyleCleared')) }}
                  >
                    {t('edit.styleClear')}
                  </button>
                </div>
              </div>
            ) : null}
            {styleMixed ? (
              <p className="dsh-iui-edit-style-mixed" role="status" data-dsh-iui-edit-style-mixed>{t('edit.styleMixed')}</p>
            ) : null}
          </section>
        )}

        {session.selection.length === 0 ? null : (
          <section className="dsh-iui-edit-section" aria-label={t('edit.requests')}>
            <div className="dsh-iui-edit-section-head">
              <span className="dsh-iui-edit-section-title">{t('edit.requests')}</span>
              <span className="dsh-iui-edit-section-meta">{t('edit.requestsCount', { count: session.selection.length })}</span>
              <span className="dsh-iui-edit-section-spacer" />
              <button
                type="button"
                className="dsh-iui-edit-section-action"
                data-dsh-iui-edit-clear-all
                onClick={() => { closeHover(); actions.clearAllEdits() }}
              >
                {t('edit.clearAll')}
              </button>
            </div>
            <ul className="dsh-iui-edit-request-list" data-dsh-iui-edit-request-list>
              {orderedRequests.map(entry => {
                const block = blocks.get(entry.blockId)
                if (block === undefined) return null
                return (
                  <RequestRow
                    key={entry.blockId}
                    t={t}
                    block={block}
                    order={entry.order}
                    instruction={entry.instruction}
                    onOpen={() => { closeHover(); actions.openBlockEditor(entry.blockId) }}
                    onEdit={() => { closeHover(); actions.openBlockEditor(entry.blockId) }}
                    onDelete={() => { closeHover(); actions.removeSelection(entry.blockId) }}
                    hovered={hoveredBlockId === entry.blockId}
                    onHoverBlock={blockId => { onHoverBlock?.(blockId) }}
                  />
                )
              })}
            </ul>
          </section>
        )}

        {session.removable === undefined ? null : (
          <div className="dsh-iui-edit-undo" role="status" data-dsh-iui-edit-undo>
            <span>{t('edit.removed', { name: removedName })}</span>
            <button type="button" className="dsh-iui-edit-link" onClick={() => { actions.undoRemove() }}>
              {t('edit.undo')}
            </button>
          </div>
        )}

        <section
          className="dsh-iui-edit-section dsh-iui-edit-arrangement"
          aria-label={t('edit.arrangement')}
          aria-busy={structureBusy ? true : undefined}
          data-dsh-iui-edit-batch-mode={batchMode ? 'true' : undefined}
          onKeyDown={event => {
            if (event.key !== 'Escape' || !batchMode) return
            // Dialogs and row menus own their own Escape handling; batch mode
            // only cancels when none of them sits above the panel.
            if (session.applyPreview !== undefined || confirmDeleteId !== null || moveMenu !== null) return
            event.preventDefault()
            event.stopPropagation()
            cancelBatchMode(true)
          }}
        >
          <div className="dsh-iui-edit-section-head">
            <span className="dsh-iui-edit-section-title">{t('edit.arrangement')}</span>
            <span className="dsh-iui-edit-section-meta">· {t('edit.blockCount', { count: session.blocks.length })}</span>
            <span className="dsh-iui-edit-section-spacer" />
            {structureBusy ? (
              <span className="dsh-iui-edit-structure-busy" role="status" data-dsh-iui-edit-structure-busy>
                {t('edit.structureBusy')}
              </span>
            ) : null}
            <button
              ref={batchToggleRef}
              type="button"
              className={`dsh-iui-edit-section-action dsh-iui-edit-batch-toggle${batchMode ? ' is-active' : ''}`}
              data-dsh-iui-edit-batch-toggle
              aria-pressed={batchMode}
              aria-label={t('edit.batchToggle')}
              title={t('edit.batchToggleHint')}
              disabled={structureBusy}
              onClick={() => { toggleBatchMode() }}
            >
              <BatchGlyph />{t('edit.batchToggle')}
            </button>
            <button
              type="button"
              className="dsh-iui-edit-section-action"
              data-dsh-iui-edit-reset-order
              aria-label={t('edit.resetOrder')}
              title={`${t('edit.resetOrder')} — ${t('edit.resetOrderHint')}`}
              onClick={() => { closeHover(); actions.resetOrder() }}
            >
              <ResetGlyph />{t('edit.resetOrder')}
            </button>
          </div>
          {structureError !== undefined && structureError !== dismissedStructureError ? (
            <div className="dsh-iui-edit-structure-error" role="alert" data-dsh-iui-edit-structure-error>
              <span className="dsh-iui-edit-structure-error-text">{structureError}</span>
              <button
                type="button"
                className="dsh-iui-edit-structure-error-dismiss"
                data-dsh-iui-edit-structure-error-dismiss
                aria-label={t('edit.cancel')}
                title={t('edit.cancel')}
                onClick={() => { setDismissedStructureError(structureError) }}
              >
                {t('edit.cancel')}
              </button>
            </div>
          ) : null}
          <p className="dsh-iui-edit-arrangement-hint">{batchMode ? t('edit.batchHint') : t('edit.arrangementHint')}</p>
          {batchMode ? (
            <BatchToolbar
              t={t}
              nested={false}
              count={batchSelected.length}
              allSelected={batchSelected.length >= session.targetOrder.length}
              canMove={batchCanMove}
              structureDisabled={batchStructureDisabled}
              structureHint={batchStructureHint}
              overLimit={batchOverLimit}
              pendingOps={batchOps.length}
              pendingLabels={batchPendingEntries}
              onSelectAll={selectAllBatchBlocks}
              onClear={clearBatchSelection}
              onSave={saveBatchMode}
              onCancel={() => { cancelBatchMode(true) }}
              onRemovePending={id => { removeBatchOp(id, false) }}
              onOrder={runBatchOrder}
              onStructure={runBatchStructure}
            />
          ) : null}
          <div className="dsh-iui-edit-arrangement-wrap">
            <ul
              ref={listRef}
              className="dsh-iui-edit-arrangement-list"
              data-dsh-iui-edit-arrangement-list
              data-batch={batchMode ? 'true' : undefined}
              data-dragging={dragBlockId === null || dragParentId !== null ? undefined : 'true'}
            >
              {session.targetOrder.map((blockId, index) => {
                const block = blocks.get(blockId)
                if (block === undefined) return null
                const entry = requests.get(blockId)
                const title = block.title !== undefined && block.title.trim() !== '' ? block.title : blockKindLabel(block.kind, t)
                const dragging = dragBlockId === blockId && dragParentId === null
                const batchSelectedRow = batchSelectedSet.has(blockId)
                return (
                  <li
                    key={blockId}
                    className={`dsh-iui-edit-arrangement-row${entry === undefined ? '' : ` dsh-iui-edit-color-${((entry.order - 1) % COLOR_COUNT) + 1}`}${dragging ? ' is-dragging' : ''}${hoveredBlockId === blockId ? ' is-hover-linked' : ''}${batchMode ? ' is-batch' : ''}${batchSelectedRow ? ' is-batch-selected' : ''}`}
                    data-dsh-iui-edit-arrangement-row
                    data-block-id={blockId}
                    data-structure-confirming={confirmDeleteId === blockId ? 'true' : undefined}
                    data-order-index={index}
                    data-dragging={dragging ? 'true' : undefined}
                    data-batch-selected={batchSelectedRow ? 'true' : undefined}
                    data-hover-linked={hoveredBlockId === blockId ? 'true' : undefined}
                    onPointerEnter={() => { onHoverBlock?.(blockId); if (!batchMode) scheduleHover(blockId) }}
                    onPointerLeave={() => { onHoverBlock?.(null); if (!batchMode) scheduleHoverHide() }}
                  >
                    {batchMode ? (
                      <button
                        type="button"
                        className="dsh-iui-edit-batch-check"
                        data-dsh-iui-edit-batch-check
                        role="checkbox"
                        aria-checked={batchSelectedRow}
                        aria-label={`${t('edit.batchSelect')}: ${title}`}
                        title={`${t('edit.batchSelect')}: ${title}`}
                        onClick={event => { event.stopPropagation(); toggleBatchBlock(blockId) }}
                      >
                        {batchSelectedRow ? <CheckGlyph /> : null}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="dsh-iui-edit-grip"
                        data-dsh-iui-edit-grip
                        aria-label={`${t('edit.moveHandle')}: ${title}`}
                        aria-describedby={a11yHintId}
                        title={t('edit.moveHandle')}
                        onPointerDown={event => { startDrag(event, blockId) }}
                        onKeyDown={event => { onGripKeyDown(event, blockId, undefined, session.targetOrder) }}
                      >
                        <GripGlyph />
                      </button>
                    )}
                    <button
                      type="button"
                      className="dsh-iui-edit-arrangement-body"
                      data-dsh-iui-edit-arrangement-body
                      title={batchMode ? t('edit.batchSelect') : t('edit.locate')}
                      aria-pressed={batchMode ? batchSelectedRow : undefined}
                      aria-label={batchMode
                        ? `${t('edit.batchSelect')}: ${title}`
                        : `${t('edit.locate')}: ${title} · ${t('edit.pageOrder', { n: session.originalOrder.indexOf(blockId) + 1 })}${entry === undefined ? '' : ` · ${t('edit.requestOrder', { n: entry.order })}`}`}
                      onClick={batchMode
                        ? () => { toggleBatchBlock(blockId) }
                        : () => { closeHover(); locate(blockId) }}
                    >
                      <span className="dsh-iui-edit-page-index" title={t('edit.pageOrder', { n: session.originalOrder.indexOf(blockId) + 1 })} aria-hidden="true">{session.originalOrder.indexOf(blockId) + 1}</span>
                      <span className="dsh-iui-edit-arrangement-glyph"><TypeGlyph kind={block.kind} /></span>
                      <span className="dsh-iui-edit-arrangement-title" title={title}>{title}</span>
                      {entry === undefined ? null : <span className="dsh-iui-edit-badge" title={t('edit.requestOrder', { n: entry.order })} aria-hidden="true">{entry.order}</span>}
                      {entry === undefined ? null : <span className="dsh-iui-edit-tag">{t('edit.editedTag')}</span>}
                    </button>
                    {batchMode ? null : (
                      <StructureActions
                        t={t}
                        blockId={blockId}
                        title={title}
                        busy={rowActionsBusy}
                        onEdit={() => { closeHover(); actions.openBlockEditor(blockId) }}
                        confirming={confirmDeleteId === blockId}
                        moveOpen={moveMenu?.blockId === blockId}
                        onDuplicate={anchor => { duplicateBlock(blockId, anchor) }}
                        onRequestDelete={anchor => { requestDeleteBlock(blockId, anchor) }}
                        onCancelDelete={() => { cancelDeleteConfirm() }}
                        onConfirmDelete={() => { confirmDeleteBlock(blockId) }}
                        onMove={anchor => { openMoveMenu(blockId, anchor) }}
                        onLocate={() => { closeHover(); locate(blockId) }}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
            {dropTarget === null || dropTarget.parentId !== undefined ? null : (
              <span
                className="dsh-iui-edit-insert-indicator"
                data-dsh-iui-edit-insert-indicator
                style={{ top: dropTarget.y }}
                aria-hidden="true"
              />
            )}
          </div>
        </section>

        {nestedGroups.length === 0 ? null : (
          <section
            className="dsh-iui-edit-section dsh-iui-edit-nested-arrangement"
            aria-label={t('edit.nestedArrangement')}
            aria-busy={structureBusy ? true : undefined}
            data-dsh-iui-edit-nested-arrangement
            data-dsh-iui-edit-nested-batch-mode={nestedBatchMode ? 'true' : undefined}
            onKeyDown={event => {
              if (event.key !== 'Escape' || !nestedBatchMode) return
              // Dialogs and row menus own their own Escape handling.
              if (session.applyPreview !== undefined || confirmDeleteId !== null || moveMenu !== null) return
              event.preventDefault()
              event.stopPropagation()
              cancelNestedBatchMode(true)
            }}
          >
            <div className="dsh-iui-edit-section-head">
              <span className="dsh-iui-edit-section-title">{t('edit.nestedArrangement')}</span>
              <span className="dsh-iui-edit-section-spacer" />
              <button
                ref={nestedBatchToggleRef}
                type="button"
                className={`dsh-iui-edit-section-action dsh-iui-edit-batch-toggle${nestedBatchMode ? ' is-active' : ''}`}
                data-dsh-iui-edit-nested-batch-toggle
                aria-pressed={nestedBatchMode}
                aria-label={t('edit.batchToggle')}
                title={t('edit.batchToggleHint')}
                disabled={structureBusy}
                onClick={() => { toggleNestedBatchMode() }}
              >
                <BatchGlyph />{t('edit.batchToggle')}
              </button>
              <button
                type="button"
                className="dsh-iui-edit-section-action"
                data-dsh-iui-edit-reset-nested
                disabled={session.nestedOrderChanged !== true}
                aria-label={t('edit.resetNestedOrder')}
                title={t('edit.resetNestedOrder')}
                onClick={() => { closeHover(); actions.resetNestedOrder() }}
              >
                <ResetGlyph />{t('edit.resetNestedOrder')}
              </button>
            </div>
            <p className="dsh-iui-edit-arrangement-hint">{nestedBatchMode ? t('edit.batchHint') : t('edit.nestedGroupHint')}</p>
            {nestedBatchMode ? (
              <BatchToolbar
                t={t}
                nested
                count={nestedBatchSelected.length}
                allSelected={nestedBatchSelected.length >= nestedBlockIds.length}
                canMove={nestedBatchCanMove}
                structureDisabled={nestedBatchStructureDisabled}
                structureHint={nestedBatchStructureHint}
                overLimit={nestedBatchOverLimit}
                pendingOps={nestedBatchOps.length}
                pendingLabels={nestedBatchPendingEntries}
                onSelectAll={selectAllNestedBatchBlocks}
                onClear={clearNestedBatchSelection}
                onSave={saveNestedBatchMode}
                onCancel={() => { cancelNestedBatchMode(true) }}
                onRemovePending={id => { removeBatchOp(id, true) }}
                onOrder={runNestedBatchOrder}
                onStructure={runNestedBatchStructure}
              />
            ) : null}
            {nestedGroups.map(group => {
              const parentId = group.parent.blockId
              const parentTitle = group.parent.title !== undefined && group.parent.title.trim() !== ''
                ? group.parent.title
                : blockKindLabel(group.parent.kind, t)
              const parentKind = blockKindLabel(group.parent.kind, t)
              const groupDragging = dragParentId === parentId
              return (
                <div
                  key={parentId}
                  className="dsh-iui-edit-nested-group"
                  data-dsh-iui-edit-nested-group
                  data-parent-id={parentId}
                  role="group"
                  aria-label={`${parentTitle} · ${parentKind}`}
                >
                  <div className="dsh-iui-edit-nested-group-head">
                    <span className="dsh-iui-edit-nested-group-title" title={parentTitle}>{parentTitle}</span>
                    <span className="dsh-iui-edit-nested-group-meta">{parentKind}</span>
                    <span className="dsh-iui-edit-nested-group-spacer" />
                    <button
                      type="button"
                      className="dsh-iui-edit-add-button"
                      data-dsh-iui-edit-add
                      data-parent-id={parentId}
                      aria-expanded={addFormParentId === parentId ? 'true' : undefined}
                      title={t('edit.addBlock')}
                      onClick={() => { closeHover(); toggleAddForm(parentId) }}
                    >
                      <PlusGlyph />{t('edit.addBlock')}
                    </button>
                  </div>
                  {addFormParentId !== parentId ? null : (
                    <div className="dsh-iui-edit-add-form" data-dsh-iui-edit-add-form data-parent-id={parentId}>
                      <p className="dsh-iui-edit-add-hint" id={addHintId}>{t('edit.addBlockHint')}</p>
                      <textarea
                        className="dsh-iui-edit-add-textarea"
                        data-dsh-iui-edit-add-input
                        aria-label={t('edit.addBlockHint')}
                        aria-describedby={addHintId}
                        rows={2}
                        maxLength={2000}
                        value={addDraft}
                        placeholder={t('edit.addBlockPlaceholder')}
                        onChange={event => { setAddDraft(event.target.value) }}
                        onKeyDown={event => {
                          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeAddForm() }
                          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); saveAddition(parentId) }
                        }}
                      />
                      <div className="dsh-iui-edit-add-actions">
                        <button
                          type="button"
                          className="dsh-iui-edit-add-save"
                          data-dsh-iui-edit-add-save
                          disabled={addDraft.trim() === ''}
                          onClick={() => { saveAddition(parentId) }}
                        >
                          {t('edit.addBlockSave')}
                        </button>
                        <button
                          type="button"
                          className="dsh-iui-edit-add-cancel"
                          data-dsh-iui-edit-add-cancel
                          onClick={() => { closeAddForm() }}
                        >
                          {t('edit.addBlockCancel')}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="dsh-iui-edit-nested-wrap">
                    <ul
                      className="dsh-iui-edit-nested-list"
                      data-dsh-iui-edit-nested-list
                      data-parent-id={parentId}
                      data-dragging={groupDragging ? 'true' : undefined}
                    >
                      {group.childIds.map((blockId, index) => {
                        const block = blocks.get(blockId)
                        if (block === undefined) return null
                        const entry = requests.get(blockId)
                        const title = block.title !== undefined && block.title.trim() !== '' ? block.title : blockKindLabel(block.kind, t)
                        const dragging = dragBlockId === blockId && dragParentId === parentId
                        const depth = Math.max(0, (block.depth ?? 1) - (group.parent.depth ?? 0) - 1)
                        const nestedBatchSelectedRow = nestedBatchSelectedSet.has(blockId)
                        return (
                          <li
                            key={blockId}
                            className={`dsh-iui-edit-nested-row${entry === undefined ? '' : ` dsh-iui-edit-color-${((entry.order - 1) % COLOR_COUNT) + 1}`}${dragging ? ' is-dragging' : ''}${hoveredBlockId === blockId ? ' is-hover-linked' : ''}${nestedBatchMode ? ' is-batch' : ''}${nestedBatchSelectedRow ? ' is-batch-selected' : ''}`}
                            data-dsh-iui-edit-nested-row
                            data-block-id={blockId}
                            data-structure-confirming={confirmDeleteId === blockId ? 'true' : undefined}
                            data-parent-id={parentId}
                            data-order-index={index}
                            data-depth={block.depth}
                            data-batch-selected={nestedBatchSelectedRow ? 'true' : undefined}
                            data-hover-linked={hoveredBlockId === blockId ? 'true' : undefined}
                            onPointerEnter={() => { onHoverBlock?.(blockId) }}
                            onPointerLeave={() => { onHoverBlock?.(null) }}
                            style={depth === 0 ? undefined : { paddingLeft: `${depth * 12}px` }}
                          >
                            {nestedBatchMode ? (
                              <button
                                type="button"
                                className="dsh-iui-edit-batch-check"
                                data-dsh-iui-edit-nested-batch-check
                                role="checkbox"
                                aria-checked={nestedBatchSelectedRow}
                                aria-label={`${t('edit.batchSelect')}: ${title}`}
                                title={`${t('edit.batchSelect')}: ${title}`}
                                onClick={event => { event.stopPropagation(); toggleNestedBatchBlock(blockId) }}
                              >
                                {nestedBatchSelectedRow ? <CheckGlyph /> : null}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="dsh-iui-edit-grip"
                                data-dsh-iui-edit-nested-grip
                                aria-label={`${t('edit.moveHandle')}: ${title}`}
                                aria-describedby={a11yHintId}
                                title={t('edit.moveHandle')}
                                onPointerDown={event => { startDrag(event, blockId, parentId, group.childIds) }}
                                onKeyDown={event => { onGripKeyDown(event, blockId, parentId, group.childIds) }}
                              >
                                <GripGlyph />
                              </button>
                            )}
                            <button
                              type="button"
                              className="dsh-iui-edit-arrangement-body"
                              data-dsh-iui-edit-nested-body
                              title={nestedBatchMode ? t('edit.batchSelect') : t('edit.locate')}
                              aria-pressed={nestedBatchMode ? nestedBatchSelectedRow : undefined}
                              aria-label={nestedBatchMode
                                ? `${t('edit.batchSelect')}: ${title}`
                                : `${t('edit.locate')}: ${title} · ${t('edit.pageOrder', { n: blockId.replace(/^b/, '') })}${entry === undefined ? '' : ` · ${t('edit.requestOrder', { n: entry.order })}`}`}
                              onClick={nestedBatchMode
                                ? () => { toggleNestedBatchBlock(blockId) }
                                : () => { closeHover(); locate(blockId) }}
                            >
                              <span className="dsh-iui-edit-page-index" title={t('edit.pageOrder', { n: blockId.replace(/^b/, '') })} aria-hidden="true">{blockId.replace(/^b/, '')}</span>
                              <span className="dsh-iui-edit-arrangement-glyph"><TypeGlyph kind={block.kind} /></span>
                              <span className="dsh-iui-edit-arrangement-title" title={title}>{title}</span>
                              <span className="dsh-iui-edit-nested-type">{blockKindLabel(block.kind, t)}</span>
                              {entry === undefined ? null : <span className="dsh-iui-edit-badge" title={t('edit.requestOrder', { n: entry.order })} aria-hidden="true">{entry.order}</span>}
                              {entry === undefined ? null : <span className="dsh-iui-edit-tag">{t('edit.editedTag')}</span>}
                            </button>
                            {nestedBatchMode ? null : (
                              <StructureActions
                                t={t}
                                blockId={blockId}
                                title={title}
                                busy={rowActionsBusy}
                                onEdit={() => { closeHover(); actions.openBlockEditor(blockId) }}
                                confirming={confirmDeleteId === blockId}
                                moveOpen={moveMenu?.blockId === blockId}
                                onDuplicate={anchor => { duplicateBlock(blockId, anchor) }}
                                onRequestDelete={anchor => { requestDeleteBlock(blockId, anchor) }}
                                onCancelDelete={() => { cancelDeleteConfirm() }}
                                onConfirmDelete={() => { confirmDeleteBlock(blockId) }}
                                onMove={anchor => { openMoveMenu(blockId, anchor) }}
                                onLocate={() => { closeHover(); locate(blockId) }}
                              />
                            )}
                          </li>
                        )
                      })}
                    </ul>
                    {dropTarget === null || dropTarget.parentId !== parentId ? null : (
                      <span
                        className="dsh-iui-edit-insert-indicator"
                        data-dsh-iui-edit-insert-indicator
                        style={{ top: dropTarget.y }}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  {(session.additions ?? []).filter(addition => addition.parentBlockId === parentId).map((addition, index) => (
                    <div
                      key={`${parentId}:${index}`}
                      className="dsh-iui-edit-addition"
                      data-dsh-iui-edit-addition
                      data-parent-id={parentId}
                      data-block-id={addition.parentBlockId}
                    >
                      <span className="dsh-iui-edit-addition-tag">{t('edit.addBlock')}</span>
                      <span className="dsh-iui-edit-addition-text" title={addition.instruction}>{addition.instruction}</span>
                      <button
                        type="button"
                        className="dsh-iui-edit-icon-button dsh-iui-edit-addition-remove"
                        data-dsh-iui-edit-addition-remove
                        data-parent-id={parentId}
                        aria-label={t('edit.addBlockRemove')}
                        title={t('edit.addBlockRemove')}
                        onClick={event => {
                          event.stopPropagation()
                          actions.removeBlockAddition(parentId)
                          announce(t('edit.a11yRemoved'))
                        }}
                      >
                        <TrashGlyph />
                      </button>
                    </div>
                  ))}
                </div>
              )
            })}
          </section>
        )}

        <div className="dsh-iui-edit-divider" aria-hidden="true" />

        <section
          className="dsh-iui-edit-section dsh-iui-edit-pending"
          aria-label={t('edit.pendingTasks')}
          data-dsh-iui-edit-pending-tasks
          data-dsh-iui-edit-send-info
        >
          <div className="dsh-iui-edit-section-head">
            <span className="dsh-iui-edit-section-title">{t('edit.pendingTasks')}</span>
            <span className="dsh-iui-edit-section-meta" data-dsh-iui-edit-pending-count>
              {t('edit.pendingTaskCount', { ops: pendingOps.length, count: session.selection.length })}
            </span>
            <span className="dsh-iui-edit-section-spacer" />
            {pendingOps.length === 0 ? null : (
              <button
                type="button"
                className="dsh-iui-edit-section-action"
                data-dsh-iui-edit-pending-clear
                aria-label={t('edit.pendingClearOps')}
                title={t('edit.pendingClearOps')}
                onClick={() => { actions.clearPendingOps(); setApplyHint(''); announce(t('edit.a11yPendingCleared')) }}
              >
                {t('edit.pendingClearOps')}
              </button>
            )}
          </div>
          {pendingOps.length === 0 ? (
            <p className="dsh-iui-edit-pending-empty" data-dsh-iui-edit-pending-empty>{t('edit.pendingOpsEmpty')}</p>
          ) : (
            <ul className="dsh-iui-edit-pending-list" data-dsh-iui-edit-pending-ops>
              {pendingOpEntries.map(entry => (
                <li key={entry.id} className="dsh-iui-edit-pending-row" data-dsh-iui-edit-pending-op data-op-id={entry.id}>
                  <span className="dsh-iui-edit-pending-label" title={entry.label}>{entry.label}</span>
                  <button
                    type="button"
                    className="dsh-iui-edit-icon-button dsh-iui-edit-pending-remove"
                    data-dsh-iui-edit-pending-op-remove
                    data-op-id={entry.id}
                    aria-label={`${t('edit.pendingOpRemove')}: ${entry.label}`}
                    title={t('edit.pendingOpRemove')}
                    onClick={() => { actions.removePendingOp(entry.id); setApplyHint(''); announce(t('edit.a11yPendingRemoved')) }}
                  >
                    <TrashGlyph />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <dl className="dsh-iui-edit-summary">
            <div className="dsh-iui-edit-summary-row">
              <dt>{t('edit.summaryEdits')}</dt>
              <dd>{t('edit.summaryCountValue', { count: session.selection.length })}</dd>
            </div>
            {(session.additions?.length ?? 0) === 0 ? null : (
              <div className="dsh-iui-edit-summary-row" data-dsh-iui-edit-summary-additions>
                <dt>{t('edit.summaryAdditions')}</dt>
                <dd>{t('edit.summaryCountValue', { count: session.additions?.length ?? 0 })}</dd>
              </div>
            )}
            <div className="dsh-iui-edit-summary-row">
              <dt>{t('edit.summaryOrder')}</dt>
              <dd>{session.orderChanged || session.nestedOrderChanged === true ? t('edit.summaryOrderChanged') : t('edit.summaryOrderSame')}</dd>
            </div>
            <div className="dsh-iui-edit-summary-row" data-dsh-iui-edit-summary-global>
              <dt>{t('edit.summaryGlobal')}</dt>
              <dd>{globalDirty
                ? t('edit.globalUnsaved')
                : session.globalInstruction.trim() !== '' ? t('edit.summaryFilled') : t('edit.summaryEmpty')}</dd>
            </div>
            {styleHasContent ? (
              <div className="dsh-iui-edit-summary-row" data-dsh-iui-edit-summary-style>
                <dt>{t('edit.summaryStyle')}</dt>
                <dd>{t('edit.summaryFilled')}</dd>
              </div>
            ) : null}
          </dl>
          <p className="dsh-iui-edit-info-note">{t('edit.sendInfoNote')}</p>
        </section>

        <div className="dsh-iui-edit-global" data-dirty={globalDirty ? 'true' : undefined}>
          <div className="dsh-iui-edit-global-head">
            <label className="dsh-iui-edit-global-label" htmlFor={globalId}>{t('edit.global')}</label>
            <span className="dsh-iui-edit-global-state" data-dsh-iui-edit-global-state data-state={globalDirty ? 'dirty' : 'saved'}>
              {globalDirty
                ? t('edit.globalUnsaved')
                : session.globalInstruction.trim() !== '' ? t('edit.globalSaved') : t('edit.summaryEmpty')}
            </span>
          </div>
          <textarea
            id={globalId}
            className="dsh-iui-edit-textarea"
            data-dsh-iui-edit-global
            rows={4}
            maxLength={4000}
            value={globalDraft}
            placeholder={t('edit.globalPlaceholder')}
            onChange={event => { setGlobalDraft(event.target.value); setApplyHint('') }}
          />
          <div className="dsh-iui-edit-global-actions">
            <button
              type="button"
              className="dsh-iui-edit-section-action dsh-iui-edit-global-save"
              data-dsh-iui-edit-global-save
              disabled={!globalDirty}
              aria-label={t('edit.globalSave')}
              title={t('edit.globalSave')}
              onClick={() => {
                actions.setGlobalInstruction(globalDraft)
                setApplyHint('')
                setApplyError(undefined)
                announce(t('edit.a11yGlobalSaved'))
              }}
            >
              {t('edit.globalSave')}
            </button>
          </div>
        </div>
      </div>

      <div className="dsh-iui-edit-apply-bar" data-dsh-iui-edit-apply-bar data-busy={applyBusy ? 'true' : undefined}>
        {applyHint === '' ? null : (
          <p className="dsh-iui-edit-apply-hint" role="status" data-dsh-iui-edit-apply-hint>{applyHint}</p>
        )}
        {applyError === undefined ? null : (
          <p className="dsh-iui-edit-apply-error" role="alert" data-dsh-iui-edit-apply-error>{applyError}</p>
        )}
        {session.applyNotice === undefined ? null : (
          <div className="dsh-iui-edit-apply-notice" role="status" data-dsh-iui-edit-apply-notice data-notice={session.applyNotice}>
            <span className="dsh-iui-edit-apply-notice-text">
              {t(applyNoticeKey(session.applyNotice))}
            </span>
            <button
              type="button"
              className="dsh-iui-edit-link"
              data-dsh-iui-edit-apply-notice-dismiss
              onClick={() => { actions.dismissApplyNotice() }}
            >
              {t('edit.applyNoticeDismiss')}
            </button>
          </div>
        )}
        <div className="dsh-iui-edit-apply-row">
          <span className="dsh-iui-edit-apply-summary" data-dsh-iui-edit-apply-summary>
            {pendingOps.length > 0
              ? t('edit.applySummary', { ops: pendingOps.length, count: session.selection.length })
              : styleOnly
                ? t('edit.applySummaryStyle')
                : hasModelContent ? t('edit.applySummaryModel', { count: session.selection.length }) : t('edit.applySummaryEmpty')}
          </span>
          <button
            type="button"
            className="dsh-iui-edit-apply-button"
            data-dsh-iui-edit-apply
            disabled={!hasSavedContent || structureBusy}
            aria-busy={applyBusy || structureBusy ? true : undefined}
            aria-label={t('edit.apply')}
            title={hasSavedContent ? t('edit.applyHint') : t('edit.applyEmpty')}
            onClick={event => { openApplyPreview(event.currentTarget) }}
          >
            {applyBusy || structureBusy ? t('edit.applyBusy') : t('edit.apply')}
          </button>
        </div>
      </div>

      {hoverBlock === undefined || hoverEntry === undefined || hoverBlockId === null ? null : (
        <RequestHoverCard
          t={t}
          block={hoverBlock}
          order={hoverEntry.order}
          instruction={hoverEntry.instruction}
          onEnter={keepHover}
          onLeave={scheduleHoverHide}
        />
      )}
      {moveMenu === null ? null : createPortal(
        <div
          ref={moveMenuRef}
          className="dsh-iui-edit-move-menu"
          data-dsh-iui-edit-move-menu
          role="menu"
          tabIndex={-1}
          aria-label={t('edit.moveBlockTitle')}
          aria-describedby={moveMenuHintId}
          style={{ left: moveMenu.left, top: moveMenu.top }}
          onPointerDown={event => { event.stopPropagation() }}
          onClick={event => { event.stopPropagation() }}
          onKeyDown={onMoveMenuKeyDown}
        >
          <span id={moveMenuHintId} className="dsh-iui-edit-a11y-hint" data-dsh-iui-edit-a11y-menu-hint>{t('edit.a11yMenuHint')}</span>
          <div className="dsh-iui-edit-move-title">{t('edit.moveBlockTitle')}</div>
          {moveTargets.length === 0 ? (
            <div className="dsh-iui-edit-move-empty" data-dsh-iui-edit-move-empty>{t('edit.moveBlockEmpty')}</div>
          ) : moveTargets.map(target => (
            <button
              key={target.id}
              type="button"
              className="dsh-iui-edit-move-target"
              data-dsh-iui-edit-move-target
              data-target-id={target.id}
              role="menuitem"
              onClick={() => { chooseMoveTarget(target.id) }}
            >
              <span className="dsh-iui-edit-move-target-title" title={target.title}>{target.title}</span>
              <span className="dsh-iui-edit-move-target-meta">{target.meta}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
      {applyPreview === undefined ? null : createPortal(
        <div
          className="dsh-iui-edit-preview-backdrop"
          data-dsh-iui-edit-apply-preview-backdrop
          onPointerDown={event => { if (event.target === event.currentTarget) cancelApplyPreview() }}
        >
          <div
            ref={applyDialogRef}
            className="dsh-iui-edit-preview-dialog dsh-iui-edit-apply-dialog"
            data-dsh-iui-edit-apply-preview
            data-status={applyPreview.status}
            role="dialog"
            aria-modal="true"
            aria-labelledby={applyTitleId}
            onKeyDown={trapApplyFocus}
          >
            <div className="dsh-iui-edit-preview-head">
              <h2 id={applyTitleId} className="dsh-iui-edit-preview-title">{t('edit.applyPreviewTitle')}</h2>
              <p className="dsh-iui-edit-preview-subtitle">
                <span className="dsh-iui-edit-preview-operation" data-dsh-iui-edit-apply-ops-count>
                  {t('edit.applyPreviewOpsCount', { count: applyPreview.ops.length })}
                </span>
                <span className="dsh-iui-edit-preview-block" data-dsh-iui-edit-apply-model-count>
                  {t('edit.applyPreviewModelCount', { count: applyPreview.model.requestCount })}
                </span>
              </p>
            </div>
            {applyPreview.status === 'loading' ? (
              <div className="dsh-iui-edit-preview-loading" data-dsh-iui-edit-apply-preview-loading role="status">
                <span className="dsh-iui-edit-preview-spinner" aria-hidden="true" />
                {t('edit.previewLoading')}
              </div>
            ) : null}
            {applyPreview.status === 'failed' ? (
              <div className="dsh-iui-edit-preview-failed" data-dsh-iui-edit-apply-preview-failed role="alert">
                <span>{applyPreview.error ?? t('edit.previewFailed')}</span>
                <button
                  type="button"
                  className="dsh-iui-edit-section-action"
                  data-dsh-iui-edit-apply-preview-retry
                  onClick={retryApplyPreview}
                >
                  {t('edit.applyPreviewRetry')}
                </button>
              </div>
            ) : null}
            {applyPreview.status === 'ready' ? (
              <>
                {applyPreview.ops.length === 0 ? null : (
                  <div className="dsh-iui-edit-apply-section" data-dsh-iui-edit-apply-ops>
                    <span className="dsh-iui-edit-preview-batch-label">{t('edit.applyPreviewOpsTitle')}</span>
                    <ul className="dsh-iui-edit-apply-list">
                      {applyPreview.ops.map(op => (
                        <li key={op.id} className="dsh-iui-edit-apply-item" data-dsh-iui-edit-apply-op data-op={op.op} data-block-id={op.blockId}>
                          <span className="dsh-iui-edit-apply-item-label">{op.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(applyPreview.changedBlockIds?.length ?? 0) === 0 ? null : (
                  <div className="dsh-iui-edit-apply-section" data-dsh-iui-edit-apply-blocks>
                    <span className="dsh-iui-edit-preview-batch-label">{t('edit.applyPreviewBlocks')}</span>
                    <ul className="dsh-iui-edit-preview-batch-list">
                      {(applyPreview.changedBlockIds ?? []).map(blockId => (
                        <li key={blockId} className="dsh-iui-edit-preview-batch-item" data-dsh-iui-edit-apply-block>{blockLabel(blockId)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(applyPreview.diff ?? []).length === 0 ? null : (
                  <ol className="dsh-iui-edit-preview-diff" data-dsh-iui-edit-apply-diff>
                    {(applyPreview.diff ?? []).map((line, index) => (
                      <li key={`${line.kind}:${index}`} className="dsh-iui-edit-preview-line" data-diff={line.kind}>
                        <span className="dsh-iui-edit-preview-mark" aria-hidden="true">
                          {line.kind === 'add' ? `+ ${t('edit.previewAdd')}` : line.kind === 'remove' ? `- ${t('edit.previewRemove')}` : '·'}
                        </span>
                        <code className="dsh-iui-edit-preview-text">{line.text}</code>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="dsh-iui-edit-apply-section" data-dsh-iui-edit-apply-model>
                  <span className="dsh-iui-edit-preview-batch-label">{t('edit.applyPreviewModelTitle')}</span>
                  <dl className="dsh-iui-edit-summary">
                    <div className="dsh-iui-edit-summary-row" data-dsh-iui-edit-apply-model-requests>
                      <dt>{t('edit.applyPreviewRequests')}</dt>
                      <dd>{applyPreview.model.titles.length === 0
                        ? t('edit.summaryEmpty')
                        : applyPreview.model.titles.join(t('edit.listSeparator'))}</dd>
                    </div>
                    <div className="dsh-iui-edit-summary-row" data-dsh-iui-edit-apply-model-global>
                      <dt>{t('edit.summaryGlobal')}</dt>
                      <dd>{applyPreview.model.globalInstruction.trim() === ''
                        ? t('edit.summaryEmpty')
                        : t('edit.applyPreviewGlobalValue', { text: applyPreview.model.globalInstruction })}</dd>
                    </div>
                    <div className="dsh-iui-edit-summary-row" data-dsh-iui-edit-apply-model-order>
                      <dt>{t('edit.summaryOrder')}</dt>
                      <dd>{applyPreview.model.orderChanged || applyPreview.model.nestedOrderChanged
                        ? t('edit.summaryOrderChanged') : t('edit.summaryOrderSame')}</dd>
                    </div>
                    {applyPreview.model.additions.length === 0 ? null : (
                      <div className="dsh-iui-edit-summary-row" data-dsh-iui-edit-apply-model-additions>
                        <dt>{t('edit.summaryAdditions')}</dt>
                        <dd>{applyPreview.model.additions.map(addition => addition.instruction).join(t('edit.listSeparator'))}</dd>
                      </div>
                    )}
                    {applyPreview.model.styleInstruction.trim() === '' ? null : (
                      <div className="dsh-iui-edit-summary-row" data-dsh-iui-edit-apply-model-style>
                        <dt>{t('edit.summaryStyle')}</dt>
                        <dd>{t('edit.applyPreviewStyleValue', { text: applyPreview.model.styleInstruction })}</dd>
                      </div>
                    )}
                  </dl>
                </div>
                {applyConflicts.length === 0 ? null : (
                  <div className="dsh-iui-edit-apply-conflicts" role="alert" data-dsh-iui-edit-apply-conflicts>
                    <p className="dsh-iui-edit-apply-conflicts-title">{t('edit.applyPreviewConflictsTitle')}</p>
                    <ul className="dsh-iui-edit-apply-conflict-list">
                      {applyConflicts.map((conflict, index) => (
                        <li key={`${conflict.kind}:${conflict.blockId ?? index}`} className="dsh-iui-edit-apply-conflict" data-dsh-iui-edit-apply-conflict data-kind={conflict.kind}>
                          {conflictText(conflict)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : null}
            <div className="dsh-iui-edit-preview-actions">
              <button
                ref={applyCancelRef}
                type="button"
                className="dsh-iui-edit-preview-cancel"
                data-dsh-iui-edit-apply-preview-cancel
                disabled={applyBusy}
                aria-label={t('edit.previewCancel')}
                onClick={cancelApplyPreview}
              >
                {t('edit.previewCancel')}
              </button>
              {applyPreview.status !== 'ready' ? null : (
                <button
                  type="button"
                  className="dsh-iui-edit-preview-confirm"
                  data-dsh-iui-edit-apply-preview-confirm
                  disabled={applyBusy || structureBusy || applyBlocked}
                  aria-label={applyBlocked ? t('edit.applyPreviewConflictBlocked') : applyConfirmLabel}
                  title={applyBlocked ? t('edit.applyPreviewConflictBlocked') : undefined}
                  onClick={() => { void confirmApply() }}
                >
                  {applyBlocked ? t('edit.applyPreviewConflictBlocked') : applyConfirmLabel}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </aside>
  )
}
