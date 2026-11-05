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
/** Floating desktop panel's inset from the viewport's right edge (matches CSS). */
export const EDIT_PANEL_RIGHT_INSET = 12
/** Panel and content-width animation duration (must match the CSS panel animation). */
export const CONTENT_WIDTH_ANIMATION_MS = 220

/** Control points of the shared panel easing: cubic-bezier(.22, 1, .36, 1). */
const CONTENT_WIDTH_EASING = [0.22, 1, 0.36, 1] as const

/**
 * Evaluate the shared panel easing curve (cubic-bezier(.22, 1, .36, 1)) for one
 * normalized time. Used to animate the chat content width in lockstep with the
 * CSS panel enter/exit animation.
 * @param progress - normalized time (0..1); clamped.
 * @returns eased progress (0..1).
 */
export function easeContentWidth(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0) return 0
  if (progress >= 1) return 1
  const [x1, y1, x2, y2] = CONTENT_WIDTH_EASING
  const bezier = (t: number, p1: number, p2: number): number => {
    const inverse = 1 - t
    return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t
  }
  // Solve x(t) = progress by bisection (x is monotonic for these control points).
  let low = 0
  let high = 1
  for (let index = 0; index < 24; index += 1) {
    const middle = (low + high) / 2
    if (bezier(middle, x1, x2) < progress) low = middle
    else high = middle
  }
  return bezier((low + high) / 2, y1, y2)
}

/** Inputs for the docked-panel content width fixed point. */
export interface FitChatContentWidthOptions {
  /** Current viewport width in px. */
  readonly viewportWidth: number
  /** User-preferred chat content width in px. */
  readonly contentWidth: number
  /** Left edge of the conversation column in viewport px (default 0). */
  readonly columnLeft?: number
  /** Width of the conversation column in viewport px (default viewportWidth). */
  readonly columnWidth?: number
  /** Minimum docked panel width (matches CSS clamp). */
  readonly panelMin?: number
  /** Maximum docked panel width (matches CSS clamp). */
  readonly panelMax?: number
  /** Breathing room between the content, the panel and the viewport edge. */
  readonly gap?: number
  /** Never shrink the content below this width. */
  readonly minContent?: number
  /** Extra gap between the docked panel's right edge and the viewport (px). */
  readonly panelRightInset?: number
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
  columnLeft = 0,
  columnWidth = viewportWidth,
  panelRightInset = 0,
}: FitChatContentWidthOptions): number {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(contentWidth) || viewportWidth <= 0 || contentWidth <= 0) {
    return contentWidth
  }
  if (!Number.isFinite(columnLeft) || !Number.isFinite(columnWidth) || columnWidth <= 0) {
    return contentWidth
  }
  // Not enough room for one panel on each side plus the minimum content: leave
  // the shell alone rather than forcing an unusable layout.
  if (viewportWidth - panelRightInset < minContent + 2 * (panelMin + gap)) return contentWidth

  let current = contentWidth
  let desired = contentWidth
  for (let round = 0; round < 8; round += 1) {
    const panelWidth = clamp((viewportWidth - current) / 2 + 16, panelMin, panelMax)
    // The floating panel's right edge sits `panelRightInset` inside the
    // viewport, so its left edge (and the reserved content area) shifts left.
    const panelLeft = viewportWidth - panelRightInset - panelWidth
    // The content is centered inside the conversation column, which can start
    // after the sidebar. Solve for the width whose right edge stays `gap` left
    // of the docked panel.
    const maxContent = 2 * (panelLeft - gap - columnLeft) - columnWidth
    desired = Math.min(current, maxContent)
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

/** Resolve the actual content width (custom properties may contain clamp()). */
function measuredContentWidth(doc: Document, element: HTMLElement): number {
  const probe = doc.createElement('div')
  probe.style.cssText = 'position:absolute;left:-10000px;top:0;height:0;visibility:hidden;pointer-events:none;width:var(--dsh-chat-content-width);'
  element.appendChild(probe)
  const width = probe.getBoundingClientRect().width
  probe.remove()
  return Number.isFinite(width) && width > 0 ? width : DEFAULT_CHAT_CONTENT_WIDTH
}

/** Read the shell's current preferred content width from one element. */
function preferredContentWidth(win: Window, doc: Document, element: HTMLElement): number {
  const inline = element.style.getPropertyValue(CHAT_CONTENT_WIDTH_VAR).trim()
  const parsedInline = Number.parseFloat(inline)
  if (Number.isFinite(parsedInline) && parsedInline > 0) return parsedInline
  const computed = win.getComputedStyle(element).getPropertyValue(CHAT_CONTENT_WIDTH_VAR).trim()
  // Custom properties keep their token stream, so a `clamp(...)` value cannot
  // be parsed directly; measure a probe child that resolves it instead.
  const parsedComputed = Number.parseFloat(computed)
  if (Number.isFinite(parsedComputed) && parsedComputed > 0) return parsedComputed
  return measuredContentWidth(doc, element)
}

/** Read the user's shell width preference written on the content parent. */
function userWidthPreference(element: HTMLElement): number | undefined {
  const value = element.parentElement?.style.getPropertyValue('--dsh-chat-user-width').trim() ?? ''
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Controller for the chat content width while one edit panel is docked.
 * `open()` animates the content from the user's base width to the fitted width;
 * `close()` animates it back; `dispose()` cancels the animation and restores the
 * shell's original inline variable.
 */
export interface ChatContentWidthController {
  /** Animate from the current width to the fitted width (panel opening). */
  readonly open: () => void
  /** Animate from the current width back to the user's base width (panel closing). */
  readonly close: () => void
  /** Cancel animations and restore the shell's original inline value. */
  readonly dispose: () => void
}

/** No-op controller used when the shell element or wide breakpoint is absent. */
const INERT_CONTROLLER: ChatContentWidthController = { open: () => undefined, close: () => undefined, dispose: () => undefined }

/**
 * Drive the chat content width in lockstep with the docked edit panel.
 *
 * Both the CSS panel animation and this controller use `CONTENT_WIDTH_ANIMATION_MS`
 * with the same cubic-bezier(.22, 1, .36, 1) easing, so opening narrows the
 * content while the panel slides in, and closing restores it while the panel
 * slides out. User width preferences are never modified permanently: the
 * original inline value is restored on dispose.
 * @param win - window to read sizes from and listen on (defaults to global).
 * @param doc - document to query the content element in (defaults to global).
 * @returns a controller for open/close/dispose.
 */
export function applyEditChatContentWidth(win: Window = window, doc: Document = document): ChatContentWidthController {
  if (typeof win === 'undefined' || typeof win.matchMedia !== 'function') return INERT_CONTROLLER
  const element = chatContentElement(doc)
  if (element === null) return INERT_CONTROLLER
  const savedValue = element.style.getPropertyValue(CHAT_CONTENT_WIDTH_VAR)
  const savedPriority = element.style.getPropertyPriority(CHAT_CONTENT_WIDTH_VAR)
  const mountWidth = preferredContentWidth(win, doc, element)
  const reduceMotion = (): boolean => win.matchMedia('(prefers-reduced-motion: reduce)').matches
  let current = mountWidth
  let overridden = false
  let closed = false
  let disposed = false
  let writing = false
  let lastInline = savedValue
  let frame: number | null = null

  const write = (width: number): void => {
    current = width
    overridden = true
    lastInline = `${Math.round(width * 100) / 100}px`
    writing = true
    element.style.setProperty(CHAT_CONTENT_WIDTH_VAR, lastInline)
    // MutationObserver callbacks run after this synchronous write, so clear the
    // self-write guard in a microtask the observer can see first.
    void Promise.resolve().then(() => { writing = false })
  }

  const cancelFrame = (): void => {
    if (frame === null) return
    win.cancelAnimationFrame(frame)
    frame = null
  }

  const restoreInline = (): void => {
    cancelFrame()
    if (!overridden) return
    overridden = false
    writing = true
    lastInline = savedValue
    if (savedValue === '') element.style.removeProperty(CHAT_CONTENT_WIDTH_VAR)
    else element.style.setProperty(CHAT_CONTENT_WIDTH_VAR, savedValue, savedPriority)
    void Promise.resolve().then(() => { writing = false })
  }

  /** Current shell preference (parent custom property) or the mount-time width. */
  const baseWidth = (): number => userWidthPreference(element) ?? mountWidth

  /** Fitted width for the current viewport and user preference. */
  const fittedWidth = (): number => {
    const preference = baseWidth()
    const rect = element.getBoundingClientRect()
    const desired = fitChatContentWidth({
      viewportWidth: win.innerWidth,
      contentWidth: preference,
      columnLeft: rect.left,
      columnWidth: rect.width,
      panelRightInset: EDIT_PANEL_RIGHT_INSET,
    })
    return desired >= preference ? preference : desired
  }

  /** Animate from the current value to `target`; interrupts any running frame. */
  const animateTo = (target: number): void => {
    cancelFrame()
    if (disposed) return
    if (Math.abs(target - current) < 0.5) { write(target); return }
    if (reduceMotion() || typeof win.requestAnimationFrame !== 'function') { write(target); return }
    const from = current
    const started = typeof win.performance?.now === 'function' ? win.performance.now() : Date.now()
    const step = (now: number): void => {
      frame = null
      if (disposed) return
      const progress = Math.min(1, Math.max(0, (now - started) / CONTENT_WIDTH_ANIMATION_MS))
      write(from + (target - from) * easeContentWidth(progress))
      if (progress < 1) frame = win.requestAnimationFrame(step)
      else write(target)
    }
    frame = win.requestAnimationFrame(step)
  }

  /** Recompute after a resize or a user width-handle drag. */
  const refit = (): void => {
    if (disposed || closed) return
    if (!win.matchMedia(EDIT_PANEL_MEDIA_QUERY).matches) { restoreInline(); return }
    write(baseWidth())
    animateTo(fittedWidth())
  }

  const open = (): void => {
    if (disposed) return
    closed = false
    if (!win.matchMedia(EDIT_PANEL_MEDIA_QUERY).matches) { restoreInline(); return }
    // Start from the base layout, then animate to the fitted width on the next
    // frame so the panel CSS enter animation and the content change are aligned.
    write(baseWidth())
    animateTo(fittedWidth())
  }

  const close = (): void => {
    if (disposed) return
    closed = true
    animateTo(baseWidth())
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    restoreInline()
    win.removeEventListener('resize', refit)
    observer?.disconnect()
  }

  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(records => {
    if (writing) return
    // Ignore our own inline writes (they match lastInline); parent style changes
    // (user width-handle drags) still trigger a refit.
    const ownWriteOnly = records.every(record => record.target === element && element.style.getPropertyValue(CHAT_CONTENT_WIDTH_VAR) === lastInline)
    if (ownWriteOnly) return
    refit()
  })
  // observe parent for user width-handle drags, element for shell rewrites; ignore
  // our own writes via the `writing` flag to avoid a feedback loop.
  observer?.observe(element.parentElement ?? element, { attributes: true, attributeFilter: ['style'] })
  if (element.parentElement !== null) observer?.observe(element, { attributes: true, attributeFilter: ['style'] })
  win.addEventListener('resize', refit)
  open()
  return { open, close, dispose }
}
