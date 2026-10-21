/**
 * Command and cross-tab helpers for the composer Intelligent UI control.
 *
 * The Host owns every state decision. The control forwards explicit `/iui`
 * commands and publishes an optimistic view to other tabs while the host
 * projection settles; the projection remains authoritative when it catches up.
 */
import {
  MODE_COMMAND,
  type IntelligentUIModeView,
  type SessionEnable,
  type StylePreference,
} from '../shared/intelligent-ui.ts'

/** One optimistic view broadcast to the other tabs of this GUI. */
export interface SyncedMode {
  /** Session the view belongs to. */
  readonly sessionId: string
  /** Full projection-shaped view the sender expects to settle. */
  readonly view: IntelligentUIModeView
  /** Projection the sender saw before the command; a different frame is authoritative. */
  readonly base?: IntelligentUIModeView
}

/** Cross-tab channel name; one channel per browser page. */
const CHANNEL = 'dsh-intelligent-ui-mode'
let channel: BroadcastChannel | undefined
let synced: SyncedMode | undefined
const listeners = new Set<() => void>()

/** Notify local subscribers after the synced view changes. */
function notify(): void {
  for (const listener of listeners) listener()
}

/** Create the shared channel lazily; deployments without BroadcastChannel still work. */
function ensureChannel(): BroadcastChannel | undefined {
  if (channel !== undefined) return channel
  if (typeof BroadcastChannel === 'undefined') return undefined
  channel = new BroadcastChannel(CHANNEL)
  // Node's BroadcastChannel keeps the event loop alive; a browser tab does not
  // care, and tests must be able to exit.
  ;(channel as BroadcastChannel & { unref?: () => void }).unref?.()
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const value = event.data as Partial<SyncedMode> | null
    if (value === null || typeof value !== 'object') return
    if (typeof value.sessionId !== 'string' || value.view === undefined || value.view === null) return
    synced = { sessionId: value.sessionId, view: value.view as IntelligentUIModeView, base: value.base as IntelligentUIModeView | undefined }
    notify()
  }
  return channel
}

/** Start listening for cross-tab views. Idempotent. */
export function startModeSync(): void {
  ensureChannel()
}

/** Read the last view received from another tab, if any. */
export function readSyncedMode(): SyncedMode | undefined {
  return synced
}

/**
 * Subscribe to cross-tab view changes.
 * @param listener - invoked after each received view.
 * @returns the disposer.
 */
export function subscribeSyncedMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Publish an optimistic view to the other tabs and keep it locally too.
 * @param view - the view the command is expected to settle into.
 * @param sessionId - the session the view belongs to.
 */
export function publishMode(view: IntelligentUIModeView, sessionId: string, base?: IntelligentUIModeView): void {
  synced = { sessionId, view, ...base === undefined ? {} : { base } }
  notify()
  try {
    ensureChannel()?.postMessage(synced)
  } catch {
    /* a closed channel must not break the command path */
  }
}

/** Clear the local cross-tab view. */
export function resetSyncedMode(): void {
  synced = undefined
  notify()
}

/** Compare two projection-shaped views, ignoring the pending flag. */
export function sameView(left: IntelligentUIModeView, right: IntelligentUIModeView): boolean {
  return left.sessionEnable === right.sessionEnable
    && left.sessionStyle === right.sessionStyle
    && left.globalEnabled === right.globalEnabled
    && left.globalStyle === right.globalStyle
    && left.enabled === right.enabled
    && left.style === right.style
}

/**
 * Prefer the cross-tab view for the same session until the projection catches up.
 * @param projected - the host projection value.
 * @param syncedMode - the last cross-tab value.
 * @param sessionId - the session being controlled.
 * @returns the view to render.
 */
export function effectiveView(
  projected: IntelligentUIModeView | undefined,
  syncedMode: SyncedMode | undefined,
  sessionId: string,
): IntelligentUIModeView | undefined {
  if (syncedMode !== undefined && syncedMode.sessionId === sessionId) return syncedMode.view
  return projected
}

/** Slash command that sets this session's enable override. */
export function enableCommand(scope: SessionEnable): string {
  return `/${MODE_COMMAND} ${scope}`
}

/** Slash command that sets this session's answer-style override. */
export function styleCommand(style: StylePreference): string {
  return `/${MODE_COMMAND} style ${style}`
}

/**
 * Run one command through the injected executor.
 * @param execute - injected executor; resolves a failure line or null.
 * @param input - command tail, e.g. `on` or `style article`.
 * @returns the failure line from either failure channel, or null on success.
 */
export async function runCommand(
  execute: (input: string) => Promise<string | null>,
  input: string,
): Promise<string | null> {
  try {
    return await execute(input)
  } catch (reason) {
    return reason instanceof Error ? reason.message : String(reason)
  }
}
