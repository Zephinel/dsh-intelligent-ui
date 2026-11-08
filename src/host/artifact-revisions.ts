/** Durable, bounded revision lineage for edited render_ui artifacts. */
import { randomBytes } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  ARTIFACT_HISTORY_PROGRAM_ROUTE_PATH, ARTIFACT_HISTORY_ROUTE_PATH,
  ARTIFACT_ID_PATTERN, ARTIFACT_RESTORE_ROUTE_PATH, ARTIFACT_REVISION_ROUTE_PATH,
  MAX_ARTIFACT_EDITS, MAX_ARTIFACT_TITLE_CHARS,
  describeArtifactRestoreProblem, isEditLayout,
  type ArtifactHistoryProgramResponse, type ArtifactHistoryResponse,
  type ArtifactHistoryRevision, type ArtifactHistorySource,
  type ArtifactRestoreRequest, type ArtifactRevisionStatus,
} from '../shared/artifact-edit.ts'
import { extractArtifactBlocks } from '../shared/artifact-blocks.ts'
import { isStyleSnapshot, type StyleSnapshot } from '../shared/style-templates.ts'
import type { RenderLayout } from '../shared/intelligent-ui.ts'
import type { ResultStore } from './result-store.ts'

/** Retained revision records; oldest creation times are dropped first. */
export const MAX_ARTIFACT_REVISIONS = 400

/** Hard cap on one restore request body. */
export const MAX_RESTORE_BODY_BYTES = 300 * 1024

/** Revision id prefix for local restores; the suffix is 16 random hex characters. */
const RESTORE_REVISION_PREFIX = 'restore_'
/** Revision id prefix for deterministic structure operations (see `artifact-structure.ts`). */
const STRUCTURE_REVISION_PREFIX = 'struct_'

/** Session identity recorded for revisions created without a model turn. */
const RESTORE_SESSION_ID = 'local-restore'

/** Mirrors the shared edit-envelope bound for one temporary style snapshot. */
const MAX_TEMPORARY_STYLE_JSON_CHARS = 20_000

/** One recorded revision of one artifact. */
export interface ArtifactRevisionRecord {
  readonly revisionId: string
  readonly artifactId: string
  readonly baseRevisionId?: string
  readonly revision: number
  readonly sessionId: string
  readonly style: RenderLayout
  readonly styleId?: string
  /** Result-owned temporary style snapshot the revision keeps, copied from the edit request. */
  readonly temporaryStyle?: StyleSnapshot
  readonly title?: string
  readonly editedBlockIds?: readonly string[]
  readonly createdAt: number
}

export interface ArtifactRevisionStore {
  get(revisionId: string): ArtifactRevisionRecord | undefined
  latestFor(artifactId: string): ArtifactRevisionRecord | undefined
  /** Every recorded revision of one artifact, oldest revision first (detached clones). */
  listForArtifact(artifactId: string): ArtifactRevisionRecord[]
  record(record: ArtifactRevisionRecord): void
  status(input: { readonly artifactId: string; readonly revisionId: string }): ArtifactRevisionStatus
  /** Delete one recorded revision (never the synthesized initial render). */
  remove(input: { readonly artifactId: string; readonly revisionId: string }): 'deleted' | 'missing' | 'referenced'
}

const STYLE_ID_PATTERN = /^cs_[a-z0-9]{6,64}$/i
const BLOCK_ID_PATTERN = /^b[1-9][0-9]{0,3}$/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

/** Artifact and revision ids share the tool-call identity shape. */
function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && ARTIFACT_ID_PATTERN.test(value)
}

/** Session ids are opaque bounded text supplied by the event stream. */
function isSessionIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value === value.trim() && !CONTROL_CHARACTERS.test(value)
}

function isBoundedLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= MAX_ARTIFACT_TITLE_CHARS
    && !CONTROL_CHARACTERS.test(value)
}

function isBlockId(value: unknown): value is string {
  return typeof value === 'string' && BLOCK_ID_PATTERN.test(value)
}

function validRecord(value: unknown): value is ArtifactRevisionRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).every(key => ['revisionId', 'artifactId', 'baseRevisionId', 'revision', 'sessionId', 'style', 'styleId', 'temporaryStyle', 'title', 'editedBlockIds', 'createdAt'].includes(key))
    && isIdentity(record.revisionId) && isIdentity(record.artifactId)
    && (!('baseRevisionId' in record) || (isIdentity(record.baseRevisionId) && record.baseRevisionId !== record.revisionId))
    && typeof record.revision === 'number' && Number.isSafeInteger(record.revision)
    && record.revision >= 1 && record.revision <= 100_000
    && isSessionIdentity(record.sessionId)
    && isEditLayout(record.style)
    && (!('styleId' in record) || (typeof record.styleId === 'string' && STYLE_ID_PATTERN.test(record.styleId)))
    && (!('temporaryStyle' in record) || (isStyleSnapshot(record.temporaryStyle)
      && record.temporaryStyle.baseLayout === record.style
      && JSON.stringify(record.temporaryStyle).length <= MAX_TEMPORARY_STYLE_JSON_CHARS))
    && (!('title' in record) || isBoundedLabel(record.title))
    && (!('editedBlockIds' in record) || (Array.isArray(record.editedBlockIds)
      && record.editedBlockIds.length <= MAX_ARTIFACT_EDITS
      && record.editedBlockIds.every(isBlockId)))
    && typeof record.createdAt === 'number' && Number.isSafeInteger(record.createdAt) && record.createdAt >= 0
}

function validate(revisions: unknown): asserts revisions is ArtifactRevisionRecord[] {
  if (!Array.isArray(revisions) || revisions.length > MAX_ARTIFACT_REVISIONS || !revisions.every(validRecord)
    || new Set(revisions.map(record => record.revisionId)).size !== revisions.length) {
    throw new Error('Invalid artifact revision collection')
  }
}

/**
 * Open the durable revision registry stored beside the other extension files.
 *
 * When a result store sink is supplied, a revision carrying a result-owned
 * `temporaryStyle` first records that snapshot in the result registry and only
 * then writes the revision: a revision must never exist without the snapshot
 * its later restore/adjustment paths read. The snapshot is not backfilled for
 * revisions recorded before this boundary existed (non-goal), and a caller can
 * retry the whole call after a failed write.
 * @param ctx - optional logger for corrupt-registry warnings.
 * @param results - optional result snapshot sink; omit for a metadata-only store.
 */
export function createArtifactRevisionStore(
  ctx: { logger?: { warn(message: string): void } } = {},
  results?: Pick<ResultStore, 'record'>,
): ArtifactRevisionStore {
  const file = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-intelligent-ui-artifacts.json')
  let revisions: ArtifactRevisionRecord[] = []
  let corrupt = false
  try {
    const loaded = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; revisions?: unknown }
    if (loaded === null || typeof loaded !== 'object' || Object.keys(loaded).length !== 2 || loaded.version !== 1) throw new Error('Invalid artifact revision file')
    validate(loaded.revisions)
    revisions = loaded.revisions
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      corrupt = true
      ctx.logger?.warn('intelligent-ui: could not load artifact revisions; starting empty')
    }
  }
  const latestRecord = (artifactId: string): ArtifactRevisionRecord | undefined => {
    let latest: ArtifactRevisionRecord | undefined
    for (const record of revisions) {
      if (record.artifactId !== artifactId) continue
      if (latest === undefined || record.revision > latest.revision) latest = record
    }
    return latest
  }
  const persist = (next: ArtifactRevisionRecord[]): void => {
    validate(next)
    mkdirSync(dirname(file), { recursive: true })
    if (corrupt) { renameSync(file, `${file}.corrupt-${Date.now()}`); corrupt = false }
    writeFileSync(`${file}.tmp`, `${JSON.stringify({ version: 1, revisions: next }, null, 2)}\n`, 'utf8')
    renameSync(`${file}.tmp`, file)
    revisions = next
  }
  return {
    get(revisionId) {
      const found = revisions.find(record => record.revisionId === revisionId)
      return found === undefined ? undefined : structuredClone(found)
    },
    latestFor(artifactId) {
      const found = latestRecord(artifactId)
      return found === undefined ? undefined : structuredClone(found)
    },
    listForArtifact(artifactId) {
      return revisions
        .filter(record => record.artifactId === artifactId)
        .sort((left, right) => left.revision - right.revision)
        .map(record => structuredClone(record))
    },
    record(record) {
      if (!validRecord(record)) throw new Error('Invalid artifact revision')
      const existing = revisions.find(candidate => candidate.revisionId === record.revisionId)
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('Artifact revisions are immutable')
        return
      }
      // Snapshot first, revision second: the result registry is what later
      // restore/adjustment paths read, so it must never lag the revision it
      // belongs to. A failure here aborts before the revisions file is touched.
      if (record.temporaryStyle !== undefined && results !== undefined) {
        results.record({
          resultId: record.revisionId,
          sessionId: record.sessionId,
          snapshot: record.temporaryStyle,
          ...(record.baseRevisionId === undefined || record.baseRevisionId === record.revisionId
            ? {}
            : { parentResultId: record.baseRevisionId }),
          createdAt: record.createdAt,
        })
      }
      const next = [...revisions, structuredClone(record)]
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-MAX_ARTIFACT_REVISIONS)
      persist(next)
    },
    remove({ artifactId, revisionId }) {
      const index = revisions.findIndex(record => record.revisionId === revisionId && record.artifactId === artifactId)
      if (index < 0) return 'missing'
      if (revisions.some(record => record.baseRevisionId === revisionId)) return 'referenced'
      persist(revisions.filter((_, candidate) => candidate !== index))
      return 'deleted'
    },
    status({ artifactId, revisionId }) {
      const latest = latestRecord(artifactId)
      // The first render of an artifact is never recorded, so an unknown
      // artifact is by definition the caller's own revision 1.
      if (latest === undefined) {
        return { artifactId, revisionId, revision: 1, latestRevisionId: revisionId, latestRevision: 1, conflict: false }
      }
      const requested = revisions.find(record => record.revisionId === revisionId)
      return {
        artifactId,
        revisionId,
        revision: requested?.revision ?? 1,
        latestRevisionId: latest.revisionId,
        latestRevision: latest.revision,
        conflict: latest.revisionId !== revisionId,
      }
    },
  }
}

interface RevisionRouteServices {
  readonly webServer?: {
    register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): void }): () => void
  }
  readonly connection?: { requestRejection(req: IncomingMessage): number | undefined }
  effect?(fn: () => unknown): unknown
}

/** One rejected restore body, carrying the HTTP status and error code to answer. */
class RestoreBodyError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } })
}

/** Read one bounded JSON restore body; never echoes payload bytes. */
function readRestoreJson(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return Promise.reject(new RestoreBodyError('Content-Type must be application/json.', 400, 'invalid_input'))
  }
  const limitMessage = `The restore body exceeds ${MAX_RESTORE_BODY_BYTES / 1024} KiB.`
  if (Number(req.headers['content-length']) > MAX_RESTORE_BODY_BYTES) {
    return Promise.reject(new RestoreBodyError(limitMessage, 413, 'payload_too_large'))
  }
  return new Promise((resolve, reject) => {
    let size = 0
    let settled = false
    const parts: Buffer[] = []
    const finish = (failure?: RestoreBodyError): void => {
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
        reject(new RestoreBodyError('Invalid JSON body.', 400, 'invalid_input'))
      }
    }
    const data = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_RESTORE_BODY_BYTES) finish(new RestoreBodyError(limitMessage, 413, 'payload_too_large'))
      else parts.push(bytes)
    }
    const end = (): void => finish()
    const failed = (): void => finish(new RestoreBodyError('Could not read the restore body.', 400, 'invalid_input'))
    const timer = setTimeout(() => finish(new RestoreBodyError('The restore body timed out.', 400, 'invalid_input')), 15_000)
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

/** Which pipeline created one recorded revision. */
function historySource(record: ArtifactRevisionRecord): ArtifactHistorySource {
  if (record.revisionId.startsWith(RESTORE_REVISION_PREFIX)) return 'restore'
  // Structure operations mint `struct_<16 hex>` ids; their revisions often carry
  // `editedBlockIds` but are not block-content edits.
  if (record.revisionId.startsWith(STRUCTURE_REVISION_PREFIX)) return 'structure'
  // A style-only revision (B1 style editing) keeps the result-owned snapshot and
  // changes no block: no new durable source value, inferred as an edit.
  if (record.temporaryStyle !== undefined && (record.editedBlockIds?.length ?? 0) === 0) return 'edit'
  if ((record.editedBlockIds?.length ?? 0) > 0) return 'edit'
  return 'structure'
}

/** Program metadata for one artifact, without touching per-revision LRU order. */
function programsFor(programs: ArtifactRevisionProgramStore | undefined, artifactId: string): { revisionId: string; createdAt: number }[] {
  if (programs === undefined) return []
  try {
    return programs.list().filter(entry => entry.artifactId === artifactId).map(entry => ({ revisionId: entry.revisionId, createdAt: entry.createdAt }))
  } catch {
    return []
  }
}

/**
 * Build one artifact's history: recorded revisions plus the inferred initial
 * revision that only exists in the authoritative program registry.
 *
 * The initial revision is inferred only when no revision record claims
 * revision 1: the earliest program-only entry (not present in the revision
 * store) represents it, styled from the artifact's earliest revision record.
 * Newest first; `current`/`restorable`/`hasProgram` are derived from the merged
 * set without loading any program body.
 * @param store - revision registry.
 * @param programs - optional authoritative program store metadata.
 * @param artifactId - artifact identity.
 * @returns the metadata-only history response.
 */
export function buildArtifactHistory(
  store: ArtifactRevisionStore,
  programs: ArtifactRevisionProgramStore | undefined,
  artifactId: string,
): ArtifactHistoryResponse {
  const records = store.listForArtifact(artifactId)
  const programEntries = programsFor(programs, artifactId)
  const programIds = new Set(programEntries.map(entry => entry.revisionId))
  const recordIds = new Set(records.map(record => record.revisionId))
  const latestRecord = records.length === 0 ? undefined : records[records.length - 1]
  let initial: ArtifactHistoryRevision | undefined
  if (!records.some(record => record.revision === 1)) {
    const candidate = programEntries
      .filter(entry => !recordIds.has(entry.revisionId))
      .sort((left, right) => left.createdAt - right.createdAt)[0]
    if (candidate !== undefined) {
      const fallback = records[0]
      initial = {
        revisionId: candidate.revisionId,
        revision: 1,
        style: fallback?.style ?? 'card',
        ...fallback?.styleId === undefined ? {} : { styleId: fallback.styleId },
        ...fallback?.temporaryStyle === undefined ? {} : { temporaryStyle: fallback.temporaryStyle },
        ...fallback?.title === undefined ? {} : { title: fallback.title },
        createdAt: candidate.createdAt,
        current: false,
        source: 'initial',
        hasProgram: true,
        restorable: false,
      }
    }
  }
  const latestRevision = latestRecord?.revision ?? 1
  const revisions: ArtifactHistoryRevision[] = records.map(record => {
    const current = record.revision === latestRevision
    const hasProgram = programIds.has(record.revisionId)
    return {
      revisionId: record.revisionId,
      revision: record.revision,
      ...record.baseRevisionId === undefined ? {} : { baseRevisionId: record.baseRevisionId },
      ...record.title === undefined ? {} : { title: record.title },
      style: record.style,
      ...record.styleId === undefined ? {} : { styleId: record.styleId },
      ...record.temporaryStyle === undefined ? {} : { temporaryStyle: record.temporaryStyle },
      ...record.editedBlockIds === undefined ? {} : { editedBlockIds: [...record.editedBlockIds] },
      createdAt: record.createdAt,
      current,
      source: historySource(record),
      hasProgram,
      restorable: hasProgram && !current,
    }
  })
  if (initial !== undefined) {
    const current = initial.revision === latestRevision
    revisions.push({ ...initial, current, restorable: initial.hasProgram && !current })
  }
  revisions.sort((left, right) => right.revision - left.revision)
  return { ok: true, artifactId, latestRevision, revisions }
}

/**
 * Expose the latest-revision probe and the zero-model restore route behind the
 * existing connection authentication; both routes share one disposer.
 */
/**
 * Readable authoritative program store used by history/program routes and as the
 * restore program sink. Mocks may provide only `lookup`/`list`; `record` is
 * optional so existing record-only sinks keep compiling.
 */
export interface ArtifactRevisionProgramStore {
  lookup(artifactId: string, revisionId: string): string | undefined
  list(): readonly {
    readonly artifactId: string
    readonly revisionId: string
    readonly createdAt: number
  }[]
  record?(input: { readonly artifactId: string; readonly revisionId: string; readonly program: string }): void
  /** Optional cleanup for a deleted revision's retained program. */
  remove?(artifactId: string, revisionId: string): void
}

export function registerArtifactRevisionRoutes(ctx: {
  inject?: (dependencies: readonly string[], callback: (scoped: RevisionRouteServices) => void) => unknown
}, store: ArtifactRevisionStore, programs?: ArtifactRevisionProgramStore): void {
  ctx.inject?.(['webServer', 'connection'], scoped => {
    const { webServer, connection } = scoped
    if (typeof webServer?.register !== 'function' || typeof connection?.requestRejection !== 'function') return
    scoped.effect?.(() => {
      const disposeStatus = webServer.register({
        kind: 'exact', path: ARTIFACT_REVISION_ROUTE_PATH,
        handler: (req, res) => {
          const rejection = connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection, { 'cache-control': 'no-store' })
            res.end()
            return
          }
          if (req.method !== 'GET' && req.method !== 'DELETE') {
            res.writeHead(405, { allow: 'GET, DELETE', 'cache-control': 'no-store' })
            res.end()
            return
          }
          const params = new URL(req.url ?? ARTIFACT_REVISION_ROUTE_PATH, 'http://localhost').searchParams
          const artifactId = params.get('artifactId')
          const revisionId = params.get('revisionId')
          if (artifactId === null || !isIdentity(artifactId) || revisionId === null || !isIdentity(revisionId)) {
            sendError(res, 400, 'invalid_input', 'artifactId and revisionId must be artifact identities.')
            return
          }
          if (req.method === 'DELETE') {
            const outcome = store.remove({ artifactId, revisionId })
            if (outcome === 'missing') {
              sendError(res, 404, 'revision_missing', 'That revision is not recorded for this artifact (the initial render is not deletable).')
              return
            }
            if (outcome === 'referenced') {
              sendError(res, 409, 'revision_referenced', 'That revision is still the base of another recorded revision; delete the newer revision first.')
              return
            }
            try { programs?.remove?.(artifactId, revisionId) } catch { /* orphan program is harmless; LRU prunes it */ }
            sendJson(res, 200, { ok: true })
            return
          }
          sendJson(res, 200, store.status({ artifactId, revisionId }))
        },
      })
      const disposeRestore = webServer.register({
        kind: 'exact', path: ARTIFACT_RESTORE_ROUTE_PATH,
        handler: (req, res) => {
          const rejection = connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection, { 'cache-control': 'no-store' })
            res.end()
            return
          }
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Use POST to restore an artifact revision.' } }))
            return
          }
          void readRestoreJson(req).then(body => {
            const problem = describeArtifactRestoreProblem(body)
            if (problem !== undefined) {
              sendError(res, 400, 'invalid_input', `Invalid artifact restore body: ${problem}.`)
              return
            }
            const request = body as ArtifactRestoreRequest
            let source = store.get(request.sourceRevisionId)
            if (source === undefined) {
              // The first render is program-only (no revision record); allow
              // restoring it when its authoritative program is still retained.
              const initialProgram = programs?.lookup(request.artifactId, request.sourceRevisionId)
              const latestFallback = store.latestFor(request.artifactId)
              if (initialProgram === undefined) {
                sendError(res, 404, 'source_missing', 'The source revision is no longer available in the artifact revision registry.')
                return
              }
              if (latestFallback === undefined) {
                sendError(res, 409, 'already_latest', 'The source revision is the latest revision of this artifact.')
                return
              }
              source = {
                revisionId: request.sourceRevisionId,
                artifactId: request.artifactId,
                revision: 1,
                sessionId: RESTORE_SESSION_ID,
                style: latestFallback.style,
                ...latestFallback.styleId === undefined ? {} : { styleId: latestFallback.styleId },
                ...latestFallback.temporaryStyle === undefined ? {} : { temporaryStyle: latestFallback.temporaryStyle },
                ...latestFallback.title === undefined ? {} : { title: latestFallback.title },
                createdAt: 0,
              }
            }
            if (source.artifactId !== request.artifactId) {
              sendError(res, 400, 'artifact_mismatch', 'The source revision belongs to a different artifact.')
              return
            }
            const latest = store.latestFor(request.artifactId)
            if (latest !== undefined && latest.revisionId === source.revisionId) {
              sendError(res, 409, 'already_latest', 'The source revision is already the latest revision of this artifact.')
              return
            }
            const extraction = extractArtifactBlocks(request.program)
            if (extraction.rootType !== 'Col') {
              sendError(res, 400, 'invalid_program', 'The restored program must be a complete openui-lang program with root = Col([...]).')
              return
            }
            const revision = (latest === undefined ? source.revision : latest.revision) + 1
            if (revision > 100_000) {
              sendError(res, 400, 'revision_limit', 'The artifact has reached its maximum revision number.')
              return
            }
            let revisionId: string | undefined
            for (let attempt = 0; attempt < 8; attempt += 1) {
              const candidate = `${RESTORE_REVISION_PREFIX}${randomBytes(8).toString('hex')}`
              if (store.get(candidate) === undefined) {
                revisionId = candidate
                break
              }
            }
            if (revisionId === undefined) {
              sendError(res, 409, 'conflict', 'Could not allocate a restore revision id; retry the restore.')
              return
            }
            try {
              store.record({
                revisionId,
                artifactId: request.artifactId,
                baseRevisionId: request.sourceRevisionId,
                revision,
                sessionId: RESTORE_SESSION_ID,
                style: source.style,
                ...source.styleId === undefined ? {} : { styleId: source.styleId },
                ...source.temporaryStyle === undefined ? {} : { temporaryStyle: source.temporaryStyle },
                ...source.title === undefined ? {} : { title: source.title },
                createdAt: Date.now(),
              })
              programs?.record?.({ artifactId: request.artifactId, revisionId, program: request.program })
            } catch {
              sendError(res, 409, 'conflict', 'The revision registry rejected the restored revision; retry the restore.')
              return
            }
            sendJson(res, 201, {
              ok: true,
              revision: {
                artifactId: request.artifactId,
                revisionId,
                baseRevisionId: request.sourceRevisionId,
                revision,
                program: request.program,
                ...source.title === undefined ? {} : { title: source.title },
                style: source.style,
                ...source.styleId === undefined ? {} : { styleId: source.styleId },
                ...source.temporaryStyle === undefined ? {} : { temporaryStyle: source.temporaryStyle },
              },
            })
          }, (cause: unknown) => {
            if (cause instanceof RestoreBodyError) {
              sendError(res, cause.status, cause.code, cause.message)
              return
            }
            sendError(res, 400, 'invalid_input', 'Invalid artifact restore request.')
          })
        },
      })
      const disposeHistory = webServer.register({
        kind: 'exact', path: ARTIFACT_HISTORY_ROUTE_PATH,
        handler: (req, res) => {
          const rejection = connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection, { 'cache-control': 'no-store' })
            res.end()
            return
          }
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Use GET to read an artifact history.' } }))
            return
          }
          const params = new URL(req.url ?? ARTIFACT_HISTORY_ROUTE_PATH, 'http://localhost').searchParams
          const artifactId = params.get('artifactId')
          if (artifactId === null || !isIdentity(artifactId)) {
            sendError(res, 400, 'invalid_input', 'artifactId must be an artifact identity.')
            return
          }
          sendJson(res, 200, buildArtifactHistory(store, programs, artifactId))
        },
      })
      const disposeHistoryProgram = webServer.register({
        kind: 'exact', path: ARTIFACT_HISTORY_PROGRAM_ROUTE_PATH,
        handler: (req, res) => {
          const rejection = connection.requestRejection(req)
          if (rejection !== undefined) {
            res.writeHead(rejection, { 'cache-control': 'no-store' })
            res.end()
            return
          }
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Use GET to read an artifact revision program.' } }))
            return
          }
          const params = new URL(req.url ?? ARTIFACT_HISTORY_PROGRAM_ROUTE_PATH, 'http://localhost').searchParams
          const artifactId = params.get('artifactId')
          const revisionId = params.get('revisionId')
          if (artifactId === null || !isIdentity(artifactId) || revisionId === null || !isIdentity(revisionId)) {
            sendError(res, 400, 'invalid_input', 'artifactId and revisionId must be artifact identities.')
            return
          }
          const program = programs?.lookup(artifactId, revisionId)
          if (program === undefined) {
            sendError(res, 404, 'program_missing', 'The authoritative program for that revision is no longer retained.')
            return
          }
          const record = store.get(revisionId)
          if (record !== undefined && record.artifactId !== artifactId) {
            sendError(res, 404, 'program_missing', 'The authoritative program for that revision is no longer retained.')
            return
          }
          const response: ArtifactHistoryProgramResponse = {
            ok: true, artifactId, revisionId, revision: record?.revision ?? 1, program,
          }
          sendJson(res, 200, response)
        },
      })
      return () => {
        disposeStatus()
        disposeRestore()
        disposeHistory()
        disposeHistoryProgram()
      }
    })
  })
}
