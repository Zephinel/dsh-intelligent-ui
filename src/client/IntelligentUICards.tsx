/**
 * Turn-tail cards for `render_ui` answers, plus the compact process row that
 * keeps the raw program out of the Tool list.
 *
 * Placement mirrors ui-plan / ui-deliverables: the plugin registers a
 * `conversation.chat.turnTail` list entry (session scope) whose inject factory
 * binds the Session's Chat target and reads the closing Turn's `tool-call`
 * nodes through the keyed `programs` hook. The slot owner passes the resolved
 * Turn location; components never see `ctx`.
 */
import { useCallback, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular, IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IntelligentUIProgram } from '../shared/intelligent-ui.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'
import { OpenUIRenderer } from '../lib/render.tsx'
import { programsFromToolNodes, type ToolCallNode } from './programs.ts'
import { RendererBoundary } from './RendererBoundary.tsx'

/** Session-bound, Turn-keyed program source supplied by the plugin's registration. */
export interface IntelligentUICardsInjected {
  readonly keyedHooks: {
    /**
     * The closing Turn's root Tool nodes in anchor order.
     * @param turn - resolved owning Turn as a string key.
     */
    readonly programs: (turn: string) => ObservableSnapshot<readonly ToolCallNode[]>
  }
}

/**
 * Render every `render_ui` program recorded by the closing Turn.
 * @param props - closing Turn, Session input actions, injected program hook, and locale seat.
 * @returns one card per program, or null for a Turn that called no render_ui tool.
 */
export function IntelligentUICards({
  turn, inputActions, usePrograms, t = fallbackT,
}: PropsRuntime<'conversation.chat.turnTail'>
  & InjectFace<IntelligentUICardsInjected>
  & { readonly t?: Translate }): ReactNode {
  const nodes = usePrograms(String(turn.turn))
  const programs = useMemo(() => programsFromToolNodes(nodes), [nodes])
  // The renderer calls this when an in-card action should continue in the
  // composer: seed the draft with the model-authored message and submit it.
  const toAssistant = useCallback((message: string): void => {
    const actions = inputActions as InputActions | undefined
    if (actions === undefined) return
    try {
      actions.setDraft(message)
      actions.submit()
    } catch (error) {
      console.warn('[intelligent-ui] could not start a follow-up message', error)
    }
  }, [inputActions])
  if (programs.length === 0) return null
  return (
    <div className="dsh-iui-cards" data-dsh-intelligent-ui-list>
      {programs.map(program => (
        <IntelligentUICard key={program.callId} program={program} onToAssistant={toAssistant} t={t} />
      ))}
    </div>
  )
}

interface IntelligentUICardProps {
  readonly program: IntelligentUIProgram
  readonly onToAssistant: (message: string) => void
  readonly t: Translate
}

/**
 * One full-width card: a native header with title and collapse control, and
 * the renderer body. The body never clips; the renderer owns horizontal
 * scrolling for wide tables and charts.
 * @param props - extracted program, the composer continuation callback, and the locale seat.
 * @returns the card.
 */
function IntelligentUICard({ program, onToAssistant, t }: IntelligentUICardProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const bodyId = useId()
  const title = program.title !== undefined && program.title.trim() !== '' ? program.title : t('card.title')
  const style = program.style === 'article' ? 'article' : 'card'
  return (
    <section
      className="dsh-iui-card"
      data-dsh-intelligent-ui="card"
      data-dsh-iui-call-id={program.callId}
      data-dsh-iui-style={style}
      data-dsh-iui-running={program.running ? 'true' : undefined}
      data-dsh-iui-collapsed={collapsed ? 'true' : undefined}
    >
      <button
        type="button"
        className="dsh-iui-header"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        onClick={() => { setCollapsed(value => !value) }}
      >
        <span className="dsh-iui-icon" aria-hidden="true"><IconSparkleRegular size={14} /></span>
        <span className="dsh-iui-title" data-dsh-iui-title>{title}</span>
        {program.running && <span className="dsh-iui-state">{t('state.rendering')}</span>}
        <span className="dsh-iui-chevron" aria-hidden="true"><IconChevronDownOutlineRegular size={14} /></span>
      </button>
      <div className="dsh-iui-body" data-dsh-iui-body id={bodyId} hidden={collapsed}>
        <RendererBoundary t={t}>
          <div className={style === 'article' ? 'dsh-iui-article' : undefined}>
            <OpenUIRenderer program={program.program} title={program.title} scopeId={program.callId} onToAssistant={onToAssistant} t={t} />
          </div>
        </RendererBoundary>
      </div>
    </section>
  )
}
