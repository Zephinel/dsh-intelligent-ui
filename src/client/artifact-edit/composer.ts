/**
 * Composer integration for Artifact block editing.
 *
 * The edit request becomes a real composer reference chip: the user sees
 * a label such as 「编辑 Artifact · 2 项修改」 inline in the draft (next to any text they typed),
 * can delete it, and a normal Send serializes the chip through its reference
 * codec into the structured model-facing envelope. No second send system and
 * no draft overwrite are involved.
 *
 * The chip is programmatic: the store asks for an upsert whenever the saved
 * request set changes. Replacing a chip is a span edit that keeps the draft
 * revision CAS, so concurrent typing is preserved.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { InputState, ReferenceInsert, SessionInput, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  ARTIFACT_EDIT_CLIPBOARD,
  ARTIFACT_EDIT_SOURCE,
  buildEditRequestText,
} from '../../shared/artifact-edit.ts'
import type { Translate } from '../../shared/locales.ts'
import {
  editChipLabel,
  editProblemMessage,
  installArtifactComposerBridge,
  openArtifactRequest,
  serializeArtifactEditRequest,
} from './store.ts'

/** Per-session access the composer chip needs, injected by the plugin wiring. */
export interface ArtifactChipAccess {
  /** Current composer state for one chat session, if it is mounted. */
  readonly readInput: (sessionId: string) => InputState | undefined
  /** The live per-session input machine; its public verbs apply draft edits. */
  readonly inputFor: (sessionId: string) => (SessionInput & { insertText?: (text: string, span: TokenSpan) => boolean }) | undefined
}

/** Translation seat provider; the chip copy follows the UI language. */
export type ArtifactEditTranslator = () => Translate

/** Number of pending chip-retry attempts while the composer is busy. */
const MAX_RETRIES = 12

/** Chip reference insert for the current request label. */
function chipInsert(referenceId: string, label: string): ReferenceInsert {
  return {
    source: ARTIFACT_EDIT_SOURCE,
    ref: referenceId,
    label,
    clipboardText: ARTIFACT_EDIT_CLIPBOARD,
    appearance: 'file',
  }
}

/** Sum the clipboard-coordinate padding introduced by earlier chips. */
function extraBefore(state: InputState, offset: number): number {
  let extra = 0
  for (const occurrence of state.occurrences) {
    if (occurrence.offset >= offset) break
    extra += occurrence.length - 1
  }
  return extra
}

/** A chip that starts at one clipboard offset occupies one detect coordinate. */
function chipSpan(state: InputState, occurrence: InputState['occurrences'][number]): TokenSpan {
  const start = occurrence.offset - extraBefore(state, occurrence.offset)
  return { start, end: start + 1, draftRev: state.draftRev }
}

/** Collapsed insertion span at the end of the draft. */
function endSpan(state: InputState): TokenSpan {
  const extra = state.occurrences.reduce((sum, occurrence) => sum + occurrence.length - 1, 0)
  const end = state.draft.length - extra
  return { start: end, end, draftRev: state.draftRev }
}

/** Find our own chip in the current draft. */
function ownChip(state: InputState): InputState['occurrences'][number] | undefined {
  return state.occurrences.find(occurrence => occurrence.source === ARTIFACT_EDIT_SOURCE)
}

/**
 * Insert or refresh the structured edit chip for one session.
 * @param access - composer access.
 * @param sessionId - target chat session.
 * @param referenceId - stable chip reference id for this edit session.
 * @param label - localized chip label.
 * @param attempt - internal retry counter while the composer is busy.
 */
function upsertChip(access: ArtifactChipAccess, sessionId: string, referenceId: string, label: string, attempt = 0): void {
  const input = access.inputFor(sessionId)
  const state = access.readInput(sessionId)
  if (input === undefined || state === undefined) return
  if (typeof input.insertReference !== 'function') return
  if (state.phase !== 'plain') {
    if (attempt < MAX_RETRIES) setTimeout(() => upsertChip(access, sessionId, referenceId, label, attempt + 1), 400)
    return
  }
  const insert = chipInsert(referenceId, label)
  const existing = ownChip(state)
  if (existing === undefined) {
    input.insertReference(insert, endSpan(state))
    return
  }
  if (existing.ref === referenceId && existing.label === insert.label) return
  input.insertReference(insert, chipSpan(state, existing))
}

/**
 * Remove the structured edit chip, keeping every other draft part.
 * @param access - composer access.
 * @param sessionId - target chat session.
 */
function removeChip(access: ArtifactChipAccess, sessionId: string): void {
  const input = access.inputFor(sessionId)
  const state = access.readInput(sessionId)
  if (input === undefined || state === undefined || state.phase !== 'plain') return
  const existing = ownChip(state)
  if (existing === undefined) return
  if (typeof input.insertText === 'function') input.insertText('', chipSpan(state, existing))
}

/**
 * Register the reference source, the composer bridge and the sent-message
 * summary node. The source never offers menu candidates; the chip is inserted
 * programmatically and only its serialization and preview matter.
 * @param ctx - client root context.
 * @param access - composer access.
 * @param translate - locale seat provider (rebound on every call).
 */
export function registerArtifactEditChip(ctx: ClientContext, access: ArtifactChipAccess, translate: ArtifactEditTranslator): void {
  installArtifactComposerBridge({
    canEditChip: sessionId => access.readInput(sessionId)?.phase === 'plain',
    upsertChip: (sessionId, referenceId, label) => upsertChip(access, sessionId, referenceId, label),
    removeChip: sessionId => removeChip(access, sessionId),
    openRequest: (_sessionId, referenceId) => { openArtifactRequest(referenceId) },
  }, translate())

  const source: InputTriggerSource = {
    trigger: '@',
    name: ARTIFACT_EDIT_SOURCE,
    order: 40,
    showGroupTitle: false,
    // The chip is inserted by the extension, never picked from the '@' menu.
    candidates: async () => [],
    onPick: () => undefined,
    openReference: (_session, reference) => openArtifactRequest(reference.ref),
    codec: {
      clipboardText: () => ARTIFACT_EDIT_CLIPBOARD,
      serialize: async (reference: string) => {
        const outcome = await serializeArtifactEditRequest(reference)
        if (!outcome.ok) throw new Error(editProblemMessage(outcome.problem))
        return buildEditRequestText(outcome.request)
      },
    },
  }

  ctx.inject(['inputTriggers'], scoped => {
    const triggers = (scoped as unknown as { inputTriggers?: { registerSource(source: InputTriggerSource): () => void } }).inputTriggers
    if (triggers === undefined || typeof triggers.registerSource !== 'function') return
    const dispose = triggers.registerSource(source)
    return () => { dispose() }
  })
}
