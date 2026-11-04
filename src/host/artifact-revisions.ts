/** Durable, bounded revision lineage for edited render_ui artifacts. */
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  ARTIFACT_ID_PATTERN, ARTIFACT_REVISION_ROUTE_PATH, MAX_ARTIFACT_EDITS, MAX_ARTIFACT_TITLE_CHARS,
  isEditLayout, type ArtifactRevisionStatus,
} from '../shared/artifact-edit.ts'
import type { RenderLayout } from '../shared/intelligent-ui.ts'

/** Retained revision records; oldest creation times are dropped first. */
export const MAX_ARTIFACT_REVISIONS = 400

/** One recorded revision of one artifact. */
export interface ArtifactRevisionRecord {
  readonly revisionId: string
  readonly artifactId: string
  readonly baseRevisionId?: string
  readonly revision: number
  readonly sessionId: string
  readonly style: RenderLayout
  readonly styleId?: string
  readonly title?: string
  readonly editedBlockIds?: readonly string[]
  readonly createdAt: number
}

export interface ArtifactRevisionStore {
  get(revisionId: string): ArtifactRevisionRecord | undefined
  latestFor(artifactId: string): ArtifactRevisionRecord | undefined
  record(record: ArtifactRevisionRecord): void
  status(input: { readonly artifactId: string; readonly revisionId: string }): ArtifactRevisionStatus
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
  return Object.keys(record).every(key => ['revisionId', 'artifactId', 'baseRevisionId', 'revision', 'sessionId', 'style', 'styleId', 'title', 'editedBlockIds', 'createdAt'].includes(key))
    && isIdentity(record.revisionId) && isIdentity(record.artifactId)
    && (!('baseRevisionId' in record) || (isIdentity(record.baseRevisionId) && record.baseRevisionId !== record.revisionId))
    && typeof record.revision === 'number' && Number.isSafeInteger(record.revision)
    && record.revision >= 1 && record.revision <= 100_000
    && isSessionIdentity(record.sessionId)
    && isEditLayout(record.style)
    && (!('styleId' in record) || (typeof record.styleId === 'string' && STYLE_ID_PATTERN.test(record.styleId)))
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

/** Open the durable revision registry stored beside the other extension files. */
export function createArtifactRevisionStore(ctx: { logger?: { warn(message: string): void } } = {}): ArtifactRevisionStore {
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
  return {
    get(revisionId) {
      const found = revisions.find(record => record.revisionId === revisionId)
      return found === undefined ? undefined : structuredClone(found)
    },
    latestFor(artifactId) {
      const found = latestRecord(artifactId)
      return found === undefined ? undefined : structuredClone(found)
    },
    record(record) {
      if (!validRecord(record)) throw new Error('Invalid artifact revision')
      const existing = revisions.find(candidate => candidate.revisionId === record.revisionId)
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('Artifact revisions are immutable')
        return
      }
      const next = [...revisions, structuredClone(record)]
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-MAX_ARTIFACT_REVISIONS)
      validate(next)
      mkdirSync(dirname(file), { recursive: true })
      if (corrupt) { renameSync(file, `${file}.corrupt-${Date.now()}`); corrupt = false }
      writeFileSync(`${file}.tmp`, `${JSON.stringify({ version: 1, revisions: next }, null, 2)}\n`, 'utf8')
      renameSync(`${file}.tmp`, file)
      revisions = next
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

/** Expose the latest-revision probe only with the existing connection authentication. */
export function registerArtifactRevisionRoutes(ctx: {
  inject?: (dependencies: readonly string[], callback: (scoped: RevisionRouteServices) => void) => unknown
}, store: ArtifactRevisionStore): void {
  ctx.inject?.(['webServer', 'connection'], scoped => {
    const { webServer, connection } = scoped
    if (typeof webServer?.register !== 'function' || typeof connection?.requestRejection !== 'function') return
    scoped.effect?.(() => webServer.register({
      kind: 'exact', path: ARTIFACT_REVISION_ROUTE_PATH,
      handler: (req, res) => {
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'cache-control': 'no-store' })
          res.end()
          return
        }
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' })
          res.end()
          return
        }
        const params = new URL(req.url ?? ARTIFACT_REVISION_ROUTE_PATH, 'http://localhost').searchParams
        const artifactId = params.get('artifactId')
        const revisionId = params.get('revisionId')
        if (artifactId === null || !isIdentity(artifactId) || revisionId === null || !isIdentity(revisionId)) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: { code: 'invalid_input', message: 'artifactId and revisionId must be artifact identities.' } }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(store.status({ artifactId, revisionId })))
      },
    }))
  })
}
