/**
 * M4-3 deterministic structure operations for Artifacts.
 *
 * Two responsibilities live here:
 * - an authoritative, bounded, durable program registry (`lookup(artifactId,
 *   revisionId)`), fed by render_ui/edit_ui_blocks/restore and by this route, so
 *   a structure request never trusts a client-supplied program;
 * - the authenticated POST route that validates a revision-scoped operation
 *   batch against that program, applies it atomically through the source CST
 *   engine and records the resulting revision without a model turn.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ARTIFACT_ID_PATTERN, MAX_ARTIFACT_PROGRAM_CHARS, isEditLayout } from '../shared/artifact-edit.ts'
import {
  ARTIFACT_STRUCTURE_ROUTE_PATH,
  MAX_ARTIFACT_STRUCTURE_OPERATIONS,
  describeStructureRequestProblem,
  type ArtifactStructureOperation,
  type ArtifactStructurePreview,
  type ArtifactStructureRequest,
  type ArtifactStructureResult,
} from '../shared/artifact-structure.ts'
import {
  buildArtifactTree,
  duplicateNode,
  inspectProgramStructure,
  moveNode,
  removeNode,
  replaceNodeContent,
  type ArtifactTree,
  type ArtifactTreeNode,
} from '../shared/program-cst.ts'
import {
  artifactBlockPropsFromNode,
  describeArtifactBlockPropsProblem,
  isArtifactBlockPropComponent,
  serializeArtifactBlockProps,
  type ArtifactBlockProps,
} from '../shared/artifact-block-props.ts'
import { isStyleSnapshot, type StyleSnapshot } from '../shared/style-templates.ts'
import type { RenderLayout } from '../shared/intelligent-ui.ts'
import type { ArtifactRevisionRecord, ArtifactRevisionStore } from './artifact-revisions.ts'
import { resolveArtifactBase } from './artifact-base.ts'

/** Bound on authoritative programs kept on disk (LRU by last access). */
export const MAX_PROGRAM_RECORDS = 200
/** Bound on the sum of stored authoritative programs. */
export const MAX_PROGRAM_STORE_BYTES = 50 * 1024 * 1024
/** Bound on recorded structure operation results (idempotency ledger). */
export const MAX_STRUCTURE_OPERATION_RECORDS = 200

/** Containers the structure route may address (M4-3 v1). */
import { NESTED_CONTAINER_TYPES } from '../shared/artifact-containers.ts'
export const STRUCTURE_CONTAINER_TYPES = NESTED_CONTAINER_TYPES

/** Compact touched entries returned in a preview response. */
const MAX_STRUCTURE_PREVIEW_TOUCHED = 120

/** Session identity recorded for revisions created by the structure route. */
const STRUCTURE_SESSION_ID = 'structure-route'
/** Max JSON body for one structure request (operations only, no program). */
const MAX_STRUCTURE_BODY_BYTES = 64 * 1024

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/
const STYLE_ID_PATTERN = /^cs_[a-z0-9]{6,64}$/i
const DIGEST_PATTERN = /^[a-f0-9]{16,64}$/

function programFile(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-intelligent-ui-programs.json')
}

function operationLedgerFile(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-intelligent-ui-structure-operations.json')
}

interface Logger { warn(message: string): void }

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_ID_PATTERN.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

function isBoundedText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max && !CONTROL_CHARACTERS.test(value)
}

function writeAtomic(file: string, value: unknown, corrupt: boolean): void {
  mkdirSync(dirname(file), { recursive: true })
  if (corrupt) renameSync(file, `${file}.corrupt-${Date.now()}`)
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(`${file}.tmp`, file)
}

// ---------------------------------------------------------------------------
// Authoritative program registry
// ---------------------------------------------------------------------------

/** One authoritative program revision. */
export interface ArtifactProgramRecord {
  readonly artifactId: string
  readonly revisionId: string
  readonly program: string
  readonly createdAt: number
  readonly lastAccessAt: number
}

export interface ArtifactProgramStore {
  /** Persist the program rendered/recorded for one revision. */
  record(input: { readonly artifactId: string; readonly revisionId: string; readonly program: string }): void
  /** Authoritative program for one revision; updates the in-memory LRU order. */
  lookup(artifactId: string, revisionId: string): string | undefined
  /** Number of retained programs. */
  size(): number
  /** Sum of retained program characters. */
  totalBytes(): number
  /** Retained metadata for diagnostics/tests (no program body). */
  list(): readonly Omit<ArtifactProgramRecord, 'program'>[]
}

export interface ProgramStoreOptions {
  readonly now?: () => number
  readonly maxRecords?: number
  readonly maxBytes?: number
}

function validProgramRecord(value: unknown): value is ArtifactProgramRecord {
  if (!isRecord(value)) return false
  return Object.keys(value).every(key => ['artifactId', 'revisionId', 'program', 'createdAt', 'lastAccessAt'].includes(key))
    && isIdentity(value.artifactId) && isIdentity(value.revisionId)
    && typeof value.program === 'string' && value.program.length > 0 && value.program.length <= MAX_ARTIFACT_PROGRAM_CHARS
    && isInteger(value.createdAt, 0, Number.MAX_SAFE_INTEGER)
    && isInteger(value.lastAccessAt, 0, Number.MAX_SAFE_INTEGER)
}

function validProgramCollection(value: unknown): value is ArtifactProgramRecord[] {
  if (!Array.isArray(value) || !value.every(validProgramRecord)) return false
  const keys = new Set(value.map(record => `${record.artifactId}\u0000${record.revisionId}`))
  return keys.size === value.length
}

/** Open the durable authoritative program registry. */
export function createArtifactProgramStore(ctx: { logger?: Logger } = {}, options: ProgramStoreOptions = {}): ArtifactProgramStore {
  const file = programFile()
  const now = options.now ?? Date.now
  const maxRecords = options.maxRecords ?? MAX_PROGRAM_RECORDS
  const maxBytes = options.maxBytes ?? MAX_PROGRAM_STORE_BYTES
  let programs: ArtifactProgramRecord[] = []
  let corrupt = false
  try {
    const loaded = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; programs?: unknown }
    if (!isRecord(loaded) || Object.keys(loaded).length !== 2 || loaded.version !== 1) throw new Error('Invalid program registry file')
    if (!validProgramCollection(loaded.programs)) throw new Error('Invalid program registry collection')
    programs = loaded.programs
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      corrupt = true
      ctx.logger?.warn('intelligent-ui: could not load authoritative programs; starting empty')
    }
  }
  const bytesOf = (list: readonly ArtifactProgramRecord[]): number => list.reduce((total, record) => total + record.program.length, 0)
  const prune = (list: ArtifactProgramRecord[]): ArtifactProgramRecord[] => {
    let next = list
    while (next.length > maxRecords || bytesOf(next) > maxBytes) {
      let oldest: ArtifactProgramRecord | undefined
      for (const record of next) if (oldest === undefined || record.lastAccessAt < oldest.lastAccessAt) oldest = record
      if (oldest === undefined) break
      next = next.filter(record => record !== oldest)
    }
    return next
  }
  /**
   * Persist one candidate state, then commit it in memory.
   *
   * Writing first keeps a failed disk write (full disk, permissions, a corrupt
   * recovery rename) from leaving a phantom record or an already-pruned LRU
   * order in memory while the file still holds the previous state.
   */
  const persist = (next: ArtifactProgramRecord[]): void => {
    writeAtomic(file, { version: 1, programs: next }, corrupt)
    corrupt = false
    programs = next
  }
  return {
    record(input) {
      if (!isIdentity(input.artifactId) || !isIdentity(input.revisionId)) throw new Error('Invalid program revision identity')
      if (typeof input.program !== 'string' || input.program.length === 0 || input.program.length > MAX_ARTIFACT_PROGRAM_CHARS) {
        throw new Error('Invalid authoritative program')
      }
      const timestamp = now()
      const existing = programs.find(record => record.artifactId === input.artifactId && record.revisionId === input.revisionId)
      if (existing !== undefined) {
        if (existing.program !== input.program) throw new Error('Authoritative programs are immutable')
        persist(programs.map(record => record === existing ? { ...record, lastAccessAt: timestamp } : record))
        return
      }
      persist(prune([...programs, {
        artifactId: input.artifactId,
        revisionId: input.revisionId,
        program: input.program,
        createdAt: timestamp,
        lastAccessAt: timestamp,
      }]))
    },
    lookup(artifactId, revisionId) {
      const found = programs.find(record => record.artifactId === artifactId && record.revisionId === revisionId)
      if (found === undefined) return undefined
      const timestamp = now()
      programs = programs.map(record => record === found ? { ...record, lastAccessAt: timestamp } : record)
      return found.program
    },
    size: () => programs.length,
    totalBytes: () => bytesOf(programs),
    list: () => programs.map(({ artifactId, revisionId, createdAt, lastAccessAt }) => ({ artifactId, revisionId, createdAt, lastAccessAt })),
  }
}

// ---------------------------------------------------------------------------
// Structure operation idempotency ledger
// ---------------------------------------------------------------------------

/** One recorded structure request result (program body lives in the program registry). */
export interface ArtifactStructureOperationRecord {
  readonly operationId: string
  readonly artifactId: string
  readonly requestDigest: string
  readonly revisionId: string
  readonly revision: number
  readonly baseRevisionId: string
  readonly title?: string
  readonly style: RenderLayout
  readonly styleId?: string
  readonly temporaryStyle?: StyleSnapshot
  readonly createdAt: number
}

export interface ArtifactStructureOperationStore {
  get(artifactId: string, operationId: string): ArtifactStructureOperationRecord | undefined
  record(record: ArtifactStructureOperationRecord): void
  size(): number
}

export interface OperationStoreOptions {
  readonly maxRecords?: number
}

function validOperationRecord(value: unknown): value is ArtifactStructureOperationRecord {
  if (!isRecord(value)) return false
  return Object.keys(value).every(key => [
    'operationId', 'artifactId', 'requestDigest', 'revisionId', 'revision', 'baseRevisionId',
    'title', 'style', 'styleId', 'temporaryStyle', 'createdAt',
  ].includes(key))
    && isIdentity(value.operationId) && isIdentity(value.artifactId) && isIdentity(value.revisionId) && isIdentity(value.baseRevisionId)
    && typeof value.requestDigest === 'string' && DIGEST_PATTERN.test(value.requestDigest)
    && isInteger(value.revision, 2, 100_000)
    && isEditLayout(value.style)
    && (!('title' in value) || isBoundedText(value.title, 1, 200))
    && (!('styleId' in value) || (typeof value.styleId === 'string' && STYLE_ID_PATTERN.test(value.styleId)))
    && (!('temporaryStyle' in value) || (isStyleSnapshot(value.temporaryStyle) && value.temporaryStyle.baseLayout === value.style))
    && isInteger(value.createdAt, 0, Number.MAX_SAFE_INTEGER)
}

/** Open the durable operation ledger used to replay retried structure requests. */
export function createArtifactStructureOperationStore(ctx: { logger?: Logger } = {}, options: OperationStoreOptions = {}): ArtifactStructureOperationStore {
  const file = operationLedgerFile()
  const maxRecords = options.maxRecords ?? MAX_STRUCTURE_OPERATION_RECORDS
  let operations: ArtifactStructureOperationRecord[] = []
  let corrupt = false
  try {
    const loaded = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; operations?: unknown }
    if (!isRecord(loaded) || Object.keys(loaded).length !== 2 || loaded.version !== 1) throw new Error('Invalid structure operation file')
    const list = loaded.operations
    if (!Array.isArray(list) || !list.every(validOperationRecord)) throw new Error('Invalid structure operation collection')
    const keys = new Set(list.map(record => `${record.artifactId}\u0000${record.operationId}`))
    if (keys.size !== list.length) throw new Error('Duplicate structure operation keys')
    operations = list
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      corrupt = true
      ctx.logger?.warn('intelligent-ui: could not load structure operation ledger; starting empty')
    }
  }
  return {
    get(artifactId, operationId) {
      return operations.find(record => record.artifactId === artifactId && record.operationId === operationId)
    },
    record(record) {
      if (!validOperationRecord(record)) throw new Error('Invalid structure operation record')
      const existing = operations.find(candidate => candidate.artifactId === record.artifactId && candidate.operationId === record.operationId)
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('Structure operation records are immutable')
        return
      }
      const next = [...operations, record].slice(-maxRecords)
      operations = next
      writeAtomic(file, { version: 1, operations: next }, corrupt)
      corrupt = false
    },
    size: () => operations.length,
  }
}

// ---------------------------------------------------------------------------
// Deterministic structure executor
// ---------------------------------------------------------------------------

/** One failure of a structure batch with the HTTP status/code the route answers. */
export interface StructureBatchFailure {
  readonly ok: false
  readonly status: number
  readonly code: string
  readonly message: string
}

/** Compact label for one CST node touched by a structure batch (no source text). */
export interface StructurePreviewTouchedEntry {
  readonly nodeId: string
  readonly nodePath: string
  readonly op: string
}

export interface StructureBatchSuccess {
  readonly ok: true
  readonly program: string
  readonly affectedRootBlockIds: readonly string[]
  readonly touched: readonly StructurePreviewTouchedEntry[]
}

function batchFailure(status: number, code: string, message: string): StructureBatchFailure {
  return { ok: false, status, code, message }
}

/** Whether `ancestorId` is a strict ancestor of `nodeId` in the tree. */
function isAncestor(tree: ArtifactTree, ancestorId: string, nodeId: string): boolean {
  let cursor = tree.nodes.get(nodeId)?.parentNodeId
  while (cursor !== undefined) {
    if (cursor === ancestorId) return true
    cursor = tree.nodes.get(cursor)?.parentNodeId
  }
  return false
}

function editableChildren(tree: ArtifactTree, parent: ArtifactTreeNode): string[] {
  return (parent.childSlots.children ?? []).filter(nodeId => tree.nodes.get(nodeId)?.editable === true)
}

/** Full-slot insertion index for an editable insertion position (chrome stays put). */
function insertionIndex(tree: ArtifactTree, parent: ArtifactTreeNode, editableIndex: number, excludeNodeId?: string): number | undefined {
  const children = parent.childSlots.children ?? []
  const remaining = excludeNodeId === undefined ? children : children.filter(nodeId => nodeId !== excludeNodeId)
  const editable = remaining.filter(nodeId => tree.nodes.get(nodeId)?.editable === true)
  if (editableIndex < 0 || editableIndex > editable.length) return undefined
  if (editableIndex < editable.length) return remaining.indexOf(editable[editableIndex] as string)
  const last = editable[editable.length - 1]
  return last === undefined ? remaining.length : remaining.indexOf(last) + 1
}

/** Resolve one base-revision child in the evolving current tree by identity. */
function matchChild(currentTree: ArtifactTree, currentParent: ArtifactTreeNode, baseChild: ArtifactTreeNode): ArtifactTreeNode | undefined {
  const children = (currentParent.childSlots.children ?? [])
    .map(nodeId => currentTree.nodes.get(nodeId))
    .filter((node): node is ArtifactTreeNode => node !== undefined)
  const unique = (candidates: ArtifactTreeNode[]): ArtifactTreeNode | undefined => candidates.length === 1 ? candidates[0] : undefined
  if (baseChild.statementId !== undefined) {
    const found = unique(children.filter(node => node.statementId === baseChild.statementId))
    if (found !== undefined) return found
  }
  if (baseChild.title !== undefined) {
    const found = unique(children.filter(node => node.title === baseChild.title && node.componentType === baseChild.componentType))
    if (found !== undefined) return found
  }
  const byDigest = unique(children.filter(node => node.digest === baseChild.digest && node.componentType === baseChild.componentType))
  if (byDigest !== undefined) return byDigest
  const byType = unique(children.filter(node => node.componentType === baseChild.componentType))
  if (byType !== undefined) return byType
  const byIndex = children[baseChild.childIndex]
  return byIndex !== undefined && byIndex.componentType === baseChild.componentType ? byIndex : undefined
}

/** Resolve one base node (and its parent chain) in the evolving current tree. */
function resolveCurrentNode(baseTree: ArtifactTree, currentTree: ArtifactTree, nodeId: string): ArtifactTreeNode | undefined {
  if (nodeId === baseTree.rootNodeId) return currentTree.nodes.get(currentTree.rootNodeId)
  const chain: ArtifactTreeNode[] = []
  let cursor = baseTree.nodes.get(nodeId)
  while (cursor !== undefined) {
    chain.unshift(cursor)
    cursor = cursor.parentNodeId === undefined ? undefined : baseTree.nodes.get(cursor.parentNodeId)
  }
  let current = currentTree.nodes.get(currentTree.rootNodeId)
  for (const baseNode of chain) {
    if (current === undefined) return undefined
    if (baseNode.nodeId === baseTree.rootNodeId) continue
    current = matchChild(currentTree, current, baseNode)
  }
  return current
}

/** Validate every operation against the base tree before touching the program. */
function validateOperations(
  baseProgram: string,
  operations: readonly ArtifactStructureOperation[],
): { readonly ok: true; readonly tree: ArtifactTree } | StructureBatchFailure {
  const tree = buildArtifactTree(baseProgram, { containerTypes: [...STRUCTURE_CONTAINER_TYPES] })
  if (tree.limitsExceeded !== undefined) {
    return batchFailure(400, 'invalid_input', `the page is too large or nested too deeply for structure operations (${tree.limitsExceeded}).`)
  }
  const resolved: ArtifactTreeNode[] = []
  const propTargets = new Set<string>()
  const batchTargets = new Set<string>()
  for (const operation of operations) {
    const node = tree.nodes.get(operation.nodeId)
    if (node === undefined) return batchFailure(400, 'invalid_input', `unknown block node ${JSON.stringify(operation.nodeId)}.`)
    if (operation.sourceDigest.toLowerCase() !== node.digest.toLowerCase()) {
      return batchFailure(400, 'invalid_input', `block node ${JSON.stringify(operation.nodeId)} changed since it was selected; reload the page and retry.`)
    }
    if (node.depth <= 0) return batchFailure(400, 'invalid_input', 'the root layout cannot be deleted, duplicated or moved.')
    if (node.scoped) return batchFailure(400, 'invalid_input', `block node ${JSON.stringify(operation.nodeId)} is inside an @Each template and cannot be changed structurally in this release.`)
    if (node.shared) return batchFailure(400, 'invalid_input', `block node ${JSON.stringify(operation.nodeId)} belongs to a shared named expression; changing it would change every instance.`)
    if (node.opaque || node.problem !== undefined) return batchFailure(400, 'invalid_input', `block node ${JSON.stringify(operation.nodeId)} is not structurally editable in this release.`)
    if (batchTargets.has(node.nodeId)) {
      return batchFailure(400, 'operation_conflict', `block node ${JSON.stringify(operation.nodeId)} appears more than once in one batch.`)
    }
    batchTargets.add(node.nodeId)
    if (operation.op === 'props') {
      if (!isArtifactBlockPropComponent(node.componentType)) {
        return batchFailure(400, 'invalid_input', `block node ${JSON.stringify(operation.nodeId)} is ${node.componentType}, which has no quick-adjustable properties.`)
      }
      if (propTargets.has(node.nodeId)) {
        return batchFailure(400, 'operation_conflict', `block node ${JSON.stringify(operation.nodeId)} is adjusted more than once in one batch.`)
      }
      propTargets.add(node.nodeId)
      const problem = describeArtifactBlockPropsProblem(node.componentType, operation.props)
      if (problem !== undefined) {
        return batchFailure(400, 'invalid_input', `block node ${JSON.stringify(operation.nodeId)} has unusable properties (${problem}).`)
      }
      resolved.push(node)
      continue
    }
    const parent = node.parentNodeId === undefined ? undefined : tree.nodes.get(node.parentNodeId)
    if (parent === undefined) return batchFailure(400, 'invalid_input', 'the block has no parent container to change.')
    if (parent.shared) return batchFailure(400, 'invalid_input', 'the parent container belongs to a shared named expression; changing it would change every instance.')
    if (parent.scoped) return batchFailure(400, 'invalid_input', 'the parent container is inside an @Each template and cannot be changed structurally in this release.')
    if (parent.childSlots.children === undefined) return batchFailure(400, 'invalid_input', `the parent of ${JSON.stringify(operation.nodeId)} has no editable children slot.`)
    if (operation.toParentNodeId !== undefined && operation.op !== 'move') {
      return batchFailure(400, 'invalid_input', 'toParentNodeId is only valid for move operations.')
    }
    if (operation.op === 'duplicate') {
      const max = editableChildren(tree, parent).length
      if (operation.toIndex === undefined || operation.toIndex < 0 || operation.toIndex > max) {
        return batchFailure(400, 'invalid_input', `duplicate toIndex for ${JSON.stringify(operation.nodeId)} must be between 0 and ${max}.`)
      }
    }
    if (operation.op === 'move' && operation.toParentNodeId === undefined) {
      const remaining = editableChildren(tree, parent).filter(nodeId => nodeId !== node.nodeId)
      if (operation.toIndex === undefined || operation.toIndex < 0 || operation.toIndex > remaining.length) {
        return batchFailure(400, 'invalid_input', `move toIndex for ${JSON.stringify(operation.nodeId)} must be between 0 and ${remaining.length}.`)
      }
    }
    if (operation.op === 'move' && operation.toParentNodeId !== undefined) {
      if (operation.toParentNodeId === parent.nodeId) {
        return batchFailure(400, 'invalid_input', `omit toParentNodeId when moving ${JSON.stringify(operation.nodeId)} within its current parent; use toIndex in the parent's children slot.`)
      }
      const target = tree.nodes.get(operation.toParentNodeId)
      if (target === undefined) {
        return batchFailure(400, 'invalid_input', `unknown target parent node ${JSON.stringify(operation.toParentNodeId)}.`)
      }
      if (target.nodeId === node.nodeId) return batchFailure(400, 'invalid_input', 'a block cannot be moved into itself.')
      if (target.scoped) return batchFailure(400, 'invalid_input', `target parent ${JSON.stringify(operation.toParentNodeId)} is inside an @Each template and cannot receive blocks in this release.`)
      if (target.shared) return batchFailure(400, 'invalid_input', `target parent ${JSON.stringify(operation.toParentNodeId)} belongs to a shared named expression; moving there would change every instance.`)
      if (target.opaque || target.problem !== undefined) return batchFailure(400, 'invalid_input', `target parent ${JSON.stringify(operation.toParentNodeId)} is not structurally editable in this release.`)
      if (!(STRUCTURE_CONTAINER_TYPES as readonly string[]).includes(target.componentType)) {
        return batchFailure(400, 'invalid_input', `target parent ${JSON.stringify(operation.toParentNodeId)} is ${target.componentType}, which cannot receive blocks.`)
      }
      if (target.slotRange === undefined || target.childSlots.children === undefined) {
        return batchFailure(400, 'invalid_input', `target parent ${JSON.stringify(operation.toParentNodeId)} has no writable children slot.`)
      }
      if (isAncestor(tree, node.nodeId, target.nodeId)) {
        return batchFailure(400, 'invalid_input', `cannot move ${JSON.stringify(operation.nodeId)} into its own descendant.`)
      }
      const sourceParent = parent
      if (isAncestor(tree, sourceParent.nodeId, target.nodeId) || isAncestor(tree, target.nodeId, sourceParent.nodeId)) {
        return batchFailure(400, 'invalid_input', 'the source and target containers are ancestor/descendant; their children slots are nested and cannot be rewritten in one operation.')
      }
      const max = editableChildren(tree, target).length
      if (operation.toIndex === undefined || operation.toIndex < 0 || operation.toIndex > max) {
        return batchFailure(400, 'invalid_input', `move toIndex for target ${JSON.stringify(operation.toParentNodeId)} must be between 0 and ${max}.`)
      }
    }
    resolved.push(node)
  }
  for (let left = 0; left < resolved.length; left += 1) {
    for (let right = left + 1; right < resolved.length; right += 1) {
      const first = resolved[left] as ArtifactTreeNode
      const second = resolved[right] as ArtifactTreeNode
      if (isAncestor(tree, first.nodeId, second.nodeId) || isAncestor(tree, second.nodeId, first.nodeId)) {
        return batchFailure(400, 'operation_conflict', 'a structure batch cannot include a block together with its ancestor or descendant.')
      }
    }
  }
  return { ok: true, tree }
}

/**
 * Apply one structure batch to the authoritative base program.
 *
 * Operations run in request order through the CST engine; every target is
 * re-resolved against the evolving tree by block identity (statement name →
 * title+component → digest → unique component type → original index). Any
 * failure aborts the whole batch without returning a program.
 * @param baseProgram - authoritative base revision program.
 * @param operations - validated operation batch.
 * @returns the composed program plus the affected root-level block ids, or a route failure.
 */
export function applyStructureBatch(baseProgram: string, operations: readonly ArtifactStructureOperation[]): StructureBatchSuccess | StructureBatchFailure {
  if (operations.length === 0) return batchFailure(400, 'invalid_input', 'at least one structure operation is required.')
  if (operations.length > MAX_ARTIFACT_STRUCTURE_OPERATIONS) {
    return batchFailure(400, 'invalid_input', `a request may contain at most ${MAX_ARTIFACT_STRUCTURE_OPERATIONS} structure operations.`)
  }
  const validated = validateOperations(baseProgram, operations)
  if (validated.ok === false) return validated
  const baseTree = validated.tree
  const extraction = rootBlockIndex(baseTree)
  const affected = new Set<string>()
  const touched = new Map<string, StructurePreviewTouchedEntry>()
  const recordTouched = (entries: readonly { nodeId: string; nodePath: string; op: string }[], opName: string): void => {
    for (const entry of entries) {
      const op = entry.op === 'ancestor' ? 'ancestor' : opName
      const existing = touched.get(entry.nodeId)
      if (existing === undefined || existing.op === 'ancestor') {
        touched.set(entry.nodeId, { nodeId: entry.nodeId, nodePath: entry.nodePath, op })
      }
    }
  }
  let program = baseProgram
  let tree = baseTree
  for (const operation of operations) {
    const baseNode = baseTree.nodes.get(operation.nodeId) as ArtifactTreeNode
    const rootId = rootBlockForNode(baseTree, baseNode)
    if (rootId !== undefined) {
      const blockId = extraction.find(entry => entry.rootIndex === rootId)?.blockId
      if (blockId !== undefined) affected.add(blockId)
    }
    const currentNode = resolveCurrentNode(baseTree, tree, operation.nodeId)
    if (currentNode === undefined) {
      return batchFailure(400, 'operation_conflict', `block node ${JSON.stringify(operation.nodeId)} could not be located after earlier operations; send fewer or differently ordered operations.`)
    }
    const parentId = currentNode.parentNodeId
    const parent = parentId === undefined ? undefined : tree.nodes.get(parentId)
    if (parent === undefined) return batchFailure(400, 'invalid_input', 'the block has no current parent container.')
    let result
    if (operation.op === 'props') {
      const componentType = currentNode.componentType
      if (!isArtifactBlockPropComponent(componentType)) {
        return batchFailure(400, 'invalid_input', `block node ${JSON.stringify(operation.nodeId)} is not quick-adjustable.`)
      }
      const props = (operation.props ?? {}) as ArtifactBlockProps
      const problem = describeArtifactBlockPropsProblem(componentType, props)
      if (problem !== undefined) {
        return batchFailure(400, 'invalid_input', `block node ${JSON.stringify(operation.nodeId)} has unusable properties (${problem}).`)
      }
      const wanted = serializeArtifactBlockProps(componentType, props)
      if (serializeArtifactBlockProps(componentType, artifactBlockPropsFromNode(componentType, currentNode.props)) === wanted
        && artifactBlockPropsFromNode(componentType, currentNode.props) !== undefined) {
        return batchFailure(400, 'no_change', `block node ${JSON.stringify(operation.nodeId)} already has these properties; nothing to record.`)
      }
      result = replaceNodeContent(program, currentNode.nodeId, wanted, { containerTypes: [...STRUCTURE_CONTAINER_TYPES] })
      if (result.ok === true && result.touched.length === 0) {
        return batchFailure(400, 'no_change', `block node ${JSON.stringify(operation.nodeId)} already has these properties; nothing to record.`)
      }
    } else if (operation.op === 'delete') {
      result = removeNode(program, currentNode.nodeId, { containerTypes: [...STRUCTURE_CONTAINER_TYPES] })
    } else if (operation.op === 'duplicate') {
      const index = insertionIndex(tree, parent, operation.toIndex as number)
      if (index === undefined) return batchFailure(400, 'invalid_input', 'the duplicate target index is no longer valid.')
      result = duplicateNode(program, currentNode.nodeId, parent.nodeId, 'children', index, { containerTypes: [...STRUCTURE_CONTAINER_TYPES] })
    } else if (operation.toParentNodeId !== undefined) {
      const targetBase = baseTree.nodes.get(operation.toParentNodeId)
      if (targetBase === undefined) return batchFailure(400, 'invalid_input', 'the target parent is missing from the base tree.')
      const targetCurrent = resolveCurrentNode(baseTree, tree, targetBase.nodeId)
      if (targetCurrent === undefined) {
        return batchFailure(400, 'operation_conflict', `target parent ${JSON.stringify(operation.toParentNodeId)} could not be located after earlier operations; send fewer operations.`)
      }
      result = moveNode(program, currentNode.nodeId, targetCurrent.nodeId, 'children', operation.toIndex as number, { containerTypes: [...STRUCTURE_CONTAINER_TYPES] })
      const targetRoot = rootBlockForNode(baseTree, targetBase)
      if (targetRoot !== undefined) {
        const blockId = extraction.find(entry => entry.rootIndex === targetRoot)?.blockId
        if (blockId !== undefined) affected.add(blockId)
      }
    } else {
      const index = insertionIndex(tree, parent, operation.toIndex as number, currentNode.nodeId)
      if (index === undefined) return batchFailure(400, 'invalid_input', 'the move target index is no longer valid.')
      result = moveNode(program, currentNode.nodeId, parent.nodeId, 'children', index, { containerTypes: [...STRUCTURE_CONTAINER_TYPES] })
    }
    if (result.ok === false) {
      const code = result.code === 'operation_conflict' ? 'operation_conflict' : 'invalid_input'
      return batchFailure(400, code, `structure operation ${operation.op} on ${JSON.stringify(operation.nodeId)} failed: ${result.message}`)
    }
    recordTouched(result.touched, operation.op)
    program = result.program
    tree = result.tree
  }
  const inspected = inspectProgramStructure(program, {
    containerTypes: [...STRUCTURE_CONTAINER_TYPES],
  })
  if (inspected.ok === false) {
    return batchFailure(400, 'program_invalid', `the edited page is not a valid structure (${inspected.code}): ${inspected.message}`)
  }
  return {
    ok: true,
    program,
    affectedRootBlockIds: [...affected],
    touched: [...touched.values()].slice(0, MAX_STRUCTURE_PREVIEW_TOUCHED),
  }
}

/** Root-level child index containing one node. */
function rootBlockForNode(tree: ArtifactTree, node: ArtifactTreeNode): number | undefined {
  let cursor: ArtifactTreeNode | undefined = node
  while (cursor !== undefined && cursor.parentNodeId !== undefined && cursor.parentNodeId !== tree.rootNodeId) {
    cursor = tree.nodes.get(cursor.parentNodeId)
  }
  return cursor !== undefined && cursor.parentNodeId === tree.rootNodeId ? cursor.childIndex : undefined
}

/** Root-level block ids of one tree, in page order. */
function rootBlockIndex(tree: ArtifactTree): { blockId: string; rootIndex: number }[] {
  const root = tree.nodes.get(tree.rootNodeId)
  const result: { blockId: string; rootIndex: number }[] = []
  let block = 0
  for (const childId of root?.childSlots.children ?? []) {
    const child = tree.nodes.get(childId)
    if (child === undefined) continue
    block += 1
    result.push({ blockId: `b${block}`, rootIndex: child.childIndex })
  }
  return result
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

interface StructureRouteServices {
  readonly webServer?: {
    register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): void }): () => void
  }
  readonly connection?: { requestRejection(req: IncomingMessage): number | undefined }
  effect?(fn: () => unknown): unknown
}

export interface ArtifactStructureServices {
  readonly revisions: ArtifactRevisionStore
  readonly programs: ArtifactProgramStore
  readonly operations: ArtifactStructureOperationStore
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } })
}

class StructureBodyError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Read one bounded JSON structure body; never echoes payload bytes. */
function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return Promise.reject(new StructureBodyError('Content-Type must be application/json.', 400, 'invalid_input'))
  }
  const limitMessage = `The structure request body exceeds ${MAX_STRUCTURE_BODY_BYTES / 1024} KiB.`
  if (Number(req.headers['content-length']) > MAX_STRUCTURE_BODY_BYTES) {
    return Promise.reject(new StructureBodyError(limitMessage, 413, 'payload_too_large'))
  }
  return new Promise((resolve, reject) => {
    let size = 0
    let settled = false
    const parts: Buffer[] = []
    const finish = (failure?: StructureBodyError): void => {
      if (settled) return
      settled = true
      cleanup()
      if (failure !== undefined) {
        req.resume()
        reject(failure)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8')))
      } catch {
        reject(new StructureBodyError('Invalid JSON body.', 400, 'invalid_input'))
      }
    }
    const data = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_STRUCTURE_BODY_BYTES) finish(new StructureBodyError(limitMessage, 413, 'payload_too_large'))
      else parts.push(bytes)
    }
    const end = (): void => finish()
    const failed = (): void => finish(new StructureBodyError('Could not read the structure request body.', 400, 'invalid_input'))
    const timer = setTimeout(() => finish(new StructureBodyError('The structure request body timed out.', 400, 'invalid_input')), 15_000)
    const cleanup = (): void => {
      clearTimeout(timer)
      req.off('data', data)
      req.off('end', end)
      req.off('error', failed)
      req.off('aborted', failed)
    }
    req.on('data', data)
    req.once('end', end)
    req.once('error', failed)
    req.once('aborted', failed)
  })
}

/** Canonical digest binding one operationId to its exact request body. */
function structureRequestDigest(request: ArtifactStructureRequest): string {
  const canonical = {
    artifactId: request.artifactId,
    baseRevisionId: request.baseRevisionId,
    branch: request.branch === true,
    title: request.title ?? null,
    style: request.style,
    styleId: request.styleId ?? null,
    temporaryStyle: request.temporaryStyle ?? null,
    operations: request.operations.map(operation => ({
      op: operation.op,
      nodeId: operation.nodeId,
      sourceDigest: operation.sourceDigest.toLowerCase(),
      ...operation.toIndex === undefined ? {} : { toIndex: operation.toIndex },
      ...operation.toParentNodeId === undefined ? {} : { toParentNodeId: operation.toParentNodeId },
      ...operation.props === undefined ? {} : {
        props: {
          color: operation.props.color ?? null,
          height: operation.props.height ?? null,
          thickness: operation.props.thickness ?? null,
          width: operation.props.width ?? null,
        },
      },
    })),
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** Generate one unused structure revision id. */
function structureRevisionId(revisions: ArtifactRevisionStore): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `struct_${randomBytes(8).toString('hex')}`
    if (revisions.get(candidate) === undefined) return candidate
  }
  throw new Error('Could not allocate a structure revision id')
}

function resultFromRecord(record: ArtifactStructureOperationRecord, program: string): ArtifactStructureResult {
  return {
    artifactId: record.artifactId,
    revisionId: record.revisionId,
    baseRevisionId: record.baseRevisionId,
    revision: record.revision,
    operationId: record.operationId,
    program,
    ...record.title === undefined ? {} : { title: record.title },
    style: record.style,
    ...record.styleId === undefined ? {} : { styleId: record.styleId },
    ...record.temporaryStyle === undefined ? {} : { temporaryStyle: record.temporaryStyle },
  }
}

/**
 * Execute one structure request against the authoritative registry.
 * @returns the wrapped result plus the HTTP status, or a failure.
 */
function executeStructureRequest(
  services: ArtifactStructureServices,
  body: ArtifactStructureRequest,
): { readonly ok: true; readonly status: number; readonly body: { ok: true; result: ArtifactStructureResult } | { ok: true; preview: ArtifactStructurePreview } } | StructureBatchFailure {
  const { revisions, programs, operations } = services
  if (body.preview !== true) {
    const replay = operations.get(body.artifactId, body.operationId)
    if (replay !== undefined) {
      if (replay.requestDigest !== structureRequestDigest(body)) {
        return batchFailure(409, 'operation_replayed', 'this operationId was already used for a different structure request; use a new operationId.')
      }
      const program = programs.lookup(body.artifactId, replay.revisionId)
      if (program === undefined) return batchFailure(500, 'storage', 'the recorded structure result program is no longer available.')
      return { ok: true, status: 200, body: { ok: true, result: resultFromRecord(replay, program) } }
    }
  }
  const latest = revisions.latestFor(body.artifactId)
  const base = resolveArtifactBase({ revisions, programs }, { artifactId: body.artifactId, baseRevisionId: body.baseRevisionId })
  if (base.ok === false) {
    return base.kind === 'artifact_missing'
      ? batchFailure(404, 'artifact_missing', 'no authoritative program is recorded for this artifact; render the page again before changing its structure.')
      : batchFailure(404, 'base_missing', 'the authoritative program for the base revision is not available; reload the page and retry.')
  }
  if (latest !== undefined && latest.revisionId !== body.baseRevisionId && body.branch !== true) {
    return batchFailure(409, 'base_not_latest', 'the base revision is no longer the latest; reload the page or resend the batch with branch: true.')
  }
  const applied = applyStructureBatch(base.program, body.operations)
  if (applied.ok === false) return applied
  if (body.preview === true) {
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        preview: {
          program: applied.program,
          operations: body.operations,
          changedBlockIds: applied.affectedRootBlockIds,
          touched: applied.touched,
        },
      },
    }
  }
  const revision = (latest === undefined ? 1 : latest.revision) + 1
  const revisionId = structureRevisionId(revisions)
  const record: ArtifactRevisionRecord = {
    revisionId,
    artifactId: body.artifactId,
    baseRevisionId: body.baseRevisionId,
    revision,
    sessionId: STRUCTURE_SESSION_ID,
    style: body.style,
    ...body.styleId === undefined ? {} : { styleId: body.styleId },
    ...body.title === undefined ? {} : { title: body.title },
    ...body.temporaryStyle === undefined ? {} : { temporaryStyle: body.temporaryStyle },
    ...applied.affectedRootBlockIds.length === 0 ? {} : { editedBlockIds: [...applied.affectedRootBlockIds] },
    createdAt: Date.now(),
  }
  try {
    programs.record({ artifactId: body.artifactId, revisionId, program: applied.program })
    revisions.record(record)
    operations.record({
      operationId: body.operationId,
      artifactId: body.artifactId,
      requestDigest: structureRequestDigest(body),
      revisionId,
      revision,
      baseRevisionId: body.baseRevisionId,
      ...body.title === undefined ? {} : { title: body.title },
      style: body.style,
      ...body.styleId === undefined ? {} : { styleId: body.styleId },
      ...body.temporaryStyle === undefined ? {} : { temporaryStyle: body.temporaryStyle },
      createdAt: Date.now(),
    })
  } catch (cause) {
    return batchFailure(500, 'storage', `the structure result could not be stored${cause instanceof Error ? `: ${cause.message}` : '.'}`)
  }
  return {
    ok: true,
    status: 201,
    body: {
      ok: true,
      result: {
        artifactId: body.artifactId,
        revisionId,
        baseRevisionId: body.baseRevisionId,
        revision,
        operationId: body.operationId,
        program: applied.program,
        ...body.title === undefined ? {} : { title: body.title },
        style: body.style,
        ...body.styleId === undefined ? {} : { styleId: body.styleId },
        ...body.temporaryStyle === undefined ? {} : { temporaryStyle: body.temporaryStyle },
      },
    },
  }
}

/**
 * Register the authenticated POST structure route with its own disposer.
 * @param ctx - host context with the optional web server/connection services.
 * @param services - revision registry plus authoritative program/operation stores.
 */
export function registerArtifactStructureRoute(
  ctx: { inject?: (dependencies: readonly string[], callback: (scoped: StructureRouteServices) => void) => unknown },
  services: ArtifactStructureServices,
): void {
  ctx.inject?.(['webServer', 'connection'], scoped => {
    const { webServer, connection } = scoped
    if (typeof webServer?.register !== 'function' || typeof connection?.requestRejection !== 'function') return
    scoped.effect?.(() => {
      const dispose = webServer.register({
      kind: 'exact', path: ARTIFACT_STRUCTURE_ROUTE_PATH,
      handler: (req, res) => {
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'cache-control': 'no-store' })
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Use POST for an artifact structure request.' } }))
          return
        }
        void readJson(req).then(raw => {
          const problem = describeStructureRequestProblem(raw)
          if (problem !== undefined) {
            sendError(res, 400, 'invalid_input', `Invalid artifact structure request: ${problem}.`)
            return
          }
          let outcome
          try {
            outcome = executeStructureRequest(services, raw as ArtifactStructureRequest)
          } catch {
            sendError(res, 500, 'storage', 'the structure request could not be processed.')
            return
          }
          if (outcome.ok === false) {
            sendError(res, outcome.status, outcome.code, outcome.message)
            return
          }
          sendJson(res, outcome.status, outcome.body)
        }, (cause: unknown) => {
          if (cause instanceof StructureBodyError) {
            sendError(res, cause.status, cause.code, cause.message)
            return
          }
          sendError(res, 400, 'invalid_input', 'Invalid artifact structure request.')
        })
      },
      })
      return () => { dispose() }
    })
  })
}

