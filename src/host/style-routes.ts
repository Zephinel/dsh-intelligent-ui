/** Authenticated catalog and saved-template operations. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  STYLES_ROUTE_PATH, isStyleTemplate,
  type CreateStyleTemplateInput,
} from '../shared/style-templates.ts'
import type { StyleStore } from './style-store.ts'
import { isCustomStyleId, isReservedStyleName } from '../shared/style-templates.ts'
import { isResultIdentity, type ResultStore } from './result-store.ts'

interface StyleRouteServices {
  readonly webServer?: {
    register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): void }): () => void
  }
  readonly connection?: { requestRejection(req: IncomingMessage): number | undefined }
  effect?(fn: () => unknown): unknown
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function error(res: ServerResponse, status: number, code: string, message: string): void {
  json(res, status, { error: { code, message } })
}

function allowed(req: IncomingMessage, res: ServerResponse, connection: NonNullable<StyleRouteServices['connection']>, methods: readonly string[]): boolean {
  const rejection = connection.requestRejection(req)
  if (rejection !== undefined) {
    res.writeHead(rejection, { 'cache-control': 'no-store' })
    res.end()
    return false
  }
  if (!methods.includes(req.method ?? '')) {
    res.writeHead(405, { allow: methods.join(', '), 'cache-control': 'no-store' })
    res.end()
    return false
  }
  return true
}

/** Reject unsupported, slow or oversized input before parsing; never echo payloads. */
function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return Promise.reject(new Error('Content-Type must be application/json.'))
  }
  if (Number(req.headers['content-length']) > 64 * 1024) return Promise.reject(new Error('JSON body exceeds 64 KiB.'))
  return new Promise((resolve, reject) => {
    let size = 0
    const parts: Buffer[] = []
    const finish = (message?: string): void => {
      cleanup()
      if (message !== undefined) {
        req.resume()
        reject(new Error(message))
        return
      }
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))) }
      catch { reject(new Error('Invalid JSON body.')) }
    }
    const data = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > 64 * 1024) finish('JSON body exceeds 64 KiB.')
      else parts.push(bytes)
    }
    const end = (): void => finish()
    const failed = (): void => finish('Could not read JSON body.')
    const timer = setTimeout(() => finish('JSON body timed out.'), 15_000)
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

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function label(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

/** Whitelist save operations before passing editable fields to the store. */
function saveInput(body: unknown): CreateStyleTemplateInput | undefined {
  if (!record(body) || Object.keys(body).some(key => !['op', 'template', 'scope', 'sessionId'].includes(key))) return undefined
  switch (body.op) {
    case 'save': {
      if (!record(body.template) || (body.scope !== 'global' && body.scope !== 'session')) return undefined
      const draft = { ...body.template,
        name: typeof body.template.name === 'string' ? body.template.name.trim() : body.template.name,
        description: typeof body.template.description === 'string' ? body.template.description.trim() : body.template.description ?? '',
      }
      const validated = { ...draft, id: 'cs_validate', scope: 'global', createdAt: 0, updatedAt: 0 }
      if (!isStyleTemplate(validated)
        || Object.keys(draft).some(key => !['name', 'description', 'baseLayout', 'directives', 'theme'].includes(key))) return undefined
      if (body.scope === 'session' && (typeof body.sessionId !== 'string' || body.sessionId.trim() === ''
        || body.sessionId.length > 200 || /[\u0000-\u001f\u007f]/.test(body.sessionId))) return undefined
      const { name, description, baseLayout, directives, theme } = validated
      return { name, description, baseLayout, directives, theme, scope: body.scope,
        ...body.scope === 'session' ? { sessionId: (body.sessionId as string).trim() } : {} }
    }
    default: return undefined
  }
}

/** Keep store diagnostics useful while hiding validation dumps, paths and IO details. */
function saveFailure(res: ServerResponse, cause: unknown): void {
  const message = cause instanceof Error ? cause.message : ''
  if (message.startsWith('Duplicate style name')) error(res, 400, 'duplicate_name', 'A style with this name already exists.')
  else if (message.startsWith('Style template limit reached')) error(res, 400, 'limit_reached', 'The style library has reached its scope limit.')
  else error(res, 400, 'save_failed', 'Could not save the style. Check its name, scope and theme, then retry.')
}

/** Expose catalog/save only with the existing connection authentication. */
export function registerStyleRoutes(ctx: {
  inject?: (dependencies: readonly string[], callback: (scoped: StyleRouteServices) => void) => unknown
}, store: StyleStore, results: ResultStore): void {
  ctx.inject?.(['webServer', 'connection'], scoped => {
    const { webServer, connection } = scoped
    if (typeof webServer?.register !== 'function' || typeof connection?.requestRejection !== 'function') return
    scoped.effect?.(() => webServer.register({
      kind: 'exact', path: STYLES_ROUTE_PATH,
      handler: (req, res) => {
        if (!allowed(req, res, connection, ['GET', 'POST'])) return
        if (req.method === 'GET') {
          const sessionId = new URL(req.url ?? STYLES_ROUTE_PATH, 'http://localhost').searchParams.get('sessionId') ?? undefined
          json(res, 200, { templates: store.listForSession(sessionId) })
          return
        }
        void readJson(req).then(body => {
          if (record(body) && body.op === 'saveFromResult') {
            if (Object.keys(body).some(key => !['op', 'resultId', 'name', 'description', 'scope', 'sessionId'].includes(key))
              || !isResultIdentity(body.resultId) || !label(body.name, 1, 30) || isReservedStyleName(body.name)
              || ('description' in body && !label(body.description, 0, 100))
              || ('sessionId' in body && !isResultIdentity(body.sessionId))
              || (body.scope !== 'global' && body.scope !== 'session')
              || (body.scope === 'session' && !isResultIdentity(body.sessionId))) {
              error(res, 400, 'invalid_input', 'Invalid result, label or scope.'); return
            }
            const result = results.get(body.resultId)
            if (result === undefined) { error(res, 404, 'result_missing', 'This result snapshot is no longer available.'); return }
            if (body.scope === 'session' && body.sessionId !== result.sessionId) {
              error(res, 400, 'invalid_input', 'The session must match the result.'); return
            }
            const { baseLayout, directives, theme } = result.snapshot
            // A template needs a palette of its own; a theme-less result has none to copy.
            if (theme === undefined) {
              error(res, 400, 'no_theme', 'This result has no explicit theme, so it cannot become a style template. Adjust it with a theme first, then save.')
              return
            }
            const input = saveInput({ op: 'save', template: { name: body.name, description: body.description, baseLayout, directives, theme }, scope: body.scope, sessionId: body.sessionId })
            if (input === undefined) { error(res, 400, 'invalid_input', 'Invalid style name, description or scope.'); return }
            try { json(res, 201, { template: store.create(input) }) }
            catch (cause) { saveFailure(res, cause) }
            return
          }
          if (record(body) && (body.op === 'update' || body.op === 'delete')) {
            if (!isCustomStyleId(body.id) || Object.keys(body).some(key => !['op', 'id', ...body.op === 'update' ? ['patch'] : []].includes(key))) {
              error(res, 400, 'invalid_input', 'Invalid template operation.'); return
            }
            if (body.op === 'delete') {
              try {
                if (!store.remove(body.id)) error(res, 404, 'template_missing', 'This template no longer exists.')
                else json(res, 200, { deleted: body.id })
              } catch (cause) { saveFailure(res, cause) }
              return
            }
            const patch = body.patch
            if (!record(patch) || Object.keys(patch).length === 0
              || Object.keys(patch).some(key => !['name', 'description', 'directives'].includes(key) || typeof patch[key] !== 'string')) {
              error(res, 400, 'invalid_input', 'Only name, description and directives can be updated.'); return
            }
            const current = store.get(body.id)
            if (current === undefined) { error(res, 404, 'template_missing', 'This template no longer exists.'); return }
            const candidate = { ...current, ...patch,
              name: typeof patch.name === 'string' ? patch.name.trim() : current.name,
              description: typeof patch.description === 'string' ? patch.description.trim() : current.description }
            if (!isStyleTemplate(candidate)) { error(res, 400, 'invalid_input', 'Invalid style label or directives.'); return }
            try { json(res, 200, { template: store.update(body.id, patch) }) }
            catch (cause) { saveFailure(res, cause) }
            return
          }
          const input = saveInput(body)
          if (input === undefined) { error(res, 400, 'invalid_input', 'Invalid save operation, template or scope.'); return }
          try { json(res, 201, { template: store.create(input) }) }
          catch (cause) { saveFailure(res, cause) }
        }, cause => error(res, 400, 'invalid_input', cause.message))
      },
    }))
  })

}
