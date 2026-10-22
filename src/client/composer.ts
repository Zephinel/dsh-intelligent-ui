/** Public DSH draft actions only: preserve text, reference chips, selection and undo. */
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'

export interface ComposerAccess {
  readonly readInput: () => InputState
  readonly focusComposer: () => void
}

export function fillComposer(
  actions: Pick<InputActions, 'captureInsertion' | 'insertText'>,
  state: Pick<InputState, 'draft' | 'draftRev' | 'phase' | 'occurrences'>,
  text: string,
  onlyIfEmpty = false,
): boolean {
  if (state.phase !== 'plain') return false
  if (onlyIfEmpty && state.draft !== '') return true
  const span = actions.captureInsertion()
  if (span.draftRev !== state.draftRev) return false
  // DSH detect coordinates count each atomic reference chip as one character.
  const end = state.draft.length - state.occurrences.reduce((sum, ref) => sum + ref.length - 1, 0)
  return actions.insertText(`${state.draft === '' || /\s$/.test(state.draft) ? '' : '\n'}${text}`, { ...span, start: end, end })
}
