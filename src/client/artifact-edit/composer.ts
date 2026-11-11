/**
 * Composer integration for Artifact block editing.
 *
 * Every attached draft owns one real composer reference chip, so one message
 * can carry several artifact-edit chips (one per Artifact being edited). The
 * chip is programmatic: the store asks for a per-reference upsert whenever a
 * draft changes, and a normal Send serializes each chip through its reference
 * codec into its own structured envelope. No second send system and no draft
 * overwrite are involved.
 *
 * Chips are addressed by their stable reference id, never by "the first chip of
 * this source": inserting a chip appends it at the end of the draft, updating a
 * chip replaces only that chip's span, and removing a chip deletes only that
 * chip. Deleting a chip by hand detaches its draft instead of silently
 * re-inserting it: a short post-insert presence check tells the store that the
 * user removed it, and only an explicit attach brings it back.
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
  editProblemMessage,
  installArtifactComposerBridge,
  noteArtifactChipMissing,
  openArtifactRequest,
  serializeArtifactEditRequest,
  type ArtifactComposerBridge,
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

/** Delay before checking that a freshly upserted chip still exists. */
const CHIP_PRESENCE_CHECK_MS = 800

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

/** Find the artifact-edit chip that carries one reference id. */
function chipForRef(state: InputState, referenceId: string): InputState['occurrences'][number] | undefined {
  return state.occurrences.find(occurrence => occurrence.source === ARTIFACT_EDIT_SOURCE && occurrence.ref === referenceId)
}

/** Schedule the post-upsert presence check (browser only; tests call it directly). */
function schedulePresenceCheck(access: ArtifactChipAccess, sessionId: string, referenceId: string): void {
  if (typeof window === 'undefined') return
  window.setTimeout(() => { verifyArtifactChipAttachment(access, sessionId, referenceId) }, CHIP_PRESENCE_CHECK_MS)
}

/**
 * Verify that one just-upserted chip is still in the draft.
 *
 * A missing chip means the user deleted it, not that the store should insert it
 * again: the draft becomes detached (kept, but out of the next Send) until the
 * user attaches it explicitly. The check is skipped while the composer is not
 * in its plain state, so a send in flight never detaches a draft.
 * @param access - composer access.
 * @param sessionId - target chat session.
 * @param referenceId - chip reference whose presence is checked.
 */
export function verifyArtifactChipAttachment(access: ArtifactChipAccess, sessionId: string, referenceId: string): void {
  const state = access.readInput(sessionId)
  if (state === undefined || state.phase !== 'plain') return
  if (chipForRef(state, referenceId) !== undefined) return
  noteArtifactChipMissing(referenceId)
}

/** Polling cadence of the post-Apply auto-submit probe (ms). */
const AUTO_SUBMIT_INTERVAL_MS = 400
/** Number of auto-submit probes before giving up and asking for a manual Send. */
const AUTO_SUBMIT_RETRIES = 12
/** Number of confirmation probes after pressing Send before reporting manual. */
const AUTO_SUBMIT_CONFIRM_RETRIES = 20

/**
 * Whether the composer holds text outside its reference chips.
 *
 * Every occurrence span is removed from the clipboard projection before the
 * remainder is inspected, so neither another draft's chip nor the separator the
 * chip insertion itself adds can be mistaken for user prose. Attachment chips
 * are occurrences too, so they are removed the same way. The post-Apply probe
 * must not auto-send when real text remains: joining user prose to a model
 * request would silently change what the user is writing.
 * @param state - current composer state.
 * @returns true when text other than chips remains.
 */
export function composerHasPlainText(state: {
  readonly draft: string
  readonly occurrences: readonly { readonly offset?: number; readonly length: number }[]
}): boolean {
  let plain = ''
  let cursor = 0
  const spans = [...state.occurrences].sort((left, right) => (left.offset ?? 0) - (right.offset ?? 0))
  for (const occurrence of spans) {
    const start = occurrence.offset ?? cursor
    if (start > cursor) plain += state.draft.slice(cursor, start)
    cursor = Math.max(cursor, start + Math.max(0, occurrence.length))
  }
  plain += state.draft.slice(cursor)
  return plain.trim() !== ''
}

/** Composer access needed by the post-Apply auto-submit probe. */
export interface ArtifactSubmitAccess extends ArtifactChipAccess {
  /** Submit the current draft through the normal Send path; absent when the host has no Send verb. */
  readonly submit?: () => void
  /**
   * Whether the store observed the draft actually consumed by the send path
   * (the chip codec ran and marked it submitted). Without this seat the probe
   * cannot confirm a send and reports a manual send instead of a fake success.
   */
  readonly isSubmitted?: (referenceId: string) => boolean
}

/**
 * Submit the remapped model request after a structural Apply.
 *
 * A structural Apply replaces the draft key, so the composer chip has just been
 * re-inserted. Submitting before the composer is back to its plain phase would
 * send an empty request; this probe waits for both conditions (plain phase and
 * the new chip occurrence) before pressing Send, then waits for the store to
 * confirm that the chip codec consumed the draft. An unconfirmed send is
 * reported as failure, so the card never claims "submitted" for a message that
 * did not leave the composer. It never clears the draft on failure: the caller
 * keeps the chip and tells the user to send manually.
 * @param access - composer access plus the Send verb and the confirmation seat.
 * @param sessionId - chat session owning the composer.
 * @param referenceId - chip reference of the remapped draft.
 * @param options - retry count/interval overrides (tests).
 * @returns whether the draft was confirmed submitted.
 */
export async function requestArtifactAutoSubmit(
  access: ArtifactSubmitAccess,
  sessionId: string,
  referenceId: string,
  options: { readonly retries?: number; readonly intervalMs?: number; readonly confirmRetries?: number } = {},
): Promise<boolean> {
  const retries = options.retries ?? AUTO_SUBMIT_RETRIES
  const intervalMs = options.intervalMs ?? AUTO_SUBMIT_INTERVAL_MS
  const confirmRetries = options.confirmRetries ?? AUTO_SUBMIT_CONFIRM_RETRIES
  const confirm = access.isSubmitted
  const submit = access.submit
  // Without both the Send verb and a confirmation seat the probe cannot verify
  // a real send; downgrade to a manual send instead of reporting a fake one.
  if (typeof submit !== 'function' || typeof confirm !== 'function') return false
  let pressed = false
  for (let attempt = 0; attempt <= retries && !pressed; attempt += 1) {
    const state = access.readInput(sessionId)
    if (state !== undefined && state.phase === 'plain' && chipForRef(state, referenceId) !== undefined) {
      try {
        submit()
        pressed = true
      } catch {
        return false
      }
      break
    }
    if (attempt === retries) break
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  if (!pressed) return false
  // The send path is asynchronous (the chip codec serializes before the message
  // is accepted), so confirm it instead of assuming the click was enough.
  for (let attempt = 0; attempt <= confirmRetries; attempt += 1) {
    if (confirm(referenceId)) return true
    if (attempt === confirmRetries) break
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return false
}

/**
 * Insert or refresh the chip of one draft.
 *
 * Inserting appends at the end of the draft; updating replaces only the span of
 * that chip. Other artifact-edit chips are never touched.
 * @param access - composer access.
 * @param sessionId - target chat session.
 * @param referenceId - stable chip reference id of the draft.
 * @param label - localized chip label.
 * @param attempt - internal retry counter while the composer is busy.
 * @returns whether the composer now shows the chip.
 */
export function upsertArtifactChip(
  access: ArtifactChipAccess,
  sessionId: string,
  referenceId: string,
  label: string,
  attempt = 0,
): boolean {
  const input = access.inputFor(sessionId)
  const state = access.readInput(sessionId)
  if (input === undefined || state === undefined) return false
  if (typeof input.insertReference !== 'function') return false
  if (state.phase !== 'plain') {
    if (attempt < MAX_RETRIES) setTimeout(() => upsertArtifactChip(access, sessionId, referenceId, label, attempt + 1), 400)
    return false
  }
  const insert = chipInsert(referenceId, label)
  const existing = chipForRef(state, referenceId)
  if (existing !== undefined && existing.label === label) return true
  const applied = existing === undefined
    ? input.insertReference(insert, endSpan(state))
    : input.insertReference(insert, chipSpan(state, existing))
  if (applied !== true) return false
  schedulePresenceCheck(access, sessionId, referenceId)
  return true
}

/**
 * Remove only the chip of one draft; every other draft chip stays in place.
 * A busy composer defers the removal instead of dropping it, so a chip of a
 * consumed draft cannot outlive its send.
 * @param access - composer access.
 * @param sessionId - target chat session.
 * @param referenceId - chip reference id to remove.
 * @param attempt - internal retry counter while the composer is busy.
 */
export function removeArtifactChip(access: ArtifactChipAccess, sessionId: string, referenceId: string, attempt = 0): void {
  const input = access.inputFor(sessionId)
  const state = access.readInput(sessionId)
  if (input === undefined || state === undefined) return
  if (state.phase !== 'plain') {
    if (attempt < MAX_RETRIES) setTimeout(() => removeArtifactChip(access, sessionId, referenceId, attempt + 1), 400)
    return
  }
  const existing = chipForRef(state, referenceId)
  if (existing === undefined) return
  if (typeof input.insertText === 'function') input.insertText('', chipSpan(state, existing))
}

/**
 * Register the reference source, the composer bridge and the sent-message
 * summary node. The source never offers menu candidates; chips are inserted
 * programmatically and only their serialization and preview matter.
 * @param ctx - client root context.
 * @param access - composer access.
 * @param translate - locale seat provider (rebound on every call).
 */
export function registerArtifactEditChip(ctx: ClientContext, access: ArtifactChipAccess, translate: ArtifactEditTranslator): void {
  const composerBridge: ArtifactComposerBridge = {
    canEditChip: sessionId => access.readInput(sessionId)?.phase === 'plain',
    upsertChip: (sessionId, referenceId, label) => { upsertArtifactChip(access, sessionId, referenceId, label) },
    removeChip: (sessionId, referenceId) => { removeArtifactChip(access, sessionId, referenceId) },
    openRequest: (_sessionId, referenceId) => { openArtifactRequest(referenceId) },
  }
  installArtifactComposerBridge(composerBridge, translate())

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
