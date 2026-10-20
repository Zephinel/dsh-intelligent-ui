/**
 * Compact process row for `render_ui` calls. The program itself renders in the
 * closing Turn's turn-tail card, so this row shows only title and state and
 * never dumps the raw arguments into the Tool list.
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

/** Props: the shared tool-call view plus the slot's locale seat. */
type RenderUiRowProps = ToolCallViewProps & { readonly t?: Translate }

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
  const state = stateOf(props as ToolCallViewProps)
  const busy = state === 'preparing' || state === 'running'
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
        collapsedContent={<span className="dsh-iui-row-state">{t(STATE_KEY[state])}</span>}
      />
    </div>
  )
}
