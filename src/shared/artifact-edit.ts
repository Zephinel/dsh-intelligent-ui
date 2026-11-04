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

/** Envelope version persisted in the model-facing text. */
export const ARTIFACT_EDIT_SCHEMA_VERSION = 1

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
/** Maximum number of top-level blocks one arrangement request may move. */
export const MAX_TARGET_ORDER_BLOCKS = 100
export const MAX_BLOCK_INSTRUCTION_CHARS = 2000
export const MAX_GLOBAL_INSTRUCTION_CHARS = 4000
export const MAX_ARTIFACT_PROGRAM_CHARS = 200_000
export const MAX_ARTIFACT_TITLE_CHARS = 200

/** Stable identity shape for artifact and revision ids (tool call ids). */
export const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9_:.-]{1,200}$/

/** Coarse classification used by the edit panel copy. */
export const ARTIFACT_BLOCK_KINDS = [
  'section', 'card', 'table', 'chart', 'interactive', 'drawing', 'media', 'container', 'content',
] as const
/** How one root-level block is labelled in the edit panel. */
export type ArtifactBlockKind = (typeof ARTIFACT_BLOCK_KINDS)[number]

/** One addressable root-level block of one Artifact revision. */
export interface ArtifactBlock {
  /** Stable per-revision identity: `b<originalIndex>`. */
  readonly blockId: string
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
  readonly originalIndex: number
  /** Selection order in this edit session; 1-based, stable while selected. */
  readonly selectionOrder: number
  readonly componentType: string
  readonly title?: string
  /** User-authored requirement for this block; non-empty when saved. */
  readonly instruction: string
}

/** The complete structured edit intent sent to the model. */
export interface ArtifactEditRequest {
  readonly schemaVersion: typeof ARTIFACT_EDIT_SCHEMA_VERSION
  /** Identity of the rendered artifact (first revision's call id). */
  readonly artifactId: string
  /** Revision the user saw and edited; guards against stale edits. */
  readonly baseRevisionId: string
  /** 1-based revision number of `baseRevisionId`. */
  readonly baseRevision: number
  /** Display title of the artifact, when it had one. */
  readonly title?: string
  /** Recorded presentation style; the update must keep it. */
  readonly style: RenderLayout
  /** Recorded custom template id, when the artifact used one. */
  readonly styleId?: string
  /** Instructions, in selection order. Empty for a reorder-only request. */
  readonly edits: readonly ArtifactBlockEdit[]
  /** Target order of every editable top-level block id (a permutation of the base revision's blocks). */
  readonly targetOrder: readonly string[]
  /** Client-side hint that the target order differs from the base order; the Host recomputes it. */
  readonly orderChanged?: boolean
  /** Cross-block constraints and global style requirements. */
  readonly globalInstruction?: string
  /** Complete OpenUI Lang program the user was looking at. */
  readonly program: string
}

/** Revision lineage projected onto the render_ui result meta. */
export interface ArtifactRevisionMeta {
  /** Root artifact identity (first revision's result id). */
  readonly artifactId: string
  /** This revision's result id (the tool call id). */
  readonly revisionId: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_ID_PATTERN.test(value)
}

function isBoundedText(value: unknown, min: number, max: number): value is string {
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
  if (keys.some(key => !['blockId', 'nodePath', 'originalIndex', 'selectionOrder', 'componentType', 'title', 'instruction'].includes(key))) return 'unknown_field'
  if (typeof value.blockId !== 'string' || !/^b[1-9][0-9]{0,3}$/.test(value.blockId)) return 'invalid_block_id'
  if (typeof value.nodePath !== 'string' || !/^root\[[0-9]{1,4}\]$/.test(value.nodePath)) return 'invalid_node_path'
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
 * program by the Host (and by the composer before sending).
 * @param value - untrusted request value.
 * @returns a short machine-readable problem label with an optional field name.
 */
export function describeEditRequestProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return 'not_an_object'
  const keys = Object.keys(value)
  const allowed = ['schemaVersion', 'artifactId', 'baseRevisionId', 'baseRevision', 'title', 'style', 'styleId', 'edits', 'targetOrder', 'orderChanged', 'globalInstruction', 'program']
  if (keys.some(key => !allowed.includes(key))) return 'unknown_field'
  if (value.schemaVersion !== ARTIFACT_EDIT_SCHEMA_VERSION) return 'unsupported_version'
  if (!isIdentity(value.artifactId)) return 'invalid_artifact_id'
  if (!isIdentity(value.baseRevisionId)) return 'invalid_base_revision_id'
  if (typeof value.baseRevision !== 'number' || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 1) return 'invalid_base_revision'
  if ('title' in value && !isBoundedText(value.title, 1, MAX_ARTIFACT_TITLE_CHARS)) return 'invalid_title'
  if (!isEditLayout(value.style)) return 'invalid_style'
  if ('styleId' in value && (typeof value.styleId !== 'string' || !/^cs_[a-z0-9]{6,64}$/i.test(value.styleId))) return 'invalid_style_id'
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
    if (!targetIds.has(block.blockId)) return 'edit_not_in_target_order'
    ids.add(block.blockId)
    // Selection order may legitimately have gaps after deletions; duplicates are not allowed.
    if (orders.has(block.selectionOrder)) return 'duplicate_selection_order'
    orders.add(block.selectionOrder)
  }
  if ('orderChanged' in value && typeof value.orderChanged !== 'boolean') return 'invalid_order_changed'
  if ('globalInstruction' in value && !isBoundedText(value.globalInstruction, 1, MAX_GLOBAL_INSTRUCTION_CHARS)) return 'invalid_global_instruction'
  if (!isBoundedText(value.program, 1, MAX_ARTIFACT_PROGRAM_CHARS)) return 'invalid_program'
  return undefined
}

/**
 * Split an envelope text into its JSON header and the original program.
 * The program is the last fenced section, so a `<artifact-program>`-like
 * string inside a model-authored Text literal cannot truncate it.
 * @param text - one user message body.
 * @returns the raw JSON string and program body, or undefined.
 */
function splitEnvelope(text: string): { json: string; program: string; rest: string } | undefined {
  const open = text.indexOf(ARTIFACT_EDIT_OPEN)
  const close = text.indexOf(ARTIFACT_EDIT_CLOSE)
  if (open < 0 || close < 0 || close < open) return undefined
  const json = text.slice(open + ARTIFACT_EDIT_OPEN.length, close).trim()
  if (json === '' || !json.startsWith('{') || !json.endsWith('}')) return undefined
  const programOpen = text.lastIndexOf(ARTIFACT_PROGRAM_OPEN)
  const programClose = text.lastIndexOf(ARTIFACT_PROGRAM_CLOSE)
  const program = programOpen >= 0 && programClose > programOpen
    ? text.slice(programOpen + ARTIFACT_PROGRAM_OPEN.length, programClose).trim()
    : ''
  if (program === '') return undefined
  const rest = `${text.slice(0, open)}${text.slice(close + ARTIFACT_EDIT_CLOSE.length, programOpen >= 0 ? programOpen : undefined)}`
  return { json, program, rest }
}

/**
 * Serialize the model-facing user message for one edit request.
 *
 * The returned text is what the composer submits instead of the chip: the JSON
 * header is machine-readable for the Host, the surrounding prose tells the model
 * exactly how to apply the edits, and the program gives it the structure it must
 * modify. JSON strings escape `<` so a user instruction cannot close the header.
 * @param request - complete, validated edit request.
 * @returns the envelope text.
 */
export function buildEditRequestText(request: ArtifactEditRequest): string {
  const header = JSON.stringify({
    schemaVersion: request.schemaVersion,
    artifactId: request.artifactId,
    baseRevisionId: request.baseRevisionId,
    baseRevision: request.baseRevision,
    ...request.title === undefined ? {} : { title: request.title },
    style: request.style,
    ...request.styleId === undefined ? {} : { styleId: request.styleId },
    edits: request.edits.map(edit => ({
      blockId: edit.blockId,
      nodePath: edit.nodePath,
      originalIndex: edit.originalIndex,
      selectionOrder: edit.selectionOrder,
      componentType: edit.componentType,
      ...edit.title === undefined ? {} : { title: edit.title },
      instruction: edit.instruction,
    })),
    targetOrder: [...request.targetOrder],
    ...request.orderChanged === true ? { orderChanged: true } : {},
    ...request.globalInstruction === undefined ? {} : { globalInstruction: request.globalInstruction },
  }).replace(/</g, '\\u003c')

  const targets = request.edits.map(edit => {
    const name = edit.title === undefined ? edit.componentType : edit.title
    return `${edit.selectionOrder}. ${name} — blockId "${edit.blockId}", nodePath "${edit.nodePath}", originalIndex ${edit.originalIndex}, componentType ${edit.componentType}\n   Instruction: ${edit.instruction}`
  }).join('\n')

  const contentEdits = request.edits.length > 0
  const styleLine = contentEdits
    ? `- Keep the recorded page style (${JSON.stringify(request.style)}${request.styleId === undefined ? '' : `, styleId ${JSON.stringify(request.styleId)}`}); the Host reuses it, do not pass style arguments to ${BLOCK_EDIT_TOOL}.`
    : request.styleId === undefined
      ? `- Keep the recorded page style: pass style: ${JSON.stringify(request.style)} to render_ui.`
      : `- Keep the recorded page style: pass style: ${JSON.stringify(request.style)} and styleId: ${JSON.stringify(request.styleId)} to render_ui.`

  const lines = contentEdits
    ? [
        ARTIFACT_EDIT_OPEN,
        header,
        ARTIFACT_EDIT_CLOSE,
        '',
        'This message is a targeted edit request for one existing rendered page (an artifact the user is looking at).',
        `Call the ${BLOCK_EDIT_TOOL} tool exactly once with a mini openui-lang program. Do not call render_ui for this request, do not answer in prose, do not return a diff, and do not redesign the page.`,
        '',
        'Output contract for that tool:',
        '- Return one mini program `root = Col([...])` whose direct children are exactly the edited versions of the target blocks listed below, in the same order as the list.',
        '- Each child replaces that block in the page. Do not include any other block or the whole page.',
        '- You may add new helper statements before/after root (for example a chart data array); do not redefine an existing statement name or `$state` name, and keep every existing helper/state declaration unchanged.',
        '- A target block may reference the page\'s existing statements and `$state`; the full page below is read-only context for those references.',
        '',
        'Editing rules:',
        '- Change only the target blocks listed below, plus the minimum directly related parts needed to complete those changes.',
        '- Keep every unselected block and every part of the page the request does not mention unchanged, including its content, structure and interactive behavior.',
        '- Reuse the existing theme and layout; do not add unrelated sections, restyle the page, or drop existing data.',
        styleLine,
        '- Apply all block instructions in the mini program, together with the global instruction below.',
        '- If a block instruction depends on shared state or data, update the minimum related parts consistently.',
        '- Do not reorder the page or the target blocks: the Host applies the requested block order after merging your fragments.',
        '- If the instructions are materially ambiguous or contradict each other, ask one focused question with ask_user_question instead of guessing; otherwise produce the update directly.',
        '',
        `Target blocks (${request.edits.length}):`,
        targets,
        '',
        `Target order (all editable top-level blocks, first to last): ${request.targetOrder.length} blocks`,
        request.targetOrder.map((id, index) => `${index + 1}. ${id}`).join(', '),
        '',
        'The Host merges the returned fragments into the current page and normalizes that order.',
        '',
        'Global instruction (applies across blocks, may be empty):',
        request.globalInstruction === undefined ? '(none)' : request.globalInstruction,
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
        '',
        'Editing rules:',
        '- Keep every block unchanged unless the global instruction below requires a change.',
        '- Reuse the existing theme and layout; do not add unrelated sections, restyle the page, or drop existing data.',
        styleLine,
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
        'Global instruction (applies across blocks, may be empty):',
        request.globalInstruction === undefined ? '(none)' : request.globalInstruction,
        '',
        `The current page is revision ${request.baseRevision} of its artifact. The blockId, nodePath and originalIndex values refer to this program:`,
        ARTIFACT_PROGRAM_OPEN,
        request.program,
        ARTIFACT_PROGRAM_CLOSE,
      ]
  return lines.join('\n')
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
 * Whether a request changes nothing at all (no edits, same order, no global instruction).
 * @param request - shape-valid edit request.
 * @param baseBlockIds - recognized top-level block ids of the base program, in page order.
 * @returns true for a no-op request.
 */
export function isNoOpEditRequest(request: ArtifactEditRequest, baseBlockIds: readonly string[]): boolean {
  return request.edits.length === 0
    && (request.globalInstruction?.trim() ?? '') === ''
    && !isReorderedOrder(baseBlockIds, request.targetOrder)
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
  const parts = splitEnvelope(text)
  if (parts === undefined) return undefined
  let value: unknown
  try { value = JSON.parse(parts.json) } catch { return undefined }
  const candidate = { ...(isRecord(value) ? value : {}), program: parts.program }
  if (describeEditRequestProblem(candidate) !== undefined) return undefined
  return candidate as unknown as ArtifactEditRequest
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
 * @param text - original user message body.
 * @param from - inclusive search start.
 * @returns the covered range and summary facts, or undefined.
 */
export function nextEditRequestSummary(text: string, from: number): { start: number; end: number; count: number; globalOnly: boolean; reordered: boolean; hasGlobal: boolean } | undefined {
  const start = text.indexOf(ARTIFACT_EDIT_OPEN, from)
  if (start < 0) return undefined
  const close = text.indexOf(ARTIFACT_EDIT_CLOSE, start + ARTIFACT_EDIT_OPEN.length)
  if (close < 0) return undefined
  const programOpen = text.lastIndexOf(ARTIFACT_PROGRAM_OPEN)
  const programClose = text.lastIndexOf(ARTIFACT_PROGRAM_CLOSE)
  const headerEnd = close + ARTIFACT_EDIT_CLOSE.length
  const end = programOpen > close && programClose > programOpen ? programClose + ARTIFACT_PROGRAM_CLOSE.length : headerEnd
  let count = 0
  let globalOnly = false
  let reordered = false
  let hasGlobal = false
  try {
    const value = JSON.parse(text.slice(start + ARTIFACT_EDIT_OPEN.length, close)) as { edits?: unknown; globalInstruction?: unknown; orderChanged?: unknown }
    if (Array.isArray(value.edits)) count = value.edits.length
    reordered = value.orderChanged === true
    hasGlobal = typeof value.globalInstruction === 'string' && value.globalInstruction.trim() !== ''
    globalOnly = count === 0 && !reordered && hasGlobal
  } catch { /* the range still collapses, only the summary is unknown */ }
  return { start, end, count, globalOnly, reordered, hasGlobal }
}

/**
 * Check the Host projection of one completed revision.
 * @param value - untrusted value from a render_ui result meta.
 * @returns whether it is a complete revision lineage record.
 */
export function isArtifactRevisionMeta(value: unknown): value is ArtifactRevisionMeta {
  if (!isRecord(value)) return false
  if (Object.keys(value).some(key => !['artifactId', 'revisionId', 'baseRevisionId', 'revision', 'editedBlockIds', 'program', 'title', 'style', 'styleId'].includes(key))) return false
  if ('program' in value && !isBoundedText(value.program, 1, MAX_ARTIFACT_PROGRAM_CHARS)) return false
  if ('title' in value && !isBoundedText(value.title, 1, MAX_ARTIFACT_TITLE_CHARS)) return false
  if ('style' in value && !isEditLayout(value.style)) return false
  if ('styleId' in value && (typeof value.styleId !== 'string' || !/^cs_[a-z0-9]{6,64}$/i.test(value.styleId))) return false
  return isIdentity(value.artifactId) && isIdentity(value.revisionId)
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
