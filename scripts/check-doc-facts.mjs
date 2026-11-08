#!/usr/bin/env node
/**
 * Check the current-state facts quoted by the README, architecture docs,
 * verification record and CHANGELOG against docs/current-facts.json.
 *
 * Historical verification records intentionally keep their own numbers; this
 * checker only looks at the current README/architecture lines, the last
 * (newest) verification section and the CHANGELOG's current gate values.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const facts = JSON.parse(readFileSync(resolve(root, 'docs/current-facts.json'), 'utf8'))
const read = file => readFileSync(resolve(root, file), 'utf8')
const failures = []
const expect = (file, fragment) => {
  if (!read(file).includes(fragment)) failures.push(`${file}: missing ${JSON.stringify(fragment)}`)
}

if (facts.host + facts.client + facts.packaging !== facts.nodeTotal) {
  console.error(`doc-facts: host ${facts.host} + client ${facts.client} + packaging ${facts.packaging} != nodeTotal ${facts.nodeTotal}`)
  process.exit(1)
}
const node = `${facts.nodeTotal}/${facts.nodeTotal}`
for (const file of ['README.md', 'README.en.md']) {
  expect(file, node)
  expect(file, `${facts.host}`)
  expect(file, `${facts.client}`)
  expect(file, `**${facts.artifactEditChecks}**`)
  expect(file, `**${facts.nestedRendererChecks}**`)
  expect(file, `${facts.browserSuites}/9`)
}
for (const file of ['docs/architecture.md', 'docs/architecture.en.md']) {
  expect(file, node)
  expect(file, `${facts.host}`)
  expect(file, `${facts.client}`)
  expect(file, `${facts.artifactEditChecks} checks`)
  expect(file, `${facts.buildHostKb} kB`)
  expect(file, `${facts.clientCssKb.toFixed(1)} kB`)
  expect(file, `js ${facts.clientJsMb.toFixed(2)}`)
}
for (const file of ['CHANGELOG.md']) {
  expect(file, node)
  expect(file, `${facts.packFiles} files`)
  expect(file, facts.packedBytes.toLocaleString('en-US'))
  expect(file, facts.unpackedBytes.toLocaleString('en-US'))
}
for (const file of ['docs/verification.md', 'docs/verification.en.md']) {
  // Only the newest appended record must quote the current gate values.
  const text = read(file)
  const headings = [...text.matchAll(/^## .*$/gm)]
  const heading = headings.length === 0 ? 0 : headings[headings.length - 1].index
  const latest = text.slice(heading)
  const required = [
    node,
    `${facts.host}`,
    `${facts.client}`,
    `${facts.artifactEditChecks} checks`,
    `${facts.buildHostKb} kB`,
    `${facts.clientCssKb.toFixed(1)}`,
    `js ${facts.clientJsMb.toFixed(2)}`,
    `${facts.browserSuites}/9`,
    facts.packedBytes.toLocaleString('en-US'),
    facts.unpackedBytes.toLocaleString('en-US'),
  ]
  for (const fragment of required) {
    if (!latest.includes(fragment)) failures.push(`${file} (latest record): missing ${JSON.stringify(fragment)}`)
  }
}
if (failures.length > 0) {
  console.error(`doc-facts: ${failures.length} mismatch(es); update docs/current-facts.json only from a real gate run:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`doc-facts: ok (Node ${node}; artifact-edit ${facts.artifactEditChecks}; pack ${facts.packedBytes}/${facts.unpackedBytes})`)
