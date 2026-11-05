/**
 * Auto-fit the chat content width while the Artifact edit panel is docked.
 *
 * The DSH shell sizes the conversation content with the CSS variable
 * `--dsh-chat-content-width` (default 748px) and the right-side edit panel is
 * docked with `width: clamp(272px, (100vw - content)/2 + 16px, 360px)`. When a
 * user drags the content wider, that panel overlaps the content. This module
 * computes a narrower content width that leaves room for the docked panel plus a
 * breathing gap, and temporarily overrides the variable while editing.
 *
 * Pure math lives in `fitChatContentWidth`; `applyEditChatContentWidth` owns the
 * DOM override and restores the shell's inline value on exit. The user's width
 * preference is never changed permanently: only the inline variable on the
 * conversation content element is saved/restored.
 */

/** Desktop breakpoint where the panel docks on the right (same as CSS). */
export const EDIT_PANEL_MEDIA_QUERY = '(min-width: 1180px)'
/** Conversation content element whose styles resolve the chat width variable. */
export const CHAT_CONTENT_SELECTOR = '[data-conversation-content][data-conversation-region="chat"]'
/** CSS custom property the shell reads for the chat content width. */
export const CHAT_CONTENT_WIDTH_VAR = '--dsh-chat-content-width'
/** Default content width when the variable is unset (mirrors the shell CSS). */
export const DEFAULT_CHAT_CONTENT_WIDTH = 748

/** Inputs for the docked-panel content width fixed point. */
export interface FitChatContentWidthOptions {
  /** Current viewport width in px. */
  readonly viewportWidth: number
  /** User-preferred chat content width in px. */
  readonly contentWidth: number
  /** Minimum docked panel width (matches CSS clamp). */
  readonly panelMin?: number
  /** Maximum docked panel width (matches CSS clamp). */
  readonly panelMax?: number
  /** Breathing room between the content, the panel and the viewport edge. */
  readonly gap?: number
  /** Never shrink the content below this width. */
  readonly minContent?: number
}

/** Clamp one value into the inclusive range. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

/**
 * Compute the chat content width that keeps the docked panel from overlapping.
 *
 * Iterates the docked panel width and the resulting available content width to
 * its fixed point (at most 8 rounds). Returns the original content width when
 * the viewport is too small to fit the panel plus `minContent`, or when the
 * preferred width already fits.
 * @param options - viewport/preferred widths and the layout constants.
 * @returns the content width to apply in px.
 */
export function fitChatContentWidth({
  viewportWidth,
  contentWidth,
  panelMin = 272,
  panelMax = 360,
  gap = 24,
  minContent = 360,
}: FitChatContentWidthOptions): number {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(contentWidth) || viewportWidth <= 0 || contentWidth <= 0) {
    return contentWidth
  }
  // Not enough room for one panel on each side plus the minimum content: leave
  // the shell alone rather than forcing an unusable layout.
  if (viewportWidth < minContent + 2 * (panelMin + gap)) return contentWidth

  let current = contentWidth
  let desired = contentWidth
  for (let round = 0; round < 8; round += 1) {
    const panelWidth = clamp((viewportWidth - current) / 2 + 16, panelMin, panelMax)
    desired = Math.min(current, viewportWidth - 2 * (panelWidth + gap))
    if (Math.abs(desired - current) < 0.5) break
    current = desired
  }
  if (desired >= contentWidth) return contentWidth
  return Math.max(minContent, desired)
}

/** Resolve the content element whose variable is overridden. */
function chatContentElement(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(CHAT_CONTENT_SELECTOR)
}

/** Read the shell's current preferred content width from one element. */
function preferredContentWidth(win: Window, element: HTMLElement): number {
  const inline = element.style.getPropertyValue(CHAT_CONTENT_WIDTH_VAR).trim()
  const computed = win.getComputedStyle(element).getPropertyValue(CHAT_CONTENT_WIDTH_VAR).trim()
  const parsedInline = Number.parseFloat(inline)
  if (Number.isFinite(parsedInline) && parsedInline > 0) return parsedInline
  const parsedComputed = Number.parseFloat(computed)
  if (Number.isFinite(parsedComputed) && parsedComputed > 0) return parsedComputed
  return DEFAULT_CHAT_CONTENT_WIDTH
}

/**
 * Override the chat content width while the edit panel is open.
 *
 * Only active on the wide breakpoint and only when the conversation content
 * element exists. Saves the element's inline `--dsh-chat-content-width`
 * (and priority), writes the fitted value, recomputes on window resize, and
 * restores the saved inline value (or removes the property) when cleaned up.
 * @param win - window to read sizes from and listen on (defaults to global).
 * @param doc - document to query the content element in (defaults to global).
 * @returns a cleanup function restoring the shell's original inline value.
 */
export function applyEditChatContentWidth(win: Window = window, doc: Document = document): () => void {
  if (typeof win === 'undefined' || typeof win.matchMedia !== 'function') return () => undefined
  const element = chatContentElement(doc)
  if (element === null) return () => undefined
  const savedValue = element.style.getPropertyValue(CHAT_CONTENT_WIDTH_VAR)
  const savedPriority = element.style.getPropertyPriority(CHAT_CONTENT_WIDTH_VAR)
  const originalWidth = preferredContentWidth(win, element)
  let overridden = false

  const restore = (): void => {
    if (!overridden) return
    overridden = false
    if (savedValue === '') element.style.removeProperty(CHAT_CONTENT_WIDTH_VAR)
    else element.style.setProperty(CHAT_CONTENT_WIDTH_VAR, savedValue, savedPriority)
  }

  const apply = (): void => {
    const wide = win.matchMedia(EDIT_PANEL_MEDIA_QUERY).matches
    if (!wide) { restore(); return }
    const desired = fitChatContentWidth({ viewportWidth: win.innerWidth, contentWidth: originalWidth })
    if (desired === originalWidth) { restore(); return }
    overridden = true
    element.style.setProperty(CHAT_CONTENT_WIDTH_VAR, `${desired}px`)
  }

  apply()
  win.addEventListener('resize', apply)
  return () => {
    win.removeEventListener('resize', apply)
    restore()
  }
}
