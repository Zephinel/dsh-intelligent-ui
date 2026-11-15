/**
 * Browser controller for the extension's update prompt.
 *
 * The controller owns the one prompt snapshot the `shell.overlay` entry renders,
 * the browser-local state document, and the two check triggers:
 *
 * - `noteOpen('explicit-enable')` runs after the composer chip successfully
 *   enables the plugin for one session (the first sighting only records).
 * - `watchGlobalSetting()` follows the deployment-wide switch on the Plugins
 *   detail page; when that switch already enables the plugin on this page load,
 *   the first ready settings snapshot asks as soon as the cached check answers.
 *   A switch flipped mid-session takes effect on the next page start, matching
 *   "on every app start".
 *
 * The check itself is the existing same-origin Host route, so no registry or
 * release-notes read happens in the browser.
 */
import { UPDATE_ROUTE_PATH, type UpdateCheckView } from '../shared/update-check.ts'
import {
  decideUpdatePrompt,
  noteUpdatePromptLater,
  offersSilence,
  parseUpdatePromptState,
  serializeUpdatePromptState,
  silenceUpdatePromptVersion,
  UPDATE_PROMPT_STORAGE_KEY,
  type UpdatePromptState,
  type UpdatePromptTrigger,
  type UpdatePromptView,
} from './update-prompt.ts'

/** Prompt snapshot while nothing is shown. */
export interface HiddenUpdatePrompt {
  readonly kind: 'hidden'
}

/** Prompt snapshot while the overlay entry is on screen. */
export interface ShownUpdatePrompt extends UpdatePromptView {
  readonly kind: 'shown'
  readonly expanded: boolean
  /** Whether this prompt offers the "do not remind" action. */
  readonly canSilence: boolean
}

/** One immutable snapshot read by the overlay component. */
export type UpdatePromptSnapshot = HiddenUpdatePrompt | ShownUpdatePrompt

/** User actions the overlay component calls. */
export interface UpdatePromptActions {
  /** Open this bundle's Plugins detail page; keeps the prompt when navigation is unavailable. */
  readonly update: () => void
  /** Close this prompt for now and count one "later" click. */
  readonly later: () => void
  /** Stop asking about the shown version. */
  readonly silence: () => void
  /** Expand or collapse the recorded release-note points. */
  readonly toggleDetails: () => void
}

/** Minimal observable the overlay entry subscribes to. */
export interface UpdatePromptStore {
  getSnapshot(): UpdatePromptSnapshot
  subscribe(listener: () => void): () => void
}

/** Read-only slice of the Host settings form this controller follows. */
export interface GlobalEnableSource {
  getSnapshot(): {
    readonly status: string
    readonly value?: { readonly globalEnabled?: boolean }
  }
  subscribe(listener: () => void): () => void
}

/** Injectable dependencies; production uses the page's fetch and localStorage. */
export interface UpdatePromptControllerOptions {
  /**
   * Navigate to this bundle's Plugins detail page.
   * @returns whether navigation started; false/undefined keeps the prompt open.
   */
  readonly openDetails?: () => boolean
  /** Active DSH locale id, used to ask for the matching release-notes variant. */
  readonly language?: () => string
  /** Fetch override for tests. */
  readonly fetchImpl?: typeof fetch
  /** Storage override for tests. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'>
}

/** The controller surface the plugin registration wires into its slots. */
export interface UpdatePromptController {
  readonly store: UpdatePromptStore
  readonly actions: UpdatePromptActions
  /** Run the check for one plugin-open signal; queued and never rejects. */
  noteOpen(trigger: UpdatePromptTrigger): void
  /**
   * Follow the deployment-wide enable switch.
   * @param source - the Host settings form, when the deployment has one.
   * @returns the disposer that stops following the form.
   */
  watchGlobalSetting(source: GlobalEnableSource | undefined): () => void
  /** Stop publishing and drop queued work. */
  dispose(): void
}

/** Stable hidden snapshot so `useSyncExternalStore` never sees a new object without a change. */
const HIDDEN: UpdatePromptSnapshot = { kind: 'hidden' }

/**
 * Resolve the browser storage once; restricted contexts can throw on access and
 * then keep the prompt session-local.
 * @param override - injected storage for tests.
 * @returns a storage-like object, or undefined when none is usable.
 */
function resolveStorage(override: UpdatePromptControllerOptions['storage']): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  if (override !== undefined) return override
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/**
 * Create the prompt controller for one browser page.
 * @param options - navigation, locale and test overrides.
 * @returns the controller registration keeps for the page's lifetime.
 */
export function createUpdatePromptController(options: UpdatePromptControllerOptions = {}): UpdatePromptController {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const language = options.language ?? (() => '')
  const storage = resolveStorage(options.storage)
  let snapshot: UpdatePromptSnapshot = HIDDEN
  const listeners = new Set<() => void>()
  let disposed = false
  let running = false
  let queued: UpdatePromptTrigger | null = null
  /** Bumped whenever the user settles the prompt so in-flight checks cannot re-open it. */
  let actionRevision = 0
  let stopGlobalSetting: (() => void) | undefined

  const publish = (next: UpdatePromptSnapshot): void => {
    if (next === snapshot) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  const readState = (): UpdatePromptState => {
    try {
      return parseUpdatePromptState(storage?.getItem(UPDATE_PROMPT_STORAGE_KEY))
    } catch {
      return {}
    }
  }

  const writeState = (state: UpdatePromptState): void => {
    try {
      storage?.setItem(UPDATE_PROMPT_STORAGE_KEY, serializeUpdatePromptState(state))
    } catch {
      /* A full or read-only storage keeps the prompt session-local instead of breaking it. */
    }
  }

  const readCheck = async (): Promise<UpdateCheckView | null> => {
    try {
      const active = language()
      const query = typeof active === 'string' && active !== '' ? `?lang=${encodeURIComponent(active)}` : ''
      const response = await fetchImpl(`${UPDATE_ROUTE_PATH}${query}`, { cache: 'no-store' })
      if (!response.ok) return null
      const payload = await response.json() as UpdateCheckView
      return payload !== null && typeof payload === 'object' ? payload : null
    } catch {
      return null
    }
  }

  const run = async (trigger: UpdatePromptTrigger): Promise<void> => {
    const revisionAtStart = actionRevision
    const view = await readCheck()
    // A user action while the check was in flight wins; its state is authoritative.
    if (disposed || revisionAtStart !== actionRevision) return
    const decision = decideUpdatePrompt(view, trigger, readState())
    writeState(decision.state)
    if (decision.action !== 'prompt') return
    publish({
      kind: 'shown',
      ...decision.prompt,
      expanded: false,
      canSilence: offersSilence(decision.state, decision.prompt.latest),
    })
  }

  const noteOpen = (trigger: UpdatePromptTrigger): void => {
    if (disposed) return
    if (running) {
      queued = trigger
      return
    }
    running = true
    void run(trigger).finally(() => {
      running = false
      const next = queued
      queued = null
      if (next !== null) noteOpen(next)
    })
  }

  /** Mark a user decision and drop any queued check that would fight it. */
  const userSettled = (): void => {
    actionRevision += 1
    queued = null
  }

  const actions: UpdatePromptActions = {
    update: () => {
      if (snapshot.kind !== 'shown') return
      // Without the Plugins panel there is nowhere to go: keep the prompt rather
      // than closing it silently.
      if (options.openDetails?.() !== true) return
      userSettled()
      publish(HIDDEN)
    },
    later: () => {
      if (snapshot.kind !== 'shown') return
      userSettled()
      writeState(noteUpdatePromptLater(readState(), snapshot.latest))
      publish(HIDDEN)
    },
    silence: () => {
      if (snapshot.kind !== 'shown') return
      userSettled()
      writeState(silenceUpdatePromptVersion(readState(), snapshot.latest))
      publish(HIDDEN)
    },
    toggleDetails: () => {
      if (snapshot.kind !== 'shown') return
      publish({ ...snapshot, expanded: !snapshot.expanded })
    },
  }

  const store: UpdatePromptStore = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }

  const watchGlobalSetting = (source: GlobalEnableSource | undefined): (() => void) => {
    stopGlobalSetting?.()
    stopGlobalSetting = undefined
    if (disposed || source === undefined) return () => {}
    let evaluated = false
    const evaluate = (): void => {
      if (disposed || evaluated) return
      const state = source.getSnapshot()
      if (state.status !== 'ready') return
      evaluated = true
      if (state.value?.globalEnabled === true) noteOpen('default-open')
    }
    const off = source.subscribe(evaluate)
    evaluate()
    stopGlobalSetting = () => {
      off()
      stopGlobalSetting = undefined
    }
    return stopGlobalSetting
  }

  return {
    store,
    actions,
    noteOpen,
    watchGlobalSetting,
    dispose: () => {
      disposed = true
      queued = null
      stopGlobalSetting?.()
      listeners.clear()
    },
  }
}
