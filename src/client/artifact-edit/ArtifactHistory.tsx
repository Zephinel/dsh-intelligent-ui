/**
 * Per-artifact revision history modal.
 *
 * Shows metadata only (revision number, source, time, style, edited block
 * titles) — the page itself is not previewed here. Restoring an older revision
 * fetches its program on demand and POSTs the existing restore route, then the
 * card's local-revision pipeline renders the new card.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { RemixIcon } from '../../lib/components/remix-icon.tsx'
import type { ArtifactHistoryProgramResponse, ArtifactHistoryResponse, ArtifactHistoryRevision, ArtifactHistorySource } from '../../shared/artifact-edit.ts'
import type { LocalArtifactRevision } from './local-revisions.ts'
import { ensureArtifactBase, invalidateArtifactBase } from './artifact-base.ts'
import { deleteArtifactRevision, fetchArtifactHistory, fetchArtifactHistoryProgram, isStyleSwitchRevision, restoreRevision } from './local-revisions.ts'
import { createRevisionFallback, needsRevisionFallback, rollbackTargetFor, type RevisionFallback } from './revision-fallbacks.ts'
import type { Translate } from '../../shared/locales.ts'

/** Title lookup for edited block ids (display id -> known block). */
export type ArtifactHistoryBlocks = ReadonlyMap<string, { readonly title?: string }>

/** Props of the revision history modal. */
export interface ArtifactHistoryProps {
  readonly t: Translate
  readonly artifactId: string
  /** Revision currently rendered by this card (marked as current). */
  readonly currentRevisionId: string
  /** True when this card is a client-owned local card, which deletion removes entirely. */
  readonly renderedRevisionLocal?: boolean
  /** Revision ids owned by client-local revision cards; deleting one records no rollback. */
  readonly localRevisionIds?: ReadonlySet<string>
  /** Revision ids that an unsent draft in this chat is editing. */
  readonly draftRevisionIds?: ReadonlySet<string>
  /** Revisions that a persisted card fallback currently renders. */
  readonly fallbackTargetIds?: ReadonlySet<string>
  /** Revision identities still named by the rendered card programs. */
  readonly renderedRevisionIds?: ReadonlySet<string>
  /** Program of the rendered card, registered as the Host base before authoritative reads. */
  readonly program: string
  /** Display blocks of the current card, used to name edited block ids. */
  readonly blocks: ArtifactHistoryBlocks
  readonly onClose: () => void
  /** Called after a successful restore with the restored local revision meta. */
  readonly onRestored: (revision: LocalArtifactRevision) => void
  /** Called after one recorded revision is deleted (removes its local card or rolls this card back). */
  readonly onDeleted: (revisionId: string, fallback?: RevisionFallback) => void
}

/** Load state of the history request. */
type HistoryStatus = 'loading' | 'error' | 'ready'

/** Locale key for one revision source. */
function sourceLabelKey(source: ArtifactHistorySource): 'edit.historyInitial' | 'edit.historyEdit' | 'edit.historyStructure' | 'edit.historyRestore' {
  if (source === 'initial') return 'edit.historyInitial'
  if (source === 'edit') return 'edit.historyEdit'
  if (source === 'structure') return 'edit.historyStructure'
  return 'edit.historyRestore'
}

/**
 * Localized source label for one revision.
 *
 * A deterministic style switch is recorded as a structure revision with no
 * edited blocks, so it gets its own label instead of the operation one.
 */
function sourceLabel(t: Translate, revision: ArtifactHistoryRevision): string {
  return t(isStyleSwitchRevision(revision) ? 'edit.historyStyleSwitch' : sourceLabelKey(revision.source))
}

/** Short local date/time for one revision timestamp. */
function formatHistoryTime(createdAt: number): string {
  if (!Number.isFinite(createdAt)) return ''
  try {
    return new Date(createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** One revision row's metadata (revision, current, source, blocks). */
function HistoryRow({ t, revision, blocks, restoring, deleting, confirmingDelete, canDelete, rollbackRevision, draftLocked, referencedLocked, dependencyLocked, returnFocusOnCancel, onRestore, onAskDelete, onCancelDelete, onConfirmDelete }: {
  readonly t: Translate
  readonly revision: ArtifactHistoryRevision
  readonly blocks: ArtifactHistoryBlocks
  readonly restoring: boolean
  readonly deleting: boolean
  readonly confirmingDelete: boolean
  /** This revision may be deleted without leaving a card unbound to a record. */
  readonly canDelete: boolean
  /** When set, deleting this revision rolls the opening card back to that revision. */
  readonly rollbackRevision?: number
  /** The opening card cannot delete this revision because it has an open edit draft. */
  readonly draftLocked?: boolean
  /** A newer revision records this one as its base (the Host would refuse). */
  readonly referencedLocked?: boolean
  /** A card still rolls back to this revision and no older fallback exists. */
  readonly dependencyLocked?: boolean
  /** Only the row that was actually cancelled should reclaim focus. */
  readonly returnFocusOnCancel: boolean
  readonly onRestore: () => void
  readonly onAskDelete: () => void
  readonly onCancelDelete: () => void
  readonly onConfirmDelete: () => void
}): ReactElement {
  const edited = revision.editedBlockIds ?? []
  const layoutLabel = revision.style === 'article'
    ? t('edit.historyStyleArticle')
    : revision.style === 'free' ? t('edit.historyStyleFree') : t('edit.historyStyleCard')
  const styleNote = revision.temporaryStyle !== undefined
    ? `${t('onDemand.badge')} · ${layoutLabel}`
    : revision.styleId !== undefined ? `${layoutLabel} · ${t('edit.historyCustomStyle')}` : layoutLabel
  const canRestore = revision.restorable && revision.hasProgram && !revision.current && !restoring
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const previouslyConfirming = useRef(false)
  useLayoutEffect(() => {
    if (confirmingDelete) cancelRef.current?.focus()
    else if (previouslyConfirming.current && returnFocusOnCancel) deleteRef.current?.focus()
    previouslyConfirming.current = confirmingDelete
  }, [confirmingDelete, returnFocusOnCancel])
  return (
    <li
      className="dsh-iui-history-row"
      data-dsh-iui-history-revision={revision.revisionId}
      data-revision={revision.revision}
      data-current={revision.current ? 'true' : undefined}
      data-source={revision.source}
    >
      <div className="dsh-iui-history-row-head">
        <span className="dsh-iui-history-revision">{t('edit.revision', { n: revision.revision })}</span>
        {revision.current ? <span className="dsh-iui-history-current">{t('edit.historyCurrent')}</span> : null}
        <span className="dsh-iui-history-source">{sourceLabel(t, revision)}</span>
        <span className="dsh-iui-history-spacer" />
        <span className="dsh-iui-history-time">{formatHistoryTime(revision.createdAt)}</span>
      </div>
      <div className="dsh-iui-history-meta">{styleNote}</div>
      {edited.length > 0 ? (
        <div className="dsh-iui-history-blocks">
          <span className="dsh-iui-history-blocks-label">{t('edit.historyChangedBlocks')}</span>
          <ul className="dsh-iui-history-chips">
            {edited.map(blockId => {
              const title = blocks.get(blockId)?.title?.trim()
              const label = title !== undefined && title !== '' ? title : t('edit.blockFallback')
              return (
                <li key={blockId} className="dsh-iui-history-chip" title={label} data-block-id={blockId}>
                  {label}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="dsh-iui-history-note">{sourceLabel(t, revision)}</p>
      )}
      {revision.hasProgram ? null : <p className="dsh-iui-history-unavailable">{t('edit.historyUnavailable')}</p>}
      {draftLocked === true ? <p className="dsh-iui-history-note" data-dsh-iui-history-draft-lock>{t('edit.historyDeleteDraftLocked')}</p> : null}
      {draftLocked === true || referencedLocked !== true ? null : <p className="dsh-iui-history-note" data-dsh-iui-history-referenced-lock>{t('edit.historyDeleteReferenced')}</p>}
      {dependencyLocked === true ? <p className="dsh-iui-history-note" data-dsh-iui-history-dependency-lock>{t('edit.historyDeleteDependencyLocked')}</p> : null}
      {revision.restorable && !revision.current ? (
        <div className="dsh-iui-history-actions">
          <button
            type="button"
            className="dsh-iui-history-restore"
            data-dsh-iui-history-restore
            disabled={!canRestore}
            aria-label={t('edit.restoreAction')}
            title={t('edit.restoreAction')}
            onClick={onRestore}
          >
            {restoring ? t('edit.historyLoading') : t('edit.restoreAction')}
          </button>
        </div>
      ) : null}
      {canDelete ? (
        <div className="dsh-iui-history-actions dsh-iui-history-delete-actions">
          {confirmingDelete ? (
            <>
              <span className="dsh-iui-history-delete-warning" role="status" aria-live="polite" data-dsh-iui-history-delete-warning>
                {rollbackRevision === undefined
                  ? t('edit.historyDeleteWarning')
                  : t('edit.historyDeleteRollbackWarning', { n: rollbackRevision })}
              </span>
              <button ref={cancelRef} type="button" className="dsh-iui-history-restore" data-dsh-iui-history-delete-cancel autoFocus disabled={deleting} onClick={onCancelDelete}>
                {t('edit.historyDeleteCancel')}
              </button>
              <button
                type="button"
                className="dsh-iui-history-restore is-danger is-icon"
                data-dsh-iui-history-delete-confirm
                aria-label={t('edit.historyDeleteConfirm')}
                title={t('edit.historyDeleteConfirm')}
                disabled={deleting}
                onClick={onConfirmDelete}
              >
                <RemixIcon name="delete-bin-line" size={13} />
              </button>
            </>
          ) : (
            <button
              ref={deleteRef}
              type="button"
              className="dsh-iui-history-restore is-danger is-icon"
              data-dsh-iui-history-delete
              aria-label={t('edit.historyDelete')}
              title={t('edit.historyDelete')}
              disabled={deleting || restoring}
              onClick={onAskDelete}
            >
              <RemixIcon name="delete-bin-line" size={13} />
            </button>
          )}
        </div>
      ) : null}
    </li>
  )
}

/**
 * Renders the per-artifact revision history dialog and its restore actions.
 * @param props - locale, artifact identity, current blocks and close/restore callbacks.
 * @returns the portaled dialog.
 */
export function ArtifactHistory({ t, artifactId, currentRevisionId, renderedRevisionLocal = false, localRevisionIds, draftRevisionIds, fallbackTargetIds, renderedRevisionIds, program, blocks, onClose, onRestored, onDeleted }: ArtifactHistoryProps): ReactElement {
  const [status, setStatus] = useState<HistoryStatus>('loading')
  const [history, setHistory] = useState<ArtifactHistoryResponse | undefined>(undefined)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState(false)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<'referenced' | 'missing' | 'unavailable' | 'fallback' | 'failed' | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const returnFocusToDialog = useRef(false)
  const titleId = useId()

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    // The list (and its initial-revision row) is authoritative Host state: make
    // sure this rendered card has been registered as the base first.
    void ensureArtifactBase({ artifactId, revisionId: currentRevisionId, program }).then(() => fetchArtifactHistory(artifactId)).then(result => {
      if (cancelled) return
      if (result === undefined) { setStatus('error'); return }
      // The Host reports whether each revision's program is still retained. If
      // our own base revision lost its program (eviction / restarted Host
      // state), drop the cached registration so restore or the next
      // authoritative click re-posts the rendered program once.
      if (result.revisions.some(revision => revision.revisionId === currentRevisionId && revision.hasProgram === false)) {
        invalidateArtifactBase(artifactId, currentRevisionId)
      }
      setHistory(result)
      setStatus('ready')
    })
    return () => { cancelled = true }
  }, [artifactId, currentRevisionId, program, reloadKey])

  useEffect(() => {
    if (!returnFocusToDialog.current) return
    returnFocusToDialog.current = false
    closeRef.current?.focus({ preventScroll: true })
  }, [reloadKey])

  useLayoutEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (typeof window === 'undefined') return
    // Focus synchronously: a deferred close-focus can steal focus from the
    // delete confirmation when the user acts immediately after opening.
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (dialog === null) return
      const focusables = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      const activeIsFocusable = active instanceof HTMLElement && focusables.includes(active)
      if (event.shiftKey && (active === first || !activeIsFocusable)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !activeIsFocusable)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const previous = restoreFocusRef.current
      if (previous !== null && previous.isConnected) window.requestAnimationFrame(() => { previous.focus({ preventScroll: true }) })
    }
    // Mount/unmount only: parent re-renders pass a fresh onClose function; a
    // dependency on it would re-run the cleanup and could move focus back to
    // the history trigger while the modal is still open.
  }, [])

  const restore = async (revision: ArtifactHistoryRevision): Promise<void> => {
    if (restoringId !== null) return
    setRestoreError(false)
    setRestoringId(revision.revisionId)
    await ensureArtifactBase({ artifactId, revisionId: currentRevisionId, program })
    const sourceProgram = await fetchArtifactHistoryProgram(artifactId, revision.revisionId)
    const restored = sourceProgram === undefined
      ? undefined
      : await restoreRevision({ artifactId, sourceRevisionId: revision.revisionId, program: sourceProgram.program })
    setRestoringId(null)
    if (restored === undefined) { setRestoreError(true); return }
    onRestored(restored)
    setReloadKey(key => key + 1)
  }

  const remove = async (revision: ArtifactHistoryRevision): Promise<void> => {
    if (deletingId !== null || restoringId !== null) return
    setDeleteError(null)
    setDeletingId(revision.revisionId)
    // The Confirm button disables immediately; move focus to the dialog Close
    // so Tab cannot start from a disabled/removed element.
    closeRef.current?.focus({ preventScroll: true })
    // Any card still rendering the deleted revision rolls back to the newest
    // older revision whose program is still retained. The opening card cannot be
    // left unbound, so it requires that target; other rows use it when available
    // and otherwise keep the documented stale-card behavior. A revision owned by
    // a client-local card is removed with that card and needs no rollback.
    let fallback: RevisionFallback | undefined
    const locallyOwned = localRevisionIds?.has(revision.revisionId) === true
    const target = locallyOwned ? undefined : rollbackTargetFor(revisions, revision.revisionId, localRevisionIds)
    const source = target === undefined ? undefined : await fetchArtifactHistoryProgram(artifactId, target.revisionId)
    // A known target whose program could not be loaded is a transient failure:
    // retry instead of deleting without a fallback for other cards.
    if (target !== undefined && source === undefined) {
      setDeletingId(null)
      setDeleteError('fallback')
      return
    }
    if (target === undefined) {
      // The opening card cannot be left unbound, and a revision some card
      // currently rolls back to cannot lose its only live target either.
      const needsFallback = revision.revisionId === currentRevisionId && !renderedRevisionLocal
        || fallbackDependentFor(revision)
      if (needsFallback) {
        setDeletingId(null)
        setDeleteError('unavailable')
        return
      }
    } else {
      // A merely historical row that no rendered card names and no live
      // fallback targets needs no record; writing one would leave a dead entry
      // that later falsely blocks deleting the target revision.
      const liveTargets = fallbackTargetIds ?? new Set<string>()
      const needsRecord = renderedRevisionIds === undefined
        || needsRevisionFallback(revision.revisionId, renderedRevisionIds, liveTargets)
      if (needsRecord) fallback = createRevisionFallback(artifactId, revision.revisionId, target, source.program)
    }
    const outcome = await deleteArtifactRevision(artifactId, revision.revisionId)
    setDeletingId(null)
    // `missing` converges: the Host already deleted it (for example a lost
    // response followed by a retry), so remove the local card and refresh.
    if (outcome === 'missing') {
      setConfirmingDeleteId(null)
      onDeleted(revision.revisionId, fallback)
      setReloadKey(key => key + 1)
      returnFocusToDialog.current = true
      return
    }
    if (outcome !== 'deleted') { setDeleteError(outcome); return }
    setConfirmingDeleteId(null)
    onDeleted(revision.revisionId, fallback)
    setReloadKey(key => key + 1)
    returnFocusToDialog.current = true
  }

  const revisions = history?.revisions ?? []
  // The revision this card renders: deleting it is only offered when the card
  // can roll back (transcript cards) or disappears (local revision cards).
  const renderedRevision = revisions.find(revision => revision.revisionId === currentRevisionId)
  const rollback = renderedRevision === undefined
    ? undefined
    : rollbackTargetFor(revisions, renderedRevision.revisionId, localRevisionIds)
  const draftLockedFor = (revision: ArtifactHistoryRevision): boolean =>
    revision.source !== 'initial' && draftRevisionIds?.has(revision.revisionId) === true
  const referencedLockedFor = (revision: ArtifactHistoryRevision): boolean =>
    revision.source !== 'initial' && revision.referenced === true
  const fallbackDependentFor = (revision: ArtifactHistoryRevision): boolean =>
    fallbackTargetIds?.has(revision.revisionId) === true
  const dependencyLockedFor = (revision: ArtifactHistoryRevision): boolean => revision.source !== 'initial'
    && fallbackDependentFor(revision)
    && rollbackTargetFor(revisions, revision.revisionId, localRevisionIds) === undefined
  const canDelete = (revision: ArtifactHistoryRevision): boolean => revision.source !== 'initial'
    && !draftLockedFor(revision)
    && !referencedLockedFor(revision)
    && !dependencyLockedFor(revision)
    && (revision.revisionId !== currentRevisionId || renderedRevisionLocal || rollback !== undefined)
  const rollbackRevisionFor = (revision: ArtifactHistoryRevision): number | undefined =>
    revision.revisionId === currentRevisionId && !renderedRevisionLocal ? rollback?.revision : undefined
  const artifactTitle = revisions.find(revision => revision.title !== undefined && revision.title.trim() !== '')?.title?.trim()
  const current = revisions.find(revision => revision.current)?.revision

  return createPortal(
    <div
      className="dsh-iui-history-backdrop"
      data-dsh-iui-history-backdrop
      onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        className="dsh-iui-history-dialog"
        data-dsh-iui-history
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dsh-iui-history-head">
          <div className="dsh-iui-history-headings">
            <h2 id={titleId} className="dsh-iui-history-title">{t('edit.history')}</h2>
            {artifactTitle === undefined || artifactTitle === '' ? null : <p className="dsh-iui-history-subtitle" title={artifactTitle}>{artifactTitle}</p>}
            {current === undefined ? null : <p className="dsh-iui-history-caption">{t('edit.historyLatest', { n: current })}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="dsh-iui-history-close"
            data-dsh-iui-history-close
            aria-label={t('edit.historyClose')}
            title={t('edit.historyClose')}
            onClick={onClose}
          >
            <RemixIcon name="close-line" size={16} />
          </button>
        </div>
        {status === 'loading' ? <p className="dsh-iui-history-status" data-dsh-iui-history-loading role="status">{t('edit.historyLoading')}</p> : null}
        {status === 'error' ? <p className="dsh-iui-history-status is-error" data-dsh-iui-history-error role="alert">{t('edit.historyLoadFailed')}</p> : null}
        {status === 'ready' && revisions.length === 0 ? <p className="dsh-iui-history-status" data-dsh-iui-history-empty>{t('edit.historyEmpty')}</p> : null}
        {restoreError ? <p className="dsh-iui-history-status is-error" data-dsh-iui-history-restore-error role="alert">{t('edit.restoreFailed')}</p> : null}
        {deleteError === null ? null : (
          <p className="dsh-iui-history-status is-error" data-dsh-iui-history-delete-error role="alert">
            {t(deleteError === 'referenced' ? 'edit.historyDeleteReferenced'
              : deleteError === 'missing' ? 'edit.historyDeleteMissing'
                : deleteError === 'unavailable' ? 'edit.historyDeleteUnavailable'
                  : deleteError === 'fallback' ? 'edit.historyDeleteFallbackFailed'
                    : 'edit.historyDeleteFailed')}
          </p>
        )}
        {status === 'ready' && revisions.length > 0 ? (
          <ul className="dsh-iui-history-list" data-dsh-iui-history-list>
            {revisions.map(revision => (
              <HistoryRow
                key={revision.revisionId}
                t={t}
                revision={revision}
                blocks={blocks}
                restoring={restoringId === revision.revisionId}
                deleting={deletingId === revision.revisionId}
                confirmingDelete={confirmingDeleteId === revision.revisionId}
                canDelete={canDelete(revision)}
                rollbackRevision={rollbackRevisionFor(revision)}
                draftLocked={draftLockedFor(revision)}
                referencedLocked={referencedLockedFor(revision)}
                dependencyLocked={dependencyLockedFor(revision)}
                returnFocusOnCancel={confirmingDeleteId === null}
                onRestore={() => { void restore(revision) }}
                onAskDelete={() => { setDeleteError(null); setConfirmingDeleteId(revision.revisionId) }}
                onCancelDelete={() => { setConfirmingDeleteId(null) }}
                onConfirmDelete={() => { void remove(revision) }}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
