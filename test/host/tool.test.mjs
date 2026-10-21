/**
 * Host-half regression test: load the built `lib/index.js` with a fake Cordis
 * context and exercise the `render_ui` tool contract.
 *
 *   node scripts/build.mjs host
 *   node --test test/host/tool.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

const plugin = await import('../../lib/index.js')

/** Mount the plugin on a stub context and return its registrations. */
function mount(config) {
  const registered = { tool: undefined, sections: [] }
  plugin.apply({
    tools: { register(definition) { registered.tool = definition } },
    systemPrompt: { section(section) { registered.sections.push(section) } },
  }, config)
  return registered
}

const VALID = `root = Col([title, intro, facts, chart])
title = Title("A day in San Francisco", "xl")
intro = Text("Start at the Ferry Building, then walk the waterfront.")
facts = Row([Badge("2.1 km walk"), Badge("Morning", "info")], 2)
chart = Chart("bar", [{label: "Coffee", value: 2}, {label: "Walk", value: 3}], "label", ["value"])`

test('registers the render_ui tool with its argument schema and one prompt section', () => {
  const { tool, sections } = mount()
  assert.equal(tool.name, 'render_ui')
  assert.match(tool.description, /openui-lang/)
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.required, ['program'])
  assert.deepEqual(Object.keys(tool.parameters.properties), ['program', 'title'])
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'tool:intelligent-ui')
  assert.equal(typeof sections[0].text, 'function', 'the prompt resolves per request (empty while the switch is off)')
  const enabledText = sections[0].text()
  assert.ok(enabledText.length > 10_000, 'the OpenUI Lang generation prompt is contributed while the host switch is on')
  assert.match(enabledText, /render_ui/)
})

test('the free-composition preference appends its advisory note to the prompt', () => {
  // The Plugin detail page writes this volatile field; the prompt reads it live.
  assert.ok(plugin.Config, 'the Host exports the settings schema')
  const strict = mount()
  assert.doesNotMatch(strict.sections[0].text(), /Free composition is on for this deployment/)
  const free = mount({ freeComposition: { get: () => true } })
  const text = free.sections[0].text()
  assert.match(text, /Free composition is on for this deployment/)
  assert.match(text, /advisory rather than a template/)
})

test('accepts a valid program and reports statement count', async () => {
  const { tool } = mount()
  const value = await tool.execute({ program: VALID }, { signal: AbortSignal.timeout(5000) })
  assert.equal(value.statements, 5)
  assert.equal(value.warnings, undefined)
  const rendered = tool.output.render({ program: VALID }, value)
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /Interactive UI rendered for the user \(5 statements\)/)
})

test('rejects an invalid program with a model-readable error', async () => {
  const { tool } = mount()
  await assert.rejects(
    () => tool.execute({ program: 'root = Col([broken' }, { signal: AbortSignal.timeout(5000) }),
    (error) => {
      assert.match(error.message, /not valid openui-lang/)
      assert.match(error.message, /Fix it and call render_ui again/)
      return true
    },
  )
})

test('rejects an unknown component name', async () => {
  const { tool } = mount()
  await assert.rejects(
    () => tool.execute({ program: 'root = NotAComponent("x")' }, { signal: AbortSignal.timeout(5000) }),
    /not valid openui-lang/,
  )
})

test('rejects an empty program', async () => {
  const { tool } = mount()
  await assert.rejects(
    () => tool.execute({ program: '   ' }, { signal: AbortSignal.timeout(5000) }),
    /program must be a non-empty/,
  )
})
