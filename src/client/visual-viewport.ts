/**
 * Visual-viewport-aware overlay geometry.
 *
 * DSH 0.2.2-rc.2 moved native menus to CSS Anchor Positioning so they follow
 * page zoom and panning. Our custom portals still position themselves; this
 * module provides the shared bounds and re-render signal they need so a fixed
 * element is clamped to the *visible* region, not the layout viewport.
 */
import { useEffect, useState } from 'react'

/** Visible region in layout-viewport CSS coordinates, inset by `margin`. */
export interface VisualBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

/** Clamp a number into an inclusive range. */
export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * Return the visual viewport in the coordinates fixed elements use.
 * A margin keeps popovers off the screen edges; when no visual viewport exists
 * (SSR, older browsers) the layout viewport is used.
 */
export function visualViewportBounds(margin = 8): VisualBounds {
  if (typeof window === 'undefined') {
    return { left: margin, top: margin, right: 1024 - margin, bottom: 768 - margin, width: 1024 - margin * 2, height: 768 - margin * 2 }
  }
  const vv = window.visualViewport
  const offsetLeft = vv?.offsetLeft ?? 0
  const offsetTop = vv?.offsetTop ?? 0
  const width = Math.max(0, (vv?.width ?? window.innerWidth) - margin * 2)
  const height = Math.max(0, (vv?.height ?? window.innerHeight) - margin * 2)
  return {
    left: offsetLeft + margin,
    top: offsetTop + margin,
    right: offsetLeft + margin + width,
    bottom: offsetTop + margin + height,
    width,
    height,
  }
}

/**
 * Re-render signal for visual-viewport resize/scroll (pinch zoom, panning,
 * mobile keyboard). The revision is stable while the viewport is stable.
 */
export function useVisualViewportRevision(): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    const bump = (): void => setRevision(current => current + 1)
    window.addEventListener('resize', bump)
    vv?.addEventListener('resize', bump)
    vv?.addEventListener('scroll', bump)
    return () => {
      window.removeEventListener('resize', bump)
      vv?.removeEventListener('resize', bump)
      vv?.removeEventListener('scroll', bump)
    }
  }, [])
  return revision
}

/** One fixed-position box before visual-viewport fitting. */
export interface FixedBox {
  readonly left?: number
  readonly top?: number
  readonly width?: number
  readonly maxHeight?: number
}

/**
 * Clamp a fixed-position box into the visual viewport.
 *
 * `left`/`top` are layout-viewport CSS coordinates (what fixed placement uses);
 * `width`/`maxHeight` are capped to the visible region. A box that was fully
 * above the visible region is moved to its top edge so at least the box's
 * start is reachable; callers that flip above/below should place it before
 * calling this.
 */
export function fitFixedBox(box: FixedBox, margin = 8): FixedBox {
  const bounds = visualViewportBounds(margin)
  const width = box.width === undefined ? undefined : Math.min(box.width, bounds.width)
  const left = box.left === undefined
    ? undefined
    : clamp(box.left, bounds.left, Math.max(bounds.left, bounds.right - (width ?? 0)))
  const top = box.top === undefined
    ? undefined
    : clamp(box.top, bounds.top, Math.max(bounds.top, bounds.bottom - 80))
  const maxHeight = box.maxHeight === undefined || top === undefined
    ? box.maxHeight
    : Math.min(box.maxHeight, Math.max(0, bounds.bottom - top))
  return {
    ...left === undefined ? {} : { left },
    ...top === undefined ? {} : { top },
    ...width === undefined ? {} : { width },
    ...maxHeight === undefined ? {} : { maxHeight },
  }
}
