/** Structured block-edit requests observed from the user message stream. */
import {
  ARTIFACT_EDIT_OPEN, ARTIFACT_ID_PATTERN, MAX_ARTIFACT_ADDITIONS, MAX_ARTIFACT_BATCH_REQUESTS, MAX_ARTIFACT_PROGRAM_CHARS,
  describeTargetOrderProblem, isNoOpEditRequest, isReorderedOrder, isStyleEditRequest,
  parseEditRequestTexts,
  type ArtifactBlockAddition, type ArtifactBlockEditRequest, type ArtifactEditRequest,
  type ArtifactRevisionMeta, type ArtifactRevisionStatus,
} from '../shared/artifact-edit.ts'
import { describeStyleSnapshotProblem, isStyleSnapshot, type StyleSnapshot } from '../shared/style-templates.ts'
import { artifactEditWarnings, extractArtifactBlocks, reorderProgramToTargetOrder, verifyEditTargets } from '../shared/artifact-blocks.ts'
import {
  applyOperations as applyCstOperations,
  buildArtifactTree,
  insertNode,
  inspectProgramStructure,
  parseProgramCst,
  reorderChildren,
  type ArtifactTree,
  type ArtifactTreeNode,
  type CstExpr,
} from '../shared/program-cst.ts'
import type { ArtifactRevisionRecord, ArtifactRevisionStore } from './artifact-revisions.ts'

/** How long an observed edit request stays armed for the next render_ui call. */
export const ARTIFACT_EDIT_TTL = 15 * 60 * 1000
const MAX_PENDING_SESSIONS = 64

/** Containers M4-1 nested content edits may address (mirrors the CST whitelist). */
import { NESTED_CONTAINER_TYPES } from '../shared/artifact-containers.ts'
export const NESTED_EDIT_CONTAINER_TYPES = NESTED_CONTAINER_TYPES

/** One validated nested edit plan: the base tree, selected nodes and addition parents. */
interface NestedEditPlan {
  readonly tree: ArtifactTree
  readonly nodes: readonly ArtifactTreeNode[]
  readonly additionParents: readonly { readonly addition: ArtifactBlockAddition; readonly parent: ArtifactTreeNode }[]
}

interface NestedEditFailure {
  readonly ok: false
  readonly message: string
}

/** Whether one request addresses the nested CST tree (node-id edits or additions). */
export function isNestedEditRequest(request: ArtifactBlockEditRequest): boolean {
  return (request.additions?.length ?? 0) > 0 || request.edits.some(edit => edit.nodeId !== undefined)
}

/** Whether `ancestorId` is a strict ancestor of `nodeId` in the tree. */
function isTreeNodeAncestor(tree: ArtifactTree, ancestorId: string, nodeId: string): boolean {
  let cursor = tree.nodes.get(nodeId)?.parentNodeId
  while (cursor !== undefined) {
    if (cursor === ancestorId) return true
    cursor = tree.nodes.get(cursor)?.parentNodeId
  }
  return false
}

/** Validate one all-nested request against its base program tree. */
function planNestedEdits(program: string, request: ArtifactBlockEditRequest): { readonly ok: true; readonly plan: NestedEditPlan } | NestedEditFailure {
  const edits = request.edits
  const additions = request.additions ?? []
  if (edits.length === 0 && additions.length === 0) return { ok: false, message: 'the nested edit request has no blocks.' }
  if (additions.length > MAX_ARTIFACT_ADDITIONS) {
    return { ok: false, message: `a request may add at most ${MAX_ARTIFACT_ADDITIONS} new blocks.` }
  }
  const nestedCount = edits.filter(edit => edit.nodeId !== undefined).length
  if (nestedCount !== edits.length) {
    return { ok: false, message: 'nested block edits must all carry a nodeId; mixing top-level and nested edits in one request is not supported.' }
  }
  const tree = buildArtifactTree(program, {
    baseRevisionId: request.baseRevisionId,
    containerTypes: [...NESTED_EDIT_CONTAINER_TYPES],
  })
  if (tree.limitsExceeded !== undefined) {
    return { ok: false, message: `the page is too large or nested too deeply for nested editing (${tree.limitsExceeded}).` }
  }
  const nodes: ArtifactTreeNode[] = []
  const seen = new Set<string>()
  for (const edit of edits) {
    const nodeId = edit.nodeId as string
    if (seen.has(nodeId)) return { ok: false, message: `block node ${JSON.stringify(nodeId)} is selected more than once.` }
    seen.add(nodeId)
    const node = tree.nodes.get(nodeId)
    if (node === undefined) {
      return { ok: false, message: `block node ${JSON.stringify(nodeId)} is not part of the current revision; ask the user to reload the page and reselect the block.` }
    }
    if (node.depth <= 0) return { ok: false, message: 'the root layout cannot be edited as one block.' }
    if (node.scoped) return { ok: false, message: `block node ${JSON.stringify(nodeId)} is inside an @Each template, which is not editable in this release.` }
    if (node.shared) return { ok: false, message: `block node ${JSON.stringify(nodeId)} belongs to a shared named expression; editing it would change every instance.` }
    if (node.opaque || node.problem !== undefined) {
      return { ok: false, message: `block node ${JSON.stringify(nodeId)} is not structurally editable in this release.` }
    }
    if (edit.sourceDigest === undefined) {
      return { ok: false, message: `block node ${JSON.stringify(nodeId)} is missing its source digest; ask the user to reload the page and reselect it.` }
    }
    if (edit.sourceDigest.toLowerCase() !== node.digest.toLowerCase()) {
      return { ok: false, message: `block node ${JSON.stringify(nodeId)} changed since it was selected; ask the user to reload the page and reselect it.` }
    }
    if (edit.componentType !== node.componentType) {
      return { ok: false, message: `block node ${JSON.stringify(nodeId)} no longer matches its recorded component; ask the user to reload the page and reselect it.` }
    }
    nodes.push(node)
  }
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const first = nodes[left] as ArtifactTreeNode
      const second = nodes[right] as ArtifactTreeNode
      if (isTreeNodeAncestor(tree, first.nodeId, second.nodeId) || isTreeNodeAncestor(tree, second.nodeId, first.nodeId)) {
        return { ok: false, message: 'nested edits cannot include a block together with its ancestor or descendant.' }
      }
    }
  }
  const containers = new Set<string>(NESTED_EDIT_CONTAINER_TYPES)
  const additionParents: { addition: ArtifactBlockAddition; parent: ArtifactTreeNode }[] = []
  for (const addition of additions) {
    const parent = tree.nodes.get(addition.parentNodeId)
    if (parent === undefined) {
      return { ok: false, message: `new block parent ${JSON.stringify(addition.parentNodeId)} is not part of the current revision; ask the user to reload the page and retry.` }
    }
    if (parent.scoped) return { ok: false, message: `new block parent ${JSON.stringify(addition.parentNodeId)} is inside an @Each template and cannot receive a block in this release.` }
    if (parent.shared) return { ok: false, message: `new block parent ${JSON.stringify(addition.parentNodeId)} belongs to a shared named expression; adding there would change every instance.` }
    if (parent.opaque || parent.problem !== undefined) return { ok: false, message: `new block parent ${JSON.stringify(addition.parentNodeId)} is not structurally editable in this release.` }
    for (const editedNode of nodes) {
      if (parent.nodeId === editedNode.nodeId
        || isTreeNodeAncestor(tree, parent.nodeId, editedNode.nodeId)
        || isTreeNodeAncestor(tree, editedNode.nodeId, parent.nodeId)) {
        return { ok: false, message: `cannot add a new block to ${JSON.stringify(addition.parentNodeId)} because that container is being edited or is an ancestor/descendant of an edited block.` }
      }
    }
    if (!containers.has(parent.componentType)) {
      return { ok: false, message: `new block parent ${JSON.stringify(addition.parentNodeId)} is ${parent.componentType}, which cannot receive new blocks.` }
    }
    if (parent.slotRange === undefined || parent.childSlots.children === undefined) {
      return { ok: false, message: `new block parent ${JSON.stringify(addition.parentNodeId)} has no writable children slot.` }
    }
    const editable = (parent.childSlots.children ?? []).filter(nodeId => tree.nodes.get(nodeId)?.editable === true)
    if (!Number.isInteger(addition.index) || addition.index < 0 || addition.index > editable.length) {
      return { ok: false, message: `new block position for parent ${JSON.stringify(addition.parentNodeId)} must be between 0 and ${editable.length}.` }
    }
    additionParents.push({ addition, parent })
  }
  return { ok: true, plan: { tree, nodes, additionParents } }
}

/** Model-readable problem with one nested request, or undefined when it is valid. */
export function describeNestedEditProblem(program: string, request: ArtifactBlockEditRequest): string | undefined {
  const plan = planNestedEdits(program, request)
  return plan.ok ? undefined : plan.message
}

/** Tolerant base→current node lookup used to relocate addition parents. */
function locateCurrentNode(baseTree: ArtifactTree, tree: ArtifactTree, baseNode: ArtifactTreeNode): ArtifactTreeNode | undefined {
  const chain: ArtifactTreeNode[] = []
  let cursor: ArtifactTreeNode | undefined = baseNode
  while (cursor !== undefined) {
    chain.unshift(cursor)
    cursor = cursor.parentNodeId === undefined ? undefined : baseTree.nodes.get(cursor.parentNodeId)
  }
  const root = tree.nodes.get(tree.rootNodeId)
  if (root === undefined) return undefined
  let current: ArtifactTreeNode | undefined = root
  for (const step of chain) {
    if (step.nodeId === baseTree.rootNodeId) continue
    if (current === undefined) return undefined
    const children: ArtifactTreeNode[] = (current.childSlots.children ?? []).flatMap((nodeId: string) => {
      const entry = tree.nodes.get(nodeId)
      return entry === undefined ? [] : [entry]
    })
    const unique = (candidates: ArtifactTreeNode[]): ArtifactTreeNode | undefined => candidates.length === 1 ? candidates[0] : undefined
    current = (step.statementId === undefined ? undefined : unique(children.filter(entry => entry.statementId === step.statementId)))
      ?? (step.title === undefined ? undefined : unique(children.filter(entry => entry.title === step.title && entry.componentType === step.componentType)))
      ?? unique(children.filter(entry => entry.digest === step.digest && entry.componentType === step.componentType))
      ?? unique(children.filter(entry => entry.componentType === step.componentType))
      ?? (children[step.childIndex]?.componentType === step.componentType ? children[step.childIndex] : undefined)
  }
  return current
}

/** Root-level display block ids whose subtrees contain the edited nested nodes. */
function nestedRootBlockIds(program: string, tree: ArtifactTree, nodes: readonly ArtifactTreeNode[]): string[] {
  const extraction = extractArtifactBlocks(program)
  const ids = new Set<string>()
  for (const node of nodes) {
    let cursor = node
    while (cursor.parentNodeId !== undefined && cursor.parentNodeId !== tree.rootNodeId) {
      const parent = tree.nodes.get(cursor.parentNodeId)
      if (parent === undefined) break
      cursor = parent
    }
    if (cursor.parentNodeId !== tree.rootNodeId) continue
    const block = extraction.blocks.find(candidate => candidate.rootIndex === cursor.childIndex)
    if (block !== undefined) ids.add(block.blockId)
  }
  return [...ids]
}

/**
 * Compose the model's nested mini program into the base page.
 *
 * The mini program's root Col children are matched to the selected edits in
 * `selectionOrder`, helper statements are appended (never redefined), and the
 * replacements are applied atomically through the source CST engine so the
 * untouched subtrees are byte-verified. Structure-changing operations are not
 * part of M4-1.
 * @param request - validated nested edit request.
 * @param fragmentProgram - model mini program for the selected blocks.
 * @returns the composed page program, or a model-readable problem.
 */
export function composeNestedEditProgram(
  request: ArtifactBlockEditRequest,
  fragmentProgram: string,
): { readonly ok: true; readonly program: string } | NestedEditFailure {
  const fragment = fragmentProgram.trim()
  const fragmentCst = parseProgramCst(fragment)
  if (fragmentCst.problem !== undefined) {
    return { ok: false, message: `the mini program is not valid openui-lang (${fragmentCst.problem.message}).` }
  }
  const rootStatement = fragmentCst.root
  if (rootStatement === undefined || rootStatement.expr.kind !== 'call' || rootStatement.expr.name !== 'Col') {
    return { ok: false, message: 'the mini program must be root = Col([...]).' }
  }
  const childrenArg = rootStatement.expr.items?.[0]
  if (childrenArg === undefined || childrenArg.kind !== 'array') {
    return { ok: false, message: 'the mini program must be root = Col([...]) with one expression per selected block.' }
  }
  const ordered = [...request.edits].sort((left, right) => left.selectionOrder - right.selectionOrder)
  const additions = request.additions ?? []
  const expectedChildren = ordered.length + additions.length
  const expressions = childrenArg.items ?? []
  if (expressions.length !== expectedChildren) {
    return {
      ok: false,
      message: additions.length === 0
        ? `return exactly ${ordered.length} root children, one per selected block in selection order.`
        : `return exactly ${expectedChildren} root children: ${ordered.length} edited block(s) in selection order followed by ${additions.length} new block(s) in request order.`,
    }
  }
  const baseCst = parseProgramCst(request.program)
  if (baseCst.problem !== undefined) {
    return { ok: false, message: `the page program is not in the supported subset (${baseCst.problem.message}).` }
  }
  const declared = new Set(baseCst.statements.map(statement => statement.name))
  const helpers: string[] = []
  for (const statement of fragmentCst.statements) {
    if (statement.name === 'root') continue
    if (declared.has(statement.name)) {
      return { ok: false, message: `helper statement ${JSON.stringify(statement.name)} redefines an existing page statement; reuse the existing statement instead.` }
    }
    declared.add(statement.name)
    helpers.push(statement.source)
  }
  let extended = request.program
  if (helpers.length > 0) extended = `${extended.replace(/\s+$/, '')}\n${helpers.join('\n')}\n`
  const plan = planNestedEdits(extended, request)
  if (!plan.ok) return plan
  const replacements = ordered.map((edit, index) => {
    const expression = expressions[index] as CstExpr
    return {
      op: 'replace' as const,
      nodeId: edit.nodeId as string,
      source: fragment.slice(expression.range.start, expression.range.end).trim(),
    }
  })
  const applied = replacements.length === 0
    ? { ok: true as const, program: extended, tree: plan.plan.tree }
    : applyCstOperations(extended, replacements, {
      tree: plan.plan.tree,
      baseRevisionId: request.baseRevisionId,
      containerTypes: [...NESTED_EDIT_CONTAINER_TYPES],
    })
  if (applied.ok === false) {
    return { ok: false, message: `the nested edit could not be applied (${applied.code}): ${applied.message}` }
  }
  let nextProgram = applied.program
  let nextTree = applied.tree
  for (let index = 0; index < additions.length; index += 1) {
    const additionEntry = plan.plan.additionParents[index] as { addition: ArtifactBlockAddition; parent: ArtifactTreeNode }
    const expression = expressions[ordered.length + index] as CstExpr
    const source = fragment.slice(expression.range.start, expression.range.end).trim()
    const currentParent = locateCurrentNode(plan.plan.tree, nextTree, additionEntry.parent)
    if (currentParent === undefined || currentParent.componentType !== additionEntry.parent.componentType) {
      return { ok: false, message: `the parent container for new block ${index + 1} could not be located after the earlier edits; ask the user to reload the page and retry.` }
    }
    const inserted = insertNode(nextProgram, currentParent.nodeId, 'children', additionEntry.addition.index, source, {
      tree: nextTree,
      baseRevisionId: request.baseRevisionId,
      containerTypes: [...NESTED_EDIT_CONTAINER_TYPES],
    })
    if (inserted.ok === false) {
      return { ok: false, message: `new block ${index + 1} could not be inserted (${inserted.code}): ${inserted.message}` }
    }
    nextProgram = inserted.program
    nextTree = inserted.tree
  }
  const inspected = inspectProgramStructure(nextProgram, {
    baseRevisionId: request.baseRevisionId,
    containerTypes: [...NESTED_EDIT_CONTAINER_TYPES],
  })
  if (inspected.ok === false) {
    return { ok: false, message: `the edited page is not a valid structure (${inspected.code}): ${inspected.message}` }
  }
  return { ok: true, program: nextProgram }
}
/** Tree options shared by nested content and hierarchical ordering. */
function nestedTreeOptions(request: ArtifactBlockEditRequest): { baseRevisionId: string; containerTypes: string[] } {
  return { baseRevisionId: request.baseRevisionId, containerTypes: [...NESTED_EDIT_CONTAINER_TYPES] }
}

/** Editable children of one container slot (chrome and non-editable nodes excluded). */
function editableChildIds(tree: ArtifactTree, parent: ArtifactTreeNode): string[] {
  return (parent.childSlots.children ?? []).filter(nodeId => tree.nodes.get(nodeId)?.editable === true)
}

/** Full slot permutation: requested editable ids fill their base positions; chrome stays put. */
function fullSlotOrder(tree: ArtifactTree, parent: ArtifactTreeNode, order: readonly string[]): string[] | undefined {
  const children = parent.childSlots.children ?? []
  const editable = editableChildIds(tree, parent)
  if (editable.length !== order.length) return undefined
  const requested = new Set(order)
  if (requested.size !== order.length) return undefined
  const positions: number[] = []
  children.forEach((nodeId, index) => {
    if (tree.nodes.get(nodeId)?.editable === true) positions.push(index)
  })
  if (positions.length !== editable.length) return undefined
  const result = [...children]
  positions.forEach((position, index) => { result[position] = order[index] as string })
  return result
}

/** Whether every requested group is already in the base order. */
function isOrderByParentNoOp(tree: ArtifactTree, orderByParent: Readonly<Record<string, readonly string[]>>): boolean {
  for (const [key, order] of Object.entries(orderByParent)) {
    const parent = key === 'root' ? tree.nodes.get(tree.rootNodeId) : tree.nodes.get(key)
    if (parent === undefined) return false
    const actual = editableChildIds(tree, parent)
    if (order.length !== actual.length || order.some((nodeId, index) => nodeId !== actual[index])) return false
  }
  return true
}

/** Whether one node lies in the subtree of any edited node. */
function insideEditedSubtree(tree: ArtifactTree, nodeId: string, edited: ReadonlySet<string>): boolean {
  if (edited.size === 0) return false
  let cursor: string | undefined = nodeId
  while (cursor !== undefined) {
    if (edited.has(cursor)) return true
    cursor = tree.nodes.get(cursor)?.parentNodeId
  }
  return false
}

/**
 * Model-readable problem with one request's `orderByParent` groups.
 * @param baseProgram - base revision program the request was made on.
 * @param request - parsed edit request.
 * @returns the first problem, or undefined when every group is a complete
 * permutation of that parent's editable children and does not conflict with
 * `targetOrder.root` or the same request's content edits.
 */
export function describeOrderByParentProblem(baseProgram: string, request: ArtifactBlockEditRequest): string | undefined {
  const groups = request.orderByParent
  if (groups === undefined) return undefined
  const tree = buildArtifactTree(baseProgram, nestedTreeOptions(request))
  if (tree.limitsExceeded !== undefined) {
    return `the page is too large or nested too deeply for hierarchical ordering (${tree.limitsExceeded}).`
  }
  const extraction = extractArtifactBlocks(baseProgram)
  const baseRootOrder = extraction.blocks.map(block => block.blockId)
  if (groups.root !== undefined && (request.targetOrder.length !== baseRootOrder.length
    || request.targetOrder.some((id, index) => id !== baseRootOrder[index]))) {
    return 'targetOrder and orderByParent.root cannot disagree; keep targetOrder as the base root order and send the new hierarchy in orderByParent.'
  }
  const editedNodes = new Set<string>()
  if (isNestedEditRequest(request)) {
    const plan = planNestedEdits(baseProgram, request)
    if (!plan.ok) return plan.message
    for (const node of plan.plan.nodes) editedNodes.add(node.nodeId)
  }
  for (const [key, order] of Object.entries(groups)) {
    const parent = key === 'root' ? tree.nodes.get(tree.rootNodeId) : tree.nodes.get(key)
    if (parent === undefined) return `orderByParent refers to an unknown parent ${JSON.stringify(key)}.`
    if (parent.scoped) return `orderByParent parent ${JSON.stringify(key)} is inside an @Each template and cannot be reordered in this release.`
    if (parent.shared) return `orderByParent parent ${JSON.stringify(key)} belongs to a shared named expression; reordering it would change every instance.`
    if (parent.opaque || parent.problem !== undefined) return `orderByParent parent ${JSON.stringify(key)} is not structurally reorderable in this release.`
    if (parent.childSlots.children === undefined) return `orderByParent parent ${JSON.stringify(key)} has no children slot to reorder.`
    if (insideEditedSubtree(tree, parent.nodeId, editedNodes)) {
      return `cannot reorder inside block ${JSON.stringify(key)} because that subtree is being edited in the same request.`
    }
    const editable = editableChildIds(tree, parent)
    const seen = new Set<string>()
    for (const nodeId of order) {
      const child = tree.nodes.get(nodeId)
      if (child === undefined) return `orderByParent for ${JSON.stringify(key)} refers to an unknown block ${JSON.stringify(nodeId)}.`
      if (seen.has(nodeId)) return `orderByParent for ${JSON.stringify(key)} lists block ${JSON.stringify(nodeId)} more than once.`
      seen.add(nodeId)
      if (!child.editable) return `orderByParent for ${JSON.stringify(key)} includes a block that is not editable (${JSON.stringify(nodeId)}).`
      if (!editable.includes(nodeId)) return `orderByParent for ${JSON.stringify(key)} lists a block from a different parent (${JSON.stringify(nodeId)}).`
    }
    if (order.length !== editable.length) {
      return `orderByParent for ${JSON.stringify(key)} must list every editable child exactly once (expected ${editable.length}, got ${order.length}).`
    }
  }
  return undefined
}

/** Map children of one aligned base/current parent pair by identity, with index fallback. */
function mapChildIds(
  baseTree: ArtifactTree,
  baseParent: ArtifactTreeNode,
  currentTree: ArtifactTree,
  currentParent: ArtifactTreeNode,
): Map<string, string> | undefined {
  const baseChildren = baseParent.childSlots.children ?? []
  const currentChildren = currentParent.childSlots.children ?? []
  if (baseChildren.length !== currentChildren.length) return undefined
  const mapping = new Map<string, string>()
  const used = new Set<string>()
  const resolve = (baseChildId: string): string | undefined => {
    const baseChild = baseTree.nodes.get(baseChildId)
    if (baseChild === undefined) return undefined
    const candidates = currentChildren.filter(nodeId => !used.has(nodeId))
    const byStatement = baseChild.statementId === undefined
      ? undefined
      : candidates.find(nodeId => currentTree.nodes.get(nodeId)?.statementId === baseChild.statementId)
    const byTitle = byStatement !== undefined || baseChild.title === undefined
      ? undefined
      : candidates.find(nodeId => {
        const candidate = currentTree.nodes.get(nodeId)
        return candidate !== undefined && candidate.title === baseChild.title && candidate.componentType === baseChild.componentType
      })
    // Content digest is the identity of an untitled/unnamed child; only a
    // unique match counts, because identical duplicates are interchangeable.
    const byDigest = byStatement !== undefined || byTitle !== undefined
      ? undefined
      : (() => {
        const matches = candidates.filter(nodeId => {
          const candidate = currentTree.nodes.get(nodeId)
          return candidate !== undefined && candidate.componentType === baseChild.componentType && candidate.digest === baseChild.digest
        })
        return matches.length === 1 ? matches[0] : undefined
      })()
    const byIndex = byStatement !== undefined || byTitle !== undefined || byDigest !== undefined
      ? undefined
      : candidates.find(nodeId => {
        const candidate = currentTree.nodes.get(nodeId)
        return candidate !== undefined && candidate.childIndex === baseChild.childIndex && candidate.componentType === baseChild.componentType
      })
    return byStatement ?? byTitle ?? byDigest ?? byIndex
  }
  for (const baseChildId of baseChildren) {
    const target = resolve(baseChildId)
    if (target === undefined) return undefined
    mapping.set(baseChildId, target)
    used.add(target)
  }
  return used.size === currentChildren.length ? mapping : undefined
}

/** Resolve a base parent node in the current tree (rebuilt after every reorder). */
function resolveCurrentParent(baseTree: ArtifactTree, currentTree: ArtifactTree, baseParent: ArtifactTreeNode): ArtifactTreeNode | undefined {
  if (baseParent.nodeId === baseTree.rootNodeId) return currentTree.nodes.get(currentTree.rootNodeId)
  const found = currentTree.nodes.get(baseParent.nodeId)
  if (found !== undefined && found.nodePath === baseParent.nodePath && found.componentType === baseParent.componentType) return found
  return [...currentTree.nodes.values()].find(node => node.nodePath === baseParent.nodePath && node.componentType === baseParent.componentType)
}

/**
 * Apply one request's `orderByParent` groups to a (possibly content-edited) page.
 *
 * Groups are applied deepest-first with a tree rebuild after every parent, so
 * node ids stay consistent; groups are mapped from the base revision tree onto
 * the returned page by block identity (statement name → title+component → index).
 * @param baseProgram - base revision program the node ids were issued against.
 * @param program - model/composed program to normalize.
 * @param request - parsed edit request carrying `orderByParent`.
 * @param options - tree options for the identity binding.
 * @returns the ordered program, or a model-readable failure.
 */
export function applyOrderByParent(
  baseProgram: string,
  program: string,
  request: ArtifactBlockEditRequest,
  options: { readonly containerTypes?: readonly string[]; readonly baseRevisionId?: string } = {},
): { readonly ok: true; readonly program: string } | NestedEditFailure {
  const groups = request.orderByParent
  if (groups === undefined) return { ok: true, program }
  const problem = describeOrderByParentProblem(baseProgram, request)
  if (problem !== undefined) return { ok: false, message: problem }
  const treeOptions = {
    baseRevisionId: options.baseRevisionId ?? request.baseRevisionId,
    ...options.containerTypes === undefined ? {} : { containerTypes: options.containerTypes },
  }
  const baseTree = buildArtifactTree(baseProgram, treeOptions)
  const initialTree = buildArtifactTree(program, treeOptions)
  if (initialTree.limitsExceeded !== undefined) {
    return { ok: false, message: `the edited page is too large or nested too deeply for hierarchical ordering (${initialTree.limitsExceeded}).` }
  }
  const entries = Object.entries(groups).sort((left, right) => {
    const leftDepth = left[0] === 'root' ? -1 : (baseTree.nodes.get(left[0])?.depth ?? -1)
    const rightDepth = right[0] === 'root' ? -1 : (baseTree.nodes.get(right[0])?.depth ?? -1)
    return rightDepth - leftDepth
  })
  let currentProgram = program
  let currentTree = initialTree
  for (const [key, order] of entries) {
    const baseParent = key === 'root' ? baseTree.nodes.get(baseTree.rootNodeId) : baseTree.nodes.get(key)
    if (baseParent === undefined) {
      return { ok: false, message: `orderByParent refers to an unknown parent ${JSON.stringify(key)}.` }
    }
    const fullOrder = fullSlotOrder(baseTree, baseParent, order)
    if (fullOrder === undefined) {
      return { ok: false, message: `orderByParent for ${JSON.stringify(key)} is not a complete permutation of its editable children.` }
    }
    const currentParent = resolveCurrentParent(baseTree, currentTree, baseParent)
    if (currentParent === undefined) {
      return { ok: false, message: `the edited page no longer keeps block ${JSON.stringify(key)}; keep every block's structure and call render_ui again.` }
    }
    const mapping = mapChildIds(baseTree, baseParent, currentTree, currentParent)
    if (mapping === undefined) {
      return { ok: false, message: `could not map the edited page back onto the requested block order; keep every block's statement name or title stable and call render_ui again.` }
    }
    const targetOrder = fullOrder.map(baseChildId => mapping.get(baseChildId))
    if (targetOrder.some(nodeId => nodeId === undefined) || new Set(targetOrder).size !== targetOrder.length) {
      return { ok: false, message: `could not map the edited page back onto the requested block order; keep every block's statement name or title stable and call render_ui again.` }
    }
    const result = reorderChildren(currentProgram, currentParent.nodeId, 'children', targetOrder as string[], treeOptions)
    if (!result.ok) {
      return { ok: false, message: `the requested block order could not be applied (${result.code}): ${result.message}` }
    }
    currentProgram = result.program
    currentTree = result.tree
  }
  return { ok: true, program: currentProgram }
}

/** Pending requests retained per session; one send arms at most a full batch. */
const MAX_SESSION_REQUESTS = MAX_ARTIFACT_BATCH_REQUESTS

/** Which pending request a tool call targets when a session holds several. */
export type PendingSelectorError = 'multiple_pending' | 'unknown_request' | 'unknown_artifact' | 'artifact_mismatch'

/** Selector a tool call uses to pick one request out of a multi-request send. */
export interface PendingArtifactSelector {
  readonly requestId?: string
  readonly artifactId?: string
}

/** One armed edit request, or why it cannot be resolved/applied. */
export interface PendingArtifactEdit {
  readonly request?: ArtifactEditRequest
  /** Model-readable reason a parsed-but-unusable request cannot be applied. */
  readonly invalidReason?: string
  /** Why the selector did not resolve exactly one usable pending request. */
  readonly error?: PendingSelectorError
  readonly requestId?: string
  readonly artifactId?: string
  readonly mode?: 'block' | 'full' | 'style'
  readonly messageId?: string
}

/** One pending request summarized for model-facing selection errors. */
export interface PendingArtifactEditSummary {
  readonly requestId: string
  readonly artifactId?: string
  readonly mode?: 'block' | 'full' | 'style'
  readonly invalid: boolean
}

/** Lineage and findings of one applied edit. */
export interface AppliedArtifactEdit {
  readonly lineage: ArtifactRevisionMeta
  readonly warnings: string[]
  /** True when the applied request was the natural-language style branch. */
  readonly styleEdit?: boolean
}

export interface ArtifactEditController {
  /** One pending request; `undefined` means none, or a selector could not resolve exactly one. */
  pending(sessionId?: string, selector?: PendingArtifactSelector): PendingArtifactEdit | undefined
  /** Compact view of every live pending request, in arrival order. */
  listPending(sessionId?: string): PendingArtifactEditSummary[]
  apply(input: {
    readonly sessionId?: string
    readonly callId?: string
    readonly args: Record<string, unknown>
    /** Host-composed page for a block-level tool call; skips render_ui argument style checks and always carries the page. */
    readonly composedProgram?: string
    /** Exact pending request to consume; omitted for the legacy single-request path. */
    readonly requestId?: string
    readonly artifactId?: string
  }): AppliedArtifactEdit
}

/** Structural subset of installed SessionEvent that carries a user message. */
interface ArtifactEditSessionEvent {
  readonly type: string
  readonly data?: {
    readonly id?: string
    readonly source?: { readonly kind?: string }
    readonly content?: readonly unknown[]
    readonly message?: { readonly content?: readonly unknown[] }
  }
}

/** One stored pending request. */
interface Entry {
  readonly requestId: string
  readonly request?: ArtifactEditRequest
  readonly invalidReason?: string
  readonly artifactId?: string
  readonly mode?: 'block' | 'full' | 'style'
  readonly messageId?: string
  readonly createdAt: number
}

interface SessionState {
  readonly entries: Map<string, Entry>
}

const RELOAD = 'Ask the user to reload the rendered page and make the edit again.'

const UNREADABLE_MESSAGE = `render_ui: the block edit request in this user message could not be read, so the page was not updated. ${RELOAD}`

const EXPIRED_MESSAGE = `render_ui: the block edit request expired before the page was updated. ${RELOAD}`

const NO_PENDING_MESSAGE = 'render_ui: no block edit request is pending for this session; answer normally or call render_ui for a new page.'

const NO_OP_MESSAGE = 'render_ui: this block edit request changes nothing (no instructions, no global instruction and the same block order), so no revision can be rendered. Ask the user to choose an edit or reorder a block before editing again.'

const ARRANGEMENT_MESSAGE = 'render_ui: this block arrangement request could not be verified because the updated program did not keep every top-level block; keep the same top-level blocks with their statement names/titles (no add/remove/merge) and try again.'

/** No-op style edit: the returned program and the approved snapshot are unchanged. */
const STYLE_NO_OP_MESSAGE = 'render_ui: this style edit request changes nothing (the program and the approved temporaryStyle snapshot are unchanged), so no revision can be rendered. Ask the user to describe the style change they want before editing again.'

/** H4: a style-only revision replaced a page that had editable blocks with one that has none. */
const STYLE_EMPTY_BLOCKS_WARNING = 'The updated page no longer exposes any editable blocks; a style-only revision should keep the original blocks and change only their presentation.'

const DUPLICATE_ARTIFACT_MESSAGE = (artifactId: string): string =>
  `render_ui: this user message contains more than one edit request for artifactId ${JSON.stringify(artifactId)}; only the first request per artifact is armed. Ask the user to send one edit per artifact.`

/** Deterministic request id for a legacy envelope that carries no requestId. */
function legacyRequestId(request: ArtifactEditRequest): string {
  const raw = request.artifactId === request.baseRevisionId ? request.artifactId : `${request.artifactId}_${request.baseRevisionId}`
  return `legacy_${raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 72)}`
}

const LEGACY_UNREADABLE_REQUEST_ID = 'legacy_unreadable'

/** Model-readable staleness report shared by the observer and apply(). */
function staleMessage(request: ArtifactEditRequest, status: ArtifactRevisionStatus, tool = 'render_ui'): string {
  return `${tool}: this block edit targets revision ${request.baseRevision}, but revision ${status.latestRevision} is now the latest; the page is out of date. ${RELOAD}`
}

/** Model-readable problem with a branch edit's base revision, or undefined when it resolves. */
function branchBaseProblem(request: ArtifactEditRequest, base: ArtifactRevisionRecord | undefined, tool: string): string | undefined {
  if (base === undefined) {
    if (request.baseRevision === 1) return undefined
    return `${tool}: this branch edit targets revision ${request.baseRevision} (${JSON.stringify(request.baseRevisionId)}), which is not a recorded revision of artifact ${JSON.stringify(request.artifactId)}; only revision 1 (the original render) may be unrecorded. Ask the user to reload the page and retry.`
  }
  if (base.artifactId !== request.artifactId) {
    return `${tool}: this branch edit's base revision ${JSON.stringify(request.baseRevisionId)} belongs to artifact ${JSON.stringify(base.artifactId)}, not ${JSON.stringify(request.artifactId)}; reload the page and retry.`
  }
  if (base.revision !== request.baseRevision) {
    return `${tool}: this branch edit says it targets revision ${request.baseRevision}, but base revision ${JSON.stringify(request.baseRevisionId)} is revision ${base.revision}; reload the page and retry.`
  }
  return undefined
}

/** Text blocks of one user message, in order. */
function messageText(content: readonly unknown[] | undefined): string | undefined {
  if (!Array.isArray(content)) return undefined
  const texts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') texts.push(candidate.text)
  }
  return texts.length === 0 ? undefined : texts.join('\n')
}

/**
 * Install the user-message observer and the render-time applicator.
 *
 * One user message may carry several V1 edit envelopes (one per Composer chip);
 * the Host aggregates them into a per-session batch keyed by requestId. Legacy
 * envelopes without a requestId keep the previous single-pending behavior.
 * @param ctx - host context with the optional live event subscription and logger.
 * @param revisions - durable revision registry.
 * @param options - clock injection for tests.
 * @returns the edit controller used by render_ui and the block-level tool.
 */
export function createArtifactEditController(
  ctx: {
    on?: (event: string, handler: (...args: any[]) => unknown, prepend?: boolean) => unknown
    logger?: { warn(message: string): void }
  } = {},
  revisions: ArtifactRevisionStore,
  options: { now?: () => number } = {},
): ArtifactEditController {
  const now = options.now ?? Date.now
  const sessions = new Map<string, SessionState>()

  /** Live, non-expired entries in arrival order; expired entries are dropped. */
  const liveEntries = (sessionId: string): Entry[] => {
    const state = sessions.get(sessionId)
    if (state === undefined) return []
    const expired: string[] = []
    for (const entry of state.entries.values()) {
      if (now() - entry.createdAt >= ARTIFACT_EDIT_TTL) expired.push(entry.requestId)
    }
    for (const requestId of expired) state.entries.delete(requestId)
    if (state.entries.size === 0) {
      sessions.delete(sessionId)
      return []
    }
    return [...state.entries.values()]
  }

  const viewOf = (entry: Entry): PendingArtifactEdit => ({
    ...entry.request === undefined || entry.invalidReason !== undefined ? {} : { request: entry.request },
    ...entry.invalidReason === undefined ? {} : { invalidReason: entry.invalidReason },
    requestId: entry.requestId,
    ...entry.artifactId === undefined ? {} : { artifactId: entry.artifactId },
    ...entry.mode === undefined ? {} : { mode: entry.mode },
    ...entry.messageId === undefined ? {} : { messageId: entry.messageId },
  })

  const summaryOf = (entry: Entry): PendingArtifactEditSummary => ({
    requestId: entry.requestId,
    ...entry.artifactId === undefined ? {} : { artifactId: entry.artifactId },
    ...entry.mode === undefined ? {} : { mode: entry.mode },
    invalid: entry.invalidReason !== undefined,
  })

  /** Store one entry: same requestId replaces, per-session cap drops the oldest. */
  const arm = (sessionId: string, entry: Entry): void => {
    let state = sessions.get(sessionId)
    if (state === undefined) {
      if (sessions.size >= MAX_PENDING_SESSIONS) {
        let oldestSession: string | undefined
        let oldestAt = Number.POSITIVE_INFINITY
        for (const [id, candidate] of sessions) {
          let newest = 0
          for (const item of candidate.entries.values()) if (item.createdAt > newest) newest = item.createdAt
          if (newest < oldestAt) {
            oldestAt = newest
            oldestSession = id
          }
        }
        if (oldestSession !== undefined) sessions.delete(oldestSession)
      }
      state = { entries: new Map() }
      sessions.set(sessionId, state)
    }
    state.entries.delete(entry.requestId)
    while (state.entries.size >= MAX_SESSION_REQUESTS) {
      const oldest = state.entries.keys().next()
      if (oldest.done === true) break
      state.entries.delete(oldest.value)
    }
    state.entries.set(entry.requestId, entry)
  }

  /** Delete one consumed request, dropping the session state when it becomes empty. */
  const consume = (sessionId: string, requestId: string): void => {
    const state = sessions.get(sessionId)
    if (state === undefined) return
    state.entries.delete(requestId)
    if (state.entries.size === 0) sessions.delete(sessionId)
  }

  type Resolution = { readonly entry?: Entry; readonly error?: PendingSelectorError }
  const resolve = (sessionId: string, selector: PendingArtifactSelector | undefined): Resolution => {
    const live = liveEntries(sessionId)
    const requestId = selector?.requestId
    const artifactId = selector?.artifactId
    if (requestId !== undefined) {
      const entry = live.find(candidate => candidate.requestId === requestId)
      if (entry === undefined) return { error: 'unknown_request' }
      if (artifactId !== undefined && entry.artifactId !== artifactId) return { entry, error: 'artifact_mismatch' }
      return { entry }
    }
    if (artifactId !== undefined) {
      const matches = live.filter(candidate => candidate.artifactId === artifactId)
      if (matches.length === 0) return { error: 'unknown_artifact' }
      if (matches.length > 1) return { error: 'multiple_pending' }
      return { entry: matches[0] }
    }
    if (live.length === 0) return {}
    if (live.length > 1) return { error: 'multiple_pending' }
    return { entry: live[0] }
  }

  const selectorFailure = (tool: 'render_ui' | 'edit_ui_blocks', error: PendingSelectorError): Error => {
    switch (error) {
      case 'multiple_pending':
        return new Error(`${tool}: more than one Artifact edit request is pending for this session; choose exactly one pending request by passing requestId in the tool arguments.`)
      case 'unknown_request':
        return new Error(`${tool}: no pending Artifact edit request matches the given requestId.`)
      case 'unknown_artifact':
        return new Error(`${tool}: no pending Artifact edit request matches the given artifactId.`)
      case 'artifact_mismatch':
        return new Error(`${tool}: the pending requestId does not belong to the given artifactId.`)
    }
  }

  /** Describe why one parsed request cannot be applied, or undefined when it can. */
  const describeProblem = (request: ArtifactEditRequest): string | undefined => {
    // A branch edit may target an older revision; apply() re-validates that base.
    if (request.branch !== true) {
      const base = revisions.get(request.baseRevisionId)
      if (base !== undefined && (base.artifactId !== request.artifactId || base.revision !== request.baseRevision)) {
        return `render_ui: this ${isStyleEditRequest(request) ? 'style' : 'block'} edit request belongs to a different artifact revision. ${RELOAD}`
      }
    }
    if (isStyleEditRequest(request)) {
      // Style requests carry no block targets: validate the base page shape and
      // the same staleness rule, then leave style/arg checks to apply().
      const extraction = extractArtifactBlocks(request.program)
      if (extraction.rootType !== 'Col' || extraction.unsupported !== undefined) {
        return `render_ui: the style edit request's original program cannot be edited (${extraction.unsupported ?? 'root_not_col'}). ${RELOAD}`
      }
      if (request.branch !== true) {
        const status = revisions.status({ artifactId: request.artifactId, revisionId: request.baseRevisionId })
        if (status.conflict || status.revision !== request.baseRevision || status.latestRevision !== request.baseRevision) {
          return staleMessage(request, status)
        }
      }
      return undefined
    }
    const extraction = extractArtifactBlocks(request.program)
    if (extraction.unsupported !== undefined) {
      return `render_ui: the block edit request's original program cannot be block-edited (${extraction.unsupported}). ${RELOAD}`
    }
    const baseBlockIds = extraction.blocks.map(block => block.blockId)
    const orderProblem = describeTargetOrderProblem(request.targetOrder, baseBlockIds)
    if (orderProblem !== undefined) {
      return `render_ui: the block edit request has an invalid target order (${orderProblem}); it must list every top-level block id exactly once. ${RELOAD}`
    }
    if (isNestedEditRequest(request)) {
      const nestedProblem = describeNestedEditProblem(request.program, request)
      if (nestedProblem !== undefined) return `render_ui: ${nestedProblem}`
    } else {
      const targetProblem = verifyEditTargets(extraction, request.edits)
      if (targetProblem !== undefined) {
        return `render_ui: this block edit request does not match the program it was made for (${targetProblem}). ${RELOAD}`
      }
    }
    if (request.orderByParent !== undefined) {
      const orderProblem = describeOrderByParentProblem(request.program, request)
      if (orderProblem !== undefined) return `render_ui: ${orderProblem}`
    }
    if (request.orderByParent === undefined) {
      if (isNoOpEditRequest(request, baseBlockIds)) return NO_OP_MESSAGE
    } else {
      const tree = buildArtifactTree(request.program, nestedTreeOptions(request))
      const noEdits = request.edits.length === 0 && (request.globalInstruction?.trim() ?? '') === ''
      if (noEdits && !isReorderedOrder(baseBlockIds, request.targetOrder) && isOrderByParentNoOp(tree, request.orderByParent)) {
        return NO_OP_MESSAGE
      }
    }
    if (request.branch !== true) {
      const status = revisions.status({ artifactId: request.artifactId, revisionId: request.baseRevisionId })
      if (status.conflict || status.revision !== request.baseRevision || status.latestRevision !== request.baseRevision) {
        return staleMessage(request, status)
      }
    }
    return undefined
  }

  // Cordis supports prepend. Observe the user message before later projections publish it.
  ctx.on?.('session/event', (session: { id?: string }, event: ArtifactEditSessionEvent) => {
    if (event.type !== 'user/message' || typeof session.id !== 'string' || session.id === '') return
    const sessionId = session.id
    const data = event.data
    if (data === undefined) return
    // Injected user-role context (skills, file notices, goals) is not a human edit.
    const source = data.source
    if (source?.kind !== undefined && source.kind !== 'user') return
    // Installed user messages carry content directly; keep the nested message shape too.
    const text = messageText(data.message?.content ?? data.content)
    if (text === undefined || !text.includes(ARTIFACT_EDIT_OPEN)) return
    const messageId = typeof data.id === 'string' ? data.id : undefined
    const message = messageId === undefined ? {} : { messageId }
    const requests = parseEditRequestTexts(text)
    if (requests.length === 0) {
      // Keep the old single-pending behavior for one unreadable legacy envelope.
      sessions.delete(sessionId)
      arm(sessionId, { requestId: LEGACY_UNREADABLE_REQUEST_ID, invalidReason: UNREADABLE_MESSAGE, createdAt: now(), ...message })
      return
    }
    // An old client sends one envelope without requestId; that send replaces the
    // session's previous request, exactly like the pre-batch Host.
    if (requests.every(request => request.requestId === undefined)) sessions.delete(sessionId)
    if (requests.length > MAX_ARTIFACT_BATCH_REQUESTS) {
      ctx.logger?.warn(`intelligent-ui: ignored ${requests.length - MAX_ARTIFACT_BATCH_REQUESTS} artifact edit request(s) beyond the per-message limit of ${MAX_ARTIFACT_BATCH_REQUESTS}`)
    }
    const acceptedArtifacts = new Set<string>()
    for (const request of requests.slice(0, MAX_ARTIFACT_BATCH_REQUESTS)) {
      const requestId = request.requestId ?? legacyRequestId(request)
      const artifactId = request.artifactId
      const duplicate = acceptedArtifacts.has(artifactId)
      acceptedArtifacts.add(artifactId)
      const mode: 'block' | 'full' | 'style' = isStyleEditRequest(request)
        ? 'style'
        : request.edits.length > 0 || (request.additions?.length ?? 0) > 0 ? 'block' : 'full'
      const base = { requestId, request, artifactId, mode, createdAt: now(), ...message }
      if (duplicate) {
        ctx.logger?.warn(`intelligent-ui: ignored a duplicate artifact edit request for ${artifactId} in one user message`)
        arm(sessionId, { ...base, invalidReason: DUPLICATE_ARTIFACT_MESSAGE(artifactId) })
        continue
      }
      const problem = describeProblem(request)
      arm(sessionId, problem === undefined ? base : { ...base, invalidReason: problem })
    }
  }, true)
  ctx.on?.('session/disposed', (session: { id?: string }) => { if (typeof session.id === 'string') sessions.delete(session.id) })

  const pending: ArtifactEditController['pending'] = (sessionId, selector) => {
    if (sessionId === undefined) return undefined
    const resolved = resolve(sessionId, selector)
    if (resolved.error === undefined) return resolved.entry === undefined ? undefined : viewOf(resolved.entry)
    if (resolved.error === 'artifact_mismatch' && resolved.entry !== undefined) {
      return { error: resolved.error, requestId: resolved.entry.requestId, artifactId: resolved.entry.artifactId }
    }
    return { error: resolved.error }
  }

  const listPending: ArtifactEditController['listPending'] = sessionId => {
    if (sessionId === undefined) return []
    return liveEntries(sessionId).map(summaryOf)
  }

  return {
    pending,
    listPending,
    apply({ sessionId, callId, args, composedProgram, requestId, artifactId }) {
      if (sessionId === undefined) throw new Error('render_ui: a block edit needs a session identity.')
      const state = sessions.get(sessionId)
      if (state === undefined) throw new Error(NO_PENDING_MESSAGE)
      const before = [...state.entries.values()]
      const live = liveEntries(sessionId)
      if (requestId === undefined && artifactId === undefined && live.length === 0 && before.length === 1) {
        // Preserve the pre-batch TTL error when the only request just expired.
        throw new Error(EXPIRED_MESSAGE)
      }
      if (live.length === 0) throw new Error(NO_PENDING_MESSAGE)
      const tool = composedProgram === undefined ? 'render_ui' : 'edit_ui_blocks'
      const resolved = resolve(sessionId, requestId === undefined && artifactId === undefined ? undefined : { requestId, artifactId })
      if (resolved.error !== undefined) throw selectorFailure(tool, resolved.error)
      const entry = resolved.entry
      if (entry === undefined) throw new Error(NO_PENDING_MESSAGE)
      if (entry.invalidReason !== undefined) throw new Error(entry.invalidReason)
      const request = entry.request
      if (request === undefined) throw new Error(UNREADABLE_MESSAGE)
      if (typeof callId !== 'string' || !ARTIFACT_ID_PATTERN.test(callId)) {
        throw new Error('render_ui: the block edit needs the current tool call identity; call render_ui again.')
      }
      // A block-level tool supplies the Host-composed page; the render_ui style
      // arguments never travel with it and the recorded request style still wins.
      const composed = composedProgram !== undefined
      if (isStyleEditRequest(request)) {
        // The composed path is edit_ui_blocks only; a style edit is render_ui once.
        if (composed) {
          throw new Error('edit_ui_blocks: this request changes the page presentation only; call render_ui once with the complete updated program and the approved temporaryStyle instead.')
        }
        if ('styleId' in args) {
          throw new Error('render_ui: this style edit keeps the recorded page style; omit styleId.')
        }
        if (args.style !== request.style) {
          throw new Error(`render_ui: this style edit must keep the recorded page layout "${request.style}"; pass style: "${request.style}".`)
        }
        if (!isStyleSnapshot(args.temporaryStyle)) {
          throw new Error(`render_ui: this style edit needs the approved temporaryStyle snapshot: ${describeStyleSnapshotProblem(args.temporaryStyle) ?? 'snapshot rejected'}.`)
        }
        if (args.temporaryStyle.baseLayout !== request.style) {
          throw new Error('render_ui: this style edit must keep temporaryStyle.baseLayout equal to the recorded style.')
        }
      } else if (!composed) {
        // Temporary-style results are content-editable only through the composed
        // block path; the full-program fallback keeps its on-demand authorization.
        if (request.temporaryStyle !== undefined) {
          throw new Error('render_ui: this artifact uses a result-owned temporary style, so only content edits through edit_ui_blocks are supported. Order-only or global-only edits on a temporary style are not supported; ask the user to edit the page content, or re-render it with a saved style first.')
        }
        if ('temporaryStyle' in args) {
          throw new Error('render_ui: block editing is not supported for temporary-style results; ask the user to re-render the page with a saved or built-in style before editing.')
        }
        if (args.style !== request.style) {
          throw new Error(`render_ui: this block edit must keep the recorded page style "${request.style}"; pass style: "${request.style}".`)
        }
        if (request.styleId === undefined) {
          if ('styleId' in args) throw new Error('render_ui: this block edit keeps a built-in page style; omit styleId.')
        } else if (args.styleId !== request.styleId) {
          throw new Error(`render_ui: this block edit must keep the recorded style template; pass styleId: "${request.styleId}".`)
        }
      }
      // A prior turn may have recorded a newer revision while this request stayed armed.
      // A branch edit is allowed to target an older revision; it becomes latest+1.
      const branch = request.branch === true
      const base = revisions.get(request.baseRevisionId)
      const latest = revisions.latestFor(request.artifactId)
      let revisionNumber: number
      if (branch) {
        const problem = branchBaseProblem(request, base, tool)
        if (problem !== undefined) throw new Error(problem)
        revisionNumber = (latest === undefined ? request.baseRevision : latest.revision) + 1
      } else {
        if (base !== undefined && (base.artifactId !== request.artifactId || base.revision !== request.baseRevision)) {
          throw new Error(`${tool}: this ${isStyleEditRequest(request) ? 'style' : 'block'} edit request belongs to a different artifact revision. ${RELOAD}`)
        }
        const status = revisions.status({ artifactId: request.artifactId, revisionId: request.baseRevisionId })
        if (status.conflict || status.revision !== request.baseRevision || status.latestRevision !== request.baseRevision) {
          throw new Error(staleMessage(request, status, tool))
        }
        revisionNumber = request.baseRevision + 1
      }
      if (revisionNumber > 100_000) {
        throw new Error(`${tool}: this artifact has reached its maximum revision number; start a new page or restore an older revision instead.`)
      }
      const program = composed ? composedProgram.trim() : typeof args.program === 'string' ? args.program.trim() : ''
      const updated = extractArtifactBlocks(program)
      if (updated.rootType !== 'Col') {
        throw new Error(composed
          ? 'edit_ui_blocks: the composed block program is not a valid artifact page; call edit_ui_blocks again with one complete expression per selected block.'
          : 'render_ui: an updated artifact page must keep root = Col([...]); the program was not recorded as a new revision. Fix the root and call render_ui again.')
      }
      if (isStyleEditRequest(request)) {
        const snapshot = args.temporaryStyle as StyleSnapshot
        // H7: the revision records the snapshot the model returned through the
        // tool arguments, never the envelope snapshot it started from.
        if (program === request.program.trim() && JSON.stringify(snapshot) === JSON.stringify(request.temporaryStyle)) {
          throw new Error(STYLE_NO_OP_MESSAGE)
        }
        const warnings = artifactEditWarnings(request.program, program, [])
        // H4: warn when a style-only revision returns a page with no editable blocks.
        const baseExtraction = extractArtifactBlocks(request.program)
        if (baseExtraction.blocks.length > 0 && updated.blocks.length === 0) warnings.push(STYLE_EMPTY_BLOCKS_WARNING)
        const styleRecord: ArtifactRevisionRecord = {
          revisionId: callId,
          artifactId: request.artifactId,
          baseRevisionId: request.baseRevisionId,
          revision: revisionNumber,
          sessionId,
          style: request.style,
          temporaryStyle: snapshot,
          ...request.title === undefined ? {} : { title: request.title },
          createdAt: now(),
        }
        revisions.record(styleRecord)
        consume(sessionId, entry.requestId)
        return {
          lineage: {
            artifactId: styleRecord.artifactId,
            revisionId: styleRecord.revisionId,
            requestId: request.requestId,
            baseRevisionId: styleRecord.baseRevisionId,
            revision: styleRecord.revision,
            temporaryStyle: snapshot,
            ...request.title === undefined ? {} : { title: request.title },
          },
          warnings,
          styleEdit: true,
        }
      }
      const nested = isNestedEditRequest(request)
      let nestedPlan: NestedEditPlan | undefined
      if (nested) {
        const plan = planNestedEdits(request.program, request)
        if (!plan.ok) throw new Error(`${tool}: ${plan.message}`)
        nestedPlan = plan.plan
      }
      // M4-2 hierarchical ordering runs before the legacy root targetOrder.
      let orderedProgram = program
      let orderByParentChanged = false
      if (request.orderByParent !== undefined) {
        const ordered = applyOrderByParent(request.program, orderedProgram, request, {
          baseRevisionId: request.baseRevisionId,
          containerTypes: [...NESTED_EDIT_CONTAINER_TYPES],
        })
        if (!ordered.ok) throw new Error(`${tool}: ${ordered.message}`)
        orderByParentChanged = ordered.program !== orderedProgram
        orderedProgram = ordered.program
      }
      const baseExtraction = extractArtifactBlocks(request.program)
      // Nested edits are recorded through the root-level blocks they affect so the
      // revision metadata and warnings keep their existing block-id contract.
      const editedBlockIds = nestedPlan === undefined
        ? request.edits.map(edit => edit.blockId)
        : nestedRootBlockIds(request.program, nestedPlan.tree, [
          ...nestedPlan.nodes,
          ...nestedPlan.additionParents.map(entry => entry.parent),
        ])
      // The Host owns the mechanical arrangement; the client `orderChanged` hint is not trusted.
      let effectiveProgram = orderedProgram
      let normalizedProgram: string | undefined
      const rootOrderOwnedByParent = request.orderByParent?.root !== undefined
      if (!rootOrderOwnedByParent && isReorderedOrder(baseExtraction.blocks.map(block => block.blockId), request.targetOrder)) {
        const reordered = reorderProgramToTargetOrder(orderedProgram, request.targetOrder, baseExtraction)
        if (reordered === undefined) {
          throw new Error(composed
            ? 'edit_ui_blocks: the composed page no longer keeps every top-level block, so the block order cannot be restored; call edit_ui_blocks again without renaming or removing blocks.'
            : ARRANGEMENT_MESSAGE)
        }
        effectiveProgram = reordered
        if (reordered !== program) normalizedProgram = reordered
      }
      // A block-level result only carries a fragment, so its lineage always needs the composed page.
      if (composed) normalizedProgram = effectiveProgram
      else if (orderByParentChanged && normalizedProgram === undefined) normalizedProgram = effectiveProgram
      // The lineage program is replayed by the client and must satisfy the shared request bound.
      if (normalizedProgram !== undefined && normalizedProgram.length > MAX_ARTIFACT_PROGRAM_CHARS) {
        throw new Error(composed
          ? `edit_ui_blocks: the composed program is too long for an artifact revision (limit ${MAX_ARTIFACT_PROGRAM_CHARS} characters); shorten the block program and call edit_ui_blocks again.`
          : `render_ui: the arranged program is too long for an artifact revision (limit ${MAX_ARTIFACT_PROGRAM_CHARS} characters); shorten it and call render_ui again.`)
      }
      const warnings = artifactEditWarnings(request.program, effectiveProgram, editedBlockIds)
      // Strict mode rejects unselected *content* changes. Ordering is applied after this
      // content program, so legitimate reorder/orderByParent requests cannot false-positive.
      if (request.strict === true) {
        const strictWarnings = artifactEditWarnings(request.program, program, editedBlockIds)
        if (strictWarnings.length > 0) {
          const summary = strictWarnings.slice(0, 3).join(' ')
          throw new Error(`${composed ? 'edit_ui_blocks' : 'render_ui'}: strict mode is on; unselected block(s) changed: ${summary} Keep every unselected top-level block unchanged and try again; this edit request stays pending.`)
        }
      }
      const record: ArtifactRevisionRecord = {
        revisionId: callId,
        artifactId: request.artifactId,
        baseRevisionId: request.baseRevisionId,
        revision: revisionNumber,
        sessionId,
        style: request.style,
        ...request.styleId === undefined ? {} : { styleId: request.styleId },
        ...request.temporaryStyle === undefined ? {} : { temporaryStyle: request.temporaryStyle },
        ...request.title === undefined ? {} : { title: request.title },
        editedBlockIds,
        createdAt: now(),
      }
      revisions.record(record)
      consume(sessionId, entry.requestId)
      return {
        lineage: {
          artifactId: record.artifactId,
          revisionId: record.revisionId,
          ...request.requestId === undefined ? {} : { requestId: request.requestId },
          baseRevisionId: request.baseRevisionId,
          revision: record.revision,
          editedBlockIds,
          ...normalizedProgram === undefined ? {} : { program: normalizedProgram },
          ...request.temporaryStyle === undefined ? {} : { temporaryStyle: request.temporaryStyle },
        },
        warnings,
      }
    },
  }
}
