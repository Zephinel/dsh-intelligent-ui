import { useMemo, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsPage } from '../../../src/client/SettingsPage.tsx'
import { fallbackT } from '../../../src/shared/locales.ts'
import '../../../src/client/index.css'

const base = {
  globalEnabled: false,
  answerStyle: 'auto' as const,
  freeComposition: false,
  exportBackground: '#ffffff',
  exportScale: '2x' as const,
  exportToAssistant: true,
}

const calls: { field: string; value: unknown }[] = []
;(window as unknown as { __calls: typeof calls }).__calls = calls

/** Settings fixture: the picker writes through the same fake settings form. */
function Harness(): ReactElement {
  const [snapshot, setSnapshot] = useState({ status: 'ready' as const, writable: true, value: base })
  const form = useMemo(() => ({
    status: 'ready' as const,
    writable: true,
    value: snapshot.value,
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    set: async (field: string, next: unknown) => {
      calls.push({ field, value: next })
      setSnapshot(current => ({ ...current, value: { ...current.value, [field]: next } }))
      return true
    },
  }), [snapshot])
  return <SettingsPage settingsForm={form as never} t={fallbackT} />
}

createRoot(document.getElementById('root')!).render(<Harness />)
