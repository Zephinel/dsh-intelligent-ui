import { createElement, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ToggleControl } from '../../../src/client/ToggleControl.tsx'
import type { IntelligentUIModeView } from '../../../src/shared/intelligent-ui.ts'

const base: IntelligentUIModeView = {
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

/** Toggle fixture so the E2E can also exercise the disabled Display style row. */
function Harness(): ReactElement {
  const [view, setView] = useState<IntelligentUIModeView>(base)
  ;(window as unknown as { __setEnabled: (enabled: boolean) => void }).__setEnabled = (enabled) => {
    setView(enabled ? base : { ...base, sessionEnable: 'off', globalEnabled: false, enabled: false })
  }
  return createElement(ToggleControl, {
    useProjection: () => view,
    locked: false,
    sessionId: 'e2e-session',
    flip: async (scope: string) => { calls.push(`enable:${scope}`); return null },
    setStyle: async (style: string) => { calls.push(`style:${style}`); return null },
  } as never)
}

createRoot(document.getElementById('root')!).render(createElement(Harness))
