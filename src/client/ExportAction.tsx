/**
 * Export entry for one completed Intelligent UI answer.
 *
 * Seated in the standard assistant-message action strip
 * (`conversation.chat.assistant-actions`), between copy and branch. The entry
 * only exists when the owning Turn recorded a render_ui program, so plain text
 * answers keep the shipped action row unchanged. Clicking it opens a small menu
 * of beautification frames and exports the rendered answer cards as one PNG.
 *
 * The image is produced from the live card DOM, so it follows the current
 * theme, local interaction state and card width. The export control itself is
 * excluded from the capture.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the ui-chat `conversation.chat.assistant-actions` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  BEAUTIFY_STYLES,
  type BeautifyStyle,
  type ExportPageCard,
  type ImageExportSettings,
  type IntelligentUIProgram,
} from '../shared/intelligent-ui.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'
import { messageHasRenderUi, type ExportChatSnapshot } from './export-data.ts'
import { exportCardsHtml } from './export-html.ts'
import { MenuDivider, MenuItem } from './Menu.tsx'
import { exportCardsImage } from './export-image.ts'
import { useAnchoredPopup, usePopupDismiss } from './popover.ts'

/** Business face injected by the plugin registration. */
export interface ExportActionInjected {
  /**
   * Read every program rendered by the message's Turn.
   * @param messageId - durable assistant message identity.
   * @returns the Turn's rendered programs in invocation order.
   */
  readonly programsFor: (messageId: string) => IntelligentUIProgram[]
  /** @returns the image-export preferences from the Host settings document. */
  readonly settings: () => ImageExportSettings
}

/** Chat selector hook supplied by the Session standard kit. */
type UseChatSelector = (selector: (snapshot: ExportChatSnapshot) => boolean) => boolean

/** Full props: the action-row owner currency, injected business face, and locale seat. */
export type ExportActionProps =
  & PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<ExportActionInjected>
  & {
    /** DSH locale seat; defaults to English when rendered outside a slot. */
    readonly t?: Translate
    /** Session-standard Chat selector hook, supplied by the slot kit. */
    readonly useChat: UseChatSelector
  }

/** One frame row in the export menu. */
const FRAME_KEYS: Readonly<Record<BeautifyStyle, { label: string; hint: string }>> = {
  raw: { label: 'export.style.raw', hint: 'export.style.raw.hint' },
  rounded: { label: 'export.style.rounded', hint: 'export.style.rounded.hint' },
  card: { label: 'export.style.card', hint: 'export.style.card.hint' },
}

/** The export glyph supplied for this feature: a share/export arrow leaving a circle. */
function ExportIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M11 2.04938V4.06189C7.05369 4.55399 4 7.92038 4 12C4 16.4183 7.58172 20 12 20C16.0796 20 19.446 16.9463 19.9381 13H21.9506C21.4489 18.0533 17.1853 22 12 22C6.47715 22 2 17.5228 2 12C2 6.81465 5.94668 2.5511 11 2.04938ZM20 5.41421L12 13.4142L10.5858 12L18.5858 4H14V2H22V10H20V5.41421Z" />
    </svg>
  )
}

/** Menu lifecycle: idle, one frame exporting, nothing exportable, success, or failure. */
type ExportStatus = 'idle' | 'working' | 'empty' | 'done' | 'error'

/**
 * One answer's export control and menu.
 * @param props - owner message identity, injected lookups, Chat selector hook and locale seat.
 * @returns the icon button plus its portal menu, or null for answers that never rendered UI.
 */
export function ExportAction({
  messageId, programsFor, settings, useChat, t = fallbackT,
}: ExportActionProps): ReactNode {
  const visible = useChat(snapshot => messageHasRenderUi(snapshot, String(messageId)))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<BeautifyStyle | 'page' | null>(null)
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [lastKind, setLastKind] = useState<'image' | 'page'>('image')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Keep close stable: a busy-state change must not re-run the dismiss effect
  // (that cleanup would steal focus from the menu). An in-flight export may be
  // dismissed; it keeps running, but its outcome is ignored because the menu is closed.
  const busyRef = useRef(false)
  const closeTimerRef = useRef<number | null>(null)
  const close = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setOpen(false)
    setStatus('idle')
  }, [])
  const placement = useAnchoredPopup(open, triggerRef, { minWidth: 0, maxWidth: 320, alignEnd: true }, menuRef)
  const menuVisible = open && placement !== null
  usePopupDismiss(menuVisible, triggerRef, menuRef, close)
  // The menu lives exactly as long as its trigger is usable: any scroll/resize
  // dismisses it (it must not float at a stale anchor), and an offscreen or
  // removed trigger closes it as well.
  useEffect(() => {
    if (!menuVisible) return
    const onViewportChange = (): void => { close() }
    window.addEventListener('scroll', onViewportChange, { capture: true, passive: true })
    window.addEventListener('resize', onViewportChange)
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => !entry.isIntersecting)) close()
    }, { threshold: 0 })
    if (observer !== null && triggerRef.current !== null) observer.observe(triggerRef.current)
    // Streaming can reflow the answer and move the trigger without a scroll
    // event; a fixed menu would then float at the old anchor.
    const turnTail = triggerRef.current?.closest('[data-turn-tail]') ?? null
    let firstResize = true
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (firstResize) {
        firstResize = false
        return
      }
      close()
    })
    if (resizeObserver !== null && turnTail !== null) resizeObserver.observe(turnTail)
    return () => {
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
      observer?.disconnect()
      resizeObserver?.disconnect()
    }
  }, [menuVisible, close])
  // Default: above the trigger. When the action row is too close to the top,
  // flip below the button instead of clamping on top of it.
  const [menuBelowTop, setMenuBelowTop] = useState<number | null>(null)
  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])
  useLayoutEffect(() => {
    if (!menuVisible || placement === null || menuRef.current === null || triggerRef.current === null) {
      setMenuBelowTop(null)
      return
    }
    const viewport = window.innerHeight
    const margin = 8
    const gap = 8
    const height = menuRef.current.offsetHeight
    const rect = triggerRef.current.getBoundingClientRect()
    const aboveTop = viewport - placement.bottom - height
    if (aboveTop >= margin) {
      setMenuBelowTop(null)
      return
    }
    setMenuBelowTop(Math.min(rect.bottom + gap, Math.max(margin, viewport - margin - height)))
  }, [menuVisible, placement, status])

  if (!visible) return null

  const run = async (style: BeautifyStyle): Promise<void> => {
    const trigger = triggerRef.current
    if (trigger === null || busyRef.current) return
    const programs = programsFor(String(messageId))
    if (programs.length === 0) {
      setStatus('empty')
      return
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    const preferences = settings()
    busyRef.current = true
    setBusy(style)
    setLastKind('image')
    setStatus('working')
    try {
      await exportCardsImage(trigger, {
        background: preferences.background,
        scale: preferences.scale,
        beautify: style,
        title: programs[0]?.title,
        hideToAssistant: !preferences.toAssistant,
      })
      setStatus('done')
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null
        setOpen(false)
        setStatus('idle')
      }, 650)
    } catch (error) {
      console.warn('[intelligent-ui] image export failed', error)
      setStatus('error')
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  const runPage = async (): Promise<void> => {
    const trigger = triggerRef.current
    if (trigger === null || busyRef.current) return
    const programs = programsFor(String(messageId))
    if (programs.length === 0) {
      setStatus('empty')
      return
    }
    busyRef.current = true
    setBusy('page')
    setLastKind('page')
    setStatus('working')
    try {
      const cards: ExportPageCard[] = programs.map(program => ({
        program: program.program,
        title: program.title,
        style: program.style === 'article' ? 'article' : 'card',
        callId: program.callId,
      }))
      await exportCardsHtml({
        cards,
        title: programs[0]?.title,
        lang: document.documentElement.lang || 'en',
        toAssistant: settings().toAssistant,
      })
      setStatus('done')
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null
        setOpen(false)
        setStatus('idle')
      }, 650)
    } catch (error) {
      console.warn('[intelligent-ui] page export failed', error)
      setStatus('error')
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  const statusLine = status === 'working'
    ? lastKind === 'page' ? t('export.state.workingHtml') : t('export.state.working')
    : status === 'done'
      ? lastKind === 'page' ? t('export.state.doneHtml') : t('export.state.done')
      : status === 'empty'
        ? t('export.error.noPrograms')
        : status === 'error'
          ? t('export.state.error')
          : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="dsh-iui-export-trigger"
        data-dsh-iui-export
        aria-label={t('export.button.aria')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-status={status === 'error' ? 'error' : undefined}
        title={status === 'error' ? t('export.state.error') : t('export.button.title')}
        onClick={() => {
          if (busyRef.current) return
          setStatus('idle')
          setOpen(value => !value)
        }}
      >
        <ExportIcon />
        <span className="dsh-iui-export-label">{t('export.button.label')}</span>
      </button>
      {menuVisible
        ? createPortal(
          <div
            ref={menuRef}
            className="dsh-iui-menu dsh-iui-export-menu"
            role="menu"
            aria-label={t('export.button.title')}
            style={{
              ...placement.right === undefined ? {} : { right: placement.right },
              ...placement.maxWidth === undefined ? {} : { maxWidth: placement.maxWidth },
              ...menuBelowTop === null ? { bottom: placement.bottom } : { top: menuBelowTop },
            }}
            data-dsh-iui-export-menu
          >
            <div className="dsh-iui-export-heading" role="presentation">{t('export.menu.image')}</div>
            {BEAUTIFY_STYLES.map(style => (
              <MenuItem
                key={style}
                label={t(FRAME_KEYS[style].label)}
                hint={t(FRAME_KEYS[style].hint)}
                disabled={busy !== null}
                data={{ 'data-export-style': style }}
                onSelect={() => { void run(style) }}
              />
            ))}
            <MenuDivider />
            <MenuItem
              label={t('export.menu.page')}
              hint={t('export.page.hint')}
              disabled={busy !== null}
              data={{ 'data-export-page': 'true' }}
              onSelect={() => { void runPage() }}
            />
            {statusLine === null ? null : (
              <p
                className={status === 'error' ? 'dsh-iui-export-status is-error' : 'dsh-iui-export-status'}
                role={status === 'error' || status === 'empty' ? 'alert' : 'status'}
              >
                {statusLine}
              </p>
            )}
          </div>,
          document.body,
        )
        : null}
    </>
  )
}
