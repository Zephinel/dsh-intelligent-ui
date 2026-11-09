/**
 * Browser half of the single-file interactive-page export.
 *
 * Fetches the standalone renderer assets the Host serves on same-origin
 * routes, snapshots the exporting page's theme tokens, assembles one HTML
 * document, and hands it to the browser as a `.html` download.
 */
import {
  EXPORT_STANDALONE_CSS_PATH,
  EXPORT_STANDALONE_JS_PATH,
  type ExportPageCard,
} from '../shared/intelligent-ui.ts'
import { buildStandaloneHtml, pageFileName } from './export-html-plan.ts'
import { findCardsForAction, settleLocalImages } from './export-image.ts'

/** Options for exporting the current answer as an interactive page. */
export interface ExportPageOptions {
  /** Recorded cards to embed, in render order. */
  readonly cards: readonly ExportPageCard[]
  /** Answer title; also the page title and file-name stem. */
  readonly title?: string | undefined
  /** UI language for the standalone card chrome. */
  readonly lang: string
  /** Whether the export removes the @ToAssistant follow-up block. */
  readonly removeFollowUps: boolean
  /** Export trigger in the answer's action row; locates the live cards for local-image inlining. */
  readonly trigger?: HTMLElement
}

/**
 * Snapshot the documented CSS custom properties from the running page.
 *
 * DSH themes its chrome with custom properties on `:root`; copying their
 * computed values reproduces the current light/dark theme in the standalone
 * document without shipping DSH's stylesheet.
 * @returns a `:root{…}` block plus the page's `color-scheme`.
 */
export function captureThemeTokens(): { tokens: string; colorScheme: string } {
  const names = new Set<string>()
  const visit = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if ('style' in rule) {
        const style = (rule as CSSStyleRule).style
        for (let index = 0; index < style.length; index += 1) {
          const property = style.item(index)
          if (property.startsWith('--')) names.add(property)
        }
      }
      if ('cssRules' in rule) {
        try {
          visit((rule as CSSGroupingRule).cssRules)
        } catch {
          // Cross-origin stylesheet: skip.
        }
      }
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules)
    } catch {
      // Cross-origin stylesheet: skip.
    }
  }
  const root = getComputedStyle(document.documentElement)
  const body = getComputedStyle(document.body)
  const declarations: string[] = []
  for (const name of names) {
    const value = body.getPropertyValue(name).trim() || root.getPropertyValue(name).trim()
    if (value !== '') declarations.push(`${name}:${value}`)
  }
  return {
    tokens: `:root{${declarations.join(';')}}`,
    colorScheme: root.colorScheme || 'light dark',
  }
}

/** Fetch one standalone asset from the Host. */
async function fetchAsset(path: string): Promise<string> {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) throw new Error(`intelligent-ui export: ${path} returned ${String(response.status)}`)
  return response.text()
}

/** Hand one text document to the browser's download flow. */
async function downloadHtml(html: string, fileName: string): Promise<void> {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
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

/** Largest total data-URL text (characters, a conservative bound) inlined into one page. */
const MAX_INLINE_IMAGE_DATA_URL_CHARS = 32 * 1024 * 1024

/** Read one blob URL as a data URL so the exported page stays self-contained offline. */
async function blobUrlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('intelligent-ui export: a local image could not be re-read')
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('intelligent-ui export: a local image could not be encoded'))
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsDataURL(blob)
  })
}

/**
 * Collect every resolved local image in the live cards as a source→data-URL map.
 *
 * The exported page has no Host connection, so local images are inlined. The
 * live card marks each resolved local `<img>` with `data-iui-image-src`; only
 * blob-backed images are read back, while http(s) and data sources already
 * describe themselves.
 * @param container - the rendered card list.
 * @param allowedCallIds - cards that are actually exported; other cards' images
 *   (for example client-local revision cards) are not collected.
 * @returns card call id → source path → data URL, in first-seen order.
 */
export async function collectLocalImageAssets(
  container: HTMLElement,
  allowedCallIds?: ReadonlySet<string>,
): Promise<Record<string, Record<string, string>>> {
  const assets: Record<string, Record<string, string>> = Object.create(null) as Record<string, Record<string, string>>
  let total = 0
  for (const image of container.querySelectorAll<HTMLImageElement>('img[data-iui-image-src]')) {
    const source = image.dataset.iuiImageSrc
    if (source === undefined || source === '') continue
    const card = image.closest<HTMLElement>('[data-dsh-iui-call-id]')
    const callId = card?.dataset.dshIuiCallId ?? ''
    if (allowedCallIds !== undefined && !allowedCallIds.has(callId)) continue
    const url = image.currentSrc !== '' ? image.currentSrc : image.src
    if (!url.startsWith('blob:')) continue
    const bucket = assets[callId] ?? (Object.create(null) as Record<string, string>)
    assets[callId] = bucket
    if (typeof bucket[source] === 'string') continue
    const dataUrl = await blobUrlToDataUrl(url)
    total += dataUrl.length
    if (total > MAX_INLINE_IMAGE_DATA_URL_CHARS) throw new Error('intelligent-ui export: local images are too large to inline into one page')
    bucket[source] = dataUrl
  }
  return assets
}

/**
 * Build and download one standalone interactive HTML page.
 * @param options - cards, title and UI language.
 * @returns after the browser received the `.html` download.
 */
export async function exportCardsHtml(options: ExportPageOptions): Promise<void> {
  if (options.cards.length === 0) throw new Error('intelligent-ui export: no rendered answer')
  const [js, css] = await Promise.all([
    fetchAsset(EXPORT_STANDALONE_JS_PATH),
    fetchAsset(EXPORT_STANDALONE_CSS_PATH),
  ])
  const { tokens, colorScheme } = captureThemeTokens()
  // Local images are blob URLs created by this page; inline them before the
  // document is assembled so the downloaded file works offline.
  const container = options.trigger === undefined ? null : findCardsForAction(options.trigger)
  let assets: Record<string, Record<string, string>> = {}
  if (container !== null) {
    // Only local readers matter here; searches/remote loads are not inlined
    // and must not delay the page export.
    await settleLocalImages(container)
    const exportedCallIds = new Set(options.cards
      .map(card => card.callId ?? ''))
    assets = await collectLocalImageAssets(container, exportedCallIds)
  }
  const title = options.title !== undefined && options.title.trim() !== ''
    ? options.title
    : options.lang.toLowerCase().startsWith('zh') ? '交互页面' : 'Interactive page'
  const html = buildStandaloneHtml({ cards: options.cards, js, css, tokens, colorScheme, title, lang: options.lang, removeFollowUps: options.removeFollowUps, assets })
  await downloadHtml(html, pageFileName(options.title, new Date()))
}
