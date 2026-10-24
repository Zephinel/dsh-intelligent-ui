/** Authenticated template mutations shared by result cards and both managers. */
import { STYLES_ROUTE_PATH, isStyleTemplate, type StyleTemplate } from '../shared/style-templates.ts'
import type { PortableStyleTemplate } from '../shared/style-template-exchange.ts'

export interface SaveFromResultInput {
  readonly resultId: string
  readonly name: string
  readonly description?: string
  readonly scope: 'global' | 'session'
  readonly sessionId?: string
}
export type TemplatePatch = Partial<Pick<StyleTemplate, 'name' | 'description' | 'directives'>>
export interface StyleActions {
  createTemplate(input: PortableStyleTemplate): Promise<StyleTemplate>
  saveFromResult(input: SaveFromResultInput): Promise<StyleTemplate>
  update(id: string, patch: TemplatePatch): Promise<StyleTemplate>
  delete(id: string): Promise<void>
}
export class StyleActionError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}

export function createStyleActions(options: { fetch?: typeof fetch } = {}): StyleActions {
  const post = async (body: object): Promise<Record<string, unknown>> => {
    const response = await (options.fetch ?? globalThis.fetch)(STYLES_ROUTE_PATH, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const value: unknown = await response.json()
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new StyleActionError('invalid_response')
    if (!response.ok) {
      const failure = 'error' in value ? value.error : undefined
      const code = failure !== null && typeof failure === 'object' && 'code' in failure && typeof failure.code === 'string' ? failure.code : 'request_failed'
      throw new StyleActionError(code)
    }
    return value as Record<string, unknown>
  }
  const template = (value: Record<string, unknown>): StyleTemplate => {
    if (!isStyleTemplate(value.template)) throw new StyleActionError('invalid_response')
    return value.template
  }
  return {
    createTemplate: async input => template(await post({ op: 'save', template: {
      name: input.name, description: input.description, baseLayout: input.baseLayout, directives: input.directives, theme: input.theme,
    }, scope: 'global' })),
    saveFromResult: async input => template(await post({ op: 'saveFromResult', ...input })),
    update: async (id, patch) => {
      const saved = template(await post({ op: 'update', id, patch }))
      if (saved.id !== id) throw new StyleActionError('invalid_response')
      return saved
    },
    delete: async id => {
      if ((await post({ op: 'delete', id })).deleted !== id) throw new StyleActionError('invalid_response')
    },
  }
}
export const styleActions = createStyleActions()
