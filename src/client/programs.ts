/**
 * Pure extraction of Intelligent UI programs from one Turn's recorded
 * `tool-call` Chat nodes.
 *
 * This module is deliberately free of React, DOM, and DSH package imports so
 * the Node unit test can load it through Node's TypeScript stripping with no
 * build step (see test/client/programs.test.mjs). It reads the structural
 * subset of the Chat node types that the card needs; `turnDataSource` values
 * are assignable to {@link ToolCallNode} without a cast.
 *
 * Tool name and argument contract live in src/shared/intelligent-ui.ts.
 */
import { RENDER_UI_TOOL, isRenderLayout, type IntelligentUIProgram } from '../shared/intelligent-ui.ts'
import { BLOCK_EDIT_TOOL, isArtifactRevisionMeta } from '../shared/artifact-edit.ts'
import { isCustomStyleId, isStyleSnapshot } from '../shared/style-templates.ts'

/** The subset of `PreparingToolCall` this extractor reads. */
export interface PreparingToolCall {
  readonly phase: 'preparing'
  readonly callId: string
  readonly name: string
}

/** The subset of `StartedToolCall` this extractor reads. */
export interface StartedToolCall {
  readonly phase: 'start'
  readonly callId: string
  readonly name: string
  /** Complete JSON arguments; dispatched calls always carry the full program. */
  readonly argsRaw: string
}

/** The subset of `ToolResultNode` this extractor reads. */
export interface ToolResultNode {
  readonly kind: 'tool-result'
  readonly callId: string
  /** Wire Tool name, empty when its `tool/call` left the loaded window. */
  readonly name: string
  readonly isError: boolean
  /** Paired call head; null when window truncation dropped the arguments. */
  readonly call: { readonly name: string; readonly argsRaw: string } | null
  /** Replayable presentation meta; carries revision lineage for edited results. */
  readonly meta?: unknown
}

/** One root Tool lifecycle, exactly the `turnDataSource(turn, 'tool-call')` value. */
export type ToolCallBlock = PreparingToolCall | StartedToolCall | ToolResultNode

/** One `tool-call` Chat node: the data payload of a root Tool lifecycle. */
export interface ToolCallNode {
  readonly root: ToolCallBlock
}

/**
 * Collect this Turn's `render_ui` programs in invocation order.
 * Calls from other tools, malformed arguments, and results whose call head
 * left the loaded history window contribute nothing.
 * @param nodes - the Turn's `tool-call` node data, in anchor order.
 * @returns one program per completed or dispatched `render_ui` invocation.
 */
export function programsFromToolNodes(nodes: readonly ToolCallNode[] | undefined): IntelligentUIProgram[] {
  if (nodes === undefined) return []
  const programs: IntelligentUIProgram[] = []
  for (const node of nodes) {
    const program = programFromNode(node)
    if (program !== undefined) programs.push(program)
  }
  return programs
}

/** Read one root Tool lifecycle; undefined when it is not a usable render_ui call. */
function programFromNode(node: ToolCallNode | undefined): IntelligentUIProgram | undefined {
  const root = node?.root
  if (root === undefined) return undefined
  if ('kind' in root) {
    if (root.kind !== 'tool-result') return undefined
    // A block-level edit returns only the changed block program; the Host
    // composes the full revision and projects it as result meta.
    if (root.name === BLOCK_EDIT_TOOL) return blockEditProgram(root)
    if (root.name !== RENDER_UI_TOOL) return undefined
    // A failed render_ui call was rejected before the user ever saw a page
    // (host validation error, interruption); the Tool row owns that failure
    // state and the Turn tail shows only answers that actually rendered.
    if (root.isError) return undefined
    // The paired tool/call left the loaded window, so the program is gone.
    if (root.call === null) return undefined
    return programFromArgs(root.call.argsRaw, root.callId, false, root.meta)
  }
  if (root.phase !== 'start' || root.name !== RENDER_UI_TOOL) return undefined
  return programFromArgs(root.argsRaw, root.callId, true)
}

/** Read one completed block-level edit result, which carries the full revision in meta. */
function blockEditProgram(root: ToolResultNode): IntelligentUIProgram | undefined {
  if (root.isError) return undefined
  const meta = root.meta
  if (!isArtifactRevisionMeta(meta) || meta.program === undefined || meta.program.trim() === '') return undefined
  const style = meta.style ?? 'card'
  return {
    callId: root.callId,
    program: meta.program,
    ...meta.title === undefined ? {} : { title: meta.title },
    style,
    ...meta.styleId === undefined ? {} : { styleId: meta.styleId, styleSource: 'template' as const },
    ...meta.temporaryStyle === undefined ? {} : { temporaryStyle: meta.temporaryStyle, styleSource: 'temporary' as const },
    ...meta.baseRevisionId === undefined ? {} : { baseRevisionId: meta.baseRevisionId },
    artifactId: meta.artifactId,
    revisionId: meta.revisionId,
    ...meta.requestId === undefined ? {} : { requestId: meta.requestId },
    revision: meta.revision,
    ...meta.editedBlockIds === undefined ? {} : { editedBlockIds: meta.editedBlockIds },
    running: false,
  }
}

/** Parse model-authored arguments defensively; props are unknown until checked. */
function programFromArgs(argsRaw: string, callId: string, running: boolean, meta?: unknown): IntelligentUIProgram | undefined {
  let args: unknown
  try {
    args = JSON.parse(argsRaw)
  } catch {
    return undefined
  }
  if (typeof args !== 'object' || args === null) return undefined
  const { program, title, style, styleId, temporaryStyle, styleSource } = args as {
    program?: unknown; title?: unknown; style?: unknown; styleId?: unknown; temporaryStyle?: unknown; styleSource?: unknown
  }
  if (typeof program !== 'string' || program.trim() === '') return undefined
  // Replayed model arguments are data too. Do not render a conflicting or invalid snapshot.
  if ('temporaryStyle' in args && (!isStyleSnapshot(temporaryStyle) || temporaryStyle.baseLayout !== style || 'styleId' in args)) return undefined
  // A free layout with no styleId/temporaryStyle is a valid built-in shape only for a
  // live call or a recorded Auto choice (result meta styleSource "builtin"). A replayed
  // template result with a missing or malformed identity stays invalid.
  if (style === 'free' && !isStyleSnapshot(temporaryStyle) && !isCustomStyleId(styleId)) {
    const recordedSource = metaField(meta, 'styleSource')
    if ('styleId' in args || (!running && recordedSource !== 'builtin')) return undefined
  }
  // A style revision is recorded by the Host from result meta; the model may
  // omit args.title, so the recorded title is the fallback for the card header.
  const recordedTitle = metaTitle(meta)
  const recordedSource = metaField(meta, 'styleSource')
  const base = {
    callId,
    program,
    ...typeof title === 'string' ? { title } : recordedTitle === undefined ? {} : { title: recordedTitle },
    ...isRenderLayout(style) ? { style } : {},
    ...isCustomStyleId(styleId) ? { styleId } : {},
    ...isStyleSnapshot(temporaryStyle) ? { temporaryStyle, styleSource: 'temporary' as const }
      : isCustomStyleId(styleId) ? { styleSource: 'template' as const }
      : styleSource === 'builtin' || styleSource === 'template' ? { styleSource }
      : recordedSource === 'builtin' || recordedSource === 'template' ? { styleSource: recordedSource } : {},
    ...metaField(meta, 'document') === true ? { document: true } : {},
    running,
    ...revisionLineage(meta),
  }
  // A Host-normalized revision (for example a deterministically reordered page)
  // is the record the user sees, so render/export/edit from that program.
  const normalized = normalizedProgram(meta)
  return normalized === undefined ? base : { ...base, program: normalized }
}

/** Read one field from a result-meta projection without trusting its shape. */
function metaField(meta: unknown, field: 'styleSource' | 'document'): unknown {
  return typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>)[field] : undefined
}

/** Card title recorded on an edited-result meta projection, when present. */
function metaTitle(meta: unknown): string | undefined {
  if (!isArtifactRevisionMeta(meta)) return undefined
  return meta.title
}

/** Host-normalized program carried by an arrangement result, when present. */
function normalizedProgram(meta: unknown): string | undefined {
  if (!isArtifactRevisionMeta(meta) || meta.program === undefined) return undefined
  return meta.program.trim() === '' ? undefined : meta.program
}

/** Replayable revision lineage projected by the Host on an edited result. */
function revisionLineage(meta: unknown): Pick<IntelligentUIProgram, 'artifactId' | 'revisionId' | 'requestId' | 'baseRevisionId' | 'revision' | 'editedBlockIds' | 'temporaryStyle' | 'styleSource'> {
  if (!isArtifactRevisionMeta(meta)) return {}
  return {
    artifactId: meta.artifactId,
    revisionId: meta.revisionId,
    ...meta.requestId === undefined ? {} : { requestId: meta.requestId },
    ...meta.temporaryStyle === undefined ? {} : { temporaryStyle: meta.temporaryStyle, styleSource: 'temporary' as const },
    ...meta.baseRevisionId === undefined ? {} : { baseRevisionId: meta.baseRevisionId },
    revision: meta.revision,
    ...meta.editedBlockIds === undefined ? {} : { editedBlockIds: meta.editedBlockIds },
  }
}
