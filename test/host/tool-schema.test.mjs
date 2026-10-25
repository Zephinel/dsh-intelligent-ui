/**
 * Host regression test: the tool schemas stay inside the JSON Schema subset
 * DSH accepts, and a schema outside it fails activation loudly.
 *
 * The failure this pins: a `maxLength` on the output schema's `styleId` made
 * `ctx.tools.register()` throw inside `apply()`, i.e. after the prompt section
 * and the HTTP routes had been installed. The entry then "did not activate"
 * with a single warning while `render_ui` was simply absent — the composer
 * showed Intelligent UI on and every call failed as an unknown tool.
 *
 *   node --test test/host/tool-schema.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertDshToolSchema, SUBSET_DESCRIPTION } from '../../src/host/tool-schema.ts'

const ANNOTATIONS_ONLY = { description: 'An unconstrained value.', title: 'Value' }
const OBJECT = {
  type: 'object',
  properties: {
    program: { type: 'string', description: 'The program.' },
    style: { type: 'string', enum: ['card', 'article', 'free'] },
    snapshot: {
      type: 'object',
      properties: { schemaVersion: { type: 'integer', const: 1 } },
      required: ['schemaVersion'],
      additionalProperties: false,
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['program', 'style'],
  additionalProperties: false,
}

test('accepts the subset DSH supports, including nested objects, arrays, enums and consts', () => {
  assertDshToolSchema(OBJECT, 'parameters')
  assertDshToolSchema(ANNOTATIONS_ONLY, 'annotations')
})

test('rejects maxLength where the production failure had it', () => {
  assert.throws(
    () => assertDshToolSchema({
      type: 'object',
      properties: { styleId: { type: 'string', maxLength: 200 } },
    }, 'output.schema'),
    (error) => {
      assert.match(error.message, /output\.schema\.properties\.styleId\.maxLength is not a supported keyword/)
      assert.ok(error.message.includes(SUBSET_DESCRIPTION))
      return true
    },
  )
})

test('rejects every keyword outside the subset at any depth', () => {
  for (const [keyword, value] of [['minLength', 1], ['pattern', '^cs_'], ['minimum', 0], ['format', 'uri']]) {
    assert.throws(
      () => assertDshToolSchema({ type: 'string', [keyword]: value }, 'parameters'),
      new RegExp(`parameters\\.${keyword} is not a supported keyword`),
    )
    assert.throws(
      () => assertDshToolSchema({ type: 'array', items: { type: 'string', [keyword]: value } }, 'parameters'),
      new RegExp(`parameters\\.items\\.${keyword} is not a supported keyword`),
    )
  }
})

test('rejects an unsupported type, a non-object schema and a mismatched required list', () => {
  assert.throws(() => assertDshToolSchema({ type: 'date' }, 'parameters'), /parameters\.type is not a supported JSON Schema type/)
  assert.throws(() => assertDshToolSchema('not a schema', 'parameters'), /parameters must be a JSON Schema object/)
  assert.throws(() => assertDshToolSchema({ type: 'object', properties: {}, required: ['missing'] }, 'parameters'),
    /parameters\.required names an undeclared property/)
})

test('every registered tool schema passes the same check the Host runs before registering', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const originalHome = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'iui-tool-schema-'))
  process.env.DSH_HOME = home
  try {
    const plugin = await import('../../lib/index.js')
    const registered = { tool: undefined }
    // A stub context: `apply` runs the Host's own schema check before it
    // registers anything, so a schema outside the subset throws here.
    plugin.apply({
      on() {},
      inject() {},
      tools: { register(definition) { registered.tool = definition } },
      systemPrompt: { section() {} },
    })
    assert.equal(registered.tool.name, 'render_ui')
    assertDshToolSchema(registered.tool.parameters, 'parameters')
    assertDshToolSchema(registered.tool.output.schema, 'output.schema')
  } finally {
    rmSync(home, { recursive: true, force: true })
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
  }
})
