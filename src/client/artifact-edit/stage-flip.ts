/**
 * FLIP transition for switching the active stage to another revision (M2).
 *
 * The version bar closes and the stage re-renders the selected revision
 * synchronously; this helper overlays the revision's thumbnail at its bar
 * rectangle and animates it into the stage content rectangle while the real
 * stage fades in. It is purely visual: the store selection already happened and
 * no Host write is involved. Reduced motion (or a missing thumbnail) switches
 * directly.
 */

/** One viewport rectangle used by the FLIP animation. */
export interface FlipRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Duration of the thumbnail→stage transition (ms). */
export const STAGE_FLIP_DURATION_MS = 260

/** Attribute/data hook of the transient overlay image. */
export const STAGE_FLIP_ATTR = 'data-dsh-iui-stage-flip'

/** Whether the user asked for reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Interpolate between two FLIP rectangles.
 * @param from - starting rectangle (thumbnail).
 * @param to - ending rectangle (stage content).
 * @param progress - 0..1 (clamped).
 * @returns the rectangle at that progress; pure so the motion math is testable.
 */
export function interpolateFlipRect(from: FlipRect, to: FlipRect, progress: number): FlipRect {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
  return {
    left: from.left + (to.left - from.left) * t,
    top: from.top + (to.top - from.top) * t,
    width: from.width + (to.width - from.width) * t,
    height: from.height + (to.height - from.height) * t,
  }
}

/** DOMRect-like → plain viewport rectangle. */
export function rectOf(rect: { left: number; top: number; width: number; height: number }): FlipRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/**
 * Play the thumbnail→stage transition.
 *
 * The stage element is expected to already render the selected revision (call
 * after two frames). The overlay is removed even when the animation is
 * interrupted, and the stage's opacity animation is cancelled on cleanup.
 * @param input - start rectangle, thumbnail object URL and the stage card element.
 * @returns after the animation finished (or immediately for reduced motion).
 */
export async function playStageFlip(input: {
  readonly start: FlipRect
  readonly imageUrl: string
  readonly stageElement: HTMLElement
  readonly duration?: number
}): Promise<void> {
  if (typeof document === 'undefined' || prefersReducedMotion()) return
  const duration = Math.max(0, input.duration ?? STAGE_FLIP_DURATION_MS)
  if (duration === 0 || input.start.width < 8 || input.start.height < 8) return
  const end = rectOf((input.stageElement.querySelector<HTMLElement>('.dsh-iui-body') ?? input.stageElement).getBoundingClientRect())
  if (end.width < 8 || end.height < 8) return
  const overlay = document.createElement('img')
  overlay.setAttribute(STAGE_FLIP_ATTR, 'true')
  overlay.setAttribute('aria-hidden', 'true')
  overlay.alt = ''
  overlay.src = input.imageUrl
  overlay.decoding = 'async'
  overlay.style.cssText = [
    'position:fixed',
    'z-index:1400',
    'pointer-events:none',
    'object-fit:cover',
    'object-position:top',
    `left:${input.start.left}px`,
    `top:${input.start.top}px`,
    `width:${input.start.width}px`,
    `height:${input.start.height}px`,
    'border-radius:12px',
    'box-shadow:0 12px 40px rgb(0 0 0 / 24%)',
    'background:var(--dsw-alias-bg-layer-2)',
  ].join(';')
  document.body.appendChild(overlay)
  const stageAnimation = typeof input.stageElement.animate === 'function'
    ? input.stageElement.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    : undefined
  const animation = typeof overlay.animate === 'function'
    ? overlay.animate([
        { left: `${input.start.left}px`, top: `${input.start.top}px`, width: `${input.start.width}px`, height: `${input.start.height}px`, borderRadius: '12px', opacity: 1 },
        { left: `${end.left}px`, top: `${end.top}px`, width: `${end.width}px`, height: `${end.height}px`, borderRadius: '16px', opacity: 0.35 },
      ], { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' })
    : undefined
  try {
    if (animation !== undefined) await animation.finished.catch(() => undefined)
    else await new Promise(resolve => setTimeout(resolve, duration))
  } finally {
    animation?.cancel()
    stageAnimation?.cancel()
    overlay.remove()
  }
}
