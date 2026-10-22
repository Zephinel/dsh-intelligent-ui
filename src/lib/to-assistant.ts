/**
 * Mark controls that would continue the conversation.
 *
 * The standalone page and the image capture hide the whole block containing
 * such a control when the export setting opts out of follow-ups. The data
 * attribute is always written, so the exporter can apply one CSS rule to both
 * the live card DOM and the exported document.
 */

/** Whether one evaluated action plan contains a continue-conversation step. */
export function hasToAssistant(plan: unknown): boolean {
  if (plan === null || typeof plan !== 'object') return false
  const steps = (plan as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return false
  return steps.some(step => step !== null && typeof step === 'object'
    && (step as { type?: unknown }).type === 'continue_conversation')
}

/**
 * Whether a control should carry the follow-up marker.
 * @param plan - evaluated action plan; undefined for a bare button label.
 * @param implicit - true for buttons where no action means "send the label".
 * @returns true when activating the control would continue the conversation.
 */
export function isToAssistantControl(plan: unknown, implicit = false): boolean {
  // A bare button sends its label; a button with any action only follows up
  // when that plan actually contains a continue-conversation step.
  if (plan === null || plan === undefined) return implicit
  return hasToAssistant(plan)
}

/** Attribute applied to a block that contains only follow-up controls. */
export const FOLLOWUP_HIDDEN_ATTRIBUTE = 'data-iui-followup-hidden'

/** Find the semantic block that should disappear with one follow-up control. */
function followUpBlock(control: HTMLElement, container: HTMLElement): HTMLElement {
  // Prefer the whole card even when the button sits in a Row or Pressable
  // inside it. Then fall back to the smallest semantic group, never crossing
  // the export container (which may be a card body or the page root).
  const card = control.closest<HTMLElement>('.iui-card')
  if (card !== null && container.contains(card)) return card
  const group = control.closest<HTMLElement>('.iui-form, .iui-carousel-item, .iui-pressable, .iui-row')
  if (group !== null && container.contains(group)) return group
  // No semantic group: hide the control alone. Hiding a layout column/root
  // here would erase legitimate prose next to the follow-up.
  return control
}

/**
 * Hide blocks containing a control that would continue the conversation.
 *
 * Used by the standalone page and by the image capture; returns a restore
 * function so the live DSH DOM is never left modified after a capture.
 * @param container - card list or exported page root.
 * @returns an idempotent restore function.
 */
export function hideToAssistantBlocks(container: HTMLElement): () => void {
  // A standalone page can re-render a previously hidden row into content that
  // no longer follows up. Clear stale marks before recomputing so the mutation
  // observer never leaves legitimate content hidden.
  for (const marked of container.querySelectorAll<HTMLElement>(`[${FOLLOWUP_HIDDEN_ATTRIBUTE}]`)) {
    marked.removeAttribute(FOLLOWUP_HIDDEN_ATTRIBUTE)
  }
  const hidden: HTMLElement[] = []
  for (const control of container.querySelectorAll<HTMLElement>('[data-iui-to-assistant="true"]')) {
    const block = followUpBlock(control, container)
    if (block === container || !container.contains(block) || block.hasAttribute(FOLLOWUP_HIDDEN_ATTRIBUTE)) continue
    block.setAttribute(FOLLOWUP_HIDDEN_ATTRIBUTE, 'true')
    hidden.push(block)
  }
  return () => {
    for (const block of hidden) block.removeAttribute(FOLLOWUP_HIDDEN_ATTRIBUTE)
  }
}
