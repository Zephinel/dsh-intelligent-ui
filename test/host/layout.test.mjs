/**
 * Host layout guardrail: warn about manual spacing that fights the renderer flow.
 *
 *   node --test test/host/layout.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutWarnings } from '../../src/host/program-validation.ts'

const element = (typeName, props = {}) => ({ type: 'element', typeName, props })

test('manual gaps, blank spacers and empty blocks are flagged', () => {
  const warnings = layoutWarnings(element('Col', {
    gap: 3,
    children: [
      element('Section', { title: 'Empty', children: [] }),
      element('Spacer', {}),
      element('Text', { text: '   ' }),
      element('Col', { gap: 0, children: [element('Markdown', { text: 'a' }), element('Title', { text: 'b' })] }),
    ],
  }))
  assert.equal(warnings.length, 5)
  assert.ok(warnings.some(line => /root Col should omit `gap`/.test(line)))
  assert.ok(warnings.some(line => /Section.*no children/.test(line)))
  assert.ok(warnings.some(line => /Spacer\(\).*outside a/.test(line)))
  assert.ok(warnings.some(line => /empty .*Text/.test(line)))
  assert.ok(warnings.some(line => /gap: 0/.test(line)))
})

test('a clean article flow produces no layout warnings', () => {
  const warnings = layoutWarnings(element('Col', {
    children: [
      element('Toc', { items: ['One'] }),
      element('Section', {
        title: 'One',
        children: [
          element('Markdown', { text: 'Prose.' }),
          element('Box', { direction: 'row', gap: 0, children: [element('Text', { text: 'left' }), element('Spacer', {}), element('Text', { text: 'right' })] }),
          element('Grid', { columns: 2, children: [element('Card', { children: [element('Title', { text: 'A' })] })] }),
        ],
      }),
    ],
  }))
  assert.deepEqual(warnings, [])
})

/** A photo (or plain) row as the model writes it. */
const photo = () => element('SearchImage', { query: 'still' })
const photoRow = () => element('Row', { children: [element('Box', { width: 44, children: [photo()] }), element('Text', { text: 'Title' })] })
const plainRow = () => element('Row', { children: [element('Text', { text: '09:00' }), element('Text', { text: 'Standup' })] })

/** One `@Each` expression whose template is a Row, as the parser emits it. */
const eachRow = (photoRows = true, items = 3) => ({
  k: 'Comp',
  name: 'Each',
  args: [
    { k: 'Arr', els: Array.from({ length: items }, () => ({ k: 'Obj', entries: [] })) },
    { k: 'Str', v: 'm' },
    {
      k: 'Comp',
      name: 'Row',
      args: [
        { k: 'Arr', els: photoRows ? [{ k: 'Comp', name: 'SearchImage', args: [{ k: 'Str', v: 'still' }] }] : [] },
        { k: 'Num', v: 3 },
        { k: 'Str', v: 'start' },
      ],
    },
  ],
})

test('a repeated photo row list with gap 1 is flagged', () => {
  const direct = layoutWarnings(element('Col', {
    children: [
      element('Title', { text: 'Ranking' }),
      element('Col', { gap: 1, children: [photoRow(), photoRow(), photoRow()] }),
    ],
  }))
  assert.ok(direct.some(line => /gap: 1.*4px apart/.test(line)), direct.join('\n'))

  const repeated = layoutWarnings(element('Col', {
    children: [
      element('Title', { text: 'Ranking' }),
      element('Col', { gap: 1, children: [eachRow()] }),
    ],
  }))
  assert.ok(repeated.some(line => /gap: 1.*4px apart/.test(line)), repeated.join('\n'))
})

test('compact non-photo row stacks and two-item pairs are not flagged', () => {
  const plain = layoutWarnings(element('Col', {
    children: [element('Title', { text: 'Schedule' }), element('Col', { gap: 1, children: [plainRow(), plainRow(), plainRow()] })],
  }))
  assert.deepEqual(plain, [])

  const pair = layoutWarnings(element('Col', {
    children: [element('Title', { text: 'Pairs' }), element('Col', { gap: 1, children: [eachRow(true, 2)] })],
  }))
  assert.deepEqual(pair, [])

  const noPhoto = layoutWarnings(element('Col', {
    children: [element('Title', { text: 'Rows' }), element('Col', { gap: 1, children: [eachRow(false)] })],
  }))
  assert.deepEqual(noPhoto, [])
})

test('row lists without a cramped gap produce no warning', () => {
  const rows = [photoRow(), photoRow(), photoRow()]
  for (const gap of [undefined, 2, 3]) {
    const warnings = layoutWarnings(element('Col', {
      children: [element('Title', { text: 'Ranking' }), element('Col', { ...gap === undefined ? {} : { gap }, children: rows })],
    }))
    assert.deepEqual(warnings, [], `gap ${String(gap)} should be silent`)
  }
})

test('layout warnings reach into @Each templates', () => {
  const warnings = layoutWarnings(element('Col', {
    children: [{
      k: 'Comp',
      name: 'Each',
      args: [
        { k: 'Arr', els: [{ k: 'Obj', entries: [] }] },
        { k: 'Str', v: 'm' },
        {
          k: 'Comp',
          name: 'Col',
          args: [{ k: 'Arr', els: [{ k: 'Comp', name: 'Spacer', args: [] }, { k: 'Comp', name: 'Text', args: [{ k: 'Str', v: '   ' }] }] }],
        },
      ],
    }],
  }))
  assert.ok(warnings.some(line => /Spacer\(\)` outside a/.test(line)), warnings.join('\n'))
  assert.ok(warnings.some(line => /empty .*Text/.test(line)), warnings.join('\n'))
})

test('free layout skips the page-root gap warning', () => {
  const program = element('Col', { gap: 3, children: [element('Text', { text: 'a' }), element('Text', { text: 'b' })] })
  assert.ok(layoutWarnings(program).some(line => /root Col should omit/.test(line)))
  assert.deepEqual(layoutWarnings(program, { free: true }), [])
})
