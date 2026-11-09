/**
 * SnapDOM capture pipeline for M2 revision thumbnails.
 *
 * Two entry points:
 * - `captureCardThumbnail`: screenshots a card that is already on screen (the
 *   active stage) after fonts/two frames/a short settle budget.
 * - `captureOffscreenThumbnail`: renders an older revision's program once in an
 *   off-screen React root and captures it, so opening the version bar never
 *   renders every artifact inline.
 *
 * The lazy queue caps concurrency at two and deduplicates by
 * `artifactId + revisionId + scheme`; every failure (SnapDOM missing, timeout,
 * render error) resolves to `undefined`, leaving the bar's placeholder in place.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { snapdom } from '@zumer/snapdom'
import type { CSSProperties } from 'react'
import { OpenUIRenderer } from '../../lib/render.tsx'
import { RemixIcon } from '../../lib/components/remix-icon.tsx'
import type { Translate } from '../../shared/locales.ts'
import type { RenderLayout } from '../../shared/intelligent-ui.ts'
import type { ImageSourceResolver } from '../../shared/image-source.ts'
import {
  artifactThumbnails,
  saveArtifactThumbnail,
  thumbnailKey,
  type ArtifactThumbnail,
  type ThumbnailParts,
  type ThumbnailScheme,
} from './artifact-thumbnails.ts'

/** Target bitmap width for a bar thumbnail. */
const THUMBNAIL_TARGET_WIDTH = 300
/** Capture settle budget after fonts and two frames (ms). */
const CAPTURE_SETTLE_MS = 420
/** Hard cap around one SnapDOM capture (ms); a stuck capture degrades to a placeholder. */
const CAPTURE_TIMEOUT_MS = 2500
/** Lazy off-screen captures run at most this many at a time. */
const LAZY_CONCURRENCY = 2
/** Chrome hidden from the captured card: it is a page index, not card content. */
const THUMBNAIL_EXCLUDE = [
  '.dsh-iui-head-actions',
  '.dsh-iui-result-actions',
  '[data-dsh-iui-edit-view]',
  '[data-dsh-iui-edit-panel]',
  '[data-dsh-iui-stage-stale]',
  '[data-dsh-iui-draft-badge]',
]

/** Await two animation frames (or resolve immediately without rAF). */
function twoFrames(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve() })))
}

/** Sleep helper. */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/** Race a promise against a timeout, resolving `undefined` on timeout/rejection. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>(resolve => { timer = setTimeout(() => { resolve(undefined) }, timeoutMs) })
  try {
    return await Promise.race([promise.catch(() => undefined), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Convert one canvas to a webp/png blob (undefined when the browser refuses both). */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | undefined> {
  return new Promise(resolve => {
    try {
      canvas.toBlob(blob => {
        if (blob !== null) { resolve(blob); return }
        canvas.toBlob(png => { resolve(png ?? undefined) }, 'image/png')
      }, 'image/webp', 0.8)
    } catch {
      resolve(undefined)
    }
  })
}

/**
 * Capture one already-rendered card as a small thumbnail.
 * @param element - card root that is visible (or an off-screen staging card).
 * @param options - settle budget override (the lazy path uses a shorter one).
 * @returns the bitmap or undefined on any failure/timeout.
 */
export async function captureCardThumbnail(element: HTMLElement, options: { readonly settleMs?: number } = {}): Promise<ArtifactThumbnail | undefined> {
  try {
    await document.fonts?.ready
    await twoFrames()
    await wait(options.settleMs ?? CAPTURE_SETTLE_MS)
    if (!element.isConnected) return undefined
    const rect = element.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 40) return undefined
    const dpr = Math.min(0.6, Math.max(0.12, THUMBNAIL_TARGET_WIDTH / Math.max(1, rect.width)))
    const canvas = await withTimeout(
      snapdom.toCanvas(element, { dpr, backgroundColor: null, exclude: THUMBNAIL_EXCLUDE }),
      CAPTURE_TIMEOUT_MS,
    )
    if (canvas === undefined) return undefined
    const blob = await canvasToBlob(canvas)
    if (blob === undefined || blob.size === 0) return undefined
    return { blob, width: canvas.width, height: canvas.height, createdAt: Date.now() }
  } catch {
    return undefined
  }
}

/** One off-screen revision render request. */
export interface OffscreenThumbnailInput {
  readonly parts: ThumbnailParts
  readonly program: string
  readonly title?: string
  readonly style: RenderLayout
  readonly themeStyle?: CSSProperties
  readonly scheme: ThumbnailScheme
  readonly t: Translate
  readonly resolveImage?: ImageSourceResolver
}

/**
 * Render one revision's program once off-screen and capture it.
 * The hidden staging card uses the real renderer (no interaction), then the
 * React root is unmounted and the host removed in all paths.
 * @param input - revision program/meta plus theme and locale seats.
 * @returns the bitmap or undefined.
 */
export async function captureOffscreenThumbnail(input: OffscreenThumbnailInput): Promise<ArtifactThumbnail | undefined> {
  if (typeof document === 'undefined') return undefined
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-12000px;top:0;width:640px;pointer-events:none;opacity:1;'
  document.body.appendChild(host)
  let root: ReturnType<typeof createRoot> | undefined
  try {
    root = createRoot(host)
    root.render(createElement(
      'div',
      { className: 'dsh-iui-card', 'data-dsh-iui-thumbnail-stage': 'true' },
      // M9/F6: mirror the real card head so lazy captures and live-stage
      // captures share the same composition (title/icon strip + body).
      createElement(
        'div',
        { className: 'dsh-iui-card-head' },
        createElement(
          'button',
          { type: 'button', className: 'dsh-iui-header', 'aria-expanded': true, tabIndex: -1 },
          createElement('span', { className: 'dsh-iui-icon', 'aria-hidden': true }, createElement(RemixIcon, { name: 'sparkling-fill', size: 14 })),
          createElement('span', { className: 'dsh-iui-title', 'data-dsh-iui-title': true }, input.title ?? input.t('card.title')),
          createElement('span', { className: 'dsh-iui-chevron', 'aria-hidden': true }, createElement(RemixIcon, { name: 'arrow-down-s-line', size: 14 })),
        ),
      ),
      createElement(
        'div',
        { className: 'dsh-iui-body' },
        createElement(OpenUIRenderer, {
          program: input.program,
          title: input.title,
          scopeId: input.parts.revisionId,
          themeStyle: input.themeStyle,
          scheme: input.scheme,
          t: input.t,
          resolveImage: input.resolveImage,
        }),
      ),
    ))
    await wait(0)
    const card = host.firstElementChild
    if (!(card instanceof HTMLElement)) return undefined
    return await captureCardThumbnail(card, { settleMs: 260 })
  } catch {
    return undefined
  } finally {
    try { root?.unmount() } catch { /* already unmounted */ }
    host.remove()
  }
}

type LazyJob = OffscreenThumbnailInput

const lazyQueue: LazyJob[] = []
const lazyQueued = new Set<string>()
const lazyRunning = new Set<string>()
let lazyActive = 0

const shutdown = (): boolean => typeof document === 'undefined'

function pumpLazyQueue(): void {
  while (lazyActive < LAZY_CONCURRENCY && lazyQueue.length > 0) {
    const job = lazyQueue.shift() as LazyJob
    const key = thumbnailKey(job.parts)
    lazyRunning.add(key)
    lazyActive += 1
    void captureOffscreenThumbnail(job).then(thumbnail => {
      if (thumbnail !== undefined) saveArtifactThumbnail(job.parts, thumbnail)
    }).finally(() => {
      lazyActive -= 1
      lazyRunning.delete(key)
      lazyQueued.delete(key)
      pumpLazyQueue()
    })
  }
}

/**
 * Queue a lazy capture for one revision the stage never displayed.
 * Deduplicates queued/in-flight keys and shares the global concurrency cap; a
 * failure only leaves the placeholder in place.
 * @param input - revision program/meta plus theme and locale seats.
 */
export function scheduleLazyThumbnail(input: OffscreenThumbnailInput): void {
  if (shutdown()) return
  const key = thumbnailKey(input.parts)
  if (artifactThumbnails.thumbnail(input.parts) !== undefined) return
  if (lazyQueued.has(key) || lazyRunning.has(key)) return
  lazyQueued.add(key)
  lazyQueue.push(input)
  pumpLazyQueue()
}
