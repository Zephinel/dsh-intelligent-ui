/**
 * Pure lookups behind the assistant-message export entry.
 *
 * The export button is seated in the standard message action row, whose owner
 * currency is only the finalized assistant `messageId`. To decide whether that
 * message's Turn actually rendered Intelligent UI, this module maps the durable
 * message identity back to its Turn through the Chat Assistant Nodes and then
 * reads that Turn's recorded `tool-call` nodes. The `render_ui` tool call is the
 * durable marker: no extra session field is written.
 *
 * This module is deliberately free of React, DOM, and DSH package imports so
 * the Node unit test can load it through Node's TypeScript stripping with no
 * build step.
 */
import type { IntelligentUIProgram } from '../shared/intelligent-ui.ts'
import { programsFromToolNodes, type ToolCallNode } from './programs.ts'

/** One Chat node value: the structural subset the lookups read. */
export interface ExportNodeLike {
  readonly kind: string
  readonly data: unknown
}

/** One finalized assistant message payload, as published by the Chat target. */
interface AssistantDataLike {
  readonly turn?: unknown
  readonly finalNode?: { readonly messageId?: unknown } | null
}

/** Structural Chat snapshot the lookups accept (a real ChatSnapshot is assignable). */
export interface ExportChatSnapshot {
  readonly nodes: {
    /** @returns the currently materialized Chat nodes. */
    values(): Iterable<ExportNodeLike>
    /**
     * Observe one Turn's nodes for a single kind.
     * @param turn - resolved owning Turn.
     * @param kind - business node kind.
     * @returns the current snapshot of that Turn's nodes.
     */
    turnDataSource(turn: number, kind: 'tool-call'): { getSnapshot(): readonly ToolCallNode[] }
  }
}

/** Cache program presence per Turn node array; the store reuses unchanged arrays. */
const programPresence = new WeakMap<readonly ToolCallNode[], boolean>()

/** Cache the messageId-to-Turn index per immutable snapshot. */
const turnIndexes = new WeakMap<object, Map<string, number>>()

/** Cache per-Turn render_ui presence per immutable snapshot. */
const renderUiTurns = new WeakMap<object, Map<number, boolean>>()

/**
 * Build (or reuse) the messageId-to-Turn index for one snapshot.
 * @param snapshot - current Chat snapshot.
 * @returns the cached immutable index.
 */
function turnIndex(snapshot: ExportChatSnapshot): Map<string, number> {
  const key = snapshot as object
  const cached = turnIndexes.get(key)
  if (cached !== undefined) return cached
  const index = new Map<string, number>()
  for (const node of snapshot.nodes.values()) {
    if (node.kind !== 'assistant-step') continue
    const data = node.data as AssistantDataLike | null | undefined
    const turn = data?.turn
    const messageId = data?.finalNode?.messageId
    if (typeof turn === 'number' && Number.isFinite(turn) && typeof messageId === 'string' && messageId !== '') {
      index.set(messageId, turn)
    }
  }
  turnIndexes.set(key, index)
  return index
}

/**
 * Resolve the Turn that owns one finalized assistant message.
 * @param snapshot - current Chat snapshot.
 * @param messageId - durable assistant message identity.
 * @returns the owning Turn, or undefined when the message is outside the loaded evidence.
 */
export function turnForMessage(snapshot: ExportChatSnapshot, messageId: string): number | undefined {
  return turnIndex(snapshot).get(messageId)
}

/**
 * Whether one Turn's node array yields at least one usable program.
 * Reuses the same extractor the card renders with, so the export entry can
 * never be visible for a call the card would skip. The per-array cache keeps
 * the Chat publication selector cheap while the Turn is unchanged.
 * @param nodes - the Turn's `tool-call` node data.
 * @returns true when at least one render_ui program can be rendered.
 */
function nodesHaveProgram(nodes: readonly ToolCallNode[]): boolean {
  const cached = programPresence.get(nodes)
  if (cached !== undefined) return cached
  const found = programsFromToolNodes(nodes).length > 0
  programPresence.set(nodes, found)
  return found
}

/**
 * Whether one Turn recorded at least one usable render_ui program.
 * @param snapshot - current Chat snapshot.
 * @param turn - resolved owning Turn.
 * @returns true when the Turn's answer has a rendered program.
 */
export function turnHasRenderUi(snapshot: ExportChatSnapshot, turn: number): boolean {
  const key = snapshot as object
  let cache = renderUiTurns.get(key)
  const cached = cache?.get(turn)
  if (cached !== undefined) return cached
  let found: boolean
  try {
    const nodes = snapshot.nodes.turnDataSource(turn, 'tool-call').getSnapshot() as readonly ToolCallNode[]
    found = nodesHaveProgram(nodes)
  } catch {
    // A transient failure must not be cached as "no render_ui" for this
    // snapshot; the next publication gets another try.
    return false
  }
  if (cache === undefined) {
    cache = new Map()
    renderUiTurns.set(key, cache)
  }
  cache.set(turn, found)
  return found
}

/**
 * Whether one finalized assistant message rendered Intelligent UI.
 * @param snapshot - current Chat snapshot.
 * @param messageId - durable assistant message identity.
 * @returns true when the export entry should exist for that message.
 */
export function messageHasRenderUi(snapshot: ExportChatSnapshot, messageId: string): boolean {
  const turn = turnForMessage(snapshot, messageId)
  return turn !== undefined && turnHasRenderUi(snapshot, turn)
}

/**
 * Read every program rendered by one finalized assistant message, in invocation order.
 * @param snapshot - current Chat snapshot.
 * @param messageId - durable assistant message identity.
 * @returns the Turn's programs; empty when the message has none.
 */
export function programsForMessage(snapshot: ExportChatSnapshot, messageId: string): IntelligentUIProgram[] {
  const turn = turnForMessage(snapshot, messageId)
  if (turn === undefined) return []
  try {
    const nodes = snapshot.nodes.turnDataSource(turn, 'tool-call').getSnapshot()
    return programsFromToolNodes(nodes)
  } catch {
    return []
  }
}
