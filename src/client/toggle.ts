/**
 * Pure state math and cross-tab synchronization for the composer Intelligent UI
 * scope control.
 *
 * The host owns three mutually exclusive scopes: `off`, `session` (only the
 * session that flipped it) and `global` (every session). The session projection
 * carries the effective scope to the control. When a control flips it, the host
 * persists the new value and every other open tab learns it over a
 * BroadcastChannel, so controls stay consistent without a page refresh. Kept
 * apart from the TSX control so the decision points are testable with plain
 * Node.
 */
import { MODE_COMMAND, type IntelligentUIModeView, type IntelligentUIScope } from '../shared/intelligent-ui.ts'

/** `data-state` marker values rendered on the composer control. */
export type ToggleState = IntelligentUIScope | 'pending'

/** One scope flip published to other tabs of this GUI. */
export interface SyncedMode {
  readonly mode: IntelligentUIScope
  /** Session the `session` scope belongs to (absent for off/global). */
  readonly sessionId?: string
}

/** BroadcastChannel name shared by every tab of this GUI. */
const CHANNEL_NAME = 'dsh-intelligent-ui-mode'

/** Last scope received from another tab (or published locally). */
let synced: SyncedMode | undefined
const listeners = new Set<() => void>()
let channel: BroadcastChannel | undefined

function emit(): void {
  for (const listener of listeners) listener()
}

function isSyncedMode(value: unknown): value is SyncedMode {
  const record = value as { mode?: unknown; sessionId?: unknown } | null
  return record?.mode === 'off' || record?.mode === 'session' || record?.mode === 'global'
}

/**
 * Start cross-tab synchronization once per page.
 * @returns a disposer that closes the channel (page teardown/tests).
 */
export function startModeSync(): () => void {
  if (channel !== undefined || typeof BroadcastChannel !== 'function') return () => {}
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (event: MessageEvent) => {
    if (isSyncedMode(event.data)) {
      synced = event.data
      emit()
    }
  }
  return () => {
    channel?.close()
    channel = undefined
    synced = undefined
  }
}

/**
 * Read the cross-tab scope, or undefined before any broadcast.
 * @returns the synchronized scope when known.
 */
export function readSyncedMode(): SyncedMode | undefined {
  return synced
}

/**
 * Subscribe to cross-tab scope updates.
 * @param listener - called whenever another tab publishes a value.
 * @returns the unsubscribe function.
 */
export function subscribeSyncedMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Publish one settled scope to this tab and every other open tab.
 * @param mode - the scope the host just accepted.
 * @param sessionId - the session that flipped it (for `session` scope).
 */
export function publishMode(mode: IntelligentUIScope, sessionId?: string): void {
  synced = sessionId === undefined ? { mode } : { mode, sessionId }
  emit()
  channel?.postMessage(synced)
}

/**
 * Test/HMR reset: forget the last cross-tab value without closing the channel.
 */
export function resetSyncedMode(): void {
  if (synced === undefined) return
  synced = undefined
  emit()
}

/**
 * Resolve the effective scope for one session, preferring a live cross-tab value.
 * @param view - the session projection view, or undefined while it loads.
 * @param syncedMode - the latest cross-tab scope, if any.
 * @param sessionId - the session the control is seated in.
 * @returns the effective scope.
 */
export function effectiveMode(
  view: IntelligentUIModeView | undefined,
  syncedMode: SyncedMode | undefined,
  sessionId: string,
): IntelligentUIScope {
  if (syncedMode !== undefined) {
    if (syncedMode.mode === 'global') return 'global'
    if (syncedMode.mode === 'session' && syncedMode.sessionId === sessionId) return 'session'
    return 'off'
  }
  return view?.mode ?? 'off'
}

/**
 * Slash command that settles one scope.
 * @param scope - requested scope.
 * @returns the exact command the host's `/iui` handler parses.
 */
export function modeCommand(scope: IntelligentUIScope): string {
  return `/${MODE_COMMAND} ${scope}`
}

/**
 * Marker value for the control's `data-state` attribute.
 * @param mode - effective scope.
 * @param pending - whether a command is still settling.
 * @returns `pending` while folding, else the settled scope.
 */
export function toggleState(mode: IntelligentUIScope, pending: boolean): ToggleState {
  return pending ? 'pending' : mode
}

/**
 * Run one scope flip through the injected command executor.
 * @param flip - injected executor; resolves a failure line or null.
 * @param scope - requested scope.
 * @returns the failure line from either failure channel, or null on success.
 */
export async function runFlip(
  flip: (scope: IntelligentUIScope) => Promise<string | null>,
  scope: IntelligentUIScope,
): Promise<string | null> {
  try {
    return await flip(scope)
  } catch (reason) {
    return reason instanceof Error ? reason.message : String(reason)
  }
}
