/**
 * Custom slider for the quick-adjust panel.
 *
 * The native range input is painted by the operating system (and looks
 * especially out of place in the dark theme), so the track, fill and thumb are
 * plain elements: pointer drag, keyboard arrows/Home/End and the same surface
 * tokens as the rest of the plugin. Every change is reported immediately, so
 * the block preview follows the thumb while dragging.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'

interface QuickSliderProps {
  readonly label: string
  readonly ariaLabel: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly unit: string
  readonly disabled?: boolean
  readonly onChange: (value: number) => void
}

/** Round a raw value to the slider step and its numeric domain. */
function snap(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value))
  const steps = Math.round((clamped - min) / step)
  const snapped = min + steps * step
  const decimals = Math.max(0, (String(step).split('.')[1] ?? '').length)
  return Number(snapped.toFixed(decimals))
}

/**
 * Render one custom slider.
 * @param props - bounds, value, unit and immediate change callback.
 * @returns the labelled track with a plugin-drawn fill and thumb.
 */
export function QuickSlider({ label, ariaLabel, value, min, max, step, unit, disabled = false, onChange }: QuickSliderProps): ReactElement {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  // Drag is relative to the value at pointer-down: clicking the track does not
  // teleport the thumb to the click point (which made one small nudge feel like
  // a huge jump), and moving the pointer keeps the same delta.
  const dragStart = useRef<{ value: number; x: number } | null>(null)
  const safeValue = Number.isFinite(value) ? value : min
  const ratio = max === min ? 0 : Math.min(1, Math.max(0, (safeValue - min) / (max - min)))
  const percent = ratio * 100

  const report = (next: number): void => {
    const snapped = snap(next, min, max, step)
    if (snapped !== safeValue) onChange(snapped)
  }

  const fromPointer = (clientX: number): void => {
    const track = trackRef.current
    const start = dragStart.current
    if (track === null || start === null) return
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return
    const delta = (clientX - start.x) / rect.width * (max - min)
    report(start.value + delta)
  }

  useEffect(() => {
    if (!dragging) return
    const onMove = (event: globalThis.PointerEvent): void => { fromPointer(event.clientX) }
    const onUp = (): void => { dragStart.current = null; setDragging(false) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  })

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    dragStart.current = { value: safeValue, x: event.clientX }
    setDragging(true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    const big = step * 10
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); report(safeValue + (event.shiftKey ? big : step)); return }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); report(safeValue - (event.shiftKey ? big : step)); return }
    if (event.key === 'Home') { event.preventDefault(); report(min); return }
    if (event.key === 'End') { event.preventDefault(); report(max) }
  }

  return (
    <div className={`dsh-iui-quick-slider${disabled ? ' is-disabled' : ''}`} data-dsh-iui-quick-slider data-label={label}>
      <div
        ref={trackRef}
        className={`dsh-iui-quick-slider-track${dragging ? ' is-dragging' : ''}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={safeValue}
        aria-valuetext={`${safeValue}${unit}`}
        aria-disabled={disabled ? true : undefined}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <span className="dsh-iui-quick-slider-fill" style={{ width: `${percent}%` }} aria-hidden="true" />
        <span className="dsh-iui-quick-slider-thumb" style={{ left: `${percent}%` }} aria-hidden="true" />
      </div>
      <span className="dsh-iui-quick-slider-value" aria-hidden="true">{safeValue}{unit}</span>
    </div>
  )
}
