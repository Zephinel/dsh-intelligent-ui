/**
 * Session-scoped pending-edit drafts, docked above the composer card.
 *
 * The edit panel is per-artifact, but the draft switcher is per-chat, so it
 * lives in the composer's `conversation.input.dock` strip instead: one compact
 * horizontal row of draft chips with attach/discard affordances. The DOM hooks
 * are the same as the former panel section, so composer/edit flows and tests
 * keep working; the dock renders nothing while the chat has no pending drafts.
 */
import { useMemo, type ReactNode } from 'react'
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
  attachDraft,
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
  // A pure style-instruction draft has no block selection; label it as a style
  // description instead of falling through to "global instruction".
  if (draft.styleInstruction.trim() !== '') return t('edit.summaryStyle')
  const count = draft.selection.length
  if (count > 0) return t('edit.requestsCount', { count })
  if (draft.orderChanged) return t('edit.summaryOrderChanged')
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
  if (drafts.length === 0) return null
  const attachBlocked = attachedCount >= MAX_ARTIFACT_BATCH_REQUESTS
  return (
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
                {conflict ? <span className="dsh-iui-edit-draft-tag is-conflict">{t('edit.conflictTitle')}</span> : null}
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
                  aria-label={`${t('edit.discardDraft')}: ${title}`}
                  title={t('edit.discardDraft')}
                  onClick={() => { discardDraft(draft.key) }}
                >
                  <RemixIcon name="delete-bin-line" size={13} />
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
