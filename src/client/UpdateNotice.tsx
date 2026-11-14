/**
 * Sidebar update card for this extension.
 *
 * The Host checks npm once per session and serves a same-origin answer; this
 * card appears only when a newer stable version is published. The whole card
 * is one button: it opens this bundle's Plugins detail page, where DSH owns the
 * actual update. The card is mounted into the sidebar's normal flow (see
 * sidebar-update.ts) so it pushes the panel rows down instead of covering
 * Plugins, Automation tasks or anything else.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { PACKAGE_NAME } from '../shared/intelligent-ui.ts'
import { UPDATE_ROUTE_PATH, type UpdateCheckView } from '../shared/update-check.ts'
import type { Translate } from '../shared/locales.ts'
import { RemixIcon } from '../lib/components/remix-icon.tsx'

/** Short package name shown in the sidebar card. */
const SHORT_NAME = PACKAGE_NAME.split('/').at(-1) ?? PACKAGE_NAME

/** Props for the mounted card; the host supplies navigation and the locale seat. */
export interface UpdateNoticeProps {
  /** Open this bundle's Plugins detail page (absent when the panel is unavailable). */
  readonly openDetails?: () => void
  /** Bind the active locale at render time; calling it again follows a language switch. */
  readonly translate: () => Translate
  /** Subscribe to locale revisions so the card re-renders after a language switch (optional on minimal hosts). */
  readonly subscribe?: (listener: () => void) => () => void
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

export function UpdateNotice({ openDetails, translate, subscribe }: UpdateNoticeProps): ReactNode {
  const [view, setView] = useState<UpdateCheckView | null>(null)
  const [, setRevision] = useState(0)
  useEffect(() => {
    if (subscribe === undefined) return
    return subscribe(() => { setRevision((value) => value + 1) })
  }, [subscribe])
  const t = translate()
  useEffect(() => {
    let live = true
    void fetch(UPDATE_ROUTE_PATH, { cache: 'no-store' })
      .then(async (response): Promise<UpdateCheckView | null> => {
        if (!response.ok) return null
        const payload = await response.json() as UpdateCheckView
        return payload !== null && typeof payload === 'object' && payload.updateAvailable === true && typeof payload.latest === 'string'
          ? payload
          : null
      })
      .then((next) => {
        if (live) setView(next)
      })
      .catch(() => { /* offline or an older Host: no card */ })
    return () => { live = false }
  }, [])
  const latest = view?.latest ?? null
  if (latest === null || view === null) return null
  const body = (
    <>
      <span className="dsh-iui-sidebar-update-icon" aria-hidden="true"><PluginMark /></span>
      <span className="dsh-iui-sidebar-update-copy">
        <span className="dsh-iui-sidebar-update-title">{t('update.title', { name: SHORT_NAME })}</span>
        <span className="dsh-iui-sidebar-update-meta">
          <span className="dsh-iui-sidebar-update-versions">{view.current} → {latest}</span>
          <span className="dsh-iui-sidebar-update-action">{t('update.open')}</span>
        </span>
      </span>
      <span className="dsh-iui-sidebar-update-chevron" aria-hidden="true"><RemixIcon name="arrow-right-s-line" size={16} /></span>
    </>
  )
  if (openDetails === undefined) return <div className="dsh-iui-sidebar-update" data-dsh-iui-sidebar-update data-version={latest}>{body}</div>
  return (
    <button type="button" className="dsh-iui-sidebar-update" data-dsh-iui-sidebar-update data-version={latest} onClick={() => { openDetails() }}>
      {body}
    </button>
  )
}
