/** M4-5 performance smoke: large nested pages stay within interactive budgets. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildArtifactTree, insertNode, reorderChildren } from '../../src/shared/program-cst.ts'
import { nestedBlocksForProgram } from '../../src/client/artifact-edit/nested.ts'
import { NESTED_CONTAINER_TYPES } from '../../src/shared/artifact-containers.ts'

/** A page with 60 editable blocks: 10 cards, each holding a Col with 5 texts. */
function largeProgram() {
  const cards = Array.from({ length: 7 }, (_, index) => `card${index}`)
  const statements = cards.map((statement, index) =>
    `${statement} = Card([Title("Card ${index}", "sm"), col${index}])`)
  const cols = Array.from({ length: 7 }, (_, index) => {
    const texts = Array.from({ length: 5 }, (_, child) => 'Text("card ' + index + ' item ' + child + '", "sm")').join(', ')
    return 'col' + index + ' = Col([' + texts + '])'
  })
  return [`root = Col([${cards.join(', ')}])`, ...statements, ...cols].join('\n')
}

const program = largeProgram()
const options = { containerTypes: [...NESTED_CONTAINER_TYPES] }

test('large nested page tree and display mapping stay fast', () => {
  const started = performance.now()
  const tree = buildArtifactTree(program, options)
  const mapped = nestedBlocksForProgram(program)
  const elapsed = performance.now() - started
  assert.equal(tree.limitsExceeded, undefined)
  assert.ok(tree.stats.nodeCount >= 55)
  assert.ok(mapped !== undefined && mapped.blocks.length >= 49)
  assert.equal(mapped.hasNested, true)
  assert.ok(elapsed < 2000, `tree+nested mapping took ${Math.round(elapsed)}ms`)
})

test('large page edits stay bounded', () => {
  const tree = buildArtifactTree(program, options)
  const text = [...tree.nodes.values()].find(node => node.componentType === 'Text')
  assert.ok(text)
  const started = performance.now()
  const inserted = insertNode(program, tree.rootNodeId, 'children', 0, 'Text("inserted", "sm")', { ...options, tree })
  assert.equal(inserted.ok, true)
  const firstCard = [...tree.nodes.values()].find(node => node.componentType === 'Card')
  assert.ok(firstCard)
  const order = firstCard.children
  const reordered = reorderChildren(program, firstCard.nodeId, 'children', [...order].reverse(), { ...options, tree })
  assert.equal(reordered.ok, true)
  const elapsed = performance.now() - started
  assert.ok(elapsed < 2000, `insert+reorder took ${Math.round(elapsed)}ms`)
})
