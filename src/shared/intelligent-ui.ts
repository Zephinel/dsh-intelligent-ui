/**
 * Shared contract between the Host tool half and the browser renderer half.
 * No runtime code here beyond literal constants, so both faces can import it.
 */
import { isStyleId, type StyleId, type StyleSnapshot } from './style-templates.ts'

/** Tool name the model calls; the client card keys off this exact wire name. */
export const RENDER_UI_TOOL = 'render_ui'

/** Answer presentation style controlled by the plugin settings and the composer panel. */
export const ANSWER_STYLES = ['auto', 'card', 'article'] as const
/** Effective answer style: automatic choice, compact card, or reading article. */
export type AnswerStyle = (typeof ANSWER_STYLES)[number]

/** Concrete page styles the tool can record; `auto` is a session setting, not a page style. */
export const PAGE_STYLES = ['card', 'article'] as const
/** A concrete rendered page style. */
export type PageStyle = (typeof PAGE_STYLES)[number]

/** A session's enable override; `inherit` follows the deployment-wide switch. */
export const SESSION_ENABLES = ['inherit', 'on', 'off'] as const
/** Session switch value: follow the global switch, force on, or force off. */
export type SessionEnable = (typeof SESSION_ENABLES)[number]

/** A session's style override; `inherit` follows the global answer style. */
export type StylePreference = 'inherit' | StyleId

/** One interactive answer as recorded by the tool call arguments. */
export interface IntelligentUIProgram {
  /** Stable tool call identity (session event `callId`). */
  readonly callId: string
  /** Complete OpenUI Lang program. */
  readonly program: string
  /** Optional short title from the tool arguments. */
  readonly title?: string
  /** Presentation style recorded with the call; absent for older calls. */
  readonly style?: PageStyle
  /** Custom template recorded with the call, when selected by the session. */
  readonly styleId?: string
  /** Inline result-owned style; independent of the saved-template catalog. */
  readonly temporaryStyle?: StyleSnapshot
  readonly styleSource?: 'builtin' | 'template' | 'temporary'
  /** True while the call has started but its result has not landed. */
  readonly running: boolean
}

/** Parsed `render_ui` arguments. Kept loose because programs are model-authored. */
export interface RenderUiArgs {
  readonly program?: unknown
  readonly title?: unknown
  readonly style?: unknown
  readonly styleId?: unknown
  readonly temporaryStyle?: unknown
  readonly styleSource?: unknown
}

/** Slash-command name that switches the extension on/off or changes the session style. */
export const MODE_COMMAND = 'iui'

/** Host settings namespace (and profile entry id) serving this extension's preferences. */
export const HOST_ENTRY_ID = 'intelligent-ui'

/** npm package name of this bundle; keys its Plugin-detail configuration page. */
export const PACKAGE_NAME = '@zephinel/dsh-intelligent-ui'

/** Volatile boolean field controlling free composition in the Host settings document. */
export const FREE_COMPOSITION_FIELD = 'freeComposition'

/** Volatile boolean field enabling Intelligent UI in every session by default. */
export const GLOBAL_ENABLED_FIELD = 'globalEnabled'

/** Volatile string field with the deployment-wide default answer style. */
export const ANSWER_STYLE_FIELD = 'answerStyle'

/** Volatile string field with the image-export background color. */
export const EXPORT_BACKGROUND_FIELD = 'exportBackground'

/** Volatile enum field with the image-export pixel scale. */
export const EXPORT_SCALE_FIELD = 'exportScale'

/** Volatile boolean field controlling whether exports remove @ToAssistant follow-up blocks. */
export const EXPORT_REMOVE_FOLLOWUPS_FIELD = 'removeFollowUps'

/** Pixel scales an exported image can record. */
export const EXPORT_SCALES = ['1x', '2x'] as const

/** One image-export pixel scale. */
export type ExportScale = (typeof EXPORT_SCALES)[number]

/** Fallback background when the settings document provides none. */
export const DEFAULT_EXPORT_BACKGROUND = '#ffffff'

/** Curated backgrounds offered by the custom export color picker. */
export const EXPORT_BACKGROUND_PRESETS = [
  '#ffffff', '#f7f8fa', '#f1f5f9', '#e7edf5', '#eef4ff', '#f5f3ff',
  '#fef3c7', '#ecfdf5', '#fff1f2', '#111827', '#0f172a', '#1e293b',
] as const

/** The stored background must be a 6-digit hex colour. */
export const EXPORT_BACKGROUND_PATTERN = /^#[0-9a-f]{6}$/i

/** Fallback scale when the settings document provides none. */
export const DEFAULT_EXPORT_SCALE: ExportScale = '2x'

/** Fallback for the export follow-up-removal switch. */
export const DEFAULT_EXPORT_REMOVE_FOLLOWUPS = true

/** Same-origin route that serves the standalone renderer script for HTML export. */
export const EXPORT_STANDALONE_JS_PATH = '/api/intelligent-ui/export/standalone.js'

/** Same-origin route that serves the standalone renderer stylesheet. */
export const EXPORT_STANDALONE_CSS_PATH = '/api/intelligent-ui/export/standalone.css'

/** One rendered card carried into a standalone HTML export. */
export interface ExportPageCard {
  /** The complete OpenUI Lang program. */
  readonly program: string
  /** Display title shown by the card header. */
  readonly title?: string
  /** Recorded answer style. */
  readonly style?: 'card' | 'article'
  /** Stable identity used to scope article anchors across cards. */
  readonly callId?: string
  /** Resolved tokens for the exporting scheme, independent of a live catalog. */
  readonly themeStyle?: Record<string, string>
  readonly scheme?: 'light' | 'dark'
}

/** Beautification frames offered when exporting one rendered answer as an image. */
export const BEAUTIFY_STYLES = ['raw', 'rounded', 'card'] as const

/** One image beautification frame; chosen per export, not persisted. */
export type BeautifyStyle = (typeof BEAUTIFY_STYLES)[number]

/** Image-export preferences resolved from the Host settings document. */
export interface ImageExportSettings {
  /** Canvas background behind the answer. */
  readonly background: string
  /** Output pixel scale. */
  readonly scale: ExportScale
  /** Whether exports remove the whole @ToAssistant follow-up block. */
  readonly removeFollowUps: boolean
}

/** Wire shape of this extension's settings namespace. */
export interface IntelligentUISettings {
  /** Whether the design playbook is advisory instead of a template. */
  readonly freeComposition?: boolean
  /** Whether every session starts enabled; a session override still wins. */
  readonly globalEnabled?: boolean
  /** Deployment-wide default answer style; a session override still wins. */
  readonly answerStyle?: StyleId
  /** Background color for exported images. */
  readonly exportBackground?: string
  /** Pixel scale for exported images. */
  readonly exportScale?: ExportScale
  /** Whether exports remove the whole @ToAssistant follow-up block. */
  readonly removeFollowUps?: boolean
  /** Legacy keep/remove switch from before the setting was inverted. */
  readonly exportToAssistant?: boolean
}

/** Type guard for a settings-provided export background. */
export function isExportBackground(value: unknown): value is string {
  return typeof value === 'string' && EXPORT_BACKGROUND_PATTERN.test(value)
}

/** Type guard for a settings-provided export scale. */
export function isExportScale(value: unknown): value is ExportScale {
  return value === '1x' || value === '2x'
}

/**
 * Resolve the image-export preferences from one settings snapshot.
 * @param settings - last accepted Host settings section, when available.
 * @returns valid stored values with defaults for everything else.
 */
/** Migrate the old keep/remove field without surprising an explicit choice. */
function readRemoveFollowUps(settings: IntelligentUISettings | undefined): boolean {
  if (settings?.removeFollowUps !== undefined) return settings.removeFollowUps
  if (settings?.exportToAssistant !== undefined) return !settings.exportToAssistant
  return true
}

export function readImageExportSettings(settings: IntelligentUISettings | undefined): ImageExportSettings {
  return {
    background: isExportBackground(settings?.exportBackground) ? settings.exportBackground : DEFAULT_EXPORT_BACKGROUND,
    scale: isExportScale(settings?.exportScale) ? settings.exportScale : DEFAULT_EXPORT_SCALE,
    removeFollowUps: readRemoveFollowUps(settings),
  }
}

/** Host session-projection key carrying the per-session switch and style state. */
export const MODE_PROJECTION_KEY = 'intelligent-ui'

/** Wire view of the `intelligent-ui` session projection. */
export interface IntelligentUIModeView {
  /** This session's enable override. */
  readonly sessionEnable: SessionEnable
  /** This session's style override. */
  readonly sessionStyle: StylePreference
  /** Deployment-wide enable switch. */
  readonly globalEnabled: boolean
  /** Deployment-wide default answer style. */
  readonly globalStyle: StyleId
  /** Effective enable state after applying the session override. */
  readonly enabled: boolean
  /** Effective answer style after applying the session override. */
  readonly style: StyleId
  /** Whether a switch/style command is still waiting for its result. */
  readonly pending: boolean
  readonly onDemand: OnDemandView | null
}

/** Small, transient projection of the latest operation; never part of settings. */
export interface OnDemandView {
  readonly kind: 'generate' | 'adjust'
  readonly parentResultId?: string
  readonly status: 'armed' | 'running' | 'clarifying' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  readonly operationId: string
  readonly clientInstanceId?: string
  readonly resultIds: readonly string[]
  /** Armed again after a text-only turn (usually a request for missing content). */
  readonly resume?: boolean
}

/** One pending `/iui` command in the projection fold. */
export interface IntelligentUIModeRunning {
  readonly commandId: string
  readonly kind: 'scope' | 'style' | 'on-demand'
}

/** One fold state of the switch command lifecycle for one session. */
export interface IntelligentUIModeState {
  /** Session this projection belongs to (from the projection init header). */
  readonly sessionId: string
  /** Command currently being folded, if any. */
  readonly command?: IntelligentUIModeRunning | null
}

/** Type guard for a persisted or model-provided answer style. */
export function isAnswerStyle(value: unknown): value is AnswerStyle {
  return value === 'auto' || value === 'card' || value === 'article'
}

/** Type guard for a concrete rendered page style. */
export function isPageStyle(value: unknown): value is PageStyle {
  return value === 'card' || value === 'article'
}

/** Type guard for a session style preference. */
export function isStylePreference(value: unknown): value is StylePreference {
  return value === 'inherit' || isStyleId(value)
}
