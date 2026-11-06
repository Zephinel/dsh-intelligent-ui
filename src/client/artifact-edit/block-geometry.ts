/**
 * Geometry helpers for the edit-canvas block overlay.
 *
 * Edit-mode block wrappers are `display: contents`, so they have no box of
 * their own. Everything that needs a block's rectangle (hit testing, badges,
 * tools, the selected frame, the orbit glow, the instruction popover anchor and
 * the arrangement panel's locate/flash) resolves it from the overlay's hit
 * element, which is positioned from the real content boxes.
 */

/** The overlay hit element for one block, when the overlay has measured it. */
export function blockHitElement(blockId: string): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(blockId)
    : blockId.replace(/["\\]/g, '\\$&')
  return document.querySelector<HTMLElement>(`[data-dsh-iui-block-hit="${escaped}"]`)
}

/** The content wrapper for one block (layout-transparent; fallback only). */
export function blockWrapperElement(blockId: string): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(blockId)
    : blockId.replace(/["\\]/g, '\\$&')
  return document.querySelector<HTMLElement>(`[data-dsh-iui-block="${escaped}"]`)
}

/** The best measuring element for one block: overlay first, wrapper fallback. */
export function blockAnchorElement(blockId: string): HTMLElement | null {
  return blockHitElement(blockId) ?? blockWrapperElement(blockId)
}
