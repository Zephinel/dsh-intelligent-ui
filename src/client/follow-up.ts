/**
 * One composer follow-up path shared by turn-tail cards and inline fences.
 *
 * DSH code supplied by the slot is opaque: a stale binding or a closed window
 * can throw synchronously. The follow-up is best-effort, so report it without
 * taking down the rendered page.
 */

/** The two composer operations a follow-up needs from any DSH input handle. */
export interface FollowUpActions {
  setDraft(message: string): unknown
  submit(): unknown
}

/** Seed the composer with a model-authored message and submit it once. */
export function startFollowUp(actions: FollowUpActions | undefined, message: string): void {
  if (actions === undefined) return
  try {
    actions.setDraft(message)
    actions.submit()
  } catch (error) {
    console.warn('[intelligent-ui] could not start a follow-up message', error)
  }
}
