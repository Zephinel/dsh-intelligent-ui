/**
 * OpenUI Lang renderer for DSH.
 *
 * Renders one complete openui-lang program with the vendored Open Intelligent
 * UI component library and the platform React instance. The DSH client card
 * (`src/client`) wraps this in chat chrome: it owns the title, while this
 * component owns the program, the library's actions and every failure mode.
 *
 * A bad program must never break the chat: parse errors render as a compact
 * note, and an error boundary catches render-time crashes from the renderer or
 * from a component the model composed.
 */
import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  BuiltinActionType,
  Renderer,
  type ActionEvent,
  type OpenUIError,
} from '@openuidev/react-lang'
import { runLibraryAction } from './actions'
import { ArticleScope } from './components/article'
// Scoped upstream globals reset; must be evaluated before the library sheets.
import './components/reset.css'
import { webUrl } from './components/style'
import { blockEditLibrary, library, nestedEditLibrary } from './library'
import { I18nProvider, useT } from './i18n'
import { ImageSourceProvider } from './components/image-source.tsx'
import { fallbackT, type Translate } from '../shared/locales.ts'
import type { ImageSourceResolver } from '../shared/image-source.ts'
import { classifyDiagnostics } from './diagnostics.ts'

export interface OpenUIRendererProps {
  readonly program: string
  /** Optional controlled template tokens scoped to this renderer host. */
  readonly themeStyle?: CSSProperties
  readonly scheme?: 'light' | 'dark'
  readonly title?: string
  /** Stable card identity used to scope Section/Toc anchors across cards. */
  readonly scopeId?: string
  readonly onToAssistant?: (message: string) => void
  /** DSH locale seat; omitted in tests and standalone embeds (English copy). */
  readonly t?: Translate
  /** Render through the edit-mode library so internal block wrappers resolve. */
  readonly blockSlots?: boolean
  /**
   * Render through the nested edit-mode library (M4): every direct child of an
   * allowlisted container is wrapped in a nested `BlockSlot` with a stable path.
   * Defaults to false; when false the normal/top-level edit output is unchanged.
   */
  readonly nestedBlockSlots?: boolean
  /**
   * Initial renderer runtime state (`$state` values and form field snapshots).
   * Restored when a revision card remounts; omitted for the first render.
   */
  readonly runtimeState?: Record<string, unknown>
  /** Reports the renderer's latest runtime state so a host can snapshot it. */
  readonly onRuntimeStateChange?: (state: Record<string, unknown>) => void
  /**
   * Reads one local image path for `Image`/Markdown; absent in tests and plain
   * embeds, where local paths show an unavailable placeholder.
   */
  readonly resolveImage?: ImageSourceResolver
}

/** Open an @OpenUrl action, if the model wrote an http(s) URL. */
function openUrl(event: ActionEvent): void {
  const url = webUrl((event.params as { url?: unknown } | undefined)?.url)
  if (url === null) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Routes one action event: library actions (e.g. @CopyToClipboard) run in the
 * browser, @ToAssistant asks the host to start a follow-up turn, @OpenUrl opens
 * a safe link. Everything else is ignored.
 */
function handleAction(event: ActionEvent, onToAssistant?: (message: string) => void): void {
  const custom = runLibraryAction(event)
  if (custom) {
    void custom.catch(() => undefined)
    return
  }
  if (event.type === BuiltinActionType.ContinueConversation) {
    const message = typeof event.humanFriendlyMessage === 'string' ? event.humanFriendlyMessage.trim() : ''
    if (message) onToAssistant?.(message)
    return
  }
  if (event.type === BuiltinActionType.OpenUrl) openUrl(event)
}

/** Compact message for a program that could not be parsed or rendered. */
function ProgramFallback({ message, program }: { message: string; program: string }): ReactElement {
  const t = useT()
  return (
    <div className="dsh-iui-fallback" role="status">
      <p className="dsh-iui-fallback-title">{t('fallback.couldNotRender')}</p>
      {message.trim() !== '' && <p className="dsh-iui-fallback-message">{message}</p>}
      {program.trim() !== '' && (
        <details className="dsh-iui-fallback-details">
          <summary>{t('fallback.showProgram')}</summary>
          <pre>{program}</pre>
        </details>
      )}
    </div>
  )
}

/** Compact warning for a partly rendered program; keeps the usable page visible. */
function ProgramWarning({ messages }: { messages: readonly string[] }): ReactElement {
  const t = useT()
  return (
    <div className="dsh-iui-warning" role="status">
      <p className="dsh-iui-warning-title">{t('fallback.partial')}</p>
      <p className="dsh-iui-warning-message">{messages.join(' · ')}</p>
    </div>
  )
}

interface BoundaryProps {
  readonly program: string
  readonly children: ReactNode
}

/** Catches render/lifecycle errors from the renderer and the model's program. */
class RendererBoundary extends Component<BoundaryProps, { failure: string | null }> {
  override state: { failure: string | null } = { failure: null }

  static getDerivedStateFromError(error: unknown): { failure: string | null } {
    return { failure: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[intelligent-ui] renderer crashed', error, info.componentStack)
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    // A new program (e.g. the model retried) gets a fresh attempt.
    if (previous.program !== this.props.program && this.state.failure !== null) this.setState({ failure: null })
  }

  override render(): ReactNode {
    if (this.state.failure !== null) return <ProgramFallback message={this.state.failure} program={this.props.program} />
    return this.props.children
  }
}

/**
 * Renders a complete OpenUI Lang program. `title` is display chrome owned by
 * the DSH card, so it is accepted but not rendered here.
 */
export function OpenUIRenderer({ program, scopeId, onToAssistant, themeStyle, scheme, t = fallbackT, blockSlots = false, nestedBlockSlots = false, runtimeState, onRuntimeStateChange, resolveImage }: OpenUIRendererProps): ReactElement {
  const activeLibrary = nestedBlockSlots ? nestedEditLibrary : blockSlots ? blockEditLibrary : library
  // Scope diagnostics to their program so a retry or a revised card cannot
  // inherit stale errors; errors reported during the first render are kept.
  const [diagnostics, setDiagnostics] = useState<{ program: string; errors: OpenUIError[] }>({ program, errors: [] })
  const onError = useCallback((list: OpenUIError[]) => setDiagnostics({ program, errors: list }), [program])
  const errors = diagnostics.program === program ? diagnostics.errors : []
  // The parser is permissive: most diagnostics drop a subtree but still render
  // the rest. Only a missing/unparseable root replaces the page with a fallback;
  // recoverable issues keep the page and add a compact warning strip. Excess
  // positional args are dropped silently (they change nothing the user sees).
  const { fatal, warnings } = classifyDiagnostics(errors)
  const visible = [...fatal, ...warnings]
  const empty = program.trim() === ''
  // A parser can report no root at all (for example an unknown root component)
  // without emitting a no-root diagnostic. Scope the DOM probe to the current
  // program so a synchronous/early onError or a switch between programs cannot
  // prematurely unmount <Renderer> before the current program has been probed.
  const hostRef = useRef<HTMLDivElement>(null)
  const [probe, setProbe] = useState<{ program: string; measured: boolean; hasNodes: boolean }>({
    program,
    measured: false,
    hasNodes: false,
  })
  useLayoutEffect(() => {
    const hasNodes = hostRef.current?.querySelector('[class^="iui-"], [class*=" iui-"]') !== null
    setProbe((prev) => (prev.program === program && prev.measured && prev.hasNodes === hasNodes
      ? prev
      : { program, measured: true, hasNodes }))
  }, [program, diagnostics])
  const measuredCurrent = probe.program === program && probe.measured
  const fatalPage = fatal.length > 0 || (visible.length > 0 && measuredCurrent && !probe.hasNodes)

  return (
    <I18nProvider t={t}>
      <ImageSourceProvider resolver={resolveImage}>
      <ArticleScope.Provider value={scopeId}>
      <div ref={hostRef} className="dsh-iui-host dsh-iui-root" style={themeStyle} data-iui-scheme={scheme}>
        <RendererBoundary program={program}>
          {empty ? (
            <ProgramFallback message={t('fallback.noProgram')} program="" />
          ) : fatalPage ? (
            <ProgramFallback
              message={(fatal.length > 0 ? fatal : visible).map((error) => error.message).join(' · ')}
              program={program}
            />
          ) : (
            <>
              <Renderer
                key={program}
                response={program}
                library={activeLibrary}
                isStreaming={false}
                onAction={(event) => handleAction(event as ActionEvent, onToAssistant)}
                onError={onError}
                {...runtimeState === undefined ? {} : { initialState: runtimeState }}
                {...onRuntimeStateChange === undefined ? {} : { onStateUpdate: onRuntimeStateChange }}
              />
              {warnings.length > 0 && (
                <ProgramWarning messages={warnings.map((error) => error.message)} />
              )}
            </>
          )}
        </RendererBoundary>
      </div>
      </ArticleScope.Provider>
      </ImageSourceProvider>
    </I18nProvider>
  )
}
