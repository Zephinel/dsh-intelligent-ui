/**
 * Inline UI: renders one settled `openui` Markdown fence in place.
 *
 * The DSH chat renders each Markdown fence with a language + content through the
 * session-scoped `conversation.chat.markdown.fence` hoc slot. This layer owns the
 * `openui` language: while the fence streams, it keeps the plain code block (the
 * inner content), so a partial program is never parsed; once settled it replaces
 * the code block with the production OpenUI renderer, exactly as a card body
 * would render it, minus the card chrome.
 *
 * The layer document is not a turn-tail result: the program stays part of the
 * assistant Markdown, so copy, search and transcript export keep the source.
 */
import { useId, type ReactElement, type ReactNode } from 'react'
import { OpenUIRenderer } from '../lib/render.tsx'
import { fallbackT, type Translate } from '../shared/locales.ts'
import type { ImageSourceResolver } from '../shared/image-source.ts'
import { RendererBoundary } from './RendererBoundary.tsx'

/** Props of one fenced `openui` block, plus the plugin-injected identities. */
export interface InlineUIFenceProps {
  /** The complete program written inside the fence. */
  readonly code: string
  /** True while the assistant message is still streaming the fence. */
  readonly streaming?: boolean
  /** The plain code block supplied by the chat; shown while streaming. */
  readonly children?: ReactNode
  /** DSH locale seat; defaults to English when rendered outside a slot. */
  readonly t?: Translate
  /** Starts an assistant follow-up from an `@ToAssistant` action in the block. */
  readonly onToAssistant?: (message: string) => void
  /** Reads one local image path for `Image`/Markdown inside the block. */
  readonly resolveImage?: ImageSourceResolver
}

/**
 * Render the settled program, or the plain code block while streaming / empty.
 * @param props - fence content, locale seat and injected actions.
 * @returns the inline block, or the chat's code block while streaming.
 */
export function InlineUIFence({
  code, streaming = false, children, t = fallbackT, onToAssistant, resolveImage,
}: InlineUIFenceProps): ReactElement {
  // Scope each inline block's Section/Toc anchors so several fences in one
  // message cannot collide on generated DOM ids.
  const scopeId = useId()
  if (streaming) return <>{children}</>
  return (
    <div className="dsh-iui-inline-ui" data-dsh-intelligent-ui="inline-fence" data-dsh-iui-inline="true">
      <RendererBoundary t={t} resetKey={code}>
        <OpenUIRenderer
          program={code}
          scopeId={scopeId}
          onToAssistant={onToAssistant}
          t={t}
          resolveImage={resolveImage}
        />
      </RendererBoundary>
    </div>
  )
}
