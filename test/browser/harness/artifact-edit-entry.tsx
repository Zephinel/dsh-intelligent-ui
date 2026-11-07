/**
 * Production plugin wiring for the Artifact block-editing browser check.
 *
 * The real client plugin registers the turn-tail card, the composer reference
 * source and the sent-message summary node; this harness supplies structural
 * DSH seats: one recorded `render_ui` program (the 夏令时与夏令时 sample), a
 * composer input machine with reference chips, an authenticated-looking fetch
 * stub, and a switch to append an edited revision with Host-provided meta.
 */
import { createElement, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { apply } from '../../../src/client/index.tsx'
import { clientToken } from '../../../src/client/client-token.ts'
import { translate, en, zh } from '../../../src/shared/locales.ts'
import type { IntelligentUIModeView } from '../../../src/shared/intelligent-ui.ts'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DST_PROGRAM, DST_TITLE } from '../fixtures/dst-artifact.ts'
import { NESTED_PROGRAM, NESTED_TITLE } from '../fixtures/nested-artifact.ts'
import { NESTED_CONTAINERS_PROGRAM, NESTED_CONTAINERS_TITLE } from '../fixtures/nested-containers.ts'
import { LARGE_PAGE_PROGRAM, LARGE_PAGE_TITLE, NESTED_PROPS_PROGRAM, NESTED_PROPS_TITLE, PROPS_CENTER_PROGRAM, PROPS_CENTER_TITLE, PROPS_DYNAMIC_PROGRAM, PROPS_DYNAMIC_TITLE, PROPS_PROGRAM, PROPS_TITLE } from '../fixtures/props-artifact.ts'
import { templates } from './style-fixtures.ts'
import { submittedDraftsFor } from '../../../src/client/artifact-edit/store.ts'

const SESSION = 'e2e-session'
const base = {
  sessionEnable: 'on', sessionStyle: 'inherit', globalEnabled: true, globalStyle: 'auto', enabled: true, style: 'auto', pending: false, onDemand: null,
} satisfies IntelligentUIModeView
const seats = new Map<string, { definition: any; Component: any }>()
const listSeats = new Map<string, Array<{ definition: any; Component: any }>>()
const w = window as any

/** One recorded render_ui call for the sample artifact. */
function cardNode(callId: string, program: string, meta?: unknown, title: string = DST_TITLE) {
  return {
    root: {
      kind: 'tool-result', callId, name: 'render_ui', isError: false,
      ...meta === undefined ? {} : { meta },
      call: { name: 'render_ui', argsRaw: JSON.stringify({ program, title, style: 'card' }) },
    },
  }
}

let nodes = [cardNode('dst-call-1', DST_PROGRAM)]
let update: () => void = () => {}
let turnState: { turn: number; status: 'open' | 'closed'; start?: { time: number }; end?: { seq: number; time: number } } = { turn: 1, status: 'open' }
const toolSource = {
  subscribe: () => () => {},
  getSnapshot: () => nodes,
}
const chat = { getSnapshot: () => ({ nodes: { turnDataSource: () => toolSource } }) }
const binding = { ctx: {} }

interface Occurrence {
  occurrenceId: number
  source: string
  ref: string
  offset: number
  length: number
  label: string
  clipboardText: string
}

let occurrenceSeq = 0
let input: InputState = { draft: '', attachmentIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [] } as unknown as InputState

/** Detect-coordinate start of one chip (each chip occupies one character). */
function chipDetectStart(state: InputState, occurrence: Occurrence): number {
  let extra = 0
  for (const other of state.occurrences) {
    if (other.offset >= occurrence.offset) break
    extra += other.length - 1
  }
  return occurrence.offset - extra
}

/** Convert a collapsed detect position to a clipboard offset. */
function detectToClipboard(state: InputState, position: number): number {
  let extra = 0
  for (const occurrence of state.occurrences) {
    if (chipDetectStart(state, occurrence) < position) extra += occurrence.length - 1
  }
  return position + extra
}

/** Publish a new input snapshot. */
function setInput(next: InputState) {
  input = next
  update()
}

/** Replace the draft with plain text. */
function setDraft(text: string) {
  setInput({ ...input, draft: text, occurrences: [], draftRev: input.draftRev + 1 } as InputState)
}

/** Insert one chip at a collapsed detect span, or replace the chip the span covers. */
function insertReference(reference: { source: string; ref: string; label: string; clipboardText: string }, span: { start: number; end: number; draftRev: number }): boolean {
  if (span.draftRev !== input.draftRev || input.phase !== 'plain') return false
  const occurrences = [...(input.occurrences as unknown as Occurrence[])]
  if (span.end > span.start) {
    const covered = occurrences.find(occurrence => chipDetectStart(input, occurrence) === span.start)
    if (covered === undefined) return false
    const start = covered.offset
    const end = covered.offset + covered.length
    const next = { occurrenceId: ++occurrenceSeq, ...reference, offset: start, length: reference.clipboardText.length }
    const remaining = occurrences.filter(occurrence => occurrence !== covered).map(occurrence => occurrence.offset >= end ? { ...occurrence, offset: occurrence.offset + reference.clipboardText.length - covered.length } : occurrence)
    setInput({
      ...input,
      draft: `${input.draft.slice(0, start)}${reference.clipboardText}${input.draft.slice(end)}`,
      occurrences: [...remaining, next].sort((a, b) => a.offset - b.offset),
      draftRev: input.draftRev + 1,
    } as InputState)
    return true
  }
  const clip = detectToClipboard(input, span.start)
  const tail = input.draft.slice(clip, clip + 1)
  const text = tail === ' ' || tail === '' ? reference.clipboardText : `${reference.clipboardText} `
  const next = { occurrenceId: ++occurrenceSeq, ...reference, offset: clip, length: reference.clipboardText.length }
  const shifted = occurrences.map(occurrence => occurrence.offset >= clip ? { ...occurrence, offset: occurrence.offset + text.length } : occurrence)
  setInput({
    ...input,
    draft: `${input.draft.slice(0, clip)}${text}${input.draft.slice(clip)}`,
    occurrences: [...shifted, next].sort((a, b) => a.offset - b.offset),
    draftRev: input.draftRev + 1,
  } as InputState)
  return true
}

/** Replace a detect span with plain text (used by chip removal). */
function insertText(text: string, span: { start: number; end: number; draftRev: number }): boolean {
  if (span.draftRev !== input.draftRev || input.phase !== 'plain') return false
  const occurrences = [...(input.occurrences as unknown as Occurrence[])]
  const covered = occurrences.find(occurrence => chipDetectStart(input, occurrence) === span.start)
  if (covered === undefined) return false
  const start = covered.offset
  const end = covered.offset + covered.length
  const shifted = occurrences.filter(occurrence => occurrence !== covered).map(occurrence => occurrence.offset >= end ? { ...occurrence, offset: occurrence.offset + text.length - covered.length } : occurrence)
  setInput({
    ...input,
    draft: `${input.draft.slice(0, start)}${text}${input.draft.slice(end)}`,
    occurrences: shifted,
    draftRev: input.draftRev + 1,
  } as InputState)
  return true
}

const inputMachine = {
  state: { getSnapshot: () => input, subscribe: () => () => {} },
  insertReference,
  insertText,
  setDraft,
  addAttachments: () => false,
  removeAttachment: () => false,
  pruneAttachments: () => {},
  submit: () => { w.__submits = (w.__submits ?? 0) + 1 },
  notify: (_level: string, text: string) => { w.__notice = text },
  focus: () => {},
  beginCommand: () => false,
}
const inputActions = {
  captureInsertion: () => ({ start: 0, end: 0, draftRev: input.draftRev }),
  insertText: (text: string, span: { start: number; end: number; draftRev: number }) => insertText(text, span),
  setDraft,
  persistDraft: () => {},
  addAttachments: () => false,
  removeAttachment: () => {},
  pruneAttachments: () => {},
  submit: () => { w.__submits = (w.__submits ?? 0) + 1 },
}
let view: IntelligentUIModeView = base
w.__project = (patch: Partial<IntelligentUIModeView>) => { view = { ...view, ...patch }; update() }
w.__lang = 'zh'
w.__language = (lang: string) => { w.__lang = lang; update() }
w.__token = clientToken()
w.__renderKey = 0
w.__remount = () => {
  w.__renderKey += 1
  update()
}
w.__closeTurn = () => {
  turnState = { ...turnState, status: 'closed', end: { seq: 900 + turnState.turn, time: Date.now() } }
  update()
}
w.__nextTurn = () => {
  turnState = { turn: turnState.turn + 1, status: 'open', start: { time: Date.now() } }
  update()
}
w.__conflict = false
w.__latestMap = {}
w.__restoreRevision = 4
w.__input = () => ({ draft: input.draft, occurrences: input.occurrences, draftRev: input.draftRev, phase: input.phase })
w.__setDraft = (text: string) => setDraft(text)
w.__appendDraft = (text: string) => setInput({ ...input, draft: input.draft + text, draftRev: input.draftRev + 1 } as InputState)
w.__chipSource = undefined
w.__sentText = ''
w.__sent = false
w.__serializeChip = async () => {
  const occurrence = (input.occurrences as unknown as Occurrence[]).find(item => item.source === 'artifact-edit')
  if (occurrence === undefined || w.__chipSource === undefined) throw new Error('no edit chip in draft')
  const text = await w.__chipSource.codec.serialize(occurrence.ref, new AbortController().signal)
  // Mirror the composer submit path: the chip is replaced by its model text in place.
  const start = input.draft.indexOf(occurrence.clipboardText)
  w.__sentText = start < 0
    ? `${input.draft}${text}`
    : `${input.draft.slice(0, start)}${text}${input.draft.slice(start + occurrence.clipboardText.length)}`
  w.__sent = true
  setDraft('')
  return text
}
w.__openChip = () => {
  const occurrence = (input.occurrences as unknown as Occurrence[]).find(item => item.source === 'artifact-edit')
  if (occurrence === undefined) return false
  return w.__chipSource.openReference({ sessionId: SESSION }, { ref: occurrence.ref })
}
function pendingRequestId(artifactId: string): string | undefined {
  return submittedDraftsFor(SESSION).find(entry => entry.artifactId === artifactId)?.requestId
}
w.__addNestedCard = (callId: string = 'nested-call-1', title: string = NESTED_TITLE) => {
  nodes = [...nodes, {
    root: {
      kind: 'tool-result', callId, name: 'render_ui', isError: false,
      call: { name: 'render_ui', argsRaw: JSON.stringify({ program: NESTED_PROGRAM, title, style: 'card' }) },
    },
  }]
  update()
}
w.__addNestedContainersCard = (callId: string = 'nested-containers-call-1', title: string = NESTED_CONTAINERS_TITLE) => {
  nodes = [...nodes, {
    root: {
      kind: 'tool-result', callId, name: 'render_ui', isError: false,
      call: { name: 'render_ui', argsRaw: JSON.stringify({ program: NESTED_CONTAINERS_PROGRAM, title, style: 'card' }) },
    },
  }]
  update()
}
w.__resetCards = () => { nodes = []; update() }
w.__addPropsCard = (callId: string = 'props-call-1', title: string = PROPS_TITLE) => {
  nodes = [...nodes, {
    root: {
      kind: 'tool-result', callId, name: 'render_ui', isError: false,
      call: { name: 'render_ui', argsRaw: JSON.stringify({ program: PROPS_PROGRAM, title, style: 'card' }) },
    },
  }]
  update()
}
w.__addPropsCenterCard = (callId: string = 'props-center-call-1', title: string = PROPS_CENTER_TITLE) => {
  nodes = [...nodes, {
    root: {
      kind: 'tool-result', callId, name: 'render_ui', isError: false,
      call: { name: 'render_ui', argsRaw: JSON.stringify({ program: PROPS_CENTER_PROGRAM, title, style: 'card' }) },
    },
  }]
  update()
}
w.__addNestedPropsCard = (callId: string = 'nested-props-call-1', title: string = NESTED_PROPS_TITLE) => {
  nodes = [...nodes, {
    root: {
      kind: 'tool-result', callId, name: 'render_ui', isError: false,
      call: { name: 'render_ui', argsRaw: JSON.stringify({ program: NESTED_PROPS_PROGRAM, title, style: 'card' }) },
    },
  }]
  update()
}
w.__addPropsDynamicCard = (callId: string = 'props-dynamic-call-1', title: string = PROPS_DYNAMIC_TITLE) => {
  nodes = [...nodes, {
    root: {
      kind: 'tool-result', callId, name: 'render_ui', isError: false,
      call: { name: 'render_ui', argsRaw: JSON.stringify({ program: PROPS_DYNAMIC_PROGRAM, title, style: 'card' }) },
    },
  }]
  update()
}
w.__addLargePageCard = (callId: string = 'large-page-call-1', title: string = LARGE_PAGE_TITLE) => {
  nodes = [...nodes, {
    root: {
      kind: 'tool-result', callId, name: 'render_ui', isError: false,
      call: { name: 'render_ui', argsRaw: JSON.stringify({ program: LARGE_PAGE_PROGRAM, title, style: 'card' }) },
    },
  }]
  update()
}
w.__addTempCard = (callId: string = 'temp-call-1', title: string = '临时卡片') => {
  nodes = [...nodes, {
    root: {
      kind: 'tool-result', callId, name: 'render_ui', isError: false,
      call: { name: 'render_ui', argsRaw: JSON.stringify({
        program: DST_PROGRAM,
        title,
        style: 'card',
        temporaryStyle: { schemaVersion: 1, baseLayout: 'card', directives: 'keep the card compact and calm' },
      }) },
    },
  }]
  update()
}
w.__applyRevision = (program: string, meta: Record<string, unknown> = {}) => {
  const merged = { artifactId: 'dst-call-1', revisionId: 'dst-call-2', baseRevisionId: 'dst-call-1', revision: 2, editedBlockIds: ['b3', 'b5'], ...meta }
  const requestId = merged.requestId ?? pendingRequestId(String(merged.artifactId))
  nodes = [...nodes, cardNode('dst-call-2', program, { ...merged, ...requestId === undefined ? {} : { requestId } })]
  update()
}
// Multi-card E2E: append another settled artifact card from the same fixture.
w.__addCard = (callId: string, title: string = '第二张卡片', program: string = DST_PROGRAM) => {
  w.__lastAdd = callId
  nodes = [...nodes, cardNode(callId, program, undefined, title)]
  update()
}
w.__nodeCount = () => nodes.length
// Serialize every attached edit chip in draft order, as one composed message.
w.__serializeChipMatching = async (needle: string) => {
  const occurrence = (input.occurrences as unknown as Occurrence[]).find(item => item.source === 'artifact-edit' && item.label.includes(needle))
  if (occurrence === undefined || w.__chipSource === undefined) throw new Error('no matching edit chip in draft')
  return w.__chipSource.codec.serialize(occurrence.ref, new AbortController().signal)
}
w.__serializeChips = async () => {
  const occurrences = (input.occurrences as unknown as Occurrence[]).filter(item => item.source === 'artifact-edit')
  if (occurrences.length === 0 || w.__chipSource === undefined) throw new Error('no edit chip in draft')
  const texts: string[] = []
  for (const occurrence of occurrences) {
    texts.push(await w.__chipSource.codec.serialize(occurrence.ref, new AbortController().signal))
  }
  let cursor = 0
  let composed = ''
  occurrences.forEach((occurrence, index) => {
    const at = input.draft.indexOf(occurrence.clipboardText, cursor)
    composed += input.draft.slice(cursor, at) + texts[index]
    cursor = at + occurrence.clipboardText.length
  })
  composed += input.draft.slice(cursor)
  w.__sentText = composed
  w.__sent = true
  setDraft('')
  return { texts, composed }
}
// User gesture: delete one chip from the draft (keep the draft after the check).
w.__deleteChip = (ref: string) => {
  const occurrence = (input.occurrences as unknown as Occurrence[]).find(item => item.source === 'artifact-edit' && item.ref === ref)
  if (occurrence === undefined) return false
  const start = chipDetectStart(input, occurrence)
  return insertText('', { start, end: start + 1, draftRev: input.draftRev })
}
// Phase-1 block-level edit result: the tool call only returns the changed block
// program; the Host projects the full revision through result meta.
w.__applyBlockEditRevision = (meta: Record<string, unknown>, callId: string = 'dst-call-2') => {
  const merged = { artifactId: 'dst-call-1', revisionId: 'dst-call-2', baseRevisionId: 'dst-call-1', revision: 2, editedBlockIds: ['b3'], title: DST_TITLE, style: 'card', ...meta }
  const requestId = merged.requestId ?? pendingRequestId(String(merged.artifactId))
  nodes = [...nodes, {
    root: {
      kind: 'tool-result', callId, name: 'edit_ui_blocks', isError: false,
      meta: {
        ...merged,
        ...requestId === undefined ? {} : { requestId },
      },
      call: { name: 'edit_ui_blocks', argsRaw: JSON.stringify({ program: 'root = Col([Title("edited block")])' }) },
    },
  }]
  update()
}

window.fetch = async (url: string | URL, options?: RequestInit) => {
  const text = String(url)
  if (text.includes('/api/intelligent-ui/artifact-revisions')) {
    const query = new URL(text, 'http://localhost').searchParams
    const artifactId = query.get('artifactId') ?? 'dst-call-1'
    const revisionId = query.get('revisionId') ?? 'dst-call-1'
    const mapped = w.__latestMap[artifactId]
    const latestRevisionId = mapped?.revisionId ?? (w.__conflict ? 'dst-call-9' : revisionId)
    const latestRevision = mapped?.revision ?? (w.__conflict ? 3 : 1)
    return new Response(JSON.stringify({
      artifactId,
      revisionId,
      revision: revisionId === latestRevisionId ? latestRevision : 1,
      latestRevisionId,
      latestRevision,
      conflict: latestRevisionId !== revisionId,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (text.includes('/api/intelligent-ui/artifact-history/program')) {
    const query = new URL(text, 'http://localhost').searchParams
    const artifactId = query.get('artifactId') ?? 'dst-call-1'
    const revisionId = query.get('revisionId') ?? 'dst-call-1'
    return new Response(JSON.stringify({ ok: true, artifactId, revisionId, revision: revisionId === 'dst-call-1' ? 1 : 2, program: DST_PROGRAM }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (text.includes('/api/intelligent-ui/artifact-history')) {
    const artifactId = new URL(text, 'http://localhost').searchParams.get('artifactId') ?? 'dst-call-1'
    return new Response(JSON.stringify({
      ok: true,
      artifactId,
      latestRevision: 3,
      revisions: [
        { revisionId: 'restore_local1', revision: 3, baseRevisionId: 'dst-call-2', title: '夏令时与冬令时', style: 'card', createdAt: 1762400000000, current: true, source: 'restore', hasProgram: false, restorable: false },
        { revisionId: 'dst-call-2', revision: 2, baseRevisionId: 'dst-call-1', title: '夏令时与冬令时', style: 'card', styleId: 'cs_e2e123', createdAt: 1762300000000, current: false, source: 'edit', hasProgram: true, restorable: true, editedBlockIds: ['b1'] },
        { revisionId: 'dst-call-1', revision: 1, title: '夏令时与冬令时', style: 'card', createdAt: 1762200000000, current: false, source: 'initial', hasProgram: true, restorable: true },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (text.includes('/api/intelligent-ui/artifact-restore') && options?.method === 'POST') {
    const body = JSON.parse(String(options.body))
    const revision = w.__restoreRevision
    const revisionId = 'restore_local1'
    w.__latestMap[body.artifactId] = { revisionId, revision }
    return new Response(JSON.stringify({
      ok: true,
      revision: {
        artifactId: body.artifactId,
        revisionId,
        baseRevisionId: body.sourceRevisionId,
        revision,
        program: body.program,
        title: '夏令时与冬令时',
        style: 'card',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (options?.method !== 'POST') return new Response(JSON.stringify({ templates }))
  return new Response(JSON.stringify({ template: templates[0] }))
}

apply({
  locale: { register: () => () => {}, bind: () => translate(w.__lang === 'zh' ? zh : en) },
  effect: (fn: () => unknown) => fn(),
  sessions: { binding: () => binding },
  uiConversation: {
    binding: () => ({ target: () => chat }),
    userText: { register: (rule: unknown) => { w.__summaryRule = rule; return () => {} } },
  },
  conversation: { input: { for: (ctx: object) => { if (ctx !== binding.ctx) throw Error('Wrong session scope'); return inputMachine } } },
  remote: { commands: { execute: async () => ({ ok: true, value: { commandId: 'fixture', result: { kind: 'success' } } }) } },
  slots: {
    inject: (_name: string, fn: () => void) => fn(),
    register: (definition: any, Component: any) => {
      const key = definition.key === undefined ? definition.name : `${definition.name}:${definition.key}`
      const entry = { definition, Component }
      seats.set(key, entry)
      const listKey = definition.id === undefined ? String(definition.name) : `${definition.name}:${definition.id}`
      const list = listSeats.get(listKey) ?? []
      list.push(entry)
      listSeats.set(listKey, list)
    },
  },
  inject: (deps: string[], callback: (scope: unknown) => void) => {
    if (deps.includes('inputTriggers')) {
      callback({ inputTriggers: { registerSource: (source: unknown) => { w.__chipSource = source; return () => {} } } })
    }
  },
} as never)

/** Render every registered seat for one list slot (e.g. the composer overlay). */
function SeatList({ name }: { name: string }): ReactElement {
  const entries = [...listSeats.values()].flat().filter(entry => entry.definition.name === name)
  const t = translate(w.__lang === 'zh' ? zh : en)
  return <>
    {entries.map(({ definition, Component }, index) => {
      const injected = definition.inject?.(SESSION) ?? {}
      return createElement(Component, {
        key: `${String(definition.id ?? 'seat')}:${index}`,
        ...injected, t,
        useProjection: () => view,
        useInput: () => input,
        inputActions,
        ...injected.keyedHooks ? { usePrograms: () => injected.keyedHooks.programs('1').getSnapshot() } : {},
      })
    })}
  </>
}

/** Render the turn-tail card seat with its real injected face. */
function Seat({ name, ...props }: { name: string; [key: string]: any }): ReactElement {
  const { definition, Component } = seats.get(name)!
  const injected = definition.inject(SESSION)
  const t = translate(w.__lang === 'zh' ? zh : en)
  return createElement(Component, {
    ...props, ...injected, t,
    useProjection: () => view,
    useInput: () => input,
    inputActions,
    ...injected.keyedHooks ? { usePrograms: () => injected.keyedHooks.programs('1').getSnapshot() } : {},
  })
}

/** Render the sent-message summary the same way the chat transcript would. */
function SentSummary(): ReactElement | null {
  if (!w.__sent || w.__summaryRule === undefined) return null
  const seat = seats.get('conversation.user.text.node:artifact-edit-summary')
  if (seat === undefined) return null
  const rendered: ReactElement[] = []
  let cursor = 0
  while (cursor < w.__sentText.length) {
    const node = w.__summaryRule.match(w.__sentText, cursor, { read: () => undefined })
    if (node === undefined || node.start < cursor) break
    rendered.push(createElement(seat.Component, {
      key: `${node.start}-${node.end}`, node, raw: w.__sentText, interactive: false, t: translate(w.__lang === 'zh' ? zh : en),
    }))
    cursor = Math.max(node.end, cursor + 1)
  }
  return rendered.length === 0 ? null : <>{rendered}</>
}

/** Harness shell: the card list, a compact composer preview and the sent summary. */
function Harness(): ReactElement {
  const [, refresh] = useState(0)
  update = () => refresh(value => value + 1)
  return <>
    <main key={w.__renderKey}><Seat name="conversation.chat.turnTail" turn={turnState} /></main>
    <div data-composer-card>
      <div data-composer-overlay><SeatList name="conversation.input.overlay" /></div>
      <div data-composer-draft>{input.draft}</div>
      <div data-composer-chips>
        {(input.occurrences as unknown as Occurrence[]).map(occurrence => (
          <span key={occurrence.occurrenceId} data-chip={occurrence.source} data-chip-label={occurrence.label}>{occurrence.label}</span>
        ))}
      </div>
      <div data-sent-summary><SentSummary /></div>
    </div>
  </>
}
createRoot(document.getElementById('root')!).render(createElement(Harness))
