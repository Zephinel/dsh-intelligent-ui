/** Controlled template tokens, shared by browser rendering and pure Node checks. */
import { contrastRatio, type StyleTheme } from '../shared/style-templates.ts'
export { contrastRatio } from '../shared/style-templates.ts'

export const STYLE_FONT_STACKS = {
  sans: 'var(--openui-font-body, var(--dsw-font-family, "Inter", sans-serif))',
  serif: 'Georgia, "Times New Roman", "Songti SC", "Noto Serif CJK SC", SimSun, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
} as const

const RADII = {
  sharp: [2, 4, 6, 8, 10],
  soft: [6, 10, 12, 14, 20],
  round: [10, 14, 18, 22, 28],
} as const

const SPACING = {
  'space-tight': 4,
  'space-inner': 8,
  'space-group': 12,
  'space-group-lg': 16,
  'space-section': 24,
  'control-gap': 8,
  'field-gap': 24,
  'action-gap': 40,
} as const

/** Resolve only the visual whitelist; semantic status and other chart colors remain CSS-owned. */
export function resolveStyleThemeVars(theme: StyleTheme, scheme: 'light' | 'dark'): Record<string, string> {
  const palette = theme[scheme]
  const onInk = contrastRatio(palette.canvas, palette.ink) >= 4.5
    ? palette.canvas
    : contrastRatio('#ffffff', palette.ink) >= contrastRatio('#000000', palette.ink) ? '#ffffff' : '#000000'
  const dark = scheme === 'dark'
  const vars: Record<string, string> = {
    '--iui-canvas': palette.canvas,
    '--iui-ink': palette.ink,
    '--iui-on-ink': onInk,
    '--iui-muted': palette.muted ?? 'color-mix(in srgb, var(--iui-ink) 60%, transparent)',
    '--iui-surface': palette.surface ?? 'color-mix(in srgb, var(--iui-ink) 5%, transparent)',
    '--iui-border': palette.border ?? 'color-mix(in srgb, var(--iui-ink) 10%, transparent)',
    '--iui-font': STYLE_FONT_STACKS[theme.font],
    '--iui-chart-1': palette.accent,
    '--iui-shadow': theme.shadow === 'none' ? 'none'
      : theme.shadow === 'float' ? `0 12px 32px rgb(0 0 0 / ${dark ? 50 : 16}%)`
        : `0 4px 20px rgb(0 0 0 / ${dark ? 35 : 6}%)`,
    '--iui-shadow-sm': theme.shadow === 'none' ? 'none'
      : theme.shadow === 'float' ? `0 3px 10px rgb(0 0 0 / ${dark ? 40 : 12}%)`
        : `0 1px 3px rgb(0 0 0 / ${dark ? 30 : 5}%)`,
    // React's inline style seat uses the camel-case spelling of color-scheme.
    colorScheme: scheme,
  }
  const sizes = ['sm', 'md', 'lg', 'xl', '2xl']
  RADII[theme.radius].forEach((value, index) => { vars[`--iui-radius-${sizes[index]}`] = `${value}px` })
  const scale = theme.density === 'compact' ? 0.8 : theme.density === 'spacious' ? 1.2 : 1
  for (const [key, value] of Object.entries(SPACING)) vars[`--iui-${key}`] = `${Math.round(value * scale)}px`
  return vars
}
