#!/usr/bin/env node
/**
 * Parser self-check for the DSH OpenUI Lang renderer.
 *
 * Every gallery program the Open Intelligent UI project renders is parsed with
 * `@openuidev/lang-core` against *this* vendored library (`library.toJSONSchema()`),
 * so a component/schema regression in `src/lib` fails here before it reaches the
 * chat. It also imports the library in Node, which catches module-top-level
 * crashes and accidental `window`/`document` access (the browser bundle's
 * factory runs at module load too).
 *
 *   node test/renderer/check.mjs                 # /tmp/oiui gallery if present,
 *                                                # else the copy in test/renderer/gallery
 *   node test/renderer/check.mjs /path/to/gallery # upstream src/app/gallery directory
 *
 * The harness is bundled with esbuild into test/renderer/.build/ and is never
 * part of the client bundle. Exits nonzero on the first failing program.
 */
import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'test/renderer/.build')
const upstream = '/tmp/oiui/src/app/gallery'
const vendored = join(root, 'test/renderer/gallery')
const requested = process.argv[2] ?? process.env.OIUI_GALLERY
const galleryDir = requested
  ? resolve(requested)
  : existsSync(upstream) ? upstream : vendored

if (!existsSync(join(galleryDir, 'programs.ts'))) {
  console.error(`check: no gallery programs at ${galleryDir}`)
  process.exit(2)
}

await mkdir(outDir, { recursive: true })
const entry = join(outDir, 'check.entry.ts')

// The entry imports the real library, so CSS imports are emptied by the loader
// and only Node-safe modules are externalized.
await writeFile(entry, `
import { createParser } from '@openuidev/lang-core'
import { library } from ${JSON.stringify(join(root, 'src/lib/library.ts'))}
import { compositionPrograms } from ${JSON.stringify(join(galleryDir, 'composition-programs.ts'))}
import { programs } from ${JSON.stringify(join(galleryDir, 'programs.ts'))}
import { toolPrograms } from ${JSON.stringify(join(galleryDir, 'tool-programs.ts'))}

const all = [
  ...compositionPrograms,
  ...programs,
  ...toolPrograms,
]
const parser = createParser(library.toJSONSchema(), library.root ?? 'Col')
const failures = []
for (const program of all) {
  try {
    const result = parser.parse(program.code)
    const errors = result.meta.errors
    if (errors.length > 0) {
      failures.push({ id: program.id, reason: errors.map((error) => {
        const where = [error.component, error.path].filter(Boolean).join(' ')
        return where ? where + ': ' + error.message : error.message
      }).join('; ') })
    } else if (!result.root) {
      failures.push({ id: program.id, reason: 'parser produced no root element' })
    }
  } catch (error) {
    failures.push({ id: program.id, reason: 'threw: ' + (error instanceof Error ? error.message : String(error)) })
  }
}

for (const failure of failures) console.error('FAIL ' + failure.id + ' — ' + failure.reason)
console.log('check: ' + (all.length - failures.length) + '/' + all.length + ' gallery programs parsed from ' + ${JSON.stringify(galleryDir)})
if (failures.length > 0) process.exitCode = 1
`)

await build({
  entryPoints: [entry],
  outfile: join(outDir, 'check.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  loader: { '.css': 'empty' },
  // CSS imports (including ones inside externalized packages) become empty
  // modules; Node cannot evaluate them and they do not affect parsing.
  plugins: [{
    name: 'stub-css',
    setup(api) {
      api.onResolve({ filter: /\.css$/ }, () => ({ path: 'css-stub', namespace: 'stub-css' }))
      api.onLoad({ filter: /.*/, namespace: 'stub-css' }, () => ({ contents: '', loader: 'js' }))
    },
  }],
  // React DOM and the browser-only media libraries are irrelevant to parsing;
  // keeping them external also proves the library graph stays import-safe.
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'maplibre-gl', 'lucide-react', 'lucide-react/*', 'katex'],
  logLevel: 'warning',
})

await import(pathToFileURL(join(outDir, 'check.mjs')).href)
