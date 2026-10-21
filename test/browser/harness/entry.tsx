import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ToggleControl } from '../../../src/client/ToggleControl.tsx'
import type { IntelligentUIModeView } from '../../../src/shared/intelligent-ui.ts'

const view: IntelligentUIModeView = {
  sessionEnable: 'inherit',
  sessionStyle: 'inherit',
  globalEnabled: true,
  globalStyle: 'auto',
  enabled: true,
  style: 'auto',
  pending: false,
}

const calls: string[] = []
;(window as unknown as { __calls: string[] }).__calls = calls

createRoot(document.getElementById('root')!).render(
  createElement(ToggleControl, {
    useProjection: () => view,
    locked: false,
    sessionId: 'e2e-session',
    flip: async (scope: string) => { calls.push(`enable:${scope}`); return null },
    setStyle: async (style: string) => { calls.push(`style:${style}`); return null },
  } as never),
)
