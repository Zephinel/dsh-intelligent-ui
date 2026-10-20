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
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useState,
} from 'react'
import {
  BuiltinActionType,
  Renderer,
  type ActionEvent,
  type OpenUIError,
} from '@openuidev/react-lang'
import { runLibraryAction } from './actions'
// Scoped upstream globals reset; must be evaluated before the library sheets.
import './components/reset.css'
import { webUrl } from './components/style'
import { library } from './library'
import { I18nProvider, useT } from './i18n'
import { fallbackT, type Translate } from '../shared/locales.ts'

export interface OpenUIRendererProps {
  readonly program: string
  readonly title?: string
  readonly onToAssistant?: (message: string) => void
  /** DSH locale seat; omitted in tests and standalone embeds (English copy). */
  readonly t?: Translate
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

interface BoundaryProps {
  readonly program: string
  readonly children: ReactNode
}

/** Catches render/lifecycle errors from the renderer and the model's program. */
class RendererBoundary extends Component<BoundaryProps, { failure: string | null }> {
  state: { failure: string | null } = { failure: null }

  static getDerivedStateFromError(error: unknown): { failure: string | null } {
    return { failure: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[intelligent-ui] renderer crashed', error, info.componentStack)
  }

  componentDidUpdate(previous: BoundaryProps): void {
    // A new program (e.g. the model retried) gets a fresh attempt.
    if (previous.program !== this.props.program && this.state.failure !== null) this.setState({ failure: null })
  }

  render(): ReactNode {
    if (this.state.failure !== null) return <ProgramFallback message={this.state.failure} program={this.props.program} />
    return this.props.children
  }
}

/**
 * Renders a complete OpenUI Lang program. `title` is display chrome owned by
 * the DSH card, so it is accepted but not rendered here.
 */
export function OpenUIRenderer({ program, onToAssistant, t = fallbackT }: OpenUIRendererProps): ReactElement {
  const [errors, setErrors] = useState<OpenUIError[]>([])
  const onError = useCallback((list: OpenUIError[]) => setErrors(list), [])
  // Warnings still render; only real errors get the fallback note.
  const fatal = errors.filter((error) => error.severity !== 'warning')
  const empty = program.trim() === ''

  return (
    <I18nProvider t={t}>
      <div className="dsh-iui-host dsh-iui-root">
        <RendererBoundary program={program}>
          {empty ? (
            <ProgramFallback message={t('fallback.noProgram')} program="" />
          ) : (
            <>
              <Renderer
                response={program}
                library={library}
                isStreaming={false}
                onAction={(event) => handleAction(event as ActionEvent, onToAssistant)}
                onError={onError}
              />
              {fatal.length > 0 && (
                <ProgramFallback
                  message={fatal.map((error) => error.message).join(' · ')}
                  program={program}
                />
              )}
            </>
          )}
        </RendererBoundary>
      </div>
    </I18nProvider>
  )
}
