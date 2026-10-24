import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  STYLE_EXCHANGE_KIND, STYLE_EXCHANGE_VERSION, STYLE_EXCHANGE_MAX_BYTES, StyleExchangeError,
  toPortableStyle, createStyleExport, encodeStyleExport, parseStyleExport, truncateTemplateLabel,
} from '../../src/shared/style-template-exchange.ts'
import { template } from '../host/style-fixtures.mjs'

const failure = (value, code) => assert.throws(() => parseStyleExport(typeof value === 'string' ? value : JSON.stringify(value)),
  error => error instanceof StyleExchangeError && error.code === code)

for (const baseLayout of ['card', 'article', 'free']) test(`${baseLayout} roundtrips with deterministic portable bytes and no source mutation`, () => {
  const source = template({ baseLayout, name: '中文 🙂', directives: '  Headings\nFull text.\t  ' })
  const before = structuredClone(source)
  const encoded = encodeStyleExport(source)
  const envelope = createStyleExport(source)
  assert.deepEqual(Object.keys(envelope), ['kind', 'schemaVersion', 'template'])
  assert.equal(envelope.kind, STYLE_EXCHANGE_KIND)
  assert.equal(envelope.schemaVersion, STYLE_EXCHANGE_VERSION)
  assert.deepEqual(Object.keys(envelope.template), ['name', 'description', 'baseLayout', 'directives', 'theme'])
  assert.deepEqual(parseStyleExport(encoded), toPortableStyle(source))
  assert.equal(encoded, JSON.stringify(envelope, null, 2))
  assert.equal(encoded, encodeStyleExport(parseStyleExport(encoded)))
  const reordered = { ...source, theme: Object.fromEntries(Object.entries(source.theme).reverse()) }
  reordered.theme.light = Object.fromEntries(Object.entries(source.theme.light).reverse())
  assert.equal(encoded, encodeStyleExport(reordered))
  envelope.template.theme.light.canvas = '#000000'
  assert.deepEqual(source, before)
  for (const key of ['id', 'scope', 'sessionId', 'createdAt', 'updatedAt', 'appVersion', 'exportedAt']) assert.equal(key in envelope.template, false)
})

test('strict envelope keys, kind, version and types reject instead of guessing', () => {
  const good = createStyleExport(template())
  for (const value of [null, [], 1, '"text"', {}, { ...good, kind: 'other' }, { ...good, extra: true },
    { ...good, schemaVersion: '1' }, { ...good, template: [] }, { ...good, template: { ...good.template, id: 'cs_abcdef' } }]) failure(value, 'invalid_structure')
  for (const key of ['kind', 'schemaVersion', 'template']) {
    const value = structuredClone(good); delete value[key]; failure(value, 'invalid_structure')
  }
  for (const schemaVersion of [0, 2, 1.1]) failure({ ...good, schemaVersion }, 'unsupported_version')
  for (const key of ['name', 'baseLayout', 'directives', 'theme']) {
    const value = structuredClone(good); delete value.template[key]; failure(value, 'invalid_template')
    const wrong = structuredClone(good); wrong.template[key] = null; failure(wrong, 'invalid_template')
  }
  failure({ ...good, template: { ...good.template, description: null } }, 'invalid_template')
  const optional = structuredClone(good); delete optional.template.description
  assert.equal(parseStyleExport(JSON.stringify(optional)).description, '')
})

test('raw legacy templates, store documents and other shapes reject as unknown structures', () => {
  for (const value of [{ version: 1, templates: [template()] }, template({ baseLayout: 'free' }),
    { ...template(), extra: true }, { kind: STYLE_EXCHANGE_KIND, schemaVersion: 1, template: { ...createStyleExport(template()).template, id: 'cs_abcdef' } }]) {
    failure(value, 'invalid_structure')
  }
})

test('UTF-8 size is checked before trimming or parsing, including CJK at exactly 32 KiB', () => {
  const encoded = encodeStyleExport(template())
  const remaining = STYLE_EXCHANGE_MAX_BYTES - new TextEncoder().encode(encoded).length
  const pad = '　'.repeat(Math.floor(remaining / 3)) + ' '.repeat(remaining % 3)
  const boundary = pad + encoded
  assert.equal(new TextEncoder().encode(boundary).length, 32768)
  assert.ok(boundary.length < 32768)
  assert.equal(parseStyleExport(boundary).name, template().name)
  failure(boundary + ' ', 'too_large')
  failure('中'.repeat(10923), 'too_large')
})

test('only one whole Markdown code fence is tolerated; no prose extraction', () => {
  const encoded = encodeStyleExport(template())
  for (const language of ['', 'json']) assert.deepEqual(parseStyleExport(` \n\`\`\`${language}\n${encoded}\n\`\`\` \n`), parseStyleExport(encoded))
  assert.deepEqual(parseStyleExport(`\`\`\`json\r\n${encoded}\r\n\`\`\``), parseStyleExport(encoded))
  for (const value of [`before ${encoded}`, `${encoded} after`, `\`\`\`json\n${encoded}`, `\`\`\`js\n${encoded}\n\`\`\``,
    `\`\`\`\n\`\`\`json\n${encoded}\n\`\`\`\n\`\`\``]) failure(value, 'invalid_json')
})

test('labels strip Cf then trim; existing bounds, reserved names and controls still reject', () => {
  const good = createStyleExport(template())
  good.template.name = ' \u202e\u200bSoft\ufeff Minimal\u2066 '
  good.template.description = '\u200d Description\u202c '
  assert.equal(parseStyleExport(JSON.stringify(good)).name, 'Soft Minimal')
  assert.equal(parseStyleExport(JSON.stringify(good)).description, 'Description')
  good.template.name = ' \u2028Soft\u2029 Minimal '
  good.template.description = 'line\u2028break\u2029description'
  assert.equal(parseStyleExport(JSON.stringify(good)).name, 'Soft Minimal')
  assert.equal(parseStyleExport(JSON.stringify(good)).description, 'line break description')
  good.template.directives = [
    'safe', '\u061c', '\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e',
    '\u2066', '\u2067', '\u2068', '\u2069', '\u{E0041}', '\u200b', '\u2060',
    '\uFE0F', '\uFE01', '\u034F', '\u115F', '\u3164', '\uFFA0', '\u2065', '\u2800', ' text',
  ].join('')
  assert.equal(parseStyleExport(JSON.stringify(good)).directives, 'safe text')
  good.template.name = 'hidden\uFE0F\u034Fname'
  assert.equal(parseStyleExport(JSON.stringify(good)).name, 'hiddenname')
  for (const name of [' \u200b\ufeff ', 'Auto', '\u200bCARD', 'x'.repeat(31), 'a\u0000b', 'a\u0085b']) failure({ ...good, template: { ...good.template, name } }, 'invalid_template')
  for (const [key, value] of [['description', 'x'.repeat(101)], ['description', 'a\nb'], ['directives', 'x'.repeat(2001)],
    ['directives', '\u0000'], ['directives', '\u007f'], ['baseLayout', 'unknown'], ['directives', 1]]) failure({ ...good, template: { ...good.template, [key]: value } }, 'invalid_template')
  assert.equal(parseStyleExport(encodeStyleExport(template({ directives: '' }))).directives, '')
})

test('template label truncation never splits a surrogate pair and export rejects Cf-only names', () => {
  const value = 'A'.repeat(18) + '\u{1f600}BB'
  const truncated = truncateTemplateLabel(value, 19)
  assert.equal(truncated, 'A'.repeat(18))
  assert.equal(/[\uD800-\uDBFF]$/.test(truncated), false)
  for (const name of ['\u200b', 'Card\u200b']) {
    assert.throws(() => encodeStyleExport(template({ name })), error => error instanceof StyleExchangeError && error.code === 'invalid_template')
  }
})

test('unknown and prototype keys at every level, invalid hex and theme enums are rejected', () => {
  for (const key of ['__proto__', 'constructor', 'prototype', 'css']) {
    for (const path of [[], ['template'], ['template', 'theme'], ['template', 'theme', 'light'], ['template', 'theme', 'dark']]) {
      const value = createStyleExport(template())
      let target = value
      for (const segment of path) target = target[segment]
      Object.defineProperty(target, key, { value: { polluted: true }, enumerable: true })
      failure(value, path.length < 2 ? 'invalid_structure' : 'invalid_template')
    }
  }
  assert.equal({}.polluted, undefined)
  for (const [key, value] of [['font', 'script'], ['radius', 'huge'], ['density', 'loose'], ['shadow', 'strong'], ['light', {}]]) {
    const bad = createStyleExport(template()); bad.template.theme[key] = value; failure(bad, 'invalid_template')
  }
  for (const color of ['red', '#fff', '#gg0000', 'url(x)', 123]) {
    const bad = createStyleExport(template()); bad.template.theme.light.canvas = color; failure(bad, 'invalid_template')
  }
})

test('empty input and malformed JSON have stable typed errors', () => {
  for (const value of ['', '  \n ', '```json\n\n```']) failure(value, 'empty_input')
  for (const value of ['{', 'undefined', '{"x":NaN}', '{"x":1,}']) failure(value, 'invalid_json')
})
