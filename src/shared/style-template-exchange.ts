/** Portable single-template exchange. No identity, persistence or browser dependencies. */
import { isRenderLayout, type RenderLayout } from './intelligent-ui.ts'
import {
  isLabel, isReservedStyleName, isStyleTheme,
  STYLE_NAME_MIN_LENGTH, STYLE_NAME_MAX_LENGTH, STYLE_DESCRIPTION_MAX_LENGTH, STYLE_DIRECTIVES_MAX_LENGTH,
  type StyleTemplate, type StyleTheme, type StyleThemePalette,
} from './style-templates.ts'

export const STYLE_EXCHANGE_KIND = 'dsh-intelligent-ui/style-template'
export const STYLE_EXCHANGE_VERSION = 1
export const STYLE_EXCHANGE_MAX_BYTES = 32 * 1024

export interface PortableStyleTemplate {
  readonly name: string
  readonly description: string
  readonly baseLayout: RenderLayout
  readonly directives: string
  readonly theme: StyleTheme
}
export interface StyleExportEnvelope {
  readonly kind: typeof STYLE_EXCHANGE_KIND
  readonly schemaVersion: typeof STYLE_EXCHANGE_VERSION
  readonly template: PortableStyleTemplate
}
export type StyleExchangeErrorCode = 'empty_input' | 'too_large' | 'invalid_json' | 'invalid_structure' | 'unsupported_version' | 'invalid_template'
export class StyleExchangeError extends Error {
  readonly code: StyleExchangeErrorCode
  constructor(code: StyleExchangeErrorCode) { super(code); this.name = 'StyleExchangeError'; this.code = code }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key))
}
/** Remove invisible formatting and line separators from external labels. */
function labelText(value: string): string {
  return value.replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu, '').replace(/[\u2028\u2029]/g, ' ').replace(/ {2,}/g, ' ').trim()
}

/** Invisible format controls and default-ignorable code points never belong in external template text. */
const FORMAT_CONTROLS = /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu

function palette(value: StyleThemePalette): StyleThemePalette {
  const result: { canvas: string; ink: string; accent: string; muted?: string; surface?: string; border?: string } = {
    canvas: value.canvas, ink: value.ink, accent: value.accent,
  }
  if (value.muted !== undefined) result.muted = value.muted
  if (value.surface !== undefined) result.surface = value.surface
  if (value.border !== undefined) result.border = value.border
  return result
}

/** Validate portable fields and explicitly rebuild every level in canonical order. */
function portable(value: Record<string, unknown>): PortableStyleTemplate {
  const name = typeof value.name === 'string' ? labelText(value.name) : value.name
  const description = value.description === undefined ? ''
    : typeof value.description === 'string' ? labelText(value.description) : value.description
  const directives = typeof value.directives === 'string' ? value.directives.replace(FORMAT_CONTROLS, '') : value.directives
  if (!isLabel(name, STYLE_NAME_MIN_LENGTH, STYLE_NAME_MAX_LENGTH) || isReservedStyleName(name)
    || !isLabel(description, 0, STYLE_DESCRIPTION_MAX_LENGTH) || !isRenderLayout(value.baseLayout)
    || typeof directives !== 'string' || directives.length > STYLE_DIRECTIVES_MAX_LENGTH
    || /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/.test(directives) || !isStyleTheme(value.theme)) {
    throw new StyleExchangeError('invalid_template')
  }
  return {
    name, description, baseLayout: value.baseLayout, directives,
    theme: {
      light: palette(value.theme.light), dark: palette(value.theme.dark),
      font: value.theme.font, radius: value.theme.radius, density: value.theme.density, shadow: value.theme.shadow,
    },
  }
}

/** Truncate a template label without splitting a surrogate pair. */
export function truncateTemplateLabel(value: string, max: number): string {
  let result = ''
  for (const char of value) {
    if (result.length + char.length > max) break
    result += char
  }
  return result.trimEnd()
}

/** Project local templates without retaining any local identity or object references. */
export function toPortableStyle(template: StyleTemplate | PortableStyleTemplate): PortableStyleTemplate {
  return portable({ name: template.name, description: template.description, baseLayout: template.baseLayout,
    directives: template.directives, theme: template.theme })
}
export function createStyleExport(template: StyleTemplate | PortableStyleTemplate): StyleExportEnvelope {
  return { kind: STYLE_EXCHANGE_KIND, schemaVersion: STYLE_EXCHANGE_VERSION, template: toPortableStyle(template) }
}
export function encodeStyleExport(template: StyleTemplate | PortableStyleTemplate): string {
  return JSON.stringify(createStyleExport(template), null, 2)
}

/** Admit exactly Envelope v1; raw legacy exports, store documents and other shapes reject. */
export function parseStyleExport(text: string): PortableStyleTemplate {
  if (new TextEncoder().encode(text).length > STYLE_EXCHANGE_MAX_BYTES) throw new StyleExchangeError('too_large')
  let input = text.trim()
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/.exec(input)
  if (fence) input = fence[1].trim()
  if (input === '') throw new StyleExchangeError('empty_input')
  let value: unknown
  try { value = JSON.parse(input) }
  catch { throw new StyleExchangeError('invalid_json') }
  if (!record(value)) throw new StyleExchangeError('invalid_structure')
  if (!onlyKeys(value, ['kind', 'schemaVersion', 'template']) || Object.keys(value).length !== 3
    || value.kind !== STYLE_EXCHANGE_KIND) throw new StyleExchangeError('invalid_structure')
  if (typeof value.schemaVersion !== 'number') throw new StyleExchangeError('invalid_structure')
  if (value.schemaVersion !== STYLE_EXCHANGE_VERSION) throw new StyleExchangeError('unsupported_version')
  if (!record(value.template) || !onlyKeys(value.template, ['name', 'description', 'baseLayout', 'directives', 'theme'])) {
    throw new StyleExchangeError('invalid_structure')
  }
  return portable(value.template)
}
