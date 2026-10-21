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

/** Options for exporting the current answer as an interactive page. */
export interface ExportPageOptions {
  /** Recorded cards to embed, in render order. */
  readonly cards: readonly ExportPageCard[]
  /** Answer title; also the page title and file-name stem. */
  readonly title?: string | undefined
  /** UI language for the standalone card chrome. */
  readonly lang: string
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
  const title = options.title !== undefined && options.title.trim() !== ''
    ? options.title
    : options.lang.toLowerCase().startsWith('zh') ? '交互页面' : 'Interactive page'
  const html = buildStandaloneHtml({ cards: options.cards, js, css, tokens, colorScheme, title, lang: options.lang })
  await downloadHtml(html, pageFileName(options.title, new Date()))
}
