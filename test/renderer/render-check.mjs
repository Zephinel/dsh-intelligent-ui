#!/usr/bin/env node
/**
 * Render smoke test for the DSH OpenUI Lang renderer.
 *
 * Server-renders every gallery program through the exported `OpenUIRenderer`
 * with `react-dom/server`. Effects (maps, photos, timers) do not run on the
 * server, but a render-time crash in the renderer, the library or a component
 * the model composed does — so this catches integration breaks before the
 * browser E2E. Warnings from client-only effects are expected and ignored.
 *
 *   node test/renderer/render-check.mjs
 *   node test/renderer/render-check.mjs /path/to/src/app/gallery
 *
 * Exits nonzero if any program throws or renders (almost) nothing.
 */
import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
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
  console.error(`render-check: no gallery programs at ${galleryDir}`)
  process.exit(2)
}

await mkdir(outDir, { recursive: true })
const entry = join(outDir, 'render-check.entry.tsx')
const outfile = join(outDir, 'render-check.mjs')

await (await import('node:fs/promises')).writeFile(entry, `
import { createElement } from 'react'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { OpenUIRenderer } from ${JSON.stringify(join(root, 'src/lib/render.tsx'))}
import { resolveStyleThemeVars } from ${JSON.stringify(join(root, 'src/lib/style-theme.ts'))}
import { THEME } from ${JSON.stringify(join(root, 'test/host/style-fixtures.mjs'))}
import { compositionPrograms } from ${JSON.stringify(join(galleryDir, 'composition-programs.ts'))}
import { programs } from ${JSON.stringify(join(galleryDir, 'programs.ts'))}
import { toolPrograms } from ${JSON.stringify(join(galleryDir, 'tool-programs.ts'))}

const all = [...compositionPrograms, ...programs, ...toolPrograms]
let failed = 0
for (const program of all) {
  try {
    const markup = renderToStaticMarkup(createElement(OpenUIRenderer, { program: program.code }))
    if (markup.length < 50) {
      failed += 1
      console.error('FAIL ' + program.id + ' — rendered only ' + markup.length + ' characters')
    }
  } catch (error) {
    failed += 1
    console.error('FAIL ' + program.id + ' — ' + (error instanceof Error ? error.message : String(error)))
  }
}
console.log('render-check: ' + (all.length - failed) + '/' + all.length + ' gallery programs rendered from ' + ${JSON.stringify(galleryDir)})
// Free results pass their composition straight to the neutral renderer, with no shell.
for (const scheme of ['light', 'dark']) {
  const markup = renderToStaticMarkup(createElement(OpenUIRenderer, {
    program: 'root = Col([Title("Poster"), Grid([Text("Left"), Text("Right")], 2)])',
    themeStyle: resolveStyleThemeVars(THEME, scheme), scheme,
  }))
  assert.match(markup, /iui-grid/)
  assert.match(markup, /Poster/)
  assert.ok(markup.includes('--iui-canvas:' + THEME[scheme].canvas))
  assert.doesNotMatch(markup, /dsh-iui-article|iui-toc|iui-section|dsh-iui-fallback/)
}
console.log('render-check: free composition rendered without a reading shell in light/dark')
if (failed > 0) process.exitCode = 1
`)

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  jsx: 'automatic',
  jsxImportSource: 'react',
  plugins: [{
    name: 'stub-css',
    setup(api) {
      api.onResolve({ filter: /\.css$/ }, () => ({ path: 'css-stub', namespace: 'stub-css' }))
      api.onLoad({ filter: /.*/, namespace: 'stub-css' }, () => ({ contents: '', loader: 'js' }))
    },
  }],
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'maplibre-gl', 'lucide-react', 'lucide-react/*', 'katex'],
  logLevel: 'warning',
})

await import(pathToFileURL(outfile).href)
