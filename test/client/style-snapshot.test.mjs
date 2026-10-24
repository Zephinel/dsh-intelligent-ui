import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STYLE_SNAPSHOT_VERSION, isStyleSnapshot } from '../../src/shared/style-templates.ts'
import { THEME } from '../host/style-fixtures.mjs'

const snapshot = { schemaVersion: 1, baseLayout: 'card', directives: 'Use compact groups.\nKeep clear hierarchy.', theme: THEME }

test('StyleSnapshotV1 admits only bounded design data and controlled light/dark themes', () => {
  assert.equal(STYLE_SNAPSHOT_VERSION, 1)
  assert.equal(isStyleSnapshot(snapshot), true)
  assert.equal(isStyleSnapshot({ ...snapshot, baseLayout: 'article', suggestedName: 'Reading notes' }), true)
  assert.equal(isStyleSnapshot({ ...snapshot, baseLayout: 'free', suggestedName: 'Poster' }), true)
  assert.equal(isStyleSnapshot({ ...snapshot, directives: 'x'.repeat(2000) }), true)
  for (const invalid of [null, [], {}, { ...snapshot, schemaVersion: 2 }, { ...snapshot, schemaVersion: '1' },
    { ...snapshot, baseLayout: 'auto' }, { ...snapshot, directives: '' }, { ...snapshot, directives: '  ' },
    { ...snapshot, directives: 'x'.repeat(2001) }, { ...snapshot, directives: 'x\u0000y' }, { ...snapshot, directives: 'x\u0085y' },
    { ...snapshot, css: 'color:red' }, { ...snapshot, theme: { ...THEME, css: 'color:red' } },
    { ...snapshot, theme: { ...THEME, light: { ...THEME.light, canvas: 'url(https://example.com)' } } },
    { ...snapshot, theme: { ...THEME, dark: { ...THEME.dark, border: '#fff' } } },
    { ...snapshot, theme: { ...THEME, font: 'Arial' } }, { ...snapshot, theme: { ...THEME, radius: '50%' } },
    ...['', ' ', ' Auto', 'Card', 'ARTICLE', 'x'.repeat(31), 'x\ny', null, 1].map(suggestedName => ({ ...snapshot, suggestedName })),
  ]) assert.equal(isStyleSnapshot(invalid), false, JSON.stringify(invalid))
})
