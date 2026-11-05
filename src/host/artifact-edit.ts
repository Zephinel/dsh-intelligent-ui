/** Structured block-edit requests observed from the user message stream. */
import {
  ARTIFACT_EDIT_OPEN, ARTIFACT_ID_PATTERN, MAX_ARTIFACT_BATCH_REQUESTS, MAX_ARTIFACT_PROGRAM_CHARS,
  describeTargetOrderProblem, isNoOpEditRequest, isReorderedOrder,
  parseEditRequestTexts,
  type ArtifactEditRequest, type ArtifactRevisionMeta, type ArtifactRevisionStatus,
} from '../shared/artifact-edit.ts'
import { artifactEditWarnings, extractArtifactBlocks, reorderProgramToTargetOrder, verifyEditTargets } from '../shared/artifact-blocks.ts'
import type { ArtifactRevisionRecord, ArtifactRevisionStore } from './artifact-revisions.ts'

/** How long an observed edit request stays armed for the next render_ui call. */
export const ARTIFACT_EDIT_TTL = 15 * 60 * 1000
const MAX_PENDING_SESSIONS = 64
/** Pending requests retained per session; one send arms at most a full batch. */
const MAX_SESSION_REQUESTS = MAX_ARTIFACT_BATCH_REQUESTS

/** Which pending request a tool call targets when a session holds several. */
export type PendingSelectorError = 'multiple_pending' | 'unknown_request' | 'unknown_artifact' | 'artifact_mismatch'

/** Selector a tool call uses to pick one request out of a multi-request send. */
export interface PendingArtifactSelector {
  readonly requestId?: string
  readonly artifactId?: string
}

/** One armed edit request, or why it cannot be resolved/applied. */
export interface PendingArtifactEdit {
  readonly request?: ArtifactEditRequest
  /** Model-readable reason a parsed-but-unusable request cannot be applied. */
  readonly invalidReason?: string
  /** Why the selector did not resolve exactly one usable pending request. */
  readonly error?: PendingSelectorError
  readonly requestId?: string
  readonly artifactId?: string
  readonly mode?: 'block' | 'full'
  readonly messageId?: string
}

/** One pending request summarized for model-facing selection errors. */
export interface PendingArtifactEditSummary {
  readonly requestId: string
  readonly artifactId?: string
  readonly mode?: 'block' | 'full'
  readonly invalid: boolean
}

/** Lineage and findings of one applied edit. */
export interface AppliedArtifactEdit {
  readonly lineage: ArtifactRevisionMeta
  readonly warnings: string[]
}

export interface ArtifactEditController {
  /** One pending request; `undefined` means none, or a selector could not resolve exactly one. */
  pending(sessionId?: string, selector?: PendingArtifactSelector): PendingArtifactEdit | undefined
  /** Compact view of every live pending request, in arrival order. */
  listPending(sessionId?: string): PendingArtifactEditSummary[]
  apply(input: {
    readonly sessionId?: string
    readonly callId?: string
    readonly args: Record<string, unknown>
    /** Host-composed page for a block-level tool call; skips render_ui argument style checks and always carries the page. */
    readonly composedProgram?: string
    /** Exact pending request to consume; omitted for the legacy single-request path. */
    readonly requestId?: string
    readonly artifactId?: string
  }): AppliedArtifactEdit
}

/** Structural subset of installed SessionEvent that carries a user message. */
interface ArtifactEditSessionEvent {
  readonly type: string
  readonly data?: {
    readonly id?: string
    readonly source?: { readonly kind?: string }
    readonly content?: readonly unknown[]
    readonly message?: { readonly content?: readonly unknown[] }
  }
}

/** One stored pending request. */
interface Entry {
  readonly requestId: string
  readonly request?: ArtifactEditRequest
  readonly invalidReason?: string
  readonly artifactId?: string
  readonly mode?: 'block' | 'full'
  readonly messageId?: string
  readonly createdAt: number
}

interface SessionState {
  readonly entries: Map<string, Entry>
}

const RELOAD = 'Ask the user to reload the rendered page and make the edit again.'

const UNREADABLE_MESSAGE = `render_ui: the block edit request in this user message could not be read, so the page was not updated. ${RELOAD}`

const EXPIRED_MESSAGE = `render_ui: the block edit request expired before the page was updated. ${RELOAD}`

const NO_PENDING_MESSAGE = 'render_ui: no block edit request is pending for this session; answer normally or call render_ui for a new page.'

const NO_OP_MESSAGE = 'render_ui: this block edit request changes nothing (no instructions, no global instruction and the same block order), so no revision can be rendered. Ask the user to choose an edit or reorder a block before editing again.'

const ARRANGEMENT_MESSAGE = 'render_ui: this block arrangement request could not be verified because the updated program did not keep every top-level block; keep the same top-level blocks with their statement names/titles (no add/remove/merge) and try again.'

const DUPLICATE_ARTIFACT_MESSAGE = (artifactId: string): string =>
  `render_ui: this user message contains more than one edit request for artifactId ${JSON.stringify(artifactId)}; only the first request per artifact is armed. Ask the user to send one edit per artifact.`

/** Deterministic request id for a legacy envelope that carries no requestId. */
function legacyRequestId(request: ArtifactEditRequest): string {
  const raw = request.artifactId === request.baseRevisionId ? request.artifactId : `${request.artifactId}_${request.baseRevisionId}`
  return `legacy_${raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 72)}`
}

const LEGACY_UNREADABLE_REQUEST_ID = 'legacy_unreadable'

/** Model-readable staleness report shared by the observer and apply(). */
function staleMessage(request: ArtifactEditRequest, status: ArtifactRevisionStatus, tool = 'render_ui'): string {
  return `${tool}: this block edit targets revision ${request.baseRevision}, but revision ${status.latestRevision} is now the latest; the page is out of date. ${RELOAD}`
}

/** Model-readable problem with a branch edit's base revision, or undefined when it resolves. */
function branchBaseProblem(request: ArtifactEditRequest, base: ArtifactRevisionRecord | undefined, tool: string): string | undefined {
  if (base === undefined) {
    if (request.baseRevision === 1) return undefined
    return `${tool}: this branch edit targets revision ${request.baseRevision} (${JSON.stringify(request.baseRevisionId)}), which is not a recorded revision of artifact ${JSON.stringify(request.artifactId)}; only revision 1 (the original render) may be unrecorded. Ask the user to reload the page and retry.`
  }
  if (base.artifactId !== request.artifactId) {
    return `${tool}: this branch edit's base revision ${JSON.stringify(request.baseRevisionId)} belongs to artifact ${JSON.stringify(base.artifactId)}, not ${JSON.stringify(request.artifactId)}; reload the page and retry.`
  }
  if (base.revision !== request.baseRevision) {
    return `${tool}: this branch edit says it targets revision ${request.baseRevision}, but base revision ${JSON.stringify(request.baseRevisionId)} is revision ${base.revision}; reload the page and retry.`
  }
  return undefined
}

/** Text blocks of one user message, in order. */
function messageText(content: readonly unknown[] | undefined): string | undefined {
  if (!Array.isArray(content)) return undefined
  const texts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') texts.push(candidate.text)
  }
  return texts.length === 0 ? undefined : texts.join('\n')
}

/**
 * Install the user-message observer and the render-time applicator.
 *
 * One user message may carry several V1 edit envelopes (one per Composer chip);
 * the Host aggregates them into a per-session batch keyed by requestId. Legacy
 * envelopes without a requestId keep the previous single-pending behavior.
 * @param ctx - host context with the optional live event subscription and logger.
 * @param revisions - durable revision registry.
 * @param options - clock injection for tests.
 * @returns the edit controller used by render_ui and the block-level tool.
 */
export function createArtifactEditController(
  ctx: {
    on?: (event: string, handler: (...args: any[]) => unknown, prepend?: boolean) => unknown
    logger?: { warn(message: string): void }
  } = {},
  revisions: ArtifactRevisionStore,
  options: { now?: () => number } = {},
): ArtifactEditController {
  const now = options.now ?? Date.now
  const sessions = new Map<string, SessionState>()

  /** Live, non-expired entries in arrival order; expired entries are dropped. */
  const liveEntries = (sessionId: string): Entry[] => {
    const state = sessions.get(sessionId)
    if (state === undefined) return []
    const expired: string[] = []
    for (const entry of state.entries.values()) {
      if (now() - entry.createdAt >= ARTIFACT_EDIT_TTL) expired.push(entry.requestId)
    }
    for (const requestId of expired) state.entries.delete(requestId)
    if (state.entries.size === 0) {
      sessions.delete(sessionId)
      return []
    }
    return [...state.entries.values()]
  }

  const viewOf = (entry: Entry): PendingArtifactEdit => ({
    ...entry.request === undefined || entry.invalidReason !== undefined ? {} : { request: entry.request },
    ...entry.invalidReason === undefined ? {} : { invalidReason: entry.invalidReason },
    requestId: entry.requestId,
    ...entry.artifactId === undefined ? {} : { artifactId: entry.artifactId },
    ...entry.mode === undefined ? {} : { mode: entry.mode },
    ...entry.messageId === undefined ? {} : { messageId: entry.messageId },
  })

  const summaryOf = (entry: Entry): PendingArtifactEditSummary => ({
    requestId: entry.requestId,
    ...entry.artifactId === undefined ? {} : { artifactId: entry.artifactId },
    ...entry.mode === undefined ? {} : { mode: entry.mode },
    invalid: entry.invalidReason !== undefined,
  })

  /** Store one entry: same requestId replaces, per-session cap drops the oldest. */
  const arm = (sessionId: string, entry: Entry): void => {
    let state = sessions.get(sessionId)
    if (state === undefined) {
      if (sessions.size >= MAX_PENDING_SESSIONS) {
        let oldestSession: string | undefined
        let oldestAt = Number.POSITIVE_INFINITY
        for (const [id, candidate] of sessions) {
          let newest = 0
          for (const item of candidate.entries.values()) if (item.createdAt > newest) newest = item.createdAt
          if (newest < oldestAt) {
            oldestAt = newest
            oldestSession = id
          }
        }
        if (oldestSession !== undefined) sessions.delete(oldestSession)
      }
      state = { entries: new Map() }
      sessions.set(sessionId, state)
    }
    state.entries.delete(entry.requestId)
    while (state.entries.size >= MAX_SESSION_REQUESTS) {
      const oldest = state.entries.keys().next()
      if (oldest.done === true) break
      state.entries.delete(oldest.value)
    }
    state.entries.set(entry.requestId, entry)
  }

  /** Delete one consumed request, dropping the session state when it becomes empty. */
  const consume = (sessionId: string, requestId: string): void => {
    const state = sessions.get(sessionId)
    if (state === undefined) return
    state.entries.delete(requestId)
    if (state.entries.size === 0) sessions.delete(sessionId)
  }

  type Resolution = { readonly entry?: Entry; readonly error?: PendingSelectorError }
  const resolve = (sessionId: string, selector: PendingArtifactSelector | undefined): Resolution => {
    const live = liveEntries(sessionId)
    const requestId = selector?.requestId
    const artifactId = selector?.artifactId
    if (requestId !== undefined) {
      const entry = live.find(candidate => candidate.requestId === requestId)
      if (entry === undefined) return { error: 'unknown_request' }
      if (artifactId !== undefined && entry.artifactId !== artifactId) return { entry, error: 'artifact_mismatch' }
      return { entry }
    }
    if (artifactId !== undefined) {
      const matches = live.filter(candidate => candidate.artifactId === artifactId)
      if (matches.length === 0) return { error: 'unknown_artifact' }
      if (matches.length > 1) return { error: 'multiple_pending' }
      return { entry: matches[0] }
    }
    if (live.length === 0) return {}
    if (live.length > 1) return { error: 'multiple_pending' }
    return { entry: live[0] }
  }

  const selectorFailure = (tool: 'render_ui' | 'edit_ui_blocks', error: PendingSelectorError): Error => {
    switch (error) {
      case 'multiple_pending':
        return new Error(`${tool}: more than one Artifact edit request is pending for this session; choose exactly one pending request by passing requestId in the tool arguments.`)
      case 'unknown_request':
        return new Error(`${tool}: no pending Artifact edit request matches the given requestId.`)
      case 'unknown_artifact':
        return new Error(`${tool}: no pending Artifact edit request matches the given artifactId.`)
      case 'artifact_mismatch':
        return new Error(`${tool}: the pending requestId does not belong to the given artifactId.`)
    }
  }

  /** Describe why one parsed request cannot be applied, or undefined when it can. */
  const describeProblem = (request: ArtifactEditRequest): string | undefined => {
    // A branch edit may target an older revision; apply() re-validates that base.
    if (request.branch !== true) {
      const base = revisions.get(request.baseRevisionId)
      if (base !== undefined && (base.artifactId !== request.artifactId || base.revision !== request.baseRevision)) {
        return `render_ui: this block edit request belongs to a different artifact revision. ${RELOAD}`
      }
    }
    const extraction = extractArtifactBlocks(request.program)
    if (extraction.unsupported !== undefined) {
      return `render_ui: the block edit request's original program cannot be block-edited (${extraction.unsupported}). ${RELOAD}`
    }
    const baseBlockIds = extraction.blocks.map(block => block.blockId)
    const orderProblem = describeTargetOrderProblem(request.targetOrder, baseBlockIds)
    if (orderProblem !== undefined) {
      return `render_ui: the block edit request has an invalid target order (${orderProblem}); it must list every top-level block id exactly once. ${RELOAD}`
    }
    const targetProblem = verifyEditTargets(extraction, request.edits)
    if (targetProblem !== undefined) {
      return `render_ui: this block edit request does not match the program it was made for (${targetProblem}). ${RELOAD}`
    }
    if (isNoOpEditRequest(request, baseBlockIds)) return NO_OP_MESSAGE
    if (request.branch !== true) {
      const status = revisions.status({ artifactId: request.artifactId, revisionId: request.baseRevisionId })
      if (status.conflict || status.revision !== request.baseRevision || status.latestRevision !== request.baseRevision) {
        return staleMessage(request, status)
      }
    }
    return undefined
  }

  // Cordis supports prepend. Observe the user message before later projections publish it.
  ctx.on?.('session/event', (session: { id?: string }, event: ArtifactEditSessionEvent) => {
    if (event.type !== 'user/message' || typeof session.id !== 'string' || session.id === '') return
    const sessionId = session.id
    const data = event.data
    if (data === undefined) return
    // Injected user-role context (skills, file notices, goals) is not a human edit.
    const source = data.source
    if (source?.kind !== undefined && source.kind !== 'user') return
    // Installed user messages carry content directly; keep the nested message shape too.
    const text = messageText(data.message?.content ?? data.content)
    if (text === undefined || !text.includes(ARTIFACT_EDIT_OPEN)) return
    const messageId = typeof data.id === 'string' ? data.id : undefined
    const message = messageId === undefined ? {} : { messageId }
    const requests = parseEditRequestTexts(text)
    if (requests.length === 0) {
      // Keep the old single-pending behavior for one unreadable legacy envelope.
      sessions.delete(sessionId)
      arm(sessionId, { requestId: LEGACY_UNREADABLE_REQUEST_ID, invalidReason: UNREADABLE_MESSAGE, createdAt: now(), ...message })
      return
    }
    // An old client sends one envelope without requestId; that send replaces the
    // session's previous request, exactly like the pre-batch Host.
    if (requests.every(request => request.requestId === undefined)) sessions.delete(sessionId)
    if (requests.length > MAX_ARTIFACT_BATCH_REQUESTS) {
      ctx.logger?.warn(`intelligent-ui: ignored ${requests.length - MAX_ARTIFACT_BATCH_REQUESTS} artifact edit request(s) beyond the per-message limit of ${MAX_ARTIFACT_BATCH_REQUESTS}`)
    }
    const acceptedArtifacts = new Set<string>()
    for (const request of requests.slice(0, MAX_ARTIFACT_BATCH_REQUESTS)) {
      const requestId = request.requestId ?? legacyRequestId(request)
      const artifactId = request.artifactId
      const duplicate = acceptedArtifacts.has(artifactId)
      acceptedArtifacts.add(artifactId)
      const base = { requestId, request, artifactId, mode: request.edits.length > 0 ? 'block' as const : 'full' as const, createdAt: now(), ...message }
      if (duplicate) {
        ctx.logger?.warn(`intelligent-ui: ignored a duplicate artifact edit request for ${artifactId} in one user message`)
        arm(sessionId, { ...base, invalidReason: DUPLICATE_ARTIFACT_MESSAGE(artifactId) })
        continue
      }
      const problem = describeProblem(request)
      arm(sessionId, problem === undefined ? base : { ...base, invalidReason: problem })
    }
  }, true)
  ctx.on?.('session/disposed', (session: { id?: string }) => { if (typeof session.id === 'string') sessions.delete(session.id) })

  const pending: ArtifactEditController['pending'] = (sessionId, selector) => {
    if (sessionId === undefined) return undefined
    const resolved = resolve(sessionId, selector)
    if (resolved.error === undefined) return resolved.entry === undefined ? undefined : viewOf(resolved.entry)
    if (resolved.error === 'artifact_mismatch' && resolved.entry !== undefined) {
      return { error: resolved.error, requestId: resolved.entry.requestId, artifactId: resolved.entry.artifactId }
    }
    return { error: resolved.error }
  }

  const listPending: ArtifactEditController['listPending'] = sessionId => {
    if (sessionId === undefined) return []
    return liveEntries(sessionId).map(summaryOf)
  }

  return {
    pending,
    listPending,
    apply({ sessionId, callId, args, composedProgram, requestId, artifactId }) {
      if (sessionId === undefined) throw new Error('render_ui: a block edit needs a session identity.')
      const state = sessions.get(sessionId)
      if (state === undefined) throw new Error(NO_PENDING_MESSAGE)
      const before = [...state.entries.values()]
      const live = liveEntries(sessionId)
      if (requestId === undefined && artifactId === undefined && live.length === 0 && before.length === 1) {
        // Preserve the pre-batch TTL error when the only request just expired.
        throw new Error(EXPIRED_MESSAGE)
      }
      if (live.length === 0) throw new Error(NO_PENDING_MESSAGE)
      const tool = composedProgram === undefined ? 'render_ui' : 'edit_ui_blocks'
      const resolved = resolve(sessionId, requestId === undefined && artifactId === undefined ? undefined : { requestId, artifactId })
      if (resolved.error !== undefined) throw selectorFailure(tool, resolved.error)
      const entry = resolved.entry
      if (entry === undefined) throw new Error(NO_PENDING_MESSAGE)
      if (entry.invalidReason !== undefined) throw new Error(entry.invalidReason)
      const request = entry.request
      if (request === undefined) throw new Error(UNREADABLE_MESSAGE)
      if (typeof callId !== 'string' || !ARTIFACT_ID_PATTERN.test(callId)) {
        throw new Error('render_ui: the block edit needs the current tool call identity; call render_ui again.')
      }
      // A block-level tool supplies the Host-composed page; the render_ui style
      // arguments never travel with it and the recorded request style still wins.
      const composed = composedProgram !== undefined
      if (!composed) {
        if ('temporaryStyle' in args) {
          throw new Error('render_ui: block editing is not supported for temporary-style results; ask the user to re-render the page with a saved or built-in style before editing.')
        }
        if (args.style !== request.style) {
          throw new Error(`render_ui: this block edit must keep the recorded page style "${request.style}"; pass style: "${request.style}".`)
        }
        if (request.styleId === undefined) {
          if ('styleId' in args) throw new Error('render_ui: this block edit keeps a built-in page style; omit styleId.')
        } else if (args.styleId !== request.styleId) {
          throw new Error(`render_ui: this block edit must keep the recorded style template; pass styleId: "${request.styleId}".`)
        }
      }
      // A prior turn may have recorded a newer revision while this request stayed armed.
      // A branch edit is allowed to target an older revision; it becomes latest+1.
      const branch = request.branch === true
      const base = revisions.get(request.baseRevisionId)
      const latest = revisions.latestFor(request.artifactId)
      let revisionNumber: number
      if (branch) {
        const problem = branchBaseProblem(request, base, tool)
        if (problem !== undefined) throw new Error(problem)
        revisionNumber = (latest === undefined ? request.baseRevision : latest.revision) + 1
      } else {
        if (base !== undefined && (base.artifactId !== request.artifactId || base.revision !== request.baseRevision)) {
          throw new Error(`${tool}: this block edit request belongs to a different artifact revision. ${RELOAD}`)
        }
        const status = revisions.status({ artifactId: request.artifactId, revisionId: request.baseRevisionId })
        if (status.conflict || status.revision !== request.baseRevision || status.latestRevision !== request.baseRevision) {
          throw new Error(staleMessage(request, status, tool))
        }
        revisionNumber = request.baseRevision + 1
      }
      if (revisionNumber > 100_000) {
        throw new Error(`${tool}: this artifact has reached its maximum revision number; start a new page or restore an older revision instead.`)
      }
      const program = composed ? composedProgram.trim() : typeof args.program === 'string' ? args.program.trim() : ''
      const updated = extractArtifactBlocks(program)
      if (updated.rootType !== 'Col') {
        throw new Error(composed
          ? 'edit_ui_blocks: the composed block program is not a valid artifact page; call edit_ui_blocks again with one complete expression per selected block.'
          : 'render_ui: an updated artifact page must keep root = Col([...]); the program was not recorded as a new revision. Fix the root and call render_ui again.')
      }
      const baseExtraction = extractArtifactBlocks(request.program)
      const editedBlockIds = request.edits.map(edit => edit.blockId)
      // The Host owns the mechanical arrangement; the client `orderChanged` hint is not trusted.
      let effectiveProgram = program
      let normalizedProgram: string | undefined
      if (isReorderedOrder(baseExtraction.blocks.map(block => block.blockId), request.targetOrder)) {
        const reordered = reorderProgramToTargetOrder(program, request.targetOrder, baseExtraction)
        if (reordered === undefined) {
          throw new Error(composed
            ? 'edit_ui_blocks: the composed page no longer keeps every top-level block, so the block order cannot be restored; call edit_ui_blocks again without renaming or removing blocks.'
            : ARRANGEMENT_MESSAGE)
        }
        effectiveProgram = reordered
        if (reordered !== program) normalizedProgram = reordered
      }
      // A block-level result only carries a fragment, so its lineage always needs the composed page.
      if (composed) normalizedProgram = effectiveProgram
      // The lineage program is replayed by the client and must satisfy the shared request bound.
      if (normalizedProgram !== undefined && normalizedProgram.length > MAX_ARTIFACT_PROGRAM_CHARS) {
        throw new Error(composed
          ? `edit_ui_blocks: the composed program is too long for an artifact revision (limit ${MAX_ARTIFACT_PROGRAM_CHARS} characters); shorten the block program and call edit_ui_blocks again.`
          : `render_ui: the arranged program is too long for an artifact revision (limit ${MAX_ARTIFACT_PROGRAM_CHARS} characters); shorten it and call render_ui again.`)
      }
      const warnings = artifactEditWarnings(request.program, effectiveProgram, editedBlockIds)
      const record: ArtifactRevisionRecord = {
        revisionId: callId,
        artifactId: request.artifactId,
        baseRevisionId: request.baseRevisionId,
        revision: revisionNumber,
        sessionId,
        style: request.style,
        ...request.styleId === undefined ? {} : { styleId: request.styleId },
        ...request.title === undefined ? {} : { title: request.title },
        editedBlockIds,
        createdAt: now(),
      }
      revisions.record(record)
      consume(sessionId, entry.requestId)
      return {
        lineage: {
          artifactId: record.artifactId,
          revisionId: record.revisionId,
          ...request.requestId === undefined ? {} : { requestId: request.requestId },
          baseRevisionId: request.baseRevisionId,
          revision: record.revision,
          editedBlockIds,
          ...normalizedProgram === undefined ? {} : { program: normalizedProgram },
        },
        warnings,
      }
    },
  }
}
