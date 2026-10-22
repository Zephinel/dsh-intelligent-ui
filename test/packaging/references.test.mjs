/**
 * Documentation regressions: the shipped Agent Skill catalog must match the
 * vendored spec the host validates against.
 *
 * `skills/intelligent-ui/references/components.md` is the model's complete API
 * list and `SKILL.md` repeats its counts in the hard rules. A component or
 * function added to `vendor/spec.json` without updating them sends the model at
 * a vocabulary the runtime rejects, so both are checked here.
 *
 *   node --test test/packaging/references.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const spec = JSON.parse(read('vendor/spec.json'))
const schema = spec.schema
const docs = read('skills/intelligent-ui/references/components.md')
const skill = read('skills/intelligent-ui/SKILL.md')
const integration = read('skills/intelligent-ui/references/integration.md')
const hostSource = read('src/host/index.ts')
const pkg = JSON.parse(read('package.json'))

/** Rows in a markdown table stack: `| \`@Name\` …`. */
const tableNames = (section) => [...section.matchAll(/^\| `@([A-Za-z]+)`/gm)].map((match) => match[1])

const coreSection = docs.slice(docs.indexOf('## Core `@functions`'), docs.indexOf('## Library `@functions`'))
const librarySection = docs.slice(docs.indexOf('## Library `@functions`'), docs.indexOf('### Function families'))
const actionSection = docs.slice(docs.indexOf('## Action steps'))

const documentedComponents = [...docs.matchAll(/^### `([A-Za-z]+)`$/gm)].map((match) => match[1])
const actualComponents = Object.keys(schema.$defs).filter((name) => name !== 'ActionExpression')
const documentedCore = tableNames(coreSection)
const documentedLibrary = tableNames(librarySection)
const documentedActions = tableNames(actionSection)
const actualLibrary = Object.keys(schema.functions ?? {})
const actualActions = Object.keys(schema.actions ?? {})
// Language builtins every OpenUI Lang runtime exposes beside the library action.
const builtinActions = ['OpenUrl', 'Reset', 'Set', 'ToAssistant']

test('the component reference lists exactly the components the host validates', () => {
  assert.equal(documentedComponents.length, actualComponents.length, 'component count')
  assert.deepEqual([...documentedComponents].sort(), [...actualComponents].sort())
})

test('the function reference lists exactly the shipped library functions', () => {
  assert.equal(documentedLibrary.length, actualLibrary.length, 'library function count')
  assert.deepEqual([...documentedLibrary].sort(), [...actualLibrary].sort())
  assert.equal(documentedCore.length, 14, 'core function count')
})

test('the action reference lists the builtins plus the shipped library action', () => {
  assert.deepEqual([...documentedActions].sort(), [...builtinActions, ...actualActions].sort())
})

test('the reference header and SKILL.md hard rules repeat the real counts', () => {
  const header = /\*\*(\d+) components\*\*, \*\*(\d+) library `@functions`\*\*, \*\*(\d+) core `@functions`\*\* \(73 callable in total\) and \*\*(\d+) action steps\*\*/.exec(docs)
  assert.ok(header, 'components.md header carries the counts')
  assert.deepEqual(
    header.slice(1).map(Number),
    [actualComponents.length, actualLibrary.length, documentedCore.length, documentedActions.length],
  )

  const rules = /(\d+) components, (\d+) core \+ (\d+) library `@functions`, (\d+) action steps/.exec(skill)
  assert.ok(rules, 'SKILL.md hard rules carry the counts')
  assert.deepEqual(
    rules.slice(1).map(Number),
    [actualComponents.length, documentedCore.length, actualLibrary.length, documentedActions.length],
  )
})

/** One `| <label> | … |` contract row, joined across wrapped lines. */
const contractRow = (label) => {
  const rows = integration.split('\n').filter((line) => line.startsWith(`| ${label} |`))
  assert.equal(rows.length, 1, `integration.md has one "${label}" contract row`)
  const index = integration.split('\n').indexOf(rows[0])
  return [rows[0], integration.split('\n')[index + 1] ?? ''].join(' ')
}

/** `required: [...]` arrays declared in the host tool schemas, in INPUT/OUTPUT order. */
const hostRequired = [...hostSource.slice(hostSource.indexOf('const PARAMETERS =')).matchAll(/^  required: \[([^\]]*)\]/gm)]
  .map((match) => [...match[1].matchAll(/'([^']+)'/g)].map((field) => field[1]))
  .filter((fields) => fields.length > 0)

test('the shipped integration reference matches the host render_ui schemas', () => {
  // INPUT then OUTPUT: the model-facing contract these docs describe.
  assert.deepEqual(hostRequired.slice(0, 2), [['program', 'style'], ['statements', 'style']])

  const argumentsRow = contractRow('Arguments')
  for (const field of hostRequired[0]) assert.match(argumentsRow, new RegExp(`"${field}"`), `Arguments row names ${field}`)
  assert.match(argumentsRow, /additionalProperties: false/)
  for (const field of ['styleId', 'temporaryStyle']) assert.match(argumentsRow, new RegExp(field), `Arguments row names ${field}`)

  const successRow = contractRow('Success value')
  for (const field of hostRequired[1]) assert.match(successRow, new RegExp(`"${field}"`), `Success value row names ${field}`)

  assert.match(successRow, /styleSource/)
  assert.match(contractRow('`temporaryStyle`'), /Host-authorized/)
  assert.match(contractRow('`styleId`'), /Mutually exclusive/)

  const resultRow = contractRow('Model-visible result')
  assert.match(resultRow, /<n> statements, <style> style/, 'result row quotes the current host line')
  assert.match(resultRow, / Notes:/, 'result row quotes the current warnings prefix')
  assert.doesNotMatch(resultRow, /\(<n> statements\)\./, 'result row drops the pre-style line')
})

test('the shipped file count quoted in integration.md matches the published file set', () => {
  const seen = new Set()
  const walk = (entry) => {
    const stat = statSync(new URL(entry, root))
    if (stat.isDirectory()) {
      for (const child of readdirSync(new URL(entry, root))) walk(`${entry}/${child}`)
    } else seen.add(entry)
  }
  for (const entry of pkg.files) walk(entry)
  // npm always adds package.json to the tarball; every listed path is otherwise counted once.
  const shipped = seen.size + 1
  const quoted = /\((\d+) files\)/.exec(integration)
  assert.ok(quoted, 'integration.md quotes the shipped file count')
  assert.equal(Number(quoted[1]), shipped, 'integration.md file count matches package.json files')
})
