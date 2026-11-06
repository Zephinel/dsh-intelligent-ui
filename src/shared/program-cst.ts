/**
 * M4-0a structure engine: a source-level CST for nested Artifact editing.
 *
 * The engine is deliberately a *proof* layer, not an editor: it parses one
 * OpenUI Lang program into statements/expressions with exact source ranges,
 * maps the vendor parser AST onto those ranges as a revision-scoped node tree
 * (deterministic `nodeId` + content digest), and performs a narrow, validated
 * set of source transformations. Every transformation is verified by reparsing
 * with the vendor parser, rebuilding the tree, rechecking references/scope/depth
 * limits, and byte-comparing every untouched subtree against the base program.
 *
 * Supported expression subset (everything else is opaque and rejected for
 * structural operations): component calls `Name(...)`, arrays `[...]`, objects
 * `{key: value}`, string/number/boolean/null literals, identifier and `$state`
 * references, parenthesised expressions, and `@Each(array, "name", expr)` as a
 * call. Ternaries, binary operators and member access are opaque ranges.
 *
 * Pure string/parser work: no React, DOM, Node or UI imports.
 */
import { createParser, type ElementNode } from '@openuidev/lang-core'
import librarySpec from '../../vendor/spec.json' with { type: 'json' }

export const MAX_CST_PROGRAM_CHARS = 200_000
export const MAX_CST_DEPTH = 4
export const MAX_CST_NODES = 60
export const MAX_CST_OPERATIONS = 20

/** Containers whose children become editable tree nodes by default. */
export const DEFAULT_CONTAINER_TYPES = ['Col', 'Card'] as const

/**
 * Which positional argument of each container holds its children array.
 * Col/Row/Box/Grid/Card/Carousel take children first; Section(title, children,
 * anchor) takes them second. Components without an entry default to argument 0.
 */
const CONTAINER_CHILDREN_ARG_INDEX: Readonly<Record<string, number>> = {
  Col: 0, Row: 0, Box: 0, Grid: 0, Card: 0, Carousel: 0, Section: 1,
}

const parser = createParser((librarySpec as { schema: unknown }).schema as never, 'Col')

/** Machine-readable failure code shared by parsing, tree building and transforms. */
export type CstErrorCode =
  | 'program_too_large'
  | 'unsupported_syntax'
  | 'duplicate_statement'
  | 'parse_error'
  | 'root_not_col'
  | 'unknown_reference'
  | 'unsupported_container'
  | 'unsupported_mapping'
  | 'unknown_node'
  | 'cannot_edit_root'
  | 'unsupported_opaque'
  | 'unsupported_scope'
  | 'shared_named_reference'
  | 'duplicate_anchor_unsupported'
  | 'incompatible_container'
  | 'unknown_slot'
  | 'invalid_order'
  | 'invalid_index'
  | 'invalid_source'
  | 'invalid_operation'
  | 'move_into_self'
  | 'unsupported_move_nested'
  | 'too_deep'
  | 'too_many_nodes'
  | 'too_many_operations'
  | 'operation_conflict'
  | 'digest_mismatch'
  | 'revision_mismatch'
  | 'unchanged_violation'

/** One human- and machine-readable problem. Messages never echo whole pages. */
export interface CstProblem {
  readonly code: CstErrorCode
  readonly message: string
}

/** One half-open source range in the program string. */
export interface CstRange {
  readonly start: number
  readonly end: number
}

/** One parsed expression node of the supported subset. */
export interface CstExpr {
  readonly kind: 'call' | 'array' | 'object' | 'string' | 'number' | 'literal' | 'ref' | 'paren' | 'opaque'
  readonly range: CstRange
  /** Call name as written, including the `@` prefix for `@Each`. */
  readonly name?: string
  /** Call arguments, array items or paren inner expression, in source order. */
  readonly items?: readonly CstExpr[]
  /** Object literal entries. */
  readonly entries?: readonly { readonly key: string; readonly keyRange: CstRange; readonly value: CstExpr }[]
  /** Reference identifier (also used for string bodies without quotes). */
  readonly identifier?: string
  /** Literal token text. */
  readonly text?: string
  /** Why the expression is opaque to structural transforms. */
  readonly problem?: CstProblem
}

/** One parsed top-level statement line. */
export interface CstStatement {
  readonly name: string
  readonly state: boolean
  readonly range: CstRange
  readonly nameRange: CstRange
  readonly expr: CstExpr
  readonly source: string
}

/** Result of parsing one program into the supported statement/expression subset. */
export interface ProgramCst {
  readonly program: string
  readonly statements: readonly CstStatement[]
  readonly root?: CstStatement
  /** Whole-program parse problem; per-expression opacity lives on the expr. */
  readonly problem?: CstProblem
}

/** Options for tree building. */
export interface CstTreeOptions {
  readonly containerTypes?: readonly string[]
  readonly baseRevisionId?: string
  readonly maxDepth?: number
  readonly maxNodes?: number
}

/** Where one node sits in its parent. */
export interface ArtifactTreeNode {
  readonly nodeId: string
  readonly parentNodeId?: string
  readonly depth: number
  readonly nodePath: string
  readonly slotKey?: 'children' | 'template'
  readonly childIndex: number
  readonly componentType: string
  readonly title?: string
  /** Parsed component props, for deterministic property edits and UI prefill. */
  readonly props: Readonly<Record<string, unknown>>
  readonly statementId?: string
  /** Slot expression range: what a replace would overwrite (e.g. the `outerCard` ref). */
  readonly range: CstRange
  /** Slot expression source (`outerCard` for a named child, the inline text otherwise). */
  readonly source: string
  /** Range of the definition/content this node renders (the named statement's expression). */
  readonly contentRange: CstRange
  readonly contentSource: string
  /** Stable content digest of `contentSource` (FNV-1a, 8 hex chars). */
  readonly digest: string
  /** Inner range of the children array (between `[` and `]`), for container nodes. */
  readonly slotRange?: CstRange
  readonly children: readonly string[]
  readonly childSlots: Readonly<Record<string, readonly string[]>>
  readonly editable: boolean
  readonly scoped: boolean
  readonly shared: boolean
  readonly opaque: boolean
  readonly scope?: { readonly eachVariable: string; readonly eachNodeId: string }
  readonly problem?: CstProblem
}

/** One outline row for UI/panel consumption. */
export interface ArtifactTreeOutlineEntry {
  readonly nodeId: string
  readonly parentNodeId?: string
  readonly depth: number
  readonly nodePath: string
  readonly componentType: string
  readonly title?: string
  readonly childIndex: number
  readonly editable: boolean
}

/** Revision-scoped node tree for one program. */
export interface ArtifactTree {
  readonly program: string
  readonly baseRevisionId?: string
  readonly rootNodeId: string
  readonly nodes: ReadonlyMap<string, ArtifactTreeNode>
  /** Deterministic DFS pre-order of node ids. */
  readonly order: readonly string[]
  readonly outline: readonly ArtifactTreeOutlineEntry[]
  readonly problems: readonly (CstProblem & { readonly nodeId?: string })[]
  readonly limitsExceeded?: CstErrorCode
  readonly stats: { readonly nodeCount: number; readonly maxDepth: number }
}

/** One symbol-table reference found in the program. */
export interface CstReference {
  readonly name: string
  readonly range: CstRange
  readonly scope?: string
}

/** Symbol information for one program. */
export interface CstSymbols {
  readonly declared: readonly string[]
  readonly states: readonly string[]
  readonly refs: readonly CstReference[]
  readonly eachLocals: readonly { readonly name: string; readonly range: CstRange; readonly scope: string }[]
}

/** One transform applied to the base program. */
export interface CstTouchedNode {
  readonly nodeId: string
  readonly op: string
  readonly nodePath: string
  readonly before: string
  readonly after: string
}

/** One base node whose source survived the transform byte-for-byte. */
export interface CstUnchangedNode {
  readonly nodeId: string
  readonly digest: string
  readonly source: string
}

export interface CstOperationSuccess {
  readonly ok: true
  readonly program: string
  readonly tree: ArtifactTree
  readonly touched: readonly CstTouchedNode[]
  readonly unchanged: readonly CstUnchangedNode[]
  /** Compact summary of the edits (ranges in the base program). */
  readonly edits: readonly { readonly start: number; readonly end: number; readonly op: string; readonly summary: string }[]
}

export type CstFailure = { readonly ok: false } & CstProblem
export type CstOperationResult = CstOperationSuccess | CstFailure

export interface CstOperationOptions extends CstTreeOptions {
  /** Base tree binding revision-scoped nodeIds/digests; when given the program must match. */
  readonly tree?: ArtifactTree
}

/** One declarative structure operation of a batch. */
export type CstOperation =
  | { readonly op: 'replace'; readonly nodeId: string; readonly source: string }
  | { readonly op: 'reorder'; readonly parentNodeId: string; readonly slotKey?: string; readonly order: readonly string[] }
  | { readonly op: 'remove'; readonly nodeId: string }
  | {
    readonly op: 'insert'
    readonly parentNodeId: string
    readonly slotKey?: string
    readonly index: number
    readonly source: string
  }
  | {
    readonly op: 'duplicate'
    readonly nodeId: string
    readonly targetParentId: string
    readonly slotKey?: string
    readonly index: number
  }
  | {
    readonly op: 'move'
    readonly nodeId: string
    readonly targetParentId: string
    readonly slotKey?: string
    readonly index: number
  }

function failure(code: CstErrorCode, message: string): CstFailure {
  return { ok: false, code, message }
}

function problem(code: CstErrorCode, message: string): CstProblem {
  return { code, message }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Stable FNV-1a digest of one source slice, as 8 lowercase hex characters. */
export function digestSource(source: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// Low-level scanning helpers (string-aware, absolute program offsets)
// ---------------------------------------------------------------------------

function skipWhitespace(source: string, start: number, end: number): number {
  let index = start
  while (index < end && /\s/.test(source[index] as string)) index += 1
  return index
}

/** Index just after the closing double quote, or -1 for an unterminated string. */
function stringEnd(source: string, open: number, end: number): number {
  for (let index = open + 1; index < end; index += 1) {
    const char = source[index]
    if (char === '\\') index += 1
    else if (char === '"') return index + 1
  }
  return -1
}

/** Index of the delimiter matching `open` (`(`/`[`/`{`), or -1. */
function matchingDelimiter(source: string, open: number, end: number): number {
  const openChar = source[open]
  const closeChar = openChar === '(' ? ')' : openChar === '[' ? ']' : '}'
  let depth = 0
  for (let index = open; index < end; index += 1) {
    const char = source[index]
    if (char === '"') {
      const close = stringEnd(source, index, end)
      if (close < 0) return -1
      index = close - 1
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1
      if (depth === 0) return char === closeChar ? index : -1
    }
  }
  return -1
}

/** Split a bracketed argument/item region at top-level commas. */
function splitTopLevel(source: string, start: number, end: number): CstRange[] {
  const ranges: CstRange[] = []
  let depth = 0
  let itemStart = start
  for (let index = start; index < end; index += 1) {
    const char = source[index]
    if (char === '"') {
      const close = stringEnd(source, index, end)
      if (close < 0) {
        ranges.push({ start: itemStart, end })
        return ranges
      }
      index = close - 1
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth -= 1
    else if (char === ',' && depth === 0) {
      ranges.push({ start: itemStart, end: index })
      itemStart = index + 1
    }
  }
  ranges.push({ start: itemStart, end })
  return ranges.filter(range => skipWhitespace(source, range.start, range.end) < range.end)
}

/** Split one object entry `key: value` at its top-level colon. */
function splitObjectEntry(source: string, start: number, end: number): { key: CstRange; value: CstRange } | undefined {
  let depth = 0
  for (let index = start; index < end; index += 1) {
    const char = source[index]
    if (char === '"') {
      const close = stringEnd(source, index, end)
      if (close < 0) return undefined
      index = close - 1
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth -= 1
    else if (char === ':' && depth === 0) {
      return { key: { start, end: index }, value: { start: index + 1, end } }
    }
  }
  return undefined
}

const IDENTIFIER_START = /[A-Za-z_$]/
const IDENTIFIER_BODY = /[A-Za-z0-9_$]/
const TRAILING_OPERATOR = /[?.+\-*/%<>=!&|]/
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function isOpaque(expr: CstExpr): boolean {
  return expr.kind === 'opaque' || expr.problem !== undefined
}

/** Whether the expression and every nested part stay inside the strict replacement subset. */
function fullySupported(expr: CstExpr): boolean {
  if (isOpaque(expr)) return false
  for (const item of expr.items ?? []) if (!fullySupported(item)) return false
  for (const entry of expr.entries ?? []) if (!fullySupported(entry.value)) return false
  return true
}

/** Parse one expression range of the supported subset; unsupported shapes are opaque. */
function scanExpression(program: string, range: CstRange): CstExpr {
  const start = skipWhitespace(program, range.start, range.end)
  const end = range.end
  if (start >= end) return { kind: 'opaque', range: { start, end }, problem: problem('unsupported_syntax', 'Empty expression.') }
  const opaque = (message = 'Unsupported expression syntax.'): CstExpr =>
    ({ kind: 'opaque', range: { start, end }, problem: problem('unsupported_syntax', message) })
  const trailingAfter = (cursor: number): boolean => skipWhitespace(program, cursor, end) < end
  const char = program[start] as string

  if (char === '"') {
    const close = stringEnd(program, start + 1, end + 1)
    if (close < 0 || close > end) return opaque('Unterminated string literal.')
    if (trailingAfter(close)) return opaque()
    return { kind: 'string', range: { start, end: close }, text: program.slice(start + 1, close - 1) }
  }

  if (char === '(') {
    const close = matchingDelimiter(program, start, end)
    if (close < 0 || trailingAfter(close + 1)) return opaque()
    return { kind: 'paren', range: { start, end: close + 1 }, items: [scanExpression(program, { start: start + 1, end: close })] }
  }

  if (char === '[') {
    const close = matchingDelimiter(program, start, end)
    if (close < 0 || trailingAfter(close + 1)) return opaque()
    return { kind: 'array', range: { start, end: close + 1 }, items: splitTopLevel(program, start + 1, close).map(item => scanExpression(program, item)) }
  }

  if (char === '{') {
    const close = matchingDelimiter(program, start, end)
    if (close < 0 || trailingAfter(close + 1)) return opaque()
    const entries: { key: string; keyRange: CstRange; value: CstExpr }[] = []
    for (const entryRange of splitTopLevel(program, start + 1, close)) {
      const entry = splitObjectEntry(program, entryRange.start, entryRange.end)
      if (entry === undefined) return opaque('Malformed object literal.')
      const keyStart = skipWhitespace(program, entry.key.start, entry.key.end)
      const keyEnd = skipWhitespace(program, entry.key.start, entry.key.end)
      const keySource = program.slice(keyStart, keyEnd)
      if (!IDENTIFIER_PATTERN.test(keySource) && !/^"[^"]*"$/.test(keySource)) return opaque('Unsupported object key.')
      const value = scanExpression(program, entry.value)
      entries.push({ key: keySource.startsWith('"') ? keySource.slice(1, -1) : keySource, keyRange: { start: keyStart, end: keyEnd }, value })
    }
    return { kind: 'object', range: { start, end: close + 1 }, entries }
  }

  if (char === '@') {
    let cursor = start + 1
    while (cursor < end && IDENTIFIER_BODY.test(program[cursor] as string)) cursor += 1
    const name = program.slice(start + 1, cursor)
    if (!IDENTIFIER_PATTERN.test(name)) return opaque('Unsupported @ expression.')
    if (program[cursor] !== '(') return opaque('Unsupported @ expression.')
    return scanCall(program, start, end, `@${name}`, cursor, opaque)
  }

  if (IDENTIFIER_START.test(char)) {
    let cursor = start + 1
    while (cursor < end && IDENTIFIER_BODY.test(program[cursor] as string)) cursor += 1
    const token = program.slice(start, cursor)
    const next = skipWhitespace(program, cursor, end)
    if (next < end && program[next] === '(') return scanCall(program, start, end, token, next, opaque)
    if (next < end && TRAILING_OPERATOR.test(program[next] as string)) return opaque('Only opaque expressions here.')
    if (token === 'true' || token === 'false') return { kind: 'literal', range: { start, end: cursor }, text: token }
    if (token === 'null') return { kind: 'literal', range: { start, end: cursor }, text: token }
    return { kind: 'ref', range: { start, end: cursor }, identifier: token, text: token }
  }

  if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(program[start + 1] ?? ''))) {
    const match = /^-?[0-9]+(?:\.[0-9]+)?/.exec(program.slice(start, end))
    if (match === null) return opaque()
    const tokenEnd = start + match[0].length
    if (trailingAfter(tokenEnd)) return opaque()
    return { kind: 'number', range: { start, end: tokenEnd }, text: match[0] }
  }

  return opaque()
}

function scanCall(
  program: string,
  start: number,
  end: number,
  name: string,
  open: number,
  opaque: (message?: string) => CstExpr,
): CstExpr {
  const close = matchingDelimiter(program, open, end)
  if (close < 0) return opaque('Unbalanced call arguments.')
  if (skipWhitespace(program, close + 1, end) < end) return opaque()
  return { kind: 'call', range: { start, end: close + 1 }, name, items: splitTopLevel(program, open + 1, close).map(item => scanExpression(program, item)) }
}

/** Value of one string literal expression (without quotes), or undefined. */
function stringValue(expr: CstExpr | undefined): string | undefined {
  return expr?.kind === 'string' ? expr.text : undefined
}

// ---------------------------------------------------------------------------
// Statement parsing
// ---------------------------------------------------------------------------

/**
 * Parse one program into statements and range-bearing expressions.
 * @param program - complete OpenUI Lang program.
 * @returns the CST; `problem` is set when a statement line is not in the subset.
 */
export function parseProgramCst(program: string): ProgramCst {
  if (program.length > MAX_CST_PROGRAM_CHARS) {
    return { program, statements: [], problem: problem('program_too_large', `The program exceeds ${MAX_CST_PROGRAM_CHARS} characters.`) }
  }
  const statements: CstStatement[] = []
  const seen = new Set<string>()
  let lineStart = 0
  while (lineStart <= program.length) {
    let lineEnd = program.indexOf('\n', lineStart)
    if (lineEnd < 0) lineEnd = program.length
    let contentEnd = lineEnd
    if (contentEnd > lineStart && program[contentEnd - 1] === '\r') contentEnd -= 1
    const first = skipWhitespace(program, lineStart, contentEnd)
    if (first >= contentEnd) {
      lineStart = lineEnd + 1
      if (lineEnd === program.length) break
      continue
    }
    const match = /^(\$?[A-Za-z_][A-Za-z0-9_$]*)\s*=\s*/.exec(program.slice(first, contentEnd))
    if (match === null) {
      return { program, statements, problem: problem('unsupported_syntax', `Statement at offset ${first} is not a "name = expression" line.`) }
    }
    const nameRange = { start: first, end: first + match[0].indexOf('=') }
    const name = match[1] as string
    if (seen.has(name)) {
      return { program, statements, problem: problem('duplicate_statement', `Statement ${JSON.stringify(name)} is declared more than once.`) }
    }
    seen.add(name)
    const exprStart = first + match[0].length
    const exprEnd = contentEnd
    const expr = scanExpression(program, { start: exprStart, end: exprEnd })
    statements.push({
      name,
      state: name.startsWith('$'),
      range: { start: first, end: contentEnd },
      nameRange,
      expr,
      source: program.slice(first, contentEnd),
    })
    lineStart = lineEnd + 1
    if (lineEnd === program.length) break
  }
  const root = statements.find(statement => statement.name === 'root')
  return root === undefined
    ? { program, statements, problem: problem('unsupported_syntax', 'The program has no root statement.') }
    : { program, statements, root }
}

// ---------------------------------------------------------------------------
// Symbols and references
// ---------------------------------------------------------------------------

function scanExprReferences(
  expr: CstExpr,
  refs: CstReference[],
  eachLocals: { name: string; range: CstRange; scope: string }[],
  scope: readonly string[],
): void {
  if (expr.kind === 'ref' && expr.identifier !== undefined) {
    refs.push({ name: expr.identifier, range: expr.range, ...scope.length === 0 ? {} : { scope: scope[scope.length - 1] } })
    return
  }
  if (expr.kind === 'call') {
    const items = expr.items ?? []
    if (expr.name === '@Each') {
      const arrayExpr = items[0]
      if (arrayExpr !== undefined) scanExprReferences(arrayExpr, refs, eachLocals, scope)
      const variable = stringValue(items[1])
      const template = items[2]
      if (variable !== undefined && items[1] !== undefined) {
        eachLocals.push({ name: variable, range: items[1].range, scope: `each:${variable}` })
      }
      if (template !== undefined) scanExprReferences(template, refs, eachLocals, variable === undefined ? scope : [...scope, variable])
      return
    }
    for (const item of items) scanExprReferences(item, refs, eachLocals, scope)
    return
  }
  for (const item of expr.items ?? []) scanExprReferences(item, refs, eachLocals, scope)
  for (const entry of expr.entries ?? []) scanExprReferences(entry.value, refs, eachLocals, scope)
}

/**
 * Collect the declared names, state declarations, references and @Each locals.
 * @param cst - parsed program.
 * @returns symbol information for validation and duplicate-name checks.
 */
export function collectSymbols(cst: ProgramCst): CstSymbols {
  const refs: CstReference[] = []
  const eachLocals: { name: string; range: CstRange; scope: string }[] = []
  for (const statement of cst.statements) {
    if (statement.name !== 'root') scanExprReferences(statement.expr, refs, eachLocals, [])
    else scanExprReferences(statement.expr, refs, eachLocals, [])
  }
  return {
    declared: cst.statements.map(statement => statement.name),
    states: cst.statements.filter(statement => statement.state).map(statement => statement.name),
    refs,
    eachLocals,
  }
}

function unknownReference(cst: ProgramCst, symbols: CstSymbols): CstReference | undefined {
  const declared = new Set(symbols.declared)
  const locals = new Set(symbols.eachLocals.map(local => local.name))
  return symbols.refs.find(ref => !declared.has(ref.name) && !locals.has(ref.name))
}

// ---------------------------------------------------------------------------
// AST ↔ CST tree mapping
// ---------------------------------------------------------------------------

interface RawAstExpression {
  readonly k: string
  readonly name?: string
  readonly args?: readonly unknown[]
}

function isElementNode(value: unknown): value is ElementNode {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === 'element'
}

function rawAstExpression(value: unknown): RawAstExpression | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as { k?: unknown }
  return typeof candidate.k === 'string' ? candidate as RawAstExpression : undefined
}

function astChildEntries(node: ElementNode): readonly unknown[] {
  const children = node.props.children
  if (Array.isArray(children)) return children.filter(child => isElementNode(child) || rawAstExpression(child) !== undefined)
  // A single non-array children expression (e.g. `Col(@Each(...))`) stays one child.
  return rawAstExpression(children) !== undefined ? [children] : []
}

function findDescendant(node: ElementNode, names: ReadonlySet<string>): ElementNode | undefined {
  for (const child of astChildEntries(node)) {
    if (!isElementNode(child)) continue
    if (names.has(child.typeName)) return child
    const nested = findDescendant(child, names)
    if (nested !== undefined) return nested
  }
  return undefined
}

function firstText(node: ElementNode): string | undefined {
  for (const key of ['text', 'title', 'label', 'children']) {
    const value = node.props[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim() !== '') return item.trim()
        if (isElementNode(item)) {
          const nested = firstText(item)
          if (nested !== undefined) return nested
        }
      }
    }
  }
  return undefined
}

function nodeTitle(node: ElementNode): string | undefined {
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
    return firstText(node)?.slice(0, 80)
  }
  return undefined
}

function countStatementReferences(cst: ProgramCst): Map<string, number> {
  const symbols = collectSymbols(cst)
  const counts = new Map<string, number>()
  for (const ref of symbols.refs) counts.set(ref.name, (counts.get(ref.name) ?? 0) + 1)
  return counts
}

interface AstMetaShape {
  readonly errors?: readonly { readonly severity?: string; readonly message?: string }[]
  readonly unresolved?: readonly unknown[]
  readonly incomplete?: boolean
}

function vendorParse(program: string): { ok: true; root: ElementNode; meta: AstMetaShape } | CstFailure {
  let parsed: ReturnType<typeof parser.parse>
  try {
    parsed = parser.parse(program)
  } catch (cause) {
    return failure('parse_error', `The program could not be parsed: ${errorMessage(cause)}`)
  }
  const meta = parsed.meta as AstMetaShape
  const fatal = (meta.errors ?? []).find(error => error.severity !== 'warning')
  if (fatal !== undefined) return failure('parse_error', `The program is not valid openui-lang: ${fatal.message ?? 'parse error'}`)
  if (meta.incomplete === true) return failure('parse_error', 'The program is incomplete.')
  if (parsed.root === null) return failure('parse_error', 'No root component could be resolved.')
  return { ok: true, root: parsed.root, meta }
}

function emptyTree(program: string, options: CstTreeOptions, code: CstErrorCode, message: string): ArtifactTree {
  return {
    program,
    ...options.baseRevisionId === undefined ? {} : { baseRevisionId: options.baseRevisionId },
    rootNodeId: '',
    nodes: new Map(),
    order: [],
    outline: [],
    problems: [{ code, message }],
    limitsExceeded: code,
    stats: { nodeCount: 0, maxDepth: 0 },
  }
}

interface WalkInput {
  readonly ast: ElementNode
  /** Call expression that owns the children array (inline call or named statement expression). */
  readonly componentCallForChildren: CstExpr
  readonly slotRange: CstRange
  readonly slotSource: string
  readonly componentRange: CstRange
  readonly componentSource: string
  readonly depth: number
  readonly nodePath: string
  readonly childIndex: number
  readonly parentNodeId?: string
  readonly slotKey?: 'children' | 'template'
  readonly statementId?: string
  readonly parentShared: boolean
  readonly scope?: { readonly eachVariable: string; readonly eachNodeId: string }
}

/**
 * Build the revision-scoped node tree for one program.
 *
 * Node ids are deterministic DFS pre-order (`n1`, `n2`, …) over the mapped AST,
 * so the same program always yields the same ids. An unsupported container,
 * mapping mismatch or limit is reported through `problems`/`limitsExceeded`
 * instead of throwing.
 * @param program - complete OpenUI Lang program.
 * @param options - container whitelist, base revision binding and limits.
 * @returns the tree, possibly with problems/limitsExceeded set.
 */
export function buildArtifactTree(program: string, options: CstTreeOptions = {}): ArtifactTree {
  if (program.length > MAX_CST_PROGRAM_CHARS) {
    return emptyTree(program, options, 'program_too_large', `The program exceeds ${MAX_CST_PROGRAM_CHARS} characters.`)
  }
  const cst = parseProgramCst(program)
  if (cst.problem !== undefined) return emptyTree(program, options, cst.problem.code, cst.problem.message)
  const rootStatement = cst.root
  if (rootStatement === undefined) return emptyTree(program, options, 'unsupported_syntax', 'The program has no root statement.')
  if (rootStatement.expr.kind !== 'call' || rootStatement.expr.name !== 'Col') {
    return emptyTree(program, options, 'root_not_col', 'The root statement must be a Col([...]) call.')
  }
  const parsed = vendorParse(program)
  if (parsed.ok === false) return emptyTree(program, options, parsed.code, parsed.message)
  if (parsed.root.typeName !== 'Col') {
    return emptyTree(program, options, 'root_not_col', `The root component must be Col, got ${parsed.root.typeName}.`)
  }
  const maxDepth = options.maxDepth ?? MAX_CST_DEPTH
  const maxNodes = options.maxNodes ?? MAX_CST_NODES
  const containerTypes = new Set(options.containerTypes ?? DEFAULT_CONTAINER_TYPES)
  const definitions = new Map<string, CstStatement>()
  for (const statement of cst.statements) {
    if (statement.name !== 'root') definitions.set(statement.name, statement)
  }
  const referenceCounts = countStatementReferences(cst)
  const nodes = new Map<string, ArtifactTreeNode>()
  const order: string[] = []
  const problems: (CstProblem & { nodeId?: string })[] = []
  let nextId = 0
  let limitsExceeded: CstErrorCode | undefined

  const containerChildren = (
    ast: ElementNode,
    call: CstExpr,
  ): { astChildren: readonly unknown[]; itemExprs: readonly CstExpr[]; slotRange?: CstRange } | undefined => {
    const childrenArgIndex = CONTAINER_CHILDREN_ARG_INDEX[ast.typeName] ?? 0
    const childrenArg = call.kind === 'call' ? call.items?.[childrenArgIndex] : undefined
    const astChildren = astChildEntries(ast)
    if (childrenArg === undefined) return astChildren.length === 0 ? { astChildren, itemExprs: [] } : undefined
    if (childrenArg.kind === 'array') {
      const itemExprs = childrenArg.items ?? []
      if (astChildren.length !== itemExprs.length) return undefined
      return { astChildren, itemExprs, slotRange: { start: childrenArg.range.start + 1, end: childrenArg.range.end - 1 } }
    }
    // A single dynamic children expression (e.g. `Col(@Each(...))` or
    // `Section("t", @Each(...), "anchor")`): the runtime instances are not
    // statically addressable, so there is no rewritable slot.
    if (astChildren.length === 1 && !isOpaque(childrenArg)) {
      return { astChildren, itemExprs: [childrenArg] }
    }
    return undefined
  }

  const walk = (input: WalkInput): string => {
    nextId += 1
    const nodeId = `n${nextId}`
    const componentType = input.ast.typeName
    const scoped = input.scope !== undefined
    const sharedRef = input.statementId !== undefined && (referenceCounts.get(input.statementId) ?? 0) > 1
    const shared = input.parentShared || sharedRef
    const depthExceeded = input.depth > maxDepth
    if (depthExceeded) limitsExceeded = 'too_deep'
    const children: string[] = []
    const childSlots: Record<string, readonly string[]> = {}
    let slotRange: CstRange | undefined
    let nodeProblem: CstProblem | undefined
    if (depthExceeded) {
      nodeProblem = problem('too_deep', `Node depth ${input.depth} exceeds the supported depth ${maxDepth}.`)
    } else if (containerTypes.has(componentType)) {
      const mapped = containerChildren(input.ast, input.componentCallForChildren)
      if (mapped === undefined) {
        nodeProblem = problem('unsupported_container', `Could not map the children of ${componentType} to source ranges.`)
      } else {
        slotRange = mapped.slotRange
        mapped.itemExprs.forEach((itemExpr, index) => {
          const astChild = mapped.astChildren[index]
          const childPath = `${input.nodePath}/children[${index}]`
          const raw = rawAstExpression(astChild)
          if (raw !== undefined) {
            if (raw.k === 'Comp' && raw.name === 'Each') {
              children.push(walkEach(itemExpr, raw, nodeId, input, index, childPath))
            } else {
              children.push(walkOpaque(astChild, itemExpr, nodeId, input, index, childPath, 'opaque_expression'))
            }
            return
          }
          if (!isElementNode(astChild)) {
            children.push(walkOpaque(astChild, itemExpr, nodeId, input, index, childPath, 'unsupported_mapping'))
            return
          }
          children.push(walkChild(astChild, itemExpr, nodeId, input, index, childPath))
        })
        if (children.length > 0) childSlots.children = children
      }
    }
    const base = {
      nodeId,
      ...input.parentNodeId === undefined ? {} : { parentNodeId: input.parentNodeId },
      depth: input.depth,
      nodePath: input.nodePath,
      ...input.slotKey === undefined ? {} : { slotKey: input.slotKey },
      childIndex: input.childIndex,
      componentType,
      props: input.ast.props as Readonly<Record<string, unknown>>,
      ...nodeTitle(input.ast) === undefined ? {} : { title: nodeTitle(input.ast) as string },
      ...input.statementId === undefined ? {} : { statementId: input.statementId },
      range: input.slotRange,
      source: input.slotSource,
      contentRange: input.componentRange,
      contentSource: input.componentSource,
      digest: digestSource(input.componentSource),
      ...slotRange === undefined ? {} : { slotRange },
      children,
      childSlots,
      editable: !scoped && !shared && nodeProblem === undefined,
      scoped,
      shared,
      opaque: nodeProblem !== undefined && nodeProblem.code === 'unsupported_mapping',
      ...input.scope === undefined ? {} : { scope: input.scope },
      ...nodeProblem === undefined ? {} : { problem: nodeProblem },
    } satisfies ArtifactTreeNode
    nodes.set(nodeId, base)
    order.push(nodeId)
    return nodeId
  }

  // Local recursive helpers capture `walk` through a wrapper input extension:
  const walkChild = (
    ast: ElementNode,
    itemExpr: CstExpr,
    parentNodeId: string,
    parentInput: WalkInput,
    index: number,
    childPath: string,
  ): string => {
    const common = {
      depth: parentInput.depth + 1,
      nodePath: childPath,
      childIndex: index,
      parentNodeId,
      slotKey: 'children' as const,
      parentShared: parentInput.parentShared,
    }
    if (itemExpr.kind === 'ref' && itemExpr.identifier !== undefined && definitions.has(itemExpr.identifier)) {
      const definition = definitions.get(itemExpr.identifier) as CstStatement
      if (definition.expr.kind === 'call') {
        return walk({
          ast,
          slotRange: itemExpr.range,
          slotSource: program.slice(itemExpr.range.start, itemExpr.range.end),
          componentRange: definition.expr.range,
          componentSource: program.slice(definition.expr.range.start, definition.expr.range.end),
          componentCallForChildren: definition.expr,
          statementId: itemExpr.identifier,
          ...common,
        })
      }
      return walkOpaque(ast, itemExpr, parentNodeId, parentInput, index, childPath, 'unsupported_mapping')
    }
    if (itemExpr.kind === 'call') {
      return walk({
        ast,
        slotRange: itemExpr.range,
        slotSource: program.slice(itemExpr.range.start, itemExpr.range.end),
        componentRange: itemExpr.range,
        componentSource: program.slice(itemExpr.range.start, itemExpr.range.end),
        componentCallForChildren: itemExpr,
        ...common,
      })
    }
    return walkOpaque(ast, itemExpr, parentNodeId, parentInput, index, childPath, 'unsupported_mapping')
  }

  const walkOpaque = (
    astChild: unknown,
    itemExpr: CstExpr,
    parentNodeId: string,
    parentInput: WalkInput,
    index: number,
    childPath: string,
    reason: 'opaque_expression' | 'unsupported_mapping',
  ): string => {
    nextId += 1
    const nodeId = `n${nextId}`
    const element = isElementNode(astChild) ? astChild : undefined
    const raw = rawAstExpression(astChild)
    const componentType = element?.typeName ?? (raw?.k === 'Comp' && raw.name !== undefined ? raw.name : 'Expression')
    const children: string[] = []
    const node: ArtifactTreeNode = {
      nodeId,
      parentNodeId,
      depth: parentInput.depth + 1,
      nodePath: childPath,
      slotKey: 'children',
      childIndex: index,
      componentType,
      props: element?.props as Readonly<Record<string, unknown>> ?? {},
      range: itemExpr.range,
      source: program.slice(itemExpr.range.start, itemExpr.range.end),
      contentRange: itemExpr.range,
      contentSource: program.slice(itemExpr.range.start, itemExpr.range.end),
      digest: digestSource(program.slice(itemExpr.range.start, itemExpr.range.end)),
      children,
      childSlots: {},
      editable: false,
      scoped: false,
      shared: parentInput.parentShared,
      opaque: true,
      problem: problem(reason === 'unsupported_mapping' ? 'unsupported_mapping' : 'unsupported_opaque', 'This expression is opaque to structural operations in this spike.'),
    }
    nodes.set(nodeId, node)
    order.push(nodeId)
    return nodeId
  }

  const walkEach = (
    itemExpr: CstExpr,
    raw: RawAstExpression,
    parentNodeId: string,
    parentInput: WalkInput,
    index: number,
    childPath: string,
  ): string => {
    nextId += 1
    const nodeId = `n${nextId}`
    const variable = raw.args === undefined ? undefined : stringValue(raw.args[1] as CstExpr)
    const templateRange = itemExpr.kind === 'call' ? itemExpr.items?.[2]?.range : undefined
    const templateId: string | undefined = templateRange === undefined ? undefined : (() => {
      nextId += 1
      const id = `n${nextId}`
      const templateAst = raw.args?.[2]
      const templateElement = isElementNode(templateAst) ? templateAst : undefined
      const templateRaw = rawAstExpression(templateAst)
      const templateType = templateElement?.typeName ?? (templateRaw?.k === 'Comp' && templateRaw.name !== undefined ? templateRaw.name : 'Expression')
      const template: ArtifactTreeNode = {
        nodeId: id,
        parentNodeId: nodeId,
        depth: parentInput.depth + 2,
        nodePath: `${childPath}/template[0]`,
        slotKey: 'template',
        childIndex: 0,
        componentType: templateType,
        props: templateElement?.props as Readonly<Record<string, unknown>> ?? {},
        range: templateRange,
        source: program.slice(templateRange.start, templateRange.end),
        contentRange: templateRange,
        contentSource: program.slice(templateRange.start, templateRange.end),
        digest: digestSource(program.slice(templateRange.start, templateRange.end)),
        children: [],
        childSlots: {},
        editable: false,
        scoped: true,
        shared: parentInput.parentShared,
        opaque: false,
        scope: { eachVariable: variable ?? '', eachNodeId: nodeId },
        problem: problem('unsupported_scope', 'Nodes inside an @Each template run per runtime instance and are not structurally editable.'),
      }
      nodes.set(id, template)
      order.push(id)
      return id
    })()
    const node: ArtifactTreeNode = {
      nodeId,
      parentNodeId,
      depth: parentInput.depth + 1,
      nodePath: childPath,
      slotKey: 'children',
      childIndex: index,
      componentType: '@Each',
      props: {},
      range: itemExpr.range,
      source: program.slice(itemExpr.range.start, itemExpr.range.end),
      contentRange: itemExpr.range,
      contentSource: program.slice(itemExpr.range.start, itemExpr.range.end),
      digest: digestSource(program.slice(itemExpr.range.start, itemExpr.range.end)),
      children: [],
      childSlots: templateId === undefined ? {} : { template: [templateId] },
      editable: false,
      scoped: false,
      shared: parentInput.parentShared,
      opaque: true,
      problem: problem('unsupported_scope', 'The @Each expression is opaque to structural operations in this spike.'),
    }
    nodes.set(nodeId, node)
    order.push(nodeId)
    return nodeId
  }

  // The root node mirrors the root statement's Col call.
  const rootCall = rootStatement.expr
  const rootId = walk({
    ast: parsed.root,
    componentCallForChildren: rootCall,
    slotRange: rootCall.range,
    slotSource: program.slice(rootCall.range.start, rootCall.range.end),
    componentRange: rootCall.range,
    componentSource: program.slice(rootCall.range.start, rootCall.range.end),
    depth: 0,
    nodePath: 'root',
    childIndex: 0,
    parentShared: false,
  })

  if (nodes.size > maxNodes) {
    limitsExceeded = 'too_many_nodes'
    problems.push({ code: 'too_many_nodes', message: `The program has ${nodes.size} nodes; the structure limit is ${maxNodes}.` })
  }
  const rootNode = nodes.get(rootId)
  if (rootNode !== undefined) nodes.set(rootId, { ...rootNode, editable: false })
  const orderedIds = [...order].sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)))
  const maxUsedDepth = orderedIds.reduce((max, id) => Math.max(max, nodes.get(id)?.depth ?? 0), 0)
  const outline: ArtifactTreeOutlineEntry[] = orderedIds
    .filter(id => id !== rootId)
    .map(id => {
      const node = nodes.get(id) as ArtifactTreeNode
      return {
        nodeId: node.nodeId,
        ...node.parentNodeId === undefined ? {} : { parentNodeId: node.parentNodeId },
        depth: node.depth,
        nodePath: node.nodePath,
        componentType: node.componentType,
        ...node.title === undefined ? {} : { title: node.title },
        childIndex: node.childIndex,
        editable: node.editable,
      }
    })
  return {
    program,
    ...options.baseRevisionId === undefined ? {} : { baseRevisionId: options.baseRevisionId },
    rootNodeId: rootId,
    nodes,
    order: orderedIds,
    outline,
    problems,
    ...limitsExceeded === undefined ? {} : { limitsExceeded },
    stats: { nodeCount: nodes.size, maxDepth: maxUsedDepth },
  }
}

// ---------------------------------------------------------------------------
// Structure inspection
// ---------------------------------------------------------------------------

export interface StructureInspectionSuccess {
  readonly ok: true
  readonly tree: ArtifactTree
  readonly symbols: CstSymbols
}

export type StructureInspectionResult = StructureInspectionSuccess | CstFailure

/**
 * Parse, build the node tree and validate references of one program.
 * @param program - complete OpenUI Lang program.
 * @param options - tree options.
 * @returns the tree and symbols, or the first problem.
 */
export function inspectProgramStructure(program: string, options: CstTreeOptions = {}): StructureInspectionResult {
  const cst = parseProgramCst(program)
  if (cst.problem !== undefined) return failure(cst.problem.code, cst.problem.message)
  const tree = buildArtifactTree(program, options)
  if (tree.limitsExceeded !== undefined) {
    return failure(tree.limitsExceeded, tree.problems[0]?.message ?? 'The program exceeds the structure limits.')
  }
  const parsed = vendorParse(program)
  if (parsed.ok === false) return parsed
  const unresolved = parsed.meta.unresolved ?? []
  if (unresolved.length > 0) return failure('unknown_reference', `Unresolved reference: ${String(unresolved[0])}.`)
  const symbols = collectSymbols(cst)
  const unknown = unknownReference(cst, symbols)
  return unknown === undefined ? { ok: true, tree, symbols } : failure('unknown_reference', `Unknown reference: ${JSON.stringify(unknown.name)}.`)
}

// ---------------------------------------------------------------------------
// Source edits and validation
// ---------------------------------------------------------------------------

interface SourceEdit {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly op: string
}

interface PreparedEdits {
  readonly edits: readonly SourceEdit[]
  readonly explicitTouched: readonly string[]
}

function truncate(source: string): string {
  const compact = source.replace(/\s+/g, ' ').trim()
  return compact.length <= 120 ? compact : `${compact.slice(0, 117)}...`
}

function overlapsEdit(edit: SourceEdit, range: CstRange): boolean {
  if (edit.start === edit.end) return edit.start > range.start && edit.start < range.end
  return edit.start < range.end && edit.end > range.start
}

function applyEdits(program: string, edits: readonly SourceEdit[]): string {
  const sorted = [...edits].sort((left, right) => left.start - right.start || left.end - right.end)
  let cursor = 0
  let result = ''
  for (const edit of sorted) {
    result += program.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  return result + program.slice(cursor)
}

function validateEdits(edits: readonly SourceEdit[]): CstFailure | undefined {
  const sorted = [...edits].sort((left, right) => left.start - right.start || left.end - right.end)
  let previousEnd = 0
  let previous: SourceEdit | undefined
  for (const edit of sorted) {
    if (edit.start < previousEnd) return failure('operation_conflict', 'Two structure operations rewrite overlapping source ranges in this spike.')
    if (previous !== undefined && edit.start === edit.end && previous.start === previous.end && edit.start === previous.start) {
      return failure('operation_conflict', 'Two structure operations insert at the same source position in this spike.')
    }
    previousEnd = edit.end
    previous = edit
  }
  return undefined
}

function treeOptions(options: CstOperationOptions): CstTreeOptions {
  return {
    ...options.containerTypes === undefined ? {} : { containerTypes: options.containerTypes },
    ...options.baseRevisionId === undefined ? {} : { baseRevisionId: options.baseRevisionId },
    ...options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth },
    ...options.maxNodes === undefined ? {} : { maxNodes: options.maxNodes },
  }
}

function resolveBase(program: string, options: CstOperationOptions): { ok: true; tree: ArtifactTree } | CstFailure {
  if (options.tree !== undefined) {
    if (options.tree.program !== program) {
      return failure('digest_mismatch', 'The node tree does not belong to this program; rebuild the tree for the current revision.')
    }
    if (options.baseRevisionId !== undefined && options.tree.baseRevisionId !== undefined && options.baseRevisionId !== options.tree.baseRevisionId) {
      return failure('revision_mismatch', 'The base revision does not match the provided node tree.')
    }
    return { ok: true, tree: options.tree }
  }
  const tree = buildArtifactTree(program, treeOptions(options))
  if (tree.limitsExceeded !== undefined) return failure(tree.limitsExceeded, tree.problems[0]?.message ?? 'The program exceeds the structure limits.')
  return { ok: true, tree }
}

/** Resolve one node by id and enforce the digest binding when a base tree is provided. */
function requireNode(
  program: string,
  tree: ArtifactTree,
  nodeId: string,
  options: CstOperationOptions,
): { ok: true; node: ArtifactTreeNode } | CstFailure {
  const node = tree.nodes.get(nodeId)
  if (node === undefined) return failure('unknown_node', `Unknown node ${JSON.stringify(nodeId)}.`)
  if (options.tree !== undefined) {
    const recomputed = digestSource(program.slice(node.contentRange.start, node.contentRange.end))
    if (recomputed !== node.digest) return failure('digest_mismatch', 'The node digest does not match the program source; rebuild the tree.')
  }
  return { ok: true, node }
}

function denyNode(node: ArtifactTreeNode, rootNodeId: string): CstFailure | undefined {
  if (node.nodeId === rootNodeId) return failure('cannot_edit_root', 'The root Col cannot be replaced, removed, moved or duplicated.')
  if (node.scoped) return failure('unsupported_scope', 'Nodes inside an @Each template run per runtime instance and are not structurally editable.')
  if (node.shared) return failure('shared_named_reference', 'This node lives in a shared named expression; structural edits would change every instance.')
  if (node.opaque || node.problem !== undefined) return failure('unsupported_opaque', `Node ${node.nodeId} is opaque to structure operations.`)
  return undefined
}

function requireContainer(
  tree: ArtifactTree,
  parentNodeId: string,
  options: CstOperationOptions,
): { ok: true; node: ArtifactTreeNode } | CstFailure {
  const parent = tree.nodes.get(parentNodeId)
  if (parent === undefined) return failure('unknown_node', `Unknown parent node ${JSON.stringify(parentNodeId)}.`)
  const containers = new Set(options.containerTypes ?? DEFAULT_CONTAINER_TYPES)
  if (!containers.has(parent.componentType)) {
    return failure('incompatible_container', `${parent.componentType} is not an editable container for this operation.`)
  }
  if (parent.scoped) return failure('unsupported_scope', 'Cannot edit children inside an @Each template.')
  if (parent.shared) return failure('shared_named_reference', 'The parent lives in a shared named expression; structural edits would change every instance.')
  if (parent.opaque || parent.problem !== undefined) return failure('unsupported_opaque', 'The parent container is opaque to structure operations.')
  if (parent.slotRange === undefined) return failure('unsupported_container', `The children of ${parent.componentType} could not be mapped to source ranges.`)
  return { ok: true, node: parent }
}

function slotChildIds(parent: ArtifactTreeNode): readonly string[] {
  return parent.childSlots.children ?? []
}

function childSources(tree: ArtifactTree, ids: readonly string[]): string[] {
  return ids.map(id => (tree.nodes.get(id) as ArtifactTreeNode).source)
}

/** Direct children a user can place blocks between (opaque/template nodes excluded). */
function editableChildIds(tree: ArtifactTree, parent: ArtifactTreeNode): readonly string[] {
  return slotChildIds(parent).filter(nodeId => tree.nodes.get(nodeId)?.editable === true)
}

/**
 * Map an editable-child insertion index to a full slot index: index <
 * editableCount inserts before that editable child; index === editableCount
 * appends after the last editable child (or at the end when there is none).
 */
function editableInsertionIndex(tree: ArtifactTree, parent: ArtifactTreeNode, index: number): number | undefined {
  if (!Number.isInteger(index) || index < 0) return undefined
  const children = slotChildIds(parent)
  const editable = editableChildIds(tree, parent)
  if (index > editable.length) return undefined
  if (index < editable.length) return children.indexOf(editable[index] as string)
  const last = editable[editable.length - 1]
  return last === undefined ? children.length : children.indexOf(last) + 1
}

/** Whether two source ranges overlap (adjacent ranges do not). */
function rangesOverlap(left: CstRange, right: CstRange): boolean {
  return left.start < right.end && right.start < left.end
}

/** Validate one inline expression source for insertion. */
function insertSourceFailure(source: string): CstFailure | undefined {
  const trimmed = source.trim()
  if (trimmed === '') return failure('invalid_source', 'The inserted expression source is empty.')
  if (/[\r\n]/.test(trimmed)) return failure('invalid_source', 'The inserted expression source must be a single-line expression.')
  const expr = scanExpression(trimmed, { start: 0, end: trimmed.length })
  if (isOpaque(expr) || !fullySupported(expr)) {
    return failure('invalid_source', 'The inserted expression source is outside the supported expression subset.')
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Operation preparation
// ---------------------------------------------------------------------------

function prepareReplace(program: string, tree: ArtifactTree, operation: { nodeId: string; source: string }, options: CstOperationOptions): { ok: true; prepared: PreparedEdits } | CstFailure {
  const resolved = requireNode(program, tree, operation.nodeId, options)
  if (resolved.ok === false) return resolved
  const node = resolved.node
  const denied = denyNode(node, tree.rootNodeId)
  if (denied !== undefined) return denied
  const trimmed = operation.source.trim()
  if (trimmed === '') return failure('invalid_source', 'The replacement source is empty.')
  const expr = scanExpression(trimmed, { start: 0, end: trimmed.length })
  if (isOpaque(expr) || !fullySupported(expr)) return failure('invalid_source', 'The replacement source is outside the supported expression subset.')
  if (node.source.trim() === trimmed) return { ok: true, prepared: { edits: [], explicitTouched: [] } }
  return {
    ok: true,
    prepared: {
      edits: [{ start: node.range.start, end: node.range.end, text: trimmed, op: 'replace' }],
      explicitTouched: [],
    },
  }
}

function prepareReorder(
  program: string,
  tree: ArtifactTree,
  operation: { parentNodeId: string; slotKey?: string; order: readonly string[] },
  options: CstOperationOptions,
): { ok: true; prepared: PreparedEdits } | CstFailure {
  const parentResult = requireContainer(tree, operation.parentNodeId, options)
  if (parentResult.ok === false) return parentResult
  const parent = parentResult.node
  const slotKey = operation.slotKey ?? 'children'
  if (slotKey !== 'children') return failure('unknown_slot', `Only the "children" slot can be reordered in this spike, got ${JSON.stringify(slotKey)}.`)
  const current = slotChildIds(parent)
  const order = operation.order
  if (!Array.isArray(order) || order.length !== current.length) {
    return failure('invalid_order', 'The order must be a complete permutation of the slot children.')
  }
  const known = new Set(current)
  const seen = new Set<string>()
  for (const id of order) {
    if (!known.has(id)) {
      return tree.nodes.has(id)
        ? failure('invalid_order', 'The order must contain exactly the slot children.')
        : failure('unknown_node', `Unknown child node ${JSON.stringify(id)}.`)
    }
    if (seen.has(id)) return failure('invalid_order', 'The order must not repeat a child node.')
    seen.add(id)
  }
  if (order.every((id, index) => id === current[index])) return { ok: true, prepared: { edits: [], explicitTouched: [] } }
  if (parent.slotRange === undefined) return failure('incompatible_container', 'The slot cannot be rewritten.')
  return {
    ok: true,
    prepared: {
      edits: [{
        start: parent.slotRange.start,
        end: parent.slotRange.end,
        text: childSources(tree, order).join(', '),
        op: 'reorder',
      }],
      explicitTouched: [parent.nodeId],
    },
  }
}

function prepareRemove(program: string, tree: ArtifactTree, operation: { nodeId: string }, options: CstOperationOptions): { ok: true; prepared: PreparedEdits } | CstFailure {
  const resolved = requireNode(program, tree, operation.nodeId, options)
  if (resolved.ok === false) return resolved
  const node = resolved.node
  const denied = denyNode(node, tree.rootNodeId)
  if (denied !== undefined) return denied
  if (node.parentNodeId === undefined) return failure('cannot_edit_root', 'The root has no parent to remove it from.')
  const parent = tree.nodes.get(node.parentNodeId)
  if (parent === undefined) return failure('unknown_node', 'The parent node is missing from the tree.')
  if (parent.shared) return failure('shared_named_reference', 'The parent lives in a shared named expression; removing a child would change every instance.')
  if (parent.slotRange === undefined) return failure('incompatible_container', 'The parent children cannot be mapped to a source range.')
  const current = slotChildIds(parent)
  if (!current.includes(node.nodeId)) return failure('unsupported_mapping', 'The node is not a direct child of its mapped parent slot.')
  const remaining = current.filter(id => id !== node.nodeId)
  return {
    ok: true,
    prepared: {
      edits: [{
        start: parent.slotRange.start,
        end: parent.slotRange.end,
        text: childSources(tree, remaining).join(', '),
        op: 'remove',
      }],
      explicitTouched: [parent.nodeId],
    },
  }
}

function descendantIds(tree: ArtifactTree, nodeId: string): string[] {
  const result: string[] = []
  const stack = [...(tree.nodes.get(nodeId)?.children ?? []), ...(tree.nodes.get(nodeId)?.childSlots.template ?? [])]
  while (stack.length > 0) {
    const id = stack.pop() as string
    const node = tree.nodes.get(id)
    if (node === undefined) continue
    result.push(id)
    stack.push(...node.children, ...(node.childSlots.template ?? []))
  }
  return result
}

function uniqueCopyName(baseName: string, declared: ReadonlySet<string>): string | undefined {
  for (let index = 1; index <= 100; index += 1) {
    const candidate = `${baseName}_copy${index}`
    if (!declared.has(candidate)) return candidate
  }
  return undefined
}

function prepareInsert(
  program: string,
  tree: ArtifactTree,
  operation: { parentNodeId: string; slotKey?: string; index: number; source: string },
  options: CstOperationOptions,
): { ok: true; prepared: PreparedEdits } | CstFailure {
  const slotKey = operation.slotKey ?? 'children'
  if (slotKey !== 'children') return failure('unknown_slot', `Only the "children" slot supports insertion in this release, got ${JSON.stringify(slotKey)}.`)
  const parentResult = requireContainer(tree, operation.parentNodeId, options)
  if (parentResult.ok === false) return parentResult
  const parent = parentResult.node
  const sourceProblem = insertSourceFailure(operation.source)
  if (sourceProblem !== undefined) return sourceProblem
  const trimmed = operation.source.trim()
  const children = slotChildIds(parent)
  const editable = editableChildIds(tree, parent)
  const index = editableInsertionIndex(tree, parent, operation.index)
  if (index === undefined) {
    return failure('invalid_index', `The insert index must be between 0 and ${editable.length}.`)
  }
  const nextChildren = [...children]
  nextChildren.splice(index, 0, trimmed)
  const sources = nextChildren.map(entry => (tree.nodes.get(entry) as ArtifactTreeNode | undefined)?.source ?? entry)
  return {
    ok: true,
    prepared: {
      edits: [{
        start: (parent.slotRange as CstRange).start,
        end: (parent.slotRange as CstRange).end,
        text: sources.join(', '),
        op: 'insert',
      }],
      explicitTouched: [parent.nodeId],
    },
  }
}

function prepareDuplicate(
  program: string,
  tree: ArtifactTree,
  operation: { nodeId: string; targetParentId: string; slotKey?: string; index: number },
  options: CstOperationOptions,
): { ok: true; prepared: PreparedEdits } | CstFailure {
  const resolved = requireNode(program, tree, operation.nodeId, options)
  if (resolved.ok === false) return resolved
  const node = resolved.node
  const denied = denyNode(node, tree.rootNodeId)
  if (denied !== undefined) return denied
  const targetResult = requireContainer(tree, operation.targetParentId, options)
  if (targetResult.ok === false) return targetResult
  const target = targetResult.node
  if ((operation.slotKey ?? 'children') !== 'children') return failure('unknown_slot', 'Only the "children" slot can receive duplicates in this spike.')
  const targetChildren = slotChildIds(target)
  const slots = [...descendantIds(tree, node.nodeId), node.nodeId]
  for (const id of slots) {
    const candidate = tree.nodes.get(id)
    if (candidate === undefined) continue
    if (candidate.componentType === 'Section' || candidate.componentType === 'Toc') {
      return failure('duplicate_anchor_unsupported', 'Duplicating a subtree that contains Section/Toc anchors is not supported; anchors must stay unique.')
    }
    if (candidate.scoped) return failure('unsupported_scope', 'Cannot duplicate nodes inside an @Each template.')
    if (candidate.componentType === '@Each') return failure('unsupported_scope', 'Duplicating a subtree that contains @Each local scope is not supported.')
    if (id !== node.nodeId && candidate.statementId !== undefined) {
      return failure('shared_named_reference', 'Duplicating a subtree that references other named blocks would alias those blocks; not supported in this spike.')
    }
  }
  if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index > targetChildren.length) {
    return failure('invalid_index', `The target index must be between 0 and ${targetChildren.length}.`)
  }
  const edits: SourceEdit[] = []
  let cloneSource: string
  if (node.statementId !== undefined) {
    const declared = new Set<string>()
    for (const statement of parseProgramCst(program).statements) declared.add(statement.name)
    const copyName = uniqueCopyName(node.statementId, declared)
    if (copyName === undefined) return failure('duplicate_statement', 'Could not allocate a unique copy name.')
    cloneSource = copyName
    const definitionSource = program.slice(node.contentRange.start, node.contentRange.end)
    const appended = `${program.endsWith('\n') ? '' : '\n'}${copyName} = ${definitionSource}\n`
    edits.push({ start: program.length, end: program.length, text: appended, op: 'duplicate' })
  } else {
    cloneSource = node.source
  }
  const targetSlot = target.slotRange as CstRange
  const nextChildren = [...targetChildren]
  nextChildren.splice(operation.index, 0, cloneSource)
  const sources = nextChildren.map(entry => (tree.nodes.get(entry) as ArtifactTreeNode | undefined)?.source ?? entry)
  edits.push({
    start: targetSlot.start,
    end: targetSlot.end,
    text: sources.join(', '),
    op: 'duplicate',
  })
  return { ok: true, prepared: { edits, explicitTouched: [target.nodeId] } }
}

function isAncestor(tree: ArtifactTree, ancestorId: string, descendantId: string): boolean {
  let cursor: string | undefined = tree.nodes.get(descendantId)?.parentNodeId
  while (cursor !== undefined) {
    if (cursor === ancestorId) return true
    cursor = tree.nodes.get(cursor)?.parentNodeId
  }
  return false
}

function prepareMove(
  program: string,
  tree: ArtifactTree,
  operation: { nodeId: string; targetParentId: string; slotKey?: string; index: number },
  options: CstOperationOptions,
): { ok: true; prepared: PreparedEdits } | CstFailure {
  const resolved = requireNode(program, tree, operation.nodeId, options)
  if (resolved.ok === false) return resolved
  const node = resolved.node
  const denied = denyNode(node, tree.rootNodeId)
  if (denied !== undefined) return denied
  const targetResult = requireContainer(tree, operation.targetParentId, options)
  if (targetResult.ok === false) return targetResult
  const target = targetResult.node
  if ((operation.slotKey ?? 'children') !== 'children') return failure('unknown_slot', 'Only the "children" slot supports moves in this spike.')
  if (target.nodeId === node.nodeId) return failure('move_into_self', 'A node cannot be moved into itself.')
  if (isAncestor(tree, node.nodeId, target.nodeId)) return failure('move_into_self', 'A node cannot be moved into its own descendant.')
  if (node.parentNodeId === undefined) return failure('cannot_edit_root', 'The node has no parent to move out of.')
  const sourceParent = tree.nodes.get(node.parentNodeId)
  if (sourceParent === undefined) return failure('unknown_node', 'The source parent node is missing from the tree.')
  if (sourceParent.shared) return failure('shared_named_reference', 'The source parent lives in a shared named expression; moving a child would change every instance.')
  if (sourceParent.slotRange === undefined) return failure('incompatible_container', 'The source parent children cannot be mapped to a source range.')
  const differentParent = sourceParent.nodeId !== target.nodeId
  if (differentParent && (isAncestor(tree, sourceParent.nodeId, target.nodeId) || isAncestor(tree, target.nodeId, sourceParent.nodeId))) {
    return failure('unsupported_move_nested', 'Moving between a container and an ancestor/descendant container is not supported: their children slots are nested. Move to a sibling or unrelated container instead.')
  }
  const sourceChildren = slotChildIds(sourceParent)
  const sourceIndex = sourceChildren.indexOf(node.nodeId)
  if (sourceIndex < 0) return failure('unsupported_mapping', 'The node is not a direct child of its mapped parent slot.')
  const removed = sourceChildren.filter(id => id !== node.nodeId)
  if (differentParent) {
    const targetChildren = slotChildIds(target)
    const targetEditable = editableChildIds(tree, target)
    const targetIndex = editableInsertionIndex(tree, target, operation.index)
    if (targetIndex === undefined) {
      return failure('invalid_index', `The target index must be between 0 and ${targetEditable.length} editable children.`)
    }
    const inserted = [...targetChildren]
    inserted.splice(targetIndex, 0, node.nodeId)
    if (target.slotRange === undefined) return failure('incompatible_container', 'The target slot cannot be rewritten.')
    const sourceSlot = sourceParent.slotRange as CstRange
    if (rangesOverlap(sourceSlot, target.slotRange)) {
      return failure('unsupported_move_nested', 'The source and target children slots overlap; moving inside the source container source region is not supported.')
    }
    return {
      ok: true,
      prepared: {
        edits: [
          { start: sourceSlot.start, end: sourceSlot.end, text: childSources(tree, removed).join(', '), op: 'move' },
          { start: target.slotRange.start, end: target.slotRange.end, text: childSources(tree, inserted).join(', '), op: 'move' },
        ],
        explicitTouched: [sourceParent.nodeId, target.nodeId],
      },
    }
  }
  if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index > removed.length) {
    return failure('invalid_index', `The target index must be between 0 and ${removed.length}.`)
  }
  if (operation.index === sourceIndex) return { ok: true, prepared: { edits: [], explicitTouched: [] } }
  const reordered = [...removed]
  reordered.splice(operation.index, 0, node.nodeId)
  return {
    ok: true,
    prepared: {
      edits: [{
        start: sourceParent.slotRange.start,
        end: sourceParent.slotRange.end,
        text: childSources(tree, reordered).join(', '),
        op: 'move',
      }],
      explicitTouched: [sourceParent.nodeId],
    },
  }
}

// ---------------------------------------------------------------------------
// Commit: apply, reparse, rebuild, verify untouched source
// ---------------------------------------------------------------------------

function commit(
  program: string,
  prepared: PreparedEdits,
  baseTree: ArtifactTree,
  options: CstOperationOptions,
): CstOperationResult {
  const conflict = validateEdits(prepared.edits)
  if (conflict !== undefined) return conflict
  if (prepared.edits.length === 0) {
    const tree = buildArtifactTree(program, treeOptions(options))
    const unchanged = baseTree.order.map(id => {
      const node = baseTree.nodes.get(id) as ArtifactTreeNode
      return { nodeId: id, digest: node.digest, source: node.source }
    })
    return { ok: true, program, tree, touched: [], unchanged, edits: [] }
  }
  const next = applyEdits(program, prepared.edits)
  if (next.length > MAX_CST_PROGRAM_CHARS) return failure('program_too_large', `The edited program exceeds ${MAX_CST_PROGRAM_CHARS} characters.`)
  const parsed = vendorParse(next)
  if (parsed.ok === false) return parsed
  if (parsed.root.typeName !== 'Col') return failure('root_not_col', 'The edited program must keep root = Col([...]).')
  const unresolved = parsed.meta.unresolved ?? []
  if (unresolved.length > 0) return failure('unknown_reference', `The edit references an undeclared name: ${String(unresolved[0])}.`)
  const tree = buildArtifactTree(next, treeOptions(options))
  if (tree.limitsExceeded !== undefined) return failure(tree.limitsExceeded, tree.problems[0]?.message ?? 'The edited program exceeds the structure limits.')
  const symbols = collectSymbols(parseProgramCst(next))
  const unknown = unknownReference(parseProgramCst(next), symbols)
  if (unknown !== undefined) return failure('unknown_reference', `The edit references an unknown name: ${JSON.stringify(unknown.name)}.`)
  const sortedEdits = [...prepared.edits].sort((left, right) => left.start - right.start || left.end - right.end)
  const touched = new Map<string, CstTouchedNode>()
  const unchanged: CstUnchangedNode[] = []
  for (const nodeId of baseTree.order) {
    const node = baseTree.nodes.get(nodeId)
    if (node === undefined) continue
    const overlapping = sortedEdits.find(edit => overlapsEdit(edit, node.range) || overlapsEdit(edit, node.contentRange))
    if (overlapping !== undefined) {
      touched.set(nodeId, {
        nodeId,
        op: overlapping.op,
        nodePath: node.nodePath,
        before: truncate(node.contentSource),
        after: truncate(overlapping.text),
      })
    }
  }
  // A named statement's definition lives outside its reference range, so mark
  // every ancestor of a touched node as touched as well.
  for (const nodeId of [...touched.keys()]) {
    let cursor = baseTree.nodes.get(nodeId)?.parentNodeId
    while (cursor !== undefined && !touched.has(cursor)) {
      const ancestor = baseTree.nodes.get(cursor)
      if (ancestor === undefined) break
      touched.set(cursor, {
        nodeId: cursor,
        op: 'ancestor',
        nodePath: ancestor.nodePath,
        before: truncate(ancestor.contentSource),
        after: '(descendant changed)',
      })
      cursor = ancestor.parentNodeId
    }
  }
  for (const nodeId of baseTree.order) {
    const node = baseTree.nodes.get(nodeId)
    if (node === undefined || touched.has(nodeId)) continue
    let shift = 0
    for (const edit of sortedEdits) if (edit.end <= node.contentRange.start) shift += edit.text.length - (edit.end - edit.start)
    const start = node.contentRange.start + shift
    const length = node.contentRange.end - node.contentRange.start
    if (next.slice(start, start + length) !== program.slice(node.contentRange.start, node.contentRange.end)) {
      return failure('unchanged_violation', `Untouched source for node ${nodeId} changed during the transform.`)
    }
    unchanged.push({ nodeId, digest: node.digest, source: node.contentSource })
  }
  for (const nodeId of prepared.explicitTouched) {
    if (touched.has(nodeId)) continue
    const node = baseTree.nodes.get(nodeId)
    if (node === undefined) continue
    touched.set(nodeId, { nodeId, op: sortedEdits[0]?.op ?? 'structure', nodePath: node.nodePath, before: truncate(node.source), after: truncate(program.slice(node.range.start, node.range.end)) })
  }
  return {
    ok: true,
    program: next,
    tree,
    touched: [...touched.values()],
    unchanged,
    edits: sortedEdits.map(edit => ({ start: edit.start, end: edit.end, op: edit.op, summary: truncate(edit.text) })),
  }
}

function runSingle(
  program: string,
  options: CstOperationOptions,
  prepare: (tree: ArtifactTree) => { ok: true; prepared: PreparedEdits } | CstFailure,
): CstOperationResult {
  const base = resolveBase(program, options)
  if (base.ok === false) return base
  const prepared = prepare(base.tree)
  if (prepared.ok === false) return prepared
  return commit(program, prepared.prepared, base.tree, options)
}

/**
 * Replace the source expression of one node.
 * @param program - base program.
 * @param nodeId - revision-scoped node id from the base tree.
 * @param sourceExpr - replacement expression of the supported subset.
 * @param options - base tree binding and tree options.
 * @returns the edited program, rebuilt tree and byte-preservation report, or a failure.
 */
export function replaceNode(program: string, nodeId: string, sourceExpr: string, options: CstOperationOptions = {}): CstOperationResult {
  return runSingle(program, options, tree => prepareReplace(program, tree, { nodeId, source: sourceExpr }, options))
}

/**
 * Replace the definition/body of one node while keeping its slot reference.
 *
 * For a named child (`rule = Divider()`) this rewrites the statement body and
 * leaves the root reference (`[..., rule, ...]`) byte-identical; for an inline
 * child it behaves exactly like {@link replaceNode}. Use it for deterministic
 * property edits so a named block does not get inlined into its parent.
 * @param program - base program.
 * @param nodeId - revision-scoped node id from the base tree.
 * @param sourceExpr - replacement expression of the supported subset.
 * @param options - base tree binding and tree options.
 * @returns the edited program, rebuilt tree and byte-preservation report, or a failure.
 */
export function replaceNodeContent(program: string, nodeId: string, sourceExpr: string, options: CstOperationOptions = {}): CstOperationResult {
  return runSingle(program, options, tree => {
    const resolved = requireNode(program, tree, nodeId, options)
    if (resolved.ok === false) return resolved
    const node = resolved.node
    const denied = denyNode(node, tree.rootNodeId)
    if (denied !== undefined) return denied
    const trimmed = sourceExpr.trim()
    if (trimmed === '') return failure('invalid_source', 'The replacement source is empty.')
    const expr = scanExpression(trimmed, { start: 0, end: trimmed.length })
    if (isOpaque(expr) || !fullySupported(expr)) return failure('invalid_source', 'The replacement source is outside the supported expression subset.')
    if (node.contentSource.trim() === trimmed) return { ok: true, prepared: { edits: [], explicitTouched: [] } }
    return {
      ok: true,
      prepared: {
        edits: [{ start: node.contentRange.start, end: node.contentRange.end, text: trimmed, op: 'replace' }],
        explicitTouched: [],
      },
    }
  })
}

/**
 * Reorder every child of one container slot.
 * @param program - base program.
 * @param parentNodeId - node id of the container.
 * @param slotKey - slot to reorder; only `children` is supported.
 * @param order - complete permutation of the slot child node ids.
 * @param options - base tree binding and tree options.
 * @returns the edited program and verification report, or a failure.
 */
export function reorderChildren(
  program: string,
  parentNodeId: string,
  slotKey: string,
  order: readonly string[],
  options: CstOperationOptions = {},
): CstOperationResult {
  return runSingle(program, options, tree => prepareReorder(program, tree, { parentNodeId, slotKey, order }, options))
}

/**
 * Remove one node (and any subtree it references) from its parent slot.
 * @param program - base program.
 * @param nodeId - revision-scoped node id.
 * @param options - base tree binding and tree options.
 * @returns the edited program and verification report, or a failure.
 */
export function removeNode(program: string, nodeId: string, options: CstOperationOptions = {}): CstOperationResult {
  return runSingle(program, options, tree => prepareRemove(program, tree, { nodeId }, options))
}

/**
 * Duplicate one node into a target container slot.
 * @param program - base program.
 * @param nodeId - revision-scoped node id.
 * @param targetParentId - node id of the destination container.
 * @param slotKey - destination slot; only `children` is supported.
 * @param index - insertion index in the destination slot.
 * @param options - base tree binding and tree options.
 * @returns the edited program and verification report, or a failure.
 */
export function duplicateNode(
  program: string,
  nodeId: string,
  targetParentId: string,
  slotKey: string,
  index: number,
  options: CstOperationOptions = {},
): CstOperationResult {
  return runSingle(program, options, tree => prepareDuplicate(program, tree, { nodeId, targetParentId, slotKey, index }, options))
}

/**
 * Insert one inline expression as a new child of a container slot.
 *
 * The index counts editable children only (opaque/template children keep
 * their current relative positions), so index 0 inserts before the first
 * editable child,
 * index === editableCount after the last one. The root Col can be the parent.
 * @param program - base program.
 * @param parentNodeId - node id of the destination container (root node id is allowed).
 * @param slotKey - destination slot; only `children` is supported.
 * @param index - insertion index among the parent's editable children.
 * @param sourceExpr - inline expression source to insert.
 * @param options - base tree binding and tree options.
 * @returns the edited program and verification report, or a failure.
 */
export function insertNode(
  program: string,
  parentNodeId: string,
  slotKey: string,
  index: number,
  sourceExpr: string,
  options: CstOperationOptions = {},
): CstOperationResult {
  return runSingle(program, options, tree => prepareInsert(program, tree, { parentNodeId, slotKey, index, source: sourceExpr }, options))
}

/**
 * Move one node into a target container slot.
 *
 * Same-parent moves keep the original semantics: `index` is the index in the
 * parent's children slot after the node is removed (a complete reorder).
 * Cross-container moves (the two parents may not be ancestor/descendant) use an
 * editable-children index in the destination slot, like {@link insertNode};
 * opaque/template children keep their positions. Moving into a container's own
 * descendant or into an ancestor/descendant container is rejected with
 * {@link CstErrorCode} `unsupported_move_nested`/`move_into_self`.
 * @param program - base program.
 * @param nodeId - revision-scoped node id.
 * @param targetParentId - node id of the destination container.
 * @param slotKey - destination slot; only `children` is supported.
 * @param index - same-parent: full slot index after removal; cross-parent: editable index in the target.
 * @param options - base tree binding and tree options.
 * @returns the edited program and verification report, or a failure.
 */
export function moveNode(
  program: string,
  nodeId: string,
  targetParentId: string,
  slotKey: string,
  index: number,
  options: CstOperationOptions = {},
): CstOperationResult {
  return runSingle(program, options, tree => prepareMove(program, tree, { nodeId, targetParentId, slotKey, index }, options))
}

/**
 * Apply a bounded batch of structure operations against one base program.
 *
 * Node ids in every operation refer to the same base tree; all source edits are
 * collected first and must be non-overlapping (overlapping edits are rejected
 * with `operation_conflict`), so the batch is atomic and byte-verifiable. Edits
 * that target the same parent slot in one batch therefore do not compose in v1.
 * @param program - base program.
 * @param operations - up to {@link MAX_CST_OPERATIONS} operations.
 * @param options - base tree binding and tree options.
 * @returns the edited program and verification report, or a failure.
 */
export function applyOperations(program: string, operations: readonly CstOperation[], options: CstOperationOptions = {}): CstOperationResult {
  if (!Array.isArray(operations) || operations.length === 0) return failure('invalid_operation', 'At least one structure operation is required.')
  if (operations.length > MAX_CST_OPERATIONS) return failure('too_many_operations', `A request may contain at most ${MAX_CST_OPERATIONS} structure operations.`)
  const base = resolveBase(program, options)
  if (base.ok === false) return base
  const edits: SourceEdit[] = []
  const explicitTouched: string[] = []
  for (const operation of operations) {
    let prepared: { ok: true; prepared: PreparedEdits } | CstFailure
    switch (operation.op) {
      case 'replace':
        prepared = prepareReplace(program, base.tree, operation, options)
        break
      case 'reorder':
        prepared = prepareReorder(program, base.tree, operation, options)
        break
      case 'remove':
        prepared = prepareRemove(program, base.tree, operation, options)
        break
      case 'insert':
        prepared = prepareInsert(program, base.tree, operation, options)
        break
      case 'duplicate':
        prepared = prepareDuplicate(program, base.tree, operation, options)
        break
      case 'move':
        prepared = prepareMove(program, base.tree, operation, options)
        break
      default:
        return failure('invalid_operation', 'Unknown structure operation.')
    }
    if (prepared.ok === false) return prepared
    edits.push(...prepared.prepared.edits)
    explicitTouched.push(...prepared.prepared.explicitTouched)
  }
  return commit(program, { edits, explicitTouched }, base.tree, options)
}
