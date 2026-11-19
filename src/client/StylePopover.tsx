/** Small anchored portal used for saving and managing templates. */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePopupDismiss } from './popover.ts'
import { clamp, useVisualViewportRevision, visualViewportBounds } from './visual-viewport.ts'

export function StylePopover({ anchor, title, onClose, children, menu = false }: {
  readonly anchor: RefObject<HTMLButtonElement>
  readonly title: string
  readonly onClose: () => void
  readonly children: ReactNode
  readonly menu?: boolean
}): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 8, top: 8, maxWidth: undefined as number | undefined, maxHeight: undefined as number | undefined })
  const close = useCallback(() => onClose(), [onClose])
  const viewportRevision = useVisualViewportRevision()
  usePopupDismiss(true, anchor, panel, close, menu ? 'button:not(:disabled)' : 'input, textarea, button:not(:disabled)')
  useLayoutEffect(() => {
    const place = (): void => {
      const trigger = anchor.current?.getBoundingClientRect()
      const popup = panel.current?.getBoundingClientRect()
      if (!trigger || !popup) return
      const bounds = visualViewportBounds(8)
      const maxWidth = Math.min(352, bounds.width)
      const maxHeight = bounds.height
      const left = clamp(trigger.right - popup.width, bounds.left, Math.max(bounds.left, bounds.right - Math.min(popup.width, maxWidth)))
      const below = trigger.bottom + 6
      const top = below + Math.min(popup.height, maxHeight) <= bounds.bottom
        ? clamp(below, bounds.top, Math.max(bounds.top, bounds.bottom - Math.min(popup.height, maxHeight)))
        : clamp(trigger.top - Math.min(popup.height, maxHeight) - 6, bounds.top, Math.max(bounds.top, bounds.bottom - Math.min(popup.height, maxHeight)))
      setPosition(current => current.left === left && current.top === top && current.maxWidth === maxWidth && current.maxHeight === maxHeight
        ? current
        : { left, top, maxWidth, maxHeight })
    }
    place()
    const observer = new ResizeObserver(place)
    if (panel.current) observer.observe(panel.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [anchor, viewportRevision])
  return createPortal(<div ref={panel} role={menu ? 'menu' : 'dialog'} aria-label={title}
    className={`dsh-iui-style-popover${menu ? ' dsh-iui-template-menu' : ''}`} style={position} data-dsh-iui-popup-child
    onKeyDown={event => {
      if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const items = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[next]?.focus()
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'))
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
    {menu ? null : <strong className="dsh-iui-template-title">{title}</strong>}
    {children}
  </div>, document.body)
}
