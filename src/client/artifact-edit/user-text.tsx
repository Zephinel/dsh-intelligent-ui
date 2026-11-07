/**
 * Sent-message projection of one Artifact edit request.
 *
 * The composer submit path replaces the chip with its model-facing envelope, so
 * the durable user message contains the full structured request. This rule
 * matches that envelope in the original message text and collapses it into one
 * compact chip, keeping the user's own supplement text around it readable.
 */
import { ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UserTextNodeProps, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ARTIFACT_EDIT_SUMMARY, nextEditRequestSummary } from '../../shared/artifact-edit.ts'
import type { NS } from '../../shared/locales.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    /** One collapsed Artifact edit envelope inside a sent user message. */
    'artifact-edit-summary': {
      readonly count: number
      readonly globalOnly: boolean
      readonly reordered: boolean
      readonly hasGlobal: boolean
      /** Natural-language style envelope: labelled first, never combined with block facts. */
      readonly style: boolean
    }
  }
}

/** Forward matcher: collapse the next complete edit envelope. */
export const artifactEditSummaryRule: UserTextRule<'artifact-edit-summary'> = {
  id: ARTIFACT_EDIT_SUMMARY,
  order: 60,
  match(text, from) {
    const range = nextEditRequestSummary(text, from)
    if (range === undefined) return undefined
    return {
      id: ARTIFACT_EDIT_SUMMARY,
      start: range.start,
      end: range.end,
      data: { count: range.count, globalOnly: range.globalOnly, reordered: range.reordered, hasGlobal: range.hasGlobal, style: range.style },
    }
  },
}

type SummaryProps = UserTextNodeProps<'artifact-edit-summary'> & PropsLocale<typeof NS>

/**
 * Render one collapsed edit envelope as a chip. Non-interactive: the message is
 * history, and a new edit starts from the latest card revision.
 * @param props - resolved node and locale seat.
 * @returns the compact chip.
 */
export function ArtifactEditSummary({ node, raw, t }: SummaryProps): React.ReactElement {
  const count = node.data.count
  const reordered = node.data.reordered === true
  if (node.data.style === true) return <ReferenceChip appearance="file" label={t('edit.chip.style')} title={raw} />
  let label = count > 0 && reordered
    ? t('edit.chip.mixed', { count })
    : count > 0
      ? t('edit.chip.edits', { count })
      : reordered
        ? t('edit.chip.order')
        : t('edit.chip.global')
  if (node.data.hasGlobal && (count > 0 || reordered)) label = `${label}${t('edit.chip.suffix')}`
  return <ReferenceChip appearance="file" label={label} title={raw} />
}
