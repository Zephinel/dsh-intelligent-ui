/** Structured block-edit requests observed from the user message stream. */
import {
  ARTIFACT_EDIT_OPEN, ARTIFACT_ID_PATTERN, MAX_ARTIFACT_PROGRAM_CHARS,
  describeTargetOrderProblem, isNoOpEditRequest, isReorderedOrder,
  parseEditRequestText,
  type ArtifactEditRequest, type ArtifactRevisionMeta, type ArtifactRevisionStatus,
} from '../shared/artifact-edit.ts'
import { artifactEditWarnings, extractArtifactBlocks, reorderProgramToTargetOrder, verifyEditTargets } from '../shared/artifact-blocks.ts'
import type { ArtifactRevisionRecord, ArtifactRevisionStore } from './artifact-revisions.ts'

/** How long an observed edit request stays armed for the next render_ui call. */
export const ARTIFACT_EDIT_TTL = 15 * 60 * 1000
const MAX_PENDING_SESSIONS = 64

/** One armed edit request, or why it cannot be applied. */
export interface PendingArtifactEdit {
  readonly request?: ArtifactEditRequest
  readonly invalidReason?: string
}

/** Lineage and findings of one applied edit. */
export interface AppliedArtifactEdit {
  readonly lineage: ArtifactRevisionMeta
  readonly warnings: string[]
}

export interface ArtifactEditController {
  pending(sessionId?: string): PendingArtifactEdit | undefined
  apply(input: {
    readonly sessionId?: string
    readonly callId?: string
    readonly args: Record<string, unknown>
    /** Host-composed page for a block-level tool call; skips render_ui argument style checks and always carries the page. */
    readonly composedProgram?: string
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

interface Entry extends PendingArtifactEdit {
  readonly createdAt: number
}

const RELOAD = 'Ask the user to reload the rendered page and make the edit again.'

const UNREADABLE_MESSAGE = `render_ui: the block edit request in this user message could not be read, so the page was not updated. ${RELOAD}`

const EXPIRED_MESSAGE = `render_ui: the block edit request expired before the page was updated. ${RELOAD}`

const NO_PENDING_MESSAGE = 'render_ui: no block edit request is pending for this session; answer normally or call render_ui for a new page.'

const NO_OP_MESSAGE = 'render_ui: this block edit request changes nothing (no instructions, no global instruction and the same block order), so no revision can be rendered. Ask the user to choose an edit or reorder a block before editing again.'

const ARRANGEMENT_MESSAGE = 'render_ui: this block arrangement request could not be verified because the updated program did not keep every top-level block; keep the same top-level blocks with their statement names/titles (no add/remove/merge) and try again.'

/** Model-readable staleness report shared by the observer and apply(). */
function staleMessage(request: ArtifactEditRequest, status: ArtifactRevisionStatus, tool = 'render_ui'): string {
  return `${tool}: this block edit targets revision ${request.baseRevision}, but revision ${status.latestRevision} is now the latest; the page is out of date. ${RELOAD}`
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
 * @param ctx - host context with the optional live event subscription.
 * @param revisions - durable revision registry.
 * @param options - clock injection for tests.
 * @returns the edit controller used by the render_ui execute path.
 */
export function createArtifactEditController(
  ctx: { on?: (event: string, handler: (...args: any[]) => unknown, prepend?: boolean) => unknown } = {},
  revisions: ArtifactRevisionStore,
  options: { now?: () => number } = {},
): ArtifactEditController {
  const now = options.now ?? Date.now
  const entries = new Map<string, Entry>()

  const arm = (sessionId: string, entry: Entry): void => {
    // Re-insert so Map iteration order keeps the newest session last.
    entries.delete(sessionId)
    entries.set(sessionId, entry)
    if (entries.size <= MAX_PENDING_SESSIONS) return
    let oldestId: string | undefined
    let oldestAt = Number.POSITIVE_INFINITY
    for (const [id, candidate] of entries) {
      if (id === sessionId || candidate.createdAt >= oldestAt) continue
      oldestAt = candidate.createdAt
      oldestId = id
    }
    if (oldestId !== undefined) entries.delete(oldestId)
  }

  /** Describe why one parsed request cannot be applied, or undefined when it can. */
  const describeProblem = (request: ArtifactEditRequest): string | undefined => {
    const base = revisions.get(request.baseRevisionId)
    if (base !== undefined && (base.artifactId !== request.artifactId || base.revision !== request.baseRevision)) {
      return `render_ui: this block edit request belongs to a different artifact revision. ${RELOAD}`
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
    const status = revisions.status({ artifactId: request.artifactId, revisionId: request.baseRevisionId })
    if (status.conflict || status.revision !== request.baseRevision || status.latestRevision !== request.baseRevision) {
      return staleMessage(request, status)
    }
    return undefined
  }

  // Cordis supports prepend. Observe the user message before later projections publish it.
  ctx.on?.('session/event', (session: { id?: string }, event: ArtifactEditSessionEvent) => {
    if (event.type !== 'user/message' || typeof session.id !== 'string' || session.id === '') return
    const data = event.data
    if (data === undefined) return
    // Injected user-role context (skills, file notices, goals) is not a human edit.
    const source = data.source
    if (source?.kind !== undefined && source.kind !== 'user') return
    // Installed user messages carry content directly; keep the nested message shape too.
    const text = messageText(data.message?.content ?? data.content)
    if (text === undefined || !text.includes(ARTIFACT_EDIT_OPEN)) return
    const request = parseEditRequestText(text)
    if (request === undefined) {
      arm(session.id, { createdAt: now(), invalidReason: UNREADABLE_MESSAGE })
      return
    }
    const problem = describeProblem(request)
    arm(session.id, problem === undefined
      ? { createdAt: now(), request }
      : { createdAt: now(), invalidReason: problem })
  }, true)
  ctx.on?.('session/disposed', (session: { id?: string }) => { if (typeof session.id === 'string') entries.delete(session.id) })

  const pending: ArtifactEditController['pending'] = sessionId => {
    if (sessionId === undefined) return undefined
    const entry = entries.get(sessionId)
    if (entry === undefined) return undefined
    if (now() - entry.createdAt >= ARTIFACT_EDIT_TTL) {
      entries.delete(sessionId)
      return undefined
    }
    return {
      ...entry.request === undefined ? {} : { request: entry.request },
      ...entry.invalidReason === undefined ? {} : { invalidReason: entry.invalidReason },
    }
  }

  return {
    pending,
    apply({ sessionId, callId, args, composedProgram }) {
      if (sessionId === undefined) throw new Error('render_ui: a block edit needs a session identity.')
      const entry = entries.get(sessionId)
      if (entry === undefined) throw new Error(NO_PENDING_MESSAGE)
      if (now() - entry.createdAt >= ARTIFACT_EDIT_TTL) {
        entries.delete(sessionId)
        throw new Error(EXPIRED_MESSAGE)
      }
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
      const tool = composed ? 'edit_ui_blocks' : 'render_ui'
      const base = revisions.get(request.baseRevisionId)
      if (base !== undefined && (base.artifactId !== request.artifactId || base.revision !== request.baseRevision)) {
        throw new Error(`${tool}: this block edit request belongs to a different artifact revision. ${RELOAD}`)
      }
      const status = revisions.status({ artifactId: request.artifactId, revisionId: request.baseRevisionId })
      if (status.conflict || status.revision !== request.baseRevision || status.latestRevision !== request.baseRevision) {
        throw new Error(staleMessage(request, status, tool))
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
        revision: request.baseRevision + 1,
        sessionId,
        style: request.style,
        ...request.styleId === undefined ? {} : { styleId: request.styleId },
        ...request.title === undefined ? {} : { title: request.title },
        editedBlockIds,
        createdAt: now(),
      }
      revisions.record(record)
      entries.delete(sessionId)
      return {
        lineage: {
          artifactId: record.artifactId,
          revisionId: record.revisionId,
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
