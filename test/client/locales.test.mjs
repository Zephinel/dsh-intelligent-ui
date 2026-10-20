/**
 * Dictionary regressions for the extension's bilingual UI copy.
 *
 * Run: node --test test/client/locales.test.mjs
 *
 * The dictionary module is imported as TypeScript source: Node >= 22.18 strips
 * type annotations natively, so this test needs no build step.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NS, en, zh, translate, fallbackT } from '../../src/shared/locales.ts'

/** Every `{name}` placeholder in one template, sorted. */
const placeholdersOf = (template) => [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

test('the namespace is the extension name', () => {
  assert.equal(NS, 'intelligent-ui')
})

test('English and Chinese dictionaries carry the same key set', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})

test('every dictionary value is a non-empty template', () => {
  for (const [language, dict] of [['zh', zh], ['en', en]]) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', `${language} ${key} is a string`)
      assert.ok(value.length > 0, `${language} ${key} is not empty`)
      assert.doesNotMatch(value, /\n/u, `${language} ${key} stays on one line`)
    }
  }
})

test('each key uses the same placeholders in both languages', () => {
  for (const key of Object.keys(zh)) {
    assert.deepEqual(placeholdersOf(en[key]), placeholdersOf(zh[key]), `${key} placeholders match`)
  }
})

test('translate fills placeholders and leaves unknown keys visible', () => {
  const t = translate(zh)
  assert.equal(t('chip.label', { scope: '关闭' }), 'UI：关闭')
  assert.equal(t('chip.label'), 'UI：{scope}')
  assert.equal(t('missing.key'), 'missing.key')
  assert.equal(t('missing.key', { x: 1 }), 'missing.key')
})

test('English fallback keeps the pre-i18n copy', () => {
  assert.equal(fallbackT('card.title'), 'Interactive answer')
  assert.equal(fallbackT('chip.label', { scope: 'Off' }), 'UI: Off')
  assert.equal(fallbackT('map.action.expand'), 'Expand')
})
