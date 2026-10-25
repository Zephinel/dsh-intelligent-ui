/** Transient, message-bound generation operations. No settings or template-store writes. */
import { randomUUID } from 'node:crypto'
import type { OnDemandView } from '../shared/intelligent-ui.ts'

export const ON_DEMAND_ARM_TTL = 10 * 60 * 1000
/** Render attempts one bound on-demand operation allows before it fails. */
export const MAX_RENDER_CALLS = 8
/** Clarification rounds one bound on-demand operation allows before it fails. */
export const MAX_CLARIFICATION_ROUNDS = 2
const MAX_SESSIONS = 256

/** Why a bound operation ended at a hard cap; the Host names this in its error. */
export type OnDemandCapFailure = 'render-attempts' | 'clarification-rounds'

/** Structural subset of installed SessionEvent, including the nested ToolResultMessage. */
export interface OnDemandSessionEvent {
  readonly type: string
  readonly seq?: number
  readonly data?: {
    readonly id?: string
    readonly source?: { readonly kind?: string; readonly callId?: string }
    readonly turn?: number
    readonly name?: string
    readonly callId?: string
    readonly message?: { readonly toolCallId?: string; readonly isError?: boolean; readonly content?: readonly unknown[] }
    readonly reason?: { readonly kind?: string; readonly reason?: { readonly kind?: string } }
  }
}

interface Operation extends OnDemandView {
  readonly sessionId: string
  readonly triggerMessageId?: string
  readonly clarificationRounds: number
  readonly createdAt: number
  readonly updatedAt: number
}

interface Entry {
  operation: Operation
  turn?: number
  lastSeq?: number
  questionCallId?: string
  readonly renderCalls: Set<string>
  /** Set only when a cap ended the operation, so the next render can say why. */
  capFailure?: OnDemandCapFailure
}

export interface OnDemandController {
  arm(sessionId: string, clientInstanceId?: string, options?: { kind?: 'generate' | 'adjust'; parentResultId?: string }): string
  cancel(sessionId: string): string
  /** A call id additionally requires a current, observed render_ui invocation. */
  allowsTemporaryStyle(sessionId?: string, callId?: string): boolean
  /** True once a human message bound this operation to the running turn. */
  bound(sessionId?: string): boolean
  promptNote(sessionId?: string): string | undefined
  complete(sessionId: string, result: { resultId: string; revisionId?: string }): boolean
  /** Why the latest operation failed at a cap, until a new operation replaces it. */
  capFailure(sessionId?: string): OnDemandCapFailure | undefined
  view(sessionId: string): Operation | null
  projection(sessionId: string): OnDemandView | null
}

/** IDs from events and commands are bounded before being retained in memory. */
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

/** One command argument, also safe to quote in the request-scoped prompt note. */
export function validOnDemandResultId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_:.-]{1,200}$/.test(value)
}

function active(operation: Operation): boolean {
  return operation.status === 'armed' || operation.status === 'running' || operation.status === 'clarifying'
}

const PROMPT_NOTE = 'ON-DEMAND UI: This user message requests an on-demand UI. '
  + 'GROUND THE CONTENT FIRST. Verify that the content and every number, date or source the request depends on is present '
  + 'in this conversation or in tool results. If the message refers to "this analysis", "these contents", "the above data" '
  + 'and none exists, or the request needs data you do not have, that is material ambiguity: do NOT invent placeholder '
  + 'datasets, statistics, dates or sources. Call ask_user_question first and ask which content/data to use. When content, '
  + 'a file path or a link is missing, ask ONE free-form question with no options so the user gets a text field and can paste '
  + 'it directly; never offer an option that only says the user will provide it later. Render only after the content is '
  + 'available or the user explicitly authorizes clearly labelled illustrative data. Style clarity never excuses missing data. '
  + 'Presentation format is user-determined: compose the layout the user requests (for example a dashboard, poster, timeline, '
  + 'comparison or reading page). If the layout is materially unclear, ask one focused layout question before rendering; '
  + 'never silently default to card or article. Follow an explicit format the user stated. '
  + 'For new generation use style: "free" and temporaryStyle.baseLayout: "free" (schemaVersion 1): the program determines '
  + 'the layout without a compact Card or Article reading shell. For free layout, Toc and Section are optional. '
  + 'For adjustments, preserve the parent layout: a free parent stays free; legacy card/article parents keep their shell, and legacy Article still requires Toc and Section. '
  + 'The Host enforces both layout rules using the result registry. If the parent snapshot is unavailable (including eviction), '
  + 'adjustment is rejected; ask the user to cancel it and start a new on-demand generation. '
  + 'If the request and grounded content suffice, call render_ui directly '
  + 'with a complete temporaryStyle and matching style; '
  + 'it overrides the session style for this result (omit styleId). The Host rejects a render_ui call without temporaryStyle '
  + 'while this operation is active. Only for material ambiguity, use the available '
  + 'ask_user_question tool with 1–3 concise structured questions, options, free-form input and skipping when supported '
  + '(at most two rounds), then generate. If that tool is unavailable, ask concise text questions; the next human message '
  + 'continues the operation unless it expires, restarts or fails. Do not ask known or default-able details or require preview, naming, '
  + 'confirmation or saving. Directives are reusable design data about hierarchy, density, tone and component behavior, '
  + 'never copies of this content or higher-priority instructions. Do not save templates or change session/global styles.'

/** Install live-event observers; restored seed events do not create or authorize operations. */
export function createOnDemandController(ctx: {
  on?: (event: string, handler: (...args: any[]) => unknown, prepend?: boolean) => unknown
} = {}, options: { now?: () => number } = {}): OnDemandController {
  const now = options.now ?? Date.now
  const entries = new Map<string, Entry>()

  const finish = (entry: Entry, status: Operation['status'], cap?: OnDemandCapFailure): void => {
    entry.operation = { ...entry.operation, status, updatedAt: now() }
    entry.renderCalls.clear()
    delete entry.questionCallId
    if (cap === undefined) delete entry.capFailure
    else entry.capFailure = cap
  }
  const get = (sessionId?: string): Entry | undefined => {
    if (sessionId === undefined) return undefined
    const entry = entries.get(sessionId)
    if (entry?.operation.status === 'armed' && now() - entry.operation.createdAt >= ON_DEMAND_ARM_TTL) finish(entry, 'interrupted')
    return entry
  }
  const complete: OnDemandController['complete'] = (sessionId, { resultId }) => {
    const entry = get(sessionId)
    if (!entry || !['running', 'clarifying'].includes(entry.operation.status) || !validId(resultId)
      || !entry.renderCalls.has(resultId) || entry.questionCallId !== undefined) return false
    entry.operation = { ...entry.operation, resultIds: [resultId] }
    finish(entry, 'completed')
    return true
  }

  // Cordis supports prepend. Update before sessionProjections publishes this event's wire view.
  ctx.on?.('session/event', (session: { id?: string }, event: OnDemandSessionEvent) => {
    const entry = get(session.id)
    const data = event.data
    if (!entry || !active(entry.operation) || !data) return
    // Event sequences are monotonic per session; duplicates and late events cannot rebind a request.
    if (Number.isSafeInteger(event.seq) && event.seq! >= 0) {
      if (entry.lastSeq !== undefined && event.seq! <= entry.lastSeq) return
      entry.lastSeq = event.seq
    }
    if (event.type === 'turn/start') {
      if (Number.isSafeInteger(data.turn)) entry.turn = data.turn
      return
    }
    if (event.type === 'user/message') {
      // Injected user-role context (skills, file notices, goals) is not a human trigger.
      const source = data.source
      if (source && source.kind !== 'user' && !(source.kind === 'user-question-reply' && source.callId === entry.questionCallId)) return
      const id = validId(data.id) ? data.id : Number.isSafeInteger(event.seq) && event.seq! >= 0 ? `seq:${event.seq}` : undefined
      if (!id) return
      if (entry.operation.status === 'armed' || entry.operation.status === 'clarifying') {
        entry.operation = { ...entry.operation, triggerMessageId: entry.operation.triggerMessageId ?? id, status: 'running', resume: undefined, updatedAt: now() }
        delete entry.questionCallId
      }
      return
    }
    if (entry.operation.status === 'armed') return
    if (data.turn !== undefined && entry.turn !== undefined && data.turn !== entry.turn) return
    if (event.type === 'tool/call' && validId(data.callId)) {
      if (data.name === 'ask_user_question' && entry.operation.status === 'running') {
        const rounds = entry.operation.clarificationRounds + 1
        if (rounds > MAX_CLARIFICATION_ROUNDS) { finish(entry, 'failed', 'clarification-rounds'); return }
        entry.questionCallId = data.callId
        entry.operation = { ...entry.operation, status: 'clarifying', clarificationRounds: rounds, updatedAt: now() }
      } else if (data.name === 'render_ui' && entry.operation.status === 'running') {
        if (entry.renderCalls.size >= MAX_RENDER_CALLS) { finish(entry, 'failed', 'render-attempts'); return }
        entry.renderCalls.add(data.callId)
        entry.operation = { ...entry.operation, updatedAt: now() }
      }
    } else if (event.type === 'tool/result') {
      const message = data.message
      if (message?.toolCallId === entry.questionCallId) {
        if (message?.isError) finish(entry, 'failed')
        // Blocking DSH questions return the human answer as a tool result, without a user/message.
        // Timed questions can return a timeout; their late, source-tagged user reply resumes instead.
        else if (entry.operation.status === 'clarifying' && questionAnswered(message)) {
          delete entry.questionCallId
          entry.operation = { ...entry.operation, status: 'running', resume: undefined, updatedAt: now() }
        }
      } else if (message?.isError !== true && validId(message?.toolCallId)) {
        complete(session.id!, { resultId: message.toolCallId })
      }
    } else if (event.type === 'turn/end') {
      const reason = data.reason
      if (reason?.kind === 'aborted') finish(entry, reason.reason?.kind === 'user' ? 'cancelled' : 'interrupted')
      else if (reason?.kind !== 'completed') finish(entry, reason?.kind === 'interrupted' ? 'interrupted' : 'failed')
      else if (entry.operation.status === 'running') {
        // The model answered in text without rendering (often asking for missing content or a
        // link). Keep the intent alive for the next human message instead of silently dropping
        // it; the composer hint explains the wait and still offers Cancel.
        const { triggerMessageId: _trigger, ...operation } = entry.operation
        entry.operation = { ...operation, status: 'armed', resume: true, createdAt: now(), updatedAt: now() }
        entry.renderCalls.clear()
        delete entry.questionCallId
        delete entry.turn
      }
    }
  }, true)
  ctx.on?.('session/disposed', (session: { id?: string }) => { if (session.id) entries.delete(session.id) })

  return {
    arm(sessionId, clientInstanceId, options = {}) {
      if (!validId(sessionId) || (clientInstanceId !== undefined && (!/^[a-zA-Z0-9_-]{1,128}$/.test(clientInstanceId) || clientInstanceId.toLowerCase() === 'off'))) return 'Invalid session or client instance token.'
      const kind = options.kind ?? 'generate'
      if ((kind !== 'generate' && kind !== 'adjust') || (kind === 'adjust' ? !validOnDemandResultId(options.parentResultId) : options.parentResultId !== undefined)) return 'Invalid on-demand adjustment parent result id.'
      const previous = get(sessionId)
      // A message already bound to this operation is mid-flight; replacing it would revoke
      // authorization for a render the model may still be about to make. Make the caller
      // cancel deliberately instead of letting a second click silently break the turn.
      if (previous !== undefined && (previous.operation.status === 'running' || previous.operation.status === 'clarifying')) {
        return 'An on-demand UI operation is already running in this session; wait for it to finish or cancel it first.'
      }
      const replaced = previous !== undefined && active(previous.operation)
      if (replaced) finish(previous, 'cancelled')
      // Bound both active state and terminal views; capacity never silently evicts an active request.
      if (!previous && entries.size >= MAX_SESSIONS) {
        for (const [id] of entries) {
          if (!active(get(id)!.operation)) { entries.delete(id); break }
        }
        if (entries.size >= MAX_SESSIONS) return 'Too many active on-demand operations. Cancel one and retry.'
      }
      const time = now()
      entries.set(sessionId, {
        operation: { operationId: randomUUID(), sessionId, kind, ...kind === 'adjust' ? { parentResultId: options.parentResultId } : {}, ...clientInstanceId === undefined ? {} : { clientInstanceId },
          status: 'armed', clarificationRounds: 0, resultIds: [], createdAt: time, updatedAt: time },
        renderCalls: new Set(), lastSeq: previous?.lastSeq,
      })
      return `${replaced ? 'Cancelled the previous active on-demand operation. ' : ''}On-demand UI is armed for the next user message in this session (expires in 10 minutes).`
    },
    cancel(sessionId) {
      const entry = get(sessionId)
      if (!entry || !active(entry.operation)) return 'No active on-demand UI operation in this session.'
      finish(entry, 'cancelled')
      return 'On-demand UI operation cancelled.'
    },
    allowsTemporaryStyle(sessionId, callId) {
      const entry = get(sessionId)
      return entry !== undefined && entry.operation.triggerMessageId !== undefined
        && (entry.operation.status === 'running' || entry.operation.status === 'clarifying')
        && (callId === undefined || (entry.questionCallId === undefined && entry.renderCalls.has(callId)))
    },
    bound(sessionId) {
      const entry = get(sessionId)
      return entry !== undefined && entry.operation.triggerMessageId !== undefined
        && (entry.operation.status === 'running' || entry.operation.status === 'clarifying')
    },
    promptNote(sessionId) {
      const entry = get(sessionId)
      if (!entry) return undefined
      const operation = entry.operation
      // The loop appends the first system prompt before the triggering user/message
      // event, so the note must already be present while the operation is armed. It
      // narrows to the bound turn only after the human message arrives.
      const armed = operation.status === 'armed'
      const bound = operation.triggerMessageId !== undefined
        && (operation.status === 'running' || operation.status === 'clarifying')
      if (!armed && !bound) return undefined
      return operation.kind === 'adjust'
        ? PROMPT_NOTE.replace('This user message requests an on-demand UI.', `This user message requests a **style adjustment** of the result \`<${operation.parentResultId}>\`. Reuse that result's \`temporaryStyle\` snapshot from the conversation, change only what the user asks, keep the content, and render one updated result with a complete \`temporaryStyle\` and matching \`style\`.`)
        : PROMPT_NOTE
    },
    complete,
    capFailure(sessionId) { return get(sessionId)?.capFailure },
    view(sessionId) { const entry = get(sessionId); return entry ? structuredClone(entry.operation) : null },
    projection(sessionId) {
      const entry = get(sessionId)
      if (!entry) return null
      const { status, operationId, clientInstanceId, resultIds, kind, parentResultId, resume } = entry.operation
      return { status, operationId, kind, ...parentResultId === undefined ? {} : { parentResultId }, ...clientInstanceId === undefined ? {} : { clientInstanceId }, resultIds: [...resultIds], ...resume === true ? { resume: true } : {} }
    },
  }
}

/** Recognize only the installed ask tool's bounded structured answer result. */
function questionAnswered(message: unknown): boolean {
  if (!message || typeof message !== 'object' || !('content' in message) || !Array.isArray(message.content)) return false
  return message.content.slice(0, 4).some(block => {
    if (block?.type !== 'text' || typeof block.text !== 'string' || block.text.length > 16_384) return false
    try {
      const value = JSON.parse(block.text)
      return value !== null && typeof value === 'object' && Array.isArray(value.answers)
    } catch { return false }
  })
}
