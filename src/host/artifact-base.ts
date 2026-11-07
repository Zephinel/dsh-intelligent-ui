/**
 * Host-side Artifact base registration.
 *
 * A card rendered before the authoritative program registry existed has no
 * Host state, so structure operations, revision history and restore fail in
 * different ways. This module owns the one lifecycle transition that fixes
 * that lazily: the browser posts the content it already rendered for one
 * revision, and the Host records it as the authoritative base program without
 * writing a revision record.
 *
 * The transition proves provenance for both legacy shapes:
 * - initial anchor: revisionId === artifactId (the first render call id); no
 *   revision record exists because revision 1 is program-only;
 * - recorded anchor: a revision record for that artifact exists (e.g. after
 *   the program was LRU-evicted from the registry).
 *
 * Registration is write-once and idempotent: it never overwrites a program,
 * and the same program is a no-op. The route never trusts the client program
 * for structure operations; it only bootstraps the authoritative store.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  ARTIFACT_BASE_ROUTE_PATH,
  describeArtifactBaseProblem,
  type ArtifactBaseRequest,
  type ArtifactBaseSuccess,
} from '../shared/artifact-base.ts'
import { isInitialRevisionId } from '../shared/artifact-edit.ts'
import { extractArtifactBlocks } from '../shared/artifact-blocks.ts'
import type { ArtifactRevisionStore } from './artifact-revisions.ts'
import type { ArtifactProgramStore } from './artifact-structure.ts'

/**
 * Hard cap on one base-registration body.
 *
 * The shared program cap is 200k characters, which can exceed 300 KiB once
 * multi-byte programs are JSON-encoded, so the body cap is 1 MiB.
 */
export const MAX_ARTIFACT_BASE_BODY_BYTES = 1024 * 1024

/** Stores the base-registration lifecycle may read and write. */
export interface ArtifactBaseServices {
  readonly revisions: ArtifactRevisionStore
  readonly programs: ArtifactProgramStore
}

/** One accepted registration: `registered` is false for an idempotent replay. */
export interface ArtifactBaseRegistered {
  readonly ok: true
  readonly registered: boolean
}

/** One rejected registration with the HTTP status/code the route answers. */
export interface ArtifactBaseFailure {
  readonly ok: false
  readonly status: number
  readonly code: string
  readonly message: string
}

function baseFailure(status: number, code: string, message: string): ArtifactBaseFailure {
  return { ok: false, status, code, message }
}

/**
 * Register one rendered revision as its artifact's authoritative base program.
 *
 * Write-once: an already registered revision is only accepted when the stored
 * program is byte-identical (no-op); a different program is a conflict, so a
 * stale client can never rewrite the authoritative state.
 * @param services - revision and program registries.
 * @param request - validated registration body.
 * @returns the accepted outcome, or a route failure.
 */
export function registerArtifactBase(
  services: ArtifactBaseServices,
  request: ArtifactBaseRequest,
): ArtifactBaseRegistered | ArtifactBaseFailure {
  const initial = isInitialRevisionId(request.artifactId, request.revisionId)
  const record = services.revisions.get(request.revisionId)
  if (!initial && (record === undefined || record.artifactId !== request.artifactId)) {
    return baseFailure(404, 'unknown_revision', 'the revision is not a recorded revision of this artifact; render the page again before registering its base program.')
  }
  if (extractArtifactBlocks(request.program).rootType !== 'Col') {
    return baseFailure(400, 'invalid_program', 'the base program must be a complete openui-lang program with root = Col([...]).')
  }
  try {
    const existing = services.programs.lookup(request.artifactId, request.revisionId)
    if (existing !== undefined) {
      return existing === request.program
        ? { ok: true, registered: false }
        : baseFailure(409, 'program_conflict', 'a different authoritative program is already registered for this revision; reload the page and retry.')
    }
    services.programs.record({
      artifactId: request.artifactId,
      revisionId: request.revisionId,
      program: request.program,
    })
  } catch {
    return baseFailure(500, 'storage', 'the base program could not be stored.')
  }
  return { ok: true, registered: true }
}

/** Why one base program could not be resolved for a structure operation. */
export type ArtifactBaseResolveFailureKind = 'artifact_missing' | 'base_missing'

/**
 * Resolve the authoritative base program one structure operation targets.
 *
 * This is the single base resolve boundary: it preserves the structure route's
 * existing distinction between a completely unknown artifact (no records and no
 * initial program) and a known artifact whose base revision program is missing.
 * The revision recording and base_not_latest judgments stay in the route.
 * @param services - revision and program registries.
 * @param input - artifact identity plus the base revision the client addressed.
 * @returns the retained program, or which base state is missing.
 */
export function resolveArtifactBase(
  services: ArtifactBaseServices,
  input: { readonly artifactId: string; readonly baseRevisionId: string },
): { readonly ok: true; readonly program: string } | { readonly ok: false; readonly kind: ArtifactBaseResolveFailureKind } {
  const latest = services.revisions.latestFor(input.artifactId)
  const firstProgram = services.programs.lookup(input.artifactId, input.artifactId)
  const baseProgram = services.programs.lookup(input.artifactId, input.baseRevisionId)
  if (baseProgram === undefined) {
    if (latest === undefined && firstProgram === undefined) return { ok: false, kind: 'artifact_missing' }
    return { ok: false, kind: 'base_missing' }
  }
  if (latest === undefined && !isInitialRevisionId(input.artifactId, input.baseRevisionId)) {
    return { ok: false, kind: 'base_missing' }
  }
  return { ok: true, program: baseProgram }
}

interface ArtifactBaseRouteServices {
  readonly webServer?: {
    register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): void }): () => void
  }
  readonly connection?: { requestRejection(req: IncomingMessage): number | undefined }
  effect?(fn: () => unknown): unknown
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } })
}

/** One rejected registration body, carrying the HTTP status and error code. */
class BaseBodyError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Read one bounded JSON registration body; never echoes payload bytes. */
function readBaseJson(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return Promise.reject(new BaseBodyError('Content-Type must be application/json.', 400, 'invalid_input'))
  }
  const limitMessage = `The artifact base request body exceeds ${MAX_ARTIFACT_BASE_BODY_BYTES / 1024} KiB.`
  if (Number(req.headers['content-length']) > MAX_ARTIFACT_BASE_BODY_BYTES) {
    return Promise.reject(new BaseBodyError(limitMessage, 413, 'payload_too_large'))
  }
  return new Promise((resolve, reject) => {
    let size = 0
    let settled = false
    const parts: Buffer[] = []
    const finish = (failure?: BaseBodyError): void => {
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
        reject(new BaseBodyError('Invalid JSON body.', 400, 'invalid_input'))
      }
    }
    const data = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_ARTIFACT_BASE_BODY_BYTES) finish(new BaseBodyError(limitMessage, 413, 'payload_too_large'))
      else parts.push(bytes)
    }
    const end = (): void => finish()
    const failed = (): void => finish(new BaseBodyError('Could not read the artifact base request body.', 400, 'invalid_input'))
    const timer = setTimeout(() => finish(new BaseBodyError('The artifact base request body timed out.', 400, 'invalid_input')), 15_000)
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

/**
 * Register the authenticated POST base-registration route with its own disposer.
 * @param ctx - host context with the optional web server/connection services.
 * @param services - revision registry plus authoritative program store.
 */
export function registerArtifactBaseRoute(
  ctx: { inject?: (dependencies: readonly string[], callback: (scoped: ArtifactBaseRouteServices) => void) => unknown },
  services: ArtifactBaseServices,
): void {
  ctx.inject?.(['webServer', 'connection'], scoped => {
    const { webServer, connection } = scoped
    if (typeof webServer?.register !== 'function' || typeof connection?.requestRejection !== 'function') return
    scoped.effect?.(() => {
      const dispose = webServer.register({
        kind: 'exact', path: ARTIFACT_BASE_ROUTE_PATH,
        handler: (req, res) => {
          const rejection = connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection, { 'cache-control': 'no-store' })
            res.end()
            return
          }
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Use POST to register an artifact base program.' } }))
            return
          }
          void readBaseJson(req).then(raw => {
            const problem = describeArtifactBaseProblem(raw)
            if (problem !== undefined) {
              sendError(res, 400, 'invalid_input', `Invalid artifact base request: ${problem}.`)
              return
            }
            let outcome: ArtifactBaseRegistered | ArtifactBaseFailure
            try {
              outcome = registerArtifactBase(services, raw as ArtifactBaseRequest)
            } catch {
              sendError(res, 500, 'storage', 'the base program could not be stored.')
              return
            }
            if (outcome.ok === false) {
              sendError(res, outcome.status, outcome.code, outcome.message)
              return
            }
            const body: ArtifactBaseSuccess = { ok: true, registered: outcome.registered }
            sendJson(res, 200, body)
          }, (cause: unknown) => {
            if (cause instanceof BaseBodyError) {
              sendError(res, cause.status, cause.code, cause.message)
              return
            }
            sendError(res, 400, 'invalid_input', 'Invalid artifact base request.')
          })
        },
      })
      return () => { dispose() }
    })
  })
}
