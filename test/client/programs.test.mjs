/**
 * Unit tests for the browser-half program extractor.
 *
 * Run: node --test test/client/programs.test.mjs
 *
 * The extractor is imported as TypeScript source: Node >= 22.18 strips type
 * annotations natively, so the test needs no build step and no dependencies.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { programsFromToolNodes } from '../../src/client/programs.ts'
import { BLOCK_EDIT_TOOL } from '../../src/shared/artifact-edit.ts'

const PROGRAM = 'root = Card([Text("hello")])'

/** @param {string} callId @param {Record<string, unknown>} args */
function started(callId, args, name = 'render_ui') {
  return { root: { phase: 'start', callId, name, argsRaw: JSON.stringify(args) } }
}

/**
 * @param {string} callId
 * @param {Record<string, unknown> | null} args
 * @param {{ name?: string, isError?: boolean }} [options]
 */
function settled(callId, args, options = {}) {
  const name = options.name ?? 'render_ui'
  return {
    root: {
      kind: 'tool-result',
      callId,
      name,
      isError: options.isError ?? false,
      call: args === null ? null : { name, argsRaw: JSON.stringify(args) },
    },
  }
}

test('a dispatched render_ui call yields its program as running', () => {
  assert.deepEqual(programsFromToolNodes([started('call-1', { program: PROGRAM })]), [
    { callId: 'call-1', program: PROGRAM, running: true },
  ])
})

test('a settled render_ui call yields its program as finished', () => {
  assert.deepEqual(programsFromToolNodes([settled('call-2', { program: PROGRAM, title: 'Weather' })]), [
    { callId: 'call-2', program: PROGRAM, title: 'Weather', running: false },
  ])
})

test('a failed render_ui result is skipped; the Tool row owns that failure', () => {
  assert.deepEqual(programsFromToolNodes([settled('call-3', { program: PROGRAM }, { isError: true })]), [])
  // A rejected attempt followed by a successful retry in the same Turn.
  assert.deepEqual(programsFromToolNodes([
    settled('call-3a', { program: 'root = Nope()' }, { isError: true }),
    settled('call-3b', { program: PROGRAM }),
  ]), [{ callId: 'call-3b', program: PROGRAM, running: false }])
})

test('a result whose call head left the history window is skipped', () => {
  assert.deepEqual(programsFromToolNodes([settled('call-4', null)]), [])
})

test('other tools are skipped', () => {
  assert.deepEqual(programsFromToolNodes([
    started('call-5', { program: PROGRAM }, 'bash'),
    settled('call-6', { program: PROGRAM }, { name: 'read' }),
  ]), [])
})

test('a preparing call carries no complete arguments and is skipped', () => {
  assert.deepEqual(programsFromToolNodes([
    { root: { phase: 'preparing', callId: 'call-7', name: 'render_ui' } },
  ]), [])
})

test('malformed JSON and non-object arguments are skipped', () => {
  const badJson = { root: { phase: 'start', callId: 'call-8', name: 'render_ui', argsRaw: '{not json' } }
  assert.deepEqual(programsFromToolNodes([badJson, started('call-9', { program: 42 })]), [])
})

test('program must be a non-empty string', () => {
  assert.deepEqual(programsFromToolNodes([
    started('call-10', {}),
    started('call-11', { program: '' }),
    started('call-12', { program: '   ' }),
    started('call-13', { program: null }),
  ]), [])
})

test('a non-string title is dropped, keeping the program', () => {
  assert.deepEqual(programsFromToolNodes([started('call-14', { program: PROGRAM, title: 7 })]), [
    { callId: 'call-14', program: PROGRAM, running: true },
  ])
})

test('invocation order is preserved and an absent node list is empty', () => {
  assert.deepEqual(programsFromToolNodes([
    started('call-15', { program: 'one' }),
    started('call-16', { program: PROGRAM }, 'bash'),
    settled('call-17', { program: 'two' }),
  ]), [
    { callId: 'call-15', program: 'one', running: true },
    { callId: 'call-17', program: 'two', running: false },
  ])
  assert.deepEqual(programsFromToolNodes(undefined), [])
  assert.deepEqual(programsFromToolNodes([]), [])
})

test('a valid style is kept and an invalid style is dropped', () => {
  assert.deepEqual(programsFromToolNodes([
    started('call-18', { program: PROGRAM, style: 'article' }),
    settled('call-19', { program: PROGRAM, style: 'card' }),
    started('call-20', { program: PROGRAM, style: 'huge' }),
    started('call-21', { program: PROGRAM, style: 'auto' }),
  ]), [
    { callId: 'call-18', program: PROGRAM, style: 'article', running: true },
    { callId: 'call-19', program: PROGRAM, style: 'card', running: false },
    { callId: 'call-20', program: PROGRAM, running: true },
    { callId: 'call-21', program: PROGRAM, running: true },
  ])
})

test('only valid custom styleIds survive recorded argument extraction', () => {
  for (const make of [started, settled]) {
    for (const styleId of ['cs_abcdef', 'cs_0123456789abcdef', 'card', 'auto', 'cs_BADBAD', 'cs_short', '', null, 12, {}]) {
      const [program] = programsFromToolNodes([make('styled', { program: PROGRAM, style: 'card', styleId })])
      assert.equal(program.styleId, ['cs_abcdef', 'cs_0123456789abcdef'].includes(styleId) ? styleId : undefined)
      assert.equal(program.style, 'card')
    }
  }
})

test('inline snapshots survive recorded argument replay without catalog access', async () => {
  const { THEME } = await import('../host/style-fixtures.mjs')
  const temporaryStyle = { schemaVersion: 1, baseLayout: 'card', directives: 'Use compact groups.', theme: THEME }
  for (const style of ['card', 'article', 'free']) for (const make of [started, settled]) {
    const snapshot = { ...temporaryStyle, baseLayout: style }
    const [program] = programsFromToolNodes([make('temp-result', { program: PROGRAM, style, temporaryStyle: snapshot })])
    assert.deepEqual(program.temporaryStyle, snapshot)
    assert.equal(program.style, style)
    assert.equal(program.styleSource, 'temporary')
    assert.equal(program.styleId, undefined)
    assert.deepEqual(programsFromToolNodes([make('mixed', { program: PROGRAM, style, temporaryStyle: snapshot, styleId: 'cs_abcdef' })]), [])
  }
  for (const args of [{ temporaryStyle: {} }, { temporaryStyle, style: 'article' }, { temporaryStyle, styleId: 'cs_abcdef' }]) {
    assert.deepEqual(programsFromToolNodes([settled('bad-temp', { program: PROGRAM, style: 'card', ...args })]), [])
  }
  // A live Auto free call renders; a settled replay needs the recorded builtin
  // source, and a template result with a missing identity stays invalid.
  const [liveFree] = programsFromToolNodes([started('live-free', { program: PROGRAM, style: 'free' })])
  assert.equal(liveFree.style, 'free')
  assert.deepEqual(programsFromToolNodes([settled('plain-free', { program: PROGRAM, style: 'free' })]), [])
  const replayFree = settled('auto-free', { program: PROGRAM, style: 'free' })
  replayFree.root.meta = { styleSource: 'builtin' }
  const [autoFree] = programsFromToolNodes([replayFree])
  assert.equal(autoFree.style, 'free')
  assert.equal(autoFree.styleId, undefined)
  assert.equal(autoFree.temporaryStyle, undefined)
  const templateFree = settled('template-free', { program: PROGRAM, style: 'free' })
  templateFree.root.meta = { styleSource: 'template' }
  assert.deepEqual(programsFromToolNodes([templateFree]), [])
  assert.equal(programsFromToolNodes([settled('builtin', { program: PROGRAM, styleSource: 'builtin' })])[0].styleSource, 'builtin')
  assert.equal(programsFromToolNodes([settled('template', { program: PROGRAM, styleSource: 'template' })])[0].styleSource, 'template')
  assert.equal(programsFromToolNodes([settled('bad-source', { program: PROGRAM, styleSource: 'unknown' })])[0].styleSource, undefined)
})


test('document-mode results replay with their recorded presentation flag', () => {
  const document = settled('document-free', { program: PROGRAM, style: 'free' })
  document.root.meta = { style: 'free', styleSource: 'builtin', document: true }
  const [program] = programsFromToolNodes([document])
  assert.equal(program.style, 'free')
  assert.equal(program.styleSource, 'builtin')
  assert.equal(program.document, true)
  // Ordinary result meta without the flag never selects the document shell.
  const card = settled('plain-card', { program: PROGRAM, style: 'card' })
  card.root.meta = { style: 'card', styleSource: 'builtin' }
  assert.equal(programsFromToolNodes([card])[0].document, undefined)
  assert.equal(programsFromToolNodes([card])[0].styleSource, 'builtin')
  // The flag is result-owned metadata, not a model argument.
  const injected = settled('arg-document', { program: PROGRAM, style: 'free', document: true })
  injected.root.meta = { style: 'free', styleSource: 'builtin' }
  assert.equal(programsFromToolNodes([injected])[0].document, undefined)
})

test('free template recordings replay with a valid styleId and no temporary snapshot', () => {
  for (const make of [started, settled]) {
    const [result] = programsFromToolNodes([make('saved-free', { program: PROGRAM, style: 'free', styleId: 'cs_abcdef' })])
    assert.equal(result.style, 'free')
    assert.equal(result.styleId, 'cs_abcdef')
    assert.equal(result.styleSource, 'template')
    assert.equal(result.temporaryStyle, undefined)
    for (const styleId of [null, 'card', '', 'cs_BADBAD', 'cs_short', 42]) {
      assert.deepEqual(programsFromToolNodes([make('bad-free', { program: PROGRAM, style: 'free', styleId })]), [])
    }
    // A live free call with no styleId is an Auto choice and renders; a replayed
    // one without the recorded builtin source does not.
    assert.equal(programsFromToolNodes([started('no-id-free', { program: PROGRAM, style: 'free' })])[0].style, 'free')
    assert.deepEqual(programsFromToolNodes([settled('no-id-free', { program: PROGRAM, style: 'free' })]), [])
    for (const temporaryStyle of [null, {}, { schemaVersion: 2 }]) {
      assert.deepEqual(programsFromToolNodes([make('mixed-free', { program: PROGRAM, style: 'free', styleId: 'cs_abcdef', temporaryStyle })]), [])
    }
  }
})

test('block-level edit results render from result meta', () => {
  const meta = {
    artifactId: 'call-1',
    revisionId: 'call-2',
    baseRevisionId: 'call-1',
    revision: 2,
    editedBlockIds: ['b3'],
    program: 'root = Col([Card([Text("edited")])])',
    title: 'Edited page',
    style: 'card',
  }
  const nodes = [{ root: {
    kind: 'tool-result',
    callId: 'call-2',
    name: BLOCK_EDIT_TOOL,
    isError: false,
    meta,
    call: { name: BLOCK_EDIT_TOOL, argsRaw: JSON.stringify({ program: 'root = Col([Card([Text("edited")])])' }) },
  } }]
  const programs = programsFromToolNodes(nodes)
  assert.equal(programs.length, 1)
  assert.equal(programs[0].program, meta.program)
  assert.equal(programs[0].title, 'Edited page')
  assert.equal(programs[0].revision, 2)
  assert.deepEqual(programs[0].editedBlockIds, ['b3'])
  // Failed or meta-less block edits never render a card.
  assert.deepEqual(programsFromToolNodes([{ root: { ...nodes[0].root, isError: true } }]), [])
  assert.deepEqual(programsFromToolNodes([{ root: { ...nodes[0].root, meta: undefined } }]), [])
})

test('a render_ui style revision falls back to the Host-recorded meta title', () => {
  const snapshot = {
    schemaVersion: 1,
    baseLayout: 'article',
    directives: 'Cool editorial palette.',
  }
  const node = settled('style-call-7', { program: PROGRAM })
  node.root.meta = {
    artifactId: 'call-1',
    revisionId: 'call-7',
    baseRevisionId: 'call-2',
    revision: 3,
    title: '样式修订标题',
    style: 'article',
    temporaryStyle: snapshot,
  }
  const [program] = programsFromToolNodes([node])
  assert.ok(program)
  assert.equal(program.title, '样式修订标题', 'the recorded title survives a missing args.title')
  assert.equal(program.program, PROGRAM)
  assert.equal(program.revision, 3)
  assert.equal(program.artifactId, 'call-1')
  assert.deepEqual(program.temporaryStyle, snapshot)
  // Explicit model arguments still win over the recorded fallback.
  const explicit = settled('style-call-8', { program: PROGRAM, title: 'Model title' })
  explicit.root.meta = { artifactId: 'call-1', revisionId: 'call-8', revision: 4, title: 'Meta title' }
  assert.equal(programsFromToolNodes([explicit])[0].title, 'Model title')
})
