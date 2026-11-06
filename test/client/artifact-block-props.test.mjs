/**
 * Unit tests for the deterministic Divider/Spacer property contract and for
 * resolving a display block id to its CST node in both editing modes.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ARTIFACT_BLOCK_COLOR_TOKENS,
  artifactBlockPropsFromNode,
  describeArtifactBlockPropsProblem,
  describeArtifactBlockPropsSupport,
  serializeArtifactBlockProps,
} from '../../src/shared/artifact-block-props.ts'
import { buildArtifactTree } from '../../src/shared/program-cst.ts'
import { extractArtifactBlocks } from '../../src/shared/artifact-blocks.ts'
import { blockPropsState } from '../../src/client/artifact-edit/store.ts'
import { nestedBlocksForProgram } from '../../src/client/artifact-edit/nested.ts'

test('the quick-adjust contract accepts literal props and canonicalizes empty slots', () => {
  assert.equal(describeArtifactBlockPropsProblem('Divider', {}), undefined)
  assert.equal(describeArtifactBlockPropsProblem('Spacer', { width: 12, height: 'auto' }), undefined)
  assert.equal(serializeArtifactBlockProps('Divider', { color: 'info', thickness: 2 }), 'Divider("info", null, 2)')
  assert.equal(serializeArtifactBlockProps('Spacer', {}), 'Spacer()')
  assert.equal(ARTIFACT_BLOCK_COLOR_TOKENS.length, 20)
  assert.equal(ARTIFACT_BLOCK_COLOR_TOKENS.includes('purple'), true)
})

test('only literal, in-domain props are safe for the quick-adjust editor', () => {
  assert.deepEqual(describeArtifactBlockPropsSupport('Divider', {}), { ok: true })
  assert.deepEqual(describeArtifactBlockPropsSupport('Spacer', { width: null, height: 24 }), { ok: true })
  assert.deepEqual(describeArtifactBlockPropsSupport('Divider', { color: 'info', width: '50%', thickness: 2 }), { ok: true })
  assert.deepEqual(describeArtifactBlockPropsSupport('Divider', { color: { k: 'StateRef', n: '$accent' } }), { ok: false, reason: 'dynamic' })
  assert.deepEqual(describeArtifactBlockPropsSupport('Divider', { width: '10rem' }), { ok: false, reason: 'unsupported_value' })
  assert.deepEqual(describeArtifactBlockPropsSupport('Spacer', { height: 'calc(10px + 1em)' }), { ok: false, reason: 'unsupported_value' })
})

test('block prefill drops positional null placeholders but keeps literals', () => {
  const tree = buildArtifactTree(`root = Col([rule, gap])\nrule = Divider()\ngap = Spacer(null, 24)`)
  const divider = [...tree.nodes.values()].find(node => node.componentType === 'Divider')
  const spacer = [...tree.nodes.values()].find(node => node.componentType === 'Spacer')
  assert.deepEqual(artifactBlockPropsFromNode('Divider', divider.props), {})
  assert.deepEqual(artifactBlockPropsFromNode('Spacer', spacer.props), { height: 24 })
})

/** Fake the session fields blockPropsState reads. */
function sessionFor(program, nestedMode = false) {
  const extraction = extractArtifactBlocks(program)
  const nested = nestedMode ? nestedBlocksForProgram(program) : undefined
  return {
    program,
    nestedMode,
    blocks: nestedMode ? nested.blocks : extraction.blocks,
  }
}

test('top-level quick adjust resolves the real root child even with shared siblings', () => {
  const program = `root = Col([card, rule, gap, card2])
card = Card([Text("body")])
card2 = card
rule = Divider()
gap = Spacer(null, 24)`
  const session = sessionFor(program)
  assert.deepEqual(session.blocks.map(block => block.componentType), ['Card', 'Divider', 'Spacer', 'Card'])
  assert.equal(blockPropsState(session, 'b1'), undefined, 'a Card has no quick-adjustable props')
  assert.equal(blockPropsState(session, 'b2').componentType, 'Divider')
  assert.equal(blockPropsState(session, 'b3').componentType, 'Spacer')
})

test('shared/opaque nodes cannot be quick-adjusted and dynamic props fall back', () => {
  const shared = `root = Col([d, d2])\nd = Divider()\nd2 = d`
  const sharedSession = sessionFor(shared)
  assert.equal(sharedSession.blocks.length, 2)
  assert.equal(blockPropsState(sharedSession, 'b1'), undefined, 'shared expression is not quick-adjustable')
  assert.equal(blockPropsState(sharedSession, 'b2'), undefined)

  const dynamic = `root = Col([rule])\n$accent = "info"\nrule = Divider($accent)`
  const dynamicSession = sessionFor(dynamic)
  const state = blockPropsState(dynamicSession, 'b1')
  assert.equal(state.componentType, 'Divider')
  assert.equal(state.support.ok, false)
  assert.equal(state.support.reason, 'dynamic')
})

test('nested mode quick adjust uses the same nested display ids as the canvas', () => {
  const program = `root = Col([card])
card = Card([head, rule, gap])
head = Title("Nested", "sm")
rule = Divider()
gap = Spacer(null, 12)`
  const session = sessionFor(program, true)
  const ids = session.blocks.map(block => block.blockId)
  assert.deepEqual(ids, ['b1', 'b1.1', 'b1.2', 'b1.3'])
  assert.equal(blockPropsState(session, 'b1.2').componentType, 'Divider')
  assert.equal(blockPropsState(session, 'b1.3').componentType, 'Spacer')
})

test('pages above the old 60-node budget still expose nested blocks and quick adjust', () => {
  const refs = Array.from({ length: 60 }, (_, index) => `t${index + 1}`)
  const program = [
    'root = Col([body, rule, section])',
    `body = Col([${refs.join(', ')}])`,
    ...refs.map((ref, index) => `${ref} = Text("line ${index + 1}")`),
    'rule = Divider()',
    'section = Section("Inner", [innerTitle, innerSpacer], "inner")',
    'innerTitle = Title("Inner", "sm")',
    'innerSpacer = Spacer(null, 12)',
  ].join('\n')
  const tree = buildArtifactTree(program, { containerTypes: ['Col', 'Row', 'Box', 'Grid', 'Card', 'Section', 'Carousel'] })
  assert.equal(tree.limitsExceeded, undefined)
  assert.ok(tree.nodes.size > 60, 'fixture exceeds the old node budget')
  const session = sessionFor(program)
  assert.equal(blockPropsState(session, 'b2').componentType, 'Divider')
  const nested = nestedBlocksForProgram(program)
  assert.ok(nested !== undefined && nested.hasNested)
  const spacer = nested.blocks.find(block => block.blockId === 'b3.2')
  assert.equal(spacer?.componentType, 'Spacer')
})
