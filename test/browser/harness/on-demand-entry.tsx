/** Production plugin registration with structural DSH session, command and editor seats. */
import { createElement, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { apply } from '../../../src/client/index.tsx'
import { clientToken } from '../../../src/client/client-token.ts'
import { translate, en, zh } from '../../../src/shared/locales.ts'
import type { IntelligentUIModeView } from '../../../src/shared/intelligent-ui.ts'
import { templates } from './style-fixtures.ts'

const base: IntelligentUIModeView = {
  sessionEnable: 'on', sessionStyle: 'inherit', globalEnabled: true, globalStyle: 'auto', enabled: true, style: 'auto', pending: false, onDemand: null,
}
const seats = new Map<string, { definition: any; Component: any }>()
const binding = { ctx: {} }
const temporaryStyle = { schemaVersion: 1, baseLayout: 'card', directives: 'Use compact groups.', theme: templates[0].theme, suggestedName: 'Compact' }
const nodes = [{ root: { kind: 'tool-result', callId: 'recorded-result-1', name: 'render_ui', isError: false,
  call: { name: 'render_ui', argsRaw: JSON.stringify({ title: 'Recorded answer', program: 'root = Card([Text("Original content")])', style: 'card', temporaryStyle }) },
} }]
const toolSource = { getSnapshot: () => nodes }
const chat = { getSnapshot: () => ({ nodes: { turnDataSource: () => toolSource } }) }
const w = window as any
w.__calls = []
w.__submits = 0
w.__focuses = 0
w.__failure = ''
w.__delay = false
w.__token = clientToken()
let input = { draft: '', draftRev: 0, phase: 'plain', occurrences: [] }
let update: () => void = () => {}
let view = base
const project = (onDemand: any) => { view = { ...view, onDemand }; update() }
w.__project = project
w.__setView = (patch: any) => { view = { ...view, ...patch }; update() }
const editor = () => document.querySelector<HTMLElement>('[contenteditable]')!
const readEditor = () => {
  const draft = editor().textContent ?? ''
  if (input.draft !== draft) input = { ...input, draft, draftRev: input.draftRev + 1 }
  return input
}
w.__draft = (text: string) => { editor().textContent = text; readEditor(); update() }
const inputActions = {
  captureInsertion: () => ({ start: 0, end: readEditor().draft.length, draftRev: input.draftRev }),
  insertText: (text: string, span: any) => {
    const current = readEditor()
    if (span.draftRev !== current.draftRev || current.phase !== 'plain') return false
    editor().textContent = current.draft.slice(0, span.start) + text + current.draft.slice(span.end)
    readEditor(); update(); return true
  },
  setDraft: (text: string) => w.__draft(text),
  submit: () => { w.__submits++ },
}
let savedTemplates = structuredClone(templates)
w.__stylePosts = []
w.__styleError = ''
w.__styleDelay = false
window.fetch = async (_url, options) => {
  if (options?.method !== 'POST') return new Response(JSON.stringify({ templates: savedTemplates }))
  const body = JSON.parse(options.body as string)
  w.__stylePosts.push(body)
  if (w.__styleDelay) await new Promise<void>(resolve => { w.__styleSettle = resolve })
  if (w.__styleError) return new Response(JSON.stringify({ error: { code: w.__styleError } }), { status: 400 })
  let template
  if (body.op === 'saveFromResult') {
    template = { id: 'cs_saved001', name: body.name, description: body.description ?? '', scope: body.scope,
      ...body.scope === 'session' ? { sessionId: body.sessionId } : {}, baseLayout: temporaryStyle.baseLayout,
      directives: temporaryStyle.directives, theme: temporaryStyle.theme, createdAt: 2, updatedAt: 2 }
    savedTemplates = [...savedTemplates, template]
  } else if (body.op === 'update') {
    template = { ...savedTemplates.find(t => t.id === body.id)!, ...body.patch, updatedAt: 3 }
    savedTemplates = savedTemplates.map(t => t.id === body.id ? template : t)
  } else if (body.op === 'delete') {
    savedTemplates = savedTemplates.filter(t => t.id !== body.id)
    return new Response(JSON.stringify({ deleted: body.id }))
  }
  return new Response(JSON.stringify({ template }))
}
apply({
  locale: { register: () => () => {} },
  effect: (fn: () => void) => fn(),
  sessions: { binding: () => binding },
  uiConversation: { binding: () => ({ target: () => chat }) },
  conversation: { input: { for: (ctx: object) => {
    if (ctx !== binding.ctx) throw Error('Wrong session scope')
    return { state: { getSnapshot: readEditor }, focus: () => { w.__focuses++; editor().focus() } }
  } } },
  remote: { commands: { execute: async (sessionId: string, command: string, attachments: unknown[]) => {
    w.__calls.push({ sessionId, command, attachments })
    if (w.__delay) await new Promise<void>(resolve => { w.__settle = resolve })
    if (w.__failure) return { ok: true, value: { commandId: 'fixture', result: { kind: 'error', text: w.__failure } } }
    return { ok: true, value: { commandId: 'fixture', result: { kind: 'success' } } }
  } } },
  slots: { inject: (_name: string, fn: () => void) => fn(), register: (definition: any, Component: any) => { seats.set(definition.name, { definition, Component }) } },
  inject: () => {},
} as never)

function Seat({ name, ...props }: { name: string; [key: string]: any }): ReactElement {
  const { definition, Component } = seats.get(name)!
  const injected = definition.inject('e2e-session')
  const t = translate(w.__lang === 'zh' ? zh : en)
  return createElement(Component, {
    ...props, ...injected, t,
    useProjection: () => view,
    useInput: (selector: (state: typeof input) => unknown) => selector(input),
    inputActions,
    ...injected.keyedHooks ? { usePrograms: () => injected.keyedHooks.programs('1').getSnapshot() } : {},
  })
}
function Harness(): ReactElement {
  const [, refresh] = useState(0)
  update = () => refresh(value => value + 1)
  w.__language = (lang: string) => { w.__lang = lang; update() }
  return <>
    <main><Seat name="conversation.chat.turnTail" turn={{ turn: 1 }} /></main>
    <div data-composer-card>
      <div data-composer-overlay><Seat name="conversation.input.overlay" /></div>
      <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Message" onInput={() => { readEditor(); update() }} />
      <div className="toolbar"><Seat name="conversation.input.activity" locked={false} /></div>
    </div>
  </>
}
createRoot(document.getElementById('root')!).render(createElement(Harness))
