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

/** Notes variant selected from the client language (English falls back to the default file). */
export type ReleaseNotesVariant = 'default' | 'en'

/** Normalize a client locale id into the notes variant this extension ships. */
export function releaseNotesVariant(language: string | null | undefined): ReleaseNotesVariant {
  return language !== null && language !== undefined && language.trim().toLowerCase().startsWith('en') ? 'en' : 'default'
}

/** Tag-pinned raw URL of one release's notes document (English suffix when requested). */
export function releaseNotesUrl(repository: string, version: string, variant: ReleaseNotesVariant = 'default'): string {
  const suffix = variant === 'en' ? '.en' : ''
  return `https://raw.githubusercontent.com/${repository}/v${version}/release-notes/${version}${suffix}.md`
}

/**
 * Build one cached update check.
 * @param options - fetch/time overrides for tests.
 * @returns a function resolving one {@link UpdateCheckView}; it never rejects.
 */
export function createUpdateChecker(options: UpdateCheckerOptions = {}): (language?: string | null) => Promise<UpdateCheckView> {
  const installed = installedVersion(options.manifestUrl)
  const current = installed ?? '0.0.0'
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const successTtlMs = options.successTtlMs ?? SUCCESS_TTL_MS
  const failureTtlMs = options.failureTtlMs ?? FAILURE_TTL_MS
  const cached = new Map<ReleaseNotesVariant, { at: number; ttl: number; view: UpdateCheckView }>()
  const inflight = new Map<ReleaseNotesVariant, Promise<UpdateCheckView>>()

  const readNotes = async (repository: string, latest: string, variant: ReleaseNotesVariant): Promise<string[]> => {
    const response = await fetchImpl(releaseNotesUrl(repository, latest, variant), {
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`notes answered ${response.status}`)
    return parseHighlights(await response.text()).slice(0, 6)
  }

  const read = async (variant: ReleaseNotesVariant): Promise<{ view: UpdateCheckView; notesRead: boolean }> => {
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
    // An English request prefers <version>.en.md and falls back to the reviewed
    // default file (also when the English file exists but has no Highlights).
    const variants: readonly ReleaseNotesVariant[] = variant === 'en' ? ['en', 'default'] : ['default']
    for (const candidate of variants) {
      try {
        const highlights = await readNotes(repository, latest, candidate)
        if (highlights.length > 0) return { view: { current, latest, updateAvailable: true, highlights }, notesRead: true }
      } catch { /* try the fallback variant */ }
    }
    return { view: { current, latest, updateAvailable: true, highlights: [] }, notesRead: false }
  }

  return async (language?: string | null) => {
    const variant = releaseNotesVariant(language)
    const at = now()
    const hit = cached.get(variant)
    if (hit !== undefined && at - hit.at < hit.ttl) return hit.view
    const running = inflight.get(variant)
    if (running !== undefined) return running
    const request = read(variant)
      .then(({ view, notesRead }) => {
        // A version update without readable highlights retries soon: the notes
        // may have been committed after the registry read or the raw CDN failed.
        cached.set(variant, { at, ttl: view.updateAvailable && !notesRead ? failureTtlMs : successTtlMs, view })
        return view
      })
      .catch(() => {
        const view: UpdateCheckView = { current, latest: null, updateAvailable: false, highlights: [] }
        cached.set(variant, { at, ttl: failureTtlMs, view })
        return view
      })
      .finally(() => {
        inflight.delete(variant)
      })
    inflight.set(variant, request)
    return request
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
        const language = new URL(req.url ?? UPDATE_ROUTE_PATH, 'http://localhost').searchParams.get('lang')
        void check(language).then((view) => {
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
