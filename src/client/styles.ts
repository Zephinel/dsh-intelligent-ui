/** Lazy local-template catalog. It has no React or DOM dependency. */
import { STYLES_ROUTE_PATH, isStyleTemplate, type StyleTemplate } from '../shared/style-templates.ts'

export interface StyleCatalogSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable'
  readonly sessionId?: string
  readonly templates: readonly StyleTemplate[]
  readonly error?: string
}

export interface StyleCatalog {
  /** Snapshots stay referentially stable until a load changes their state. */
  getSnapshot(): StyleCatalogSnapshot
  subscribe(listener: () => void): () => void
  /** Load only for an idle/unavailable catalog or a different session scope. */
  ensure(sessionId?: string): Promise<void>
  /** Revalidate the current scope after a template mutation. */
  refresh(): Promise<void>
  getTemplate(id: string): StyleTemplate | undefined
  readonly status: StyleCatalogSnapshot['status']
}

/** Create an isolated catalog; only the plugin uses the shared instance below. */
export function createStyleCatalog(options: { fetch?: typeof fetch } = {}): StyleCatalog {
  let snapshot: StyleCatalogSnapshot = { status: 'idle', templates: [] }
  let flight: { sessionId?: string; promise: Promise<void> } | undefined
  const listeners = new Set<() => void>()
  const publish = (next: StyleCatalogSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const request = (sessionId?: string, force = false): Promise<void> => {
    if (!force && flight !== undefined && flight.sessionId === sessionId) return flight.promise
    // A session switch must never expose another session's private templates.
    const templates = snapshot.templates.filter(template => template.scope === 'global' || template.sessionId === sessionId)
    const current = { sessionId, promise: Promise.resolve() }
    flight = current
    current.promise = Promise.resolve().then(async () => {
      try {
        const fetcher = options.fetch ?? globalThis.fetch
        const query = sessionId === undefined ? '' : `?sessionId=${encodeURIComponent(sessionId)}`
        const response = await fetcher(`${STYLES_ROUTE_PATH}${query}`, { credentials: 'same-origin', cache: 'no-store' })
        if (!response.ok) throw new Error(`Style catalog returned ${response.status}`)
        const body: unknown = await response.json()
        if (body === null || typeof body !== 'object' || !('templates' in body) || !Array.isArray(body.templates)) {
          throw new Error('Invalid style catalog')
        }
        if (flight !== current) return
        publish({
          status: 'ready',
          sessionId,
          templates: body.templates.filter(isStyleTemplate)
            .filter(template => template.scope === 'global' || (sessionId !== undefined && template.sessionId === sessionId)),
        })
      } catch (error) {
        if (flight !== current) return
        publish({ status: 'unavailable', sessionId, templates, error: error instanceof Error ? error.message : String(error) })
      } finally {
        if (flight === current) flight = undefined
      }
    })
    publish({ status: 'loading', sessionId, templates })
    return current.promise
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    ensure: (sessionId) => {
      if (flight !== undefined && flight.sessionId === sessionId) return flight.promise
      if (snapshot.sessionId !== sessionId || snapshot.status === 'idle' || snapshot.status === 'unavailable') return request(sessionId)
      return Promise.resolve()
    },
    refresh: () => request(snapshot.sessionId, true),
    getTemplate: id => snapshot.templates.find(template => template.id === id),
    get status() { return snapshot.status },
  }
}

export const styleCatalog = createStyleCatalog()
