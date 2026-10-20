#!/usr/bin/env node
/**
 * Localization smoke test for the OpenUI Lang renderer.
 *
 * Server-renders a few programs through the exported `OpenUIRenderer` twice:
 * once with the Chinese DSH locale seat, once with no seat (the English
 * fallback used by tests and standalone embeds). Asserts that the renderer's
 * own chrome — not the model's content — follows the seat, so a component that
 * forgets `useT()` fails here before the browser E2E.
 *
 *   node test/renderer/i18n-check.mjs
 *
 * Exits nonzero when any expected localized string is missing.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'test/renderer/.build')
await mkdir(outDir, { recursive: true })
const entry = join(outDir, 'i18n-check.entry.tsx')
const outfile = join(outDir, 'i18n-check.mjs')

await (await import('node:fs/promises')).writeFile(entry, `
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OpenUIRenderer } from ${JSON.stringify(join(root, 'src/lib/render.tsx'))}
import { translate, zh } from ${JSON.stringify(join(root, 'src/shared/locales.ts'))}

const t = translate(zh)
const cases = [
  { id: 'code', program: 'root = Code("print(1)", "python")', zh: ['复制', 'python'], en: ['Copy'] },
  { id: 'timer', program: 'root = Timer(60)', zh: ['开始', '重置'], en: ['Start', 'Reset'] },
  { id: 'map', program: 'root = Map([MapMarker("Cafe", 1, 2, "food"), MapMarker("Museum", 3, 4, "sight")], false)', zh: ['展开', '筛选地点', '全部地点'], en: ['Expand', 'Filter places', 'All places'] },
  { id: 'empty', program: '', zh: ['未提供程序。'], en: ['No program was provided.'] },
]
let failed = 0
for (const item of cases) {
  const zhMarkup = renderToStaticMarkup(createElement(OpenUIRenderer, { program: item.program, t }))
  const enMarkup = renderToStaticMarkup(createElement(OpenUIRenderer, { program: item.program }))
  for (const needle of item.zh) {
    if (!zhMarkup.includes(needle)) {
      failed += 1
      console.error('FAIL ' + item.id + ' (zh) — missing ' + JSON.stringify(needle))
    }
  }
  for (const needle of item.en) {
    if (!enMarkup.includes(needle)) {
      failed += 1
      console.error('FAIL ' + item.id + ' (en fallback) — missing ' + JSON.stringify(needle))
    }
  }
}
console.log('i18n-check: ' + (failed === 0 ? 'localized chrome OK (' + cases.length + ' programs, zh + en fallback)' : failed + ' missing localized string(s)'))
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
