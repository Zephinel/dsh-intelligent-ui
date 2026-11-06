/**
 * Small information affordance with a plugin-drawn tooltip.
 *
 * The native `title` tooltip is OS-painted and clashes with the editor's
 * surface language, so this is a themed alternative: an info icon that opens a
 * portaled tooltip on hover/focus/click, with Escape and viewport clamping.
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
  const id = useId()

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (trigger === null) return
    const place = (): void => {
      const rect = trigger.getBoundingClientRect()
      const tip = tipRef.current
      const height = tip?.offsetHeight ?? 60
      const width = Math.min(WIDTH, Math.max(180, rect.width + 240))
      const left = Math.max(MARGIN, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - MARGIN))
      const below = rect.bottom + GAP
      const top = below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, rect.top - GAP - height)
      setPlacement({ left, top, width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="dsh-iui-info-tip-trigger"
        data-dsh-iui-info-tip={testId}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => { setOpen(true) }}
        onPointerLeave={() => { setOpen(false) }}
        onFocus={() => { setOpen(true) }}
        onBlur={() => { setOpen(false) }}
        onClick={() => { setOpen(current => !current) }}
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
        >
          {text}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
