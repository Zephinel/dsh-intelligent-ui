/**
 * Client-owned lazy base registration for one rendered Artifact revision.
 *
 * Cards rendered before the Host gained its authoritative program registry
 * have no Host state. The first time the user asks the Host to operate on such
 * a card (opening the edit canvas, a structure operation, revision history or
 * restore), the browser posts the content it already rendered once, so the
 * Host can treat that revision as the base without any backfill or model turn.
 *
 * Correctness properties:
 * - single flight + permanent cache per artifact/revision identity, so opening
 *   the editor and several later operations send exactly one request;
 * - an old Host without the route answers 404, which caches "unsupported" for
 *   that card: the client degrades to non-authoritative paths and never probes
 *   the same revision again;
 * - network errors and other non-2xx answers are retryable and never surface
 *   to the user, so a transient failure cannot block editing;
 * - the cache can be invalidated when the Host later reports the base is gone
 *   (missing program / evicted record), so the next authoritative operation
 *   re-registers instead of trusting a stale success.
 */
import {
  ARTIFACT_BASE_ROUTE_PATH,
  ARTIFACT_BASE_SCHEMA_VERSION,
  isArtifactBaseSuccess,
} from '../../shared/artifact-base.ts'

/** Result of ensuring one rendered revision has a Host authoritative base. */
export type ArtifactBaseOutcome = 'present' | 'registered' | 'unsupported' | 'failed'

/** One rendered revision whose base should be registered. */
export interface ArtifactBaseInput {
  readonly artifactId: string
  readonly revisionId: string
  readonly program: string
}

/** Settled outcomes keep this cache; `failed` is retried instead. */
const settled = new Map<string, ArtifactBaseOutcome>()
/** Requests currently in flight, keyed by artifact/revision identity. */
const inflight = new Map<string, Promise<ArtifactBaseOutcome>>()
/** Bumped by invalidation so a stale in-flight answer cannot repopulate the cache. */
const generation = new Map<string, number>()

/** Cache key for one artifact/revision identity. */
function baseKey(artifactId: string, revisionId: string): string {
  return `${artifactId}\u0000${revisionId}`
}

function generationOf(key: string): number {
  return generation.get(key) ?? 0
}

/**
 * Drop the cached outcome for one rendered revision.
 *
 * Used when the Host later reports that revision's authoritative program is
 * missing (a structure/quick-adjust 404 or a history row with `hasProgram:
 * false`): the next ensure must re-post the rendered program instead of
 * serving a stale success from the cache. Any in-flight request is detached so
 * a slower stale answer can never repopulate the invalidated entry.
 * @param artifactId - artifact identity.
 * @param revisionId - rendered revision identity.
 */
export function invalidateArtifactBase(artifactId: string, revisionId: string): void {
  const key = baseKey(artifactId, revisionId)
  generation.set(key, generationOf(key) + 1)
  settled.delete(key)
  inflight.delete(key)
}

/** POST one registration; never throws and never renders an error. */
async function requestArtifactBase(input: ArtifactBaseInput): Promise<ArtifactBaseOutcome> {
  try {
    const response = await fetch(ARTIFACT_BASE_ROUTE_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: ARTIFACT_BASE_SCHEMA_VERSION,
        artifactId: input.artifactId,
        revisionId: input.revisionId,
        program: input.program,
      }),
    })
    // An old Host does not have the registration route at all: remember that
    // this card cannot use authoritative state and stop probing it.
    if (response.status === 404) return 'unsupported'
    if (!response.ok) return 'failed'
    const value: unknown = await response.json().catch(() => undefined)
    if (!isArtifactBaseSuccess(value)) return 'failed'
    return value.registered ? 'registered' : 'present'
  } catch {
    return 'failed'
  }
}

/**
 * Ensure one rendered revision has an authoritative base program on the Host.
 *
 * The first call per artifact/revision identity posts the rendered program;
 * concurrent calls share that request, and a settled success or unsupported
 * answer is cached permanently. A transient failure is not cached, so the next
 * authoritative operation retries it silently.
 * @param input - artifact identity, revision identity and rendered program.
 * @returns the outcome; `failed`/`unsupported` callers proceed without Host state.
 */
export function ensureArtifactBase(input: ArtifactBaseInput): Promise<ArtifactBaseOutcome> {
  const key = baseKey(input.artifactId, input.revisionId)
  const known = settled.get(key)
  if (known !== undefined) return Promise.resolve(known)
  const running = inflight.get(key)
  if (running !== undefined) return running
  const requestedGeneration = generationOf(key)
  const holder: { request?: Promise<ArtifactBaseOutcome> } = {}
  const request = requestArtifactBase(input).then(outcome => {
    // A cached success/unsupported answer is only valid for the generation it
    // was requested in; an invalidation while it ran discards it.
    if (outcome !== 'failed' && generationOf(key) === requestedGeneration) settled.set(key, outcome)
    return outcome
  }).finally(() => {
    // Do not delete a newer request that replaced this one after invalidation.
    if (inflight.get(key) === holder.request) inflight.delete(key)
  })
  holder.request = request
  inflight.set(key, request)
  return request
}
