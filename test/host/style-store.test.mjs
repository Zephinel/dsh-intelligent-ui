import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStyleStore } from '../../src/host/style-store.ts'
import {
  isCustomStyleId, isHexColor, isReservedStyleName, isStyleId, isStyleTemplate, isStyleTheme,
} from '../../src/shared/style-templates.ts'
import { THEME, styleInput, template } from './style-fixtures.mjs'

const originalHome = process.env.DSH_HOME
const homes = []

/** Bind each store to a private home, including the absent-parent-directory case. */
function mount({ raw, nested = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'iui-styles-'))
  homes.push(root)
  const home = nested ? join(root, 'nested') : root
  process.env.DSH_HOME = home
  const file = join(home, 'dsh-intelligent-ui-styles.json')
  if (raw !== undefined) writeFileSync(file, raw)
  const warnings = []
  return { store: createStyleStore({ logger: { warn: message => warnings.push(message) } }), file, home, warnings }
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
})

test('dependency-free guards accept only the bounded style contract', () => {
  for (const id of ['cs_abcdef', `cs_${'a'.repeat(32)}`]) assert.equal(isCustomStyleId(id), true)
  for (const id of ['cs_abcde', `cs_${'a'.repeat(33)}`, 'cs_ABCDEF', 'cs_abc-de', null, 42]) assert.equal(isCustomStyleId(id), false)
  for (const id of ['auto', 'card', 'article', 'cs_abcdef']) assert.equal(isStyleId(id), true)
  assert.equal(isStyleId('inherit'), false)
  assert.equal(isHexColor('#ABC123'), true)
  for (const color of ['#fff', '#ffffff00', 'red', null]) assert.equal(isHexColor(color), false)
  assert.equal(isReservedStyleName(' ArTiClE '), true)
  assert.equal(isStyleTheme(THEME), true)
  for (const theme of [null, [], { ...THEME, font: 'custom' }, { ...THEME, css: 'x' }, { ...THEME, dark: { ...THEME.dark, accent: 'red' } }]) {
    assert.equal(isStyleTheme(theme), false)
  }
  assert.equal(isStyleTemplate(template()), true)
  for (const value of [null, [], template({ sessionId: 's1' }), template({ scope: 'session' }), template({ scope: 'session', sessionId: ' ' }), template({ createdAt: NaN }), template({ updatedAt: 99 }), template({ extra: true })]) {
    assert.equal(isStyleTemplate(value), false)
  }
})

test('create, update, remove and persistence round-trip preserve store-owned fields', () => {
  const { store, file } = mount()
  const input = styleInput({ name: '  Briefing  ', description: '  Daily notes  ' })
  const created = store.create(input)
  assert.match(created.id, /^cs_[a-f0-9]{12}$/)
  assert.equal(created.name, 'Briefing')
  assert.equal(created.description, 'Daily notes')
  assert.ok(created.createdAt > 0)
  assert.equal(created.updatedAt, created.createdAt)
  input.theme.light.canvas = '#000000'
  created.theme.dark.ink = '#000000'
  assert.equal(store.get(created.id).theme.dark.ink, THEME.dark.ink)
  assert.equal(store.get(created.id).theme.light.canvas, THEME.light.canvas)
  const patched = store.update(created.id, { name: '  Updated  ', description: ' New ', baseLayout: 'article', directives: 'Long prose', theme: { ...THEME, font: 'serif' } })
  assert.equal(patched.id, created.id)
  assert.equal(patched.createdAt, created.createdAt)
  assert.ok(patched.updatedAt >= created.updatedAt)
  assert.equal(patched.name, 'Updated')
  assert.equal(patched.description, 'New')
  assert.equal(patched.baseLayout, 'article')
  assert.equal(patched.theme.font, 'serif')
  assert.deepEqual(createStyleStore().get(created.id), patched)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, templates: [patched] })
  assert.equal(store.update('cs_missing', { name: 'Missing' }), undefined)
  assert.equal(store.remove(created.id), true)
  assert.equal(store.remove(created.id), false)
  assert.equal(store.get(created.id), undefined)
  assert.deepEqual(createStyleStore().listForSession(), [])
})

test('lists globals and matching session templates newest first; resolve enforces visibility', () => {
  const { store } = mount()
  const global1 = store.create(styleInput({ name: 'First' }))
  const s1 = store.create(styleInput({ name: 'Session one', scope: 'session', sessionId: 's1' }))
  const s2 = store.create(styleInput({ name: 'Session two', scope: 'session', sessionId: 's2' }))
  const global2 = store.create(styleInput({ name: 'Last' }))
  assert.deepEqual(store.listForSession().map(t => t.id), [global2.id, global1.id])
  assert.deepEqual(store.listForSession('s1').map(t => t.id), [global2.id, s1.id, global1.id])
  assert.deepEqual(store.resolve(s1.id, 's1'), s1)
  assert.equal(store.resolve(s1.id, 's2'), undefined)
  assert.equal(store.resolve(s2.id), undefined)
  assert.equal(store.resolve('cs_missing', 's1'), undefined)
  assert.deepEqual(store.resolve(global1.id, 's2'), global1)
  assert.deepEqual(createStyleStore().listForSession('s2').map(t => t.id), [global2.id, s2.id, global1.id])
})

test('rejects reserved, duplicate, overlong and control-character labels and invalid themes', () => {
  const { store } = mount()
  for (const patch of [
    { name: '' }, { name: ' ' }, { name: 'x'.repeat(31) }, { name: 'AUTO' }, { name: ' Card ' }, { name: 'article' },
    { name: 'bad\nname' }, { description: 'bad\u007f' }, { description: 'x'.repeat(101) }, { directives: 'x'.repeat(2001) },
    { theme: { ...THEME, radius: 'huge' } }, { theme: { ...THEME, light: { ...THEME.light, ink: '#fff' } } },
    { scope: 'session' }, { scope: 'session', sessionId: '' }, { sessionId: 's1' }, { baseLayout: 'auto' }, { extra: 'CSS' },
  ]) assert.throws(() => store.create(styleInput(patch)))
  const first = store.create(styleInput({ name: 'Existing' }))
  assert.throws(() => store.create(styleInput({ name: 'eXisTing', scope: 'session', sessionId: 's1' })), /Duplicate style name/)
  const second = store.create(styleInput({ name: 'Second' }))
  assert.throws(() => store.update(second.id, { name: 'EXISTING' }), /Duplicate style name/)
  assert.throws(() => store.update(first.id, { scope: 'session', sessionId: 's1' }), /scope is immutable/)
  assert.throws(() => store.update(first.id, { id: 'cs_changeid' }), /Only name/)
  for (const patch of [{ name: 'auto' }, { description: '\t' }, { directives: 'x'.repeat(2001) }, { theme: {} }]) {
    assert.throws(() => store.update(first.id, patch))
  }
  assert.equal(store.get(first.id).name, 'Existing')
  store.create(styleInput({ name: 'x'.repeat(30), description: 'x'.repeat(100), directives: 'x'.repeat(2000) }))
})

test('enforces 40 global templates and 20 templates per session independently', () => {
  const { store } = mount()
  for (let i = 0; i < 40; i++) store.create(styleInput({ name: `Global ${i}` }))
  assert.throws(() => store.create(styleInput({ name: 'Overflow' })), /40/)
  for (let i = 0; i < 20; i++) store.create(styleInput({ name: `S1 ${i}`, scope: 'session', sessionId: 's1' }))
  assert.throws(() => store.create(styleInput({ name: 'Session overflow', scope: 'session', sessionId: 's1' })), /20/)
  store.create(styleInput({ name: 'S2', scope: 'session', sessionId: 's2' }))
  assert.equal(createStyleStore().listForSession('s1').length, 60)
})

test('corrupt data is kept until the next write, then backed up verbatim', () => {
  const raw = '{ bad JSON'
  const { store, file, home, warnings } = mount({ raw })
  assert.equal(warnings.length, 1)
  assert.deepEqual(store.listForSession(), [])
  assert.equal(readFileSync(file, 'utf8'), raw)
  assert.deepEqual(readdirSync(home), ['dsh-intelligent-ui-styles.json'])
  store.create(styleInput())
  const backup = readdirSync(home).find(name => /\.corrupt-\d+$/.test(name))
  assert.ok(backup)
  assert.equal(readFileSync(join(home, backup), 'utf8'), raw)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1)
  assert.equal(existsSync(`${file}.tmp`), false)
})

test('invalid versions, loaded templates, duplicate names and scope counts fail closed', () => {
  for (const data of [
    { version: 2, templates: [] }, { version: 1, templates: [template({ theme: {} })] },
    { version: 1, templates: [template(), template({ id: 'cs_aaaaaa123456', name: 'FIELD NOTES' })] },
    { version: 1, templates: Array.from({ length: 41 }, (_, i) => template({ id: `cs_${String(i).padStart(12, '0')}`, name: `Style ${i}` })) },
  ]) {
    const { store, warnings } = mount({ raw: JSON.stringify(data) })
    assert.equal(warnings.length, 1)
    assert.deepEqual(store.listForSession('s1'), [])
  }
})

test('atomic writes create parent directories and leave no temporary file', () => {
  const { store, file, home, warnings } = mount({ nested: true })
  assert.deepEqual(warnings, [])
  store.create(styleInput())
  assert.equal(existsSync(file), true)
  assert.equal(existsSync(`${file}.tmp`), false)
  assert.deepEqual(readdirSync(home), ['dsh-intelligent-ui-styles.json'])
})

test('failed persistence does not publish the mutation in memory or overwrite the last file', () => {
  const { store, file } = mount()
  const created = store.create(styleInput())
  const before = readFileSync(file, 'utf8')
  mkdirSync(`${file}.tmp`)
  assert.throws(() => store.update(created.id, { name: 'Unsaved' }))
  assert.throws(() => store.remove(created.id))
  assert.equal(store.get(created.id).name, created.name)
  assert.equal(readFileSync(file, 'utf8'), before)
})
