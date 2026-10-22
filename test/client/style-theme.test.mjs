/** Controlled custom-theme tokens must leave the default and semantic CSS alone. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contrastRatio, resolveStyleThemeVars, STYLE_FONT_STACKS } from '../../src/lib/style-theme.ts'
import { THEME } from '../host/style-fixtures.mjs'

for (const scheme of ['light', 'dark']) {
  test(`${scheme} resolves the palette, CSS color scheme and readable ink fill`, () => {
    const vars = resolveStyleThemeVars(THEME, scheme)
    const palette = THEME[scheme]
    assert.equal(vars['--iui-canvas'], palette.canvas)
    assert.equal(vars['--iui-ink'], palette.ink)
    assert.equal(vars['--iui-chart-1'], palette.accent)
    assert.equal(vars['--iui-on-ink'], palette.canvas)
    assert.ok(contrastRatio(vars['--iui-on-ink'], palette.ink) >= 4.5)
    assert.equal(vars.colorScheme, scheme)
    assert.deepEqual(Object.keys(vars).filter(key => /chart|success|danger|warning|badge/.test(key)), ['--iui-chart-1'])
    for (const [key, percentage] of [['muted', 60], ['surface', 5], ['border', 10]]) {
      assert.equal(vars[`--iui-${key}`], palette[key] ?? `color-mix(in srgb, var(--iui-ink) ${percentage}%, transparent)`)
    }
    assert.equal(vars['--iui-shadow'], `0 4px 20px rgb(0 0 0 / ${scheme === 'dark' ? 35 : 6}%)`)
    assert.equal(vars['--iui-shadow-sm'], `0 1px 3px rgb(0 0 0 / ${scheme === 'dark' ? 30 : 5}%)`)
  })
}

test('preset radii and density are integer px values with the current comfortable defaults', () => {
  for (const [radius, expected] of [['sharp', [2, 4, 6, 8, 10]], ['soft', [6, 10, 12, 14, 20]], ['round', [10, 14, 18, 22, 28]]]) {
    const vars = resolveStyleThemeVars({ ...THEME, radius }, 'light')
    assert.deepEqual(['sm', 'md', 'lg', 'xl', '2xl'].map(size => vars[`--iui-radius-${size}`]), expected.map(n => `${n}px`))
  }
  const keys = ['space-tight', 'space-inner', 'space-group', 'space-group-lg', 'space-section', 'control-gap', 'field-gap', 'action-gap']
  const defaults = [4, 8, 12, 16, 24, 8, 24, 40]
  for (const [density, factor] of [['compact', 0.8], ['comfortable', 1], ['spacious', 1.2]]) {
    const vars = resolveStyleThemeVars({ ...THEME, density }, 'light')
    assert.deepEqual(keys.map(key => vars[`--iui-${key}`]), defaults.map(n => `${Math.round(n * factor)}px`))
  }
})

test('font and shadow presets resolve without loading resources or changing their input', () => {
  const before = structuredClone(THEME)
  for (const font of ['sans', 'serif', 'mono']) {
    assert.equal(resolveStyleThemeVars({ ...THEME, font }, 'light')['--iui-font'], STYLE_FONT_STACKS[font])
  }
  assert.match(STYLE_FONT_STACKS.serif, /Songti SC/)
  for (const scheme of ['light', 'dark']) {
    const none = resolveStyleThemeVars({ ...THEME, shadow: 'none' }, scheme)
    assert.equal(none['--iui-shadow'], 'none')
    assert.equal(none['--iui-shadow-sm'], 'none')
    assert.match(resolveStyleThemeVars({ ...THEME, shadow: 'float' }, scheme)['--iui-shadow'], /0 12px 32px/)
  }
  assert.deepEqual(THEME, before)
})

test('on-ink prefers a passing canvas, otherwise chooses readable white or black', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21)
  assert.equal(contrastRatio('#888888', '#888888'), 1)
  for (const [ink, expected] of [['#222222', '#ffffff'], ['#eeeeee', '#000000'], ['#777777', '#000000']]) {
    const vars = resolveStyleThemeVars({ ...THEME, light: { canvas: ink, ink, accent: '#ff0000' } }, 'light')
    assert.equal(vars['--iui-on-ink'], expected)
    assert.ok(contrastRatio(expected, ink) >= 4.5)
  }
})
