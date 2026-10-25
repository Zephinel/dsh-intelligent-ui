/**
 * Mark controls that would continue the conversation.
 *
 * The standalone page and the image capture hide the follow-up control when the
 * export setting opts out of follow-ups. The data attribute is always written,
 * so the exporter can apply one CSS rule to both the live card DOM and the
 * exported document.
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

/** Attribute applied to a block that hides with a follow-up control. */
export const FOLLOWUP_HIDDEN_ATTRIBUTE = 'data-iui-followup-hidden'

const TEXT_NODE = 3
const ELEMENT_NODE = 1

/**
 * Layout wrappers: hiding one of these removes no content of its own, so the
 * follow-up unit may grow through them. Kept to the renderer's own blocks; the
 * card-list containers are deliberately absent so a page/list is never hidden.
 */
const WRAPPER_CLASSES = new Set([
  'iui-flow', 'iui-row', 'iui-col', 'iui-box', 'iui-card', 'iui-form', 'iui-grid',
  'iui-carousel', 'iui-carousel-track', 'iui-carousel-item', 'iui-pressable',
  'iui-list', 'iui-list-body', 'iui-list-children',
  'iui-section', 'iui-section-body', 'iui-toc',
  'dsh-iui-body', 'dsh-iui-article', 'dsh-iui-host', 'dsh-iui-root',
  'dsh-iui-card', 'dsh-iui-standalone-card',
])

/**
 * Form-field chrome: fields and their labels exist to compose the follow-up
 * message, so they are part of the follow-up unit rather than page content.
 * Skipped entire, so a labeled field's text does not keep a dead form visible.
 */
const FORM_CHROME_CLASSES = new Set([
  'iui-field', 'iui-input', 'iui-textarea', 'iui-select',
  'iui-check', 'iui-choice', 'iui-choice-text', 'iui-choice-description',
  'iui-radio-group', 'iui-segmented', 'iui-slider', 'iui-slider-head',
  'iui-slider-marks', 'iui-range', 'iui-date',
])
const FORM_CHROME_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'LABEL', 'FIELDSET', 'LEGEND'])

/** Decorative blocks that carry no content; safe to hide with the control. */
const DECORATION_CLASSES = new Set(['iui-spacer', 'iui-divider'])

function isFollowUpControl(element: Element): boolean {
  return element.getAttribute('data-iui-to-assistant') === 'true'
}

function isFormChrome(element: Element): boolean {
  if (FORM_CHROME_TAGS.has(element.tagName)) return true
  for (const token of FORM_CHROME_CLASSES) if (element.classList.contains(token)) return true
  return false
}

function isDecoration(element: Element): boolean {
  for (const token of DECORATION_CLASSES) if (element.classList.contains(token)) return true
  return false
}

function isWrapper(element: Element): boolean {
  for (const token of WRAPPER_CLASSES) if (element.classList.contains(token)) return true
  return false
}

/**
 * Whether a subtree contains anything the reader should still see once
 * follow-up controls and field chrome are gone. Unknown elements count as
 * content: the pass errs toward keeping content, never toward deleting it.
 * @param parent - element whose children are scanned.
 * @param excluded - the candidate unit, already accounted for (may be null).
 * @returns true when visible content exists outside the candidate.
 */
function hasContentOutside(parent: Element, excluded: Element | null): boolean {
  for (const node of Array.from(parent.childNodes)) {
    if (node === excluded) continue
    if (node.nodeType === TEXT_NODE) {
      if ((node.textContent ?? '').trim() !== '') return true
      continue
    }
    if (node.nodeType !== ELEMENT_NODE) continue
    const element = node as Element
    if (isFollowUpControl(element)) continue
    if (isFormChrome(element) || isDecoration(element)) continue
    if (isWrapper(element)) {
      if (hasContentOutside(element, null)) return true
      continue
    }
    return true
  }
  return false
}

/** Nearest card-list container around one control, or the export container. */
function boundaryFor(control: Element, container: Element): Element {
  let node: Element | null = control.parentElement
  while (node !== null) {
    if (node === container) return container
    if (node.hasAttribute('data-dsh-intelligent-ui-list')) return node
    node = node.parentElement
  }
  return container
}

/**
 * Grow the hidden unit from the control through wrappers and field chrome, and
 * stop at the first ancestor that also carries content. A Card with prose keeps
 * the prose; a Card that is only a follow-up disappears whole.
 * @param control - the marked follow-up control.
 * @param container - export container (card list or document body).
 * @param boundary - card-list boundary that must never be hidden.
 * @returns the element to hide.
 */
function followUpBlock(control: HTMLElement, container: HTMLElement, boundary: Element): HTMLElement {
  let candidate = control
  for (;;) {
    const parent = candidate.parentElement
    if (parent === null || parent === container || parent === boundary || !container.contains(parent)) break
    if (hasContentOutside(parent, candidate)) break
    candidate = parent as HTMLElement
  }
  return candidate
}

/**
 * Hide follow-up controls for an export.
 *
 * Only the control and the smallest wrappers that exist solely for it are
 * hidden; a Card (or Form) that also carries readable content keeps that
 * content, and one that is only a follow-up block disappears whole. Used by the
 * standalone page and by the image capture; returns a restore function so the
 * live DSH DOM is never left modified after a capture.
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
    const boundary = boundaryFor(control, container)
    const block = followUpBlock(control, container, boundary)
    if (block === container || block === boundary || !container.contains(block) || block.hasAttribute(FOLLOWUP_HIDDEN_ATTRIBUTE)) continue
    block.setAttribute(FOLLOWUP_HIDDEN_ATTRIBUTE, 'true')
    hidden.push(block)
  }
  return () => {
    for (const block of hidden) block.removeAttribute(FOLLOWUP_HIDDEN_ATTRIBUTE)
  }
}
