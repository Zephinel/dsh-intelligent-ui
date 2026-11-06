/** Unit tests for the M4-1 nested display-block mapping. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NESTED_PROGRAM, SCOPED_PROGRAM } from '../browser/fixtures/nested-artifact.ts'
import { nestedBlocksForProgram } from '../../src/client/artifact-edit/nested.ts'

test('root children keep bN ids and nested children get parent.N ids', () => {
  const map = nestedBlocksForProgram(NESTED_PROGRAM)
  assert.ok(map)
  assert.equal(map.hasNested, true)
  const ids = map.blocks.map(block => block.blockId)
  assert.deepEqual(map.blocks.filter(block => block.depth === 0).map(block => block.blockId), ['b1', 'b2'])
  assert.equal(ids.includes('b1.1'), true, 'the card Title is a nested block')
  assert.equal(ids.includes('b1.2'), true, 'the card Col is a nested block')
  assert.equal(ids.includes('b1.2.1'), true, 'Col children are nested blocks')
  assert.equal(ids.includes('b2.2.1'), true, 'Row children are nested blocks')
  const top = map.blocks.filter(block => block.depth === 0)
  assert.equal(top.length, 2)
  assert.deepEqual(top.map(block => block.nodePath), ['root/children[0]', 'root/children[1]'])
  assert.equal(map.blocks.every(block => typeof block.nodeId === 'string' && block.nodeId.length > 0), true)
  assert.equal(map.blocks.every(block => typeof block.sourceDigest === 'string' && block.sourceDigest.length > 0), true)
})

test('path and node-id maps agree with the display blocks', () => {
  const map = nestedBlocksForProgram(NESTED_PROGRAM)
  assert.ok(map)
  for (const block of map.blocks) {
    assert.equal(map.byNodeId.get(block.nodeId), block)
    assert.equal(map.byPath.get(block.nodePath.replace(/\[(\d+)\]/g, '/$1')), block)
  }
  const nested = map.blocks.find(block => block.blockId === 'b1.2.1')
  assert.ok(nested)
  assert.equal(nested.parentBlockId, 'b1.2')
  assert.equal(nested.depth, 2)
})

test('loop templates are not offered as nested editable blocks', () => {
  const map = nestedBlocksForProgram(SCOPED_PROGRAM)
  assert.ok(map)
  assert.deepEqual(map.blocks.map(block => block.blockId), ['b1', 'b1.1', 'b1.2'])
  assert.deepEqual(map.blocks.map(block => block.componentType), ['Card', 'Title', 'Col'])
  assert.equal(map.blocks.some(block => block.componentType === 'Text'), false, 'the @Each template child stays opaque')
})

test('programs without editable nested children report hasNested false', () => {
  const map = nestedBlocksForProgram('root = Col([Text("a"), Text("b")])')
  assert.ok(map)
  assert.equal(map.hasNested, false)
  assert.equal(map.blocks.length, 2)
})
