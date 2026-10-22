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
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular, IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IntelligentUIProgram } from '../shared/intelligent-ui.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'
import { OpenUIRenderer } from '../lib/render.tsx'
import { resolveStyleThemeVars } from '../lib/style-theme.ts'
import type { StyleCatalog } from './styles.ts'
import { useStyleScheme } from './theme-mode.ts'
import { programsFromToolNodes, type ToolCallNode } from './programs.ts'
import { RendererBoundary } from './RendererBoundary.tsx'
import { fillComposer, type ComposerAccess } from './composer.ts'
import { SaveResultAction } from './SaveResultAction.tsx'
import { styleActions as defaultStyleActions, type StyleActions } from './style-actions.ts'

/** Session-bound, Turn-keyed program source supplied by the plugin's registration. */
export interface IntelligentUICardsInjected {
  readonly sessionId: string
  readonly styles: StyleCatalog
  readonly styleActions?: StyleActions
  readonly adjustStyle?: (program: IntelligentUIProgram) => Promise<string | null>
  readonly readInput?: ComposerAccess['readInput']
  readonly focusComposer?: ComposerAccess['focusComposer']
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
  turn, inputActions, usePrograms, sessionId, styles, styleActions = defaultStyleActions, adjustStyle, readInput, focusComposer, t = fallbackT,
}: PropsRuntime<'conversation.chat.turnTail'>
  & InjectFace<IntelligentUICardsInjected>
  & { readonly t?: Translate }): ReactNode {
  const nodes = usePrograms(String(turn.turn))
  const programs = useMemo(() => programsFromToolNodes(nodes), [nodes])
  const catalog = useSyncExternalStore(styles.subscribe, styles.getSnapshot, styles.getSnapshot)
  const scheme = useStyleScheme()
  useEffect(() => { void styles.ensure(sessionId) }, [styles, sessionId])
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
  const adjust = async (program: IntelligentUIProgram): Promise<string | null> => {
    const failure = await adjustStyle!(program)
    if (failure !== null) return t('onDemand.adjustError', { error: failure })
    const filled = inputActions !== undefined && readInput !== undefined
      && fillComposer(inputActions, readInput(), t('onDemand.adjustPrefix'), true)
    focusComposer?.()
    return filled ? null : t('onDemand.fillError')
  }
  if (programs.length === 0) return null
  return (
    <div className="dsh-iui-cards" data-dsh-intelligent-ui-list>
      {programs.map(program => {
        const template = program.styleId === undefined || catalog.status === 'unavailable' ? undefined
          : catalog.templates.find(template => template.id === program.styleId && (template.scope === 'global' || template.sessionId === sessionId))
        return (
          <IntelligentUICard
            key={program.callId}
            program={program}
            onToAssistant={toAssistant}
            t={t}
            scheme={scheme}
            onAdjust={adjustStyle === undefined ? undefined : adjust}
            saveAction={program.temporaryStyle === undefined ? undefined : <SaveResultAction resultId={program.callId}
              snapshot={program.temporaryStyle} sessionId={sessionId} actions={styleActions} styles={styles} disabled={program.running} t={t} />}
            themeStyle={program.temporaryStyle ? resolveStyleThemeVars(program.temporaryStyle.theme, scheme) as CSSProperties
              : template === undefined ? undefined : resolveStyleThemeVars(template.theme, scheme) as CSSProperties}
          />
        )
      })}
    </div>
  )
}

interface IntelligentUICardProps {
  readonly program: IntelligentUIProgram
  readonly onToAssistant: (message: string) => void
  readonly t: Translate
  readonly themeStyle?: CSSProperties
  readonly scheme: 'light' | 'dark'
  readonly onAdjust?: (program: IntelligentUIProgram) => Promise<string | null>
  readonly saveAction?: ReactNode
}

/**
 * One full-width card: a native header with title and collapse control, and
 * the renderer body. The body never clips; the renderer owns horizontal
 * scrolling for wide tables and charts.
 * @param props - extracted program, the composer continuation callback, and the locale seat.
 * @returns the card.
 */
function IntelligentUICard({ program, onToAssistant, t, themeStyle, scheme, onAdjust, saveAction }: IntelligentUICardProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const adjust = async (): Promise<void> => {
    if (onAdjust === undefined || adjusting) return
    setAdjusting(true)
    setError(null)
    try { setError(await onAdjust(program)) }
    catch (reason) { setError(t('onDemand.adjustError', { error: reason instanceof Error ? reason.message : String(reason) })) }
    finally { setAdjusting(false) }
  }
  const bodyId = useId()
  const title = program.title !== undefined && program.title.trim() !== '' ? program.title : t('card.title')
  const style = program.style === 'article' ? 'article' : 'card'
  return (
    <section
      className="dsh-iui-card"
      data-dsh-intelligent-ui="card"
      data-dsh-iui-call-id={program.callId}
      data-dsh-iui-style={style}
      data-dsh-iui-style-id={program.styleId}
      data-dsh-iui-temp-style={program.temporaryStyle ? 'true' : undefined}
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
        {program.temporaryStyle && <span className="dsh-iui-temporary-badge" title={program.temporaryStyle.suggestedName}>{t('onDemand.badge')}</span>}
        {program.running && <span className="dsh-iui-state">{t('state.rendering')}</span>}
        <span className="dsh-iui-chevron" aria-hidden="true"><IconChevronDownOutlineRegular size={14} /></span>
      </button>
      <div className="dsh-iui-body" data-dsh-iui-body id={bodyId} hidden={collapsed}>
        <RendererBoundary t={t}>
          <div className={style === 'article' ? 'dsh-iui-article' : undefined}>
            <OpenUIRenderer program={program.program} title={program.title} scopeId={program.callId} onToAssistant={onToAssistant} themeStyle={themeStyle} scheme={scheme} t={t} />
          </div>
        </RendererBoundary>
      </div>
      {program.temporaryStyle ? (
        <div className="dsh-iui-result-actions">
          {onAdjust === undefined ? null : <button type="button" disabled={adjusting || program.running} onClick={() => { void adjust() }}>{t('onDemand.adjust')}</button>}
          {saveAction}
          {error === null ? null : <span className="dsh-iui-style-error" role="alert">{error}</span>}
        </div>
      ) : null}
    </section>
  )
}
