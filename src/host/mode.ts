/**
 * Per-session switch and answer-style control for the Intelligent UI extension.
 *
 * The deployment-wide preferences live in the Host settings document:
 * `globalEnabled` (is every session on by default?) and `answerStyle`
 * (`auto`, `card`, or `article`). The composer can still override both for one
 * session: `/iui on|off|inherit` changes the switch, and
 * `/iui style auto|card|article|inherit` changes the style. A session override
 * always wins over the global value; `inherit` follows it.
 *
 * Persistence is a small JSON file in the harness home
 * (`$DSH_HOME/dsh-intelligent-ui.json`):
 *
 *     { "sessions": ["<id>"], "offSessions": ["<id>"], "styles": { "<id>": "article" } }
 *
 * A legacy `{ enabled: true }` file migrates to the legacy global fallback; the
 * newer `{ global: true }` shape is read the same way. New writes do not carry a
 * global key: the settings document owns that choice now.
 *
 * While a session is off: the prompt section resolves to an empty string (no
 * generation overhead), `render_ui` is denied per agent, and a stray call still
 * fails with a model-readable message.
 *
 * Deployments without the `sessionProjections` + `commands` services cannot
 * show the composer controls, so the extension stays always-on there.
 *
 * @module dsh-intelligent-ui/host/mode
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  MODE_COMMAND,
  MODE_PROJECTION_KEY,
  RENDER_UI_TOOL,
  isAnswerStyle,
  isStylePreference,
} from '../shared/intelligent-ui.ts'
import type {
  AnswerStyle,
  IntelligentUIModeState,
  IntelligentUIModeView,
  SessionEnable,
  StylePreference,
} from '../shared/intelligent-ui.ts'

/** Minimal projection-definition shape this module registers. */
interface ProjectionDefinitionLike {
  readonly key: string
  readonly stateVersion: number
  readonly stateSchema: unknown
  readonly init: (header: { readonly id: string }) => IntelligentUIModeState
  readonly apply: (state: IntelligentUIModeState, event: SessionEventLike) => IntelligentUIModeState
  readonly wire: {
    readonly viewSchema: unknown
    readonly view: (state: IntelligentUIModeState) => IntelligentUIModeView
  }
}

/** The subset of one session event the fold reads. */
interface SessionEventLike {
  readonly type: string
  readonly data?: {
    readonly name?: string
    readonly args?: string
    readonly commandId?: string
    readonly kind?: string
  }
}

/** One accepted command or the settled session id. */
const modeStateSchema = z.object({
  sessionId: z.string(),
  command: z.object({ commandId: z.string(), kind: z.enum(['scope', 'style']) }).strict().nullable().optional(),
}).strict()

/** Wire shape of the `intelligent-ui` projection view. */
const modeViewSchema = z.object({
  sessionEnable: z.enum(['inherit', 'on', 'off']),
  sessionStyle: z.enum(['inherit', 'auto', 'card', 'article']),
  globalEnabled: z.boolean(),
  globalStyle: z.enum(['auto', 'card', 'article']),
  enabled: z.boolean(),
  style: z.enum(['auto', 'card', 'article']),
  pending: z.boolean(),
}).strict()

/** One parsed `/iui` invocation. */
type ParsedCommand =
  | { readonly kind: 'status' }
  | { readonly kind: 'scope'; readonly value: SessionEnable }
  | { readonly kind: 'style'; readonly value: StylePreference }
  | { readonly kind: 'invalid'; readonly message: string }

/**
 * Parse one `/iui` argument.
 * @param raw - the command tail.
 * @returns the parsed command.
 */
function parseCommand(raw: string): ParsedCommand {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { kind: 'status' }
  const head = tokens[0].toLowerCase()
  if (head === 'style') {
    if (tokens.length !== 2) return { kind: 'invalid', message: 'Usage: /iui style [auto|card|article|inherit]' }
    const value = tokens[1].toLowerCase()
    if (isStylePreference(value)) return { kind: 'style', value }
    return { kind: 'invalid', message: 'Usage: /iui style [auto|card|article|inherit]' }
  }
  if (tokens.length !== 1) return { kind: 'invalid', message: 'Usage: /iui [on|off|inherit]' }
  switch (head) {
    case 'on': case 'session': return { kind: 'scope', value: 'on' }
    case 'off': return { kind: 'scope', value: 'off' }
    case 'inherit': case 'follow': return { kind: 'scope', value: 'inherit' }
    case 'global': case 'all':
      return { kind: 'invalid', message: 'Global enabling moved to the extension settings page (Plugins → Intelligent UI).' }
    default:
      return { kind: 'invalid', message: 'Usage: /iui [on|off|inherit] | style [auto|card|article|inherit]' }
  }
}

/** Deployment-wide preference refs the settings document exposes to the Host. */
export interface IntelligentUIPreferenceConfig {
  readonly globalEnabled?: { get?: () => unknown }
  readonly answerStyle?: { get?: () => unknown }
  readonly freeComposition?: { get?: () => unknown }
}

/** Read one live settings ref without letting a settings-provider error break the plugin. */
export function readPreference<T>(ref: { get?: () => unknown } | undefined, valid: (value: unknown) => value is T): T | undefined {
  try {
    const value = ref?.get?.()
    return valid(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Build the session projection: fold command lifecycle for `pending`, project live values.
 * @param viewFor - reads the effective and override state for a session id.
 * @returns the projection definition to register.
 */
export function createSessionProjection(viewFor: (sessionId: string) => Omit<IntelligentUIModeView, 'pending'>): ProjectionDefinitionLike {
  return {
    key: MODE_PROJECTION_KEY,
    stateVersion: 4,
    stateSchema: modeStateSchema,
    init: (header): IntelligentUIModeState => ({ sessionId: header.id, command: null }),
    apply: (state, event): IntelligentUIModeState => {
      if (event.type === 'command/run' && event.data?.name === MODE_COMMAND) {
        const parsed = parseCommand(typeof event.data.args === 'string' ? event.data.args : '')
        // Status/help commands and invalid arguments do not change state.
        if (parsed.kind !== 'scope' && parsed.kind !== 'style') return state
        return {
          ...state,
          command: { commandId: event.data.commandId as string, kind: parsed.kind },
        }
      }
      if (event.type === 'command/done' && state.command != null && event.data?.commandId === state.command.commandId) {
        return { ...state, command: null }
      }
      return state
    },
    wire: {
      viewSchema: modeViewSchema,
      view: (state) => ({ ...viewFor(state.sessionId), pending: state.command != null }),
    },
  }
}

/** Loose Cordis context surface this controller consumes (host bundle has no DSH imports). */
interface ModeHostContext {
  readonly logger?: { warn(message: string): void }
  readonly on?: (event: string, handler: (...args: any[]) => unknown) => unknown
  readonly agents?: { list?: () => Iterable<unknown> }
  readonly inject?: (dependencies: readonly string[], callback: (scoped: ScopedServices) => void) => unknown
}

/** Services resolved for the combined `sessionProjections` + `commands` child scope. */
interface ScopedServices {
  readonly sessionProjections: {
    readonly register: (definition: ProjectionDefinitionLike) => unknown
  }
  readonly commands: {
    readonly register: (definition: unknown) => unknown
  }
}

/** One agent shape the restriction management and command handler touch. */
interface AgentLike {
  readonly session?: { readonly id?: string }
  readonly ctx?: { readonly tools?: { restrict?: (filter: unknown) => (() => void) | undefined } }
}

/** The mode surface the tool and prompt halves consume. */
export interface IntelligentUIState {
  /**
   * Whether the extension is enabled for a session.
   * @param sessionId - the session to check; omitted means the global switch only.
   * @returns true when the session is admitted, or when the host cannot persist a switch.
   */
  enabledFor(sessionId?: string): boolean
  /**
   * Effective answer style for a session.
   * @param sessionId - the session to read; omitted means the global style.
   * @returns the session override, else the global style.
   */
  styleFor(sessionId?: string): AnswerStyle
}

/** Persisted session overrides, with legacy global shapes accepted on read. */
interface PersistedSwitch {
  readonly enabled?: boolean
  readonly global?: boolean
  readonly sessions?: unknown
  readonly offSessions?: unknown
  readonly styles?: unknown
}

/** Resolve the persistence file from the harness home. */
function stateFile(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'dsh-intelligent-ui.json')
}

/**
 * Install the session controls: persistence, projection, `/iui` command, and
 * per-agent tool visibility.
 * @param ctx - host context.
 * @param config - live deployment-wide preference refs, optional on minimal hosts.
 * @returns the mode surface used by the prompt section and tool guard.
 */
export function installSessionControls(ctx: ModeHostContext, config?: IntelligentUIPreferenceConfig): IntelligentUIState {
  let legacyGlobal = false
  let sessionOn = new Set<string>()
  let sessionOff = new Set<string>()
  let sessionStyles = new Map<string, AnswerStyle>()
  let switchReady = false
  let agents: { list?: () => Iterable<unknown> } | undefined
  const restrictions = new WeakMap<object, () => void>()
  const warned = new WeakSet<object>()

  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8')) as PersistedSwitch | null
    legacyGlobal = raw?.enabled === true || raw?.global === true
    if (Array.isArray(raw?.sessions)) {
      sessionOn = new Set((raw.sessions as unknown[]).filter((id): id is string => typeof id === 'string' && id !== ''))
    }
    if (Array.isArray(raw?.offSessions)) {
      for (const id of raw.offSessions as unknown[]) {
        if (typeof id === 'string' && id !== '') {
          sessionOff.add(id)
          sessionOn.delete(id)
        }
      }
    }
    if (typeof raw?.styles === 'object' && raw.styles !== null) {
      for (const [id, style] of Object.entries(raw.styles as Record<string, unknown>)) {
        if (id !== '' && isAnswerStyle(style)) sessionStyles.set(id, style)
      }
    }
  } catch {
    legacyGlobal = false
  }

  const globalEnabled = (): boolean =>
    readPreference(config?.globalEnabled, (value): value is boolean => typeof value === 'boolean') ?? legacyGlobal
  const globalStyle = (): AnswerStyle =>
    readPreference(config?.answerStyle, isAnswerStyle) ?? 'auto'

  /** No composer controls on this host: keep the extension usable (always-on). */
  const effectiveEnabled = (sessionId?: string): boolean => {
    if (!switchReady) return true
    if (sessionId === undefined) return globalEnabled()
    if (sessionOff.has(sessionId)) return false
    if (sessionOn.has(sessionId)) return true
    return globalEnabled()
  }

  const sessionEnableFor = (sessionId: string): SessionEnable => {
    if (sessionOff.has(sessionId)) return 'off'
    if (sessionOn.has(sessionId)) return 'on'
    return 'inherit'
  }

  const sessionStyleFor = (sessionId: string): StylePreference => sessionStyles.get(sessionId) ?? 'inherit'

  const viewFor = (sessionId: string): Omit<IntelligentUIModeView, 'pending'> => {
    const globalOn = globalEnabled()
    const globalOut = globalStyle()
    const sessionEnable = sessionEnableFor(sessionId)
    const sessionStyle = sessionStyleFor(sessionId)
    return {
      sessionEnable,
      sessionStyle,
      globalEnabled: globalOn,
      globalStyle: globalOut,
      enabled: effectiveEnabled(sessionId),
      style: sessionStyle === 'inherit' ? globalOut : sessionStyle,
    }
  }

  const persist = (): void => {
    try {
      const file = stateFile()
      mkdirSync(dirname(file), { recursive: true })
      const temporary = `${file}.tmp`
      const styles = Object.fromEntries([...sessionStyles.entries()].sort(([a], [b]) => a.localeCompare(b)))
      // Keep the legacy global flag when the file held one and the settings
      // document has not taken over the choice; otherwise it is intentionally
      // absent and the Host settings document is authoritative.
      const legacy = legacyGlobal ? { global: true } : {}
      writeFileSync(temporary, `${JSON.stringify({ ...legacy, sessions: [...sessionOn].sort(), offSessions: [...sessionOff].sort(), styles }, null, 2)}\n`, 'utf8')
      renameSync(temporary, file)
    } catch (error) {
      ctx.logger?.warn(`intelligent-ui: could not persist the session controls: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const applyVisibility = (agent: unknown, value: boolean): void => {
    if (agent === undefined || agent === null) return
    const key = agent as object
    const existing = restrictions.get(key)
    if (value) {
      if (existing !== undefined) {
        restrictions.delete(key)
        existing()
      }
      return
    }
    if (existing !== undefined) return
    const tools = (agent as AgentLike).ctx?.tools
    if (typeof tools?.restrict !== 'function') return
    try {
      // Call on the scoped service object: extracting the method would lose
      // the `this.ctx` the restriction registers against.
      const dispose = tools.restrict({ deny: [RENDER_UI_TOOL] })
      if (typeof dispose === 'function') restrictions.set(key, dispose)
    } catch (error) {
      if (!warned.has(key)) {
        warned.add(key)
        ctx.logger?.warn(`intelligent-ui: could not hide render_ui for an agent: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const syncAgent = (agent: unknown): void => {
    if (agent === undefined || agent === null) return
    applyVisibility(agent, effectiveEnabled((agent as AgentLike).session?.id))
  }

  const syncAll = (): void => {
    try {
      for (const agent of agents?.list?.() ?? ctx.agents?.list?.() ?? []) syncAgent(agent)
    } catch {
      /* an unreadable agent list only delays the sync to agent/created or pre-step */
    }
  }

  /** Apply one session override, persist it, and refresh agent visibility when needed. */
  const setSessionEnable = (value: SessionEnable, sessionId: string): 'changed' | 'noop' => {
    if (sessionEnableFor(sessionId) === value) return 'noop'
    if (value === 'on') {
      sessionOn.add(sessionId)
      sessionOff.delete(sessionId)
    } else if (value === 'off') {
      sessionOff.add(sessionId)
      sessionOn.delete(sessionId)
    } else {
      sessionOn.delete(sessionId)
      sessionOff.delete(sessionId)
    }
    persist()
    syncAll()
    return 'changed'
  }

  /** Apply one session style override; style never changes tool visibility. */
  const setSessionStyle = (value: StylePreference, sessionId: string): 'changed' | 'noop' => {
    if (sessionStyleFor(sessionId) === value) return 'noop'
    if (value === 'inherit') sessionStyles.delete(sessionId)
    else sessionStyles.set(sessionId, value)
    persist()
    return 'changed'
  }

  const describeEnable = (sessionId: string | undefined): string => {
    if (sessionId === undefined) return globalEnabled() ? 'on for all sessions' : 'off for all sessions'
    switch (sessionEnableFor(sessionId)) {
      case 'off': return 'off for this session'
      case 'on': return 'on for this session'
      case 'inherit': return globalEnabled() ? 'on via the global switch' : 'off via the global switch'
    }
  }

  const describeStyle = (sessionId: string): string => {
    const view = viewFor(sessionId)
    return view.sessionStyle === 'inherit'
      ? `following the global style (${view.style})`
      : `overridden for this session (${view.style})`
  }

  // Agents may exist before the projection services finish resolving (session
  // restore races plugin boot); this child sync re-applies visibility once the
  // agent registry is readable.
  ctx.inject?.(['agents'], (scoped) => {
    agents = scoped.agents as typeof agents
    syncAll()
  })

  ctx.inject?.(['sessionProjections', 'commands'], (scope) => {
    switchReady = true
    scope.sessionProjections.register(createSessionProjection(viewFor))

    scope.commands.register({
      definitionId: 'dsh-intelligent-ui',
      name: MODE_COMMAND,
      description: 'Set Intelligent UI on/off for this session, or set this session\'s answer style',
      input: { hint: '[on|off|inherit] | style [auto|card|article|inherit]' },
      handler: ({ agent, rawInput }: { agent?: AgentLike; rawInput: string }) => {
        const sessionId = agent?.session?.id
        const parsed = parseCommand(rawInput)
        if (parsed.kind === 'invalid') return { kind: 'error', text: parsed.message }
        if (parsed.kind === 'status') {
          return {
            kind: 'success',
            text: `Intelligent UI is ${describeEnable(sessionId)}; answer style is ${sessionId === undefined ? globalStyle() : describeStyle(sessionId)}.`,
          }
        }
        if (sessionId === undefined) {
          return { kind: 'error', text: 'Intelligent UI needs a session for a session override.' }
        }
        if (parsed.kind === 'scope') {
          const outcome = setSessionEnable(parsed.value, sessionId)
          if (outcome === 'noop') return { kind: 'success', text: `Intelligent UI is already ${describeEnable(sessionId)}.` }
          return {
            kind: 'success',
            text: parsed.value === 'off'
              ? 'Intelligent UI is off for this session.'
              : parsed.value === 'on'
                ? 'Intelligent UI is on for this session.'
                : 'This session follows the global Intelligent UI switch.',
          }
        }
        const outcome = setSessionStyle(parsed.value, sessionId)
        if (outcome === 'noop') return { kind: 'success', text: `Answer style is already ${describeStyle(sessionId)}.` }
        return {
          kind: 'success',
          text: parsed.value === 'inherit'
            ? 'This session follows the global answer style.'
            : `Answer style for this session is ${parsed.value}.`,
        }
      },
    })

    // Existing agents (hot reload) follow the persisted values immediately.
    syncAll()
  })

  ctx.on?.('agent/created', (payload: { agent?: AgentLike }) => {
    syncAgent(payload.agent)
  })

  // Fallback convergence: an agent created before the switch scope resolved, or
  // sessions restored while the persisted value had not been applied yet.
  ctx.on?.('agent/pre-step', async (payload: { agent?: AgentLike }, next: () => Promise<unknown>) => {
    // Sync before the step so a deployment-wide settings change (or a command
    // from another tab) is reflected in this request's tool catalog; sync again
    // afterwards to converge agents created while the step was running.
    try {
      syncAgent(payload.agent)
    } catch {
      /* visibility is best effort; the tool guard still rejects disabled calls */
    }
    const decision = await next()
    try {
      syncAgent(payload.agent)
    } catch {
      /* visibility is best effort; the tool guard still rejects disabled calls */
    }
    return decision
  })

  return {
    enabledFor: effectiveEnabled,
    styleFor: (sessionId?: string) => sessionId === undefined ? globalStyle() : viewFor(sessionId).style,
  }
}
