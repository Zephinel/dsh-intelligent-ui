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
import { RENDER_UI_TOOL, type IntelligentUIProgram } from '../shared/intelligent-ui.ts'

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
    if (root.kind !== 'tool-result' || root.name !== RENDER_UI_TOOL) return undefined
    // A failed render_ui call was rejected before the user ever saw a page
    // (host validation error, interruption); the Tool row owns that failure
    // state and the Turn tail shows only answers that actually rendered.
    if (root.isError) return undefined
    // The paired tool/call left the loaded window, so the program is gone.
    if (root.call === null) return undefined
    return programFromArgs(root.call.argsRaw, root.callId, false)
  }
  if (root.phase !== 'start' || root.name !== RENDER_UI_TOOL) return undefined
  return programFromArgs(root.argsRaw, root.callId, true)
}

/** Parse model-authored arguments defensively; props are unknown until checked. */
function programFromArgs(argsRaw: string, callId: string, running: boolean): IntelligentUIProgram | undefined {
  let args: unknown
  try {
    args = JSON.parse(argsRaw)
  } catch {
    return undefined
  }
  if (typeof args !== 'object' || args === null) return undefined
  const { program, title } = args as { program?: unknown; title?: unknown }
  if (typeof program !== 'string' || program.trim() === '') return undefined
  return typeof title === 'string'
    ? { callId, program, title, running }
    : { callId, program, running }
}
