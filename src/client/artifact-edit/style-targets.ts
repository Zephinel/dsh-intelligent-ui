/**
 * Pure style-switch eligibility rules for the edit panel.
 *
 * The UI uses `styleTargetDisableReason` to gray out targets the Host would
 * reject, and `styleSwitchBlocker` to explain the one reason Apply is disabled.
 * The store keeps its own request-time safety guards; keeping these calculations
 * pure lets the panel be unit-tested without React.
 */
import type { ArtifactStyleTargetOption } from './contracts.ts'

/** Why one target row is not selectable. */
export type StyleTargetDisableReason = 'article'

/** The one visible reason Apply is unavailable; `undefined` means ready. */
export type StyleSwitchBlocker = 'checking' | 'stale' | 'dirty' | 'instruction' | 'no_target' | 'unavailable' | 'current' | 'busy'

/**
 * Whether one target row must be disabled before selection.
 * @param option - resolved target option.
 * @param articleProblem - Host article predicate result for the current program.
 * @returns the disable reason, or undefined when the option is selectable.
 */
export function styleTargetDisableReason(
  option: ArtifactStyleTargetOption,
  articleProblem: string | undefined,
): StyleTargetDisableReason | undefined {
  return option.requiresArticleLayout === true && articleProblem !== undefined ? 'article' : undefined
}

/** Facts used to decide why Apply is unavailable. */
export interface StyleSwitchBlockerInput {
  readonly status: 'checking' | 'ready' | 'conflict' | 'submitted' | 'error'
  readonly branch: boolean
  readonly busy: boolean
  readonly hasTarget: boolean
  readonly targetDisabled: boolean
  readonly current: boolean
  readonly dirty: boolean
  readonly instruction: boolean
}

/**
 * Return the highest-priority reason Apply is unavailable.
 * @param input - edit-session facts.
 * @returns the blocker, or undefined when Apply may run.
 */
export function styleSwitchBlocker(input: StyleSwitchBlockerInput): StyleSwitchBlocker | undefined {
  if (input.status === 'checking') return 'checking'
  if (input.status === 'conflict' && !input.branch) return 'stale'
  if (input.busy) return 'busy'
  if (input.dirty) return 'dirty'
  if (input.instruction) return 'instruction'
  if (!input.hasTarget) return 'no_target'
  if (input.targetDisabled) return 'unavailable'
  if (input.current) return 'current'
  return undefined
}
