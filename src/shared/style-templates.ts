/** Reusable style contracts shared by the Host and browser, without runtime dependencies. */
import type { AnswerStyle, RenderLayout } from './intelligent-ui.ts'

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
  readonly baseLayout: RenderLayout
  readonly directives: string
  /**
   * Optional: when absent the result inherits the session's theme (the selected
   * template, or the built-in theme when the session has none). A snapshot with
   * a theme is self-contained and can back a saved style template; a theme-less
   * one cannot, because there is no palette to copy.
   */
  readonly theme?: StyleTheme
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
  readonly baseLayout: RenderLayout
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
  readonly baseLayout: RenderLayout
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

/** Controlled token names: one source for validation and for the failure text. */
const PALETTE_TOKENS = ['canvas', 'ink', 'accent', 'muted', 'surface', 'border'] as const
const REQUIRED_PALETTE_TOKENS = ['canvas', 'ink', 'accent'] as const
const THEME_FIELDS = ['light', 'dark', 'font', 'radius', 'density', 'shadow'] as const
const SNAPSHOT_FIELDS = ['schemaVersion', 'baseLayout', 'directives', 'theme', 'suggestedName'] as const

function isPalette(value: unknown): value is StyleThemePalette {
  return isRecord(value)
    && hasOnlyKeys(value, PALETTE_TOKENS)
    && REQUIRED_PALETTE_TOKENS.every(key => isHexColor(value[key]))
    && ['muted', 'surface', 'border'].every(key => !(key in value) || isHexColor(value[key]))
}

/** Validate the complete controlled theme, rejecting arbitrary CSS or extra tokens. */
export function isStyleTheme(value: unknown): value is StyleTheme {
  return isRecord(value)
    && hasOnlyKeys(value, THEME_FIELDS)
    && isPalette(value.light) && isPalette(value.dark)
    && STYLE_THEME_FONTS.some(font => font === value.font)
    && STYLE_RADII.some(radius => radius === value.radius)
    && STYLE_DENSITIES.some(density => density === value.density)
    && STYLE_SHADOWS.some(shadow => shadow === value.shadow)
}

export function isLabel(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value === value.trim()
    && value.length >= min && value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

/** Name the first broken palette rule, so a rejection says which token to fix. */
function describePaletteProblem(value: unknown, path: string): string | undefined {
  if (!isRecord(value)) return `${path} is required (an object of six-digit hex colors)`
  const extra = Object.keys(value).find(key => !PALETTE_TOKENS.some(token => token === key))
  if (extra !== undefined) {
    return `${path}.${extra} is not a theme token (allowed: ${PALETTE_TOKENS.join(', ')})`
  }
  for (const key of REQUIRED_PALETTE_TOKENS) {
    if (!isHexColor(value[key])) return `${path}.${key} must be a six-digit hex color such as #1a1a1a`
  }
  for (const key of ['muted', 'surface', 'border']) {
    if (key in value && !isHexColor(value[key])) return `${path}.${key} must be a six-digit hex color such as #6b6b6b`
  }
  return undefined
}

/** Name the first broken theme rule. */
function describeThemeProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return `theme is required (light and dark palettes plus font, radius, density and shadow)`
  const extra = Object.keys(value).find(key => !THEME_FIELDS.some(field => field === key))
  if (extra !== undefined) return `theme.${extra} is not a theme field (allowed: ${THEME_FIELDS.join(', ')})`
  for (const scheme of ['light', 'dark']) {
    const problem = describePaletteProblem(value[scheme], `theme.${scheme}`)
    if (problem !== undefined) return problem
  }
  const choices: [key: string, allowed: readonly string[]][] = [
    ['font', STYLE_THEME_FONTS],
    ['radius', STYLE_RADII],
    ['density', STYLE_DENSITIES],
    ['shadow', STYLE_SHADOWS],
  ]
  for (const [key, allowed] of choices) {
    if (!allowed.some(option => option === value[key])) {
      return `theme.${key} must be one of ${allowed.map(option => `"${option}"`).join(', ')}`
    }
  }
  return undefined
}

/**
 * Why `value` is not a valid {@link StyleSnapshot}, or `undefined` when it is.
 *
 * The Host reports this reason instead of one generic sentence. A model that
 * omits `directives` or `theme` otherwise only learns that *something* is wrong
 * and retries the same payload; naming the field lets it self-correct in one
 * attempt.
 */
export function describeStyleSnapshotProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return 'temporaryStyle is required (an object, not a string or array)'
  const extra = Object.keys(value).find(key => !SNAPSHOT_FIELDS.some(field => field === key))
  if (extra !== undefined) return `unknown field "${extra}" (allowed: ${SNAPSHOT_FIELDS.join(', ')})`
  if (value.schemaVersion !== STYLE_SNAPSHOT_VERSION) return `schemaVersion must be ${STYLE_SNAPSHOT_VERSION}`
  if (value.baseLayout !== 'card' && value.baseLayout !== 'article' && value.baseLayout !== 'free') {
    return 'baseLayout must be "card", "article" or "free"'
  }
  if (typeof value.directives !== 'string' || value.directives.trim().length === 0) {
    return `directives is required (${STYLE_DIRECTIVES_MAX_LENGTH} characters max of reusable design rules)`
  }
  if (value.directives.length > STYLE_DIRECTIVES_MAX_LENGTH) {
    return `directives must be at most ${STYLE_DIRECTIVES_MAX_LENGTH} characters`
  }
  if (/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/.test(value.directives)) {
    return 'directives must not contain control characters'
  }
  // The theme is optional: a snapshot may inherit the session theme. When it is
  // present it must be complete, so a snapshot that can back a saved template
  // always carries a real palette.
  if ('theme' in value) {
    const themeProblem = describeThemeProblem(value.theme)
    if (themeProblem !== undefined) return themeProblem
  }
  if ('suggestedName' in value) {
    const suggestedName = value.suggestedName
    if (!isLabel(suggestedName, STYLE_NAME_MIN_LENGTH, STYLE_NAME_MAX_LENGTH)) {
      return `suggestedName must be ${STYLE_NAME_MIN_LENGTH}-${STYLE_NAME_MAX_LENGTH} characters`
    }
    if (/[\u0080-\u009f]/.test(suggestedName)) return 'suggestedName must not contain control characters'
    if (isReservedStyleName(suggestedName)) return 'suggestedName must not be Auto, Card or Article'
  }
  return undefined
}

/** Admit only bounded data and controlled tokens; directives never become prompt instructions. */
export function isStyleSnapshot(value: unknown): value is StyleSnapshot {
  return describeStyleSnapshotProblem(value) === undefined
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
    && (value.baseLayout === 'card' || value.baseLayout === 'article' || value.baseLayout === 'free')
    && typeof value.directives === 'string' && value.directives.length <= STYLE_DIRECTIVES_MAX_LENGTH
    && !/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/.test(value.directives)
    && isStyleTheme(value.theme)
    && (value.scope === 'global' ? !('sessionId' in value)
      : value.scope === 'session' && isLabel(value.sessionId, 1, 200))
    && typeof value.createdAt === 'number' && Number.isSafeInteger(value.createdAt) && value.createdAt >= 0
    && typeof value.updatedAt === 'number' && Number.isSafeInteger(value.updatedAt) && value.updatedAt >= value.createdAt
}
