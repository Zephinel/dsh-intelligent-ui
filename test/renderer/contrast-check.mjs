#!/usr/bin/env node
/**
 * Contrast regression check for the DSH OpenUI Lang colour contract.
 *
 * Found in the wild: a model built a selectable tile row with
 * `Pressable(..., true, 2, "ink")` and `Text(..., "surface")` on the selected
 * item. "surface" is a 4% ink wash, so the selected label painted transparent
 * ink on ink: unreadable in both themes. The same tile was unreadable when the
 * program left the text colour unset, because an ink fill did not flip the
 * content colour.
 *
 * The renderer parses its program in effects, so a server render only yields
 * the loading shell. This check therefore exercises the colour helpers
 * (`fg`, `textFg`, `onColor`, `bg`) that every component uses, which is the
 * seam the bug lived on:
 *   - text/icon colours ignore surface-only tokens (surface, surface-strong, border)
 *   - a background of "ink" switches its content to the on-ink tokens
 *   - raw CSS colour backgrounds still get computed dark/light text
 *   - SVG paint (fg) keeps accepting "surface"
 *
 *   node test/renderer/contrast-check.mjs
 */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'test/renderer/.build')
const entry = join(outDir, 'contrast-check.entry.ts')
const outfile = join(outDir, 'contrast-check.mjs')

await mkdir(outDir, { recursive: true })
await writeFile(entry, `
import { bg, fg, onColor, textFg } from ${JSON.stringify(join(root, 'src/lib/components/style.ts'))}

const result = {
  textSurface: textFg('surface'),
  textSurfaceStrong: textFg('surface-strong'),
  textBorder: textFg('border'),
  textInk: textFg('ink'),
  textMuted: textFg('muted'),
  textHex: textFg('#123456'),
  paintSurface: fg('surface'),
  paintInk: fg('ink'),
  onInk: onColor('ink'),
  onChart: onColor('chart1'),
  onRawDark: onColor('#111111'),
  onRawLight: onColor('#fafafa'),
  onSurface: onColor('surface'),
  backgroundInk: bg('ink'),
  backgroundStatus: bg('warning'),
}
process.stdout.write(JSON.stringify(result))
`)

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
})

const stdout = execFileSync(process.execPath, [outfile], { encoding: 'utf8' })
const got = JSON.parse(stdout)

const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// Text and icon colours never use surface-only tokens; they inherit instead.
check('textFg("surface")', got.textSurface, undefined)
check('textFg("surface-strong")', got.textSurfaceStrong, undefined)
check('textFg("border")', got.textBorder, undefined)
check('textFg("ink")', got.textInk, 'var(--iui-content-ink)')
check('textFg("muted")', got.textMuted, 'var(--iui-content-muted)')
check('textFg("#123456")', got.textHex, '#123456')
// SVG paint keeps accepting the surface token.
check('fg("surface")', got.paintSurface, 'var(--iui-surface)')
check('fg("ink")', got.paintInk, 'var(--iui-ink)')
// An inverted ink fill flips content tokens.
check('onColor("ink").color', got.onInk.color, 'var(--iui-on-ink)')
check('onColor("ink")[--iui-content-ink]', got.onInk['--iui-content-ink'], 'var(--iui-on-ink)')
// Raw CSS colours keep the computed contrast.
check('onColor("#111111").color', got.onRawDark.color, '#ffffff')
check('onColor("#fafafa").color', got.onRawLight.color, '#0d0d0d')
// A surface wash is not an inverted fill: keep the page ink.
check('onColor("surface")', got.onSurface, {})
check('bg("ink")', got.backgroundInk, 'var(--iui-ink)')
check('onColor("chart1").color', got.onChart.color, 'var(--iui-chart-1-on)')
check('bg("warning")', got.backgroundStatus, 'var(--iui-warning-soft)')

if (failures.length > 0) {
  for (const failure of failures) console.error('FAIL ' + failure)
  console.error(`contrast-check: ${failures.length} failure(s)`)
  process.exit(1)
}
console.log('contrast-check: colour contract OK (text/icon, ink inversion, raw colours, paint tokens)')
