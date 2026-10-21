/**
 * Small, shared popover primitives for the extension chrome.
 *
 * The composer menu and the answer-style panel anchor to the same chip. Keeping
 * placement, first focus and outside-dismiss behavior here prevents the two
 * surfaces from growing subtly different interaction rules.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/** Fixed-position placement measured from the trigger. */
export interface PopupPlacement {
  /** Viewport x for the popup's left edge. */
  readonly left: number
  /** Viewport distance from the bottom edge. */
  readonly bottom: number
  /** Rendered width after viewport clamping. */
  readonly width: number
  /** Optional maximum height for scrollable panels. */
  readonly maxHeight?: number
}

/** Width and viewport options for one anchored popup. */
export interface PopupPlacementOptions {
  /** Smallest useful width. */
  readonly minWidth: number
  /** Largest width on wide screens. */
  readonly maxWidth: number
  /** Viewport gutter. Defaults to 12px. */
  readonly margin?: number
  /** Whether to cap the height by the space above the trigger. */
  readonly maxHeight?: boolean
}

/**
 * Measure a popup above its trigger, clamped to the viewport.
 * @param open - whether the popup is visible.
 * @param triggerRef - the chip button.
 * @param options - width, gutter and height behavior.
 * @returns placement, or null while closed.
 */
export function useAnchoredPopup(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  options: PopupPlacementOptions,
): PopupPlacement | null {
  const [placement, setPlacement] = useState<PopupPlacement | null>(null)
  const { minWidth, maxWidth, margin = 12, maxHeight = false } = options

  useLayoutEffect(() => {
    if (!open || triggerRef.current === null) {
      setPlacement(null)
      return
    }
    const viewport = window.innerWidth
    const width = Math.min(maxWidth, Math.max(minWidth, viewport - margin * 2))
    const rect = triggerRef.current.getBoundingClientRect()
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewport - width - margin))
    setPlacement({
      left,
      bottom: Math.max(margin, window.innerHeight - rect.top + 8),
      width,
      ...maxHeight ? { maxHeight: Math.max(260, rect.top - 24) } : {},
    })
  }, [open, triggerRef, minWidth, maxWidth, margin, maxHeight])

  return placement
}

/**
 * Focus the first useful control, close on outside pointer or Escape, and return
 * focus to the trigger when the popup closes.
 * @param open - whether the popup is visible.
 * @param triggerRef - the chip that owns focus.
 * @param popupRef - the portal node.
 * @param onClose - request to close the popup.
 * @param initialFocus - selector for the first control, tried in order.
 */
export function usePopupDismiss(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocus = 'button, input, [tabindex]',
): void {
  useEffect(() => {
    if (!open) return
    const popup = popupRef.current
    const targets = popup?.querySelectorAll<HTMLElement>(initialFocus)
    targets?.[0]?.focus()

    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (popupRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
      triggerRef.current?.focus()
    }
  }, [open, onClose, initialFocus, popupRef, triggerRef])
}
