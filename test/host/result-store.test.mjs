import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createResultStore, MAX_RESULT_RECORDS } from '../../src/host/result-store.ts'
import { THEME } from './style-fixtures.mjs'

const originalHome = process.env.DSH_HOME
const homes = []
function mount(raw) {
  const home = mkdtempSync(join(tmpdir(), 'iui-results-')); homes.push(home); process.env.DSH_HOME = home
  const file = join(home, 'dsh-intelligent-ui-results.json')
  if (raw !== undefined) writeFileSync(file, raw)
  const warnings = []
  return { home, file, warnings, store: createResultStore({ logger: { warn: warning => warnings.push(warning) } }) }
}
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
})
const snapshot = { schemaVersion: 1, baseLayout: 'card', directives: 'Clear hierarchy.', suggestedName: 'Notes', theme: THEME }
const result = (overrides = {}) => ({ resultId: 'call-1', sessionId: 's1', snapshot: structuredClone(snapshot), createdAt: 1, ...overrides })

test('result snapshots round trip across restart, clone reads/writes, remain immutable, and only write the result file', () => {
  const { store, home, file } = mount()
  const first = result()
  store.record(first); first.snapshot.directives = 'mutated'
  store.record(result({ resultId: 'call-2', parentResultId: 'call-1', createdAt: 2 }))
  assert.deepEqual(createResultStore().get('call-1'), result())
  assert.equal(createResultStore().get('call-2').parentResultId, 'call-1')
  const detached = store.get('call-1'); detached.snapshot.theme.light.canvas = '#000000'
  assert.deepEqual(store.get('call-1'), result())
  store.record(result())
  assert.throws(() => store.record(result({ snapshot: { ...snapshot, directives: 'Changed' } })), /immutable/)
  assert.equal(store.get('unknown'), undefined)
  assert.deepEqual(readdirSync(home), ['dsh-intelligent-ui-results.json'])
  assert.equal(existsSync(`${file}.tmp`), false)
})

test('corrupt JSON/schema/collections are preserved verbatim on the next atomic write', () => {
  for (const raw of ['{broken', JSON.stringify({ version: 2, results: [] }),
    JSON.stringify({ version: 1, results: [result({ snapshot: { ...snapshot, extra: true } })] }),
    JSON.stringify({ version: 1, results: [result(), result()] }),
    JSON.stringify({ version: 1, results: Array.from({ length: 201 }, (_, i) => result({ resultId: `r${i}` })) }),
  ]) {
    const { store, file, home, warnings } = mount(raw)
    assert.equal(warnings.length, 1); assert.equal(store.get('call-1'), undefined)
    assert.equal(readFileSync(file, 'utf8'), raw)
    store.record(result())
    const backup = readdirSync(home).find(name => /\.corrupt-\d+$/.test(name))
    assert.ok(backup); assert.equal(readFileSync(join(home, backup), 'utf8'), raw)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, results: [result()] })
  }
})

test('retains the newest 200 records, dropping the oldest creation time, also after restart', () => {
  const { store } = mount()
  for (let i = 0; i <= MAX_RESULT_RECORDS; i++) store.record(result({ resultId: `r${i}`, createdAt: i }))
  assert.equal(store.get('r0'), undefined)
  assert.ok(createResultStore().get('r1')); assert.ok(createResultStore().get('r200'))
  store.record(result({ resultId: 'late-old-result', createdAt: 0 }))
  assert.equal(store.get('late-old-result'), undefined)
})

test('rejects invalid identities, unbounded data, unknown keys, contrast and versions before writing', () => {
  const { store, file } = mount()
  for (const patch of [{ resultId: '' }, { resultId: 'x'.repeat(201) }, { sessionId: ' x' },
    { parentResultId: 'call-1' }, { createdAt: -1 }, { createdAt: 1.5 }, { theme: THEME },
    { snapshot: { ...snapshot, schemaVersion: 2 } }, { snapshot: { ...snapshot, directives: 'x'.repeat(2001) } },
    { snapshot: { ...snapshot, theme: { ...THEME, light: { ...THEME.light, ink: '#ffffff' } } } },
  ]) assert.throws(() => store.record(result(patch)), /Invalid/)
  assert.equal(existsSync(file), false)
})
