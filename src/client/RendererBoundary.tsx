/**
 * Local error boundary around the OpenUI renderer.
 *
 * A model-authored program or a renderer bug must never take down the Chat
 * row: this catches the crash inside the card body and renders a compact
 * status line instead. The plugin's host half validates programs before the
 * tool succeeds, so a render-time crash here is exceptional.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { fallbackT, type Translate } from '../shared/locales.ts'

interface RendererBoundaryProps {
  readonly children: ReactNode
  /** Locale seat supplied by the Turn-tail card; English outside a slot. */
  readonly t?: Translate
}

interface RendererBoundaryState {
  readonly failed: boolean
}

/** Contain renderer failures to one card body. */
export class RendererBoundary extends Component<RendererBoundaryProps, RendererBoundaryState> {
  state: RendererBoundaryState = { failed: false }

  /** Switch to the fallback on the next render. */
  static getDerivedStateFromError(): RendererBoundaryState {
    return { failed: true }
  }

  /** Report the crash for diagnosis without rethrowing into the Chat tree. */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[intelligent-ui] renderer failed', error, info.componentStack)
  }

  /** Render the card body, or the compact fallback after a crash. */
  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    const t = this.props.t ?? fallbackT
    return (
      <p className="dsh-iui-error" data-dsh-iui-error role="status">
        {t('card.failed')}
      </p>
    )
  }
}
