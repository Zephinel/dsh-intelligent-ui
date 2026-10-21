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
  assert.deepEqual(tool.parameters.required, ['program', 'style'])
  assert.deepEqual(Object.keys(tool.parameters.properties), ['program', 'title', 'style'])
  assert.deepEqual(tool.parameters.properties.style.enum, ['card', 'article'])
  assert.equal(tool.output.schema.type, 'object')
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'tool:intelligent-ui')
  assert.equal(typeof sections[0].text, 'function', 'the prompt resolves per request (empty while the switch is off)')
  const enabledText = sections[0].text()
  assert.ok(enabledText.length > 10_000)
  assert.match(enabledText, /Answer style for this session: \*\*Auto\*\*/)
})

test('the free-composition preference appends its advisory note to the prompt', () => {
  const { sections } = mount({ freeComposition: { get: () => true } })
  assert.match(sections[0].text(), /Free-form layout is on/)
})

test('accepts a valid program and reports statement count and style', async () => {
  const { tool } = mount({ globalEnabled: { get: () => true }, answerStyle: { get: () => 'card' } })
  const result = await tool.execute({ program: VALID, style: 'card' })
  assert.equal(result.statements, 5)
  assert.equal(result.style, 'card')
  assert.equal(result.warnings, undefined)
})

test('requires a style argument', async () => {
  const { tool } = mount({ globalEnabled: { get: () => true }, answerStyle: { get: () => 'auto' } })
  await assert.rejects(
    () => tool.execute({ program: VALID }),
    /pass style "card" or "article"/,
  )
})

test('rejects an invalid program with a model-readable error', async () => {
  const { tool } = mount({ globalEnabled: { get: () => true }, answerStyle: { get: () => 'auto' } })
  await assert.rejects(
    () => tool.execute({ program: 'root = Col([title])\ntitle = WrongComponent("x")', style: 'card' }),
    /not valid openui-lang/,
  )
})

test('rejects an unknown component name', async () => {
  const { tool } = mount({ globalEnabled: { get: () => true }, answerStyle: { get: () => 'auto' } })
  await assert.rejects(
    () => tool.execute({ program: 'root = Col([title])\ntitle = NotAThing("x")', style: 'card' }),
    /not valid openui-lang/,
  )
})

test('rejects an empty program', async () => {
  const { tool } = mount({ globalEnabled: { get: () => true }, answerStyle: { get: () => 'auto' } })
  await assert.rejects(
    () => tool.execute({ program: '   ', style: 'card' }),
    /program must be a non-empty/,
  )
})

test('accepts the article Section/Toc vocabulary', async () => {
  const { tool } = mount({ globalEnabled: { get: () => true }, answerStyle: { get: () => 'article' } })
  const program = `root = Col([title, toc, s1])
title = Title("A short history", "xl")
toc = Toc(["一、Origins"])
s1 = Section("一、Origins", [Markdown("First paragraph.\\n\\nSecond paragraph.")])`
  const result = await tool.execute({ program, style: 'article' })
  assert.equal(result.style, 'article')
  assert.equal(result.statements, 4)
})

test('article style requires a reachable Toc and Section', async () => {
  const { tool } = mount({ globalEnabled: { get: () => true }, answerStyle: { get: () => 'auto' } })
  await assert.rejects(
    () => tool.execute({ program: 'root = Markdown("plain")', style: 'article' }),
    /article style needs a Toc and at least one Section/,
  )
})

test('accepts explicit Section anchors so display titles may repeat', async () => {
  const { tool } = mount({ globalEnabled: { get: () => true }, answerStyle: { get: () => 'article' } })
  const program = `root = Col([toc, s1, s2])
toc = Toc(["Background", "Background"], ["background-1", "background-2"])
s1 = Section("Background", [Markdown("One.")], "background-1")
s2 = Section("Background", [Markdown("Two.")], "background-2")`
  const result = await tool.execute({ program, style: 'article' })
  assert.equal(result.style, 'article')
})

test('rejects duplicate article anchors so ids stay unique', async () => {
  const { tool } = mount({ globalEnabled: { get: () => true }, answerStyle: { get: () => 'article' } })
  const program = `root = Col([toc, s1, s2])
toc = Toc(["Background", "Background"])
s1 = Section("Background", [Markdown("One.")])
s2 = Section("Background", [Markdown("Two.")])`
  await assert.rejects(
    () => tool.execute({ program, style: 'article' }),
    /Section anchors must be unique/,
  )
})

test('rejects Toc entries that do not target a Section anchor', async () => {
  const { tool } = mount({ globalEnabled: { get: () => true }, answerStyle: { get: () => 'article' } })
  const program = `root = Col([toc, s1])
toc = Toc(["Missing section"])
s1 = Section("Present section", [Markdown("Body.")])`
  await assert.rejects(
    () => tool.execute({ program, style: 'article' }),
    /every Toc entry must target a Section anchor/,
  )
})

test('rejects duplicate Section anchors outside the Article style too', async () => {
  const { tool } = mount({ globalEnabled: { get: () => true }, answerStyle: { get: () => 'card' } })
  const program = `root = Col([s1, s2])
s1 = Section("Background", [Markdown("One.")])
s2 = Section("Background", [Markdown("Two.")])`
  await assert.rejects(
    () => tool.execute({ program, style: 'card' }),
    /Section anchors must be unique/,
  )
})
