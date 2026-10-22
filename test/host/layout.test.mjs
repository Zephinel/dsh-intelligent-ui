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
          element('Grid', { columns: 2, children: [element('Card', { children: [element('Title', { text: 'A' })] })] }),
        ],
      }),
    ],
  }))
  assert.deepEqual(warnings, [])
})
