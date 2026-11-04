/**
 * Block sub-program bundles for block-level Artifact editing (Phase 1).
 *
 * A bundle is the host-side slice handed to the model: the selected top-level
 * blocks' expressions, the frozen statements and state their expressions depend
 * on, and the page outline. `spliceBlockBundle` puts the model's mini program
 * back: each root child expression replaces exactly one selected block slot, new
 * helper statements are appended, and everything else — chrome, unselected
 * blocks, root layout arguments — keeps its original source.
 *
 * Pure data and string work over the OpenUI Lang parser; no React, DOM or Node
 * APIs, so both halves can import it through Node's type stripping.
 */
import { createParser, type ElementNode } from '@openuidev/lang-core'
import librarySpec from '../../vendor/spec.json' with { type: 'json' }
import { extractArtifactBlocks, readRootLayout } from './artifact-blocks.ts'

/** One selected top-level block, ready to be edited and spliced back. */
export interface BlockBundleBlock {
  readonly blockId: string
  readonly nodePath: string
  readonly originalIndex: number
  readonly componentType: string
  readonly title?: string
  /** Base statement name when the block is a named statement, e.g. `clockCard`. */
  readonly statementId?: string
  /** Block expression source; a bare statement reference resolves to its RHS expression. */
  readonly source: string
}

/** One read-only dependency statement the selected blocks may reference. */
export interface BlockBundleStatement {
  readonly name: string
  readonly source: string
}

/** One top-level block in the page outline. */
export interface BlockBundleOutlineEntry {
  readonly blockId: string
  readonly originalIndex: number
  readonly componentType: string
  readonly title?: string
}

/** Everything the model needs to rewrite the selected blocks without the full page. */
export interface BlockBundle {
  readonly blocks: BlockBundleBlock[]
  readonly frozenStatements: BlockBundleStatement[]
  readonly stateSources: string[]
  readonly outline: BlockBundleOutlineEntry[]
}

/** Splice verdict: the composed page, or a machine-readable problem. */
export type BlockSpliceResult =
  | { readonly ok: true; readonly program: string }
  | { readonly ok: false; readonly error: string }

const parser = createParser((librarySpec as { schema: unknown }).schema as never, 'Col')

const LITERAL_NAMES = new Set(['true', 'false', 'null'])

/** Keywords whose lowercase text is a literal, not an identifier reference. */
function isElement(value: unknown): value is ElementNode {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'element'
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Skip a double-quoted string starting at `open`; returns the index after the closing quote. */
function skipQuoted(source: string, open: number): number {
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\') index += 1
    else if (char === '"') return index + 1
  }
  return source.length
}

/** Split the top-level arguments of one `(...)` call starting at `open`. */
function splitArguments(source: string, open: number): string[] | undefined {
  const args: string[] = []
  let depth = 0
  let start = open + 1
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    if (char === '"') {
      index = skipQuoted(source, index) - 1
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1
      if (depth === 0) {
        const tail = source.slice(start, index).trim()
        if (tail !== '') args.push(tail)
        return args
      }
    } else if (char === ',' && depth === 1) {
      args.push(source.slice(start, index).trim())
      start = index + 1
    }
  }
  return undefined
}

/** One expression's variable references and its local `@Each` loop variables. */
interface ReferenceScan {
  readonly names: ReadonlySet<string>
  readonly eachVariables: ReadonlySet<string>
}

/** Conservative identifier scan: strings, components, calls and property names are not references. */
function scanReferences(source: string): ReferenceScan {
  const names = new Set<string>()
  const eachVariables = new Set<string>()
  let index = 0
  let previous = ''
  while (index < source.length) {
    const char = source[index]
    if (char === '"') {
      index = skipQuoted(source, index)
      previous = '"'
      continue
    }
    if (char === '@') {
      index += 1
      const start = index
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1
      if (source.slice(start, index) === 'Each') {
        let cursor = index
        while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
        if (source[cursor] === '(') {
          const args = splitArguments(source, cursor)
          const variable = args?.[1] === undefined ? null : /^"([A-Za-z_$][A-Za-z0-9_$]*)"$/.exec(args[1].trim())
          if (variable !== null) eachVariables.add(variable[1])
          // Resume inside the call so refs in the template are scanned normally.
          index = cursor
        }
      }
      previous = '@'
      continue
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index
      index += 1
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1
      const token = source.slice(start, index)
      let cursor = index
      while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
      // An object-literal key (`{label: "x"}`) is not a statement reference.
      const objectKey = source[cursor] === ':' && (previous === '{' || previous === ',')
      if (previous === '.' || objectKey) {
        // Property access or object key; neither names a statement.
      } else if (token.startsWith('$')) names.add(token)
      else if (/^[a-z]/.test(token) && !LITERAL_NAMES.has(token)) names.add(token)
      previous = 'x'
      continue
    }
    if (!/\s/.test(char)) previous = char
    index += 1
  }
  return { names, eachVariables }
}

/** One line-level OpenUI Lang definition of a non-root name. */
interface Definition {
  readonly name: string
  readonly state: boolean
  readonly expression: string
  readonly source: string
}

/** Read the program's line-based `name = expression` / `$name = expression` definitions. */
function readDefinitions(program: string): Map<string, Definition> {
  const definitions = new Map<string, Definition>()
  for (const raw of program.split('\n')) {
    const line = raw.trim()
    const match = /^(\$?[A-Za-z_][A-Za-z0-9_$]*)\s*=\s*(.+)$/.exec(line)
    if (match === null || match[1] === 'root') continue
    definitions.set(match[1], { name: match[1], state: match[1].startsWith('$'), expression: match[2].trim(), source: line })
  }
  return definitions
}

/** One bare identifier expression, e.g. the `clockCard` child of a root layout. */
function bareReference(expression: string): string | undefined {
  return /^([A-Za-z_][A-Za-z0-9_$]*)$/.exec(expression.trim())?.[1]
}

/** The expression a block contributes to a fragment; named blocks resolve to their RHS. */
function resolveBlockSource(expression: string, definitions: ReadonlyMap<string, Definition>): string {
  const reference = bareReference(expression)
  if (reference === undefined) return expression.trim()
  const definition = definitions.get(reference)
  return definition === undefined || definition.state ? expression.trim() : definition.expression
}

/**
 * Slice the selected top-level blocks plus their frozen dependency context.
 * @param program - complete OpenUI Lang program.
 * @param blockIds - selected top-level block ids, in the caller's order.
 * @returns the bundle, or undefined when the program or ids are not sliceable.
 */
export function extractBlockBundle(program: string, blockIds: readonly string[]): BlockBundle | undefined {
  if (blockIds.length === 0) return undefined
  const extraction = extractArtifactBlocks(program)
  const root = readRootLayout(program)
  if (extraction.unsupported !== undefined || extraction.blocks.length === 0) return undefined
  if (root === undefined || root.component !== 'Col' || root.children.length !== extraction.rootChildCount) return undefined
  const definitions = readDefinitions(program)
  const selected = new Set<string>()
  const replacedStatements = new Set<string>()
  const blocks: BlockBundleBlock[] = []
  for (const blockId of blockIds) {
    const block = extraction.blocks.find(candidate => candidate.blockId === blockId)
    if (block === undefined || selected.has(blockId)) return undefined
    selected.add(blockId)
    const expression = root.children[block.rootIndex]
    if (expression === undefined || expression.trim() === '') return undefined
    const reference = bareReference(expression)
    if (reference !== undefined && definitions.get(reference)?.state !== true) replacedStatements.add(reference)
    blocks.push({
      blockId: block.blockId,
      nodePath: block.nodePath,
      originalIndex: block.originalIndex,
      componentType: block.componentType,
      ...block.title === undefined ? {} : { title: block.title },
      ...block.statementId === undefined ? {} : { statementId: block.statementId },
      source: resolveBlockSource(expression, definitions),
    })
  }
  // Transitive closure over the selected expressions; selected blocks are replaced, not frozen.
  const frozenNames = new Set<string>()
  const stateNames = new Set<string>()
  const pending = blocks.map(block => block.source)
  while (pending.length > 0) {
    const scan = scanReferences(pending.pop() as string)
    for (const name of scan.names) {
      const definition = definitions.get(name)
      if (definition === undefined) continue
      if (definition.state) {
        if (stateNames.has(name)) continue
        stateNames.add(name)
      } else {
        if (replacedStatements.has(name) || frozenNames.has(name)) continue
        frozenNames.add(name)
      }
      pending.push(definition.expression)
    }
  }
  return {
    blocks,
    frozenStatements: [...definitions.values()]
      .filter(definition => !definition.state && frozenNames.has(definition.name))
      .map(definition => ({ name: definition.name, source: definition.source })),
    stateSources: [...definitions.values()]
      .filter(definition => definition.state && stateNames.has(definition.name))
      .map(definition => definition.source),
    outline: extraction.blocks.map(block => ({
      blockId: block.blockId,
      originalIndex: block.originalIndex,
      componentType: block.componentType,
      ...block.title === undefined ? {} : { title: block.title },
    })),
  }
}

/**
 * Replace the selected root children with a mini program's expressions.
 *
 * The mini program must keep the page valid: one root `Col` child per selected
 * block, in `blockIds` order, and only new helper statements. All other root
 * children, the root call's remaining arguments and every base statement stay
 * untouched.
 * @param baseProgram - complete page program the edit is based on.
 * @param blockIds - selected top-level block ids, in fragment child order.
 * @param fragmentProgram - the model's mini program for those blocks.
 * @returns the composed page program, or a machine-readable problem.
 */
export function spliceBlockBundle(baseProgram: string, blockIds: readonly string[], fragmentProgram: string): BlockSpliceResult {
  const fail = (error: string): BlockSpliceResult => ({ ok: false, error })
  if (blockIds.length === 0) return fail('no_blocks')
  if (new Set(blockIds).size !== blockIds.length) return fail('duplicate_block_ids')
  const baseExtraction = extractArtifactBlocks(baseProgram)
  if (baseExtraction.unsupported !== undefined) return fail(`base_program_not_editable:${baseExtraction.unsupported}`)
  const baseRoot = readRootLayout(baseProgram)
  if (baseRoot === undefined || baseRoot.component !== 'Col') return fail('base_root_not_col')
  if (baseRoot.children.length !== baseExtraction.rootChildCount) return fail('base_layout_mismatch')
  const blockByIe = new Map(baseExtraction.blocks.map(block => [block.blockId, block]))
  const slots = blockIds.map(blockId => blockByIe.get(blockId))
  for (let index = 0; index < slots.length; index += 1) if (slots[index] === undefined) return fail(`unknown_block:${blockIds[index]}`)

  let parsed: ReturnType<typeof parser.parse>
  try {
    parsed = parser.parse(fragmentProgram)
  } catch (cause) {
    return fail(`fragment_parse_error:${errorMessage(cause)}`)
  }
  if (parsed.root === null) return fail('fragment_no_root')
  if (parsed.meta.incomplete === true) return fail('fragment_incomplete')
  const parseErrors = (parsed.meta.errors ?? []).filter(error => (error as { severity?: string }).severity !== 'warning')
  if (parseErrors.length > 0) return fail(`fragment_parse_error:${(parseErrors[0] as { message?: string }).message ?? parseErrors[0]}`)
  if (parsed.root.typeName !== 'Col') return fail('fragment_root_not_col')
  const parsedChildren = Array.isArray(parsed.root.props.children) ? parsed.root.props.children.filter(isElement) : []
  if (parsedChildren.length !== blockIds.length) return fail(`fragment_block_count_mismatch:expected ${blockIds.length} got ${parsedChildren.length}`)
  const fragmentRoot = readRootLayout(fragmentProgram)
  if (fragmentRoot === undefined || fragmentRoot.component !== 'Col') return fail('fragment_root_not_col')
  if (fragmentRoot.children.length !== blockIds.length || fragmentRoot.children.length !== parsedChildren.length) {
    return fail(`fragment_block_count_mismatch:expected ${blockIds.length} got ${fragmentRoot.children.length}`)
  }
  const fragmentChildren = fragmentRoot.children.map(child => child.trim())
  if (fragmentChildren.some(child => child === '')) return fail('fragment_empty_block')

  const baseDefinitions = readDefinitions(baseProgram)
  const fragmentDefinitions = readDefinitions(fragmentProgram)
  const helperLines: string[] = []
  for (const definition of fragmentDefinitions.values()) {
    if (baseDefinitions.has(definition.name)) return fail(`helper_name_collision:${definition.name}`)
    helperLines.push(definition.source)
  }

  // No fragment expression may reference a name that will not exist in the composed page.
  const allowed = new Set<string>(baseDefinitions.keys())
  for (const definition of fragmentDefinitions.values()) allowed.add(definition.name)
  for (const literal of LITERAL_NAMES) allowed.add(literal)
  const scans = [
    ...fragmentChildren.map(source => scanReferences(source)),
    ...[...fragmentDefinitions.values()].map(definition => scanReferences(definition.expression)),
  ]
  const eachVariables = new Set<string>()
  for (const scan of scans) for (const name of scan.eachVariables) eachVariables.add(name)
  for (const scan of scans) {
    for (const name of scan.names) {
      if (allowed.has(name) || eachVariables.has(name)) continue
      return fail(`undefined_identifier:${name}`)
    }
  }

  const children = [...baseRoot.children]
  slots.forEach((block, index) => {
    if (block === undefined) return
    children[block.rootIndex] = fragmentChildren[index] as string
  })
  const rebuilt = `root = ${baseRoot.component}([${children.join(', ')}]${baseRoot.tail})`
  let composed = `${baseProgram.slice(0, baseRoot.start)}${rebuilt}${baseProgram.slice(baseRoot.end)}`
  if (helperLines.length > 0) composed = `${composed.replace(/\s+$/, '')}\n${helperLines.join('\n')}\n`
  if (!composed.endsWith('\n')) composed += '\n'

  const composedExtraction = extractArtifactBlocks(composed)
  if (composedExtraction.unsupported !== undefined) return fail(`composed_program_invalid:${composedExtraction.unsupported}`)
  if (composedExtraction.blocks.length !== baseExtraction.blocks.length) {
    return fail(`composed_block_count_mismatch:expected ${baseExtraction.blocks.length} got ${composedExtraction.blocks.length}`)
  }
  return { ok: true, program: composed }
}
