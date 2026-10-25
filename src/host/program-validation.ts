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
  section: string[]
  /** Effective Toc targets in display order. */
  toc: string[]
  /** Structural problems that are not duplicate targets. */
  issues: string[]
  /** A Section sits in an unresolved expression (an `@Each` template): its anchor cannot be known statically. */
  dynamicSection: boolean
  /** A Toc sits in an unresolved expression: its targets cannot be known statically. */
  dynamicToc: boolean
}

/** A component call inside an unresolved expression (an `@Each` template): `{k:'Comp', name, args}`. */
function rawCompName(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const record = node as { k?: unknown; name?: unknown }
  return record.k === 'Comp' && typeof record.name === 'string' ? record.name : undefined
}

/** Read one raw positional argument, if it is an array of nodes. */
function rawChildren(args: unknown): unknown[] {
  if (!Array.isArray(args)) return []
  for (const arg of args) {
    if (Array.isArray(arg)) return arg
    if (arg !== null && typeof arg === 'object' && Array.isArray((arg as { els?: unknown }).els)) {
      return (arg as { els: unknown[] }).els
    }
  }
  return []
}

/** Read a raw positional string/number literal. */
function rawValue(args: unknown, index: number): unknown {
  if (!Array.isArray(args)) return undefined
  const arg = args[index]
  if (arg === null || typeof arg !== 'object') return undefined
  const record = arg as { k?: unknown; v?: unknown }
  return record.v
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
  // `@Each` templates are unresolved expression nodes; their component names
  // count as reachable so article validation sees dynamic Sections/Toc.
  const raw = rawCompName(node)
  if (raw !== undefined) types.add(raw)
  for (const value of Object.values(record)) collectComponentTypes(value, types)
}

/** Collect Section and Toc targets from a parsed article AST. */
export function collectArticleAnchors(node: unknown, anchors: ArticleAnchors): void {
  if (Array.isArray(node)) {
    for (const child of node) collectArticleAnchors(child, anchors)
    return
  }
  if (node === null || typeof node !== 'object') return
  const record = node as { typeName?: unknown; props?: unknown }
  const kind = typeof record.typeName === 'string' ? record.typeName : rawCompName(node)
  const props = record.props as { title?: unknown; anchor?: unknown; items?: unknown; anchors?: unknown } | undefined
  if (kind === 'Section') {
    if (props === undefined) {
      // A Section inside an @Each template resolves its title at render time.
      if (rawCompName(node) === 'Section') anchors.dynamicSection = true
    } else {
      const title = typeof props.title === 'string' ? props.title : undefined
      const anchor = typeof props.anchor === 'string' && props.anchor.trim() !== '' ? props.anchor : title
      if (anchor !== undefined) anchors.section.push(anchorSlug(anchor))
    }
  }
  if (kind === 'Toc') {
    if (props === undefined) {
      if (rawCompName(node) === 'Toc') anchors.dynamicToc = true
    } else {
      const items = Array.isArray(props.items) ? props.items : []
      const targets = Array.isArray(props.anchors) ? props.anchors : undefined
      if (targets !== undefined && targets.length !== items.length) {
        anchors.issues.push('Toc `anchors` must have the same length as `items`.')
      }
      for (const [index, item] of items.entries()) {
        const target = targets?.[index]
        if (typeof item === 'string') {
          anchors.toc.push(anchorSlug(typeof target === 'string' && target.trim() !== '' ? target : item))
        }
      }
    }
  }
  for (const value of Object.values(record)) collectArticleAnchors(value, anchors)
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
  // Sections/Toc inside an `@Each` resolve their titles at render time; their
  // targets cannot be matched statically, so only duplicate static ids fail.
  if (anchors.dynamicSection || anchors.dynamicToc) return undefined
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
  if (Array.isArray(children)) return children
  // The canonical single-expression form `Col(@Each(...), 1)` parses its one
  // positional argument to the expression node itself, not an array; treat it
  // as the single child instead of dropping it (otherwise template warnings
  // never fire for the most common list shape).
  return children === undefined || children === null ? [] : [children]
}

/** Whether one AST child is a `Row` element. */
function isRowElement(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false
  return (node as { typeName?: unknown }).typeName === 'Row'
}

/** Whether a raw component argument holds a photo anywhere below it. */
function containsPhoto(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(containsPhoto)
  if (node === null || typeof node !== 'object') return false
  const record = node as { typeName?: unknown; props?: unknown; args?: unknown }
  const kind = typeof record.typeName === 'string' ? record.typeName : rawCompName(record)
  if (kind === 'Image' || kind === 'SearchImage') return true
  // Walk every child-carrying property: element props, raw Comp args, and the
  // `{k:'Arr', els}` wrappers inside unresolved expressions.
  return Object.values(record).some(containsPhoto)
}

/** Static item count of a repeated `@Each` template, when the array is a literal. */
function eachStaticCount(args: unknown): number | undefined {
  if (!Array.isArray(args)) return undefined
  const list = args[0]
  if (list === null || typeof list !== 'object') return undefined
  const record = list as { k?: unknown; els?: unknown }
  return record.k === 'Arr' && Array.isArray(record.els) ? record.els.length : undefined
}

/** One repeated `Row` list in a column: its static row count (unknown = 3) and whether rows carry photos. */
function repeatedRowList(children: readonly unknown[]): { rows: number; photo: boolean } | undefined {
  for (const child of children) {
    if (child === null || typeof child !== 'object') continue
    const record = child as { k?: unknown; name?: unknown; args?: unknown }
    if (record.k !== 'Comp' || record.name !== 'Each' || !Array.isArray(record.args)) continue
    const template = record.args[2]
    if (template === null || typeof template !== 'object') continue
    const shape = template as { typeName?: unknown; name?: unknown }
    if (shape.typeName !== 'Row' && shape.name !== 'Row') continue
    const count = eachStaticCount(record.args)
    // The contract allows `gap: 1` for a two-item inner pair; a longer list is page rhythm.
    if (count !== undefined && count < 3) continue
    return { rows: count ?? 3, photo: containsPhoto(template) }
  }
  return undefined
}

/** Minimal positional props for an unresolved component call, for the layout checks below. */
function rawProps(name: string, args: unknown): { children?: unknown[]; gap?: unknown; direction?: unknown; text?: unknown; title?: unknown; align?: unknown } {
  const children = rawChildren(args)
  switch (name) {
    case 'Col':
    case 'Row':
      return { children, gap: rawValue(args, 1), align: rawValue(args, 2) }
    case 'Box':
      return { children, direction: rawValue(args, 1), gap: rawValue(args, 2) }
    case 'Card':
      return { children, gap: rawValue(args, 3) }
    case 'Section':
      return { children, title: rawValue(args, 0) }
    case 'Text':
    case 'Markdown':
      return { children: [], text: rawValue(args, 0) }
    case 'Each': {
      // The loop body is the third argument; the first is the data array.
      const template = Array.isArray(args) ? args[2] : undefined
      return { children: template === undefined ? [] : [template] }
    }
    default:
      return { children }
  }
}

/**
 * Find layout/spacing mistakes the renderer should not have to absorb.
 *
 * These are warnings, not fatal: the renderer owns normal block rhythm, and a
 * model that follows the injected layout contract should not hit them. They
 * still give the model a chance to remove manual gaps, blank spacers and empty
 * containers before the page reaches the user.
 * @param root - the parsed program AST.
 * @param options - page context; a free layout treats the page rhythm as advisory, so page-level gap advice is skipped.
 * @returns unique model-readable warning strings.
 */
export function layoutWarnings(root: unknown, options: { readonly free?: boolean } = {}): string[] {
  const warnings = new Set<string>()
  const walk = (node: unknown, parentType: string | undefined, parentProps?: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, parentType, parentProps)
      return
    }
    if (node === null || typeof node !== 'object') return
    const record = node as { typeName?: unknown; props?: unknown; k?: unknown; name?: unknown; args?: unknown }
    const rawName = rawCompName(node)
    const typeName = typeof record.typeName === 'string' ? record.typeName : rawName
    // `@Each` templates are unresolved calls; their positional props are read
    // so empty blocks, spacers and cramped stacks inside them are still seen.
    const props = record.props !== undefined ? record.props : rawName === undefined ? undefined : rawProps(rawName, record.args)
    const children = childrenOf(props)
    const gap = (props as { gap?: unknown } | undefined)?.gap
    const direction = (props as { direction?: unknown } | undefined)?.direction
    const parentRow = parentType === 'Row' || (parentType === 'Box' && (parentProps as { direction?: unknown } | undefined)?.direction === 'row')
    if (!options.free && typeName === 'Col' && parentType === undefined) {
      if (gap !== undefined && gap !== null) {
        warnings.add('The page root Col should omit `gap`: the renderer applies the page rhythm, and an explicit gap overrides or doubles it.')
      }
    }
    if (typeName === 'Spacer' && !parentRow) {
      warnings.add('`Spacer()` outside a `Row` does not create vertical space; remove it and let the flow rhythm space the blocks.')
    }
    if (typeName === 'Section' && children.length === 0) {
      warnings.add('A `Section` with no children renders as an empty block; add its prose or remove the Section.')
    }
    if (typeName === 'Text' || typeName === 'Markdown') {
      const text = (props as { text?: unknown } | undefined)?.text
      if (typeof text === 'string' && text.trim() === '') {
        warnings.add(`An empty \`${typeName}("")\` renders as blank space; remove it.`)
      }
    }
    if ((typeName === 'Col' || typeName === 'Box') && children.filter(isBlock).length > 1) {
      const row = direction === 'row'
      if (gap === 0 && !row) {
        warnings.add('A `Col`/`Box` with `gap: 0` and several blocks removes the vertical rhythm; omit `gap` so the flow spaces them.')
      }
    }
    // A stack of repeated rows is page rhythm, not an inner pair: 4px packs
    // photo rows together and makes one- and two-digit ranks drift. Compact
    // non-photo row stacks and two-item pairs are legitimate, so only a
    // repeated photo list (three or more rows) is flagged.
    const column = typeName === 'Col' || (typeName === 'Box' && direction !== 'row')
    if (column && gap === 1) {
      const repeated = repeatedRowList(children)
      const photoRows = repeated !== undefined
        ? (repeated.photo ? repeated.rows : 0)
        : children.filter(row => isRowElement(row) && containsPhoto(row)).length
      if (photoRows >= 3) {
        warnings.add('A list of rows with `gap: 1` packs them 4px apart: leave the `Col` gap unset so the page rhythm spaces them (12px), or use 2–3, and center-align a row whose photo is taller than its copy.')
      }
    }
    for (const child of children) walk(child, typeName, props)
  }
  walk(root, undefined)
  return [...warnings]
}
