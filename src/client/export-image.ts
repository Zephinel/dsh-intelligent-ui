/**
 * Browser-side image export for one completed answer.
 *
 * The export entry lives in the standard assistant action row, so it receives
 * only the message identity. The rendered answer itself sits in the same
 * Turn-tail wrapper as the action row; this module discovers that card list in
 * the DOM, temporarily expands collapsed cards so the image shows the answer
 * (the card's own state is restored afterwards), captures the cards with
 * SnapDOM, applies the chosen beautification frame and downloads one PNG.
 *
 * Rendering, layout and fonts come from the live card, so the image matches
 * what the reader sees, including local interaction state. Two DOM features do
 * not survive snapshot rasterization on their own and are normalized for the
 * capture: the flashcard's two 3D faces (flattened to the visible face by the
 * `dsh-iui-export-capture` scope) and photos that are still loading (the export
 * waits for search results and image loads first).
 */
import { snapdom } from '@zumer/snapdom'
import { hideToAssistantBlocks } from '../lib/to-assistant.ts'
import { beautifyPlan, canvasFits, composeBox, exportScaleFactor, imageFileName, type BeautifyPlan } from './export-image-plan.ts'
import type { BeautifyStyle, ExportScale } from '../shared/intelligent-ui.ts'

/** Scope added to the rendered answer only while one capture is running. */
const EXPORT_CAPTURE_CLASS = 'dsh-iui-export-capture'

/**
 * Longest wait for a freshly opened answer's photos and image searches.
 * Covers the renderer's 500 ms search debounce plus its 12 s search deadline
 * (src/lib/components/media.tsx), with a little slack for the image decode.
 */
const IMAGE_SETTLE_MS = 12_500

/** Longest wait for maps inside the answer to report an idle, painted state. */
const MAP_SETTLE_MS = 6000

/** Options for one answer image export. */
export interface ExportCardsOptions {
  /** Canvas background behind the beautification frame. */
  readonly background: string
  /** Requested output scale. */
  readonly scale: ExportScale
  /** Chosen beautification frame. */
  readonly beautify: BeautifyStyle
  /** Remove blocks that only carry @ToAssistant follow-ups. */
  readonly hideToAssistant: boolean
  /** Answer title, used only for the download name. */
  readonly title?: string | undefined
}

/** Resolve after the browser has committed two frames. */
async function twoFrames(): Promise<void> {
  await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve() }) })
  await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve() }) })
}

/** Resolve after a fixed delay; used to let a resized MapLibre canvas repaint. */
function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => { window.setTimeout(resolve, milliseconds) })
}

/**
 * Find the rendered answer cards that belong to the action row's Turn.
 * @param trigger - the export button inside the assistant action row.
 * @returns the card list element, or null when the Turn rendered no card.
 */
export function findCardsForAction(trigger: HTMLElement): HTMLElement | null {
  const turnTail = trigger.closest<HTMLElement>('[data-turn-tail]')
  return turnTail?.querySelector<HTMLElement>('[data-dsh-intelligent-ui-list]') ?? null
}

/**
 * Expand every collapsed card under one answer and return the restore action.
 * @param container - the rendered card list.
 * @returns idempotent restore function that collapses exactly the cards it expanded.
 */
async function expandCards(container: HTMLElement): Promise<() => void> {
  const collapsed = [...container.querySelectorAll<HTMLButtonElement>('button.dsh-iui-header[aria-expanded="false"]')]
  if (collapsed.length === 0) return () => undefined
  for (const button of collapsed) button.click()
  await twoFrames()
  return () => {
    for (const button of collapsed) {
      if (button.isConnected && button.getAttribute('aria-expanded') === 'true') button.click()
    }
  }
}

/** Trace one rounded rectangle path on the target context. */
function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}

/**
 * Compose the captured answer onto a beautified canvas.
 * @param source - captured answer at the requested device scale.
 * @param plan - padding, radius and shadow in device pixels.
 * @param background - canvas background color.
 * @returns the composed canvas, or the source itself for the raw frame.
 */
function compose(source: HTMLCanvasElement, plan: BeautifyPlan, background: string): HTMLCanvasElement {
  if (plan.padding === 0 && plan.shadow === null) return source
  const box = composeBox(source.width, source.height, plan)
  if (!canvasFits(box.canvasWidth, box.canvasHeight)) {
    throw new Error('intelligent-ui export: the image is too large for one canvas')
  }
  const canvas = document.createElement('canvas')
  canvas.width = box.canvasWidth
  canvas.height = box.canvasHeight
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('intelligent-ui export: no 2D canvas context')
  context.fillStyle = background
  if (plan.shadow !== null) {
    context.save()
    context.shadowColor = plan.shadow.color
    context.shadowBlur = plan.shadow.blur
    context.shadowOffsetY = plan.shadow.offsetY
  }
  // The background is inset by the shadow bleed: painting it edge-to-edge
  // would clip the frame's soft shadow into an invisible sliver.
  roundedRect(context, box.backgroundX, box.backgroundY, box.backgroundWidth, box.backgroundHeight, plan.radius)
  context.fill()
  if (plan.shadow !== null) context.restore()
  context.drawImage(source, box.contentX, box.contentY)
  return canvas
}

/** Encode one canvas and hand the blob to the browser's download flow. */
async function downloadCanvas(canvas: HTMLCanvasElement, fileName: string): Promise<void> {
  const blob = await new Promise<Blob | null>(resolve => { canvas.toBlob(resolve, 'image/png') })
  if (blob === null) throw new Error('intelligent-ui export: PNG encoding failed')
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    window.setTimeout(() => { URL.revokeObjectURL(url) }, 4000)
  }
}

/**
 * Wait until photos and image searches inside one answer have settled.
 *
 * `SearchImage` resolves its photo through public Wikipedia/Wikimedia APIs
 * after mount and `<img loading="lazy">` may still be deferred, so an export
 * taken right after an answer appears would otherwise record empty image
 * boxes. The wait ends as soon as every photo has either loaded or fallen back
 * to its placeholder, and is bounded so a dead network cannot hang the export.
 * @param container - the rendered card list.
 * @returns a restore action that puts the forced eager-loading photos back to lazy.
 */
async function settlePhotos(container: HTMLElement): Promise<() => void> {
  const forcedEager = new Set<HTMLImageElement>()
  // Offline: no search or image can settle any more; capture what is painted.
  if (navigator.onLine === false) {
    await twoFrames()
    return () => undefined
  }
  const deadline = Date.now() + IMAGE_SETTLE_MS
  while (Date.now() < deadline) {
    // Ask lazy photos to load eagerly on every pass: a search may mount new
    // <img loading="lazy"> elements after this wait started, including slides
    // that are clipped by a carousel but still part of the rendered answer.
    for (const image of container.querySelectorAll<HTMLImageElement>('img')) {
      if (image.loading === 'lazy') {
        image.loading = 'eager'
        forcedEager.add(image)
      }
    }
    const photos = [...container.querySelectorAll<HTMLElement>('.iui-image')]
    const imagesLoading = [...container.querySelectorAll<HTMLImageElement>('img')].some(image => !image.complete)
    const searchesPending = photos.some(photo =>
      photo.querySelector('img') === null && photo.querySelector('.iui-image-empty') === null)
    const photosLoading = photos.some(photo =>
      photo.querySelector('img') !== null && !photo.classList.contains('is-loaded'))
    if (!imagesLoading && !searchesPending && !photosLoading) break
    await wait(120)
  }
  await twoFrames()
  return () => {
    for (const image of forcedEager) {
      if (image.isConnected && image.loading === 'eager') image.loading = 'lazy'
    }
  }
}

/**
 * Wait until every live MapLibre map under one answer reports that it has
 * finished painting after its resize. The renderer flips
 * `data-iui-map-ready` to false on data loading/resize and back to true on
 * MapLibre's `idle`, so the capture never records the stale WebGL buffer.
 * @param container - the rendered card list.
 */
async function settleMaps(container: HTMLElement): Promise<void> {
  const deadline = Date.now() + MAP_SETTLE_MS
  while (Date.now() < deadline) {
    const maps = [...container.querySelectorAll<HTMLElement>('[data-iui-map]')]
    if (maps.every(map => map.dataset.iuiMapReady === 'true')) break
    await wait(100)
  }
  await twoFrames()
}

/**
 * Capture one completed answer and download it as a PNG.
 * @param trigger - the export button inside the assistant action row.
 * @param options - background, scale, beautification frame, and file title.
 * @returns after the browser received the download.
 */
export async function exportCardsImage(trigger: HTMLElement, options: ExportCardsOptions): Promise<void> {
  const container = findCardsForAction(trigger)
  if (container === null) throw new Error('intelligent-ui export: no rendered answer')
  const factor = exportScaleFactor(options.scale)
  const plan = beautifyPlan(options.beautify, factor)
  await document.fonts?.ready
  const restoreExpanded = await expandCards(container)
  const restoreFollowUps = options.hideToAssistant ? hideToAssistantBlocks(container) : (): void => undefined
  let restorePhotos = (): void => undefined
  try {
    // Photos can grow the card and trigger a map resize, so settle them first
    // and let the map report idle again for the final layout.
    restorePhotos = await settlePhotos(container)
    await settleMaps(container)
    // Refuse an oversized target before SnapDOM allocates an unsupported
    // canvas. Measured after photos settle, because loading media grows a card.
    const rect = container.getBoundingClientRect()
    const estimate = composeBox(Math.max(1, Math.ceil(rect.width * factor)), Math.max(1, Math.ceil(rect.height * factor)), plan)
    if (!canvasFits(estimate.canvasWidth, estimate.canvasHeight)) {
      throw new Error('intelligent-ui export: the image is too large for one canvas')
    }
    container.classList.add(EXPORT_CAPTURE_CLASS)
    let source: HTMLCanvasElement
    try {
      source = await snapdom.toCanvas(container, {
        dpr: factor,
        backgroundColor: null,
        exclude: '[data-dsh-iui-export]',
      })
    } finally {
      container.classList.remove(EXPORT_CAPTURE_CLASS)
    }
    const composed = compose(source, plan, options.background)
    const title = options.title ?? container.querySelector<HTMLElement>('.dsh-iui-title')?.textContent ?? undefined
    await downloadCanvas(composed, imageFileName(title, new Date()))
  } finally {
    restorePhotos()
    restoreFollowUps()
    restoreExpanded()
  }
}
