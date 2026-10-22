import { useMemo, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsPage } from '../../../src/client/SettingsPage.tsx'
import { createStyleCatalog } from '../../../src/client/styles.ts'
import { templates } from './style-fixtures.ts'
import { fallbackT } from '../../../src/shared/locales.ts'
import '../../../src/client/index.css'

let savedTemplates = structuredClone(templates)
const w = window as any
w.__stylePosts = []
w.__styleError = ''
window.fetch = async (_url, options) => {
  if (options?.method !== 'POST') return new Response(JSON.stringify({ templates: savedTemplates }))
  const body = JSON.parse(options.body as string); w.__stylePosts.push(body)
  if (w.__styleError) return new Response(JSON.stringify({ error: { code: w.__styleError } }), { status: 400 })
  if (body.op === 'delete') {
    savedTemplates = savedTemplates.filter(t => t.id !== body.id)
    return new Response(JSON.stringify({ deleted: body.id }))
  }
  const template = { ...savedTemplates.find(t => t.id === body.id)!, ...body.patch, updatedAt: 3 }
  savedTemplates = savedTemplates.map(t => t.id === body.id ? template : t)
  return new Response(JSON.stringify({ template }))
}
const styles = createStyleCatalog()

const base = {
  globalEnabled: false,
  answerStyle: 'auto' as const,
  freeComposition: false,
  exportBackground: '#ffffff',
  exportScale: '2x' as const,
  removeFollowUps: true,
}

const calls: { field: string; value: unknown }[] = []
;(window as unknown as { __calls: typeof calls }).__calls = calls

/** Settings fixture: the picker writes through the same fake settings form. */
function Harness(): ReactElement {
  const [snapshot, setSnapshot] = useState({ status: 'ready' as const, writable: true, value: base })
  w.__readonly = (readonly: boolean) => setSnapshot(current => ({ ...current, writable: !readonly }))
  w.__unavailable = () => setSnapshot(current => ({ ...current, status: 'unavailable' as never, writable: false }))
  const form = useMemo(() => ({
    status: 'ready' as const,
    writable: true,
    value: snapshot.value,
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    set: async (field: string, next: unknown) => {
      calls.push({ field, value: next })
      if (w.__settingsFail) return false
      setSnapshot(current => ({ ...current, value: { ...current.value, [field]: next } }))
      return true
    },
  }), [snapshot])
  return <SettingsPage styles={styles} settingsForm={form as never} t={fallbackT} />
}

createRoot(document.getElementById('root')!).render(<Harness />)
