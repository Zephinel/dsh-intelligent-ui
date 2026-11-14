/**
 * Host-side npm update check for this extension.
 *
 * The browser should not depend on registry CORS or on the client machine's
 * network, so the Host reads the package's `latest` dist-tag once and serves a
 * same-origin, authenticated answer. The read is cached (six hours on success,
 * five minutes on failure) and the route never fails the request on a network
 * problem: it answers `latest: null` and the client stays silent.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { isNewerStableVersion, parseStableVersion, UPDATE_ROUTE_PATH, type UpdateCheckView } from '../shared/update-check.ts'
import { parseHighlights } from '../shared/release-notes.ts'
import { PACKAGE_NAME } from '../shared/intelligent-ui.ts'

/** Registry address for the package's `latest` dist-tag (scope slash stays encoded). */
const REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME.replace('/', '%2F')}/latest`

/** Successful answers are reused for six hours. */
const SUCCESS_TTL_MS = 6 * 60 * 60_000
/** Failed answers are retried sooner so a transient network error clears quickly. */
const FAILURE_TTL_MS = 5 * 60_000
/** One registry read must not keep the route waiting. */
const FETCH_TIMEOUT_MS = 5_000

/** Services the route needs; a deployment without both services exposes no route. */
export interface UpdateRouteServices {
  readonly webServer?: {
    register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): void }): () => void
  }
  readonly connection?: { requestRejection(req: IncomingMessage): number | undefined }
  effect?(fn: () => unknown): unknown
}

/** Injectable dependencies for the cached check (tests replace fetch/time). */
export interface UpdateCheckerOptions {
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
  readonly timeoutMs?: number
  readonly successTtlMs?: number
  readonly failureTtlMs?: number
  /** Manifest override for tests; production reads the shipped `package.json`. */
  readonly manifestUrl?: URL
}

/**
 * Read the running package version from the package's own `package.json`.
 * @returns the stable version, or undefined when the manifest is unreadable or
 *   names a prerelease/build version (which this card must not compare).
 */
export function installedVersion(manifestUrl?: URL): string | undefined {
  const candidates = manifestUrl === undefined
    ? [new URL('../package.json', import.meta.url), new URL('../../package.json', import.meta.url)]
    : [manifestUrl]
  for (const url of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(url, 'utf8')) as { version?: unknown }
      if (typeof parsed.version === 'string' && parseStableVersion(parsed.version) !== undefined) return parsed.version
      return undefined
    } catch { /* try the next candidate: lib/ install layout then source layout */ }
  }
  return undefined
}

/** Read the repository slug used for the tag-pinned release-notes URL. */
function releaseNotesRepository(): string | undefined {
  try {
    const url = new URL('../package.json', import.meta.url)
    const parsed = JSON.parse(readFileSync(url, 'utf8')) as { repository?: unknown }
    const repository = typeof parsed.repository === 'string'
      ? parsed.repository
      : (parsed.repository as { url?: unknown } | undefined)?.url
    if (typeof repository !== 'string') return undefined
    const match = /github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/u.exec(repository.trim())
    return match?.[1]
  } catch {
    return undefined
  }
}

/** Tag-pinned raw URL of one release's notes document. */
function releaseNotesUrl(repository: string, version: string): string {
  return `https://raw.githubusercontent.com/${repository}/v${version}/release-notes/${version}.md`
}

/**
 * Build one cached update check.
 * @param options - fetch/time overrides for tests.
 * @returns a function resolving one {@link UpdateCheckView}; it never rejects.
 */
export function createUpdateChecker(options: UpdateCheckerOptions = {}): () => Promise<UpdateCheckView> {
  const installed = installedVersion(options.manifestUrl)
  const current = installed ?? '0.0.0'
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const successTtlMs = options.successTtlMs ?? SUCCESS_TTL_MS
  const failureTtlMs = options.failureTtlMs ?? FAILURE_TTL_MS
  let cached: { at: number; ttl: number; view: UpdateCheckView } | undefined
  let inflight: Promise<UpdateCheckView> | undefined

  const read = async (): Promise<{ view: UpdateCheckView; notesRead: boolean }> => {
    const response = await fetchImpl(REGISTRY_LATEST_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`registry answered ${response.status}`)
    const payload = await response.json() as { version?: unknown }
    const latest = parseStableVersion(payload.version) === undefined ? null : String(payload.version)
    const updateAvailable = latest !== null && installed !== undefined && isNewerStableVersion(latest, installed)
    if (!updateAvailable || latest === null) {
      return { view: { current, latest, updateAvailable: false, highlights: [] }, notesRead: true }
    }
    const repository = releaseNotesRepository()
    if (repository === undefined) {
      return { view: { current, latest, updateAvailable: true, highlights: [] }, notesRead: false }
    }
    try {
      const notesResponse = await fetchImpl(releaseNotesUrl(repository, latest), {
        headers: { accept: 'text/plain' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!notesResponse.ok) throw new Error(`notes answered ${notesResponse.status}`)
      const highlights = parseHighlights(await notesResponse.text()).slice(0, 6)
      return { view: { current, latest, updateAvailable: true, highlights }, notesRead: highlights.length > 0 }
    } catch {
      return { view: { current, latest, updateAvailable: true, highlights: [] }, notesRead: false }
    }
  }

  return async () => {
    const at = now()
    if (cached !== undefined && at - cached.at < cached.ttl) return cached.view
    if (inflight !== undefined) return inflight
    inflight = read()
      .then(({ view, notesRead }) => {
        // A version update without readable highlights retries soon: the notes
        // may have been committed after the registry read or the raw CDN failed.
        cached = { at, ttl: view.updateAvailable && !notesRead ? failureTtlMs : successTtlMs, view }
        return view
      })
      .catch(() => {
        const view: UpdateCheckView = { current, latest: null, updateAvailable: false, highlights: [] }
        cached = { at, ttl: failureTtlMs, view }
        return view
      })
      .finally(() => {
        inflight = undefined
      })
    return inflight
  }
}

/**
 * Register the authenticated update-check route with its own disposer.
 * @param ctx - host context with the optional web server/connection services.
 * @param options - checker overrides for tests.
 */
export function registerUpdateRoute(
  ctx: { inject?: (dependencies: readonly string[], callback: (scoped: UpdateRouteServices) => void) => unknown },
  options?: UpdateCheckerOptions,
): void {
  ctx.inject?.(['webServer', 'connection'], scoped => {
    const { webServer, connection } = scoped
    if (typeof webServer?.register !== 'function' || typeof connection?.requestRejection !== 'function') return
    const check = createUpdateChecker(options)
    scoped.effect?.(() => webServer.register({
      kind: 'exact',
      path: UPDATE_ROUTE_PATH,
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
        void check().then((view) => {
          const body = JSON.stringify(view)
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'content-length': String(Buffer.byteLength(body)),
          })
          res.end(body)
        })
      },
    }))
  })
}
