/**
 * Guard every inline Remix Icon name against the plugin's path table.
 *
 * The plugin deliberately inlines its icon paths instead of importing the
 * remixicon package, so a new `name="..."` that was not transcribed into
 * REMIX_ICON_PATHS renders an empty <svg> at runtime (esbuild does not check
 * the union and the client directory is outside tsc's include). This test keeps
 * that failure from re-entering the UI.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Every .tsx file under src, excluding generated/build output. */
function sourceFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (entry === 'generated' || entry === 'node_modules') continue
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path))
    else if (path.endsWith('.tsx')) files.push(path)
  }
  return files
}

test('every static RemixIcon name exists in the inline path table', () => {
  // Parse the path table from the .tsx source: Node's test runner does not
  // transform JSX, so the module cannot be imported directly here.
  const tableSource = readFileSync(resolve(root, 'src/lib/components/remix-icon.tsx'), 'utf8')
  const known = new Map([...tableSource.matchAll(/^  "([^"]+)": "([^"]*)",/gm)].map(match => [match[1], match[2]]))
  assert.ok(known.size > 10, 'the inline icon table was found')
  for (const [name, path] of known) assert.ok(path.length > 0, `empty path for ${name}`)

  const missing = []
  for (const file of sourceFiles(resolve(root, 'src'))) {
    const source = readFileSync(file, 'utf8')
    const names = []
    for (const tag of source.matchAll(/<RemixIcon\b[^>]*>/g)) {
      const attribute = tag[0].match(/\bname=(?:"([^"]+)"|'([^']+)'|\{([^}]*)\})/)
      if (attribute === null) continue
      if (attribute[1] !== undefined || attribute[2] !== undefined) {
        names.push(attribute[1] ?? attribute[2])
      } else {
        // Static string literals inside a JSX expression, e.g. a ternary.
        for (const literal of attribute[3].matchAll(/["']([^"']+)["']/g)) names.push(literal[1])
      }
    }
    for (const name of names) {
      if (!known.has(name)) missing.push(`${file.replace(root + '/', '')}: ${name}`)
    }
  }
  assert.deepEqual(missing, [], `RemixIcon names missing from REMIX_ICON_PATHS:\n${missing.join('\n')}`)
})
