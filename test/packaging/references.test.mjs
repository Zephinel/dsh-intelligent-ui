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
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const spec = JSON.parse(read('vendor/spec.json'))
const schema = spec.schema
const docs = read('skills/intelligent-ui/references/components.md')
const skill = read('skills/intelligent-ui/SKILL.md')

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
