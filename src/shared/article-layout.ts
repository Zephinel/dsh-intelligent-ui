/**
 * Shared Article-layout validation.
 *
 * The Host uses this to reject an Article style switch and render_ui uses the
 * same predicate; the client can therefore disable an Article target before the
 * user selects it instead of showing a note and failing on Apply. Keeping one
 * implementation means the preview/disabled state and the Host decision cannot
 * drift apart.
 */
import { createParser } from '@openuidev/lang-core'
import librarySpec from '../../vendor/spec.json' with { type: 'json' }
import { anchorSlug } from './anchor.ts'

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
export function rawCompName(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const record = node as { k?: unknown; name?: unknown }
  return record.k === 'Comp' && typeof record.name === 'string' ? record.name : undefined
}

/** Read one raw positional argument, if it is an array of nodes. */
export function rawChildren(args: unknown): unknown[] {
  if (!Array.isArray(args)) return []
  for (const arg of args) {
    if (Array.isArray(arg)) return arg
    if (arg !== null && typeof arg === 'object' && Array.isArray((arg as { els?: unknown }).els)) {
      return (arg as { els: unknown[] }).els
    }
  }
  return []
}

/** Read one raw positional string/number literal. */
export function rawValue(args: unknown, index: number): unknown {
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

/** The same OpenUI parser instance the Host uses for article inspection. */
const parser = createParser((librarySpec as { readonly schema: unknown }).schema as never, 'Col')

/**
 * Describe why one program cannot be shown in the article layout, or undefined
 * when it can.
 *
 * This is the exact predicate render_ui uses: an article page needs a Toc and
 * at least one Section, and Section/Toc anchors must validate. The returned
 * string is the model-readable message render_ui throws (including its
 * `render_ui: ` prefix), so the Host behavior stays byte-identical.
 * @param program - complete candidate program.
 * @returns the first article problem, or undefined for a displayable article page.
 */
export function describeArticleLayoutProblem(program: string): string | undefined {
  let root: unknown
  try {
    root = parser.parse(program).root
  } catch {
    return 'render_ui: the article style needs a complete program with a Toc and at least one Section.'
  }
  const types = new Set<string>()
  collectComponentTypes(root, types)
  if (!types.has('Toc') || !types.has('Section')) {
    return 'render_ui: the article style needs a Toc and at least one Section. '
      + 'Use Toc(["..."]) and Section("...", [Markdown("...")]) for every major part; a plain Markdown program is the card style.'
  }
  const anchors: ArticleAnchors = { section: [], toc: [], issues: [], dynamicSection: false, dynamicToc: false }
  collectArticleAnchors(root, anchors)
  return articleAnchorError(anchors, types)
}
