/**
 * Runtime-state snapshots for Interactive UI artifacts (B2-6).
 *
 * A revision of an artifact is a fresh card mount, so the renderer starts with
 * a clean `$state`/form state. This module keeps a bounded, in-memory snapshot
 * per artifact revision so a newly rendered revision (e.g. after an edit) can
 * restore the previous revision's `$state` and form field initial values.
 *
 * Only renderer-owned state is preserved (the shape reported by the vendored
 * Renderer: `{ formName: { fieldName: { value, componentType } }, $var: value }`).
 * State internal to third-party/custom components is explicitly NOT preserved.
 *
 * Snapshots live in the browser session only — a page refresh loses them.
 * Capacity: at most 24 artifacts, at most 5 revision snapshots per artifact
 * (latest + 4 recent), and at most 64 KiB of JSON per snapshot.
 */

/** Bounded capacity: artifacts tracked at once. */
export const MAX_RUNTIME_STATE_ARTIFACTS = 24
/** Bounded capacity: revision snapshots kept per artifact (latest included). */
export const MAX_RUNTIME_STATE_REVISIONS = 5
/** Bounded capacity: maximum JSON size of one snapshot. */
export const MAX_RUNTIME_STATE_JSON_CHARS = 64 * 1024

/** Identity fields a rendered program exposes for runtime-state lookup. */
export interface RuntimeStateProgramRef {
  /** Root artifact identity (first revision's result id); defaults to callId. */
  readonly artifactId?: string
  /** This revision's result id; defaults to callId. */
  readonly revisionId?: string
  /** Revision this one was edited from; absent for first renders. */
  readonly baseRevisionId?: string
  /** Tool-call identity, always present on a rendered program. */
  readonly callId?: string
}

/** Renderer-reported state object (`$state` values and form field snapshots). */
export type RuntimeState = Record<string, unknown>

/** One artifact's snapshots: latest plus the recent revisions. */
interface RuntimeStateEntry {
  latest: RuntimeState
  /** Revision id -> snapshot; Map insertion order is recency order. */
  readonly revisions: Map<string, RuntimeState>
}

const artifacts = new Map<string, RuntimeStateEntry>()

/** Deep-clone one JSON-shaped state snapshot (isolates callers from the cache). */
function cloneState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState
}

/** Whether a value is a plain JSON state object (not null/array/function). */
function isStateObject(value: unknown): value is RuntimeState {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Serialized size of a state object, or undefined when it is not JSON-safe. */
function stateSize(state: RuntimeState): number | undefined {
  try {
    const text = JSON.stringify(state)
    return typeof text === 'string' ? text.length : undefined
  } catch {
    return undefined
  }
}

/** Artifact key for one program reference (artifactId first, then callId). */
function artifactKeyFor(program: RuntimeStateProgramRef): string | undefined {
  if (typeof program.artifactId === 'string' && program.artifactId !== '') return program.artifactId
  if (typeof program.callId === 'string' && program.callId !== '') return program.callId
  if (typeof program.revisionId === 'string' && program.revisionId !== '') return program.revisionId
  return undefined
}

/** Revision key for one program reference (revisionId first, then callId). */
function revisionKeyFor(program: RuntimeStateProgramRef): string | undefined {
  if (typeof program.revisionId === 'string' && program.revisionId !== '') return program.revisionId
  if (typeof program.callId === 'string' && program.callId !== '') return program.callId
  return undefined
}

/** Move an artifact to the most-recent end of the LRU map. */
function touch(artifactId: string, entry: RuntimeStateEntry): void {
  artifacts.delete(artifactId)
  artifacts.set(artifactId, entry)
}

/** Evict the least-recently-written artifact beyond the capacity. */
function enforceArtifactLimit(): void {
  while (artifacts.size > MAX_RUNTIME_STATE_ARTIFACTS) {
    const oldest = artifacts.keys().next()
    if (oldest.done === true) return
    artifacts.delete(oldest.value)
  }
}

/** Trim one artifact to the newest revision snapshots (latest is one of them). */
function trimRevisions(entry: RuntimeStateEntry): void {
  while (entry.revisions.size > MAX_RUNTIME_STATE_REVISIONS) {
    const oldest = entry.revisions.keys().next()
    if (oldest.done === true) return
    entry.revisions.delete(oldest.value)
  }
}

/**
 * Record the latest renderer state for one rendered revision.
 * Updates the artifact's `latest` snapshot and its snapshot for this revision.
 * Invalid (non-object, circular, or oversized) state is ignored.
 * @param program - identity of the rendered program.
 * @param state - renderer state from `onStateUpdate`.
 */
export function recordRuntimeState(program: RuntimeStateProgramRef, state: unknown): void {
  if (!isStateObject(state)) return
  const artifactId = artifactKeyFor(program)
  const revisionId = revisionKeyFor(program)
  if (artifactId === undefined || revisionId === undefined) return
  const size = stateSize(state)
  if (size === undefined || size > MAX_RUNTIME_STATE_JSON_CHARS) return
  let snapshot: RuntimeState
  try {
    snapshot = cloneState(state)
  } catch {
    return
  }
  let entry = artifacts.get(artifactId)
  if (entry === undefined) entry = { latest: snapshot, revisions: new Map() }
  entry.latest = snapshot
  // Re-insert the revision so Map order tracks recency.
  entry.revisions.delete(revisionId)
  entry.revisions.set(revisionId, snapshot)
  trimRevisions(entry)
  touch(artifactId, entry)
  enforceArtifactLimit()
}

/**
 * Resolve the state a newly rendered revision should start from.
 *
 * - First render (no `baseRevisionId`): returns undefined; a fresh artifact
 *   never inherits some other card's stale latest state.
 * - Edited revision: prefers the snapshot of `baseRevisionId`, and falls back to
 *   the artifact's `latest` snapshot when the base revision was never recorded
 *   (e.g. the user edited immediately after the card mounted).
 * - Unknown artifact: undefined.
 *
 * The returned object is a clone, so callers cannot mutate the cache.
 * @param program - identity of the program about to render.
 * @returns the initial renderer state, or undefined for a first render.
 */
export function runtimeStateForProgram(program: RuntimeStateProgramRef): RuntimeState | undefined {
  if (typeof program.baseRevisionId !== 'string' || program.baseRevisionId === '') return undefined
  const artifactId = artifactKeyFor(program)
  if (artifactId === undefined) return undefined
  const entry = artifacts.get(artifactId)
  if (entry === undefined) return undefined
  const base = entry.revisions.get(program.baseRevisionId)
  const snapshot = base ?? entry.latest
  try {
    return cloneState(snapshot)
  } catch {
    return undefined
  }
}

/** Drop every runtime-state snapshot (e.g. when all cards are gone). */
export function clearRuntimeState(): void {
  artifacts.clear()
}

/** Test-only alias that makes the reset intent explicit in test files. */
export function resetRuntimeStateForTests(): void {
  clearRuntimeState()
}

/** Snapshot count for one artifact (test/diagnostic helper). */
export function runtimeStateRevisionCountForTests(artifactId: string): number {
  return artifacts.get(artifactId)?.revisions.size ?? 0
}
