/**
 * Shared revision-meta copy helpers for the history dialog and the M2 version
 * bar: source labels, local-revision labels and the compact time format.
 */
import type { ArtifactHistoryRevision, ArtifactHistorySource } from '../../shared/artifact-edit.ts'
import type { Translate } from '../../shared/locales.ts'
import { isStyleSwitchRevision } from './local-revisions.ts'

/** Locale key for one recorded revision source. */
export function historySourceKey(source: ArtifactHistorySource): 'edit.historyInitial' | 'edit.historyEdit' | 'edit.historyStructure' | 'edit.historyRestore' {
  if (source === 'initial') return 'edit.historyInitial'
  if (source === 'edit') return 'edit.historyEdit'
  if (source === 'structure') return 'edit.historyStructure'
  return 'edit.historyRestore'
}

/** Localized source label for one recorded revision. */
export function historySourceLabel(t: Translate, revision: Pick<ArtifactHistoryRevision, 'source' | 'revisionId'> & { readonly editedBlockIds?: readonly string[] }): string {
  return t(isStyleSwitchRevision({
    source: revision.source,
    revisionId: revision.revisionId,
    editedBlockIds: revision.editedBlockIds,
  }) ? 'edit.historyStyleSwitch' : historySourceKey(revision.source))
}

/** Short local date/time for one revision timestamp ('' when unusable). */
export function formatRevisionTime(createdAt: number): string {
  if (!Number.isFinite(createdAt)) return ''
  try {
    return new Date(createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
