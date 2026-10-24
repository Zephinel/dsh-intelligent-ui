import { useMemo, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsPage } from '../../../src/client/SettingsPage.tsx'
import { createStyleCatalog } from '../../../src/client/styles.ts'
import { templates } from './style-fixtures.ts'
import { en, zh, translate } from '../../../src/shared/locales.ts'
import '../../../src/client/index.css'

let savedTemplates = structuredClone(templates)
const w = window as any
w.__stylePosts = []
w.__styleError = ''
w.__holdStyleSave = false
w.__setTemplates = (next: typeof templates) => { savedTemplates = structuredClone(next); void styles.refresh() }
window.fetch = async (_url, options) => {
  if (options?.method !== 'POST') return new Response(JSON.stringify({ templates: savedTemplates }))
  const body = JSON.parse(options.body as string); w.__stylePosts.push(body)
  if (w.__styleError) return new Response(JSON.stringify({ error: { code: w.__styleError } }), { status: 400 })
  if (body.op === 'save') {
    if (w.__holdStyleSave) await new Promise(resolve => { w.__releaseStyleSave = resolve })
    if (w.__styleError) return new Response(JSON.stringify({ error: { code: w.__styleError } }), { status: 400 })
    const template = { ...body.template, id: `cs_import${String(savedTemplates.length).padStart(3, '0')}`,
      scope: 'global' as const, createdAt: 4, updatedAt: 4 }
    savedTemplates.push(template)
    return new Response(JSON.stringify({ template }), { status: 201 })
  }
  if (body.op === 'delete') {
    savedTemplates = savedTemplates.filter(t => t.id !== body.id)
    return new Response(JSON.stringify({ deleted: body.id }))
  }
  const current = savedTemplates.find(t => t.id === body.id)!
  const template = { ...current, ...body.patch, updatedAt: Math.max(3, current.updatedAt + 1) }
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
  const [language, setLanguage] = useState('en')
  w.__setLocale = setLanguage
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
  return <SettingsPage styles={styles} settingsForm={form as never} t={translate(language === 'zh' ? zh : en)} />
}

createRoot(document.getElementById('root')!).render(<Harness />)
