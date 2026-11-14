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
      <span className="dsh-iui-sidebar-update-icon" aria-hidden="true"><RemixIcon name="download-2-line" size={16} /></span>
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
