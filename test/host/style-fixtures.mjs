/** Valid theme tokens shared by the Host contract tests. */
export const THEME = {
  light: { canvas: '#ffffff', ink: '#111111', accent: '#2255aa', muted: '#666666' },
  dark: { canvas: '#111111', ink: '#eeeeee', accent: '#88aaff', surface: '#222222', border: '#444444' },
  font: 'sans', radius: 'soft', density: 'comfortable', shadow: 'soft',
}

/** One canonical stored template; overrides make scope and base-layout cases explicit. */
export function template(overrides = {}) {
  return {
    id: 'cs_abcdef123456', name: 'Field notes', description: 'Readable notes',
    baseLayout: 'card', directives: '  Prefer clear examples and short sections.  ', theme: structuredClone(THEME),
    scope: 'global', createdAt: 100, updatedAt: 100, ...overrides,
  }
}

/** Creation payload without store-owned identity and timestamps. */
export function styleInput(overrides = {}) {
  const { id, createdAt, updatedAt, ...input } = template()
  return { ...input, ...overrides }
}
