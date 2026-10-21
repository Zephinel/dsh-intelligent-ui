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
  /** Viewport x for the popup's left edge (start alignment). */
  readonly left?: number
  /** Viewport distance from the right edge (end alignment). */
  readonly right?: number
  /** Viewport distance from the bottom edge. */
  readonly bottom: number
  /** Rendered width after viewport clamping (start alignment). */
  readonly width?: number
  /** Content-width cap for end-aligned popups. */
  readonly maxWidth?: number
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
  /**
   * Align the popup's right edge with the trigger's right edge and let the
   * width follow its content, capped by `maxWidth`. Used by the menus.
   * `minWidth` only applies to start-aligned popups; menu minimums belong in CSS.
   */
  readonly alignEnd?: boolean
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
  popupRef?: RefObject<HTMLElement | null>,
): PopupPlacement | null {
  const [placement, setPlacement] = useState<PopupPlacement | null>(null)
  const { minWidth, maxWidth, margin = 12, maxHeight = false, alignEnd = false } = options

  useLayoutEffect(() => {
    if (!open || triggerRef.current === null) {
      setPlacement(null)
      return
    }
    const trigger = triggerRef.current
    const place = (): void => {
      const viewport = window.innerWidth
      const rect = trigger.getBoundingClientRect()
      const bottom = Math.max(margin, window.innerHeight - rect.top + 8)
      if (alignEnd) {
        // The caller sizes the popup from its content; only the edge and width
        // cap are placed here.
        setPlacement({
          right: Math.min(Math.max(margin, viewport - rect.right), viewport - margin),
          maxWidth: Math.min(maxWidth, viewport - margin * 2),
          bottom,
          ...maxHeight ? { maxHeight: Math.max(260, rect.top - 24) } : {},
        })
        return
      }
      const width = Math.min(maxWidth, Math.max(minWidth, viewport - margin * 2))
      const left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewport - width - margin))
      setPlacement({
        left,
        bottom,
        width,
        ...maxHeight ? { maxHeight: Math.max(260, rect.top - 24) } : {},
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open, triggerRef, minWidth, maxWidth, margin, maxHeight, alignEnd])

  // An end-aligned popup wider than the space left of its trigger would clip
  // at the left edge. Once mounted, nudge its right edge right until it fits.
  useLayoutEffect(() => {
    if (!open || !alignEnd || popupRef?.current === null || popupRef?.current === undefined || placement === null) return
    const rect = popupRef.current.getBoundingClientRect()
    if (rect.left >= margin) return
    const right = Math.max(margin, window.innerWidth - margin - rect.width)
    setPlacement(current => current === null || current.right === right ? current : { ...current, right })
  }, [open, alignEnd, popupRef, placement, margin])

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
      triggerRef.current?.focus({ preventScroll: true })
    }
  }, [open, onClose, initialFocus, popupRef, triggerRef])
}
