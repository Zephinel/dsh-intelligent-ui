/**
 * One quiet focus cue for every input in the extension.
 *
 * Inputs live in the card chrome, the artifact editor, popovers, settings and
 * rendered artifacts, so a per-field wrapper would mean touching every control
 * and would still miss model-composed program inputs. This layer watches
 * focusin/focusout at the document level, finds the real input element, and
 * draws the same traveling-light ring used around editable blocks. The field's
 * own focus outline/border highlight is suppressed while the orbit is active.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'

interface OrbitBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly radius: number
}

const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'number', 'email', 'url', 'tel', 'password',
  'date', 'datetime-local', 'time', 'month', 'week',
])

const TARGET_CLASS = 'dsh-iui-input-orbit-target'
const ORBIT_PADDING = 5

/**
 * Whether an element is a text-like field that belongs to the extension.
 * Buttons that read as fields (the custom select trigger) are included;
 * checkboxes, radios, ranges and files keep their native focus treatment.
 * @param element - focused element.
 * @returns the element to ring, or null.
 */
function inputTarget(element: Element | null): HTMLElement | null {
  if (!(element instanceof HTMLElement)) return null
  if (element.closest('[class*="dsh-iui-"]') === null) return null
  if (element.closest('.dsh-iui-input-orbit-host') !== null) return null
  if (element.matches('.dsh-iui-quick-select')) return element
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(element.type) ? element : null
  }
  const editable = element.closest('[contenteditable="true"]')
  return editable instanceof HTMLElement ? editable : null
}

/** Measure a field and expand it into the ring's fixed-position box. */
function measure(element: HTMLElement): OrbitBox | null {
  if (!element.isConnected) return null
  const rect = element.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return null
  const style = getComputedStyle(element)
  const rawRadius = Number.parseFloat(style.borderTopLeftRadius)
  const radius = Number.isFinite(rawRadius) && rawRadius > 0 ? rawRadius : 8
  return {
    left: rect.left - ORBIT_PADDING,
    top: rect.top - ORBIT_PADDING,
    width: rect.width + ORBIT_PADDING * 2,
    height: rect.height + ORBIT_PADDING * 2,
    radius: radius + ORBIT_PADDING,
  }
}

/**
 * Render the single document-level input orbit while a plugin field has focus.
 * @returns the fixed ring, or null when nothing is focused.
 */
export function InputOrbit(): ReactElement | null {
  const [box, setBox] = useState<OrbitBox | null>(null)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let frame = 0
    let focusOutFrame = 0
    let last: OrbitBox | null = null
    let until = 0
    let observer: ResizeObserver | null = null

    const same = (a: OrbitBox, b: OrbitBox): boolean =>
      Math.abs(a.left - b.left) < 0.5 &&
      Math.abs(a.top - b.top) < 0.5 &&
      Math.abs(a.width - b.width) < 0.5 &&
      Math.abs(a.height - b.height) < 0.5 &&
      Math.abs(a.radius - b.radius) < 0.5

    const stop = (): void => {
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
    }

    const hide = (): void => {
      stop()
      observer?.disconnect()
      observer = null
      current.current?.classList.remove(TARGET_CLASS)
      current.current = null
      last = null
      setBox(null)
    }

    const tick = (now: number): void => {
      frame = 0
      const target = current.current
      if (target === null) return
      if (!target.isConnected || (document.activeElement !== target && !target.contains(document.activeElement))) {
        hide()
        return
      }
      const next = measure(target)
      if (next === null) {
        hide()
        return
      }
      if (last === null || !same(next, last)) {
        last = next
        setBox(next)
      }
      // The ring only needs frame-level tracking while layout is settling
      // (panel transition, resize, scroll); otherwise event observers take over.
      if (now < until) frame = requestAnimationFrame(tick)
    }

    const kick = (duration = 160): void => {
      if (current.current === null) return
      until = Math.max(until, performance.now() + duration)
      if (frame === 0) frame = requestAnimationFrame(tick)
    }

    const focusIn = (event: FocusEvent): void => {
      const target = inputTarget(event.target as Element | null)
      if (target === null || target === current.current) {
        kick()
        return
      }
      stop()
      observer?.disconnect()
      current.current?.classList.remove(TARGET_CLASS)
      current.current = target
      target.classList.add(TARGET_CLASS)
      last = null
      observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { kick() }) : null
      observer?.observe(target)
      until = performance.now() + 700
      tick(performance.now())
    }

    const focusOut = (): void => {
      // The next focusin can land in the same task; let it run first.
      if (focusOutFrame !== 0) cancelAnimationFrame(focusOutFrame)
      focusOutFrame = requestAnimationFrame(() => {
        focusOutFrame = 0
        const active = document.activeElement
        if (current.current !== null && active !== current.current && !current.current.contains(active)) hide()
      })
    }

    const onLayoutChange = (): void => { kick() }

    document.addEventListener('focusin', focusIn, true)
    document.addEventListener('focusout', focusOut, true)
    window.addEventListener('resize', onLayoutChange)
    document.addEventListener('scroll', onLayoutChange, true)
    document.addEventListener('transitionend', onLayoutChange, true)
    document.addEventListener('animationend', onLayoutChange, true)

    return () => {
      stop()
      if (focusOutFrame !== 0) cancelAnimationFrame(focusOutFrame)
      observer?.disconnect()
      current.current?.classList.remove(TARGET_CLASS)
      document.removeEventListener('focusin', focusIn, true)
      document.removeEventListener('focusout', focusOut, true)
      window.removeEventListener('resize', onLayoutChange)
      document.removeEventListener('scroll', onLayoutChange, true)
      document.removeEventListener('transitionend', onLayoutChange, true)
      document.removeEventListener('animationend', onLayoutChange, true)
    }
  }, [])

  if (box === null) return null
  return (
    <div
      className="dsh-iui-input-orbit"
      data-dsh-iui-input-orbit
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        borderRadius: box.radius,
      }}
      aria-hidden="true"
    />
  )
}
