/**
 * Deterministic structural Artifact operations (M4-3).
 *
 * The client posts revision-scoped node ids plus source digests; the Host owns
 * the authoritative base program, applies the finite operation set through the
 * CST engine and records the resulting revision without a model turn.
 */
import {
  ARTIFACT_ID_PATTERN,
  MAX_ARTIFACT_PROGRAM_CHARS,
  isEditLayout,
  isRequestId,
} from './artifact-edit.ts'
import type { RenderLayout } from './intelligent-ui.ts'
import { isStyleSnapshot, type StyleSnapshot } from './style-templates.ts'

/** Route path for one deterministic structure operation batch. */
export const ARTIFACT_STRUCTURE_ROUTE_PATH = '/api/intelligent-ui/artifact-structure'

/** Maximum operations accepted in one batch. */
export const MAX_ARTIFACT_STRUCTURE_OPERATIONS = 20

/** Operation kinds available in M4-3 v1. */
export const ARTIFACT_STRUCTURE_OPS = ['delete', 'duplicate', 'move'] as const

/** One structural operation against a revision-scoped node. */
export interface ArtifactStructureOperation {
  readonly op: (typeof ARTIFACT_STRUCTURE_OPS)[number]
  /** CST node id in the base revision tree. */
  readonly nodeId: string
  /** Digest of the node source in the base revision tree. */
  readonly sourceDigest: string
  /** Zero-based destination index for duplicate/move (same parent only). */
  readonly toIndex?: number
}

/** Body of one structure request; the Host never accepts a client program. */
export interface ArtifactStructureRequest {
  readonly schemaVersion: 1
  readonly artifactId: string
  readonly baseRevisionId: string
  /** Idempotency key: a retried batch returns the already recorded revision. */
  readonly operationId: string
  readonly operations: readonly ArtifactStructureOperation[]
  readonly branch?: boolean
  readonly title?: string
  readonly style: RenderLayout
  readonly styleId?: string
  readonly temporaryStyle?: StyleSnapshot
}

/** Recorded result of one structure request. */
export interface ArtifactStructureResult {
  readonly artifactId: string
  readonly revisionId: string
  readonly baseRevisionId: string
  readonly revision: number
  readonly operationId: string
  readonly program: string
  readonly title?: string
  readonly style: RenderLayout
  readonly styleId?: string
  readonly temporaryStyle?: StyleSnapshot
}

const NODE_ID_PATTERN = /^n[1-9][0-9]{0,4}$/
const DIGEST_PATTERN = /^[a-f0-9]{8,32}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBoundedText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max
}

/** Describe why one structural operation is malformed, or undefined. */
export function describeStructureOperationProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return 'not_an_object'
  if (Object.keys(value).some(key => !['op', 'nodeId', 'sourceDigest', 'toIndex'].includes(key))) return 'unknown_field'
  if (typeof value.op !== 'string' || !(ARTIFACT_STRUCTURE_OPS as readonly string[]).includes(value.op)) return 'invalid_op'
  if (typeof value.nodeId !== 'string' || !NODE_ID_PATTERN.test(value.nodeId)) return 'invalid_node_id'
  if (typeof value.sourceDigest !== 'string' || !DIGEST_PATTERN.test(value.sourceDigest)) return 'invalid_source_digest'
  if (value.op === 'delete') {
    if ('toIndex' in value) return 'unexpected_to_index'
    return undefined
  }
  if (typeof value.toIndex !== 'number' || !Number.isSafeInteger(value.toIndex) || value.toIndex < 0 || value.toIndex > 99) {
    return 'invalid_to_index'
  }
  return undefined
}

/** Describe why one untrusted structure request is unusable, or undefined. */
export function describeStructureRequestProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return 'not_an_object'
  const keys = Object.keys(value)
  if (keys.some(key => ![
    'schemaVersion', 'artifactId', 'baseRevisionId', 'operationId', 'operations',
    'branch', 'title', 'style', 'styleId', 'temporaryStyle',
  ].includes(key))) return 'unknown_field'
  if (value.schemaVersion !== 1) return 'unsupported_version'
  if (typeof value.artifactId !== 'string' || !ARTIFACT_ID_PATTERN.test(value.artifactId)) return 'invalid_artifact_id'
  if (typeof value.baseRevisionId !== 'string' || !ARTIFACT_ID_PATTERN.test(value.baseRevisionId)) return 'invalid_base_revision_id'
  if (!isRequestId(value.operationId)) return 'invalid_operation_id'
  if (!Array.isArray(value.operations) || value.operations.length === 0 || value.operations.length > MAX_ARTIFACT_STRUCTURE_OPERATIONS) {
    return 'invalid_operations'
  }
  for (const operation of value.operations) {
    const problem = describeStructureOperationProblem(operation)
    if (problem !== undefined) return problem
  }
  if ('branch' in value && typeof value.branch !== 'boolean') return 'invalid_branch'
  if ('title' in value && !isBoundedText(value.title, 1, 200)) return 'invalid_title'
  if (!isEditLayout(value.style)) return 'invalid_style'
  if ('styleId' in value && (typeof value.styleId !== 'string' || !/^cs_[a-z0-9]{6,64}$/i.test(value.styleId))) return 'invalid_style_id'
  if ('temporaryStyle' in value) {
    if (!isStyleSnapshot(value.temporaryStyle) || value.temporaryStyle.baseLayout !== value.style) return 'invalid_temporary_style'
  }
  return undefined
}

/** Validate one recorded structure result from the Host. */
export function isArtifactStructureResult(value: unknown): value is ArtifactStructureResult {
  if (!isRecord(value)) return false
  if (Object.keys(value).some(key => ![
    'artifactId', 'revisionId', 'baseRevisionId', 'revision', 'operationId', 'program',
    'title', 'style', 'styleId', 'temporaryStyle',
  ].includes(key))) return false
  if (typeof value.artifactId !== 'string' || !ARTIFACT_ID_PATTERN.test(value.artifactId)) return false
  if (typeof value.revisionId !== 'string' || !ARTIFACT_ID_PATTERN.test(value.revisionId)) return false
  if (typeof value.baseRevisionId !== 'string' || !ARTIFACT_ID_PATTERN.test(value.baseRevisionId)) return false
  if (!isRequestId(value.operationId)) return false
  if (!isBoundedText(value.program, 1, MAX_ARTIFACT_PROGRAM_CHARS)) return false
  if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 2 || value.revision > 100000) return false
  if (!isEditLayout(value.style)) return false
  if ('title' in value && !isBoundedText(value.title, 1, 200)) return false
  if ('styleId' in value && (typeof value.styleId !== 'string' || !/^cs_[a-z0-9]{6,64}$/i.test(value.styleId))) return false
  if ('temporaryStyle' in value && (!isStyleSnapshot(value.temporaryStyle) || value.temporaryStyle.baseLayout !== value.style)) return false
  return true
}
