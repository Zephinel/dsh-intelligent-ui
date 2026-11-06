/**
 * Deterministic property overrides for the simple structural blocks
 * (`Divider`, `Spacer`).
 *
 * The quick-adjust controls in the block popover are a zero-model edit: the
 * client sends the property bag, the Host validates it against the node's
 * component type and rewrites that one expression. Both halves import this
 * module so they agree on the supported keys, the accepted values and the
 * canonical mini-expression.
 */

/** Components whose props can be adjusted without a model turn. */
export const ARTIFACT_BLOCK_PROP_COMPONENTS = ['Divider', 'Spacer'] as const

/** One component that supports deterministic property overrides. */
export type ArtifactBlockPropComponent = (typeof ARTIFACT_BLOCK_PROP_COMPONENTS)[number]

/** The property bag accepted by one component; absent keys fall back to the theme default. */
export interface ArtifactBlockProps {
  /** Divider: paint colour (theme token or CSS colour). */
  readonly color?: string
  /** Divider/Spacer: CSS length (number = px, or a px/% string; Spacer also allows "auto"). */
  readonly width?: number | string
  /** Divider: line thickness in px. */
  readonly thickness?: number
  /** Spacer: CSS length (number = px, or a px/%/auto string). */
  readonly height?: number | string
}

/** Keys each component accepts, in argument order. */
const PROP_KEYS: Readonly<Record<ArtifactBlockPropComponent, readonly (keyof ArtifactBlockProps)[]>> = {
  Divider: ['color', 'width', 'thickness'],
  Spacer: ['width', 'height'],
}

/** Every key any quick-adjustable component accepts. */
export const ARTIFACT_BLOCK_PROP_KEYS = ['color', 'width', 'thickness', 'height'] as const

/** Theme tokens the renderer resolves for a divider colour. */
const COLOR_TOKENS = new Set([
  'ink', 'muted', 'faint', 'canvas', 'on-ink', 'surface', 'surface-strong', 'border',
  'info', 'success', 'warning', 'danger', 'purple', 'pink',
  'chart1', 'chart2', 'chart3', 'chart4', 'chart5', 'chart6',
])

const CSS_COLOR = /^(?:#[\da-f]{3,8}|[a-z]{3,24}|(?:rgb|rgba|hsl|hsla)\(\s*[\d.%\s,/]+\))$/i
const LENGTH_TEXT = /^(?:\d+(?:\.\d+)?(?:px|%)|auto)$/i

/** Whether a value names one supported block-prop component. */
export function isArtifactBlockPropComponent(value: unknown): value is ArtifactBlockPropComponent {
  return typeof value === 'string' && (ARTIFACT_BLOCK_PROP_COMPONENTS as readonly string[]).includes(value)
}

function colorProblem(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 60) return 'invalid_color'
  const text = value.trim()
  if (text.length === 0) return 'invalid_color'
  return COLOR_TOKENS.has(text) || CSS_COLOR.test(text) ? undefined : 'invalid_color'
}

function lengthProblem(value: unknown, allowAuto: boolean): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 2000 ? undefined : 'invalid_length'
  if (typeof value !== 'string' || value.length === 0 || value.length > 24) return 'invalid_length'
  const text = value.trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return 'invalid_length'
  if (!allowAuto && text.toLowerCase() === 'auto') return 'invalid_length'
  return LENGTH_TEXT.test(text) ? undefined : 'invalid_length'
}

/**
 * Describe why a property bag is malformed without knowing the component yet
 * (used by the untrusted request schema). Component-specific rules run later.
 * @param props - untrusted property bag.
 * @returns a stable machine-readable problem code, or undefined when valid.
 */
export function describeArtifactBlockPropsShapeProblem(props: unknown): string | undefined {
  if (props === null || typeof props !== 'object' || Array.isArray(props)) return 'invalid_props'
  const record = props as Record<string, unknown>
  if (Object.keys(record).some(key => !(ARTIFACT_BLOCK_PROP_KEYS as readonly string[]).includes(key))) return 'unknown_prop'
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (key === 'color') {
      const problem = colorProblem(value)
      if (problem !== undefined) return problem
    } else if (key === 'thickness') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.5 || value > 12) return 'invalid_thickness'
    } else {
      const problem = lengthProblem(value, true)
      if (problem !== undefined) return problem
    }
  }
  return undefined
}

/**
 * Describe why a property bag is unusable for one component, or undefined.
 * @param componentType - block component the props belong to.
 * @param props - untrusted property bag.
 * @returns a stable machine-readable problem code, or undefined when valid.
 */
export function describeArtifactBlockPropsProblem(componentType: string, props: unknown): string | undefined {
  if (!isArtifactBlockPropComponent(componentType)) return 'unsupported_component'
  if (props === null || typeof props !== 'object' || Array.isArray(props)) return 'invalid_props'
  const record = props as Record<string, unknown>
  const allowed = PROP_KEYS[componentType]
  if (Object.keys(record).some(key => !(allowed as readonly string[]).includes(key))) return 'unknown_prop'
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (key === 'color') {
      const problem = colorProblem(value)
      if (problem !== undefined) return problem
    } else if (key === 'thickness') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.5 || value > 12) return 'invalid_thickness'
    } else {
      const problem = lengthProblem(value, key === 'height' || (key === 'width' && componentType === 'Spacer'))
      if (problem !== undefined) return problem
    }
  }
  return undefined
}

function literal(value: string | number): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value)
}

/**
 * Build the canonical expression for one component and property bag. Optional
 * slots that are not set use `null` placeholders, matching the language's
 * positional argument convention.
 * @param componentType - Divider or Spacer.
 * @param props - validated property bag.
 * @returns the mini expression, e.g. `Divider(null, "60%", 2)`.
 */
export function serializeArtifactBlockProps(componentType: ArtifactBlockPropComponent, props: ArtifactBlockProps): string {
  const keys = PROP_KEYS[componentType]
  const last = keys.reduce((index, key, at) => (props[key] === undefined ? index : at), -1)
  if (last < 0) return `${componentType}()`
  const args = keys.slice(0, last + 1).map(key => (props[key] === undefined ? 'null' : literal(props[key] as string | number)))
  return `${componentType}(${args.join(', ')})`
}

/** Read the supported properties of one node from its parsed AST props. */
export function artifactBlockPropsFromNode(componentType: string, sourceProps: Readonly<Record<string, unknown>>): ArtifactBlockProps {
  if (!isArtifactBlockPropComponent(componentType)) return {}
  const result: Record<string, string | number> = {}
  for (const key of PROP_KEYS[componentType]) {
    const value = sourceProps[key]
    if (typeof value === 'string' || typeof value === 'number') result[key] = value
  }
  return result
}
