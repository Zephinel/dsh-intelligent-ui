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
 * Markup stays one tree; CSS owns the desktop docked rail, the expanded rail and
 * the narrow-viewport bottom sheet.
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
import { blockKindLabel, type ArtifactEditActions, type ArtifactEditSession } from './contracts.ts'
import { MAX_ARTIFACT_BATCH_REQUESTS, MAX_ARTIFACT_DRAFTS, type ArtifactBlock, type ArtifactBlockKind } from '../../shared/artifact-edit.ts'
import type { Translate } from '../../shared/locales.ts'
import { hasArtifactEditContent, useArtifactEditStore } from './store.ts'

/** Props of the edit panel; the card supplies both the snapshot and actions. */
export interface EditPanelProps {
  readonly t: Translate
  readonly session: ArtifactEditSession
  readonly actions: ArtifactEditActions
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

/** Query one block wrapper inside the mounted edit canvas. */
function blockElement(blockId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-dsh-iui-block="${blockId}"]`)
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

/** Shared stroke icon wrapper; keeps the panel free of extra runtime imports. */
function Glyph({ children, size = 15, className }: {
  readonly children: ReactElement | ReactElement[]
  readonly size?: number
  readonly className?: string
}): ReactElement {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** Small per-kind block glyph, matching the design's list icons. */
function TypeGlyph({ kind }: { readonly kind: ArtifactBlockKind }): ReactElement {
  switch (kind) {
    case 'table':
      return <Glyph><rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M2.5 6.5h11M6.5 6.5V13" /></Glyph>
    case 'chart':
      return <Glyph><path d="M2.5 13V3M2.5 13h11" /><path d="M5.5 10.5V8M8 10.5V5.5M10.5 10.5V7" /></Glyph>
    case 'interactive':
      return <Glyph><path d="M8 2.5v11M2.5 8h11" /><circle cx="8" cy="8" r="2.1" /></Glyph>
    case 'card':
      return <Glyph><rect x="2.5" y="3" width="11" height="10" rx="1.6" /><path d="M5 6h6M5 8.5h6M5 11h3.5" /></Glyph>
    case 'section':
      return <Glyph><path d="M3 4h10M3 8h10M3 12h6" /></Glyph>
    case 'drawing':
      return <Glyph><path d="M3 13l1.4-3.8 6.4-6.4a1.3 1.3 0 0 1 1.8 1.8L6.2 11Z" /><path d="M9.6 4l2.4 2.4" /></Glyph>
    case 'media':
      return <Glyph><rect x="2.5" y="3.5" width="11" height="9" rx="1.2" /><circle cx="6" cy="7" r="1.2" /><path d="M3.5 12l3-3 2 2 2-2.5 2 3.5" /></Glyph>
    case 'container':
      return <Glyph><rect x="2.5" y="2.5" width="11" height="11" rx="1.2" strokeDasharray="2.5 2" /><path d="M5.5 8h5" /></Glyph>
    default:
      return <Glyph><path d="M4 2.5h5.5L12.5 5.5V13.5H4Z" /><path d="M6 7h4.5M6 9.5h4.5M6 12h3" /></Glyph>
  }
}

/** Six-dot drag handle. */
function GripGlyph(): ReactElement {
  return (
    <Glyph size={14}>
      <circle cx="6" cy="4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="6" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** Reset-order glyph. */
function ResetGlyph(): ReactElement {
  return <Glyph size={13}><path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2" /><path d="M3 2.5v3h3" /></Glyph>
}

/** Header expand/collapse glyph. */
function ExpandGlyph({ expanded }: { readonly expanded: boolean }): ReactElement {
  return expanded
    ? <Glyph size={14}><path d="M6 2.5H2.5V6M10 13.5h3.5V10" /><path d="M2.5 2.5 6 6M13.5 13.5 10 10" /></Glyph>
    : <Glyph size={14}><path d="M2.5 6V2.5H6M13.5 10v3.5H10" /><path d="M2.5 2.5 6 6M13.5 13.5 10 10" /></Glyph>
}

/** Close glyph for the narrow drawer control. */
function CloseGlyph(): ReactElement {
  return <Glyph size={13}><path d="M4 4l8 8M12 4l-8 8" /></Glyph>
}

/** Pencil glyph for edit actions. */
function EditGlyph(): ReactElement {
  return <Glyph size={14}><path d="M3 13l.8-2.6 7-7a1.2 1.2 0 0 1 1.7 1.7l-7 7Z" /><path d="M9.5 4.3l2.2 2.2" /></Glyph>
}

/** Trash glyph for request deletion. */
function TrashGlyph(): ReactElement {
  return (
    <Glyph size={13}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8" />
      <path d="M6.5 7v3.5M9.5 7v3.5" />
    </Glyph>
  )
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
function RequestHoverCard({ t, block, order, instruction, onEdit, onDelete, onEnter, onLeave }: {
  readonly t: Translate
  readonly block: ArtifactBlock
  readonly order: number
  readonly instruction: string
  readonly onEdit: () => void
  readonly onDelete: () => void
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
      <div className="dsh-iui-edit-card-actions">
        <button type="button" className="dsh-iui-edit-card-action" data-dsh-iui-edit-hover-edit onClick={onEdit}>
          <EditGlyph />{t('edit.openRequirement')}
        </button>
        <button type="button" className="dsh-iui-edit-card-action dsh-iui-edit-card-action-danger" data-dsh-iui-edit-hover-delete onClick={onDelete}>
          <TrashGlyph />{t('edit.delete')}
        </button>
      </div>
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
function RequestRow({ t, block, order, instruction, onOpen, onEdit, onDelete }: {
  readonly t: Translate
  readonly block: ArtifactBlock
  readonly order: number
  readonly instruction: string
  readonly onOpen: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
}): ReactElement {
  const title = block.title !== undefined && block.title.trim() !== '' ? block.title : blockKindLabel(block.kind, t)
  return (
    <li
      className={`dsh-iui-edit-request-row dsh-iui-edit-color-${((order - 1) % COLOR_COUNT) + 1}`}
      data-dsh-iui-edit-request-row
      data-block-id={block.blockId}
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
          aria-label={`${t('edit.delete')}: ${title}`}
          title={t('edit.delete')}
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

/** One nested container shown in the nested arrangement tree. */
interface NestedGroup {
  readonly parent: ArtifactBlock
  /** Child display ids in the pending nested order (already sanitized). */
  readonly childIds: readonly string[]
}

/** Short request summary for one draft row. */
function draftSummaryLabel(draft: ArtifactEditSession, t: Translate): string {
  const count = draft.selection.length
  if (count > 0) return t('edit.requestsCount', { count })
  if (draft.orderChanged) return t('edit.summaryOrderChanged')
  return t('edit.summaryGlobal')
}

/**
 * Chat-wide draft switcher: every retained draft with content, its revision,
 * request summary, active marker and conflict state, plus attach/discard
 * controls. The active canvas stays the only draft whose detail sections the
 * panel below renders.
 * @param props - locale, all retained drafts, the active draft key and actions.
 * @returns the section, or null when the chat has no retained draft.
 */
function DraftSwitcher({ t, drafts, activeKey, attachedCount, actions }: {
  readonly t: Translate
  readonly drafts: readonly ArtifactEditSession[]
  readonly activeKey: string
  readonly attachedCount: number
  readonly actions: ArtifactEditActions
}): ReactElement | null {
  if (drafts.length === 0) return null
  const attachBlocked = attachedCount >= MAX_ARTIFACT_BATCH_REQUESTS
  return (
    <section className="dsh-iui-edit-drafts" aria-label={t('edit.pendingDrafts')} data-dsh-iui-edit-draft-switcher>
      <div className="dsh-iui-edit-section-head">
        <span className="dsh-iui-edit-section-title">{t('edit.pendingDrafts')}</span>
        <span className="dsh-iui-edit-section-meta">({drafts.length}/{MAX_ARTIFACT_DRAFTS})</span>
      </div>
      <ul className="dsh-iui-edit-draft-list">
        {drafts.map(draft => {
          const active = draft.key === activeKey
          const conflict = draft.status === 'conflict'
          const title = draft.title !== undefined && draft.title.trim() !== '' ? draft.title : t('edit.panelTitle')
          return (
            <li
              key={draft.key}
              className={`dsh-iui-edit-draft-row${active ? ' is-active' : ''}`}
              data-dsh-iui-edit-draft-row
              data-key={draft.key}
              data-active={active ? 'true' : 'false'}
              data-attached={draft.attached ? 'true' : 'false'}
              data-conflict={conflict ? 'true' : undefined}
            >
              <button
                type="button"
                className="dsh-iui-edit-draft-open"
                data-dsh-iui-edit-draft-activate
                aria-current={active ? 'true' : undefined}
                onClick={() => { actions.activateDraft(draft.key) }}
              >
                <span className="dsh-iui-edit-draft-dot" aria-hidden="true" />
                <span className="dsh-iui-edit-draft-text">
                  <span className="dsh-iui-edit-draft-title" title={title}>{title}</span>
                  <span className="dsh-iui-edit-draft-meta">
                    {t('edit.revision', { n: draft.baseRevision })} · {draftSummaryLabel(draft, t)}
                  </span>
                </span>
                {conflict ? <span className="dsh-iui-edit-draft-tag is-conflict">{t('edit.conflictTitle')}</span> : null}
                {draft.submitFailed === true ? <span className="dsh-iui-edit-draft-tag is-failed" title={t('edit.draftFailedHint')}>{t('edit.draftFailed')}</span> : null}
                {draft.attached ? null : <span className="dsh-iui-edit-draft-tag">{t('edit.draftDetached')}</span>}
              </button>
              <span className="dsh-iui-edit-draft-actions">
                {draft.attached ? null : (
                  <button
                    type="button"
                    className="dsh-iui-edit-draft-action"
                    data-dsh-iui-edit-draft-attach
                    aria-label={`${t('edit.attachDraft')}: ${title}`}
                    title={attachBlocked ? t('edit.draftDetached') : t('edit.attachDraft')}
                    disabled={attachBlocked}
                    onClick={() => { actions.attachDraft(draft.key) }}
                  >
                    {t('edit.attachDraft')}
                  </button>
                )}
                <button
                  type="button"
                  className="dsh-iui-edit-draft-action dsh-iui-edit-draft-action-danger"
                  data-dsh-iui-edit-draft-discard
                  aria-label={`${t('edit.discardDraft')}: ${title}`}
                  title={t('edit.discardDraft')}
                  onClick={() => { actions.discardDraft(draft.key) }}
                >
                  {t('edit.discardDraft')}
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Artifact edit panel: requests, block arrangement, global instruction, summary. */
export function EditPanel({ t, session, actions }: EditPanelProps): ReactElement {
  const globalId = useId()
  const [expanded, setExpanded] = useState(false)
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
  const editStore = useArtifactEditStore()

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
  // Every retained draft of this chat, in creation order; the active canvas is
  // only one of them, and the rest keep their content until sent or discarded.
  const drafts = useMemo(() => {
    const list: ArtifactEditSession[] = []
    for (const candidate of editStore.sessions.values()) {
      if (candidate.sessionId !== session.sessionId) continue
      if (candidate.status === 'submitted') continue
      if (!hasArtifactEditContent(candidate) && !candidate.attached) continue
      list.push(candidate)
    }
    return list
  }, [editStore, session.sessionId])
  const attachedDraftCount = useMemo(() => drafts.filter(draft => draft.attached).length, [drafts])
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
      if (childIds === undefined || childIds.length < 2) continue
      const target = session.nestedOrder?.[block.blockId] ?? session.nestedOriginalOrder?.[block.blockId] ?? childIds
      const ordered = [
        ...target.filter(childId => childIds.includes(childId)),
        ...childIds.filter(childId => !target.includes(childId)),
      ]
      groups.push({ parent: block, childIds: ordered })
    }
    return groups
  }, [session.nestedMode, session.blocks, session.nestedOrder, session.nestedOriginalOrder])
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

  useEffect(() => () => {
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
    const moveBy = (delta: number): void => {
      if (parentId === undefined) actions.moveBlockBy(blockId, delta)
      else actions.moveNestedBlockBy(parentId, blockId, delta)
    }
    const moveTo = (toIndex: number): void => {
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
      className={`dsh-iui-edit-panel${expanded ? ' dsh-iui-edit-panel-expanded' : ''}`}
      aria-label={t('edit.panelTitle')}
      data-dsh-iui-edit-panel
      data-expanded={expanded ? 'true' : 'false'}
      data-open={session.drawerOpen ? 'true' : 'false'}
      data-status={session.status}
    >
      <header className="dsh-iui-edit-panel-head">
        <span className="dsh-iui-edit-panel-title">{t('edit.panelTitle')}</span>
        <span className="dsh-iui-edit-panel-spacer" />
        <button
          type="button"
          className="dsh-iui-edit-panel-icon"
          data-dsh-iui-edit-expand
          aria-pressed={expanded}
          aria-label={expanded ? t('edit.collapse') : t('edit.expand')}
          title={expanded ? t('edit.collapse') : t('edit.expand')}
          onClick={() => { setExpanded(value => !value) }}
        >
          <ExpandGlyph expanded={expanded} />
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
        <DraftSwitcher
          t={t}
          drafts={drafts}
          activeKey={session.key}
          attachedCount={attachedDraftCount}
          actions={actions}
        />
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

        <section className="dsh-iui-edit-section dsh-iui-edit-arrangement" aria-label={t('edit.arrangement')}>
          <div className="dsh-iui-edit-section-head">
            <span className="dsh-iui-edit-section-title">{t('edit.arrangement')}</span>
            <span className="dsh-iui-edit-section-meta">· {t('edit.blockCount', { count: session.blocks.length })}</span>
            <span className="dsh-iui-edit-section-spacer" />
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
                    className={`dsh-iui-edit-arrangement-row${entry === undefined ? '' : ` dsh-iui-edit-color-${((entry.order - 1) % COLOR_COUNT) + 1}`}${dragging ? ' is-dragging' : ''}`}
                    data-dsh-iui-edit-arrangement-row
                    data-block-id={blockId}
                    data-order-index={index}
                    data-dragging={dragging ? 'true' : undefined}
                    onPointerEnter={() => { scheduleHover(blockId) }}
                    onPointerLeave={scheduleHoverHide}
                  >
                    <button
                      type="button"
                      className="dsh-iui-edit-grip"
                      data-dsh-iui-edit-grip
                      aria-label={`${t('edit.moveHandle')}: ${title}`}
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
                      onClick={() => { closeHover(); locate(blockId) }}
                    >
                      {entry === undefined ? null : <span className="dsh-iui-edit-badge" aria-hidden="true">{entry.order}</span>}
                      <span className="dsh-iui-edit-arrangement-glyph"><TypeGlyph kind={block.kind} /></span>
                      <span className="dsh-iui-edit-arrangement-title" title={title}>{title}</span>
                      {entry === undefined ? null : <span className="dsh-iui-edit-tag">{t('edit.editedTag')}</span>}
                    </button>
                    <button
                      type="button"
                      className="dsh-iui-edit-icon-button"
                      data-dsh-iui-edit-arrangement-edit
                      aria-label={`${t('edit.openRequirement')}: ${title}`}
                      title={t('edit.openRequirement')}
                      onClick={() => { closeHover(); actions.openBlockEditor(blockId) }}
                    >
                      <EditGlyph />
                    </button>
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
                >
                  <div className="dsh-iui-edit-nested-group-head">
                    <span className="dsh-iui-edit-nested-group-title" title={parentTitle}>{parentTitle}</span>
                    <span className="dsh-iui-edit-nested-group-meta">{parentKind}</span>
                  </div>
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
                            className={`dsh-iui-edit-nested-row${entry === undefined ? '' : ` dsh-iui-edit-color-${((entry.order - 1) % COLOR_COUNT) + 1}`}${dragging ? ' is-dragging' : ''}`}
                            data-dsh-iui-edit-nested-row
                            data-block-id={blockId}
                            data-parent-id={parentId}
                            data-order-index={index}
                            data-depth={block.depth}
                            style={depth === 0 ? undefined : { paddingLeft: `${depth * 12}px` }}
                          >
                            <button
                              type="button"
                              className="dsh-iui-edit-grip"
                              data-dsh-iui-edit-nested-grip
                              aria-label={`${t('edit.moveHandle')}: ${title}`}
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
                              onClick={() => { closeHover(); locate(blockId) }}
                            >
                              {entry === undefined ? null : <span className="dsh-iui-edit-badge" aria-hidden="true">{entry.order}</span>}
                              <span className="dsh-iui-edit-arrangement-glyph"><TypeGlyph kind={block.kind} /></span>
                              <span className="dsh-iui-edit-arrangement-title" title={title}>{title}</span>
                              <span className="dsh-iui-edit-nested-type">{blockKindLabel(block.kind, t)}</span>
                              {entry === undefined ? null : <span className="dsh-iui-edit-tag">{t('edit.editedTag')}</span>}
                            </button>
                            <button
                              type="button"
                              className="dsh-iui-edit-icon-button"
                              data-dsh-iui-edit-nested-edit
                              aria-label={`${t('edit.openRequirement')}: ${title}`}
                              title={t('edit.openRequirement')}
                              onClick={() => { closeHover(); actions.openBlockEditor(blockId) }}
                            >
                              <EditGlyph />
                            </button>
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
          onEdit={() => { closeHover(); actions.openBlockEditor(hoverBlockId) }}
          onDelete={() => { closeHover(); actions.removeSelection(hoverBlockId) }}
          onEnter={keepHover}
          onLeave={scheduleHoverHide}
        />
      )}
    </aside>
  )
}
