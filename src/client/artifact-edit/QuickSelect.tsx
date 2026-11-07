/**
 * Custom listbox for the quick-adjust panel.
 *
 * Native `<select>` menus are painted by the operating system and break the
 * plugin's visual language (and look especially wrong in the dark theme), so
 * this is a deliberately small popup: a styled trigger plus a portaled listbox
 * with keyboard support, the same surface tokens as the edit panel and the
 * selection ring on the active option.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { RemixIcon } from '../../lib/components/remix-icon.tsx'

/** One choice in a quick-select listbox. */
export interface QuickSelectOption {
  readonly value: string
  readonly label: string
  /** Optional muted second line explaining the choice. */
  readonly description?: string
}

interface QuickSelectProps {
  readonly value: string
  readonly options: readonly QuickSelectOption[]
  readonly ariaLabel: string
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
  readonly className?: string
}

interface Placement {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly maxHeight: number
}

const MENU_GAP = 4
const MENU_MARGIN = 8
const OPTION_HEIGHT = 30
/** Described options carry a wrapped 11px/15px second line and grow accordingly. */
const DESCRIBED_OPTION_HEIGHT = 88
const MAX_MENU_HEIGHT = 240
/** Long localized explanations make described menus taller than the colour menu. */
const MAX_DESCRIBED_MENU_HEIGHT = 320

/**
 * Render one custom dropdown.
 * @param props - current value, options, accessible name and change callback.
 * @returns the trigger button and, while open, a portaled listbox.
 */
export function QuickSelect({ value, options, ariaLabel, onChange, disabled = false, className }: QuickSelectProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))
  const selected = options[selectedIndex] ?? options[0]
  const described = options.some(option => option.description !== undefined)

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (trigger === null) return
    const optionHeight = described ? DESCRIBED_OPTION_HEIGHT : OPTION_HEIGHT
    const menuHeightBudget = described ? MAX_DESCRIBED_MENU_HEIGHT : MAX_MENU_HEIGHT
    const place = (): void => {
      const rect = trigger.getBoundingClientRect()
      const width = Math.max(rect.width, 168)
      const maxHeight = Math.min(menuHeightBudget, options.length * optionHeight + 8)
      const below = window.innerHeight - rect.bottom - MENU_GAP - MENU_MARGIN
      const above = rect.top - MENU_GAP - MENU_MARGIN
      const flip = below < maxHeight && above > below
      const height = Math.min(maxHeight, flip ? above : below)
      setPlacement({
        left: Math.max(MENU_MARGIN, Math.min(rect.left, window.innerWidth - width - MENU_MARGIN)),
        top: flip ? Math.max(MENU_MARGIN, rect.top - MENU_GAP - height) : rect.bottom + MENU_GAP,
        width,
        maxHeight: Math.max(optionHeight, height),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, options.length, described])

  // Focus follows the popup while it is open.
  useEffect(() => {
    if (!open) return
    setActive(selectedIndex)
    const frame = window.requestAnimationFrame(() => { menuRef.current?.focus({ preventScroll: true }) })
    return () => { window.cancelAnimationFrame(frame) }
  }, [open, selectedIndex])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) === true || menuRef.current?.contains(target) === true) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [open])

  useEffect(() => {
    if (!open || placement === null) return
    const item = menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [open, placement, active])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, [open])

  const close = (focusTrigger = true): void => {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus({ preventScroll: true })
  }

  const choose = (next: string): void => {
    onChange(next)
    close()
  }

  const move = (delta: number): void => {
    setActive(current => Math.max(0, Math.min(options.length - 1, current + delta)))
  }

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); move(1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); move(-1); return }
    if (event.key === 'Home') { event.preventDefault(); event.stopPropagation(); setActive(0); return }
    if (event.key === 'End') { event.preventDefault(); event.stopPropagation(); setActive(options.length - 1); return }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation()
      const option = options[active]
      if (option !== undefined) choose(option.value)
      return
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); close()
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`dsh-iui-quick-select${className === undefined ? '' : ` ${className}`}`}
        data-dsh-iui-quick-select
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => { setOpen(current => !current) }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className="dsh-iui-quick-select-value">{selected?.label ?? ''}</span>
        <RemixIcon name="arrow-down-s-line" size={13} />
      </button>
      {open && placement === null ? null : open ? createPortal(
        <div
          ref={menuRef}
          className="dsh-iui-quick-menu"
          role="listbox"
          id={listboxId}
          aria-label={ariaLabel}
          aria-activedescendant={`${listboxId}-opt-${active}`}
          data-dsh-iui-quick-menu
          tabIndex={-1}
          style={{ left: placement?.left, top: placement?.top, width: placement?.width, maxHeight: placement?.maxHeight }}
          onKeyDown={onMenuKeyDown}
        >
          {options.map((option, index) => (
            <div
              key={option.value === '' ? `__default__:${index}` : option.value}
              id={`${listboxId}-opt-${index}`}
              role="option"
              aria-selected={option.value === value}
              data-value={option.value}
              data-index={index}
              className={`dsh-iui-quick-option${option.description === undefined ? '' : ' has-desc'}${index === active ? ' is-active' : ''}${option.value === value ? ' is-selected' : ''}`}
              onPointerMove={() => { setActive(index) }}
              onClick={() => { choose(option.value) }}
            >
              <span className="dsh-iui-quick-option-text">
                <span className="dsh-iui-quick-option-label">{option.label}</span>
                {option.description === undefined ? null : (
                  <span className="dsh-iui-quick-option-desc">{option.description}</span>
                )}
              </span>
              {option.value === value ? <RemixIcon name="check-line" size={13} /> : null}
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
