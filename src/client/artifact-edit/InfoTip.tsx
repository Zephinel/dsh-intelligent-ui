/**
 * Small information affordance with a plugin-drawn tooltip.
 *
 * The native `title` tooltip is OS-painted and clashes with the editor's
 * surface language, so this is a themed alternative. Hover is used only on
 * hover-capable pointers; a click pins the tooltip open for touch, keyboard or
 * a deliberate mouse click. The tooltip is hoverable, closes on outside
 * pointerdown/Escape, and stays anchored through panel width transitions.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { RemixIcon } from '../../lib/components/remix-icon.tsx'

interface InfoTipProps {
  /** Accessible name of the button, e.g. "About nested blocks". */
  readonly label: string
  /** Tooltip body text. */
  readonly text: string
  /** Stable test hook for the trigger. */
  readonly testId?: string
}

interface Placement {
  readonly left: number
  readonly top: number
  readonly width: number
}

const GAP = 8
const MARGIN = 10
const WIDTH = 280
const CLOSE_DELAY = 350

/**
 * Render one info icon with a custom tooltip.
 * @param props - accessible label, tooltip text and optional test hook.
 * @returns the trigger plus a portaled tooltip while open.
 */
export function InfoTip({ label, text, testId }: InfoTipProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const pinned = useRef(false)
  const closeTimer = useRef<number | undefined>(undefined)
  const id = useId()

  const cancelClose = (): void => {
    if (closeTimer.current === undefined) return
    window.clearTimeout(closeTimer.current)
    closeTimer.current = undefined
  }

  const close = (): void => {
    cancelClose()
    pinned.current = false
    setOpen(false)
  }

  const scheduleClose = (): void => {
    if (pinned.current) return
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined
      setOpen(false)
    }, CLOSE_DELAY)
  }

  useEffect(() => () => {
    if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current)
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (trigger === null) return
    const place = (): void => {
      const rect = trigger.getBoundingClientRect()
      const tip = tipRef.current
      const height = tip?.offsetHeight ?? 60
      const width = Math.min(WIDTH, Math.max(180, window.innerWidth - MARGIN * 2))
      const left = Math.max(MARGIN, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - MARGIN))
      const below = rect.bottom + GAP
      const top = below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, rect.top - GAP - height)
      setPlacement({ left, top, width })
    }
    place()
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { place() })
      : null
    observer?.observe(trigger)
    if (tipRef.current !== null) observer?.observe(tipRef.current)
    const onLayoutEnd = (): void => { place() }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('transitionend', onLayoutEnd, true)
    document.addEventListener('animationend', onLayoutEnd, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('transitionend', onLayoutEnd, true)
      document.removeEventListener('animationend', onLayoutEnd, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (triggerRef.current?.contains(target as Node) === true) return
      if (tipRef.current?.contains(target as Node) === true) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="dsh-iui-info-tip-trigger"
        data-dsh-iui-info-tip={testId}
        aria-label={label}
        aria-describedby={id}
        onPointerEnter={event => {
          if (event.pointerType !== 'mouse') return
          cancelClose()
          setOpen(true)
        }}
        onPointerLeave={event => {
          if (event.pointerType !== 'mouse') return
          scheduleClose()
        }}
        onFocus={() => {
          cancelClose()
          setOpen(true)
        }}
        onBlur={() => {
          pinned.current = false
          scheduleClose()
        }}
        onClick={() => {
          cancelClose()
          if (pinned.current && open) {
            pinned.current = false
            setOpen(false)
            return
          }
          pinned.current = true
          setOpen(true)
        }}
      >
        <RemixIcon name="information-line" size={13} />
      </button>
      {open ? createPortal(
        <div
          ref={tipRef}
          className="dsh-iui-info-tooltip"
          role="tooltip"
          id={id}
          data-dsh-iui-info-tooltip
          style={placement === null ? { left: 0, top: 0, width: WIDTH, opacity: 0 } : placement}
          onPointerEnter={event => {
            if (event.pointerType !== 'mouse') return
            cancelClose()
          }}
          onPointerLeave={event => {
            if (event.pointerType !== 'mouse') return
            scheduleClose()
          }}
          onClick={() => { close() }}
        >
          {text}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
