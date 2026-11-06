/**
 * Block recognition for one render_ui program.
 *
 * A block is a direct child of the program's root `Col`: the root layout owns
 * the page rhythm, so its children are exactly the stable, top-level regions a
 * user can point at (title block, cards, tables, charts, sections, and the
 * small structural pieces Caption/Divider/Spacer/Toc/Title). Titles come from
 * the block's own `Title` component, a Section title, a Toc item list, or its
 * first text; nothing depends on screen coordinates.
 *
 * `wrapProgramForBlockEditing` rewrites the same program's root statement so
 * every block sits inside an internal `BlockSlot` component. The edit view
 * renders that wrapped program with the normal renderer, so selection outlines,
 * numbering and popovers attach to real DOM nodes without a second renderer or
 * a parallel layout.
 */
import { createParser, type ElementNode } from '@openuidev/lang-core'
import librarySpec from '../../vendor/spec.json' with { type: 'json' }
import type { ArtifactBlock, ArtifactBlockKind } from './artifact-edit.ts'

/** Component name of the internal edit-mode wrapper (never in the model catalog). */
export const BLOCK_SLOT_COMPONENT = 'BlockSlot'

/** Component names that make a block an interactive module. */
const INTERACTIVE_COMPONENTS = new Set([
  'Button', 'IconButton', 'Pressable', 'Input', 'TextArea', 'Select', 'SegmentedControl',
  'Slider', 'Checkbox', 'RadioGroup', 'DatePicker', 'Timer', 'Form', 'Flashcard', 'Celebration',
])

/** Components that draw rather than contain structured content. */
const DRAWING_COMPONENTS = new Set(['Svg', 'HtmlView', 'Path', 'Polyline', 'Polygon'])

/** Media components. */
const MEDIA_COMPONENTS = new Set(['Image', 'SearchImage', 'YouTube'])

/** Layout containers. */
const CONTAINER_COMPONENTS = new Set(['Col', 'Row', 'Box', 'Grid', 'Carousel', 'Popover'])

/** Chart-like components rendered by the library. */
const CHART_COMPONENTS = new Set(['Chart', 'Map', 'MapView'])

const parser = createParser((librarySpec as { schema: unknown }).schema as never, 'Col')

/** One immutable property value with insertion order removed. */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) out[key] = stableValue(record[key])
    return out
  }
  return value
}

/** Stable digest of the visible content and props of one node subtree. */
function nodeDigest(node: ElementNode): string {
  return JSON.stringify(stableValue(node))
}

/** Depth-first search for the first descendant with one component name. */
function findDescendant(node: ElementNode, names: ReadonlySet<string>): ElementNode | undefined {
  const children = Array.isArray(node.props.children)
    ? node.props.children.filter((child): child is ElementNode => isElement(child))
    : []
  for (const child of children) {
    if (names.has(child.typeName)) return child
    const nested = findDescendant(child, names)
    if (nested !== undefined) return nested
  }
  return undefined
}

function isElement(value: unknown): value is ElementNode {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'element'
}

/** First string prop among a preferred order, trimmed to a short label. */
function firstText(node: ElementNode): string | undefined {
  for (const key of ['text', 'title', 'label', 'children']) {
    const value = node.props[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim() !== '') return item.trim()
        if (isElement(item)) {
          const nested = firstText(item)
          if (nested !== undefined) return nested
        }
      }
    }
  }
  return undefined
}

/** Display title for one block, or undefined when nothing stable is available. */
function blockTitle(node: ElementNode): string | undefined {
  const title = findDescendant(node, new Set(['Title']))
  if (title !== undefined && typeof title.props.text === 'string' && title.props.text.trim() !== '') {
    return title.props.text.trim().slice(0, 120)
  }
  if ((node.typeName === 'Title' || node.typeName === 'Caption') && typeof node.props.text === 'string' && node.props.text.trim() !== '') {
    return node.props.text.trim().slice(0, 120)
  }
  if (node.typeName === 'Section' && typeof node.props.title === 'string' && node.props.title.trim() !== '') {
    return node.props.title.trim().slice(0, 120)
  }
  if (node.typeName === 'Toc' && Array.isArray(node.props.items)) {
    const items = node.props.items.filter((item): item is string => typeof item === 'string')
    if (items.length > 0) return items.slice(0, 3).join(' · ').slice(0, 120)
  }
  if (node.typeName === 'Table' && Array.isArray(node.props.columns)) {
    const columns = node.props.columns.filter((column): column is string => typeof column === 'string')
    if (columns.length > 0) return columns.join(' · ').slice(0, 120)
  }
  if (['Text', 'Markdown', 'List', 'Quote', 'Code', 'Math', 'Card', 'Col', 'Row', 'Box', 'Section', 'Chart'].includes(node.typeName)) {
    const text = firstText(node)
    if (text !== undefined) return text.slice(0, 80)
  }
  return undefined
}

/** Coarse block kind; interactivity wins because it changes the read-only warning. */
function blockKind(node: ElementNode): ArtifactBlockKind {
  if (findDescendant(node, INTERACTIVE_COMPONENTS) !== undefined || INTERACTIVE_COMPONENTS.has(node.typeName)) return 'interactive'
  const type = node.typeName
  if (type === 'Divider') return 'divider'
  if (type === 'Spacer') return 'spacer'
  if (type === 'Toc') return 'toc'
  if (type === 'Title') return 'heading'
  if (type === 'Caption') return 'caption'
  if (type === 'Section') return 'section'
  if (type === 'Card') return 'card'
  if (type === 'Table') return 'table'
  if (CHART_COMPONENTS.has(type)) return 'chart'
  if (DRAWING_COMPONENTS.has(type)) return 'drawing'
  if (MEDIA_COMPONENTS.has(type)) return 'media'
  if (CONTAINER_COMPONENTS.has(type)) return 'container'
  return 'content'
}

/** One recognized block together with the AST node it addresses. */
export interface ArtifactBlockNode {
  readonly block: ArtifactBlock
  readonly node: ElementNode
}

/** Recognition result for one program. */
export interface ArtifactBlockExtraction {
  /** Root component name; only `Col` is supported. */
  readonly rootType?: string
  /** Root children in source order; every element child is an editable block. */
  readonly rootChildCount: number
  /** Editable blocks in source order. */
  readonly blocks: readonly ArtifactBlock[]
  readonly nodes: readonly ArtifactBlockNode[]
  /** Why the program offers no blocks (for the edit entry hint). */
  readonly unsupported?: string
}

const EMPTY: ArtifactBlockExtraction = { rootChildCount: 0, blocks: [], nodes: [], unsupported: 'unparsed' }

/**
 * Recognize the editable blocks of one complete program.
 * @param program - the rendered OpenUI Lang program.
 * @returns root children and the editable blocks among them.
 */
export function extractArtifactBlocks(program: string): ArtifactBlockExtraction {
  if (program.trim() === '') return EMPTY
  let root: ElementNode | null = null
  try {
    const result = parser.parse(program)
    root = result.root
    if (root === null) return { ...EMPTY, unsupported: 'no_root' }
    if (result.meta.incomplete) return { ...EMPTY, unsupported: 'incomplete' }
    if ((result.meta.errors ?? []).some(error => error.severity !== 'warning')) return { ...EMPTY, unsupported: 'parse_error' }
  } catch {
    return { ...EMPTY, unsupported: 'parse_error' }
  }
  if (root.typeName !== 'Col') return { rootType: root.typeName, rootChildCount: 0, blocks: [], nodes: [], unsupported: 'root_not_col' }
  const children = Array.isArray(root.props.children) ? root.props.children.filter((child): child is ElementNode => isElement(child)) : []
  if (children.length === 0) return { rootType: root.typeName, rootChildCount: 0, blocks: [], nodes: [], unsupported: 'empty_root' }
  const blocks: ArtifactBlock[] = []
  const nodes: ArtifactBlockNode[] = []
  children.forEach((node, rootIndex) => {
    const originalIndex = blocks.length + 1
    const block: ArtifactBlock = {
      blockId: `b${originalIndex}`,
      nodePath: `root[${rootIndex}]`,
      originalIndex,
      rootIndex,
      componentType: node.typeName,
      kind: blockKind(node),
      ...node.statementId === undefined ? {} : { statementId: node.statementId },
      ...blockTitle(node) === undefined ? {} : { title: blockTitle(node) as string },
    }
    blocks.push(block)
    nodes.push({ block, node })
  })
  return {
    rootType: root.typeName,
    rootChildCount: children.length,
    blocks,
    nodes,
    ...blocks.length === 0 ? { unsupported: 'no_blocks' } : {},
  }
}

/** Scan a balanced delimiter starting at `open`, honouring double-quoted strings. */
function scanBalanced(source: string, open: number): number {
  const opener = source[open]
  const closer = opener === '(' ? ')' : opener === '[' ? ']' : '}'
  let depth = 0
  let quote = false
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === '"') quote = false
      continue
    }
    if (char === '"') { quote = true; continue }
    if (char === opener) depth += 1
    else if (char === closer) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/** Split a comma-separated argument list at top-level commas only. */
function splitTopLevel(source: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = false
  let start = 0
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === '"') quote = false
      continue
    }
    if (char === '"') { quote = true; continue }
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(source.slice(start, index).trim())
      start = index + 1
    }
  }
  const tail = source.slice(start).trim()
  if (tail !== '') parts.push(tail)
  return parts
}

/** The root statement and its top-level children expressions in source form. */
export interface RootLayoutSource {
  /** Index of the first character of the root statement. */
  readonly start: number
  /** Index just after the root statement (the closing parenthesis). */
  readonly end: number
  /** Component name used by the root statement. */
  readonly component: string
  /** Raw source of each direct child argument. */
  readonly children: readonly string[]
  /** Text between the children array and the closing parenthesis (e.g. `, 2`). */
  readonly tail: string
}

/**
 * Read the root layout statement in source form.
 * @param program - complete openui-lang program.
 * @returns the root call and its direct child expressions, or undefined.
 */
export function readRootLayout(program: string): RootLayoutSource | undefined {
  return findRootLayout(program)
}

/** Locate the root layout source; undefined when it is not a single layout call. */
function findRootLayout(program: string): RootLayoutSource | undefined {
  const match = /(^|\n)[ \t]*root[ \t]*=[ \t]*/.exec(program)
  if (match === null) return undefined
  const start = match.index + match[1].length
  let cursor = match.index + match[0].length
  const nameMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(program.slice(cursor))
  if (nameMatch === null) return undefined
  const component = nameMatch[0]
  cursor += component.length
  while (cursor < program.length && /\s/.test(program[cursor])) cursor += 1
  if (program[cursor] !== '(') return undefined
  const close = scanBalanced(program, cursor)
  if (close < 0) return undefined
  const argsStart = cursor + 1
  let arrayStart = argsStart
  while (arrayStart < close && /\s/.test(program[arrayStart])) arrayStart += 1
  if (program[arrayStart] !== '[') return undefined
  const arrayClose = scanBalanced(program, arrayStart)
  if (arrayClose < 0 || arrayClose > close) return undefined
  const childrenSource = program.slice(arrayStart + 1, arrayClose)
  const tail = program.slice(arrayClose + 1, close)
  return { start, end: close + 1, component, children: splitTopLevel(childrenSource), tail }
}

/**
 * Rewrite one program so each recognized block is wrapped in an internal
 * `BlockSlot` component. The original root layout and non-block children are
 * preserved verbatim, so the edit view keeps the page's real layout.
 * @param program - the rendered program.
 * @param extraction - the recognition result for that program.
 * @returns the wrapped program, or undefined when the shape is unsupported.
 */
export function wrapProgramForBlockEditing(
  program: string,
  extraction: ArtifactBlockExtraction,
  targetOrder?: readonly string[],
): string | undefined {
  if (extraction.blocks.length === 0) return undefined
  const root = findRootLayout(program)
  if (root === undefined || root.component !== 'Col') return undefined
  if (root.children.length !== extraction.rootChildCount) return undefined
  const byRootIndex = new Map(extraction.nodes.map(entry => [entry.block.rootIndex, entry.block]))
  const wrapperByBlockId = new Map<string, string>()
  for (const entry of extraction.nodes) {
    const expression = root.children[entry.block.rootIndex]
    if (expression === undefined) return undefined
    wrapperByBlockId.set(entry.block.blockId, `${BLOCK_SLOT_COMPONENT}("${entry.block.blockId}", ${entry.block.originalIndex}, [${expression}])`)
  }
  // Optional arrangement preview: block slots take the target order. An
  // invalid/partial order falls back to the page order.
  const validOrder = targetOrder !== undefined
    && targetOrder.length === extraction.blocks.length
    && new Set(targetOrder).size === targetOrder.length
    && targetOrder.every(id => wrapperByBlockId.has(id))
  const orderedWrappers = validOrder ? targetOrder.map(id => wrapperByBlockId.get(id) as string) : []
  let cursor = 0
  const children = root.children.map((expression, rootIndex) => {
    if (!byRootIndex.has(rootIndex)) return expression
    if (!validOrder) return wrapperByBlockId.get((byRootIndex.get(rootIndex) as ArtifactBlock).blockId) as string
    const next = orderedWrappers[cursor]
    cursor += 1
    return next ?? expression
  })
  const rebuilt = `root = ${root.component}([${children.join(', ')}]${root.tail})`
  return `${program.slice(0, root.start)}${rebuilt}${program.slice(root.end)}`
}

/**
 * Verify that the edit targets exist in the base program.
 * @param extraction - recognition of the base program the user edited.
 * @param edits - requested block edits.
 * @returns the first problem label, or undefined when every reference resolves.
 */
export function verifyEditTargets(
  extraction: ArtifactBlockExtraction,
  edits: readonly { blockId: string; nodePath: string; originalIndex: number; componentType: string; title?: string }[],
): string | undefined {
  for (const edit of edits) {
    const entry = extraction.nodes.find(candidate => candidate.block.blockId === edit.blockId)
    if (entry === undefined) return `unknown_block:${edit.blockId}`
    const block = entry.block
    if (block.nodePath !== edit.nodePath) return `node_path_mismatch:${edit.blockId}`
    if (block.originalIndex !== edit.originalIndex) return `original_index_mismatch:${edit.blockId}`
    if (block.componentType !== edit.componentType) return `component_type_mismatch:${edit.blockId}`
    if (block.title !== edit.title) return `title_mismatch:${edit.blockId}`
  }
  return undefined
}

/** One block's preservation signature, keyed by its base block identity. */
interface PreservationEntry {
  readonly key: string
  readonly label: string
  readonly digest: string
}

/** Base identity used to detect whether one block survived an edit. */
function preservationEntry(entry: ArtifactBlockNode): PreservationEntry {
  const { block, node } = entry
  return {
    key: block.statementId ?? `${block.componentType}:${block.title ?? block.originalIndex}`,
    label: block.title ?? `${block.componentType} #${block.originalIndex}`,
    digest: nodeDigest(node),
  }
}

/**
 * Report unselected blocks the update changed or dropped.
 *
 * Tests intentionally tolerate related edits (a table that must follow an
 * edited selector); the findings are warnings returned to the model, not fatal
 * rejections. The edited blocks are excluded because changing them is the goal.
 * @param baseProgram - program the user was looking at.
 * @param updatedProgram - program the model returned.
 * @param editedBlockIds - blocks the user explicitly asked to change.
 * @returns model-readable warning lines.
 */
export function artifactEditWarnings(baseProgram: string, updatedProgram: string, editedBlockIds: readonly string[]): string[] {
  const base = extractArtifactBlocks(baseProgram)
  const updated = extractArtifactBlocks(updatedProgram)
  if (base.blocks.length === 0 || updated.blocks.length === 0) return []
  const edited = new Set(editedBlockIds)
  const updatedByKey = new Map<string, PreservationEntry>()
  for (const entry of updated.nodes) updatedByKey.set(preservationEntry(entry).key, preservationEntry(entry))
  const warnings: string[] = []
  for (const entry of base.nodes) {
    if (edited.has(entry.block.blockId)) continue
    const before = preservationEntry(entry)
    const after = updatedByKey.get(before.key)
    if (after === undefined) {
      warnings.push(`Unselected block ${JSON.stringify(before.label)} is missing from the updated program; keep it unless the user asked to remove it.`)
      continue
    }
    if (after.digest !== before.digest) {
      warnings.push(`Unselected block ${JSON.stringify(before.label)} changed; keep unselected blocks unchanged unless the edit requires it.`)
    }
  }
  return warnings.slice(0, 6)
}

/**
 * Map the top-level blocks of an updated program back to the base revision's
 * block identities. Statement names are the strongest signal, then the block
 * title (plus component type), then a unique title. A block that the model
 * renamed and re-titled beyond recognition yields no mapping.
 * @param base - recognition of the program the user was looking at.
 * @param updated - recognition of the model's updated program.
 * @returns base block id -> updated root child index, or undefined when the
 *   updated program does not keep exactly one recognizable block per base block.
 */
function matchUpdatedBlocks(base: ArtifactBlockExtraction, updated: ArtifactBlockExtraction): Map<string, number> | undefined {
  if (base.blocks.length === 0 || updated.blocks.length !== base.blocks.length) return undefined
  const used = new Set<number>()
  const mapping = new Map<string, number>()
  const candidates = (baseBlock: ArtifactBlock, allow: (candidate: ArtifactBlock) => boolean): number[] =>
    updated.blocks.filter(candidate => !used.has(candidate.rootIndex) && allow(candidate)).map(candidate => candidate.rootIndex)
  const take = (baseBlock: ArtifactBlock, roots: number[]): boolean => {
    if (roots.length !== 1) return false
    const root = roots[0]
    if (root === undefined || used.has(root)) return false
    used.add(root)
    mapping.set(baseBlock.blockId, root)
    return true
  }
  // Pass 1: exact statement-name identity.
  for (const block of base.blocks) {
    if (block.statementId === undefined) continue
    take(block, candidates(block, candidate => candidate.statementId === block.statementId))
  }
  // Pass 2: same title and component type (a renamed statement keeps its block).
  for (const block of base.blocks) {
    if (mapping.has(block.blockId) || block.title === undefined) continue
    take(block, candidates(block, candidate => candidate.title === block.title && candidate.componentType === block.componentType))
  }
  // Pass 3: same unique title.
  for (const block of base.blocks) {
    if (mapping.has(block.blockId) || block.title === undefined) continue
    take(block, candidates(block, candidate => candidate.title === block.title))
  }
  // Pass 4: untitled structural pieces (Divider/Spacer/...): match the remaining
  // blocks of one component type in page order when their counts agree.
  for (const type of new Set(base.blocks.filter(block => !mapping.has(block.blockId) && block.title === undefined && block.statementId === undefined).map(block => block.componentType))) {
    const baseBlocks = base.blocks.filter(block => !mapping.has(block.blockId) && block.title === undefined && block.statementId === undefined && block.componentType === type)
    const updatedBlocks = updated.blocks.filter(candidate => !used.has(candidate.rootIndex) && candidate.componentType === type)
    if (baseBlocks.length === 0 || baseBlocks.length !== updatedBlocks.length) continue
    baseBlocks.forEach((block, index) => take(block, [updatedBlocks[index]?.rootIndex as number].filter(root => root !== undefined)))
  }
  if (mapping.size !== base.blocks.length) return undefined
  return mapping
}

/**
 * Deterministically reorder the root `Col` children of an updated program to a
 * target order expressed in base-revision block ids.
 *
 * The model only needs to keep each top-level block recognizable (its statement
 * name or title); the Host owns the mechanical reordering so a reorder request
 * cannot silently produce a wrong page structure.
 *
 * @param program - the model's updated complete program.
 * @param targetOrder - target order of the base revision's block ids.
 * @param base - block recognition of the base program the user edited.
 * @returns the reordered program, or undefined when the blocks cannot be matched one-to-one.
 */
export function reorderProgramToTargetOrder(
  program: string,
  targetOrder: readonly string[],
  base: ArtifactBlockExtraction,
): string | undefined {
  const updated = extractArtifactBlocks(program)
  if (updated.unsupported !== undefined) return undefined
  const mapping = matchUpdatedBlocks(base, updated)
  if (mapping === undefined) return undefined
  if (targetOrder.length !== base.blocks.length) return undefined
  if (new Set(targetOrder).size !== targetOrder.length) return undefined
  for (const id of targetOrder) if (!mapping.has(id)) return undefined
  const root = findRootLayout(program)
  if (root === undefined || root.component !== 'Col' || root.children.length !== updated.rootChildCount) return undefined
  // The slot positions of editable blocks among the root children, in page order.
  const blockRootIndices = updated.blocks.map(block => block.rootIndex).sort((left, right) => left - right)
  const blockRootSet = new Set(blockRootIndices)
  const reordered = targetOrder.map(id => root.children[mapping.get(id) as number])
  if (reordered.some(expression => expression === undefined)) return undefined
  let cursor = 0
  const children = root.children.map((expression, index) => {
    if (!blockRootSet.has(index)) return expression
    const next = reordered[cursor]
    cursor += 1
    return next ?? expression
  })
  const rebuilt = `root = ${root.component}([${children.join(', ')}]${root.tail})`
  return `${program.slice(0, root.start)}${rebuilt}${program.slice(root.end)}`
}
