/**
 * Unit tests for the M4-0a structure engine: source CST, revision-scoped node
 * identity, source transforms and reference/scope validation.
 *
 * Run: node --test test/client/program-cst.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ANCHOR_PROGRAM, NESTED_PROGRAM, SCOPED_PROGRAM } from '../browser/fixtures/nested-artifact.ts'
import {
  DEFAULT_CONTAINER_TYPES,
  MAX_CST_OPERATIONS,
  MAX_CST_PROGRAM_CHARS,
  applyOperations,
  buildArtifactTree,
  collectSymbols,
  digestSource,
  duplicateNode,
  inspectProgramStructure,
  moveNode,
  parseProgramCst,
  removeNode,
  reorderChildren,
  replaceNode,
} from '../../src/shared/program-cst.ts'

/** Assert one operation succeeded and return its result. */
function expectOk(result) {
  assert.equal(result.ok, true, result.ok === false ? `${result.code}: ${result.message}` : 'expected success')
  return result
}

/** Assert one operation failed with a specific code. */
function expectFailure(result, code) {
  assert.equal(result.ok, false, 'expected failure')
  if (result.ok) return result
  assert.equal(result.code, code, result.message)
  return result
}

/** Look up one node id that must exist in the tree. */
function node(tree, nodeId) {
  const found = tree.nodes.get(nodeId)
  assert.ok(found !== undefined, `node ${nodeId} exists`)
  return found
}

const NESTED_TREE = buildArtifactTree(NESTED_PROGRAM)
/** NESTED_PROGRAM node ids: root n1, outerCard n2, Title n3, inner Col n4, Text A n5, Text B n6, Text shared n7, secondCard n8, Title n9, Row n10. */
const NESTED_IDS = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10']

test('parseProgramCst records statement and expression ranges of the supported subset', () => {
  const parsed = parseProgramCst(NESTED_PROGRAM)
  assert.equal(parsed.problem, undefined)
  assert.deepEqual(parsed.statements.map(statement => statement.name), ['root', 'outerCard', 'secondCard', 'sharedText'])
  assert.equal(parsed.root?.name, 'root')
  assert.equal(parsed.root?.expr.kind, 'call')
  assert.equal(parsed.root?.expr.name, 'Col')
  for (const statement of parsed.statements) {
    assert.equal(NESTED_PROGRAM.slice(statement.range.start, statement.range.end), statement.source)
    assert.equal(statement.source, statement.source.trim())
  }
  const rootArray = parsed.root?.expr.items?.[0]
  assert.equal(rootArray?.kind, 'array')
  assert.equal(rootArray?.items?.length, 2)
  const outerCard = parsed.statements.find(statement => statement.name === 'outerCard')
  assert.equal(outerCard?.expr.name, 'Card')
  const firstChild = outerCard?.expr.items?.[0]?.items?.[0]
  assert.equal(NESTED_PROGRAM.slice(firstChild?.range.start, firstChild?.range.end), 'Title("外层卡片", "sm")')
  const shared = parsed.statements.find(statement => statement.name === 'sharedText')
  assert.equal(shared?.expr.kind, 'string')
  assert.equal(shared?.expr.text, 'shared')
  // `...` variants: a ternary helper is one opaque range, not a guessed tree.
  const opaque = parseProgramCst('root = Col([a])\na = cond ? Text("x") : Text("y")')
  assert.equal(opaque.problem, undefined)
  assert.equal(opaque.statements[1]?.expr.kind, 'opaque')
  assert.equal(opaque.statements[1]?.expr.problem?.code, 'unsupported_syntax')
  // @Each is a call with an array argument, a loop name and a template expression.
  const scoped = parseProgramCst(SCOPED_PROGRAM)
  const listCard = scoped.statements.find(statement => statement.name === 'listCard')
  const each = listCard?.expr.items?.[0]?.items?.[1]?.items?.[0]
  assert.equal(each?.kind, 'call')
  assert.equal(each?.name, '@Each')
  assert.equal(each?.items?.[1]?.text, 'item')
  assert.equal(each?.items?.[2]?.name, 'Text')
  // Unsupported statement lines and duplicate declarations are rejected loudly.
  expectFailure({ ok: false, ...(parseProgramCst('not a statement').problem ?? { code: 'missing', message: 'missing' }) }, 'unsupported_syntax')
  expectFailure({ ok: false, ...(parseProgramCst('root = Col([a])\nroot = Col([b])').problem ?? { code: 'missing', message: 'missing' }) }, 'duplicate_statement')
})

test('buildArtifactTree maps nested Col/Card children with deterministic ids, paths, slots and digests', () => {
  assert.equal(NESTED_TREE.limitsExceeded, undefined)
  assert.deepEqual(NESTED_TREE.problems, [])
  assert.deepEqual(NESTED_TREE.order, NESTED_IDS)
  assert.deepEqual(NESTED_TREE.stats, { nodeCount: 10, maxDepth: 3 })
  assert.equal(node(NESTED_TREE, 'n1').componentType, 'Col')
  assert.equal(node(NESTED_TREE, 'n1').nodePath, 'root')
  assert.equal(node(NESTED_TREE, 'n1').parentNodeId, undefined)
  assert.equal(node(NESTED_TREE, 'n1').editable, false)
  assert.equal(node(NESTED_TREE, 'n2').componentType, 'Card')
  assert.equal(node(NESTED_TREE, 'n2').statementId, 'outerCard')
  assert.equal(node(NESTED_TREE, 'n2').parentNodeId, 'n1')
  assert.equal(node(NESTED_TREE, 'n2').depth, 1)
  assert.equal(node(NESTED_TREE, 'n2').nodePath, 'root/children[0]')
  assert.equal(node(NESTED_TREE, 'n2').slotKey, 'children')
  assert.deepEqual(node(NESTED_TREE, 'n2').children, ['n3', 'n4'])
  assert.deepEqual(node(NESTED_TREE, 'n2').childSlots.children, ['n3', 'n4'])
  assert.equal(node(NESTED_TREE, 'n3').chrome, true)
  assert.equal(node(NESTED_TREE, 'n3').editable, false)
  assert.equal(node(NESTED_TREE, 'n4').componentType, 'Col')
  assert.equal(node(NESTED_TREE, 'n4').depth, 2)
  assert.equal(node(NESTED_TREE, 'n4').nodePath, 'root/children[0]/children[1]')
  assert.deepEqual(node(NESTED_TREE, 'n4').children, ['n5', 'n6', 'n7'])
  assert.equal(node(NESTED_TREE, 'n5').nodePath, 'root/children[0]/children[1]/children[0]')
  assert.equal(node(NESTED_TREE, 'n5').componentType, 'Text')
  assert.equal(node(NESTED_TREE, 'n10').componentType, 'Row')
  assert.deepEqual(node(NESTED_TREE, 'n10').children, [], 'Row is not a container for the default whitelist')
  for (const nodeId of NESTED_TREE.order) {
    const entry = node(NESTED_TREE, nodeId)
    assert.equal(NESTED_PROGRAM.slice(entry.range.start, entry.range.end), entry.source)
    assert.equal(entry.digest, digestSource(entry.contentSource))
  }
  const rebuilt = buildArtifactTree(NESTED_PROGRAM)
  for (const nodeId of NESTED_TREE.order) assert.deepEqual(node(rebuilt, nodeId), node(NESTED_TREE, nodeId))
  assert.equal(NESTED_TREE.outline.length, NESTED_TREE.order.length - 1)
  assert.equal(NESTED_TREE.outline.find(entry => entry.nodeId === 'n4')?.nodePath, 'root/children[0]/children[1]')
  // The container whitelist is a parameter: Row can become a container.
  const wide = buildArtifactTree(NESTED_PROGRAM, { containerTypes: [...DEFAULT_CONTAINER_TYPES, 'Row'] })
  assert.deepEqual(node(wide, 'n10').children, ['n11', 'n12'])
  assert.equal(wide.stats.nodeCount, 12)
  // Revision-scoped binding is carried on the tree.
  assert.equal(buildArtifactTree(NESTED_PROGRAM, { baseRevisionId: 'rev-1' }).baseRevisionId, 'rev-1')
})

test('replaceNode rewrites one nested Text and proves every untouched subtree is byte-identical', () => {
  const result = expectOk(replaceNode(NESTED_PROGRAM, 'n5', 'Text("A2", "sm")'))
  const lines = result.program.split('\n')
  assert.match(lines[1], /Col\(\[Text\("A2", "sm"\), Text\("B", "sm"\), Text\(sharedText, "sm"\)\]\)/)
  assert.equal(lines[2], NESTED_PROGRAM.split('\n')[2], 'the second card statement is untouched')
  assert.equal(lines[3], NESTED_PROGRAM.split('\n')[3], 'the helper statement is untouched')
  assert.ok(result.touched.some(entry => entry.nodeId === 'n5' && entry.op === 'replace'))
  const unchanged = new Map(result.unchanged.map(entry => [entry.nodeId, entry]))
  for (const nodeId of ['n3', 'n6', 'n7', 'n8', 'n9', 'n10']) assert.ok(unchanged.has(nodeId), `${nodeId} stays untouched`)
  for (const entry of result.unchanged) {
    assert.equal(entry.source, node(NESTED_TREE, entry.nodeId).contentSource)
    assert.equal(entry.digest, node(NESTED_TREE, entry.nodeId).digest)
    assert.ok(result.program.includes(entry.source), `unchanged source of ${entry.nodeId} is preserved verbatim`)
  }
  expectOk(inspectProgramStructure(result.program))
  assert.equal(result.tree.limitsExceeded, undefined)
  assert.match(result.edits[0].summary, /^Text\("A2", "sm"\)$/)
  // Replacing a node with its current source is a verified no-op.
  const same = expectOk(replaceNode(NESTED_PROGRAM, 'n5', 'Text("A", "sm")'))
  assert.equal(same.program, NESTED_PROGRAM)
  assert.deepEqual(same.touched, [])
  // Replacing a named root block replaces only its reference, keeping the definition as an orphan.
  const named = expectOk(replaceNode(NESTED_PROGRAM, 'n2', 'Card([Title("Inline", "sm")])'))
  assert.match(named.program.split('\n')[0], /root = Col\(\[Card\(\[Title\("Inline", "sm"\)\]\), secondCard\]\)/)
  expectOk(inspectProgramStructure(named.program))
})

test('replaceNode rejects unsafe replacements, protected nodes and stale identity bindings', () => {
  expectFailure(replaceNode(NESTED_PROGRAM, 'n5', 'cond ? Text("a") : Text("b")'), 'invalid_source')
  expectFailure(replaceNode(NESTED_PROGRAM, 'n5', 'Text("unterminated'), 'invalid_source')
  expectFailure(replaceNode(NESTED_PROGRAM, 'n5', 'WrongComponent("x")'), 'parse_error')
  expectFailure(replaceNode(NESTED_PROGRAM, 'n5', 'Text(@Format(mystery, "number", 0), "sm")'), 'unknown_reference')
  expectFailure(replaceNode(NESTED_PROGRAM, 'n1', 'Col([Title("x")])'), 'cannot_edit_root')
  expectFailure(replaceNode(NESTED_PROGRAM, 'n3', 'Title("moved", "sm")'), 'unsupported_chrome')
  expectFailure(replaceNode(NESTED_PROGRAM, 'n99', 'Text("x", "sm")'), 'unknown_node')
  const tampered = structuredClone(NESTED_TREE)
  tampered.nodes.get('n5').digest = 'deadbeef'
  expectFailure(replaceNode(NESTED_PROGRAM, 'n5', 'Text("ok", "sm")', { tree: tampered }), 'digest_mismatch')
  expectFailure(replaceNode(NESTED_PROGRAM, 'n5', 'Text("ok", "sm")', { tree: buildArtifactTree(ANCHOR_PROGRAM) }), 'digest_mismatch')
  expectFailure(
    replaceNode(NESTED_PROGRAM, 'n5', 'Text("ok", "sm")', {
      tree: buildArtifactTree(NESTED_PROGRAM, { baseRevisionId: 'rev-1' }),
      baseRevisionId: 'rev-2',
    }),
    'revision_mismatch',
  )
  expectOk(inspectProgramStructure(NESTED_PROGRAM))
})

test('reorderChildren permutes one same-parent slot and rejects illegal orders', () => {
  const result = expectOk(reorderChildren(NESTED_PROGRAM, 'n4', 'children', ['n7', 'n5', 'n6']))
  assert.match(result.program.split('\n')[1], /Col\(\[Text\(sharedText, "sm"\), Text\("A", "sm"\), Text\("B", "sm"\)\]\)/)
  assert.equal(result.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2], 'the other card keeps its source bytes')
  assert.ok(result.touched.some(entry => entry.nodeId === 'n4' && entry.op === 'reorder'))
  for (const nodeId of ['n3', 'n8', 'n9', 'n10']) assert.ok(result.unchanged.some(entry => entry.nodeId === nodeId), nodeId)
  expectOk(inspectProgramStructure(result.program))
  // Idempotent against the rebuilt tree: permuting the current order is a no-op.
  const rebuilt = result.tree
  const innerColId = rebuilt.outline.find(entry => entry.componentType === 'Col' && entry.depth === 2).nodeId
  const current = node(rebuilt, innerColId).children
  const idempotent = expectOk(reorderChildren(result.program, innerColId, 'children', current))
  assert.equal(idempotent.program, result.program)
  assert.deepEqual(idempotent.touched, [])
  // Rejections.
  expectFailure(reorderChildren(NESTED_PROGRAM, 'n4', 'children', ['n5', 'n6']), 'invalid_order')
  expectFailure(reorderChildren(NESTED_PROGRAM, 'n4', 'children', ['n5', 'n6', 'n6']), 'invalid_order')
  expectFailure(reorderChildren(NESTED_PROGRAM, 'n4', 'children', ['n5', 'n6', 'n99']), 'unknown_node')
  expectFailure(reorderChildren(NESTED_PROGRAM, 'n4', 'template', ['n5', 'n6', 'n7']), 'unknown_slot')
  expectFailure(reorderChildren(NESTED_PROGRAM, 'n5', 'children', []), 'incompatible_container')
  expectFailure(reorderChildren(NESTED_PROGRAM, 'n99', 'children', []), 'unknown_node')
})

test('removeNode deletes leaves or whole subtrees while unrelated source stays byte-identical', () => {
  const leaf = expectOk(removeNode(NESTED_PROGRAM, 'n5'))
  assert.match(leaf.program.split('\n')[1], /Col\(\[Text\("B", "sm"\), Text\(sharedText, "sm"\)\]\)/)
  assert.equal(leaf.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2])
  assert.ok(leaf.unchanged.some(entry => entry.nodeId === 'n3'))
  assert.ok(leaf.unchanged.some(entry => entry.nodeId === 'n8'))
  expectOk(inspectProgramStructure(leaf.program))
  const parent = expectOk(removeNode(NESTED_PROGRAM, 'n4'))
  assert.match(parent.program.split('\n')[1], /Card\(\[Title\("外层卡片", "sm"\)\]\)/)
  assert.equal(parent.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2])
  assert.equal(
    [...parent.tree.nodes.values()].some(entry => entry.componentType === 'Col' && entry.depth === 2),
    false,
    'the removed container is absent from the rebuilt tree',
  )
  expectFailure(removeNode(NESTED_PROGRAM, 'n1'), 'cannot_edit_root')
  expectFailure(removeNode(NESTED_PROGRAM, 'n3'), 'unsupported_chrome')
  expectFailure(removeNode(NESTED_PROGRAM, 'n99'), 'unknown_node')
})

test('duplicateNode clones inline expressions and named root blocks with unique names', () => {
  const inline = expectOk(duplicateNode(NESTED_PROGRAM, 'n5', 'n4', 'children', 3))
  assert.match(inline.program.split('\n')[1], /Col\(\[Text\("A", "sm"\), Text\("B", "sm"\), Text\(sharedText, "sm"\), Text\("A", "sm"\)\]\)/)
  assert.equal(inline.tree.stats.nodeCount, NESTED_TREE.stats.nodeCount + 1)
  assert.equal([...inline.tree.nodes.values()].filter(entry => entry.componentType === 'Text' && entry.source === 'Text("A", "sm")').length, 2)
  assert.equal(inline.program.split('\n')[2], NESTED_PROGRAM.split('\n')[2])
  expectOk(inspectProgramStructure(inline.program))
  const named = expectOk(duplicateNode(NESTED_PROGRAM, 'n2', 'n1', 'children', 2))
  const lines = named.program.split('\n')
  assert.match(lines[0], /root = Col\(\[outerCard, secondCard, outerCard_copy1\]\)/)
  assert.equal(lines[4], `outerCard_copy1 = ${NESTED_PROGRAM.split('\n')[1].split(' = ')[1]}`)
  const copy = [...named.tree.nodes.values()].find(entry => entry.statementId === 'outerCard_copy1')
  assert.ok(copy !== undefined)
  assert.equal(copy.componentType, 'Card')
  expectOk(inspectProgramStructure(named.program))
  expectFailure(duplicateNode(NESTED_PROGRAM, 'n1', 'n4', 'children', 0), 'cannot_edit_root')
  expectFailure(duplicateNode(NESTED_PROGRAM, 'n3', 'n4', 'children', 0), 'unsupported_chrome')
  expectFailure(duplicateNode(NESTED_PROGRAM, 'n5', 'n3', 'children', 0), 'incompatible_container')
  expectFailure(duplicateNode(NESTED_PROGRAM, 'n5', 'n4', 'children', 9), 'invalid_index')
  expectFailure(duplicateNode(NESTED_PROGRAM, 'n5', 'n4', 'template', 0), 'unknown_slot')
})

test('duplicateNode refuses Section anchors and @Each scoped subtrees', () => {
  const anchor = buildArtifactTree(ANCHOR_PROGRAM)
  const anchorCol = anchor.outline.find(entry => entry.componentType === 'Col')
  assert.ok(anchorCol !== undefined)
  expectFailure(duplicateNode(ANCHOR_PROGRAM, anchorCol.nodeId, 'n2', 'children', 1), 'duplicate_anchor_unsupported')
  const scoped = buildArtifactTree(SCOPED_PROGRAM)
  const template = [...scoped.nodes.values()].find(entry => entry.scoped)
  assert.ok(template !== undefined)
  expectFailure(duplicateNode(SCOPED_PROGRAM, template.nodeId, 'n2', 'children', 1), 'unsupported_scope')
  const each = [...scoped.nodes.values()].find(entry => entry.componentType === '@Each')
  assert.ok(each !== undefined)
  const eachResult = duplicateNode(SCOPED_PROGRAM, each.nodeId, 'n2', 'children', 1)
  assert.equal(eachResult.ok, false)
  if (!eachResult.ok) assert.ok(['unsupported_scope', 'unsupported_opaque'].includes(eachResult.code))
  const dynamicCol = scoped.outline.find(entry => entry.componentType === 'Col' && entry.depth === 2)
  assert.ok(dynamicCol !== undefined)
  expectFailure(duplicateNode(SCOPED_PROGRAM, dynamicCol.nodeId, 'n2', 'children', 1), 'unsupported_scope')
})

test('moveNode moves between sibling containers and refuses illegal targets', () => {
  const wide = buildArtifactTree(NESTED_PROGRAM, { containerTypes: [...DEFAULT_CONTAINER_TYPES, 'Row'] })
  assert.deepEqual(node(wide, 'n10').children, ['n11', 'n12'])
  const moved = expectOk(moveNode(NESTED_PROGRAM, 'n5', 'n10', 'children', 0, { containerTypes: [...DEFAULT_CONTAINER_TYPES, 'Row'] }))
  const lines = moved.program.split('\n')
  assert.match(lines[1], /Col\(\[Text\("B", "sm"\), Text\(sharedText, "sm"\)\]\)/)
  assert.match(lines[2], /Row\(\[Text\("A", "sm"\), Text\("C", "sm"\), Text\("D", "sm"\)\]\)/)
  assert.ok(moved.unchanged.some(entry => entry.nodeId === 'n3'))
  assert.ok(moved.unchanged.some(entry => entry.nodeId === 'n9'))
  expectOk(inspectProgramStructure(moved.program, { containerTypes: [...DEFAULT_CONTAINER_TYPES, 'Row'] }))
  // Same-parent move matches the reorder path.
  const same = expectOk(moveNode(NESTED_PROGRAM, 'n5', 'n4', 'children', 2))
  const reordered = expectOk(reorderChildren(NESTED_PROGRAM, 'n4', 'children', ['n6', 'n7', 'n5']))
  assert.equal(same.program, reordered.program)
  const noop = expectOk(moveNode(NESTED_PROGRAM, 'n5', 'n4', 'children', 0))
  assert.equal(noop.program, NESTED_PROGRAM)
  assert.deepEqual(noop.touched, [])
  // Moving into its own descendant is rejected.
  const nested = 'root = Col([outer])\nouter = Col([inner])\ninner = Card([Text("x")])'
  const nestedTree = buildArtifactTree(nested)
  const outerId = nestedTree.outline.find(entry => entry.componentType === 'Col').nodeId
  const innerId = nestedTree.outline.find(entry => entry.componentType === 'Card').nodeId
  expectFailure(moveNode(nested, outerId, innerId, 'children', 0), 'move_into_self')
  // Ancestor/descendant container moves are not wrestled with in this spike.
  expectFailure(moveNode(NESTED_PROGRAM, 'n5', 'n1', 'children', 0), 'unsupported_move_nested')
  // @Each template nodes cannot leave their runtime scope.
  const scoped = buildArtifactTree(SCOPED_PROGRAM)
  const template = [...scoped.nodes.values()].find(entry => entry.scoped)
  expectFailure(moveNode(SCOPED_PROGRAM, template.nodeId, 'n1', 'children', 0), 'unsupported_scope')
  // Incompatible target container and invalid index.
  expectFailure(moveNode(NESTED_PROGRAM, 'n5', 'n3', 'children', 0), 'incompatible_container')
  expectFailure(moveNode(NESTED_PROGRAM, 'n5', 'n4', 'children', 9), 'invalid_index')
})

test('structure limits, opaque syntax and oversized programs are rejected', () => {
  const tiny = buildArtifactTree(NESTED_PROGRAM, { maxNodes: 2 })
  assert.equal(tiny.limitsExceeded, 'too_many_nodes')
  expectFailure(replaceNode(NESTED_PROGRAM, 'n5', 'Text("x", "sm")', { maxNodes: 2 }), 'too_many_nodes')
  expectFailure(replaceNode(NESTED_PROGRAM, 'n5', 'Text("x", "sm")', { maxDepth: 1 }), 'too_deep')
  const huge = `${' '.repeat(MAX_CST_PROGRAM_CHARS + 1)}\nroot = Col([Title("x")])`
  expectFailure(replaceNode(huge, 'n1', 'Col([])'), 'program_too_large')
  const deep = 'root = Col([a])\na = Card([Col([a2])])\na2 = Card([Col([a3])])\na3 = Card([Col([a4])])\na4 = Card([Col([a5])])\na5 = Text("x")'
  assert.equal(buildArtifactTree(deep).limitsExceeded, 'too_deep')
})

test('applyOperations is atomic, order-stable and bounded', () => {
  const edits = [
    { op: 'replace', nodeId: 'n5', source: 'Text("A2", "sm")' },
    { op: 'replace', nodeId: 'n7', source: 'Text("shared2", "sm")' },
  ]
  const batch = expectOk(applyOperations(NESTED_PROGRAM, edits))
  assert.match(batch.program.split('\n')[1], /Text\("A2", "sm"\)/)
  assert.match(batch.program.split('\n')[1], /Text\("shared2", "sm"\)/)
  assert.equal(batch.tree.limitsExceeded, undefined)
  expectOk(inspectProgramStructure(batch.program))
  // Non-overlapping edits do not depend on operation order.
  const reversed = expectOk(applyOperations(NESTED_PROGRAM, [...edits].reverse()))
  assert.equal(reversed.program, batch.program)
  // Mixed reorder + replace in one verified commit.
  const mixed = expectOk(applyOperations(NESTED_PROGRAM, [
    { op: 'reorder', parentNodeId: 'n4', slotKey: 'children', order: ['n7', 'n5', 'n6'] },
    { op: 'replace', nodeId: 'n10', source: 'Row([Text("C2", "sm"), Text("D", "sm")])' },
  ]))
  assert.match(mixed.program.split('\n')[1], /Col\(\[Text\(sharedText, "sm"\)/)
  assert.match(mixed.program.split('\n')[2], /Row\(\[Text\("C2", "sm"\)/)
  // Overlapping edits are rejected atomically.
  expectFailure(applyOperations(NESTED_PROGRAM, [
    { op: 'replace', nodeId: 'n5', source: 'Text("A2", "sm")' },
    { op: 'replace', nodeId: 'n5', source: 'Text("A3", "sm")' },
  ]), 'operation_conflict')
  // A failed later operation rejects the whole batch (the engine is pure).
  expectFailure(applyOperations(NESTED_PROGRAM, [
    { op: 'replace', nodeId: 'n5', source: 'Text("A2", "sm")' },
    { op: 'remove', nodeId: 'n99' },
  ]), 'unknown_node')
  const tooMany = Array.from({ length: MAX_CST_OPERATIONS + 1 }, () => ({
    op: 'reorder',
    parentNodeId: 'n4',
    slotKey: 'children',
    order: ['n5', 'n6', 'n7'],
  }))
  expectFailure(applyOperations(NESTED_PROGRAM, tooMany), 'too_many_operations')
  expectFailure(applyOperations(NESTED_PROGRAM, []), 'invalid_operation')
})

test('collectSymbols and inspectProgramStructure expose declarations, references and @Each locals', () => {
  const parsed = parseProgramCst(NESTED_PROGRAM)
  const symbols = collectSymbols(parsed)
  assert.deepEqual(symbols.declared, ['root', 'outerCard', 'secondCard', 'sharedText'])
  assert.deepEqual(symbols.states, [])
  assert.ok(symbols.refs.some(ref => ref.name === 'sharedText'))
  assert.ok(symbols.refs.some(ref => ref.name === 'secondCard'))
  const inspected = expectOk(inspectProgramStructure(NESTED_PROGRAM))
  assert.equal(inspected.tree.stats.nodeCount, 10)
  const scopedSymbols = collectSymbols(parseProgramCst(SCOPED_PROGRAM))
  assert.ok(scopedSymbols.eachLocals.some(local => local.name === 'item'))
  expectOk(inspectProgramStructure(SCOPED_PROGRAM))
  expectFailure(inspectProgramStructure('root = Col([card])\ncard = Card([Text(@Format(mystery, "number", 0))])'), 'unknown_reference')
  expectFailure(inspectProgramStructure('root = Card([Text("x")])'), 'root_not_col')
  expectFailure(inspectProgramStructure('root = Col([a])\na = Text("x"'), 'parse_error')
})
