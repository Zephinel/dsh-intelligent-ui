/**
 * Shared contract for Artifact base registration.
 *
 * Editing added Host-side collaborative state (revisions, authoritative
 * programs, structure ledger), but a card rendered before that state existed
 * has no authoritative base. This contract is the one lazy transition that
 * turns the content the browser already rendered into an authoritative base
 * program, so structure operations, history and restore can work on it.
 *
 * Registration is write-once: it only fills a missing program for one
 * revision, never overwrites it, and never writes a revision record. The
 * initial revision (revisionId === artifactId, revision 1) is recognized
 * without a record; any other revision needs its recorded lineage.
 *
 * This module is pure data and string work: no React, DOM, Node or parser
 * imports, so tests can load it through Node's type stripping.
 */
import {
  ARTIFACT_ID_PATTERN,
  MAX_ARTIFACT_PROGRAM_CHARS,
  isBoundedText,
} from './artifact-edit.ts'

/** Route path for the authenticated base-registration request. */
export const ARTIFACT_BASE_ROUTE_PATH = '/api/intelligent-ui/artifact-base'

/** Body version accepted by the base-registration route. */
export const ARTIFACT_BASE_SCHEMA_VERSION = 1

/** Body of one base-registration request: rendered content for one revision. */
export interface ArtifactBaseRequest {
  readonly schemaVersion: typeof ARTIFACT_BASE_SCHEMA_VERSION
  /** Artifact identity (the first render's tool call id). */
  readonly artifactId: string
  /** Revision the rendered content belongs to; equals artifactId for revision 1. */
  readonly revisionId: string
  /** Complete OpenUI Lang program the browser rendered for that revision. */
  readonly program: string
}

/** Successful registration answer; `registered` is false when already present. */
export interface ArtifactBaseSuccess {
  readonly ok: true
  /** True when this request created the authoritative program; false for a no-op. */
  readonly registered: boolean
}

/** Every key the base-registration body may carry. */
const ARTIFACT_BASE_FIELDS = ['schemaVersion', 'artifactId', 'revisionId', 'program']

/**
 * Describe why one untrusted base-registration body is unusable, or undefined.
 *
 * Strict whitelist validation: the program only adds authoritative state for
 * an already rendered revision, so no other field may widen the contract.
 * @param value - untrusted request body.
 * @returns a short machine-readable problem label.
 */
export function describeArtifactBaseProblem(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'not_an_object'
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !ARTIFACT_BASE_FIELDS.includes(key))) return 'unknown_field'
  if (record.schemaVersion !== ARTIFACT_BASE_SCHEMA_VERSION) return 'unsupported_version'
  if (typeof record.artifactId !== 'string' || !ARTIFACT_ID_PATTERN.test(record.artifactId)) return 'invalid_artifact_id'
  if (typeof record.revisionId !== 'string' || !ARTIFACT_ID_PATTERN.test(record.revisionId)) return 'invalid_revision_id'
  const program = record.program
  // The shared bounded-text helper caps the trimmed length; the program store
  // also caps the raw string, so a padded over-limit program must be a request
  // error here instead of failing later inside storage as a 500.
  if (typeof program !== 'string' || program.length > MAX_ARTIFACT_PROGRAM_CHARS) return 'invalid_program'
  if (!isBoundedText(program, 1, MAX_ARTIFACT_PROGRAM_CHARS)) return 'invalid_program'
  return undefined
}

/**
 * Check the Host answer of a base-registration request.
 * @param value - untrusted route response.
 * @returns whether it is a complete success answer.
 */
export function isArtifactBaseSuccess(value: unknown): value is ArtifactBaseSuccess {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => key !== 'ok' && key !== 'registered')) return false
  return record.ok === true && typeof record.registered === 'boolean'
}
