/**
 * Sidebar update card and its anchored release-notes popover.
 *
 * The Host checks npm once per session and serves a same-origin answer with the
 * latest stable version and that release's reviewed highlights. The card sits
 * in the sidebar's normal flow (below New Session, above the panel list) and
 * opens a fixed popover beside it: the popover lists the update points and its
 * arrow opens this bundle's Plugins detail page, where DSH owns the update.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PACKAGE_NAME } from '../shared/intelligent-ui.ts'
import { UPDATE_ROUTE_PATH, type UpdateCheckView } from '../shared/update-check.ts'
import type { Translate } from '../shared/locales.ts'
import { RemixIcon } from '../lib/components/remix-icon.tsx'

/** Short package name shown in the sidebar card. */
const SHORT_NAME = PACKAGE_NAME.split('/').at(-1) ?? PACKAGE_NAME
/** Gap between the card and its popover / viewport gutter. */
const POPOVER_GAP = 12
/** Popover width bounds. */
const POPOVER_MIN_WIDTH = 240
const POPOVER_MAX_WIDTH = 360
/** Missing Highlights section fallback copy. */
const POPOVER_EMPTY_KEY = 'update.noHighlights'

/** Props for the mounted card; the host supplies navigation and the locale seat. */
export interface UpdateNoticeProps {
  /** Open this bundle's Plugins detail page (absent when the panel is unavailable). */
  readonly openDetails?: () => void
  /** Bind the active locale at render time; calling it again follows a language switch. */
  readonly translate: () => Translate
  /** Subscribe to locale revisions so the card re-renders after a language switch (optional on minimal hosts). */
  readonly subscribe?: (listener: () => void) => () => void
  /** Active DSH locale id; selects the English release-notes variant when it starts with `en`. */
  readonly locale?: () => string
}

/** One fixed popover placement measured from the card. */
interface PopoverPlacement {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly maxHeight: number
}

/** The extension's own app icon, inlined so the sidebar card carries the brand mark. */
function PluginMark(): ReactNode {
  return (
    <svg className="dsh-iui-sidebar-update-mark" width="28" height="28" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="dsh-iui-sidebar-update-accent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5aa9ff" />
          <stop offset="1" stopColor="#38d6a4" />
        </linearGradient>
      </defs>
      <rect className="dsh-iui-sidebar-update-tile" x="2" y="2" width="60" height="60" rx="16" />
      <rect className="dsh-iui-sidebar-update-edge" x="2.75" y="2.75" width="58.5" height="58.5" rx="15.25" fill="none" strokeWidth="1.5" />
      <path className="dsh-iui-sidebar-update-spark" d="M26 15.5c0 5.9 3.6 9.5 9.5 9.5-5.9 0-9.5 3.6-9.5 9.5 0-5.9-3.6-9.5-9.5-9.5 5.9 0 9.5-3.6 9.5-9.5Z" />
      <path d="M43.5 24c0 3.6 2.2 5.8 5.8 5.8-3.6 0-5.8 2.2-5.8 5.8 0-3.6-2.2-5.8-5.8-5.8 3.6 0 5.8-2.2 5.8-5.8Z" fill="url(#dsh-iui-sidebar-update-accent)" />
      <rect className="dsh-iui-sidebar-update-line-one" x="15" y="40" width="24" height="3.4" rx="1.7" />
      <rect className="dsh-iui-sidebar-update-line-two" x="15" y="46.4" width="15" height="3.4" rx="1.7" />
    </svg>
  )
}

/** Read the popover's fixed placement beside the card, clamped to the viewport. */
function placePopover(card: DOMRect, viewportWidth: number, viewportHeight: number): PopoverPlacement {
  const width = Math.min(POPOVER_MAX_WIDTH, Math.max(POPOVER_MIN_WIDTH, viewportWidth - POPOVER_GAP * 2))
  const height = Math.max(140, Math.min(360, viewportHeight - POPOVER_GAP * 2))
  const right = card.right + POPOVER_GAP
  if (right + width <= viewportWidth - POPOVER_GAP) {
    const top = Math.max(POPOVER_GAP, Math.min(card.top - 6, viewportHeight - height - POPOVER_GAP))
    return { left: right, top, width, maxHeight: height }
  }
  const left = Math.max(POPOVER_GAP, Math.min(card.left, viewportWidth - width - POPOVER_GAP))
  const top = Math.max(POPOVER_GAP, Math.min(card.bottom + POPOVER_GAP, viewportHeight - height - POPOVER_GAP))
  return { left, top, width, maxHeight: height }
}

export function UpdateNotice({ openDetails, translate, subscribe, locale }: UpdateNoticeProps): ReactNode {
  const [view, setView] = useState<UpdateCheckView | null>(null)
  const [localeId, setLocaleId] = useState(() => locale?.() ?? 'en')
  const [, setRevision] = useState(0)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  useEffect(() => {
    if (subscribe === undefined) return
    return subscribe(() => {
      setLocaleId(locale?.() ?? 'en')
      setRevision((value) => value + 1)
    })
  }, [subscribe, locale])
  const t = translate()

  useEffect(() => {
    let live = true
    const query = typeof localeId === 'string' && localeId !== '' ? `?lang=${encodeURIComponent(localeId)}` : ''
    void fetch(`${UPDATE_ROUTE_PATH}${query}`, { cache: 'no-store' })
      .then(async (response): Promise<UpdateCheckView | null> => {
        if (!response.ok) return null
        const payload = await response.json() as UpdateCheckView
        if (payload === null || typeof payload !== 'object' || payload.updateAvailable !== true || typeof payload.latest !== 'string') return null
        const highlights = Array.isArray(payload.highlights)
          ? payload.highlights.filter((point): point is string => typeof point === 'string').slice(0, 6)
          : []
        return { ...payload, highlights }
      })
      .then((next) => {
        if (live) setView(next)
      })
      .catch(() => { /* offline or an older Host: no card */ })
    return () => { live = false }
  }, [localeId])

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    const card = cardRef.current
    if (card === null) return
    const place = (): void => {
      const rect = card.getBoundingClientRect()
      setPlacement(placePopover(rect, window.innerWidth, window.innerHeight))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if (cardRef.current?.contains(target) === true || popoverRef.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      cardRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const latest = view?.latest ?? null
  if (latest === null || view === null) return null
  const highlights = view.highlights
  const popover = open && placement !== null ? createPortal(
    <div
      ref={popoverRef}
      id={titleId}
      className="dsh-iui-update-popover"
      data-dsh-iui-update-popover
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${titleId}-title`}
      style={{ left: `${placement.left}px`, top: `${placement.top}px`, width: `${placement.width}px`, maxHeight: `${placement.maxHeight}px` }}
    >
      <div className="dsh-iui-update-popover-head">
        <div className="dsh-iui-update-popover-titles">
          <strong id={`${titleId}-title`}>{t('update.highlights')}</strong>
          <span className="dsh-iui-update-popover-version">{view.current} → {latest}</span>
        </div>
      </div>
      {highlights.length === 0
        ? <p className="dsh-iui-update-popover-empty">{t(POPOVER_EMPTY_KEY)}</p>
        : (
          <ul className="dsh-iui-update-popover-points">
            {highlights.map((point, index) => <li key={`${index}:${point}`}>{point}</li>)}
          </ul>
        )}
    </div>,
    document.body,
  ) : null

  return (
    <>
      <div
        ref={cardRef}
        className={`dsh-iui-sidebar-update${open ? ' is-open' : ''}`}
        data-dsh-iui-sidebar-update
        data-version={latest}
      >
        {openDetails === undefined ? null : (
          <button
            type="button"
            className="dsh-iui-sidebar-update-hit"
            data-dsh-iui-update-card-open
            aria-label={t('update.openDetails')}
            onClick={() => { setOpen(false); openDetails() }}
          />
        )}
        <span className="dsh-iui-sidebar-update-content">
          <span className="dsh-iui-sidebar-update-icon" aria-hidden="true"><PluginMark /></span>
          <span className="dsh-iui-sidebar-update-copy">
            <span className="dsh-iui-sidebar-update-title">{t('update.title', { name: SHORT_NAME })}</span>
            <span className="dsh-iui-sidebar-update-meta">
              <span className="dsh-iui-sidebar-update-versions">{view.current} → {latest}</span>
              <button
                type="button"
                className="dsh-iui-sidebar-update-action"
                data-dsh-iui-update-card-details
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? titleId : undefined}
                onClick={() => { setOpen((value) => !value) }}
              >{t('update.open')}</button>
            </span>
          </span>
          <span className="dsh-iui-sidebar-update-chevron" aria-hidden="true"><RemixIcon name="arrow-right-s-line" size={16} /></span>
        </span>
      </div>
      {popover}
    </>
  )
}
