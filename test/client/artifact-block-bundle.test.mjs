/**
 * Unit tests for the Phase-1 block sub-program bundle: slicing selected block
 * expressions + frozen dependencies, and splicing a model mini program back
 * into the unchanged page.
 *
 * Run: node --test test/client/artifact-block-bundle.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DST_PROGRAM } from '../browser/fixtures/dst-artifact.ts'
import { extractBlockBundle, spliceBlockBundle } from '../../src/shared/artifact-block-bundle.ts'
import { extractArtifactBlocks, readRootLayout } from '../../src/shared/artifact-blocks.ts'

/** Base fixture root and statement tail, for byte-preservation checks. */
const DST_ROOT = readRootLayout(DST_PROGRAM)
if (DST_ROOT === undefined) throw new Error('DST fixture has no root layout')

const CLOCK_FRAGMENT = `root = Col([Card([Title("同一时刻，两个读数", "sm"), Text("新的说明。", "sm"), SegmentedControl($clock, ["冬令时", "夏令时"], true), clockSvg, clockNote])])`

const SMALL_BASE = `root = Col([title, cardA, Caption("note"), cardB], 2)
title = Title("Page")
cardA = Card([Title("A", "sm")])
cardB = Card([Title("B", "sm")])`

test('extracts selected block expressions and their frozen dependency closure', () => {
  const bundle = extractBlockBundle(DST_PROGRAM, ['b3', 'b5'])
  assert.ok(bundle !== undefined)
  assert.deepEqual(bundle.blocks.map(block => block.blockId), ['b3', 'b5'])
  const [clock, rules] = bundle.blocks
  assert.equal(clock.componentType, 'Card')
  assert.equal(clock.title, '同一时刻，两个读数')
  assert.equal(clock.statementId, 'clockCard')
  assert.match(clock.source, /^Card\(\[Title\("同一时刻，两个读数"/)
  assert.doesNotMatch(clock.source, /^clockCard/)
  assert.equal(rules.componentType, 'Table')
  assert.equal(rules.statementId, 'rulesTable')
  assert.match(rules.source, /^Table\(\["地区"/)
  // The selected statements are replaced, never frozen context.
  assert.deepEqual(bundle.frozenStatements.map(statement => statement.name), ['clockAngle', 'clockSvg', 'clockNote'])
  assert.ok(bundle.frozenStatements.every(statement => statement.source.startsWith(`${statement.name} = `)))
  assert.deepEqual(bundle.stateSources, ['$clock = "冬令时"'])
  assert.deepEqual(bundle.outline.map(entry => entry.blockId), ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'])
  assert.deepEqual(bundle.outline.map(entry => entry.componentType), ['Col', 'Card', 'Card', 'Card', 'Table', 'Card', 'Card', 'Table'])
})

test('resolves transitive statement and state dependencies conservatively', () => {
  const bundle = extractBlockBundle(DST_PROGRAM, ['b4'])
  assert.ok(bundle !== undefined)
  const frozen = bundle.frozenStatements.map(statement => statement.name)
  for (const name of ['monthStrip', 'selDetail', 'active', 'detailText']) assert.ok(frozen.includes(name), name)
  assert.equal(frozen.includes('monthCard'), false, 'the selected block itself stays out of the frozen context')
  assert.deepEqual(bundle.stateSources, ['$region = "欧盟"', '$month = 10'])
})

test("keeps the caller's block order, resolves inline children and rejects unusable slices", () => {
  const reversed = extractBlockBundle(DST_PROGRAM, ['b5', 'b3'])
  assert.deepEqual(reversed.blocks.map(block => block.blockId), ['b5', 'b3'])
  assert.equal(reversed.blocks[0].statementId, 'rulesTable')
  const inline = `root = Col([Title("Heading"), Card([Title("Inline", "sm"), Text("body")])])`
  const bundle = extractBlockBundle(inline, ['b1'])
  assert.ok(bundle !== undefined)
  assert.equal(bundle.blocks[0].statementId, undefined)
  assert.equal(bundle.blocks[0].source, 'Card([Title("Inline", "sm"), Text("body")])')
  assert.deepEqual(bundle.frozenStatements, [])
  assert.equal(extractBlockBundle(DST_PROGRAM, []), undefined)
  assert.equal(extractBlockBundle(DST_PROGRAM, ['b99']), undefined)
  assert.equal(extractBlockBundle(DST_PROGRAM, ['b3', 'b3']), undefined)
  assert.equal(extractBlockBundle('root = Markdown("plain")', ['b1']), undefined)
})

test('splices one block expression into its slot and preserves every other root child and statement', () => {
  const result = spliceBlockBundle(DST_PROGRAM, ['b3'], CLOCK_FRAGMENT)
  assert.equal(result.ok, true)
  const composedRoot = readRootLayout(result.program)
  assert.ok(composedRoot !== undefined)
  assert.equal(composedRoot.children.length, DST_ROOT.children.length)
  DST_ROOT.children.forEach((child, index) => {
    if (index === 2) assert.match(composedRoot.children[index], /^Card\(\[Title\("同一时刻，两个读数"/)
    else assert.equal(composedRoot.children[index], child, `root child ${index} stays byte-identical`)
  })
  assert.equal(composedRoot.tail, DST_ROOT.tail)
  // No helper statements: the statement tail is untouched apart from the trailing newline.
  assert.equal(result.program.slice(composedRoot.end).replace(/\n$/, ''), DST_PROGRAM.slice(DST_ROOT.end).replace(/\n$/, ''))
  const extraction = extractArtifactBlocks(result.program)
  assert.equal(extraction.unsupported, undefined)
  assert.equal(extraction.blocks.length, 8)
  assert.equal(result.program, spliceBlockBundle(DST_PROGRAM, ['b3'], CLOCK_FRAGMENT).program, 'deterministic')
})

test('replaces two slots in blockIds order and appends the new helper statement', () => {
  const fragment = `root = Col([newAnswer, Table(["Year"], [[2024]])])
newAnswer = Card([Title("一句话版本", "sm"), Text("更新后的说明。", "sm")])`
  const result = spliceBlockBundle(DST_PROGRAM, ['b2', 'b5'], fragment)
  assert.equal(result.ok, true)
  const composedRoot = readRootLayout(result.program)
  assert.ok(composedRoot !== undefined)
  assert.equal(composedRoot.children[1], 'newAnswer')
  assert.equal(composedRoot.children[4], 'Table(["Year"], [[2024]])')
  assert.equal(composedRoot.children[0], DST_ROOT.children[0])
  assert.equal(composedRoot.children[2], DST_ROOT.children[2])
  assert.match(result.program, /\nnewAnswer = Card\(\[Title\("一句话版本", "sm"\), Text\("更新后的说明。", "sm"\)\]\)\n$/)
  assert.equal(extractArtifactBlocks(result.program).blocks.length, 8)
})

test('preserves chrome slots, root arguments and base statements in a small page', () => {
  const fragment = `root = Col([Card([Title("A2", "sm")]), Card([Title("B", "sm")])])`
  const result = spliceBlockBundle(SMALL_BASE, ['b1', 'b2'], fragment)
  assert.equal(result.ok, true)
  assert.match(result.program, /^root = Col\(\[title, Card\(\[Title\("A2", "sm"\)\]\), Caption\("note"\), Card\(\[Title\("B", "sm"\)\]\)\], 2\)\n/)
  assert.match(result.program, /\ntitle = Title\("Page"\)\ncardA = Card\(\[Title\("A", "sm"\)\]\)\ncardB = Card\(\[Title\("B", "sm"\)\]\)\n$/)
  assert.equal(extractArtifactBlocks(result.program).blocks.length, 2)
})

test('a fragment may use base state and define its own helper statement', () => {
  const fragment = `root = Col([Card([Title("State", "sm"), Text("count " + $count + " items"), note])])
note = Text("helper body", "sm")`
  const result = spliceBlockBundle(`root = Col([view])\n$count = 3\nview = Card([Text("old")])`, ['b1'], fragment)
  assert.equal(result.ok, true)
  assert.match(result.program, /note = Text\("helper body", "sm"\)/)
  assert.equal(extractArtifactBlocks(result.program).blocks.length, 1)
})

test('rejects a fragment that is not one expression per selected block', () => {
  for (const [blockIds, fragment, expected] of [
    [['b3', 'b5'], 'root = Col([Card([Title("x")])])', /fragment_block_count_mismatch:expected 2 got 1/],
    [['b3'], 'root = Card([Text("x")])', /fragment_root_not_col/],
    [['b3'], 'root = Col([', /fragment_(parse_error|incomplete)/],
    [['b3'], 'root = Col([Caption("only chrome")])', /composed_block_count_mismatch:expected 8 got 7/],
    [['b3'], 'root = Col([null])', /fragment_block_count_mismatch/],
  ]) {
    const result = spliceBlockBundle(DST_PROGRAM, blockIds, fragment)
    assert.equal(result.ok, false, fragment)
    if (result.ok) continue
    assert.match(result.error, expected)
  }
})

test('rejects unknown or duplicate block ids and helper name collisions', () => {
  assert.deepEqual(spliceBlockBundle(DST_PROGRAM, ['b99'], CLOCK_FRAGMENT), { ok: false, error: 'unknown_block:b99' })
  assert.deepEqual(spliceBlockBundle(DST_PROGRAM, ['b3', 'b3'], CLOCK_FRAGMENT), { ok: false, error: 'duplicate_block_ids' })
  assert.deepEqual(spliceBlockBundle(DST_PROGRAM, [], CLOCK_FRAGMENT), { ok: false, error: 'no_blocks' })
  for (const name of ['clockSvg', 'monthCard', '$clock']) {
    const fragment = `root = Col([Card([Title("x")])])\n${name} = Text("shadow")`
    const result = spliceBlockBundle(DST_PROGRAM, ['b3'], fragment)
    assert.equal(result.ok, false, name)
    if (!result.ok) assert.equal(result.error, `helper_name_collision:${name}`)
  }
})

test('object-literal keys and @Each loop variables are not undefined references', () => {
  const base = `root = Col([view])
$items = [{label: "A"}]
view = Card([Text("old")])`
  const chart = 'root = Col([Card([Title("Data", "sm"), Chart("bar", [{label: "A", value: 2}], "label", ["value"])])])'
  assert.equal(spliceBlockBundle(base, ['b1'], chart).ok, true, 'object keys label/value are not references')
  const each = 'root = Col([Card([Row(@Each($items, "item", Text(item.label + "")))])])'
  assert.equal(spliceBlockBundle(base, ['b1'], each).ok, true, 'the @Each loop variable is local')
})

test('rejects fragment references that will not exist in the composed page', () => {
  for (const [fragment, expected] of [
    ['root = Col([Card([Text(@Format(missingName, "number", 0))])])', 'undefined_identifier:missingName'],
    ['root = Col([Card([Text($missingState)])])', 'undefined_identifier:$missingState'],
    ['root = Col([Card([Text(@Format(root, "number", 0))])])', 'undefined_identifier:root'],
    ['root = Col([Card([Text("string content is not a reference")])])', undefined],
    ['root = Col([Card([Title("ok", "sm"), Text(@Format($month, "number", 0))])])', undefined],
  ]) {
    const result = spliceBlockBundle(DST_PROGRAM, ['b3'], fragment)
    if (expected === undefined) {
      assert.equal(result.ok, true, fragment)
      continue
    }
    assert.equal(result.ok, false, fragment)
    if (!result.ok) assert.equal(result.error, expected)
  }
})
