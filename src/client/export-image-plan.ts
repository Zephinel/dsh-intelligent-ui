/**
 * Pure geometry and naming helpers for image export.
 *
 * Kept free of DOM and SnapDOM imports so the Node unit test can load this
 * module directly. The browser-side export pipeline applies these numbers to
 * the captured canvas.
 */
import type { BeautifyStyle, ExportScale } from '../shared/intelligent-ui.ts'

/** One beautification frame in device pixels. */
export interface BeautifyPlan {
  /** Transparent border around the captured answer. */
  readonly padding: number
  /** Outer background corner radius. */
  readonly radius: number
  /** Drop shadow behind the background, or null when the frame has none. */
  readonly shadow: { readonly blur: number; readonly offsetY: number; readonly color: string } | null
}

/** Browser canvas limit: longest side in device pixels. */
export const MAX_CANVAS_SIDE = 32767

/** Browser canvas limit: total device-pixel area. */
export const MAX_CANVAS_AREA = 268_435_456

/**
 * Whether one final canvas is within the browser's raster limits.
 * @param width - canvas width in device pixels.
 * @param height - canvas height in device pixels.
 * @returns true when the canvas can be allocated and encoded.
 */
export function canvasFits(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= MAX_CANVAS_SIDE && height <= MAX_CANVAS_SIDE && width * height <= MAX_CANVAS_AREA
}

/** Device-pixel factor of one export scale. */
export function exportScaleFactor(scale: ExportScale): number {
  return scale === '2x' ? 2 : 1
}

/**
 * Resolve one beautification frame at the requested scale.
 * @param style - chosen frame preset.
 * @param factor - device-pixel factor (1 or 2).
 * @returns padding, radius and shadow in device pixels.
 */
export function beautifyPlan(style: BeautifyStyle, factor: number): BeautifyPlan {
  // The frame is authored at 1x; scale every length so 1x and 2x keep the same
  // visual proportion around the captured answer.
  switch (style) {
    case 'raw':
      return { padding: 0, radius: 0, shadow: null }
    case 'rounded':
      return { padding: 24 * factor, radius: 20 * factor, shadow: null }
    case 'card':
      return {
        padding: 32 * factor,
        radius: 24 * factor,
        shadow: { blur: 24 * factor, offsetY: 8 * factor, color: 'rgba(0, 0, 0, 0.18)' },
      }
  }
}

/** Device-space placement of the captured answer inside the composed image. */
export interface ComposeBox {
  /** Final canvas width. */
  readonly canvasWidth: number
  /** Final canvas height. */
  readonly canvasHeight: number
  /** Background rectangle origin. */
  readonly backgroundX: number
  /** Background rectangle origin. */
  readonly backgroundY: number
  /** Background rectangle width. */
  readonly backgroundWidth: number
  /** Background rectangle height. */
  readonly backgroundHeight: number
  /** Captured answer origin. */
  readonly contentX: number
  /** Captured answer origin. */
  readonly contentY: number
}

/**
 * Size one composed image so a frame shadow is not clipped by the canvas edge.
 *
 * The background is inset by the shadow's bleed instead of filling the canvas:
 * a shadow drawn from an edge-to-edge rectangle has nowhere to fall, which made
 * the card frame's "soft shadow" invisible.
 * @param sourceWidth - captured answer width in device pixels.
 * @param sourceHeight - captured answer height in device pixels.
 * @param plan - frame geometry in device pixels.
 * @returns canvas and rectangle placement.
 */
export function composeBox(sourceWidth: number, sourceHeight: number, plan: BeautifyPlan): ComposeBox {
  const bleed = plan.shadow === null ? 0 : Math.ceil(plan.shadow.blur + Math.max(0, plan.shadow.offsetY) + 2)
  const backgroundWidth = sourceWidth + plan.padding * 2
  const backgroundHeight = sourceHeight + plan.padding * 2
  return {
    canvasWidth: backgroundWidth + bleed * 2,
    canvasHeight: backgroundHeight + bleed * 2,
    backgroundX: bleed,
    backgroundY: bleed,
    backgroundWidth,
    backgroundHeight,
    contentX: bleed + plan.padding,
    contentY: bleed + plan.padding,
  }
}

/** Characters no common filesystem accepts in a file name. */
const UNSAFE_FILENAME = /[\\/:*?"<>|\u0000-\u001f]+/g

/**
 * Normalize one exported answer title into a download file stem.
 * @param title - model-provided or manual title, when present.
 * @param fallback - stem when the title is empty or only unsafe characters.
 * @returns a plain file stem without an extension.
 */
export function fileStem(title: string | undefined, fallback = 'interactive-answer'): string {
  const cleaned = (title ?? '')
    .replace(UNSAFE_FILENAME, ' ')
    // Leading dots create hidden files; bidi controls can disguise the name.
    .replace(/^[.\u202a-\u202e\u2066-\u2069]+/u, '')
    .replace(/[\u202a-\u202e\u2066-\u2069]+/gu, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
  return cleaned === '' ? fallback : cleaned
}

/**
 * Build the download name for one exported image.
 * @param title - answer title, when present.
 * @param when - capture time.
 * @returns `<stem>-<yyyyMMdd-HHmmss>.png`.
 */
export function imageFileName(title: string | undefined, when: Date): string {
  const stamp = [
    when.getFullYear(),
    `${when.getMonth() + 1}`.padStart(2, '0'),
    `${when.getDate()}`.padStart(2, '0'),
  ].join('') + '-' + [
    `${when.getHours()}`.padStart(2, '0'),
    `${when.getMinutes()}`.padStart(2, '0'),
    `${when.getSeconds()}`.padStart(2, '0'),
  ].join('')
  return `${fileStem(title)}-${stamp}.png`
}
