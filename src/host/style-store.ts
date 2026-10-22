/** Persistent local templates; writes commit to memory only after the atomic file replacement. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  CUSTOM_STYLE_PREFIX,
  MAX_GLOBAL_STYLE_TEMPLATES,
  MAX_SESSION_STYLE_TEMPLATES,
  isStyleTemplate,
} from '../shared/style-templates.ts'
import type { CreateStyleTemplateInput, StyleTemplate } from '../shared/style-templates.ts'

export type StyleTemplatePatch = Partial<Pick<StyleTemplate, 'name' | 'description' | 'directives' | 'theme' | 'baseLayout'>>

export interface StyleStore {
  get(id: string): StyleTemplate | undefined
  listForSession(sessionId?: string): StyleTemplate[]
  create(input: CreateStyleTemplateInput): StyleTemplate
  update(id: string, patch: StyleTemplatePatch): StyleTemplate | undefined
  remove(id: string): boolean
  resolve(id: string, sessionId?: string): StyleTemplate | undefined
}

const templateSchema = z.custom<StyleTemplate>(value => isStyleTemplate(value), 'Invalid style template: check name, scope, limits and theme tokens')
const fileSchema = z.object({ version: z.literal(1), templates: z.array(templateSchema) }).strict()
const EDITABLE_KEYS = ['name', 'description', 'directives', 'theme', 'baseLayout']

function cleanLabel(value: string): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Style names and descriptions must be text without control characters')
  }
  return value.trim()
}

function validateCollection(templates: readonly StyleTemplate[]): void {
  const ids = new Set<string>()
  const names = new Set<string>()
  const counts = new Map<string | undefined, number>()
  for (const template of templates) {
    templateSchema.parse(template)
    const name = template.name.toLowerCase()
    if (ids.has(template.id)) throw new Error('Duplicate style id')
    if (names.has(name)) throw new Error('Duplicate style name (case-insensitive)')
    ids.add(template.id)
    names.add(name)
    const key = template.scope === 'global' ? undefined : template.sessionId
    const count = (counts.get(key) ?? 0) + 1
    const limit = template.scope === 'global' ? MAX_GLOBAL_STYLE_TEMPLATES : MAX_SESSION_STYLE_TEMPLATES
    if (count > limit) throw new Error(`Style template limit reached (${limit} per ${template.scope} scope)`)
    counts.set(key, count)
  }
}

/** Create an isolated store bound to the harness home at plugin boot. */
export function createStyleStore(ctx: { logger?: { warn(message: string): void } } = {}): StyleStore {
  const file = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-intelligent-ui-styles.json')
  let templates: StyleTemplate[] = []
  let corrupt = false
  try {
    const loaded = fileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).templates
    validateCollection(loaded)
    templates = loaded
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      corrupt = true
      ctx.logger?.warn(`intelligent-ui: could not load style templates; starting empty: ${String(error)}`)
    }
  }

  const persist = (next: StyleTemplate[]): void => {
    validateCollection(next)
    mkdirSync(dirname(file), { recursive: true })
    // Preserve unreadable/invalid data before any write can replace it.
    if (corrupt) {
      renameSync(file, `${file}.corrupt-${Date.now()}`)
      corrupt = false
    }
    writeFileSync(`${file}.tmp`, `${JSON.stringify({ version: 1, templates: next }, null, 2)}\n`, 'utf8')
    renameSync(`${file}.tmp`, file)
    templates = next
  }

  const get = (id: string): StyleTemplate | undefined => {
    const template = templates.find(template => template.id === id)
    return template === undefined ? undefined : structuredClone(template)
  }
  const visible = (template: StyleTemplate, sessionId?: string): boolean =>
    template.scope === 'global' || (sessionId !== undefined && template.sessionId === sessionId)

  return {
    get,
    listForSession: (sessionId) => templates.slice().reverse()
      .filter(template => visible(template, sessionId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(template => structuredClone(template)),
    create: (input) => {
      let id: string
      do { id = `${CUSTOM_STYLE_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 12)}` } while (templates.some(template => template.id === id))
      const now = Date.now()
      const template = templateSchema.parse({
        ...input,
        id,
        name: cleanLabel(input.name),
        description: cleanLabel(input.description ?? ''),
        createdAt: now,
        updatedAt: now,
      })
      persist([...templates, structuredClone(template)])
      return structuredClone(template)
    },
    update: (id, patch) => {
      const current = get(id)
      if (current === undefined) return undefined
      if (Object.keys(patch).some(key => !EDITABLE_KEYS.includes(key))) throw new Error('Only name, description, directives, theme and baseLayout can be updated; scope is immutable')
      const template = templateSchema.parse({
        ...current,
        ...patch,
        ...'name' in patch ? { name: cleanLabel(patch.name!) } : {},
        ...'description' in patch ? { description: cleanLabel(patch.description!) } : {},
        updatedAt: Date.now(),
      })
      persist(templates.map(item => item.id === id ? structuredClone(template) : item))
      return structuredClone(template)
    },
    remove: (id) => {
      if (!templates.some(template => template.id === id)) return false
      persist(templates.filter(template => template.id !== id))
      return true
    },
    resolve: (id, sessionId) => {
      const template = get(id)
      return template !== undefined && visible(template, sessionId) ? template : undefined
    },
  }
}
