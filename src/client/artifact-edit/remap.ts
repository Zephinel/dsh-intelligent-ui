/**
 * Pure draft remapping for the save → preview → Apply pipeline (task-11).
 *
 * A queued structure batch creates a new revision whose block ids, order and
 * node identities all change. Before the remaining model request can be sent,
 * the saved selection, additions, target order and nested order must be moved
 * onto the new revision. The CST gives us no cross-revision node identity, so
 * mapping uses display identity: component type + kind + title + relative
 * sibling order. Structure operations only remove/duplicate/move blocks, which
 * keeps that signature stable for every untouched block, while duplicated
 * copies deliberately stay unmapped so they never steal the original's draft.
 *
 * The module is DOM-free and node-loadable so the Node unit tests can cover
 * every branch without a browser.
 */
import { NESTED_CONTAINER_TYPES } from '../../shared/artifact-containers.ts'
import { MAX_ARTIFACT_STRUCTURE_OPERATIONS } from '../../shared/artifact-structure.ts'
import type { ArtifactEditSelectionView, PendingApplyConflict, PendingStructureOp } from './contracts.ts'

/** Structural subset of one display block the remapper needs. */
export interface RemapBlock {
  readonly blockId: string
  readonly componentType: string
  readonly kind: string
  readonly title?: string
  readonly originalIndex: number
  readonly parentBlockId?: string
  readonly depth?: number
}

/** Whether a display block id is a descendant of another (`b1.2` under `b1`). */
export function isBlockDescendant(blockId: string, ancestorBlockId: string): boolean {
  return blockId.startsWith(`${ancestorBlockId}.`)
}

/**
 * Every queued op must stay inside the Host's per-request batch cap. The value is
 * shared with the request validator so the client queue and the Host route can
 * never drift apart.
 */
export const MAX_PENDING_STRUCTURE_OPS: number = MAX_ARTIFACT_STRUCTURE_OPERATIONS

/** One queued op's display label data resolved against the old blocks. */
export function pendingOpBlock(op: PendingStructureOp, blocks: readonly RemapBlock[]): RemapBlock | undefined {
  return blocks.find(block => block.blockId === op.blockId)
}

/**
 * Detect conflicts that must block Apply before any Host request.
 *
 * Rules (from the user's decision):
 * - a queued delete would remove a block (or one of its descendants) that a
 *   saved block request still references;
 * - the same applies when a saved addition's target container would be removed;
 * - a style instruction cannot be mixed with structure operations;
 * - operations must not be duplicated, nested inside each other, or exceed the
 *   Host batch cap, and every op must resolve to a current block.
 * @param input - queued ops plus the saved draft references.
 * @returns every blocking conflict; empty means Apply may proceed.
 */
export function detectPendingConflicts(input: {
  readonly ops: readonly PendingStructureOp[]
  readonly blocks: readonly RemapBlock[]
  readonly selection: readonly Pick<ArtifactEditSelectionView, 'blockId'>[]
  readonly additions?: readonly { readonly parentBlockId: string; readonly instruction: string }[]
  readonly styleInstruction: string
}): PendingApplyConflict[] {
  const { ops, blocks, selection, additions = [], styleInstruction } = input
  const conflicts: PendingApplyConflict[] = []
  if (ops.length === 0) return conflicts
  if (ops.length > MAX_PENDING_STRUCTURE_OPS) conflicts.push({ kind: 'limit', detail: `${ops.length}` })
  if (styleInstruction.trim() !== '') conflicts.push({ kind: 'styleMixed' })
  const ids = ops.map(op => op.blockId)
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  for (const id of new Set(duplicates)) conflicts.push({ kind: 'duplicate', blockId: id })
  for (const op of ops) {
    if (!blocks.some(block => block.blockId === op.blockId)) conflicts.push({ kind: 'unresolved', blockId: op.blockId })
  }
  for (const left of ops) {
    for (const right of ops) {
      if (left === right) continue
      if (isBlockDescendant(right.blockId, left.blockId) || isBlockDescendant(left.blockId, right.blockId)) {
        conflicts.push({ kind: 'overlap', blockId: left.blockId })
        break
      }
    }
  }
  const removed = ops.filter(op => op.op === 'delete').map(op => op.blockId)
  const removedWithDescendants = new Set<string>()
  for (const removedId of removed) {
    for (const block of blocks) {
      if (block.blockId === removedId || isBlockDescendant(block.blockId, removedId)) removedWithDescendants.add(block.blockId)
    }
  }
  for (const entry of selection) {
    if (removedWithDescendants.has(entry.blockId)) conflicts.push({ kind: 'selection', blockId: entry.blockId })
  }
  for (const addition of additions) {
    if (removedWithDescendants.has(addition.parentBlockId)) conflicts.push({ kind: 'addition', blockId: addition.parentBlockId })
  }
  // De-duplicate by kind+block for stable UI lists.
  const seen = new Set<string>()
  return conflicts.filter(conflict => {
    const key = `${conflict.kind}:${conflict.blockId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Containers whose display title is derived from their first child's text.
 *
 * `Section` is excluded: its title is the first literal argument, so it stays
 * stable when a child moves.
 */
const DERIVED_TITLE_CONTAINERS = new Set<string>(NESTED_CONTAINER_TYPES.filter(type => type !== 'Section'))

/**
 * Stable signature used to pair untouched blocks across a structure revision.
 *
 * Leaf blocks keep their intrinsic title in the signature. A container's title
 * is derived from its children (e.g. a `Col` titled after its first `Text`), so
 * deleting or moving that first child would change the title of an otherwise
 * untouched container; pairing it by type + position instead keeps the mapping
 * reliable. Copy slots are already excluded from the mapping by the simulated
 * sibling order, so this cannot let a duplicate steal a saved request.
 */
function blockSignature(block: RemapBlock): string {
  return DERIVED_TITLE_CONTAINERS.has(block.componentType)
    ? `${block.componentType}\u0000${block.kind}\u0000`
    : `${block.componentType}\u0000${block.kind}\u0000${block.title ?? ''}`
}

/** Parent display id of a new block, normalised to the root marker. */
function parentOf(block: RemapBlock): string {
  return block.parentBlockId ?? 'root'
}

/** Old blocks ordered by depth then position, so parents map before children. */
function parentFirst(blocks: readonly RemapBlock[]): RemapBlock[] {
  return [...blocks].sort((left, right) => (left.depth ?? 0) - (right.depth ?? 0) || left.originalIndex - right.originalIndex)
}

/** Result of pairing old blocks with the post-structure revision's blocks. */
export interface BlockMapping {
  /** Old display id → new display id. */
  readonly mapping: ReadonlyMap<string, string>
  /** Old ids a delete removed (no new counterpart). */
  readonly removed: ReadonlySet<string>
  /** New ids that are copies (they never claim an old block's draft). */
  readonly duplicated: ReadonlySet<string>
  /** Old ids that could not be paired (the batch was unexpected). */
  readonly unmapped: readonly string[]
  /**
   * False when the post-batch structure cannot be paired unambiguously (for
   * example a duplicate/move mix or a sibling signature mismatch). Apply must be
   * blocked rather than guessing a target.
   */
  readonly reliable: boolean
}

/** Sibling token of the simulated post-batch order. */
type SiblingToken =
  | { readonly kind: 'old'; readonly id: string }
  | { readonly kind: 'copy'; readonly sourceId: string }

/** Children map of the pre-batch display tree. */
function oldChildGroups(blocks: readonly RemapBlock[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  const sorted = [...blocks].sort((left, right) => left.originalIndex - right.originalIndex)
  for (const block of sorted) {
    const parent = block.parentBlockId ?? 'root'
    const group = groups.get(parent) ?? []
    group.push(block.blockId)
    groups.set(parent, group)
  }
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const leftBlock = blocks.find(block => block.blockId === left)
      const rightBlock = blocks.find(block => block.blockId === right)
      return (leftBlock?.originalIndex ?? 0) - (rightBlock?.originalIndex ?? 0)
    })
  }
  return groups
}

/** Whether an old block is deleted directly or through a deleted ancestor. */
function removedBlockIds(blocks: readonly RemapBlock[], ops: readonly PendingStructureOp[]): Set<string> {
  const byId = new Map(blocks.map(block => [block.blockId, block] as const))
  const deleted = new Set(ops.filter(op => op.op === 'delete').map(op => op.blockId))
  const removed = new Set<string>()
  for (const block of blocks) {
    let cursor: RemapBlock | undefined = block
    while (cursor !== undefined) {
      if (deleted.has(cursor.blockId)) { removed.add(block.blockId); break }
      cursor = cursor.parentBlockId === undefined ? undefined : byId.get(cursor.parentBlockId)
    }
  }
  return removed
}

/**
 * Pair old and new display blocks after one structure batch.
 *
 * The mapping is computed by simulating the batch on the old block order: the
 * queue's deletes remove sibling slots, duplicates insert copy slots directly
 * after their source and moves append the moved block to the target parent (the
 * builder's semantics). The simulated orders are then aligned position-by-
 * position with the authoritative result; copy slots are excluded from the
 * mapping, so a duplicate can never steal a later sibling's saved request.
 *
 * A duplicate mixed with a move in the same batch is rejected as unreliable:
 * the moved source can shift the insertion slots in a way only the Host can
 * normalize, and the pipeline must surface that as a conflict instead of
 * guessing. Sibling count/signature mismatches are likewise unreliable.
 * @param oldBlocks - blocks of the revision the draft was authored on.
 * @param newBlocks - blocks of the revision the batch produced.
 * @param ops - the applied operations (delete/duplicate/move).
 * @returns the old→new mapping, copy ids, removed ids, unmapped ids and reliability.
 */
export function mapOldToNewBlocks(
  oldBlocks: readonly RemapBlock[],
  newBlocks: readonly RemapBlock[],
  ops: readonly PendingStructureOp[],
): BlockMapping {
  const reliableOps = ops.filter(op => op.op === 'duplicate').length === 0 || ops.filter(op => op.op === 'move').length === 0
  const removed = removedBlockIds(oldBlocks, ops)
  const duplicated = new Set<string>()
  const mapping = new Map<string, string>()
  const unmapped: string[] = []
  if (!reliableOps) return { mapping, removed, duplicated, unmapped: oldBlocks.filter(block => !removed.has(block.blockId)).map(block => block.blockId), reliable: false }
  const groups = oldChildGroups(oldBlocks)
  const duplicatesBySource = new Map<string, number>()
  for (const op of ops) {
    if (op.op === 'duplicate') duplicatesBySource.set(op.blockId, (duplicatesBySource.get(op.blockId) ?? 0) + 1)
  }
  // Build the simulated sibling order per old parent.
  const simulated = new Map<string, SiblingToken[]>()
  for (const [parent, children] of groups) {
    const tokens: SiblingToken[] = []
    for (const child of children) {
      if (removed.has(child)) continue
      tokens.push({ kind: 'old', id: child })
      for (let copy = 0; copy < (duplicatesBySource.get(child) ?? 0); copy += 1) tokens.push({ kind: 'copy', sourceId: child })
    }
    simulated.set(parent, tokens)
  }
  // Moves: remove from the source sibling list and append to the target one.
  for (const op of ops) {
    if (op.op !== 'move') continue
    const sourceParent = oldBlocks.find(block => block.blockId === op.blockId)?.parentBlockId ?? 'root'
    const targetParent = op.targetParentBlockId ?? 'root'
    const source = simulated.get(sourceParent)
    if (source === undefined) return { mapping, removed, duplicated, unmapped: [...oldBlocks.filter(block => !removed.has(block.blockId)).map(block => block.blockId)], reliable: false }
    const index = source.findIndex(token => token.kind === 'old' && token.id === op.blockId)
    if (index === -1) return { mapping, removed, duplicated, unmapped: [...oldBlocks.filter(block => !removed.has(block.blockId)).map(block => block.blockId)], reliable: false }
    source.splice(index, 1)
    const target = simulated.get(targetParent) ?? []
    target.push({ kind: 'old', id: op.blockId })
    simulated.set(targetParent, target)
  }
  // Align parent groups in depth order so a container's new id exists before its children.
  const newById = new Map(newBlocks.map(block => [block.blockId, block] as const))
  const newGroups = new Map<string, RemapBlock[]>()
  for (const block of [...newBlocks].sort((left, right) => left.originalIndex - right.originalIndex)) {
    const parent = block.parentBlockId ?? 'root'
    const group = newGroups.get(parent) ?? []
    group.push(block)
    newGroups.set(parent, group)
  }
  const oldDepth = new Map(oldBlocks.map(block => [block.blockId, block.depth ?? 0] as const))
  const orderedParents = [...simulated.keys()].sort((left, right) => {
    if (left === 'root') return -1
    if (right === 'root') return 1
    return (oldDepth.get(left) ?? 0) - (oldDepth.get(right) ?? 0)
  })
  for (const oldParent of orderedParents) {
    const newParent = oldParent === 'root' ? 'root' : mapping.get(oldParent)
    if (newParent === undefined) {
      // A removed/duplicated-unmapped parent has no live children to map.
      continue
    }
    const candidates = newParent === 'root' ? (newGroups.get('root') ?? []) : (newGroups.get(newParent) ?? [])
    const tokens = simulated.get(oldParent) ?? []
    if (candidates.length !== tokens.length) {
      for (const token of tokens) if (token.kind === 'old') unmapped.push(token.id)
      return { mapping, removed, duplicated, unmapped, reliable: false }
    }
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]
      const candidate = candidates[index]
      const sourceId = token.kind === 'old' ? token.id : token.sourceId
      const source = oldBlocks.find(block => block.blockId === sourceId)
      if (source === undefined || blockSignature(candidate) !== blockSignature(source)) {
        for (const remaining of tokens.slice(index)) if (remaining.kind === 'old') unmapped.push(remaining.id)
        return { mapping, removed, duplicated, unmapped, reliable: false }
      }
      if (token.kind === 'copy') { duplicated.add(candidate.blockId); continue }
      mapping.set(token.id, candidate.blockId)
    }
  }
  // Old survivors without a slot (parent removed/unmapped) are unmapped.
  for (const block of oldBlocks) {
    if (removed.has(block.blockId) || mapping.has(block.blockId)) continue
    if (!unmapped.includes(block.blockId)) unmapped.push(block.blockId)
  }
  return { mapping, removed, duplicated, unmapped, reliable: unmapped.length === 0 }
}

/**
 * Validate that the draft's saved references survive the post-batch mapping.
 *
 * The preview and the real Apply both call this with the authoritative result
 * program: an unreliable mapping, unmapped blocks, a dropped selection or a
 * dropped addition must block Apply instead of silently discarding user work.
 * @param input - old/new block lists, applied ops and the draft references.
 * @returns blocking conflicts (empty when the mapping is safe).
 */
export function validateStructureRemap(input: {
  readonly oldBlocks: readonly RemapBlock[]
  readonly newBlocks: readonly RemapBlock[]
  readonly ops: readonly PendingStructureOp[]
  readonly selection: readonly Pick<ArtifactEditSelectionView, 'blockId'>[]
  readonly additions?: readonly { readonly parentBlockId: string; readonly instruction: string }[]
  readonly nestedOrder?: Readonly<Record<string, readonly string[]>>
}): PendingApplyConflict[] {
  const conflicts: PendingApplyConflict[] = []
  const mapping = mapOldToNewBlocks(input.oldBlocks, input.newBlocks, input.ops)
  if (!mapping.reliable) conflicts.push({ kind: 'target', detail: 'structure' })
  for (const blockId of mapping.unmapped) conflicts.push({ kind: 'target', blockId })
  const selection = remapSelection(input.selection, mapping.mapping)
  for (const blockId of selection.unmapped) conflicts.push({ kind: 'selection', blockId })
  const additions = remapAdditions(input.additions ?? [], mapping.mapping)
  for (const parentBlockId of additions.unmappedParents) conflicts.push({ kind: 'addition', blockId: parentBlockId })
  // A changed nested group must keep every surviving child mappable; otherwise a
  // pending arrangement would silently lose children.
  for (const [parentId, children] of Object.entries(input.nestedOrder ?? {})) {
    if (mapping.mapping.get(parentId) === undefined) continue
    for (const childId of children) {
      if (mapping.removed.has(childId)) continue
      if (mapping.mapping.get(childId) === undefined) conflicts.push({ kind: 'target', blockId: childId })
    }
  }
  const seen = new Set<string>()
  return conflicts.filter(conflict => {
    const key = `${conflict.kind}:${conflict.blockId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Remapped saved block requests. */
export interface SelectionRemap {
  readonly selection: readonly ArtifactEditSelectionView[]
  readonly unmapped: readonly string[]
}

/**
 * Move saved block requests onto the new revision.
 * @param selection - saved requests of the old draft, in selection order.
 * @param mapping - old→new display id mapping.
 * @returns renumbered requests and any old ids without a counterpart.
 */
export function remapSelection(
  selection: readonly ArtifactEditSelectionView[],
  mapping: ReadonlyMap<string, string>,
): SelectionRemap {
  const kept: ArtifactEditSelectionView[] = []
  const unmapped: string[] = []
  for (const entry of [...selection].sort((left, right) => left.order - right.order)) {
    const newBlockId = mapping.get(entry.blockId)
    if (newBlockId === undefined) { unmapped.push(entry.blockId); continue }
    kept.push({ blockId: newBlockId, order: kept.length + 1, instruction: entry.instruction })
  }
  return { selection: kept, unmapped }
}

/** Remapped model additions. */
export interface AdditionRemap {
  readonly additions: readonly { readonly parentBlockId: string; readonly instruction: string }[]
  readonly unmappedParents: readonly string[]
}

/**
 * Move saved additions onto the new revision's containers.
 * @param additions - old additions in insertion order.
 * @param mapping - old→new display id mapping.
 * @returns remapped additions and parent ids without a counterpart.
 */
export function remapAdditions(
  additions: readonly { readonly parentBlockId: string; readonly instruction: string }[],
  mapping: ReadonlyMap<string, string>,
): AdditionRemap {
  const kept: { parentBlockId: string; instruction: string }[] = []
  const unmappedParents: string[] = []
  for (const addition of additions) {
    const parent = mapping.get(addition.parentBlockId)
    if (parent === undefined) { unmappedParents.push(addition.parentBlockId); continue }
    kept.push({ parentBlockId: parent, instruction: addition.instruction })
  }
  return { additions: kept, unmappedParents }
}

/** Root-level display order of one block list (base order, `originalIndex`). */
export function rootOrderOf(blocks: readonly RemapBlock[]): string[] {
  return blocks
    .filter(block => block.parentBlockId === undefined)
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map(block => block.blockId)
}

/** Remapped arrangement target order. */
export interface TargetOrderRemap {
  readonly targetOrder: readonly string[]
  readonly orderChanged: boolean
}

/**
 * Carry the user's arrangement onto the new revision.
 *
 * Mapped blocks keep their relative user order; blocks the structure batch
 * created (for example a duplicate) join at their new base position, and the
 * result is always a complete permutation of the new root blocks.
 * @param targetOrder - old pending target order (base order when unchanged).
 * @param mapping - old→new display id mapping.
 * @param newBlocks - blocks of the resulting revision.
 * @returns the new target order and whether it still differs from the base order.
 */
export function remapTargetOrder(
  targetOrder: readonly string[],
  mapping: ReadonlyMap<string, string>,
  newBlocks: readonly RemapBlock[],
): TargetOrderRemap {
  const baseOrder = rootOrderOf(newBlocks)
  const baseSet = new Set(baseOrder)
  const mapped: string[] = []
  for (const oldId of targetOrder) {
    const newId = mapping.get(oldId)
    if (newId !== undefined && baseSet.has(newId) && !mapped.includes(newId)) mapped.push(newId)
  }
  const mappedSet = new Set(mapped)
  for (const newId of baseOrder) {
    if (mappedSet.has(newId)) continue
    const baseIndex = baseOrder.indexOf(newId)
    let inserted = false
    for (let index = baseIndex - 1; index >= 0 && !inserted; index -= 1) {
      const anchor = mapped.indexOf(baseOrder[index])
      if (anchor !== -1) { mapped.splice(anchor + 1, 0, newId); inserted = true }
    }
    for (let index = baseIndex + 1; index < baseOrder.length && !inserted; index += 1) {
      const anchor = mapped.indexOf(baseOrder[index])
      if (anchor !== -1) { mapped.splice(anchor, 0, newId); inserted = true }
    }
    if (!inserted) mapped.push(newId)
    mappedSet.add(newId)
  }
  const target = mapped.filter(id => baseSet.has(id))
  for (const id of baseOrder) if (!target.includes(id)) target.push(id)
  const orderChanged = target.length !== baseOrder.length || target.some((id, index) => id !== baseOrder[index])
  return { targetOrder: target, orderChanged }
}

/** Remapped nested arrangement state. */
export interface NestedOrderRemap {
  readonly nestedOrder: Readonly<Record<string, readonly string[]>>
  readonly nestedOriginalOrder: Readonly<Record<string, readonly string[]>>
  readonly nestedOrderChanged: boolean
}

/**
 * Carry pending nested orders onto the new revision, dropping removed children
 * and childless groups. Original orders are rebuilt from the new base.
 * @param input - old pending/nested state plus the block mapping.
 */
export function remapNestedOrder(input: {
  readonly nestedOrder?: Readonly<Record<string, readonly string[]>>
  readonly mapping: ReadonlyMap<string, string>
  readonly newBlocks: readonly RemapBlock[]
}): NestedOrderRemap {
  const { nestedOrder, mapping, newBlocks } = input
  const baseGroups: Record<string, string[]> = {}
  for (const block of newBlocks) {
    if (block.parentBlockId === undefined) continue
    ;(baseGroups[block.parentBlockId] ??= []).push(block.blockId)
  }
  for (const key of Object.keys(baseGroups)) {
    baseGroups[key].sort((left, right) => {
      const leftBlock = newBlocks.find(block => block.blockId === left)
      const rightBlock = newBlocks.find(block => block.blockId === right)
      return (leftBlock?.originalIndex ?? 0) - (rightBlock?.originalIndex ?? 0)
    })
  }
  const pending: Record<string, string[]> = {}
  let changed = false
  for (const [oldParentId, oldChildren] of Object.entries(nestedOrder ?? {})) {
    const parentId = mapping.get(oldParentId)
    if (parentId === undefined || baseGroups[parentId] === undefined) continue
    const baseOrder = baseGroups[parentId]
    const baseSet = new Set(baseOrder)
    const children: string[] = []
    for (const oldChildId of oldChildren) {
      const newChildId = mapping.get(oldChildId)
      if (newChildId !== undefined && baseSet.has(newChildId) && !children.includes(newChildId)) children.push(newChildId)
    }
    // Children the batch created (duplicates) are not in the old order; insert
    // them at their base position relative to the mapped anchors instead of
    // appending them. Appending would make every pure duplicate look like a
    // pending arrangement change and turn a zero-model Apply into a model
    // request. The rule matches `remapTargetOrder`.
    for (const baseChildId of baseOrder) {
      if (children.includes(baseChildId)) continue
      const baseIndex = baseOrder.indexOf(baseChildId)
      let inserted = false
      for (let index = baseIndex - 1; index >= 0 && !inserted; index -= 1) {
        const anchor = children.indexOf(baseOrder[index])
        if (anchor !== -1) { children.splice(anchor + 1, 0, baseChildId); inserted = true }
      }
      for (let index = baseIndex + 1; index < baseOrder.length && !inserted; index += 1) {
        const anchor = children.indexOf(baseOrder[index])
        if (anchor !== -1) { children.splice(anchor, 0, baseChildId); inserted = true }
      }
      if (!inserted) children.push(baseChildId)
    }
    const ordered = children.filter(id => baseSet.has(id))
    if (ordered.length === baseOrder.length && ordered.every((id, index) => id === baseOrder[index])) continue
    pending[parentId] = ordered
    changed = true
  }
  return { nestedOrder: pending, nestedOriginalOrder: baseGroups, nestedOrderChanged: changed }
}
