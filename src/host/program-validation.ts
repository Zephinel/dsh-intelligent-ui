/**
 * AST validation helpers for the article vocabulary.
 *
 * Kept out of the Host entry so tool registration, prompt copy and structural
 * validation can change independently.
 */
import { anchorSlug } from '../shared/anchor.ts'

/** Section and Toc targets collected from one parsed program. */
export interface ArticleAnchors {
  /** Effective Section anchors in render order. */
  readonly section: string[]
  /** Effective Toc targets in display order. */
  readonly toc: string[]
  /** Structural problems that are not duplicate targets. */
  readonly issues: string[]
}

/** Collect the reachable component types from a parsed program AST. */
export function collectComponentTypes(node: unknown, types: Set<string>): void {
  if (Array.isArray(node)) {
    for (const child of node) collectComponentTypes(child, types)
    return
  }
  if (node === null || typeof node !== 'object') return
  const record = node as { typeName?: unknown }
  if (typeof record.typeName === 'string') types.add(record.typeName)
  for (const value of Object.values(record)) collectComponentTypes(value, types)
}

/** Collect Section and Toc targets from a parsed article AST. */
export function collectArticleAnchors(
  node: unknown,
  sections: string[],
  toc: string[],
  issues: string[],
): void {
  if (Array.isArray(node)) {
    for (const child of node) collectArticleAnchors(child, sections, toc, issues)
    return
  }
  if (node === null || typeof node !== 'object') return
  const record = node as { typeName?: unknown; props?: unknown }
  const props = record.props as { title?: unknown; anchor?: unknown; items?: unknown; anchors?: unknown } | undefined
  if (record.typeName === 'Section' && props !== undefined) {
    const title = typeof props.title === 'string' ? props.title : undefined
    const anchor = typeof props.anchor === 'string' && props.anchor.trim() !== '' ? props.anchor : title
    if (anchor !== undefined) sections.push(anchorSlug(anchor))
  }
  if (record.typeName === 'Toc' && props !== undefined) {
    const items = Array.isArray(props.items) ? props.items : []
    const anchors = Array.isArray(props.anchors) ? props.anchors : undefined
    if (anchors !== undefined && anchors.length !== items.length) {
      issues.push('Toc `anchors` must have the same length as `items`.')
    }
    for (const [index, item] of items.entries()) {
      const anchor = anchors?.[index]
      if (typeof item === 'string') {
        toc.push(anchorSlug(typeof anchor === 'string' && anchor.trim() !== '' ? anchor : item))
      }
    }
  }
  for (const value of Object.values(record)) collectArticleAnchors(value, sections, toc, issues)
}

/** Return values that occur more than once, preserving order. */
function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    else seen.add(value)
  }
  return [...repeated]
}

/**
 * Validate a parsed program that uses Section or Toc.
 * @param anchors - collected anchors.
 * @param types - reachable component types.
 * @returns a model-readable error, or undefined when the structure is valid.
 */
export function articleAnchorError(anchors: ArticleAnchors, types: ReadonlySet<string>): string | undefined {
  if (!types.has('Section') && !types.has('Toc')) return undefined
  const duplicateSections = duplicates(anchors.section)
  if (duplicateSections.length > 0) {
    return 'render_ui: Section anchors must be unique. Give repeated Section titles distinct anchors, '
      + 'e.g. Section("Background", [...], "background-1") and Section("Background", [...], "background-2"), '
      + `and pass the same anchors to Toc([...], [...]). Repeated: ${duplicateSections.join(', ')}.`
  }
  const duplicateToc = duplicates(anchors.toc)
  if (duplicateToc.length > 0) {
    return 'render_ui: Toc targets must be unique. Pass the optional anchors array to Toc so repeated labels point at distinct Sections. '
      + `Repeated: ${duplicateToc.join(', ')}.`
  }
  if (anchors.issues.length > 0) return `render_ui: ${anchors.issues.join(' ')}`
  const missing = anchors.toc.filter(anchor => !anchors.section.includes(anchor))
  if (missing.length > 0) {
    return 'render_ui: every Toc entry must target a Section anchor. '
      + `Missing Section target(s): ${missing.join(', ')}.`
  }
  return undefined
}

/** Block-level components: a stack of these needs vertical rhythm. */
const BLOCK_TYPES = new Set([
  'Title', 'Text', 'Markdown', 'Quote', 'Code', 'Table', 'Chart', 'List', 'Grid',
  'Card', 'Section', 'Carousel', 'Map', 'Image', 'SearchImage', 'Svg', 'Form',
  'Timer', 'Flashcard', 'Celebration', 'HtmlView', 'Col', 'Box',
])

/** Whether an AST child is a block-level component. */
function isBlock(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false
  const typeName = (node as { typeName?: unknown }).typeName
  return typeof typeName === 'string' && BLOCK_TYPES.has(typeName)
}

/** Read the element children from one AST props record. */
function childrenOf(props: unknown): unknown[] {
  if (props === null || typeof props !== 'object') return []
  const children = (props as { children?: unknown }).children
  return Array.isArray(children) ? children : []
}

/**
 * Find layout/spacing mistakes the renderer should not have to absorb.
 *
 * These are warnings, not fatal: the renderer owns normal block rhythm, and a
 * model that follows the injected layout contract should not hit them. They
 * still give the model a chance to remove manual gaps, blank spacers and empty
 * containers before the page reaches the user.
 * @param root - the parsed program AST.
 * @returns unique model-readable warning strings.
 */
export function layoutWarnings(root: unknown): string[] {
  const warnings = new Set<string>()
  const walk = (node: unknown, parentType: string | undefined): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, parentType)
      return
    }
    if (node === null || typeof node !== 'object') return
    const record = node as { typeName?: unknown; props?: unknown }
    const typeName = typeof record.typeName === 'string' ? record.typeName : undefined
    const children = childrenOf(record.props)
    if (typeName === 'Col' && parentType === undefined) {
      const gap = (record.props as { gap?: unknown } | null)?.gap
      if (gap !== undefined && gap !== null) {
        warnings.add('The page root Col should omit `gap`: the renderer applies the page rhythm, and an explicit gap overrides or doubles it.')
      }
    }
    if (typeName === 'Spacer' && parentType !== 'Row') {
      warnings.add('`Spacer()` outside a `Row` does not create vertical space; remove it and let the flow rhythm space the blocks.')
    }
    if (typeName === 'Section' && children.length === 0) {
      warnings.add('A `Section` with no children renders as an empty block; add its prose or remove the Section.')
    }
    if (typeName === 'Text' || typeName === 'Markdown') {
      const text = (record.props as { text?: unknown } | null)?.text
      if (typeof text === 'string' && text.trim() === '') {
        warnings.add(`An empty \`${typeName}("")\` renders as blank space; remove it.`)
      }
    }
    if ((typeName === 'Col' || typeName === 'Box') && children.filter(isBlock).length > 1) {
      const gap = (record.props as { gap?: unknown } | null)?.gap
      if (gap === 0) {
        warnings.add('A `Col`/`Box` with `gap: 0` and several blocks removes the vertical rhythm; omit `gap` so the flow spaces them.')
      }
    }
    for (const child of children) walk(child, typeName)
  }
  walk(root, undefined)
  return [...warnings]
}
