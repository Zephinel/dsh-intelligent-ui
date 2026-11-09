/**
 * Pure merge/sort rules for the M2 "recent tasks" version bar.
 *
 * Items come from up to three sources: the Host's history metadata (authoritative
 * revision numbers, sources and timestamps), client-local revision cards
 * (restore/structure/style/props cards that never entered the transcript) and the
 * M1 version store (programs already loaded by rendered cards). The same revision
 * can appear in several sources; history wins for metadata, local cards win for
 * "always selectable", and store-only records fill gaps for revisions whose cards
 * rendered but that the history response did not include.
 */

/** One bar-local source label token. */
export type VersionItemSource = 'initial' | 'edit' | 'structure' | 'restore' | 'style' | 'props'

/** One rendered item of the version bar. */
export interface VersionItem {
  readonly revisionId: string
  readonly revision: number
  readonly source: VersionItemSource
  readonly createdAt?: number
  /** The revision program can be resolved (known or fetchable from the Host). */
  readonly hasProgram: boolean
  /** True for client-local revision cards. */
  readonly local: boolean
  readonly title?: string
  /** Presentation identity used when lazily rendering this revision off-screen. */
  readonly style?: 'card' | 'article' | 'free'
  readonly styleId?: string
  readonly temporaryStyle?: unknown
  readonly baseRevisionId?: string
  /** Whether the revision is the one the stage currently displays. */
  readonly current: boolean
  /** Whether an unsent draft in this chat is editing this revision. */
  readonly draft: boolean
}

/** One Host history row the bar reads (a structural subset). */
export interface VersionHistoryRow {
  readonly revisionId: string
  readonly revision: number
  readonly source: 'initial' | 'edit' | 'structure' | 'restore'
  readonly createdAt: number
  readonly hasProgram: boolean
  readonly editedBlockIds?: readonly string[]
  readonly title?: string
  readonly style?: 'card' | 'article' | 'free'
  readonly styleId?: string
  readonly temporaryStyle?: unknown
  readonly baseRevisionId?: string
}

/** One client-local revision card the bar reads. */
export interface VersionLocalRow {
  readonly revisionId: string
  readonly revision: number
  readonly kind?: 'restore' | 'structure' | 'props' | 'style'
  readonly createdAt: number
  readonly title?: string
  readonly style?: 'card' | 'article' | 'free'
  readonly styleId?: string
  readonly temporaryStyle?: unknown
  readonly baseRevisionId?: string
}

/** One revision the M1 store already knows (program loaded/rendered). */
export interface VersionKnownRow {
  readonly revisionId: string
  readonly revision: number
  readonly localRevision?: boolean
  readonly localRevisionKind?: 'restore' | 'structure' | 'props' | 'style'
  readonly title?: string
  readonly style?: 'card' | 'article' | 'free'
  readonly styleId?: string
  readonly temporaryStyle?: unknown
  readonly baseRevisionId?: string
}

/** Input of {@link buildVersionItems}. */
export interface VersionItemsInput {
  readonly history?: readonly VersionHistoryRow[]
  readonly local?: readonly VersionLocalRow[]
  readonly known?: ReadonlyMap<string, VersionKnownRow>
  readonly selectedRevisionId?: string
  readonly draftRevisionIds?: ReadonlySet<string>
  readonly limit?: number
}

/** Default number of recent revisions shown in the bar. */
export const MAX_VERSION_BAR_ITEMS = 20

/** Map a Host history source (+ style-switch signature) to a bar source token. */
function historyBarSource(row: VersionHistoryRow): VersionItemSource {
  if (row.source === 'initial') return 'initial'
  if (row.source === 'edit') return 'edit'
  if (row.source === 'restore') return 'restore'
  // A deterministic style switch is recorded as a structure revision without
  // edited blocks and a `struct_` id; keep it distinguishable in the bar.
  return row.source === 'structure' && row.revisionId.startsWith('struct_') && (row.editedBlockIds?.length ?? 0) === 0
    ? 'style'
    : 'structure'
}

/** Map a local revision kind to a bar source token. */
function localBarSource(row: VersionLocalRow): VersionItemSource {
  if (row.kind === 'structure') return 'structure'
  if (row.kind === 'style') return 'style'
  if (row.kind === 'props') return 'props'
  return 'restore'
}

/**
 * Build the version-bar items.
 *
 * Merges the three sources by revision id, sorts newest first, marks the current
 * selection and draft ownership, and returns at most `limit` items plus the total
 * count so the caller can point at the detailed list for older revisions.
 * @param input - history rows, local revisions, known records and selection facts.
 * @returns the item list and the undistorted total.
 */
export function buildVersionItems(input: VersionItemsInput): { readonly items: VersionItem[]; readonly total: number } {
  const limit = Math.max(1, input.limit ?? MAX_VERSION_BAR_ITEMS)
  const merged = new Map<string, VersionItem>()
  const put = (item: VersionItem): void => {
    const existing = merged.get(item.revisionId)
    // History rows are authoritative for source/time; local/known rows only add
    // program availability and must not downgrade it.
    merged.set(item.revisionId, existing === undefined ? item : {
      ...existing,
      createdAt: existing.createdAt ?? item.createdAt,
      hasProgram: existing.hasProgram || item.hasProgram,
      local: existing.local || item.local,
      title: existing.title ?? item.title,
      style: existing.style ?? item.style,
      styleId: existing.styleId ?? item.styleId,
      temporaryStyle: existing.temporaryStyle ?? item.temporaryStyle,
      baseRevisionId: existing.baseRevisionId ?? item.baseRevisionId,
    })
  }
  for (const row of input.history ?? []) {
    put({
      revisionId: row.revisionId,
      revision: row.revision,
      source: historyBarSource(row),
      createdAt: row.createdAt,
      hasProgram: row.hasProgram,
      local: false,
      ...row.title === undefined ? {} : { title: row.title },
      ...row.style === undefined ? {} : { style: row.style },
      ...row.styleId === undefined ? {} : { styleId: row.styleId },
      ...row.temporaryStyle === undefined ? {} : { temporaryStyle: row.temporaryStyle },
      ...row.baseRevisionId === undefined ? {} : { baseRevisionId: row.baseRevisionId },
      current: false,
      draft: false,
    })
  }
  for (const row of input.local ?? []) {
    put({
      revisionId: row.revisionId,
      revision: row.revision,
      source: localBarSource(row),
      createdAt: row.createdAt,
      hasProgram: true,
      local: true,
      ...row.title === undefined ? {} : { title: row.title },
      ...row.style === undefined ? {} : { style: row.style },
      ...row.styleId === undefined ? {} : { styleId: row.styleId },
      ...row.temporaryStyle === undefined ? {} : { temporaryStyle: row.temporaryStyle },
      ...row.baseRevisionId === undefined ? {} : { baseRevisionId: row.baseRevisionId },
      current: false,
      draft: false,
    })
  }
  for (const [revisionId, known] of input.known ?? []) {
    if (merged.has(revisionId)) continue
    put({
      revisionId,
      revision: known.revision,
      source: known.localRevision === true ? localBarSource({ revisionId, revision: known.revision, kind: known.localRevisionKind, createdAt: 0 }) : known.revision <= 1 ? 'initial' : 'edit',
      hasProgram: true,
      local: known.localRevision === true,
      ...known.title === undefined ? {} : { title: known.title },
      ...known.style === undefined ? {} : { style: known.style },
      ...known.styleId === undefined ? {} : { styleId: known.styleId },
      ...known.temporaryStyle === undefined ? {} : { temporaryStyle: known.temporaryStyle },
      ...known.baseRevisionId === undefined ? {} : { baseRevisionId: known.baseRevisionId },
      current: false,
      draft: false,
    })
  }
  const all = [...merged.values()]
    .sort((left, right) => right.revision - left.revision)
    .map(item => ({
      ...item,
      current: input.selectedRevisionId !== undefined && item.revisionId === input.selectedRevisionId,
      draft: input.draftRevisionIds?.has(item.revisionId) === true,
    }))
  return { items: all.slice(0, limit), total: all.length }
}
