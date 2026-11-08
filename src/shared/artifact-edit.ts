/**
 * Shared contract for targeted Artifact block editing.
 *
 * The browser half identifies the root-level blocks of one rendered
 * `render_ui` program, lets the user attach one instruction per block, and
 * serializes the result into a structured, model-facing user message. The
 * message travels through the normal composer send path, so the model receives
 * the request together with the original program; the Host half parses the
 * same envelope back to validate the edit and record a new revision.
 *
 * This module is pure data and string work: no React, DOM, Node or parser
 * imports, so tests can load it through Node's type stripping.
 */
import type { RenderLayout } from './intelligent-ui.ts'
import { isStyleSnapshot, type StyleSnapshot } from './style-templates.ts'

/** Envelope version persisted in the model-facing text. */
export const ARTIFACT_EDIT_SCHEMA_VERSION = 1

/** Envelope discriminator for revision-bound natural-language style edits. */
export const ARTIFACT_STYLE_EDIT_KIND = 'style'
/** Optional discriminator marker for block edits; serializers never emit it. */
export const ARTIFACT_BLOCK_EDIT_KIND = 'blocks'

/** Tool the model calls for block-level edits (Phase 1: selected top-level blocks). */
export const BLOCK_EDIT_TOOL = 'edit_ui_blocks'

/** Opening line of the model-facing envelope. */
export const ARTIFACT_EDIT_OPEN = '<artifact-edit-request>'
/** Closing line of the model-facing envelope. */
export const ARTIFACT_EDIT_CLOSE = '</artifact-edit-request>'
/** Opening line of the pasted original program. */
export const ARTIFACT_PROGRAM_OPEN = '<artifact-program>'
/** Closing line of the pasted original program. */
export const ARTIFACT_PROGRAM_CLOSE = '</artifact-program>'

/** Reference source name registered with the composer trigger pipeline. */
export const ARTIFACT_EDIT_SOURCE = 'artifact-edit'
/** Clipboard projection of the composer chip. */
export const ARTIFACT_EDIT_CLIPBOARD = '@artifact-edit'
/** Human-readable summary node id rendered inside a sent user message. */
export const ARTIFACT_EDIT_SUMMARY = 'artifact-edit-summary'

/** Hard caps shared by the composer validation and the Host. */
export const MAX_ARTIFACT_EDITS = 12
/** One Send may batch this many artifact edit requests (M3 multi-card). */
export const MAX_ARTIFACT_BATCH_REQUESTS = 3
/** One chat may keep this many unsent drafts (M3 multi-card). */
export const MAX_ARTIFACT_DRAFTS = 6
/** Batch-wide program budget for multi-artifact sends. */
export const MAX_ARTIFACT_BATCH_PROGRAM_CHARS = 120_000
/** Batch-wide edit-instruction count for multi-artifact sends. */
export const MAX_ARTIFACT_BATCH_EDITS = 24
/** Maximum number of top-level blocks one arrangement request may move. */
export const MAX_TARGET_ORDER_BLOCKS = 100
export const MAX_BLOCK_INSTRUCTION_CHARS = 2000
export const MAX_GLOBAL_INSTRUCTION_CHARS = 4000
/** Bound on the natural-language style instruction of one style envelope. */
export const MAX_STYLE_INSTRUCTION_CHARS = 2000
export const MAX_ARTIFACT_PROGRAM_CHARS = 200_000
export const MAX_ARTIFACT_TITLE_CHARS = 200

/** Stable identity shape for artifact and revision ids (tool call ids). */
export const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9_:.-]{1,200}$/

/**
 * Whether one revision id is an artifact's initial revision identity.
 *
 * The first render's tool call id is both the artifact id and the id of its
 * revision 1. Revision 1 is stored only as an authoritative program (never as
 * a revision record; recorded revisions start at 2), so this check is how the
 * Host recognizes the unrecorded initial revision without scanning history.
 * @param artifactId - artifact identity (the first render call id).
 * @param revisionId - candidate revision identity.
 * @returns true when revisionId names that artifact's first render.
 */
export function isInitialRevisionId(artifactId: string, revisionId: string): boolean {
  return artifactId === revisionId
}

/** Coarse classification used by the edit panel copy. */
export const ARTIFACT_BLOCK_KINDS = [
  'section', 'card', 'table', 'chart', 'interactive', 'drawing', 'media', 'container',
  'divider', 'spacer', 'toc', 'heading', 'caption', 'content',
] as const
/** How one root-level block is labelled in the edit panel. */
export type ArtifactBlockKind = (typeof ARTIFACT_BLOCK_KINDS)[number]

/** One addressable root-level block of one Artifact revision. */
export interface ArtifactBlock {
  /** Display identity: top-level `bN`; nested `bN.M.K`. */
  readonly blockId: string
  /** Revision-scoped identity from the shared CST tree (top-level and nested). */
  readonly nodeId?: string
  /** Parent display block id, absent for root-level blocks. */
  readonly parentBlockId?: string
  /** Nesting depth; 0 for root-level blocks. */
  readonly depth?: number
  /** Digest of the node's resolved expression source, used to bind edits to a revision. */
  readonly sourceDigest?: string
  /** Structural path of the underlying OpenUI Lang node, e.g. `root[3]`. */
  readonly nodePath: string
  /** Position among the editable blocks, 1-based. */
  readonly originalIndex: number
  /** Zero-based index among the root layout's direct children. */
  readonly rootIndex: number
  /** OpenUI Lang component name of the block's root node. */
  readonly componentType: string
  /** Coarse kind for panel copy and validation. */
  readonly kind: ArtifactBlockKind
  /** Source statement name when the block is a named statement. */
  readonly statementId?: string
  /** Display title derived from the block's own Title/first text. */
  readonly title?: string
}

/** One saved block instruction selected by the user. */
export interface ArtifactBlockEdit {
  readonly blockId: string
  readonly nodePath: string
  /** Revision-scoped CST node id for nested edits; absent for legacy top-level requests. */
  readonly nodeId?: string
  /** Digest of the base node's source, checked by the Host before replacement. */
  readonly sourceDigest?: string
  readonly parentBlockId?: string
  readonly depth?: number
  readonly originalIndex: number
  /** Selection order in this edit session; 1-based, stable while selected. */
  readonly selectionOrder: number
  readonly componentType: string
  readonly title?: string
  /** User-authored requirement for this block; non-empty when saved. */
  readonly instruction: string
}

/** Maximum model-generated additions in one request. */
export const MAX_ARTIFACT_ADDITIONS = 4

/** One request to add a model-generated block inside a container. */
export interface ArtifactBlockAddition {
  readonly parentBlockId: string
  /** CST node id of the parent container (root node id for the page root). */
  readonly parentNodeId: string
  /** Insertion index among the parent's editable children. */
  readonly index: number
  /** User-authored instruction for the new block. */
  readonly instruction: string
}

/** The complete structured block/arrangement edit intent sent to the model. */
export interface ArtifactBlockEditRequest {
  /** Optional discriminator; absent on legacy envelopes and never serialized. */
  readonly kind?: typeof ARTIFACT_BLOCK_EDIT_KIND
  readonly schemaVersion: typeof ARTIFACT_EDIT_SCHEMA_VERSION
  /** Identity of the rendered artifact (first revision's call id). */
  readonly artifactId: string
  /** Revision the user saw and edited; guards against stale edits. */
  readonly baseRevisionId: string
  /** 1-based revision number of `baseRevisionId`. */
  readonly baseRevision: number
  /** Stable per-draft request id; the Host binds tool calls to it in a batch. */
  readonly requestId?: string
  /** Display title of the artifact, when it had one. */
  readonly title?: string
  /** Recorded presentation style; the update must keep it. */
  readonly style: RenderLayout
  /** Recorded custom template id, when the artifact used one. */
  readonly styleId?: string
  /** Result-owned temporary style snapshot, when the artifact used one. */
  readonly temporaryStyle?: StyleSnapshot
  /** Instructions, in selection order. Empty for a reorder-only request. */
  readonly edits: readonly ArtifactBlockEdit[]
  /** Requests for model-generated new blocks, in insertion order. */
  readonly additions?: readonly ArtifactBlockAddition[]
  /** Target order of every editable top-level block id (a permutation of the base revision's blocks). */
  readonly targetOrder: readonly string[]
  /**
   * M4 hierarchical order: parent node id ('root' or a CST node id) -> complete
   * child node-id permutation for that parent's `children` slot. Only changed
   * groups are sent; the Host validates them against the base program tree.
   */
  readonly orderByParent?: Readonly<Record<string, readonly string[]>>
  /** Client-side hint that the target order differs from the base order; the Host recomputes it. */
  readonly orderChanged?: boolean
  /** Explicitly base the new revision on an older revision instead of the current head. */
  readonly branch?: boolean
  /** Optional strict mode: reject any change to a block the user did not select. */
  readonly strict?: boolean
  /** Cross-block constraints and global style requirements. */
  readonly globalInstruction?: string
  /** Complete OpenUI Lang program the user was looking at. */
  readonly program: string
}

/**
 * One revision-bound natural-language style edit request.
 *
 * It carries no block targets: the model returns the complete base program with
 * only the presentation changed, and the Host records a new revision whose
 * lineage keeps the recorded layout/skin.
 */
export interface ArtifactStyleEditRequest {
  readonly kind: typeof ARTIFACT_STYLE_EDIT_KIND
  readonly schemaVersion: typeof ARTIFACT_EDIT_SCHEMA_VERSION
  /** The Host binds the style result to exactly this request id; required. */
  readonly requestId: string
  /** Identity of the rendered artifact (first revision's call id). */
  readonly artifactId: string
  /** Revision the user saw and edited; guards against stale edits. */
  readonly baseRevisionId: string
  /** 1-based revision number of `baseRevisionId`. */
  readonly baseRevision: number
  /** Display title of the artifact, when it had one. */
  readonly title?: string
  /** Recorded base layout; the returned program must keep it. */
  readonly style: RenderLayout
  /** Recorded custom template id, when the artifact used one. */
  readonly styleId?: string
  /** Recorded result-owned temporary skin; the returned program must keep it. */
  readonly temporaryStyle?: StyleSnapshot
  /** Explicitly base the new revision on an older revision instead of the current head. */
  readonly branch?: boolean
  /** Natural-language presentation requirement. */
  readonly styleInstruction: string
  /** Complete OpenUI Lang program the user was looking at. */
  readonly program: string
}

/** The structured edit intent carried by one model-facing envelope. */
export type ArtifactEditRequest = ArtifactBlockEditRequest | ArtifactStyleEditRequest

/**
 * Whether one parsed request is the natural-language style branch.
 * @param request - shape-valid edit request.
 * @returns true for style requests, narrowing the union.
 */
export function isStyleEditRequest(request: ArtifactEditRequest): request is ArtifactStyleEditRequest {
  return request.kind === ARTIFACT_STYLE_EDIT_KIND
}


/** Revision lineage projected onto the render_ui result meta. */
export interface ArtifactRevisionMeta {
  /** Root artifact identity (first revision's result id). */
  readonly artifactId: string
  /** This revision's result id (the tool call id). */
  readonly revisionId: string
  /** Edit request id this revision fulfilled, when it came from the edit pipeline. */
  readonly requestId?: string
  /** Parent revision this update was based on. */
  readonly baseRevisionId?: string
  /** 1-based revision number. */
  readonly revision: number
  /** Blocks the user asked to change. */
  readonly editedBlockIds?: readonly string[]
  /** Host-normalized program (e.g. deterministically reordered); overrides the raw tool argument when present. */
  readonly program?: string
  /** Card title for a block-edit result (the model does not return the whole page). */
  readonly title?: string
  /** Recorded layout style for a block-edit result. */
  readonly style?: RenderLayout
  /** Recorded custom template id for a block-edit result. */
  readonly styleId?: string
  /** Result-owned temporary style snapshot for a block-edit result. */
  readonly temporaryStyle?: StyleSnapshot
}

/** Latest-revision probe answered by the Host route. */
export interface ArtifactRevisionStatus {
  readonly artifactId: string
  /** Revision the caller asked about. */
  readonly revisionId: string
  /** Known revision number of `revisionId`. */
  readonly revision: number
  /** Latest known revision id for the artifact. */
  readonly latestRevisionId: string
  /** Latest known revision number for the artifact. */
  readonly latestRevision: number
  /** True when `revisionId` is not the latest revision. */
  readonly conflict: boolean
}

/** Route path for the latest-revision probe. */
export const ARTIFACT_REVISION_ROUTE_PATH = '/api/intelligent-ui/artifact-revisions'


/** Route path for one artifact's revision history (metadata only). */
export const ARTIFACT_HISTORY_ROUTE_PATH = '/api/intelligent-ui/artifact-history'

/** Route path for fetching one revision's program on demand. */
export const ARTIFACT_HISTORY_PROGRAM_ROUTE_PATH = '/api/intelligent-ui/artifact-history/program'

/** Why a revision exists. */
export type ArtifactHistorySource = 'initial' | 'edit' | 'structure' | 'restore'

/** One revision in one artifact's history (metadata only, newest first). */
export interface ArtifactHistoryRevision {
  readonly revisionId: string
  readonly revision: number
  readonly baseRevisionId?: string
  readonly title?: string
  readonly style: RenderLayout
  readonly styleId?: string
  readonly temporaryStyle?: StyleSnapshot
  readonly editedBlockIds?: readonly string[]
  readonly createdAt: number
  /** True for the current latest revision. */
  readonly current: boolean
  /** Where the revision came from. */
  readonly source: ArtifactHistorySource
  /** Whether the authoritative program is still retained. */
  readonly hasProgram: boolean
  /** Whether this revision can be restored as a new one. */
  readonly restorable: boolean
}

/** Response of one artifact's revision history. */
export interface ArtifactHistoryResponse {
  readonly ok: true
  readonly artifactId: string
  readonly latestRevision: number
  readonly revisions: readonly ArtifactHistoryRevision[]
}

/** Response of one revision's program lookup. */
export interface ArtifactHistoryProgramResponse {
  readonly ok: true
  readonly artifactId: string
  readonly revisionId: string
  readonly revision: number
  readonly program: string
}

/** Route path for recording a new revision without a model turn. */
export const ARTIFACT_RESTORE_ROUTE_PATH = '/api/intelligent-ui/artifact-restore'

/** Body of one local restore request: a new revision copying an older one. */
export interface ArtifactRestoreRequest {
  readonly schemaVersion: 1
  readonly artifactId: string
  readonly sourceRevisionId: string
  readonly program: string
}

/** Validate one untrusted restore request body. */
export function describeArtifactRestoreProblem(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'not_an_object'
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !['schemaVersion', 'artifactId', 'sourceRevisionId', 'program'].includes(key))) return 'unknown_field'
  if (record.schemaVersion !== 1) return 'unsupported_version'
  if (typeof record.artifactId !== 'string' || !ARTIFACT_ID_PATTERN.test(record.artifactId)) return 'invalid_artifact_id'
  if (typeof record.sourceRevisionId !== 'string' || !ARTIFACT_ID_PATTERN.test(record.sourceRevisionId)) return 'invalid_source_revision_id'
  if (!isBoundedText(record.program, 1, MAX_ARTIFACT_PROGRAM_CHARS)) return 'invalid_program'
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_ID_PATTERN.test(value)
}

/**
 * Check one bounded, single-line user/author text value.
 *
 * Shared by every artifact route body validator so the cap and the rejected
 * control characters cannot drift between the edit envelope, restore, and base
 * registration contracts.
 * @param value - untrusted value.
 * @param min - minimum trimmed length (1 for non-empty fields).
 * @param max - maximum trimmed length.
 * @returns whether the value is acceptable bounded text.
 */
export function isBoundedText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)
}

/** Whether a value is a tri-state layout the Host can replay. */
export function isEditLayout(value: unknown): value is RenderLayout {
  return value === 'card' || value === 'article' || value === 'free'
}

/**
 * Check one artifact block produced by extraction.
 * @param value - untrusted value.
 * @returns whether it is a complete block reference.
 */
export function isArtifactBlock(value: unknown): value is ArtifactBlock {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.some(key => !['blockId', 'nodePath', 'originalIndex', 'rootIndex', 'componentType', 'kind', 'statementId', 'title'].includes(key))) return false
  return typeof value.blockId === 'string' && /^b[1-9][0-9]{0,3}$/.test(value.blockId)
    && typeof value.nodePath === 'string' && /^root\[[0-9]{1,4}\]$/.test(value.nodePath)
    && typeof value.originalIndex === 'number' && Number.isSafeInteger(value.originalIndex) && value.originalIndex >= 1 && value.originalIndex <= 1000
    && typeof value.rootIndex === 'number' && Number.isSafeInteger(value.rootIndex) && value.rootIndex >= 0 && value.rootIndex <= 1000
    && typeof value.componentType === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value.componentType)
    && ARTIFACT_BLOCK_KINDS.includes(value.kind as ArtifactBlockKind)
    && (!('statementId' in value) || (typeof value.statementId === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(value.statementId)))
    && (!('title' in value) || isBoundedText(value.title, 1, 120))
}

/**
 * Describe why one block edit is unusable, or undefined when it is valid.
 * @param value - untrusted block edit.
 * @returns a short machine-readable problem label.
 */
export function describeBlockEditProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return 'not_an_object'
  const keys = Object.keys(value)
  if (keys.some(key => !['blockId', 'nodePath', 'nodeId', 'sourceDigest', 'parentBlockId', 'depth', 'originalIndex', 'selectionOrder', 'componentType', 'title', 'instruction'].includes(key))) return 'unknown_field'
  if (typeof value.blockId !== 'string' || !/^b[1-9][0-9]{0,3}(\.[1-9][0-9]{0,2})*$/.test(value.blockId)) return 'invalid_block_id'
  if (typeof value.nodePath !== 'string' || !/^(root\[[0-9]{1,4}\]|root(\/children\[[0-9]{1,4}\])+(\/template\[[0-9]{1,4}\])?)$/.test(value.nodePath)) return 'invalid_node_path'
  if ('nodeId' in value && (typeof value.nodeId !== 'string' || value.nodeId.length > 80)) return 'invalid_node_id'
  if ('sourceDigest' in value && (typeof value.sourceDigest !== 'string' || !/^[a-f0-9]{8,32}$/i.test(value.sourceDigest))) return 'invalid_source_digest'
  if ('parentBlockId' in value && (typeof value.parentBlockId !== 'string' || !/^b[1-9][0-9]{0,3}(\.[1-9][0-9]{0,2})*$/.test(value.parentBlockId))) return 'invalid_parent_block_id'
  if ('depth' in value && (typeof value.depth !== 'number' || !Number.isSafeInteger(value.depth) || value.depth < 0 || value.depth > 8)) return 'invalid_depth'
  if (typeof value.originalIndex !== 'number' || !Number.isSafeInteger(value.originalIndex) || value.originalIndex < 1) return 'invalid_original_index'
  if (typeof value.selectionOrder !== 'number' || !Number.isSafeInteger(value.selectionOrder) || value.selectionOrder < 1 || value.selectionOrder > 999) return 'invalid_selection_order'
  if (typeof value.componentType !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value.componentType)) return 'invalid_component_type'
  if ('title' in value && !isBoundedText(value.title, 1, 120)) return 'invalid_title'
  if (!isBoundedText(value.instruction, 1, MAX_BLOCK_INSTRUCTION_CHARS)) return 'invalid_instruction'
  return undefined
}

/**
 * Describe why one structured edit request is unusable, or undefined when valid.
 * Validation is shape-only; block references are checked against the parsed
 * program by the Host (and by the composer before sending). Dispatch follows
 * the `kind` discriminator; legacy block envelopes omit it.
 * @param value - untrusted request value.
 * @returns a short machine-readable problem label with an optional field name.
 */
export function describeEditRequestProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return 'not_an_object'
  if (value.kind === ARTIFACT_STYLE_EDIT_KIND) return describeStyleEditRequestProblem(value)
  return describeBlockEditRequestProblem(value)
}

/** Strict allowlist/shape checks for one block edit envelope. */
function describeBlockEditRequestProblem(value: Record<string, unknown>): string | undefined {
  const keys = Object.keys(value)
  const allowed = ['kind', 'schemaVersion', 'requestId', 'artifactId', 'baseRevisionId', 'baseRevision', 'title', 'style', 'styleId', 'temporaryStyle', 'edits', 'additions', 'targetOrder', 'orderByParent', 'orderChanged', 'branch', 'strict', 'globalInstruction', 'program']
  if (keys.some(key => !allowed.includes(key))) return 'unknown_field'
  if (value.kind !== undefined && value.kind !== ARTIFACT_BLOCK_EDIT_KIND) return 'unknown_kind'
  if (value.schemaVersion !== ARTIFACT_EDIT_SCHEMA_VERSION) return 'unsupported_version'
  if ('requestId' in value && !isRequestId(value.requestId)) return 'invalid_request_id'
  if (!isIdentity(value.artifactId)) return 'invalid_artifact_id'
  if (!isIdentity(value.baseRevisionId)) return 'invalid_base_revision_id'
  if (typeof value.baseRevision !== 'number' || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 1) return 'invalid_base_revision'
  if ('title' in value && !isBoundedText(value.title, 1, MAX_ARTIFACT_TITLE_CHARS)) return 'invalid_title'
  if (!isEditLayout(value.style)) return 'invalid_style'
  if ('styleId' in value && (typeof value.styleId !== 'string' || !/^cs_[a-z0-9]{6,64}$/i.test(value.styleId))) return 'invalid_style_id'
  if ('temporaryStyle' in value) {
    if ('styleId' in value) return 'invalid_temporary_style'
    if (!isStyleSnapshot(value.temporaryStyle) || value.temporaryStyle.baseLayout !== value.style) return 'invalid_temporary_style'
    if (JSON.stringify(value.temporaryStyle).length > 20_000) return 'invalid_temporary_style'
  }
  if (!Array.isArray(value.edits) || value.edits.length > MAX_ARTIFACT_EDITS) return 'invalid_edits'
  if (!Array.isArray(value.targetOrder) || value.targetOrder.length === 0 || value.targetOrder.length > MAX_TARGET_ORDER_BLOCKS) return 'invalid_target_order'
  const targetIds = new Set<string>()
  for (const id of value.targetOrder) {
    if (typeof id !== 'string' || !/^b[1-9][0-9]{0,3}$/.test(id) || targetIds.has(id)) return 'invalid_target_order'
    targetIds.add(id)
  }
  const ids = new Set<string>()
  const orders = new Set<number>()
  for (const edit of value.edits) {
    const problem = describeBlockEditProblem(edit)
    if (problem !== undefined) return problem
    const block = edit as ArtifactBlockEdit
    if (ids.has(block.blockId)) return 'duplicate_block_id'
    if (block.nodeId === undefined && !targetIds.has(block.blockId)) return 'edit_not_in_target_order'
    ids.add(block.blockId)
    // Selection order may legitimately have gaps after deletions; duplicates are not allowed.
    if (orders.has(block.selectionOrder)) return 'duplicate_selection_order'
    orders.add(block.selectionOrder)
  }
  if ('orderChanged' in value && typeof value.orderChanged !== 'boolean') return 'invalid_order_changed'
  if ('additions' in value) {
    if (!Array.isArray(value.additions) || value.additions.length > MAX_ARTIFACT_ADDITIONS) return 'invalid_additions'
    for (const addition of value.additions) {
      if (!isRecord(addition)) return 'invalid_additions'
      if (Object.keys(addition).some(key => !['parentBlockId', 'parentNodeId', 'index', 'instruction'].includes(key))) return 'invalid_additions'
      if (typeof addition.parentBlockId !== 'string' || !/^b[1-9][0-9]{0,3}(\.[1-9][0-9]{0,2})*$/.test(addition.parentBlockId)) return 'invalid_additions'
      if (typeof addition.parentNodeId !== 'string' || !/^n[1-9][0-9]{0,4}$/.test(addition.parentNodeId)) return 'invalid_additions'
      if (typeof addition.index !== 'number' || !Number.isSafeInteger(addition.index) || addition.index < 0 || addition.index > 99) return 'invalid_additions'
      if (!isBoundedText(addition.instruction, 1, MAX_BLOCK_INSTRUCTION_CHARS)) return 'invalid_additions'
    }
  }
  if ('orderByParent' in value) {
    const groups = value.orderByParent
    if (!isRecord(groups)) return 'invalid_order_by_parent'
    const entries = Object.entries(groups)
    if (entries.length > 61) return 'invalid_order_by_parent'
    for (const [parent, order] of entries) {
      if (parent !== 'root' && !/^n[1-9][0-9]{0,4}$/.test(parent)) return 'invalid_order_by_parent'
      if (!Array.isArray(order) || order.length === 0 || order.length > 100) return 'invalid_order_by_parent'
      const seen = new Set<string>()
      for (const id of order) {
        if (typeof id !== 'string' || !/^n[1-9][0-9]{0,4}$/.test(id) || seen.has(id)) return 'invalid_order_by_parent'
        seen.add(id)
      }
    }
  }
  if ('branch' in value && typeof value.branch !== 'boolean') return 'invalid_branch'
  if ('globalInstruction' in value && !isBoundedText(value.globalInstruction, 1, MAX_GLOBAL_INSTRUCTION_CHARS)) return 'invalid_global_instruction'
  if (!isBoundedText(value.program, 1, MAX_ARTIFACT_PROGRAM_CHARS)) return 'invalid_program'
  return undefined
}

/**
 * Strict allowlist/shape checks for one natural-language style envelope.
 *
 * Style requests carry no block targets: every block/arrangement field is
 * rejected as an unknown field, so the style branch can never smuggle content
 * edits past the Host's style application path.
 * @param value - untrusted request value whose kind is 'style'.
 * @returns a short machine-readable problem label, or undefined when valid.
 */
function describeStyleEditRequestProblem(value: Record<string, unknown>): string | undefined {
  const keys = Object.keys(value)
  const allowed = ['kind', 'schemaVersion', 'requestId', 'artifactId', 'baseRevisionId', 'baseRevision', 'title', 'style', 'styleId', 'temporaryStyle', 'branch', 'styleInstruction', 'program']
  if (keys.some(key => !allowed.includes(key))) return 'unknown_field'
  if (value.schemaVersion !== ARTIFACT_EDIT_SCHEMA_VERSION) return 'unsupported_version'
  if (!isRequestId(value.requestId)) return 'invalid_request_id'
  if (!isIdentity(value.artifactId)) return 'invalid_artifact_id'
  if (!isIdentity(value.baseRevisionId)) return 'invalid_base_revision_id'
  if (typeof value.baseRevision !== 'number' || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 1) return 'invalid_base_revision'
  if ('title' in value && !isBoundedText(value.title, 1, MAX_ARTIFACT_TITLE_CHARS)) return 'invalid_title'
  if (!isEditLayout(value.style)) return 'invalid_style'
  if ('styleId' in value && (typeof value.styleId !== 'string' || !/^cs_[a-z0-9]{6,64}$/i.test(value.styleId))) return 'invalid_style_id'
  if ('temporaryStyle' in value) {
    if ('styleId' in value) return 'invalid_temporary_style'
    if (!isStyleSnapshot(value.temporaryStyle) || value.temporaryStyle.baseLayout !== value.style) return 'invalid_temporary_style'
    if (JSON.stringify(value.temporaryStyle).length > 20_000) return 'invalid_temporary_style'
  }
  if ('branch' in value && typeof value.branch !== 'boolean') return 'invalid_branch'
  if (!isBoundedText(value.styleInstruction, 1, MAX_STYLE_INSTRUCTION_CHARS)) return 'invalid_style_instruction'
  if (!isBoundedText(value.program, 1, MAX_ARTIFACT_PROGRAM_CHARS)) return 'invalid_program'
  return undefined
}

/**
 * Whether one `<artifact-edit-request>` occurrence starts a real envelope.
 *
 * A real envelope always carries its JSON header directly after the marker
 * (only whitespace between). Marker text that merely appears inside a user
 * instruction or program body is content, not a new envelope, so the parser
 * cannot be tricked into splitting or truncating a request.
 * @param text - message body.
 * @param at - offset of one `<artifact-edit-request>` occurrence.
 * @returns whether the JSON header follows the marker.
 */
function isEnvelopeStart(text: string, at: number): boolean {
  // A real envelope puts the JSON header on the next line; marker text embedded
  // inline in prose/instructions (even valid JSON) therefore never matches.
  // Serializers also escape `<` in instruction prose, and program-body markers
  // are skipped by nextEnvelopeOpen.
  let cursor = at + ARTIFACT_EDIT_OPEN.length
  if (text[cursor] !== '\n') return false
  cursor += 1
  while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) cursor += 1
  if (text[cursor] !== '{') return false
  const close = text.indexOf(ARTIFACT_EDIT_CLOSE, cursor)
  if (close < 0) return false
  const json = text.slice(cursor, close).trim()
  if (!json.endsWith('}')) return false
  try {
    const value: unknown = JSON.parse(json)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  } catch {
    return false
  }
}

/**
 * One parsed envelope window: the real opener, header end, optional own-line
 * program fence and the last byte of this envelope. The parser, the
 * sent-message summary and the single-envelope parser all consume these
 * windows, so fence handling lives in exactly one place.
 */
interface EnvelopeWindow {
  readonly open: number
  readonly headerEnd: number
  readonly end: number
  readonly program?: { readonly start: number; readonly end: number; readonly program: string }
}

/**
 * Find the line-fenced program section of one envelope.
 *
 * The serializer puts `<artifact-program>` and `</artifact-program>` on their
 * own lines, so a literal marker inside a model-authored Text string can never
 * truncate the program.
 * @param text - one user message body.
 * @returns the opening/closing offsets and the program body.
 */
function programFence(text: string): { open: number; close: number; program: string } | undefined {
  const openMatch = /(?:^|\n)<artifact-program>[ \t]*(?:\n|$)/.exec(text)
  if (openMatch === null) return undefined
  const open = openMatch.index + (openMatch[0].startsWith('\n') ? 1 : 0)
  const bodyStart = text.indexOf('\n', open)
  if (bodyStart < 0) return undefined
  const closePattern = /(?:^|\n)<\/artifact-program>[ \t]*(?:\n|$)/g
  closePattern.lastIndex = bodyStart + 1
  const closeMatch = closePattern.exec(text)
  if (closeMatch === null) return undefined
  const close = closeMatch.index + (closeMatch[0].startsWith('\n') ? 1 : 0)
  return { open, close, program: text.slice(bodyStart + 1, close).trim() }
}

/** Whether one offset sits inside an own-line program body. */
function insideProgramBody(text: string, at: number): boolean {
  const open = text.lastIndexOf(ARTIFACT_PROGRAM_OPEN, at)
  if (open < 0) return false
  const close = text.indexOf(ARTIFACT_PROGRAM_CLOSE, open + ARTIFACT_PROGRAM_OPEN.length)
  return close < 0 || close > at
}

/** Find the next real envelope opening at or after one offset. */
function nextEnvelopeOpen(text: string, from: number): number {
  let at = text.indexOf(ARTIFACT_EDIT_OPEN, from)
  while (at >= 0) {
    if (!insideProgramBody(text, at) && isEnvelopeStart(text, at)) return at
    at = text.indexOf(ARTIFACT_EDIT_OPEN, at + ARTIFACT_EDIT_OPEN.length)
  }
  return -1
}

/**
 * Find the line-fenced program section after one offset.
 * @param text - message body.
 * @param from - offset to start searching from.
 * @returns absolute opening/closing offsets and the program body.
 */
function programFenceFrom(text: string, from: number): EnvelopeWindow['program'] | undefined {
  // A window ends at the next real envelope: searching the whole tail would
  // bind a later request's program to a header that has none.
  const next = nextEnvelopeOpen(text, from)
  const segment = text.slice(from, next < 0 ? text.length : next)
  const fence = programFence(segment)
  if (fence === undefined || fence.program === '') return undefined
  return { start: from + fence.open, end: from + fence.close, program: fence.program }
}

/**
 * Split a message into its envelope windows (one per request).
 * @param text - one user message body.
 * @param from - inclusive search start.
 * @returns the windows in message order.
 */
function scanEnvelopeWindows(text: string, from = 0): EnvelopeWindow[] {
  const windows: EnvelopeWindow[] = []
  let cursor = from
  while (cursor < text.length) {
    const open = nextEnvelopeOpen(text, cursor)
    if (open < 0) break
    const close = text.indexOf(ARTIFACT_EDIT_CLOSE, open + ARTIFACT_EDIT_OPEN.length)
    if (close < 0) break
    const headerEnd = close + ARTIFACT_EDIT_CLOSE.length
    const program = programFenceFrom(text, headerEnd)
    const end = program === undefined ? headerEnd : program.end + ARTIFACT_PROGRAM_CLOSE.length
    windows.push({ open, headerEnd, end, ...program === undefined ? {} : { program } })
    cursor = end
  }
  return windows
}

/** Parse one envelope window into a request. */
function parseEnvelopeWindow(text: string, window: EnvelopeWindow): ArtifactEditRequest | undefined {
  const json = text.slice(window.open + ARTIFACT_EDIT_OPEN.length, window.headerEnd - ARTIFACT_EDIT_CLOSE.length).trim()
  if (json === '' || !json.startsWith('{') || !json.endsWith('}')) return undefined
  let value: unknown
  try { value = JSON.parse(json) } catch { return undefined }
  const program = window.program?.program
  if (program === undefined || program === '') return undefined
  const candidate = { ...(isRecord(value) ? value : {}), program }
  if (describeEditRequestProblem(candidate) !== undefined) return undefined
  return candidate as unknown as ArtifactEditRequest
}

/**
 * Serialize the model-facing user message for one edit request.
 *
 * Dispatches on the envelope kind so existing call sites keep one entry point;
 * block envelopes serialize exactly as before.
 * @param request - complete, validated edit request.
 * @returns the envelope text.
 */
export function buildEditRequestText(request: ArtifactEditRequest): string {
  return isStyleEditRequest(request) ? buildStyleEditRequestText(request) : buildBlockEditRequestText(request)
}

/**
 * Machine-readable tool-call contract for one block/arrangement edit request.
 *
 * Content edits (including additions and mixed order changes) are applied with
 * edit_ui_blocks fragments; order-only/global-only requests are applied with a
 * complete render_ui program. The serializer prose and the Host coupling test
 * both derive from this helper so the model-facing envelope cannot drift from
 * the arguments the Host tools accept.
 * @param request - validated block edit request.
 * @returns the tool, required/optional/forbidden argument names.
 */
export interface BlockEditToolContract {
  readonly tool: typeof BLOCK_EDIT_TOOL | 'render_ui'
  readonly requiredArguments: readonly string[]
  readonly optionalArguments: readonly string[]
  readonly forbiddenArguments: readonly string[]
}
export function blockEditToolContract(request: ArtifactBlockEditRequest): BlockEditToolContract {
  const contentEdits = request.edits.length > 0 || (request.additions?.length ?? 0) > 0
  if (contentEdits) {
    return {
      tool: BLOCK_EDIT_TOOL,
      requiredArguments: ['program'],
      optionalArguments: request.requestId === undefined ? [] : ['requestId', 'artifactId'],
      forbiddenArguments: ['style', 'styleId', 'temporaryStyle'],
    }
  }
  return {
    tool: 'render_ui',
    requiredArguments: ['program', 'style'],
    optionalArguments: [
      ...request.styleId === undefined ? [] : ['styleId'],
      ...request.requestId === undefined ? [] : ['editRequestId'],
    ],
    forbiddenArguments: ['temporaryStyle', 'requestId', 'artifactId'],
  }
}

/**
 * The one branch-edit instruction line shared by every envelope serializer.
 * @param request - envelope request carrying an optional branch flag.
 * @returns the model-facing branch line, or undefined for a normal edit.
 */
export function branchEnvelopeLine(request: { readonly branch?: boolean; readonly baseRevision: number }): string | undefined {
  if (request.branch !== true) return undefined
  return `- This is a branch edit: base revision ${request.baseRevision} is not the current head. Apply only this request; the Host records a new revision based on it and does not overwrite the head.`
}

/**
 * The complete tool arguments a model call must send for a block edit request.
 * Host tests execute exactly these args to keep envelope and Host coupled.
 * @param request - validated block edit request.
 * @param program - mini program for edit_ui_blocks or complete program for render_ui.
 * @returns the host-accepted tool arguments.
 */
export function buildBlockEditToolArgs(request: ArtifactBlockEditRequest, program: string): Record<string, unknown> {
  const contract = blockEditToolContract(request)
  if (contract.tool === BLOCK_EDIT_TOOL) {
    return {
      program,
      ...request.requestId === undefined ? {} : { requestId: request.requestId, artifactId: request.artifactId },
    }
  }
  return {
    program,
    style: request.style,
    ...request.styleId === undefined ? {} : { styleId: request.styleId },
    ...request.requestId === undefined ? {} : { editRequestId: request.requestId },
  }
}

/**
 * Serialize the model-facing user message for one block/arrangement edit request.
 *
 * The returned text is what the composer submits instead of the chip: the JSON
 * header is machine-readable for the Host, the surrounding prose tells the model
 * exactly how to apply the edits, and the program gives it the structure it must
 * modify. JSON strings escape `<` so a user instruction cannot close the header.
 * @param request - complete, validated block edit request.
 * @returns the envelope text.
 */
export function buildBlockEditRequestText(request: ArtifactBlockEditRequest): string {
  const header = JSON.stringify({
    schemaVersion: request.schemaVersion,
    ...request.requestId === undefined ? {} : { requestId: request.requestId },
    artifactId: request.artifactId,
    baseRevisionId: request.baseRevisionId,
    baseRevision: request.baseRevision,
    ...request.title === undefined ? {} : { title: request.title },
    style: request.style,
    ...request.styleId === undefined ? {} : { styleId: request.styleId },
    ...request.temporaryStyle === undefined ? {} : { temporaryStyle: request.temporaryStyle },
    edits: request.edits.map(edit => ({
      blockId: edit.blockId,
      nodePath: edit.nodePath,
      ...edit.nodeId === undefined ? {} : { nodeId: edit.nodeId },
      ...edit.sourceDigest === undefined ? {} : { sourceDigest: edit.sourceDigest },
      ...edit.parentBlockId === undefined ? {} : { parentBlockId: edit.parentBlockId },
      ...edit.depth === undefined ? {} : { depth: edit.depth },
      originalIndex: edit.originalIndex,
      selectionOrder: edit.selectionOrder,
      componentType: edit.componentType,
      ...edit.title === undefined ? {} : { title: edit.title },
      instruction: edit.instruction,
    })),
    targetOrder: [...request.targetOrder],
    ...request.orderByParent === undefined ? {} : { orderByParent: request.orderByParent },
    ...request.additions === undefined ? {} : { additions: request.additions },
    ...request.orderChanged === true ? { orderChanged: true } : {},
    ...request.branch === true ? { branch: true } : {},
    ...request.strict === true ? { strict: true } : {},
    ...request.globalInstruction === undefined ? {} : { globalInstruction: request.globalInstruction },
  }).replace(/</g, '\\u003c')

  const targets = request.edits.map(edit => {
    const name = edit.title === undefined ? edit.componentType : escapeEnvelopeText(edit.title)
    return `${edit.selectionOrder}. ${name} — blockId "${edit.blockId}", nodePath "${edit.nodePath}", originalIndex ${edit.originalIndex}, componentType ${edit.componentType}\n   Instruction: ${escapeEnvelopeText(edit.instruction)}`
  }).join('\n')

  const additionLines = (request.additions ?? []).map((addition, index) =>
    `${index + 1}. Insert into container blockId "${addition.parentBlockId}" (parentNodeId "${addition.parentNodeId}") at position ${addition.index}\n   Instruction: ${escapeEnvelopeText(addition.instruction)}`,
  ).join('\n')
  const additionCount = request.additions?.length ?? 0
  const contentEdits = request.edits.length > 0 || additionCount > 0
  const contract = blockEditToolContract(request)
  const callLine = contract.tool === BLOCK_EDIT_TOOL
    ? `Tool-call contract: call ${contract.tool} exactly once with the mini program described below${contract.optionalArguments.includes('requestId') ? `, passing requestId: ${JSON.stringify(request.requestId)} and artifactId: ${JSON.stringify(request.artifactId)}` : ''}; never pass ${contract.forbiddenArguments.join(', ')}.`
    : `Tool-call contract: call render_ui exactly once with the complete updated program and style: ${JSON.stringify(request.style)}${contract.optionalArguments.includes('styleId') ? `, styleId: ${JSON.stringify(request.styleId)}` : ''}${contract.optionalArguments.includes('editRequestId') ? `, selecting the request with editRequestId: ${JSON.stringify(request.requestId)}` : ''}; never pass ${contract.forbiddenArguments.join(', ')}.`

  const lines = contentEdits
    ? [
        ARTIFACT_EDIT_OPEN,
        header,
        ARTIFACT_EDIT_CLOSE,
        '',
        'This message is a targeted edit request for one existing rendered page (an artifact the user is looking at).',
        `Call the ${BLOCK_EDIT_TOOL} tool exactly once with a mini openui-lang program. Do not call render_ui for this request, do not answer in prose, do not return a diff, and do not redesign the page.`,
        callLine,
        '',
        'Output contract for that tool:',
        `- Return one mini program \`root = Col([...])\` with exactly ${request.edits.length + additionCount} direct children.`,
        `- The first ${request.edits.length} children are the edited versions of the target blocks below, in the same order as the list (each replaces that block).`,
        additionCount === 0 ? '' : `- The next ${additionCount} children are the new blocks to add, in the order listed below (each is inserted into its container; do not wrap it in a page or duplicate existing blocks).`,
        '- Do not include any other block or the whole page.',
        '- You may add new helper statements before/after root (for example a chart data array); do not redefine an existing statement name or `$state` name, and keep every existing helper/state declaration unchanged.',
        '- A target block may reference the page\'s existing statements and `$state`; the full page below is read-only context for those references.',
        '',
        'Editing rules:',
        '- Change only the target blocks listed below, plus the minimum directly related parts needed to complete those changes.',
        '- Keep every unselected block and every part of the page the request does not mention unchanged, including its content, structure and interactive behavior.',
        '- Reuse the existing theme and layout; do not add unrelated sections, restyle the page, or drop existing data.',
        ...branchEnvelopeLine(request) === undefined ? [] : [branchEnvelopeLine(request)!],
        '- Apply all block instructions in the mini program, together with the global instruction below.',
        '- If a block instruction depends on shared state or data, update the minimum related parts consistently.',
        '- Do not reorder the page or the target blocks: the Host applies the requested block order after merging your fragments.',
        '- If the instructions are materially ambiguous or contradict each other, ask one focused question with ask_user_question instead of guessing; otherwise produce the update directly.',
        '',
        `Target blocks (${request.edits.length}):`,
        targets,
        ...additionCount === 0 ? [] : [
          '',
          `New blocks to add (${additionCount}):`,
          additionLines,
        ],
        '',
        `Target order (all editable top-level blocks, first to last): ${request.targetOrder.length} blocks`,
        request.targetOrder.map((id, index) => `${index + 1}. ${id}`).join(', '),
        '',
        'The Host merges the returned fragments into the current page and normalizes that order.',
        '',
        ...request.strict === true ? ['- Strict mode is on: do not change any block that is not listed as a target; the Host rejects the edit if an unselected block changes.'] : [],
        'Global instruction (applies across blocks, may be empty):',
        request.globalInstruction === undefined ? '(none)' : escapeEnvelopeText(request.globalInstruction),
        '',
        `The current page is revision ${request.baseRevision} of its artifact. It is reference context only; do not return it. The blockId, nodePath and originalIndex values above refer to this program:`,
        ARTIFACT_PROGRAM_OPEN,
        request.program,
        ARTIFACT_PROGRAM_CLOSE,
      ]
    : [
        ARTIFACT_EDIT_OPEN,
        header,
        ARTIFACT_EDIT_CLOSE,
        '',
        'This message is a targeted request for one existing rendered page (an artifact the user is looking at). It contains no block content edits.',
        'Call the render_ui tool exactly once with the complete updated program. Do not answer in prose, do not return a diff, and do not redesign the page.',
        callLine,
        '',
        'Editing rules:',
        '- Keep every block unchanged unless the global instruction below requires a change.',
        '- Reuse the existing theme and layout; do not add unrelated sections, restyle the page, or drop existing data.',
        ...branchEnvelopeLine(request) === undefined ? [] : [branchEnvelopeLine(request)!],
        '- Reorder the top-level blocks (the root Col children) to exactly the target order below. Reordering never deletes, duplicates, merges or regenerates a block: keep the same set of top-level blocks and only move them.',
        '- Do not treat the target order as content edits; blocks that are only reordered keep their original body, component identity and interactions.',
        '- The program must be a complete, valid openui-lang program in the same style; the Host rejects an invalid program.',
        '- If the instructions are materially ambiguous or contradict each other, ask one focused question with ask_user_question instead of guessing; otherwise produce the update directly.',
        '',
        `Target order (all editable top-level blocks, first to last): ${request.targetOrder.length} blocks`,
        request.targetOrder.map((id, index) => `${index + 1}. ${id}`).join(', '),
        '',
        'The Host verifies and normalizes the final top-level order; keep every block identifiable by its statement name or title.',
        '',
        ...request.strict === true ? ['- Strict mode is on: do not change any block that is not listed as a target; the Host rejects the edit if an unselected block changes.'] : [],
        'Global instruction (applies across blocks, may be empty):',
        request.globalInstruction === undefined ? '(none)' : escapeEnvelopeText(request.globalInstruction),
        '',
        `The current page is revision ${request.baseRevision} of its artifact. The blockId, nodePath and originalIndex values refer to this program:`,
        ARTIFACT_PROGRAM_OPEN,
        request.program,
        ARTIFACT_PROGRAM_CLOSE,
      ]
  return lines.join('\n')
}

/**
 * Serialized instruction text safe for the envelope prose.
 *
 * A literal `<` would let the instruction spell our delimiter markers and split
 * or truncate the request when the Host parses it back. The JSON header already
 * escapes `<`; the prose repeat uses the same neutral spelling so the visible
 * request stays one envelope.
 * @param text - validated style instruction.
 * @returns the instruction with `<` escaped.
 */
function escapeEnvelopeText(text: string): string {
  return text.replace(/</g, '\\u003c')
}

/**
 * Machine-readable render_ui argument contract for one style edit.
 *
 * The serializer prose, the Host coupling test and the model instructions all
 * derive from this helper so the model-facing envelope cannot drift from the
 * arguments the Host accepts (style + explicit editRequestId + complete
 * temporaryStyle; styleId/artifactId are never tool arguments).
 * @param request - validated style edit request.
 * @returns required tool arguments and forbidden identity fields.
 */
export interface StyleEditToolContract {
  readonly style: ArtifactStyleEditRequest['style']
  readonly editRequestId: string
  readonly requiresTemporaryStyle: true
  readonly requiredArguments: readonly string[]
  readonly optionalArguments: readonly string[]
  readonly forbiddenArguments: readonly string[]
}
export function styleEditToolContract(request: ArtifactStyleEditRequest): StyleEditToolContract {
  return {
    style: request.style,
    editRequestId: request.requestId,
    requiresTemporaryStyle: true,
    requiredArguments: ['program', 'style', 'editRequestId', 'temporaryStyle'],
    optionalArguments: [],
    forbiddenArguments: ['styleId', 'artifactId'],
  }
}

/**
 * The complete render_ui arguments a model call must send for a style edit.
 * Host tests execute exactly these args to keep envelope and Host coupled.
 * @param request - validated style edit request.
 * @param program - complete updated program returned by the model.
 * @param temporaryStyle - complete approved snapshot for the returned program.
 * @returns the host-accepted render_ui arguments.
 */
export function buildStyleEditToolArgs(
  request: ArtifactStyleEditRequest,
  program: string,
  temporaryStyle: StyleSnapshot,
): { program: string; style: ArtifactStyleEditRequest['style']; editRequestId: string; temporaryStyle: StyleSnapshot } {
  const contract = styleEditToolContract(request)
  return { program, style: contract.style, editRequestId: contract.editRequestId, temporaryStyle }
}

/**
 * Serialize the model-facing user message for one natural-language style edit.
 *
 * Unlike block edits this request returns a complete program and always records
 * a result-owned temporary style: built-in, saved-template and temporary bases
 * all instruct a COMPLETE `temporaryStyle` and never a `styleId`. The header
 * carries the base artifact/revision identity for the Host (its `styleId` is
 * identity only). `render_ui` receives `editRequestId`, the recorded `style`
 * and the complete `temporaryStyle`, never `styleId` or `artifactId`.
 * @param request - complete, validated style edit request.
 * @returns the envelope text.
 */
export function buildStyleEditRequestText(request: ArtifactStyleEditRequest): string {
  const header = JSON.stringify({
    schemaVersion: request.schemaVersion,
    kind: ARTIFACT_STYLE_EDIT_KIND,
    requestId: request.requestId,
    artifactId: request.artifactId,
    baseRevisionId: request.baseRevisionId,
    baseRevision: request.baseRevision,
    ...request.title === undefined ? {} : { title: request.title },
    style: request.style,
    // Identity only: records the base revision's saved template; the model must
    // never pass this to render_ui.
    ...request.styleId === undefined ? {} : { styleId: request.styleId },
    ...request.temporaryStyle === undefined ? {} : { temporaryStyle: request.temporaryStyle },
    ...request.branch === true ? { branch: true } : {},
    styleInstruction: request.styleInstruction,
  }).replace(/</g, '\\u003c')

  const recordedSkin = request.temporaryStyle !== undefined
    ? `- The base revision uses a result-owned temporary skin. Extend the recorded temporaryStyle ${escapeEnvelopeText(JSON.stringify(request.temporaryStyle))} with the applied skin, keeping baseLayout ${JSON.stringify(request.style)}.`
    : request.styleId === undefined
      ? `- The base revision uses the built-in ${JSON.stringify(request.style)} layout. Add a COMPLETE temporaryStyle for the returned program: schemaVersion 1, baseLayout ${JSON.stringify(request.style)}, non-empty directives (max 2000 characters) describing the applied skin, and optionally a complete theme object ({light, dark, font, radius, density, shadow}).`
      : `- The base revision uses the saved template ${JSON.stringify(request.styleId)} (layout ${JSON.stringify(request.style)}). Materialize that template's skin as a COMPLETE temporaryStyle on the returned program: schemaVersion 1, baseLayout ${JSON.stringify(request.style)}, non-empty directives (max 2000 characters) describing the applied skin, and optionally a complete theme object copied from the saved template. The edit records a result-owned temporary-style revision and does not modify the saved template.`

  const lines = [
    ARTIFACT_EDIT_OPEN,
    header,
    ARTIFACT_EDIT_CLOSE,
    '',
    'This message is a targeted style edit request for one existing rendered page (an artifact the user is looking at). It changes presentation, not the content the page carries.',
    'Call the render_ui tool exactly once with the complete updated program. Do not answer in prose, do not return a diff, and do not switch to another page layout.',
    `Pass editRequestId: ${JSON.stringify(styleEditToolContract(request).editRequestId)} in the tool arguments so the Host applies exactly this request.`,
    `Tool-call contract: pass style: ${JSON.stringify(styleEditToolContract(request).style)} and the complete temporaryStyle; never pass ${styleEditToolContract(request).forbiddenArguments.join(' or ')}. The Host reads the page and base revision identity from the envelope header.`,
    '',
    'Style contract for that call:',
    '- Apply the style instruction below to the visual presentation: colour palette, typography, spacing, surfaces, borders, radii, shadows and other decoration.',
    recordedSkin,
    '- Return the complete page program, not only the parts that look different; keep every block and statement identifiable by its statement name or title.',
    '- Preserve every block\'s content, structure, data and interactive behaviour unless the style instruction explicitly asks to change it. The Host validates the returned program and warns when blocks change unexpectedly.',
    '- Do not reorder, add or remove blocks unless the style instruction explicitly asks for it.',
    '- If the instruction is materially ambiguous, ask one focused question with ask_user_question instead of guessing; otherwise produce the update directly.',
    ...branchEnvelopeLine(request) === undefined ? [] : [branchEnvelopeLine(request)!],
    '',
    'Style instruction:',
    escapeEnvelopeText(request.styleInstruction),
    '',
    `The current page is revision ${request.baseRevision} of its artifact. It is reference context: return the same page with only the requested presentation changes. The envelope header above is machine-readable identity for the Host; its styleId (when present) is the base revision's saved template and must not be passed to render_ui.`,
    ARTIFACT_PROGRAM_OPEN,
    request.program,
    ARTIFACT_PROGRAM_CLOSE,
  ]
  return lines.join('\n')
}

/** Request ids generated per draft; safe inside the JSON header and Host maps. */
export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value)
}

/** Whether one id has the shape of a recognized top-level block id. */
export function isArtifactBlockId(value: unknown): value is string {
  return typeof value === 'string' && /^b[1-9][0-9]{0,3}$/.test(value)
}

/**
 * Check a target order against the base revision's block ids.
 * @param targetOrder - requested order, any shape.
 * @param baseBlockIds - recognized top-level block ids of the base program, in page order.
 * @returns a machine-readable problem, or undefined for a complete permutation.
 */
export function describeTargetOrderProblem(targetOrder: readonly string[], baseBlockIds: readonly string[]): string | undefined {
  if (targetOrder.length !== baseBlockIds.length) return 'wrong_length'
  const base = new Set(baseBlockIds)
  const seen = new Set<string>()
  for (const id of targetOrder) {
    if (!isArtifactBlockId(id) || !base.has(id)) return 'unknown_block'
    if (seen.has(id)) return 'duplicate_block'
    seen.add(id)
  }
  for (const id of baseBlockIds) if (!seen.has(id)) return 'missing_block'
  return undefined
}

/** Whether two block-id orders differ. */
export function isReorderedOrder(originalOrder: readonly string[], targetOrder: readonly string[]): boolean {
  return originalOrder.length !== targetOrder.length || originalOrder.some((id, index) => id !== targetOrder[index])
}

/**
 * Whether a block request changes nothing at all (no edits, same order, no global instruction).
 * @param request - shape-valid block edit request.
 * @param baseBlockIds - recognized top-level block ids of the base program, in page order.
 * @returns true for a no-op request.
 */
export function isNoOpEditRequest(request: ArtifactBlockEditRequest, baseBlockIds: readonly string[]): boolean {
  return request.edits.length === 0
    && (request.additions?.length ?? 0) === 0
    && (request.globalInstruction?.trim() ?? '') === ''
    && !isReorderedOrder(baseBlockIds, request.targetOrder)
}

/**
 * Parse one user message body into every structured edit request it carries.
 *
 * A multi-artifact send concatenates one envelope per chip; each envelope is
 * parsed independently so one malformed request cannot hide the others.
 * @param text - one user message text block.
 * @returns the parsed requests in message order (empty for ordinary messages).
 */
export function parseEditRequestTexts(text: string): ArtifactEditRequest[] {
  if (!text.includes(ARTIFACT_EDIT_OPEN)) return []
  const requests: ArtifactEditRequest[] = []
  for (const window of scanEnvelopeWindows(text)) {
    const parsed = parseEnvelopeWindow(text, window)
    if (parsed !== undefined) requests.push(parsed)
  }
  return requests
}

/**
 * Parse one user message body into a structured edit request.
 *
 * Returns undefined for ordinary messages so the Host observer stays cheap.
 * Shape validation only; block references are verified against the program.
 * @param text - one user message text block.
 * @returns the parsed request, or undefined.
 */
export function parseEditRequestText(text: string): ArtifactEditRequest | undefined {
  if (!text.includes(ARTIFACT_EDIT_OPEN)) return undefined
  const [window] = scanEnvelopeWindows(text)
  return window === undefined ? undefined : parseEnvelopeWindow(text, window)
}

/**
 * Check that a value is a complete, shape-valid edit request.
 * @param value - untrusted value.
 * @returns whether it can be used as an edit request.
 */
export function isArtifactEditRequest(value: unknown): value is ArtifactEditRequest {
  return describeEditRequestProblem(value) === undefined
}

/**
 * Find the next complete edit envelope at or after one offset, for the
 * sent-message summary node. The range covers the header and the pasted
 * program so a sent message renders one compact chip, not the raw payload.
 * Style envelopes report `style: true` and no block/arrangement facts.
 * @param text - original user message body.
 * @param from - inclusive search start.
 * @returns the covered range and summary facts, or undefined.
 */
export function nextEditRequestSummary(text: string, from: number): { start: number; end: number; count: number; globalOnly: boolean; reordered: boolean; hasGlobal: boolean; style: boolean } | undefined {
  const [window] = scanEnvelopeWindows(text, from)
  if (window === undefined) return undefined
  const start = window.open
  const close = window.headerEnd - ARTIFACT_EDIT_CLOSE.length
  const end = window.end
  let count = 0
  let globalOnly = false
  let reordered = false
  let hasGlobal = false
  let style = false
  try {
    const value = JSON.parse(text.slice(start + ARTIFACT_EDIT_OPEN.length, close)) as { kind?: unknown; edits?: unknown; globalInstruction?: unknown; orderChanged?: unknown }
    style = value.kind === ARTIFACT_STYLE_EDIT_KIND
    if (!style) {
      if (Array.isArray(value.edits)) count = value.edits.length
      reordered = value.orderChanged === true
      hasGlobal = typeof value.globalInstruction === 'string' && value.globalInstruction.trim() !== ''
      globalOnly = count === 0 && !reordered && hasGlobal
    }
  } catch { /* the range still collapses, only the summary is unknown */ }
  return { start, end, count, globalOnly, reordered, hasGlobal, style }
}

/**
 * Check the Host projection of one completed revision.
 * @param value - untrusted value from a render_ui result meta.
 * @returns whether it is a complete revision lineage record.
 */
export function isArtifactRevisionMeta(value: unknown): value is ArtifactRevisionMeta {
  if (!isRecord(value)) return false
  if (Object.keys(value).some(key => !['artifactId', 'revisionId', 'requestId', 'baseRevisionId', 'revision', 'editedBlockIds', 'program', 'title', 'style', 'styleId', 'temporaryStyle'].includes(key))) return false
  if ('program' in value && !isBoundedText(value.program, 1, MAX_ARTIFACT_PROGRAM_CHARS)) return false
  if ('title' in value && !isBoundedText(value.title, 1, MAX_ARTIFACT_TITLE_CHARS)) return false
  if ('style' in value && !isEditLayout(value.style)) return false
  if ('styleId' in value && (typeof value.styleId !== 'string' || !/^cs_[a-z0-9]{6,64}$/i.test(value.styleId))) return false
  if ('temporaryStyle' in value && (!isStyleSnapshot(value.temporaryStyle) || value.temporaryStyle.baseLayout !== value.style)) return false
  return isIdentity(value.artifactId) && isIdentity(value.revisionId)
    && (!('requestId' in value) || isRequestId(value.requestId))
    && (!('baseRevisionId' in value) || isIdentity(value.baseRevisionId))
    && typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision >= 1 && value.revision <= 100000
    && (!('editedBlockIds' in value) || (Array.isArray(value.editedBlockIds)
      && value.editedBlockIds.length <= MAX_ARTIFACT_EDITS
      && value.editedBlockIds.every(id => typeof id === 'string' && /^b[1-9][0-9]{0,3}$/.test(id))))
}

/**
 * Check the Host answer of the revision probe.
 * @param value - untrusted route response.
 * @returns whether it is a complete revision status.
 */
export function isArtifactRevisionStatus(value: unknown): value is ArtifactRevisionStatus {
  if (!isRecord(value)) return false
  if (Object.keys(value).some(key => !['artifactId', 'revisionId', 'revision', 'latestRevisionId', 'latestRevision', 'conflict'].includes(key))) return false
  return isIdentity(value.artifactId) && isIdentity(value.revisionId) && isIdentity(value.latestRevisionId)
    && typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision >= 1
    && typeof value.latestRevision === 'number' && Number.isSafeInteger(value.latestRevision) && value.latestRevision >= 1
    && typeof value.conflict === 'boolean'
}
