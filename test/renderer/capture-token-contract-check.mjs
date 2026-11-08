#!/usr/bin/env node
/**
 * Contract check: the editor capture fixture must define every `--dsw-alias-*`
 * variable the client CSS references. A missing token silently renders a
 * transparent/white control in the README screenshot (e.g. the Apply style
 * button) even though the browser E2E sees the element.
 *
 *   node test/renderer/capture-token-contract-check.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(new URL('../..', import.meta.url).pathname)
const cssFiles = []
const walk = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name.endsWith('.css')) cssFiles.push(path)
  }
}
walk(join(root, 'src'))
const used = new Set()
for (const file of cssFiles) {
  for (const match of readFileSync(file, 'utf8').matchAll(/var\((--dsw-alias-[a-z0-9-]+)/g)) used.add(match[1])
}
const capture = readFileSync(join(root, 'scripts/capture-editor-screenshot.mjs'), 'utf8')
const defined = new Set()
for (const match of capture.matchAll(/(--dsw-alias-[a-z0-9-]+)\s*:\s*([^;]+);/g)) defined.add(match[1])
const missing = [...used].filter(token => !defined.has(token)).sort()
if (missing.length > 0) {
  console.error(`capture-token-contract: ${missing.length} token(s) used by src CSS but missing from the capture fixture:`)
  for (const token of missing) console.error(`  ${token}`)
  process.exit(1)
}
console.log(`capture-token-contract: ok (${used.size} alias token(s))`)
