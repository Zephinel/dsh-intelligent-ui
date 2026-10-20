/**
 * On/off switch for the Intelligent UI extension with three mutually exclusive
 * scopes: **off** (nothing on this host), **session** (only the session that
 * flipped it), and **global** (every session on this host).
 *
 * The extension ships `render_ui` plus a ~8.5k-token generation prompt. Both are
 * expensive, so the model only receives them when the switch admits the session
 * (composer segmented control or `/iui off|session|global`).
 *
 * Persistence is a small JSON file in the harness home
 * (`$DSH_HOME/dsh-intelligent-ui.json`, default `~/.dsh/...`):
 *
 *     { "global": false, "sessions": ["<session-id>"] }
 *
 * — `global` enables every session, `sessions` lists session-only overrides. A
 * new session is off unless the host is in global scope. The file is read once
 * at plugin load and rewritten atomically on every flip; a legacy
 * `{ "enabled": true }` file migrates to `global`.
 *
 * The slash command still logs the ordinary `command/run` / `command/done` pair
 * in the session that issued it; the `intelligent-ui` session projection folds
 * that pair for the switch's pending state and projects the effective scope for
 * that session (its init header carries the session id).
 *
 * While a session is off: the prompt section resolves to an empty string (no
 * generation overhead), `render_ui` is denied per agent through
 * `agent.ctx.tools.restrict()`, and a stray call still fails with a
 * model-readable message.
 *
 * Deployments without the `sessionProjections` + `commands` services cannot
 * show the composer switch, so the extension stays always-on there.
 *
 * @module dsh-intelligent-ui/host/mode
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { MODE_COMMAND, MODE_PROJECTION_KEY, RENDER_UI_TOOL } from '../shared/intelligent-ui.ts'
import type { IntelligentUIModeState, IntelligentUIScope } from '../shared/intelligent-ui.ts'

/** Minimal projection-definition shape this module registers. */
interface ProjectionDefinitionLike {
  readonly key: string
  readonly stateVersion: number
  readonly stateSchema: unknown
  readonly init: (header: { readonly id: string }) => IntelligentUIModeState
  readonly apply: (state: IntelligentUIModeState, event: SessionEventLike) => IntelligentUIModeState
  readonly wire: {
    readonly viewSchema: unknown
    readonly view: (state: IntelligentUIModeState) => { mode: IntelligentUIScope; pending: boolean }
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

/** One accepted scope request or the settled session id. */
const modeStateSchema = z.object({
  sessionId: z.string(),
  running: z.object({ commandId: z.string(), scope: z.enum(['off', 'session', 'global']) }).strict().nullable(),
}).strict()

/** Wire shape of the `intelligent-ui` projection view. */
const modeViewSchema = z.object({
  mode: z.enum(['off', 'session', 'global']),
  pending: z.boolean(),
}).strict()

/**
 * Parse one `/iui` argument into a scope.
 * @param raw - the command tail.
 * @returns the scope, `undefined` for the bare status command, or null when invalid.
 */
function parseScope(raw: string): IntelligentUIScope | undefined | null {
  switch (raw.trim().toLowerCase()) {
    case '': return undefined
    case 'off': return 'off'
    case 'session': case 'this': return 'session'
    case 'global': case 'all': case 'on': return 'global'
    default: return null
  }
}

/**
 * Build the session projection: it folds the command lifecycle for `pending`
 * and reports the effective scope for its own session.
 * @param modeFor - reads the effective scope for a session id.
 * @returns the projection definition to register.
 */
export function createModeProjection(modeFor: (sessionId: string) => IntelligentUIScope): ProjectionDefinitionLike {
  return {
    key: MODE_PROJECTION_KEY,
    stateVersion: 3,
    stateSchema: modeStateSchema,
    init: (header): IntelligentUIModeState => ({ sessionId: header.id, running: null }),
    apply: (state: IntelligentUIModeState, event: SessionEventLike): IntelligentUIModeState => {
      if (event.type === 'command/run' && event.data?.name === MODE_COMMAND) {
        const scope = parseScope(typeof event.data.args === 'string' ? event.data.args : '')
        // Invalid arguments and the bare status command do not change scope.
        if (scope === undefined || scope === null) return state
        return { ...state, running: { commandId: event.data.commandId as string, scope } }
      }
      if (event.type === 'command/done' && state.running !== null && event.data?.commandId === state.running.commandId) {
        return { ...state, running: null }
      }
      return state
    },
    wire: {
      viewSchema: modeViewSchema,
      view: (state: IntelligentUIModeState) => ({
        mode: modeFor(state.sessionId),
        pending: state.running !== null,
      }),
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
export interface IntelligentUIMode {
  /**
   * Whether the extension is enabled for a session.
   * @param sessionId - the session to check; omitted means global scope only.
   * @returns true when the session is admitted, or when the host cannot persist a switch.
   */
  enabledFor(sessionId?: string): boolean
}

/** Persisted switch file, with the legacy single-boolean shape accepted. */
interface PersistedSwitch {
  readonly global: boolean
  readonly sessions: readonly string[]
}

/** Resolve the persistence file from the harness home. */
function stateFile(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'dsh-intelligent-ui.json')
}

/**
 * Install the switch: persistence, projection, `/iui` command, and per-agent
 * tool visibility.
 * @param ctx - host context.
 * @returns the mode surface used by the prompt section and tool guard.
 */
export function installModeControl(ctx: ModeHostContext): IntelligentUIMode {
  let globalEnabled = false
  let sessionOverrides = new Set<string>()
  let switchReady = false
  let agents: { list?: () => Iterable<unknown> } | undefined
  const restrictions = new WeakMap<object, () => void>()
  const warned = new WeakSet<object>()

  try {
    const raw: unknown = JSON.parse(readFileSync(stateFile(), 'utf8'))
    const record = raw as { global?: unknown; sessions?: unknown; enabled?: unknown } | null
    if (record?.enabled === true) {
      // Legacy single-boolean file from the previous release.
      globalEnabled = true
    } else {
      globalEnabled = record?.global === true
      if (Array.isArray(record?.sessions)) {
        sessionOverrides = new Set(record.sessions.filter((id): id is string => typeof id === 'string' && id !== ''))
      }
    }
  } catch {
    globalEnabled = false
  }

  /** No composer switch on this host: keep the extension usable (always-on). */
  const enabledFor = (sessionId?: string): boolean => {
    if (!switchReady) return true
    if (globalEnabled) return true
    return sessionId !== undefined && sessionOverrides.has(sessionId)
  }

  const modeFor = (sessionId: string): IntelligentUIScope => {
    if (!switchReady) return 'global'
    if (globalEnabled) return 'global'
    return sessionOverrides.has(sessionId) ? 'session' : 'off'
  }

  const persist = (): void => {
    try {
      const file = stateFile()
      mkdirSync(dirname(file), { recursive: true })
      const temporary = `${file}.tmp`
      const value: PersistedSwitch = { global: globalEnabled, sessions: [...sessionOverrides].sort() }
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      renameSync(temporary, file)
    } catch (error) {
      ctx.logger?.warn(`intelligent-ui: could not persist the switch: ${error instanceof Error ? error.message : String(error)}`)
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
    applyVisibility(agent, enabledFor((agent as AgentLike).session?.id))
  }

  const syncAll = (): void => {
    try {
      for (const agent of agents?.list?.() ?? ctx.agents?.list?.() ?? []) syncAgent(agent)
    } catch {
      /* an unreadable agent list only delays the sync to agent/created or pre-step */
    }
  }

  /** Apply one scope to every session, persist it, and refresh agent visibility. */
  const setScope = (scope: IntelligentUIScope, sessionId: string | undefined): 'changed' | 'noop' => {
    const nextGlobal = scope === 'global'
    const nextOverrides = scope === 'session'
      ? new Set(sessionId === undefined ? [] : [sessionId])
      : new Set<string>()
    const same = nextGlobal === globalEnabled
      && nextOverrides.size === sessionOverrides.size
      && [...nextOverrides].every(id => sessionOverrides.has(id))
    if (same) return 'noop'
    globalEnabled = nextGlobal
    sessionOverrides = nextOverrides
    persist()
    syncAll()
    return 'changed'
  }

  const describe = (sessionId: string | undefined): string => {
    const scope = sessionId === undefined ? (modeFor('') === 'global' ? 'global' : 'off') : modeFor(sessionId)
    return scope === 'global' ? 'all sessions' : scope === 'session' ? 'this session only' : 'off'
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
    scope.sessionProjections.register(createModeProjection(modeFor))

    scope.commands.register({
      definitionId: 'dsh-intelligent-ui',
      name: MODE_COMMAND,
      description: 'Set Intelligent UI off, for this session only, or for all sessions',
      input: { hint: '[off|session|global]' },
      handler: ({ agent, rawInput }: { agent?: AgentLike; rawInput: string }) => {
        const sessionId = agent?.session?.id
        const parsed = parseScope(rawInput)
        if (parsed === null) {
          return { kind: 'error', text: 'Usage: /iui [off|session|global]' }
        }
        if (parsed === undefined) {
          return { kind: 'success', text: `Intelligent UI is ${describe(sessionId)}.` }
        }
        if (parsed === 'session' && sessionId === undefined) {
          return { kind: 'error', text: 'Intelligent UI needs a session for the session scope.' }
        }
        const outcome = setScope(parsed, sessionId)
        if (outcome === 'noop') {
          return { kind: 'success', text: `Intelligent UI is already ${describe(sessionId)}.` }
        }
        return {
          kind: 'success',
          text: parsed === 'global'
            ? 'Intelligent UI on for all sessions. render_ui and its generation prompt are available.'
            : parsed === 'session'
              ? 'Intelligent UI on for this session only.'
              : 'Intelligent UI off for every session. render_ui is hidden from the model.',
        }
      },
    })

    // Existing agents (hot reload) follow the persisted value immediately.
    syncAll()
  })

  ctx.on?.('agent/created', (payload: { agent?: AgentLike }) => {
    syncAgent(payload.agent)
  })

  // Fallback convergence: an agent created before the switch scope resolved, or
  // sessions restored while the persisted value had not been applied yet.
  ctx.on?.('agent/pre-step', async (payload: { agent?: AgentLike }, next: () => Promise<unknown>) => {
    const decision = await next()
    try {
      syncAgent(payload.agent)
    } catch {
      /* visibility is best effort; the tool guard still rejects disabled calls */
    }
    return decision
  })

  return { enabledFor }
}
