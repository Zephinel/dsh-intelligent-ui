/**
 * Persisted update-prompt state and its pure decisions.
 *
 * The Host route (`/api/intelligent-ui/update`) already answers one cached
 * registry read. This module turns the extension's two "the user opened the
 * plugin" signals into at most one prompt:
 *
 * - `explicit-enable`: the user picked an enabling scope in the composer chip.
 *   The first such open only records the newer version; the next explicit open
 *   asks.
 * - `default-open`: the deployment-wide switch enables the plugin for every
 *   session, so there is no explicit open to wait for; the check itself asks.
 *
 * The same newer version is asked again on each open until the user updates or
 * silences that exact version; "later" clicks are counted per version and the
 * client shows the "do not remind" action from the fourth prompt on.
 *
 * Everything here is synchronous and storage-agnostic so `node --test` can
 * drive the whole state machine without a browser.
 */
import {
  isNewerStableVersion,
  parseStableVersion,
  type UpdateCheckView,
} from '../shared/update-check.ts'

/** `localStorage` key holding the browser-local prompt state. */
export const UPDATE_PROMPT_STORAGE_KEY = 'dsh-intelligent-ui.update-prompt'

/** Schema version of the stored state; unknown versions are ignored, not migrated. */
export const UPDATE_PROMPT_SCHEMA_VERSION = 1

/** Highest number of release-note highlights the prompt shows. */
export const MAX_UPDATE_PROMPT_HIGHLIGHTS = 6

/** "Later" clicks after which the prompt offers "do not remind". */
export const LATER_CLICKS_BEFORE_SILENCE = 3

/** Why the update check ran; decides whether the first sighting may ask. */
export type UpdatePromptTrigger = 'explicit-enable' | 'default-open'

/** One parsed release-note highlight list, trimmed to the prompt's cap. */
function normalizeHighlights(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((point): point is string => typeof point === 'string' && point.trim() !== '')
    .slice(0, MAX_UPDATE_PROMPT_HIGHLIGHTS)
}

/** Whether the value names a stable version this state machine may persist. */
function isStableVersion(value: unknown): value is string {
  return typeof value === 'string' && parseStableVersion(value) !== undefined
}

/** Persisted state of the prompt cycle for one browser. */
export interface UpdatePromptState {
  /** Newer version detected by an earlier open and not yet settled. */
  readonly pendingVersion?: string
  /** Release-note points recorded with {@link pendingVersion}. */
  readonly pendingHighlights?: readonly string[]
  /** Version the {@link laterClicks} counter belongs to. */
  readonly laterVersion?: string
  /** Number of "later" clicks recorded for {@link laterVersion}. */
  readonly laterClicks?: number
  /** Version the user silenced with "do not remind"; later versions ask again. */
  readonly silencedVersion?: string
}

/** Prompt content resolved by one decision. */
export interface UpdatePromptView {
  readonly current: string
  readonly latest: string
  readonly highlights: readonly string[]
}

/** What one plugin-open event should do to the prompt. */
export type UpdatePromptDecision =
  | { readonly action: 'none'; readonly state: UpdatePromptState }
  | { readonly action: 'record'; readonly state: UpdatePromptState }
  | { readonly action: 'prompt'; readonly state: UpdatePromptState; readonly prompt: UpdatePromptView }

/**
 * The Host reports `0.0.0` when it cannot read the running package version; no
 * comparison against that placeholder is meaningful.
 */
function isKnownCurrent(current: string): boolean {
  return isStableVersion(current) && current !== '0.0.0'
}

/** Reset the recorded cycle while keeping a still-relevant silence marker. */
function clearedCycle(state: UpdatePromptState, current: string): UpdatePromptState {
  if (!isKnownCurrent(current)) return state
  const silenced = state.silencedVersion
  if (silenced === undefined) return {}
  if (isNewerStableVersion(silenced, current)) return { silencedVersion: silenced }
  return {}
}

/** State after one version becomes the thing being asked about. */
function withPendingVersion(state: UpdatePromptState, version: string, highlights: readonly string[]): UpdatePromptState {
  return {
    pendingVersion: version,
    ...highlights.length === 0 ? {} : { pendingHighlights: [...highlights] },
    ...state.laterVersion === version && state.laterClicks !== undefined
      ? { laterVersion: version, laterClicks: state.laterClicks }
      : {},
    ...state.silencedVersion === undefined ? {} : { silencedVersion: state.silencedVersion },
  }
}

/** Later clicks counted for `version`, or zero when the cycle starts over. */
function laterClicksFor(state: UpdatePromptState, version: string): number {
  return state.laterVersion === version ? state.laterClicks ?? 0 : 0
}

/**
 * Decide what one plugin-open event does with the current update answer.
 * @param view - the Host's answer, or null when the route itself was unreachable.
 * @param trigger - why the check ran.
 * @param state - previously persisted state.
 * @returns the action plus the state that must be persisted after it; the
 *   `canSilence` question is answered from that state by {@link offersSilence}.
 */
export function decideUpdatePrompt(
  view: UpdateCheckView | null,
  trigger: UpdatePromptTrigger,
  state: UpdatePromptState,
): UpdatePromptDecision {
  if (view === null) return { action: 'none', state }
  const current = typeof view.current === 'string' ? view.current : '0.0.0'
  const latest = view.updateAvailable === true && isStableVersion(view.latest) ? view.latest : undefined
  const freshHighlights = normalizeHighlights(view.highlights)

  if (latest === undefined) {
    // Either the registry read failed (`latest: null`) or the running version is
    // current. A version recorded earlier stays prompt-able while the running
    // version is still older, so a transient registry failure does not lose it.
    const pending = state.pendingVersion
    if (
      pending !== undefined
      && isKnownCurrent(current)
      && isNewerStableVersion(pending, current)
      && state.silencedVersion !== pending
    ) {
      const highlights = normalizeHighlights(state.pendingHighlights)
      return {
        action: 'prompt',
        state: withPendingVersion(state, pending, highlights),
        prompt: { current, latest: pending, highlights },
      }
    }
    return { action: 'none', state: clearedCycle(state, current) }
  }

  if (state.silencedVersion === latest) {
    return { action: 'none', state: state.pendingVersion === latest ? clearedCycle(state, current) : state }
  }
  const storedHighlights = state.pendingVersion === latest ? normalizeHighlights(state.pendingHighlights) : []
  const highlights = freshHighlights.length > 0 ? freshHighlights : storedHighlights
  const next = withPendingVersion(state, latest, highlights)
  if (trigger === 'default-open' || state.pendingVersion !== undefined) {
    return {
      action: 'prompt',
      state: next,
      prompt: { current, latest, highlights },
    }
  }
  return { action: 'record', state: next }
}

/**
 * Record one "later" click for the version the prompt showed.
 * @param state - current persisted state.
 * @param version - version whose prompt was dismissed.
 * @returns the next persisted state.
 */
export function noteUpdatePromptLater(state: UpdatePromptState, version: string): UpdatePromptState {
  const clicks = laterClicksFor(state, version) + 1
  return { ...state, laterVersion: version, laterClicks: clicks }
}

/**
 * Silence the exact version the user asked to stop hearing about.
 * @param state - current persisted state.
 * @param version - version to silence.
 * @returns the next persisted state; a later version asks again.
 */
export function silenceUpdatePromptVersion(state: UpdatePromptState, version: string): UpdatePromptState {
  return { silencedVersion: version }
}

/** Whether the prompt should offer the "do not remind" action. */
export function offersSilence(state: UpdatePromptState, version: string): boolean {
  return laterClicksFor(state, version) >= LATER_CLICKS_BEFORE_SILENCE
}

/**
 * Parse one stored state document.
 * @param raw - `localStorage` value, if any.
 * @returns valid fields only; corrupt, foreign or future documents reset to empty.
 */
export function parseUpdatePromptState(raw: string | null | undefined): UpdatePromptState {
  if (typeof raw !== 'string' || raw === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const record = parsed as Record<string, unknown>
  if (record.schema !== UPDATE_PROMPT_SCHEMA_VERSION) return {}
  const state: {
    pendingVersion?: string
    pendingHighlights?: string[]
    laterVersion?: string
    laterClicks?: number
    silencedVersion?: string
  } = {}
  if (isStableVersion(record.pendingVersion)) {
    state.pendingVersion = record.pendingVersion
    if (Array.isArray(record.pendingHighlights)) {
      const highlights = normalizeHighlights(record.pendingHighlights)
      if (highlights.length > 0) state.pendingHighlights = highlights
    }
  }
  if (
    isStableVersion(record.laterVersion)
    && typeof record.laterClicks === 'number'
    && Number.isSafeInteger(record.laterClicks)
    && record.laterClicks >= 0
  ) {
    state.laterVersion = record.laterVersion
    state.laterClicks = record.laterClicks
  }
  if (isStableVersion(record.silencedVersion)) state.silencedVersion = record.silencedVersion
  return state
}

/**
 * Serialize the persisted state.
 * @param state - state to store.
 * @returns the JSON document written to `localStorage`.
 */
export function serializeUpdatePromptState(state: UpdatePromptState): string {
  const payload: Record<string, unknown> = { schema: UPDATE_PROMPT_SCHEMA_VERSION }
  if (state.pendingVersion !== undefined) payload.pendingVersion = state.pendingVersion
  if (state.pendingHighlights !== undefined && state.pendingHighlights.length > 0) {
    payload.pendingHighlights = [...state.pendingHighlights]
  }
  if (state.laterVersion !== undefined && state.laterClicks !== undefined) {
    payload.laterVersion = state.laterVersion
    payload.laterClicks = state.laterClicks
  }
  if (state.silencedVersion !== undefined) payload.silencedVersion = state.silencedVersion
  return JSON.stringify(payload)
}
