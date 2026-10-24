/**
 * Pure HTML assembly for the single-file interactive page export.
 *
 * No DOM here: the browser export fetches the standalone script/stylesheet,
 * snapshots the current theme tokens, and this module turns those pieces plus
 * the recorded cards into one downloadable document. Unit tests load it
 * directly under Node.
 */
import type { ExportPageCard, IntelligentUIProgram } from '../shared/intelligent-ui.ts'
import { resolveStyleThemeVars } from '../lib/style-theme.ts'
import { fileStem } from './export-image-plan.ts'
import type { StyleTemplate } from '../shared/style-templates.ts'
import type { StyleCatalogSnapshot } from './styles.ts'

/** Resolve only templates the live cards would currently use; an unavailable catalog falls back to defaults. */
export function exportTemplatesFor(catalog: StyleCatalogSnapshot | undefined, sessionId?: string): readonly StyleTemplate[] {
  if (catalog === undefined || catalog.status === 'unavailable') return []
  return catalog.templates.filter(template => template.scope === 'global' || template.sessionId === sessionId)
}

/** Inline snapshots take priority; saved styles resolve from the visible catalog. */
export function programsToExportCards(programs: readonly IntelligentUIProgram[], scheme: 'light' | 'dark', templates: readonly StyleTemplate[] = []): ExportPageCard[] {
  return programs.map(program => {
    const theme = program.temporaryStyle?.theme ?? templates.find(template => template.id === program.styleId)?.theme
    return {
    program: program.program,
    title: program.title,
    style: program.style ?? 'card',
    callId: program.callId,
    ...theme === undefined ? {} : { themeStyle: resolveStyleThemeVars(theme, scheme), scheme },
  } })
}

/** Everything the standalone page needs, already fetched as text. */
export interface StandalonePageInput {
  /** The recorded cards, in render order. */
  readonly cards: readonly ExportPageCard[]
  /** Standalone renderer script served by the Host. */
  readonly js: string
  /** Standalone renderer stylesheet served by the Host. */
  readonly css: string
  /** Current theme's CSS custom properties, already wrapped in `:root{…}`. */
  readonly tokens: string
  /** `color-scheme` of the exporting DSH page. */
  readonly colorScheme: string
  /** Document title. */
  readonly title: string
  /** UI language for card chrome and the copy fallback. */
  readonly lang: string
  /** Whether the export removes the @ToAssistant follow-up block. */
  readonly removeFollowUps: boolean
}

/** Escape text for an HTML text node or quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** JSON embedded in a `<script>`; `<` is escaped so `</script>` cannot close it. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** Keep a closing script/style sequence from terminating its host element early. */
function inlineSafe(source: string, tag: 'script' | 'style'): string {
  return source.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`)
}

/**
 * Assemble one standalone HTML document.
 * @param input - cards, fetched assets, theme snapshot, and copy.
 * @returns the complete document text.
 */
export function buildStandaloneHtml(input: StandalonePageInput): string {
  const lang = /^[a-zA-Z-]{2,12}$/.test(input.lang) ? input.lang : 'en'
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${escapeHtml(input.colorScheme)}">
<meta name="generator" content="DSH Intelligent UI">
<title>${escapeHtml(input.title)}</title>
<style data-iui-theme>${inlineSafe(input.tokens, 'style')}</style>
<style data-iui-renderer>${inlineSafe(input.css, 'style')}</style>
</head>
<body>
<div id="iui-root"></div>
<script data-iui-renderer>${inlineSafe(input.js, 'script')}</script>
<script>window.mountIUI(document.getElementById("iui-root"), ${scriptJson(input.cards)}, {lang:${scriptJson(lang)}, hideToAssistant:${input.removeFollowUps ? 'true' : 'false'}});</script>
</body>
</html>
`
}

/** File name for one interactive-page download. */
export function pageFileName(title: string | undefined, when: Date): string {
  return `${fileStem(title)}-${[
    when.getFullYear(),
    String(when.getMonth() + 1).padStart(2, '0'),
    String(when.getDate()).padStart(2, '0'),
  ].join('')}-${[
    String(when.getHours()).padStart(2, '0'),
    String(when.getMinutes()).padStart(2, '0'),
    String(when.getSeconds()).padStart(2, '0'),
  ].join('')}.html`
}
