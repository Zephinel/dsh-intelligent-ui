/** Controlled fixtures shared by the panel and recorded-card browser checks. */
import type { StyleTemplate } from '../../../src/shared/style-templates.ts'

export const templates: StyleTemplate[] = [
  {
    id: 'cs_ocean01', name: 'Ocean notes', description: 'Clear reading', baseLayout: 'card', directives: '',
    scope: 'global', createdAt: 1, updatedAt: 1,
    theme: {
      light: { canvas: '#edf7ff', ink: '#112244', accent: '#3366cc' },
      dark: { canvas: '#102030', ink: '#ddecff', accent: '#66aaff' },
      font: 'serif', radius: 'round', density: 'spacious', shadow: 'float',
    },
  },
  {
    id: 'cs_field02', name: 'Field journal', description: 'Compact reference', baseLayout: 'article', directives: '',
    scope: 'global', createdAt: 1, updatedAt: 1,
    theme: {
      light: { canvas: '#f0fff4', ink: '#123320', accent: '#237744' },
      dark: { canvas: '#12251a', ink: '#dcffee', accent: '#66cc99' },
      font: 'mono', radius: 'sharp', density: 'compact', shadow: 'none',
    },
  },
  {
    id: 'cs_session3', name: 'Session sketch', description: '', baseLayout: 'card', directives: '',
    scope: 'session', sessionId: 'e2e-session', createdAt: 1, updatedAt: 1,
    theme: {
      light: { canvas: '#fff4fb', ink: '#331122', accent: '#aa4488' },
      dark: { canvas: '#25121f', ink: '#ffeef9', accent: '#ee88cc' },
      font: 'sans', radius: 'soft', density: 'comfortable', shadow: 'soft',
    },
  },
]

templates.push({ ...templates[0], id: 'cs_free004', name: 'Free composition', baseLayout: 'free', directives: 'Use parallel regions.' })
