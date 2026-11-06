/**
 * Unit tests for Artifact block recognition, program wrapping and the
 * preservation report.
 *
 * Run: node --test test/client/artifact-blocks.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createParser } from '@openuidev/lang-core'
import { readFileSync } from 'node:fs'
import { DST_PROGRAM } from '../browser/fixtures/dst-artifact.ts'
import {
  artifactEditWarnings,
  extractArtifactBlocks,
  reorderProgramToTargetOrder,
  verifyEditTargets,
  wrapProgramForBlockEditing,
} from '../../src/shared/artifact-blocks.ts'

/** The edit-mode parser: the model catalog plus the internal block wrapper. */
function editParser() {
  const spec = JSON.parse(readFileSync(new URL('../../vendor/spec.json', import.meta.url), 'utf8'))
  const schema = structuredClone(spec.schema)
  schema.$defs.BlockSlot = {
    type: 'object',
    properties: {
      blockId: { type: 'string' },
      blockIndex: { type: 'number' },
      children: { type: 'array', items: {} },
    },
    required: ['blockId', 'blockIndex', 'children'],
    additionalProperties: false,
    description: 'internal',
  }
  schema.properties.BlockSlot = { $ref: '#/$defs/BlockSlot' }
  schema.required.push('BlockSlot')
  return createParser(schema, 'Col')
}

test('recognizes the sample artifact blocks in document order', () => {
  const extraction = extractArtifactBlocks(DST_PROGRAM)
  assert.equal(extraction.unsupported, undefined)
  assert.equal(extraction.rootType, 'Col')
  assert.equal(extraction.rootChildCount, 9)
  assert.deepEqual(extraction.blocks.map(block => block.blockId), ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'])
  assert.deepEqual(extraction.blocks.map(block => block.originalIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.deepEqual(extraction.blocks.map(block => block.rootIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(extraction.blocks.map(block => block.title), [
    '夏令时与冬令时',
    '一句话版本',
    '同一时刻，两个读数',
    '一年里什么时候生效',
    '地区 · 切换规则 · 状态',
    '为什么会有这个制度',
    '中国为什么没有夏令时',
    '常见误解 · 实际情况',
    '规则以 2026 年为准。欧盟议会 2019 年表决支持取消，但成员国未达成一致，至今仍在切换。手机和电脑会自动切换，机械表要手动调。',
  ])
  assert.deepEqual(extraction.blocks.map(block => block.nodePath), [
    'root[0]', 'root[1]', 'root[2]', 'root[3]', 'root[4]', 'root[5]', 'root[6]', 'root[7]', 'root[8]',
  ])
  assert.deepEqual(extraction.blocks.map(block => block.componentType), ['Col', 'Card', 'Card', 'Card', 'Table', 'Card', 'Card', 'Table', 'Caption'])
  assert.deepEqual(extraction.blocks.map(block => block.kind), ['container', 'card', 'interactive', 'interactive', 'table', 'card', 'card', 'table', 'caption'])
})

test('wrapped program parses with the edit-mode library and keeps the layout', () => {
  const extraction = extractArtifactBlocks(DST_PROGRAM)
  const wrapped = wrapProgramForBlockEditing(DST_PROGRAM, extraction)
  assert.ok(wrapped)
  assert.match(wrapped, /^root = Col\(\[BlockSlot\("b1", 1, \[head\]\)/)
  assert.match(wrapped, /BlockSlot\("b9", 9, \[footnote\]\)/)
  const result = editParser().parse(wrapped)
  assert.deepEqual(result.meta.errors, [])
  const children = result.root.props.children
  assert.equal(children.length, 9)
  assert.deepEqual(children.map(child => child.typeName), Array(9).fill('BlockSlot'))
  assert.deepEqual(children.map(child => child.props.blockId), ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'])
})

test('article roots expose every direct child, including the title and Toc', () => {
  const program = 'root = Col([Title("Page title", "2xl"), Toc(["One", "Two"]), Section("One", [Markdown("First body")]), Section("Two", [Markdown("Second body")])])'
  const extraction = extractArtifactBlocks(program)
  assert.equal(extraction.unsupported, undefined)
  assert.deepEqual(extraction.blocks.map(block => block.componentType), ['Title', 'Toc', 'Section', 'Section'])
  assert.deepEqual(extraction.blocks.map(block => block.kind), ['heading', 'toc', 'section', 'section'])
  assert.deepEqual(extraction.blocks.map(block => block.title), ['Page title', 'One · Two', 'One', 'Two'])
  const wrapped = wrapProgramForBlockEditing(program, extraction)
  assert.ok(wrapped)
  assert.match(wrapped, /BlockSlot\("b1", 1, \[Title\("Page title"/)
  assert.match(wrapped, /BlockSlot\("b2", 2, \[Toc/)
  assert.match(wrapped, /BlockSlot\("b3", 3, \[Section\("One"/)
  assert.match(wrapped, /BlockSlot\("b4", 4, \[Section\("Two"/)
})

test('unsupported roots expose a reason instead of blocks', () => {
  assert.equal(extractArtifactBlocks('root = Row([Title("x"), Text("y")])').unsupported, 'root_not_col')
  assert.equal(extractArtifactBlocks('').unsupported, 'unparsed')
  const empty = extractArtifactBlocks('root = Col([])')
  assert.equal(empty.unsupported, 'empty_root')
  const captionOnly = extractArtifactBlocks('root = Col([Caption("a"), Caption("b")])')
  assert.equal(captionOnly.blocks.length, 2)
  const singleCaption = extractArtifactBlocks('root = Col([Caption("a")])')
  assert.ok(wrapProgramForBlockEditing('root = Col([Caption("a")])', singleCaption))
})

test('opaque root layout falls back instead of producing a broken wrap', () => {
  const program = 'parts = [Card([Title("A")]), Card([Title("B")])]\nroot = Col(parts)'
  const extraction = extractArtifactBlocks(program)
  // The AST still recognizes the blocks through the statement reference.
  assert.equal(extraction.blocks.length, 2)
  assert.equal(wrapProgramForBlockEditing(program, extraction), undefined)
})

test('verifies edit targets against the recognized blocks', () => {
  const extraction = extractArtifactBlocks(DST_PROGRAM)
  const valid = extraction.blocks.map(block => ({
    blockId: block.blockId,
    nodePath: block.nodePath,
    originalIndex: block.originalIndex,
    componentType: block.componentType,
    ...block.title === undefined ? {} : { title: block.title },
  }))
  assert.equal(verifyEditTargets(extraction, valid), undefined)
  assert.equal(verifyEditTargets(extraction, [{ ...valid[2], nodePath: 'root[7]' }]), 'node_path_mismatch:b3')
  assert.equal(verifyEditTargets(extraction, [{ ...valid[2], originalIndex: 9 }]), 'original_index_mismatch:b3')
  assert.equal(verifyEditTargets(extraction, [{ ...valid[2], componentType: 'Table' }]), 'component_type_mismatch:b3')
  assert.equal(verifyEditTargets(extraction, [{ ...valid[2], title: 'other' }]), 'title_mismatch:b3')
  assert.equal(verifyEditTargets(extraction, [{ ...valid[2], blockId: 'b10' }]), 'unknown_block:b10')
})

test('deterministic reordering moves every root child', () => {
  const extraction = extractArtifactBlocks(DST_PROGRAM)
  const base = extraction.blocks.map(block => block.blockId)
  const target = ['b5', 'b3', ...base.filter(id => id !== 'b5' && id !== 'b3')]
  const reordered = reorderProgramToTargetOrder(DST_PROGRAM, target, extraction)
  assert.ok(reordered)
  const result = editParser().parse(reordered)
  assert.deepEqual(result.meta.errors, [])
  const children = result.root.props.children
  assert.equal(children.length, 9)
  assert.equal(children[0].statementId, 'rulesTable')
  assert.equal(children[1].statementId, 'clockCard')
  assert.equal(children[2].statementId, 'head')
  assert.equal(children[8].statementId, 'footnote')
  assert.equal(children[8].typeName, 'Caption')
  // A model program that kept the same blocks reorders identically.
  const updated = DST_PROGRAM.replace('一句话版本', '一句话概述')
  const updatedReordered = reorderProgramToTargetOrder(updated, target, extraction)
  assert.ok(updatedReordered)
  assert.match(updatedReordered, /一句话概述/)
  // Cannot reorder when a block disappeared or the target hides one.
  assert.equal(reorderProgramToTargetOrder(DST_PROGRAM.replace(/\nmythTable = .*/, ''), target, extraction), undefined)
  assert.equal(reorderProgramToTargetOrder(DST_PROGRAM, target.slice(0, -1), extraction), undefined)
})

test('preservation report names changed unselected blocks only', () => {
  const changed = DST_PROGRAM.replace('一句话版本', '一句话概述')
  const warnings = artifactEditWarnings(DST_PROGRAM, changed, ['b3'])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /Unselected block "一句话版本"/)
  // The explicitly edited block never produces a warning.
  const edited = DST_PROGRAM.replace('同一时刻，两个读数', '两个读数')
  assert.deepEqual(artifactEditWarnings(DST_PROGRAM, edited, ['b3']), [])
  // A dropped block is reported.
  assert.match(artifactEditWarnings(DST_PROGRAM, DST_PROGRAM.replace(/\nmythTable = .*/, ''), []).join('\n'), /Unselected block/)
})

test('anonymous structural blocks keep identity by content when the model reorders', () => {
  const base = `root = Col([Divider("danger"), Divider("info")])`
  const extraction = extractArtifactBlocks(base)
  assert.deepEqual(extraction.blocks.map(block => block.componentType), ['Divider', 'Divider'])
  // The envelope asks the model to reorder; mapping by page order would then
  // invert this swap a second time. Content digest is the real identity.
  const updated = `root = Col([Divider("info"), Divider("danger")])`
  const reordered = reorderProgramToTargetOrder(updated, ['b2', 'b1'], extraction)
  assert.ok(reordered)
  assert.ok(reordered.indexOf('"info"') < reordered.indexOf('"danger"'), 'target order wins over the model page order')
  // Byte-identical duplicates are interchangeable: page order may be kept.
  const twins = `root = Col([Divider(), Divider()])`
  assert.ok(reorderProgramToTargetOrder(twins, ['b2', 'b1'], extractArtifactBlocks(twins)))
})
