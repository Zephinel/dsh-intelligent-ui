/**
 * Geometry overlay for the edit canvas.
 *
 * Edit-mode wrappers are `display: contents`, so the rendered page keeps its
 * exact normal layout. Interaction chrome cannot live on those wrappers (they
 * have no box), so this client-only layer measures every editable block's real
 * content rectangles inside the canvas and paints, absolutely positioned:
 *
 * - one transparent hit target per block (pointer capture + keyboard focus),
 * - the hover cursor, selected/active frame, numbered badge and edit/close
 *   tools for selected blocks,
 * - the pastel marquee affordance for unselected root blocks.
 *
 * Because the layer is positioned from measured content rectangles, it never
 * changes layout, and the same implementation serves root-level and nested
 * blocks. The overlay lives inside `.dsh-iui-edit-canvas` (position: relative)
 * so scrolling and panel-width changes move the canvas and the overlay together;
 * a ResizeObserver + MutationObserver re-measure when the content reflows.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement, type RefObject } from 'react'
import { RemixIcon } from '../../lib/components/remix-icon.tsx'
import type { Translate } from '../../shared/locales.ts'
import type { ArtifactEditActions, ArtifactEditSession } from './contracts.ts'

/** One measured block box, in canvas-local coordinates. */
interface BlockHit {
  readonly blockId: string
  readonly depth: number
  /** 1-based display index, used for the pastel stagger and tone. */
  readonly index: number
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
    hits.push({
      blockId,
      depth: block.depth ?? 0,
      index: session.blocks.indexOf(block) + 1,
      left: left - canvasRect.left,
      top: top - canvasRect.top,
      width: right - left,
      height: bottom - top,
    })
  }
  // Root blocks first; nested blocks paint above their ancestors.
  return hits.sort((a, b) => a.depth - b.depth || a.index - b.index)
}

/** Compare two measurements without re-rendering identical frames. */
function sameHits(left: readonly BlockHit[], right: readonly BlockHit[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] as BlockHit
    const b = right[index] as BlockHit
    if (a.blockId !== b.blockId || a.depth !== b.depth || a.index !== b.index) return false
    if (Math.abs(a.left - b.left) > 0.5 || Math.abs(a.top - b.top) > 0.5) return false
    if (Math.abs(a.width - b.width) > 0.5 || Math.abs(a.height - b.height) > 0.5) return false
  }
  return true
}

/**
 * Render the edit-canvas block overlay.
 * @param props - locale, session, actions, scheme and the canvas element ref.
 * @returns the overlay layer (empty until the first measurement).
 */
export function BlockOverlay({ t, session, actions, scheme = 'light', canvasRef }: BlockOverlayProps): ReactElement {
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

  return (
    <div className="dsh-iui-block-overlay" data-dsh-iui-block-overlay>
      {hits.map(hit => {
        const entry = selectionByBlock.get(hit.blockId)
        const isActive = session.activeBlockId === hit.blockId
        const tone = tones[(hit.index - 1) % tones.length] as string
        const colorIndex = entry === undefined ? undefined : ((entry.order - 1) % 6) + 1
        const style = {
          left: hit.left,
          top: hit.top,
          width: hit.width,
          height: hit.height,
          zIndex: 10 + hit.depth * 2,
          '--dsh-iui-hit-color': colorIndex === undefined ? undefined : `var(--dsh-iui-edit-color-${colorIndex})`,
          '--dsh-iui-tone': tone,
          '--dsh-iui-stagger': String(hit.index - 1),
        } as CSSProperties
        const rootLevel = hit.depth === 0
        return (
          <div
            key={hit.blockId}
            className="dsh-iui-block-overlay-item"
            style={style}
            data-dsh-iui-block-hit-item={hit.blockId}
          >
            {rootLevel && entry === undefined && !isActive ? <span className="dsh-iui-block-marquee" aria-hidden="true" /> : null}
            {entry === undefined && !isActive ? null : (
              <span className={`dsh-iui-block-frame${entry === undefined ? ' is-active' : ''}`} aria-hidden="true" />
            )}
            {entry === undefined ? null : <span className="dsh-iui-block-badge" aria-hidden="true">{entry.order}</span>}
            {entry === undefined ? null : (
              <span className="dsh-iui-block-tools" role="group" aria-label={t('edit.selected')}>
                <button
                  type="button"
                  className="dsh-iui-block-tool"
                  title={t('edit.instruction')}
                  aria-label={t('edit.instruction')}
                  onClick={(event) => { event.stopPropagation(); actions.openBlockEditor(hit.blockId) }}
                >
                  <RemixIcon name="edit-line" size={13} />
                </button>
                <button
                  type="button"
                  className="dsh-iui-block-tool"
                  title={t('edit.deselect')}
                  aria-label={t('edit.deselect')}
                  onClick={(event) => { event.stopPropagation(); actions.removeSelection(hit.blockId) }}
                >
                  <RemixIcon name="close-line" size={12} />
                </button>
              </span>
            )}
            <button
              type="button"
              className="dsh-iui-block-hit"
              data-dsh-iui-block-hit={hit.blockId}
              aria-label={t('edit.select')}
              aria-pressed={entry === undefined ? undefined : true}
              onClick={() => { actions.openBlockEditor(hit.blockId) }}
            />
          </div>
        )
      })}
    </div>
  )
}
