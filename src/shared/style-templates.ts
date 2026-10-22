/** Reusable style contracts shared by the Host and browser, without runtime dependencies. */
import type { AnswerStyle, PageStyle } from './intelligent-ui.ts'

export const CUSTOM_STYLE_PREFIX = 'cs_'
export const STYLE_NAME_MIN_LENGTH = 1
export const STYLE_NAME_MAX_LENGTH = 30
export const STYLE_DESCRIPTION_MAX_LENGTH = 100
export const STYLE_DIRECTIVES_MAX_LENGTH = 2000
export const MAX_GLOBAL_STYLE_TEMPLATES = 40
export const MAX_SESSION_STYLE_TEMPLATES = 20
export const STYLE_THEME_FONTS = ['sans', 'serif', 'mono'] as const
export const STYLE_RADII = ['sharp', 'soft', 'round'] as const
export const STYLE_DENSITIES = ['compact', 'comfortable', 'spacious'] as const
export const STYLE_SHADOWS = ['none', 'soft', 'float'] as const
export const STYLES_ROUTE_PATH = '/api/intelligent-ui/styles'
export const STYLE_SNAPSHOT_VERSION = 1

/** A result-owned style, carried in recorded tool arguments rather than the catalog. */
export interface StyleSnapshot {
  readonly schemaVersion: 1
  readonly baseLayout: PageStyle
  readonly directives: string
  readonly theme: StyleTheme
  readonly suggestedName?: string
}
export type StyleId = AnswerStyle | string

export interface StyleThemePalette {
  readonly canvas: string
  readonly ink: string
  readonly accent: string
  readonly muted?: string
  readonly surface?: string
  readonly border?: string
}

export interface StyleTheme {
  readonly light: StyleThemePalette
  readonly dark: StyleThemePalette
  readonly font: (typeof STYLE_THEME_FONTS)[number]
  readonly radius: (typeof STYLE_RADII)[number]
  readonly density: (typeof STYLE_DENSITIES)[number]
  readonly shadow: (typeof STYLE_SHADOWS)[number]
}

export interface StyleTemplate {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly baseLayout: PageStyle
  readonly directives: string
  readonly theme: StyleTheme
  readonly scope: 'global' | 'session'
  readonly sessionId?: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface CreateStyleTemplateInput {
  readonly name: string
  readonly description?: string
  readonly baseLayout: PageStyle
  readonly directives: string
  readonly theme: StyleTheme
  readonly scope: 'global' | 'session'
  readonly sessionId?: string
}

/** Recognize custom identifiers at settings, persistence and command boundaries. */
export function isCustomStyleId(value: unknown): value is string {
  return typeof value === 'string' && /^cs_[a-z0-9]{6,32}$/.test(value)
}

/** Accept built-in styles or a well-formed custom identifier. */
export function isStyleId(value: unknown): value is StyleId {
  return value === 'auto' || value === 'card' || value === 'article' || isCustomStyleId(value)
}

/** Prevent custom labels from impersonating built-in choices. */
export function isReservedStyleName(value: string): boolean {
  return ['auto', 'card', 'article'].includes(value.trim().toLowerCase())
}

/** Only six-digit hex colors may become renderer theme tokens. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key))
}

function isPalette(value: unknown): value is StyleThemePalette {
  return isRecord(value)
    && hasOnlyKeys(value, ['canvas', 'ink', 'accent', 'muted', 'surface', 'border'])
    && ['canvas', 'ink', 'accent'].every(key => isHexColor(value[key]))
    && ['muted', 'surface', 'border'].every(key => !(key in value) || isHexColor(value[key]))
}

/** Validate the complete controlled theme, rejecting arbitrary CSS or extra tokens. */
export function isStyleTheme(value: unknown): value is StyleTheme {
  return isRecord(value)
    && hasOnlyKeys(value, ['light', 'dark', 'font', 'radius', 'density', 'shadow'])
    && isPalette(value.light) && isPalette(value.dark)
    && STYLE_THEME_FONTS.some(font => font === value.font)
    && STYLE_RADII.some(radius => radius === value.radius)
    && STYLE_DENSITIES.some(density => density === value.density)
    && STYLE_SHADOWS.some(shadow => shadow === value.shadow)
}

function isLabel(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value === value.trim()
    && value.length >= min && value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

/** Admit only bounded data and controlled tokens; directives never become prompt instructions. */
export function isStyleSnapshot(value: unknown): value is StyleSnapshot {
  return isRecord(value) && hasOnlyKeys(value, ['schemaVersion', 'baseLayout', 'directives', 'theme', 'suggestedName'])
    && value.schemaVersion === STYLE_SNAPSHOT_VERSION
    && (value.baseLayout === 'card' || value.baseLayout === 'article')
    && typeof value.directives === 'string' && value.directives.trim().length > 0
    && value.directives.length <= STYLE_DIRECTIVES_MAX_LENGTH
    && !/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/.test(value.directives)
    && isStyleTheme(value.theme)
    && (!('suggestedName' in value) || (isLabel(value.suggestedName, STYLE_NAME_MIN_LENGTH, STYLE_NAME_MAX_LENGTH)
      && !/[\u0080-\u009f]/.test(value.suggestedName)
      && !isReservedStyleName(value.suggestedName)))
}

/** WCAG contrast ratio for two validated six-digit sRGB colors. */
export function contrastRatio(hexA: string, hexB: string): number {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map(offset => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const a = luminance(hexA)
  const b = luminance(hexB)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Validate persisted or newly authored templates without trusting their field types. */
export function isStyleTemplate(value: unknown): value is StyleTemplate {
  if (!isRecord(value)) return false
  return hasOnlyKeys(value, ['id', 'name', 'description', 'baseLayout', 'directives', 'theme', 'scope', 'sessionId', 'createdAt', 'updatedAt'])
    && isCustomStyleId(value.id)
    && isLabel(value.name, STYLE_NAME_MIN_LENGTH, STYLE_NAME_MAX_LENGTH) && !isReservedStyleName(value.name)
    && isLabel(value.description, 0, STYLE_DESCRIPTION_MAX_LENGTH)
    && (value.baseLayout === 'card' || value.baseLayout === 'article')
    && typeof value.directives === 'string' && value.directives.length <= STYLE_DIRECTIVES_MAX_LENGTH
    && !/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/.test(value.directives)
    && isStyleTheme(value.theme)
    && (value.scope === 'global' ? !('sessionId' in value)
      : value.scope === 'session' && isLabel(value.sessionId, 1, 200))
    && typeof value.createdAt === 'number' && Number.isSafeInteger(value.createdAt) && value.createdAt >= 0
    && typeof value.updatedAt === 'number' && Number.isSafeInteger(value.updatedAt) && value.updatedAt >= value.createdAt
}
