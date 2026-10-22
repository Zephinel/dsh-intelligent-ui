/**
 * Export-page visibility for assistant follow-up actions.
 *
 * A standalone HTML page cannot start a DSH turn, so the exporter normally
 * degrades `@ToAssistant` to "copy the message and paste it back". The export
 * setting can instead remove those controls; this context lets the shared
 * component library hide only the controls that would send a message to the
 * assistant, without changing normal DSH rendering.
 */
import { createContext, useContext } from 'react'

/** True while a page is exported without follow-up controls. */
export const ToAssistantHiddenContext = createContext(false)

/** Whether one evaluated action plan contains a continue-conversation step. */
export function hasToAssistant(plan: unknown): boolean {
  if (plan === null || typeof plan !== 'object') return false
  const steps = (plan as { steps?: unknown }).steps
  if (!Array.isArray(steps)) return false
  return steps.some(step => step !== null && typeof step === 'object'
    && (step as { type?: unknown }).type === 'continue_conversation')
}

/**
 * Decide whether a control should be omitted from the exported page.
 * @param plan - evaluated action plan; undefined for a bare button label.
 * @param implicit - true for buttons where no action means "send the label".
 * @returns true when the control would only continue the conversation.
 */
export function useHideToAssistant(plan: unknown, implicit = false): boolean {
  const hidden = useContext(ToAssistantHiddenContext)
  return hidden && (implicit || hasToAssistant(plan))
}
