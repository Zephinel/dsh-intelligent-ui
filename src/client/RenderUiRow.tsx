/**
 * Compact process row for `render_ui` calls. The program itself renders in the
 * closing Turn's turn-tail card, so this row shows only title and state and
 * never dumps the raw arguments into the Tool list.
 *
 * A failed call also surfaces one short readable line beside the state so the
 * user can tell why the render failed without expanding anything. The detail
 * comes from the recorded result text or the structured error, never from the
 * call arguments, and is clipped to a single line.
 */
import type { ReactElement } from 'react'
import { DisclosureRow, IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { fallbackT, type Translate } from '../shared/locales.ts'

/** Non-expandable rows still receive the shared disclosure callback. */
const NOOP = (): void => undefined

/** Row lifecycle copy keys, matching the call phases. */
const STATE_KEY = {
  preparing: 'state.preparing',
  running: 'state.rendering',
  ready: 'state.ready',
  error: 'state.error',
} as const

type RowState = keyof typeof STATE_KEY

/** Longest error detail kept in the collapsed row, in characters. */
const ERROR_DETAIL_LIMIT = 160

/** Props: the shared tool-call view plus the slot's locale seat. */
type RenderUiRowProps = ToolCallViewProps & { readonly t?: Translate }

/** The settled result block of a failed or successful call. */
type ResultBlock = Extract<ToolCallViewProps, { readonly phase: 'result' }>['block']

/** Collapse whitespace and clip one detail to a single short line. */
function clipErrorDetail(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= ERROR_DETAIL_LIMIT ? line : `${line.slice(0, ERROR_DETAIL_LIMIT - 1)}…`
}

/**
 * Read one short readable failure detail from a settled error result.
 * Prefers the recorded result text (the Host's model-readable error), then the
 * structured error reason, then its `name: code`; the call arguments are never
 * read, so a program or its JSON cannot leak into the row.
 * @param block - settled tool result.
 * @returns one clipped line, or an empty string when the result has no message.
 */
function errorDetail(block: ResultBlock): string {
  const parts: string[] = []
  for (const part of block.content) if (part.type === 'text') parts.push(part.text)
  const content = parts.join(' ').trim()
  if (content !== '') return clipErrorDetail(content)
  const reason = block.error?.reason?.trim() ?? ''
  if (reason !== '') return clipErrorDetail(reason)
  if (block.error !== undefined) return clipErrorDetail(`${block.error.name}: ${block.error.code}`)
  return ''
}

/** Derive the row state from the tool lifecycle stage. */
function stateOf(props: ToolCallViewProps): RowState {
  switch (props.phase) {
    case 'preparing': return 'preparing'
    case 'start': return 'running'
    case 'result': return props.block.isError ? 'error' : 'ready'
  }
}

/**
 * Render one `render_ui` call as a native 24px process row.
 * @param props - tool lifecycle stage, call data, and locale seat.
 * @returns the compact row.
 */
export function RenderUiRow({ t = fallbackT, ...props }: RenderUiRowProps): ReactElement {
  const view = props as ToolCallViewProps
  const state = stateOf(view)
  const busy = state === 'preparing' || state === 'running'
  const detail = view.phase === 'result' && view.block.isError ? errorDetail(view.block) : ''
  return (
    <div data-dsh-iui-toolview data-state={state}>
      <DisclosureRow
        title={t('card.title')}
        icon={<IconSparkleRegular size={14} />}
        open={false}
        expandable={false}
        previewChevron={false}
        running={busy}
        onToggle={NOOP}
        collapsedContent={(
          <span className="dsh-iui-row-state">
            {t(STATE_KEY[state])}
            {detail === '' ? null : (
              <span
                className="dsh-iui-row-detail"
                data-dsh-iui-row-error
                title={detail}
                style={{
                  display: 'inline-block',
                  maxWidth: 'min(360px, 48vw)',
                  marginLeft: 6,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  verticalAlign: 'bottom',
                  whiteSpace: 'nowrap',
                }}
              >
                · {detail}
              </span>
            )}
          </span>
        )}
      />
    </div>
  )
}
