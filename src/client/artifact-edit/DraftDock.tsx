/**
 * Session-scoped pending-edit drafts, docked above the composer card.
 *
 * The edit panel is per-artifact, but the draft switcher is per-chat, so it
 * lives in the composer's `conversation.input.dock` strip instead: one compact
 * horizontal row of draft chips with attach/discard affordances. The DOM hooks
 * are the same as the former panel section, so composer/edit flows and tests
 * keep working; the dock renders nothing while the chat has no pending drafts.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { RemixIcon } from '../../lib/components/remix-icon.tsx'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MAX_ARTIFACT_BATCH_REQUESTS, MAX_ARTIFACT_DRAFTS } from '../../shared/artifact-edit.ts'
import { fallbackT, type Translate } from '../../shared/locales.ts'
import type { ArtifactEditSession } from './contracts.ts'
import {
  activateDraft,
  activeDraftKeyFor,
  applyNoticeMessage,
  artifactApplyNotices,
  attachDraft,
  dismissArtifactApplyNotice,
  discardDraft,
  hasArtifactEditContent,
  useArtifactEditStore,
} from './store.ts'

/** Injected face of the drafts dock. */
export interface DraftDockInjected {
  readonly sessionId: SessionId
}

/** Short request summary for one draft chip. */
function draftSummaryLabel(draft: ArtifactEditSession, t: Translate): string {
  // Style and block content cannot be sent together; keep a mixed draft's label
  // explicit instead of pretending it is a pure style description.
  if (draft.styleInstruction.trim() !== '') {
    const hasBlockContent = draft.selection.length > 0
      || draft.orderChanged
      || draft.nestedOrderChanged === true
      || (draft.additions?.length ?? 0) > 0
      || draft.globalInstruction.trim() !== ''
    return t(hasBlockContent ? 'edit.styleMixed' : 'edit.summaryStyle')
  }
  const ops = draft.pendingOps?.length ?? 0
  const opsLabel = ops > 0 ? t('edit.summaryOps', { count: ops }) : ''
  const count = draft.selection.length
  if (count > 0) return opsLabel === '' ? t('edit.requestsCount', { count }) : `${opsLabel} · ${t('edit.requestsCount', { count })}`
  if (draft.orderChanged || draft.nestedOrderChanged === true) return opsLabel === '' ? t('edit.summaryOrderChanged') : `${opsLabel} · ${t('edit.summaryOrderChanged')}`
  if (opsLabel !== '') return opsLabel
  return t('edit.summaryGlobal')
}

/**
 * Composer dock strip listing every retained draft of this chat.
 * @param props - session identity seat from the dock slot and the locale seat.
 * @returns the compact draft strip, or null when the chat has no pending drafts.
 */
export function DraftDock({ sessionId, t = fallbackT }: PropsRuntime<'conversation.input.overlay'> & InjectFace<DraftDockInjected> & { readonly t?: Translate }): ReactNode {
  const editStore = useArtifactEditStore()
  const drafts = useMemo(() => {
    const list: ArtifactEditSession[] = []
    for (const candidate of editStore.sessions.values()) {
      if (candidate.sessionId !== sessionId) continue
      if (candidate.status === 'submitted') continue
      if (!hasArtifactEditContent(candidate)) continue
      list.push(candidate)
    }
    return list
  }, [editStore, sessionId])
  const activeKey = useMemo(() => activeDraftKeyFor(sessionId), [editStore, sessionId])
  const attachedCount = useMemo(() => drafts.filter(draft => draft.attached).length, [drafts])
  // Post-Apply notices are chat-scoped: the Apply may have consumed the draft
  // whose panel showed the notice (auto-submit / quick-props rebase), so render
  // them here, where the composer keeps the surface mounted.
  const notices = useMemo(() => artifactApplyNotices(sessionId), [editStore, sessionId])
  // Deleting a draft that still holds content is a destructive action: the dock
  // asks for a second click instead of silently dropping the work.
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null)
  if (drafts.length === 0 && notices.length === 0) return null
  const attachBlocked = attachedCount >= MAX_ARTIFACT_BATCH_REQUESTS
  const noticeStrip = notices.length === 0 ? null : (
    <section className="dsh-iui-draft-dock-notices" aria-label={t('edit.applyNoticeRegion')} data-dsh-iui-edit-apply-notices>
      {notices.map(entry => (
        <div
          key={entry.key}
          className="dsh-iui-edit-apply-notice"
          role="status"
          data-dsh-iui-edit-apply-notice
          data-notice={entry.notice}
        >
          <span className="dsh-iui-edit-apply-notice-text">{applyNoticeMessage(entry.notice)}</span>
          <button
            type="button"
            className="dsh-iui-edit-link"
            data-dsh-iui-edit-apply-notice-dismiss
            onClick={() => { dismissArtifactApplyNotice(entry.key) }}
          >
            {t('edit.applyNoticeDismiss')}
          </button>
        </div>
      ))}
    </section>
  )
  const draftStrip = drafts.length === 0 ? null : (
    <section className="dsh-iui-draft-dock" aria-label={t('edit.pendingDrafts')} data-dsh-iui-edit-draft-switcher>
      <div className="dsh-iui-draft-dock-head">
        <span className="dsh-iui-draft-dock-title">{t('edit.pendingDrafts')}</span>
        <span className="dsh-iui-draft-dock-count">({drafts.length}/{MAX_ARTIFACT_DRAFTS})</span>
      </div>
      <ul className="dsh-iui-edit-draft-list dsh-iui-draft-dock-list">
        {drafts.map(draft => {
          const active = draft.key === activeKey
          const conflict = draft.status === 'conflict'
          const title = draft.title !== undefined && draft.title.trim() !== '' ? draft.title : t('edit.panelTitle')
          return (
            <li
              key={draft.key}
              className={`dsh-iui-edit-draft-row dsh-iui-draft-dock-row${active ? ' is-active' : ''}`}
              data-dsh-iui-edit-draft-row
              data-key={draft.key}
              data-active={active ? 'true' : 'false'}
              data-attached={draft.attached ? 'true' : 'false'}
              data-conflict={conflict ? 'true' : undefined}
            >
              <button
                type="button"
                className="dsh-iui-edit-draft-open"
                data-dsh-iui-edit-draft-activate
                aria-current={active ? 'true' : undefined}
                onClick={() => { activateDraft(draft.key) }}
              >
                <span className="dsh-iui-edit-draft-dot" aria-hidden="true" />
                <span className="dsh-iui-edit-draft-text">
                  <span className="dsh-iui-edit-draft-title" title={title}>{title}</span>
                  <span className="dsh-iui-edit-draft-meta">
                    {t('edit.revision', { n: draft.baseRevision })} · {draftSummaryLabel(draft, t)}
                  </span>
                </span>
                {conflict ? <span className="dsh-iui-edit-draft-tag is-conflict">{t('edit.conflictBadge')}</span> : null}
                {draft.submitFailed === true ? <span className="dsh-iui-edit-draft-tag is-failed" title={t('edit.draftFailedHint')}>{t('edit.draftFailed')}</span> : null}
                {draft.attached ? null : <span className="dsh-iui-edit-draft-tag">{t('edit.draftDetached')}</span>}
              </button>
              <span className="dsh-iui-edit-draft-actions">
                {draft.attached ? null : (
                  <button
                    type="button"
                    className="dsh-iui-edit-draft-action"
                    data-dsh-iui-edit-draft-attach
                    aria-label={`${t('edit.attachDraft')}: ${title}`}
                    title={attachBlocked ? t('edit.draftDetached') : t('edit.attachDraft')}
                    disabled={attachBlocked}
                    onClick={() => { attachDraft(draft.key) }}
                  >
                    {t('edit.attachDraft')}
                  </button>
                )}
                <button
                  type="button"
                  className="dsh-iui-edit-draft-action dsh-iui-edit-draft-action-danger"
                  data-dsh-iui-edit-draft-discard
                  data-confirm={confirmDiscard === draft.key ? 'true' : undefined}
                  aria-label={`${confirmDiscard === draft.key ? t('edit.discardConfirm') : t('edit.discardDraft')}: ${title}`}
                  title={confirmDiscard === draft.key ? t('edit.discardConfirm') : t('edit.discardDraft')}
                  onClick={() => {
                    if (confirmDiscard !== draft.key) { setConfirmDiscard(draft.key); return }
                    setConfirmDiscard(null)
                    discardDraft(draft.key, true)
                  }}
                >
                  {confirmDiscard === draft.key ? t('edit.discardConfirm') : <RemixIcon name="delete-bin-line" size={13} />}
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
  return <>{noticeStrip}{draftStrip}</>
}
