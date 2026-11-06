/**
 * Geometry overlay for the edit canvas.
 *
 * Edit-mode wrappers are `display: contents`, so the rendered page keeps its
 * exact normal layout. Interaction chrome cannot live on those wrappers, so
 * this client-only layer measures every editable block's real content
 * rectangles inside the canvas and paints:
 *
 * - one transparent hit target per block (pointer capture + keyboard focus),
 * - hover sync frames (row hover ↔ canvas hover),
 * - the focused-editing frame plus a scrim over the rest of the canvas,
 * - low-key pending markers (dot + request number) after Save,
 * - page-order index badges for the list ↔ content mapping (roots always,
 *   nested blocks while hovered),
 * - the pastel orbit glow for root blocks that are neither edited nor pending.
 *
 * The overlay lives inside the relatively-positioned `.dsh-iui-edit-canvas`, so
 * scrolling and panel-width changes move it together with the content; a
 * ResizeObserver + MutationObserver re-measure when the content reflows.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement, type RefObject } from 'react'
import type { Translate } from '../../shared/locales.ts'
import type { ArtifactEditActions, ArtifactEditSession } from './contracts.ts'

/** One measured block box, in canvas-local coordinates. */
interface BlockHit {
  readonly blockId: string
  readonly depth: number
  /** Page-order label: root blocks `1..n`, nested blocks `1.2` style. */
  readonly pageLabel: string
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Six pastel tones matching the selection hue family (light scheme). */
const TONES_LIGHT = ['#8db4f2', '#c0aef4', '#7ecfae', '#ecc282', '#f0aac4', '#8ed2e2'] as const
/** Dark-scheme tones are lighter so they glow against the card surface. */
const TONES_DARK = ['#aac8ff', '#d4c6ff', '#a5e7c7', '#ffd9a3', '#ffc2d7', '#aaeaf4'] as const

interface BlockOverlayProps {
  readonly t: Translate
  readonly session: ArtifactEditSession
  readonly actions: ArtifactEditActions
  readonly scheme?: 'light' | 'dark'
  readonly canvasRef: RefObject<HTMLElement | null>
  /** Block currently hovered from the panel or the canvas, for bidirectional sync. */
  readonly hoveredBlockId?: string | null
  readonly onHoverBlock?: (blockId: string | null) => void
}

/** Whether two display ids are the same block or in one ancestor chain. */
function relatedBlockIds(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`)
}

/** Collect the rendered boxes owned by one wrapper (skip display:contents layers). */
function collectRects(wrapper: Element): { left: number; top: number; right: number; bottom: number }[] {
  const rects: { left: number; top: number; right: number; bottom: number }[] = []
  const walk = (parent: Element): void => {
    for (const child of Array.from(parent.children)) {
      const style = window.getComputedStyle(child)
      if (style.display === 'contents') { walk(child); continue }
      // Positioned decorations (none today) must not define the block extent.
      if (style.position === 'absolute' || style.position === 'fixed') continue
      const rect = child.getBoundingClientRect()
      if (rect.width <= 0 && rect.height <= 0) continue
      rects.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
    }
  }
  walk(wrapper)
  return rects
}

/** Measure every editable block inside the canvas. */
function measureBlocks(canvas: HTMLElement, session: ArtifactEditSession): BlockHit[] {
  const canvasRect = canvas.getBoundingClientRect()
  const byId = new Map(session.blocks.map(block => [block.blockId, block]))
  const rootOrder = new Map<string, number>()
  let rootCount = 0
  for (const block of session.blocks) {
    if ((block.depth ?? 0) === 0) rootOrder.set(block.blockId, ++rootCount)
  }
  const hits: BlockHit[] = []
  for (const wrapper of Array.from(canvas.querySelectorAll('[data-dsh-iui-block]'))) {
    const blockId = wrapper.getAttribute('data-dsh-iui-block')
    const block = blockId === null ? undefined : byId.get(blockId)
    if (blockId === null || block === undefined) continue
    const rects = collectRects(wrapper)
    if (rects.length === 0) continue
    const left = Math.min(...rects.map(rect => rect.left))
    const top = Math.min(...rects.map(rect => rect.top))
    const right = Math.max(...rects.map(rect => rect.right))
    const bottom = Math.max(...rects.map(rect => rect.bottom))
    const depth = block.depth ?? 0
    hits.push({
      blockId,
      depth,
      pageLabel: depth === 0 ? String(rootOrder.get(blockId) ?? block.originalIndex) : blockId.replace(/^b/, ''),
      left: left - canvasRect.left,
      top: top - canvasRect.top,
      width: right - left,
      height: bottom - top,
    })
  }
  // Root blocks first; nested blocks paint above their ancestors.
  return hits.sort((a, b) => a.depth - b.depth || a.pageLabel.localeCompare(b.pageLabel, undefined, { numeric: true }))
}

/** Compare two measurements without re-rendering identical frames. */
function sameHits(left: readonly BlockHit[], right: readonly BlockHit[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] as BlockHit
    const b = right[index] as BlockHit
    if (a.blockId !== b.blockId || a.depth !== b.depth || a.pageLabel !== b.pageLabel) return false
    if (Math.abs(a.left - b.left) > 0.5 || Math.abs(a.top - b.top) > 0.5) return false
    if (Math.abs(a.width - b.width) > 0.5 || Math.abs(a.height - b.height) > 0.5) return false
  }
  return true
}

/**
 * Render the edit-canvas block overlay.
 * @param props - locale, session, actions, scheme, canvas ref and hover state.
 * @returns the overlay layer (empty until the first measurement).
 */
export function BlockOverlay({ t, session, actions, scheme = 'light', canvasRef, hoveredBlockId = null, onHoverBlock }: BlockOverlayProps): ReactElement {
  const [hits, setHits] = useState<BlockHit[]>([])
  const tones = scheme === 'dark' ? TONES_DARK : TONES_LIGHT

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const next = measureBlocks(canvas, session)
      setHits(current => (sameHits(current, next) ? current : next))
    }
    const schedule = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(measure)
    }
    schedule()
    const resize = new ResizeObserver(schedule)
    resize.observe(canvas)
    const mutations = new MutationObserver(records => {
      // Ignore this overlay's own DOM/style updates.
      if (records.every(record => record.target instanceof Element && record.target.closest('.dsh-iui-block-overlay') !== null)) return
      schedule()
    })
    mutations.observe(canvas, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
    window.addEventListener('resize', schedule)
    document.fonts?.ready.then(schedule).catch(() => undefined)
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [canvasRef, session.blocks, session.key])

  const selectionByBlock = useMemo(() => new Map(session.selection.map(entry => [entry.blockId, entry])), [session.selection])
  const activeId = session.activeBlockId

  return (
    <div className="dsh-iui-block-overlay" data-dsh-iui-block-overlay>
      {hits.map(hit => {
        const entry = selectionByBlock.get(hit.blockId)
        const isActive = activeId === hit.blockId
        const pending = entry !== undefined
        const hovered = hoveredBlockId === hit.blockId
        const rootLevel = hit.depth === 0
        const focused = activeId !== undefined
        const dimmed = focused && !relatedBlockIds(activeId, hit.blockId)
        const pendingColor = entry === undefined ? undefined : `var(--dsh-iui-edit-color-${((entry.order - 1) % 6) + 1})`
        const tone = pendingColor ?? tones[(Number(hit.pageLabel.split('.')[0]) - 1 + tones.length) % tones.length] as string
        const style = {
          left: hit.left,
          top: hit.top,
          width: hit.width,
          height: hit.height,
          zIndex: 10 + hit.depth * 2,
          '--dsh-iui-tone': tone,
          '--dsh-iui-stagger': String(Math.max(0, Number(hit.pageLabel.split('.')[0]) - 1)),
          '--dsh-iui-hit-color': pendingColor,
        } as CSSProperties
        return (
          <div
            key={hit.blockId}
            className={`dsh-iui-block-overlay-item${hovered ? ' is-hovered' : ''}`}
            style={style}
            data-dsh-iui-block-hit-item={hit.blockId}
            data-hovered={hovered ? 'true' : undefined}
            data-pending={pending ? 'true' : undefined}
          >
            {dimmed ? <span className="dsh-iui-block-scrim" aria-hidden="true" /> : null}
            {rootLevel && !isActive && !focused ? (
              <span className={`dsh-iui-block-orbit dsh-iui-block-marquee${pending ? ' is-pending' : ''}`} aria-hidden="true" />
            ) : null}
            {hovered && !isActive ? <span className="dsh-iui-block-hover-frame" aria-hidden="true" /> : null}
            {isActive ? <span className="dsh-iui-block-frame is-active" aria-hidden="true" /> : null}
            {pending && entry !== undefined && !isActive ? (
              <span className="dsh-iui-block-pending" aria-hidden="true" title={t('edit.pendingMarker')}>
                <span className="dsh-iui-block-pending-dot" />
                <span className="dsh-iui-block-pending-number">{entry.order}</span>
              </span>
            ) : null}
            {!pending && (rootLevel || hovered) ? (
              <span className="dsh-iui-block-page-index" aria-hidden="true">{hit.pageLabel}</span>
            ) : null}
            <button
              type="button"
              className="dsh-iui-block-hit"
              data-dsh-iui-block-hit={hit.blockId}
              aria-label={t('edit.select')}
              aria-pressed={entry === undefined ? undefined : true}
              onClick={() => { actions.openBlockEditor(hit.blockId) }}
              onMouseEnter={() => { onHoverBlock?.(hit.blockId) }}
              onMouseLeave={() => { onHoverBlock?.(null) }}
            />
          </div>
        )
      })}
    </div>
  )
}
