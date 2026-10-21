/**
 * Shared contract between the Host tool half and the browser renderer half.
 * No runtime code here beyond literal constants, so both faces can import it.
 */

/** Tool name the model calls; the client card keys off this exact wire name. */
export const RENDER_UI_TOOL = 'render_ui'

/** One interactive answer as recorded by the tool call arguments. */
export interface IntelligentUIProgram {
  /** Stable tool call identity (session event `callId`). */
  readonly callId: string
  /** Complete OpenUI Lang program. */
  readonly program: string
  /** Optional short title from the tool arguments. */
  readonly title?: string
  /** True while the call has started but its result has not landed. */
  readonly running: boolean
}

/** Parsed `render_ui` arguments. Kept loose because programs are model-authored. */
export interface RenderUiArgs {
  readonly program?: unknown
  readonly title?: unknown
}

/** Slash-command name that switches the extension on or off for one session. */
export const MODE_COMMAND = 'iui'

/** Host settings namespace (and profile entry id) serving this extension's preferences. */
export const HOST_ENTRY_ID = 'intelligent-ui'

/** Volatile boolean field controlling free composition in the Host settings document. */
export const FREE_COMPOSITION_FIELD = 'freeComposition'

/** Wire shape of this extension's settings namespace. */
export interface IntelligentUISettings {
  /** Whether the design playbook is advisory instead of a template. */
  readonly freeComposition?: boolean
}

/** Host session-projection key carrying the per-session switch state. */
export const MODE_PROJECTION_KEY = 'intelligent-ui'

/** Three mutually exclusive scopes of the switch. */
export type IntelligentUIScope = 'off' | 'session' | 'global'

/** Wire view of the `intelligent-ui` session projection. */
export interface IntelligentUIModeView {
  /** Effective scope for the viewed session. */
  readonly mode: IntelligentUIScope
  /** Whether a switch is still waiting for its command to settle. */
  readonly pending: boolean
}

/** One fold state of the switch command lifecycle for one session. */
export interface IntelligentUIModeState {
  /** Session this projection belongs to (from the projection init header). */
  readonly sessionId: string
  /** Command currently being folded, if any. */
  readonly running: { readonly commandId: string; readonly scope: IntelligentUIScope } | null
}
