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
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import { RemixIcon } from '../../lib/components/remix-icon.tsx'
import { blockKindLabel, type ArtifactEditActions, type ArtifactEditSession } from './contracts.ts'
import { type ArtifactBlock, type ArtifactBlockKind } from '../../shared/artifact-edit.ts'
import { NESTED_CONTAINER_TYPES } from '../../shared/artifact-containers.ts'
import type { Translate } from '../../shared/locales.ts'
import { RemixIcon, type RemixIconName } from '../../lib/components/remix-icon.tsx'
import { applyEditChatContentWidth, type ChatContentWidthController } from './panel-width.ts'
import { blockAnchorElement } from './block-geometry.ts'

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

/**
 * Hover/focus inline structure actions for one arrangement row.
 * Duplicate and move open a preview immediately; delete swaps the action group
 * for a compact, persistent Cancel/Delete confirmation (focus goes to Cancel).
 * @param props - locale, target block, busy/confirm state and handlers.
 * @returns the action group or its confirmation state.
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
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const wasConfirmingRef = useRef(false)
  useEffect(() => {
    if (confirming) {
      wasConfirmingRef.current = true
      if (typeof window === 'undefined') return
      window.requestAnimationFrame(() => { cancelButtonRef.current?.focus({ preventScroll: true }) })
      return
    }
    if (!wasConfirmingRef.current) return
    wasConfirmingRef.current = false
    const trigger = deleteButtonRef.current
    if (trigger !== null && trigger.isConnected && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => { trigger.focus({ preventScroll: true }) })
    }
  }, [confirming])
  return (
    <span className="dsh-iui-edit-structure-actions">
      {confirming ? (
        <span
          className="dsh-iui-edit-structure-confirm"
          data-dsh-iui-edit-structure-confirm
          role="group"
          aria-label={t('edit.structureConfirmQuestion')}
        >
          <button
            ref={cancelButtonRef}
            type="button"
            className="dsh-iui-edit-structure-cancel"
            data-dsh-iui-edit-structure-cancel
            disabled={busy}
            aria-label={t('edit.structureCancel')}
            title={t('edit.structureCancel')}
            onClick={event => { event.stopPropagation(); onCancelDelete() }}
          >
            {t('edit.structureCancel')}
          </button>
          <button
            type="button"
            className="dsh-iui-edit-structure-confirm-delete"
            data-dsh-iui-edit-structure-confirm-delete
            disabled={busy}
            aria-label={t('edit.structureDeleteNow')}
            title={t('edit.structureDeleteNow')}
            onClick={event => { event.stopPropagation(); onConfirmDelete() }}
          >
            {t('edit.structureDeleteNow')}
          </button>
        </span>
      ) : (
        <>
          <button
            type="button"
            className="dsh-iui-edit-icon-button"
            data-dsh-iui-edit-locate
            data-block-id={blockId}
            disabled={busy}
            aria-label={`${t('edit.locate')}: ${title}`}
            title={t('edit.locate')}
            onClick={event => { event.stopPropagation(); onLocate() }}
          >
            <RemixIcon name="map-pin-line" size={13} />
          </button>
          <button
            type="button"
            className="dsh-iui-edit-icon-button"
            data-dsh-iui-edit-structure-edit
            data-block-id={blockId}
            disabled={busy}
            aria-label={`${t('edit.openRequirement')}: ${title}`}
            title={t('edit.openRequirement')}
            onClick={event => { event.stopPropagation(); onEdit() }}
          >
            <EditGlyph />
          </button>
          <button
            type="button"
            className="dsh-iui-edit-icon-button"
            data-dsh-iui-edit-structure-duplicate
            data-block-id={blockId}
            disabled={busy}
            aria-label={`${t('edit.structureDuplicate')}: ${title}`}
            title={t('edit.structureDuplicate')}
            onClick={event => { event.stopPropagation(); onDuplicate(event.currentTarget) }}
          >
            <DuplicateGlyph />
          </button>
          <button
            ref={deleteButtonRef}
            type="button"
            className="dsh-iui-edit-icon-button dsh-iui-edit-structure-delete"
            data-dsh-iui-edit-structure-delete
            data-block-id={blockId}
            disabled={busy}
            aria-label={`${t('edit.structureDelete')}: ${title}`}
            title={t('edit.structureDelete')}
            onClick={event => { event.stopPropagation(); onRequestDelete(event.currentTarget) }}
          >
            <TrashGlyph />
          </button>
          <button
            type="button"
            className="dsh-iui-edit-icon-button"
            data-dsh-iui-edit-move
            data-block-id={blockId}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={moveOpen ? 'true' : undefined}
            aria-label={`${t('edit.moveBlock')}: ${title}`}
            title={t('edit.moveBlock')}
            onClick={event => { event.stopPropagation(); onMove(event.currentTarget) }}
          >
            <MoveGlyph />
          </button>
        </>
      )}
    </span>
  )
}

/** Artifact edit panel: requests, block arrangement, global instruction, summary. */
export function EditPanel({ t, session, actions, closing = false, onOpenHistory, hoveredBlockId = null, onHoverBlock }: EditPanelProps): ReactElement {
  const globalId = useId()
  const previewTitleId = useId()
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
  const applyStructure = actions.applyStructure
  const preview = session.structurePreview
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [previewConfirming, setPreviewConfirming] = useState(false)
  const [dismissedStructureError, setDismissedStructureError] = useState<string | null>(null)
  const [addFormParentId, setAddFormParentId] = useState<string | null>(null)
  const [addDraft, setAddDraft] = useState('')
  const [moveMenu, setMoveMenu] = useState<MoveMenuState | null>(null)
  const deleteTriggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const previewTriggerRef = useRef<HTMLElement | null>(null)
  const previewRestoreFocusRef = useRef<HTMLElement | null>(null)
  const previewHadOpenRef = useRef(false)
  const [liveMessage, setLiveMessage] = useState('')
  const liveSequenceRef = useRef(0)
  const a11yHintId = useId()
  const moveMenuHintId = useId()
  const addHintId = useId()
  const moveMenuRef = useRef<HTMLDivElement>(null)
  const previewDialogRef = useRef<HTMLDivElement>(null)
  const previewCancelRef = useRef<HTMLButtonElement>(null)
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
  const previewSummaryCount = preview?.changedBlockIds?.length ?? preview?.diff?.filter(line => line.kind !== 'same').length ?? 0
  const previewBlock = preview === undefined ? undefined : blocks.get(preview.blockId)
  const previewTarget = preview?.targetParentBlockId === undefined || preview.targetParentBlockId === 'root'
    ? undefined
    : blocks.get(preview.targetParentBlockId)
  const previewBlockTitle = previewBlock === undefined
    ? undefined
    : previewBlock.title !== undefined && previewBlock.title.trim() !== '' ? previewBlock.title : blockKindLabel(previewBlock.kind, t)
  const previewTargetTitle = preview?.targetParentBlockId === undefined
    ? undefined
    : preview.targetParentBlockId === 'root' ? t('edit.nestedRoot') : previewTarget?.title !== undefined && previewTarget.title.trim() !== '' ? previewTarget.title : previewTarget === undefined ? undefined : blockKindLabel(previewTarget.kind, t)
  const previewOperationLabel = preview === undefined
    ? ''
    : preview.kind === 'delete' ? t('edit.structureDelete') : preview.kind === 'duplicate' ? t('edit.structureDuplicate') : t('edit.moveBlock')
  const hoverEntry = hoverBlockId === null ? undefined : requests.get(hoverBlockId)
  const hoverBlock = hoverBlockId === null ? undefined : blocks.get(hoverBlockId)
  const removedName = (() => {
    const removed = session.removable
    if (removed === undefined) return ''
    const block = blocks.get(removed.blockId)
    if (block === undefined) return `#${removed.order}`
    return block.title ?? blockKindLabel(block.kind, t)
  })()

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
    deleteTriggerRefs.current.clear()
    dragCleanup.current?.()
    clearHoverTimers()
    for (const timer of flashTimers.current.values()) window.clearTimeout(timer)
    flashTimers.current.clear()
  }, [])

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
  const previewBusy = preview !== undefined && preview.status === 'loading'
  const rowActionsBusy = structureBusy || previewBusy || previewConfirming
  const startStructurePreview = (blockId: string, op: 'delete' | 'duplicate', anchor: HTMLElement | null): void => {
    previewTriggerRef.current = anchor
    clearDeleteConfirm()
    if (actions.previewStructure !== undefined) {
      actions.previewStructure(blockId, op)
      return
    }
    // Older stores without the dry-run API keep the direct apply path.
    applyStructure(blockId, op)
  }
  const duplicateBlock = (blockId: string, anchor: HTMLElement | null): void => {
    if (rowActionsBusy) return
    startStructurePreview(blockId, 'duplicate', anchor)
  }
  const requestDeleteBlock = (blockId: string, anchor: HTMLButtonElement | null): void => {
    if (rowActionsBusy) return
    if (anchor !== null) deleteTriggerRefs.current.set(blockId, anchor)
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
    const anchor = deleteTriggerRefs.current.get(blockId) ?? null
    deleteTriggerRefs.current.delete(blockId)
    startStructurePreview(blockId, 'delete', anchor)
    clearDeleteConfirm()
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
    if (event.key === 'Tab') { closeMoveMenu(); return }
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
    const target = moveTargets.find(candidate => candidate.id === targetId)
    previewTriggerRef.current = moveAnchorRef.current
    closeMoveMenu()
    announce(t('edit.a11yMoved', { target: target?.title ?? t('edit.blockFallback') }))
    if (actions.previewMoveBlockTo !== undefined) {
      actions.previewMoveBlockTo(moveMenu.blockId, targetId)
      return
    }
    actions.moveBlockTo(moveMenu.blockId, targetId)
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

  // A structural operation (including moveBlockTo) cancels transient menus.
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

  const confirmPreview = (): void => {
    if (previewConfirming || structureBusy || preview === undefined || preview.status !== 'ready') return
    setPreviewConfirming(true)
    actions.confirmStructurePreview()
  }
  const cancelPreview = (): void => {
    if (previewConfirming) return
    actions.cancelStructurePreview()
    announce(t('edit.a11yPreviewClosed'))
  }
  const trapPreviewFocus = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const dialog = previewDialogRef.current
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

  // Preview dialog: remember the trigger, move focus in (non-destructive first),
  // and restore it when the dialog disappears.
  useEffect(() => {
    const current = session.structurePreview
    if (current !== undefined) {
      if (!previewHadOpenRef.current) {
        previewHadOpenRef.current = true
        const active = document.activeElement
        previewRestoreFocusRef.current = previewTriggerRef.current ?? (active instanceof HTMLElement ? active : null)
        clearDeleteConfirm()
        announce(t('edit.a11yPreviewOpened'))
        window.requestAnimationFrame(() => { previewCancelRef.current?.focus({ preventScroll: true }) })
      }
      closeMoveMenu()
      return
    }
    if (!previewHadOpenRef.current) return
    previewHadOpenRef.current = false
    setPreviewConfirming(false)
    const restore = previewRestoreFocusRef.current
    previewRestoreFocusRef.current = null
    previewTriggerRef.current = null
    if (restore !== null && restore.isConnected) window.requestAnimationFrame(() => { restore.focus({ preventScroll: true }) })
  }, [session.structurePreview])

  // Escape cancels the preview unless an apply is already in flight.
  useEffect(() => {
    if (session.structurePreview === undefined) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (previewConfirming) return
      cancelPreview()
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [session.structurePreview, previewConfirming])

  // A failed preview or a closed dialog clears the in-flight confirm state.
  useEffect(() => {
    if (session.structurePreview === undefined || session.structurePreview.status === 'failed') setPreviewConfirming(false)
  }, [session.structurePreview])

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
          <p className="dsh-iui-edit-arrangement-hint">{t('edit.arrangementHint')}</p>
          <div className="dsh-iui-edit-arrangement-wrap">
            <ul
              ref={listRef}
              className="dsh-iui-edit-arrangement-list"
              data-dsh-iui-edit-arrangement-list
              data-dragging={dragBlockId === null || dragParentId !== null ? undefined : 'true'}
            >
              {session.targetOrder.map((blockId, index) => {
                const block = blocks.get(blockId)
                if (block === undefined) return null
                const entry = requests.get(blockId)
                const title = block.title !== undefined && block.title.trim() !== '' ? block.title : blockKindLabel(block.kind, t)
                const dragging = dragBlockId === blockId && dragParentId === null
                return (
                  <li
                    key={blockId}
                    className={`dsh-iui-edit-arrangement-row${entry === undefined ? '' : ` dsh-iui-edit-color-${((entry.order - 1) % COLOR_COUNT) + 1}`}${dragging ? ' is-dragging' : ''}${hoveredBlockId === blockId ? ' is-hover-linked' : ''}`}
                    data-dsh-iui-edit-arrangement-row
                    data-block-id={blockId}
                    data-structure-confirming={confirmDeleteId === blockId ? 'true' : undefined}
                    data-order-index={index}
                    data-dragging={dragging ? 'true' : undefined}
                    data-hover-linked={hoveredBlockId === blockId ? 'true' : undefined}
                    onPointerEnter={() => { onHoverBlock?.(blockId); scheduleHover(blockId) }}
                    onPointerLeave={() => { onHoverBlock?.(null); scheduleHoverHide() }}
                  >
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
                    <button
                      type="button"
                      className="dsh-iui-edit-arrangement-body"
                      data-dsh-iui-edit-arrangement-body
                      title={t('edit.locate')}
                      aria-label={`${t('edit.locate')}: ${title} · ${t('edit.pageOrder', { n: session.originalOrder.indexOf(blockId) + 1 })}${entry === undefined ? '' : ` · ${t('edit.requestOrder', { n: entry.order })}`}`}
                      onClick={() => { closeHover(); locate(blockId) }}
                    >
                      <span className="dsh-iui-edit-page-index" title={t('edit.pageOrder', { n: session.originalOrder.indexOf(blockId) + 1 })} aria-hidden="true">{session.originalOrder.indexOf(blockId) + 1}</span>
                      <span className="dsh-iui-edit-arrangement-glyph"><TypeGlyph kind={block.kind} /></span>
                      <span className="dsh-iui-edit-arrangement-title" title={title}>{title}</span>
                      {entry === undefined ? null : <span className="dsh-iui-edit-badge" title={t('edit.requestOrder', { n: entry.order })} aria-hidden="true">{entry.order}</span>}
                      {entry === undefined ? null : <span className="dsh-iui-edit-tag">{t('edit.editedTag')}</span>}
                    </button>
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
          >
            <div className="dsh-iui-edit-section-head">
              <span className="dsh-iui-edit-section-title">{t('edit.nestedArrangement')}</span>
              <span className="dsh-iui-edit-section-spacer" />
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
            <p className="dsh-iui-edit-arrangement-hint">{t('edit.nestedGroupHint')}</p>
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
                        return (
                          <li
                            key={blockId}
                            className={`dsh-iui-edit-nested-row${entry === undefined ? '' : ` dsh-iui-edit-color-${((entry.order - 1) % COLOR_COUNT) + 1}`}${dragging ? ' is-dragging' : ''}${hoveredBlockId === blockId ? ' is-hover-linked' : ''}`}
                            data-dsh-iui-edit-nested-row
                            data-block-id={blockId}
                            data-structure-confirming={confirmDeleteId === blockId ? 'true' : undefined}
                            data-parent-id={parentId}
                            data-order-index={index}
                            data-depth={block.depth}
                            data-hover-linked={hoveredBlockId === blockId ? 'true' : undefined}
                            onPointerEnter={() => { onHoverBlock?.(blockId) }}
                            onPointerLeave={() => { onHoverBlock?.(null) }}
                            style={depth === 0 ? undefined : { paddingLeft: `${depth * 12}px` }}
                          >
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
                            <button
                              type="button"
                              className="dsh-iui-edit-arrangement-body"
                              data-dsh-iui-edit-nested-body
                              title={t('edit.locate')}
                              aria-label={`${t('edit.locate')}: ${title} · ${t('edit.pageOrder', { n: blockId.replace(/^b/, '') })}${entry === undefined ? '' : ` · ${t('edit.requestOrder', { n: entry.order })}`}`}
                              onClick={() => { closeHover(); locate(blockId) }}
                            >
                              <span className="dsh-iui-edit-page-index" title={t('edit.pageOrder', { n: blockId.replace(/^b/, '') })} aria-hidden="true">{blockId.replace(/^b/, '')}</span>
                              <span className="dsh-iui-edit-arrangement-glyph"><TypeGlyph kind={block.kind} /></span>
                              <span className="dsh-iui-edit-arrangement-title" title={title}>{title}</span>
                              <span className="dsh-iui-edit-nested-type">{blockKindLabel(block.kind, t)}</span>
                              {entry === undefined ? null : <span className="dsh-iui-edit-badge" title={t('edit.requestOrder', { n: entry.order })} aria-hidden="true">{entry.order}</span>}
                              {entry === undefined ? null : <span className="dsh-iui-edit-tag">{t('edit.editedTag')}</span>}
                            </button>
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

        <div className="dsh-iui-edit-global">
          <label className="dsh-iui-edit-global-label" htmlFor={globalId}>{t('edit.global')}</label>
          <textarea
            id={globalId}
            className="dsh-iui-edit-textarea"
            data-dsh-iui-edit-global
            rows={4}
            maxLength={4000}
            value={session.globalInstruction}
            placeholder={t('edit.globalPlaceholder')}
            onChange={event => { actions.setGlobalInstruction(event.target.value) }}
          />
        </div>

        <div className="dsh-iui-edit-info" data-dsh-iui-edit-send-info>
          <p className="dsh-iui-edit-info-title">{t('edit.sendInfoTitle')}</p>
          <dl className="dsh-iui-edit-summary">
            <div className="dsh-iui-edit-summary-row">
              <dt>{t('edit.summaryEdits')}</dt>
              <dd>{t('edit.summaryCountValue', { count: session.selection.length })}</dd>
            </div>
            <div className="dsh-iui-edit-summary-row">
              <dt>{t('edit.summaryOrder')}</dt>
              <dd>{session.orderChanged ? t('edit.summaryOrderChanged') : t('edit.summaryOrderSame')}</dd>
            </div>
            <div className="dsh-iui-edit-summary-row">
              <dt>{t('edit.summaryGlobal')}</dt>
              <dd>{session.globalInstruction.trim() !== '' ? t('edit.summaryFilled') : t('edit.summaryEmpty')}</dd>
            </div>
          </dl>
          <p className="dsh-iui-edit-info-note">{t('edit.sendInfoNote')}</p>
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
      {preview === undefined ? null : createPortal(
        <div
          className="dsh-iui-edit-preview-backdrop"
          data-dsh-iui-edit-preview-backdrop
          onPointerDown={event => { if (event.target === event.currentTarget) cancelPreview() }}
        >
          <div
            ref={previewDialogRef}
            className="dsh-iui-edit-preview-dialog"
            data-dsh-iui-edit-structure-preview
            role="dialog"
            aria-modal="true"
            aria-labelledby={previewTitleId}
            onKeyDown={trapPreviewFocus}
          >
            <div className="dsh-iui-edit-preview-head">
              <h2 id={previewTitleId} className="dsh-iui-edit-preview-title">{t('edit.previewTitle')}</h2>
              <p className="dsh-iui-edit-preview-subtitle">
                <span className="dsh-iui-edit-preview-operation">{previewOperationLabel}</span>
                {previewBlockTitle === undefined ? null : <span className="dsh-iui-edit-preview-block">{previewBlockTitle}</span>}
                {previewTargetTitle === undefined ? null : <span className="dsh-iui-edit-preview-target">→ {previewTargetTitle}</span>}
              </p>
            </div>
            {preview.status === 'loading' ? (
              <div className="dsh-iui-edit-preview-loading" data-dsh-iui-edit-preview-loading role="status">
                <span className="dsh-iui-edit-preview-spinner" aria-hidden="true" />
                {t('edit.previewLoading')}
              </div>
            ) : null}
            {preview.status === 'failed' ? (
              <div className="dsh-iui-edit-preview-failed" data-dsh-iui-edit-preview-failed role="alert">
                {preview.error ?? t('edit.previewFailed')}
              </div>
            ) : null}
            {preview.status === 'ready' ? (
              <>
                <p className="dsh-iui-edit-preview-summary">{t('edit.previewSummary', { count: previewSummaryCount })}</p>
                {(preview.diff ?? []).length === 0 ? null : (
                  <ol className="dsh-iui-edit-preview-diff" data-dsh-iui-edit-preview-diff>
                    {(preview.diff ?? []).map((line, index) => (
                      <li key={`${line.kind}:${index}`} className="dsh-iui-edit-preview-line" data-diff={line.kind}>
                        <span className="dsh-iui-edit-preview-mark" aria-hidden="true">
                          {line.kind === 'add' ? `+ ${t('edit.previewAdd')}` : line.kind === 'remove' ? `- ${t('edit.previewRemove')}` : '·'}
                        </span>
                        <code className="dsh-iui-edit-preview-text">{line.text}</code>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : null}
            <div className="dsh-iui-edit-preview-actions">
              <button
                ref={previewCancelRef}
                type="button"
                className="dsh-iui-edit-preview-cancel"
                data-dsh-iui-edit-preview-cancel
                disabled={previewConfirming}
                aria-label={t('edit.previewCancel')}
                onClick={cancelPreview}
              >
                {t('edit.previewCancel')}
              </button>
              {preview.status === 'ready' ? (
                <button
                  type="button"
                  className="dsh-iui-edit-preview-confirm"
                  data-dsh-iui-edit-preview-confirm
                  disabled={previewConfirming || structureBusy}
                  aria-label={t('edit.previewConfirm')}
                  onClick={confirmPreview}
                >
                  {t('edit.previewConfirm')}
                </button>
              ) : null}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </aside>
  )
}
