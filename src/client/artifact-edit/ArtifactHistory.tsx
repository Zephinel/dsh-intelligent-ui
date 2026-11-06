/**
 * Per-artifact revision history modal.
 *
 * Shows metadata only (revision number, source, time, style, edited block
 * titles) — the page itself is not previewed here. Restoring an older revision
 * fetches its program on demand and POSTs the existing restore route, then the
 * card's local-revision pipeline renders the new card.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { RemixIcon } from '../../lib/components/remix-icon.tsx'
import type { ArtifactHistoryProgramResponse, ArtifactHistoryResponse, ArtifactHistoryRevision, ArtifactHistorySource } from '../../shared/artifact-edit.ts'
import type { LocalArtifactRevision } from './local-revisions.ts'
import { fetchArtifactHistory, fetchArtifactHistoryProgram, restoreRevision } from './local-revisions.ts'
import type { Translate } from '../../shared/locales.ts'

/** Title lookup for edited block ids (display id -> known block). */
export type ArtifactHistoryBlocks = ReadonlyMap<string, { readonly title?: string }>

/** Props of the revision history modal. */
export interface ArtifactHistoryProps {
  readonly t: Translate
  readonly artifactId: string
  /** Revision currently rendered by this card (marked as current). */
  readonly currentRevisionId: string
  /** Display blocks of the current card, used to name edited block ids. */
  readonly blocks: ArtifactHistoryBlocks
  readonly onClose: () => void
  /** Called after a successful restore with the restored local revision meta. */
  readonly onRestored: (revision: LocalArtifactRevision) => void
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
function HistoryRow({ t, revision, blocks, restoring, onRestore }: {
  readonly t: Translate
  readonly revision: ArtifactHistoryRevision
  readonly blocks: ArtifactHistoryBlocks
  readonly restoring: boolean
  readonly onRestore: () => void
}): ReactElement {
  const edited = revision.editedBlockIds ?? []
  const styleNote = revision.temporaryStyle !== undefined
    ? t('onDemand.badge')
    : revision.styleId !== undefined ? revision.styleId : revision.style
  const canRestore = revision.restorable && revision.hasProgram && !revision.current && !restoring
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
        <span className="dsh-iui-history-source">{t(sourceLabelKey(revision.source))}</span>
        <span className="dsh-iui-history-spacer" />
        <span className="dsh-iui-history-time">{formatHistoryTime(revision.createdAt)}</span>
      </div>
      <div className="dsh-iui-history-meta">{styleNote}</div>
      {edited.length > 0 ? (
        <div className="dsh-iui-history-blocks">
          <span className="dsh-iui-history-blocks-label">{t('edit.historyChangedBlocks')}</span>
          <ul className="dsh-iui-history-chips">
            {edited.map(blockId => {
              const title = blocks.get(blockId)?.title
              return (
                <li key={blockId} className="dsh-iui-history-chip" title={title ?? blockId} data-block-id={blockId}>
                  {title !== undefined && title.trim() !== '' ? title : blockId}
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="dsh-iui-history-note">{t(sourceLabelKey(revision.source))}</p>
      )}
      {revision.hasProgram ? null : <p className="dsh-iui-history-unavailable">{t('edit.historyUnavailable')}</p>}
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
    </li>
  )
}

/**
 * Renders the per-artifact revision history dialog and its restore actions.
 * @param props - locale, artifact identity, current blocks and close/restore callbacks.
 * @returns the portaled dialog.
 */
export function ArtifactHistory({ t, artifactId, currentRevisionId, blocks, onClose, onRestored }: ArtifactHistoryProps): ReactElement {
  const [status, setStatus] = useState<HistoryStatus>('loading')
  const [history, setHistory] = useState<ArtifactHistoryResponse | undefined>(undefined)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    void fetchArtifactHistory(artifactId).then(result => {
      if (cancelled) return
      if (result === undefined) { setStatus('error'); return }
      setHistory(result)
      setStatus('ready')
    })
    return () => { cancelled = true }
  }, [artifactId, reloadKey])

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (typeof window === 'undefined') return
    window.requestAnimationFrame(() => { closeRef.current?.focus({ preventScroll: true }) })
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      const previous = restoreFocusRef.current
      if (previous !== null && previous.isConnected) window.requestAnimationFrame(() => { previous.focus({ preventScroll: true }) })
    }
  }, [onClose])

  const restore = async (revision: ArtifactHistoryRevision): Promise<void> => {
    if (restoringId !== null) return
    setRestoreError(false)
    setRestoringId(revision.revisionId)
    const program = await fetchArtifactHistoryProgram(artifactId, revision.revisionId)
    const restored = program === undefined
      ? undefined
      : await restoreRevision({ artifactId, sourceRevisionId: revision.revisionId, program: program.program })
    setRestoringId(null)
    if (restored === undefined) { setRestoreError(true); return }
    onRestored(restored)
    setReloadKey(key => key + 1)
  }

  const revisions = history?.revisions ?? []
  const artifactTitle = revisions.find(revision => revision.title !== undefined && revision.title.trim() !== '')?.title ?? artifactId
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
            <p className="dsh-iui-history-subtitle" title={artifactTitle}>{artifactTitle}</p>
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
        {status === 'ready' && revisions.length > 0 ? (
          <ul className="dsh-iui-history-list" data-dsh-iui-history-list>
            {revisions.map(revision => (
              <HistoryRow
                key={revision.revisionId}
                t={t}
                revision={revision}
                blocks={blocks}
                restoring={restoringId === revision.revisionId}
                onRestore={() => { void restore(revision) }}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
