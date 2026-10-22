/**
 * Host half of the DSH Intelligent UI extension.
 *
 * Registers one model-facing tool (`render_ui`) whose canonical argument is a
 * complete OpenUI Lang program, validates that program against the vendored
 * component library, and contributes the OpenUI Lang generation prompt as a
 * system-prompt section. Both the tool and the prompt are gated by the
 * per-session switch and style in ./mode.ts, which are off/auto by default. The browser half
 * (exports["./client"]) renders the recorded programs and hosts the composer
 * switch, which only mirrors the host projection. The browser half also
 * registers the extension's Plugin detail page; its global enablement, answer
 * style and free-composition preferences are volatile fields in the Host
 * settings document.
 *
 * This file is bundled by scripts/build.mjs into lib/index.js. It imports only
 * `@deepseek-ai/schemastery` (the DSH settings schema) besides Node built-ins,
 * its own modules and the generated prompt, so the artifact runs against the
 * installed CLI.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { createParser } from '@openuidev/lang-core'
import librarySpec from '../../vendor/spec.json'
import promptText from '../generated/prompt.txt'
import { installSessionControls, readPreference, type IntelligentUIPreferenceConfig } from './mode.ts'
import {
  ANSWER_STYLES,
  DEFAULT_EXPORT_BACKGROUND,
  EXPORT_BACKGROUND_PATTERN,
  EXPORT_SCALES,
  DEFAULT_EXPORT_SCALE,
  EXPORT_STANDALONE_CSS_PATH,
  EXPORT_STANDALONE_JS_PATH,
  PAGE_STYLES,
  RENDER_UI_TOOL,
  isPageStyle,
} from '../shared/intelligent-ui.ts'
import type { AnswerStyle, PageStyle } from '../shared/intelligent-ui.ts'
import { articleAnchorError, collectArticleAnchors, collectComponentTypes, layoutWarnings } from './program-validation.ts'

export const name = 'intelligent-ui'

/**
 * Preferences served to the DSH settings document. Only `.volatile()` fields
 * are editable from the browser; each value is a live reference, so the prompt
 * section reads the current choice on every request without a plugin reload.
 */
export const Config = z.object({
  freeComposition: z.boolean().default(false).volatile(),
  globalEnabled: z.boolean().volatile(),
  answerStyle: z.union([z.const('auto'), z.const('card'), z.const('article')]).volatile(),
  // Image-export defaults. The beautification frame is chosen per export and
  // therefore stays out of the settings document.
  exportBackground: z.string().pattern(EXPORT_BACKGROUND_PATTERN).default(DEFAULT_EXPORT_BACKGROUND).volatile(),
  exportScale: z.union(EXPORT_SCALES.map(scale => z.const(scale))).default(DEFAULT_EXPORT_SCALE).volatile(),
})

/** Host services this plugin consumes; both must exist before apply runs. */
export const inject = ['tools', 'systemPrompt']

/** Name of the Agent Skill shipped in `skills/intelligent-ui/`. */
const SKILL_NAME = 'intelligent-ui'

/** One parsed SKILL.md: frontmatter routing metadata plus the instruction body. */
interface EmbeddedSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly content: string
  readonly resourceBase: { readonly kind: 'directory'; readonly path: string }
}

/** Directory of the shipped skill, resolved beside the built `lib/index.js`. */
function skillDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', SKILL_NAME)
}

/**
 * Read the shipped SKILL.md and split its minimal YAML frontmatter.
 *
 * The skill file is plain markdown with scalar frontmatter fields, so this
 * avoids a YAML dependency; a malformed file throws and the caller only warns.
 * @returns the skill definition ready for `ctx.skills.register()`.
 */
function readEmbeddedSkill(): EmbeddedSkill {
  const root = skillDirectory()
  const raw = readFileSync(join(root, 'SKILL.md'), 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (match === null) throw new Error('SKILL.md has no YAML frontmatter')
  const fields = new Map<string, string>()
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line)
    if (field !== null) fields.set(field[1], field[2].trim().replace(/^["']|["']$/g, ''))
  }
  const name = fields.get('name') ?? SKILL_NAME
  const description = fields.get('description') ?? ''
  const content = match[2].trim()
  if (name === '' || description === '' || content === '') {
    throw new Error('SKILL.md needs a name, a description and a body')
  }
  return {
    name,
    description,
    ...fields.has('whenToUse') ? { whenToUse: fields.get('whenToUse') as string } : {},
    content,
    resourceBase: { kind: 'directory', path: root },
  }
}

/** Context shape the embedded-skill registration needs (optional Cordis services). */
interface SkillHostContext {
  readonly logger?: { warn(message: string): void }
  readonly inject?: (
    dependencies: readonly string[],
    callback: (scoped: { skills: { register(skill: EmbeddedSkill): unknown } }) => void,
  ) => unknown
}

/**
 * Contribute the shipped Agent Skill when the deployment also composes the
 * skill registry. The tool and prompt work without it; a missing skill file or
 * an older host must not fail the plugin.
 * @param ctx - host context.
 */
function registerEmbeddedSkill(ctx: SkillHostContext): void {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['skills'], (scoped) => {
    try {
      const skill = readEmbeddedSkill()
      scoped.skills.register({
        ...skill,
        // The runtime provider label; the load path validates this field and
        // rejects a definition without it (`source must be a string`).
        source: 'runtime',
        invocation: { modelInvocable: true, userInvocable: true },
        metadata: { origin: 'dsh-intelligent-ui' },
      } as never)
    } catch (error) {
      ctx.logger?.warn(`intelligent-ui: embedded skill not registered: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

/** JSON Schema for the one model-facing argument object. */
const PARAMETERS = {
  type: 'object',
  properties: {
    program: {
      type: 'string',
      description:
        'The complete openui-lang program for the answer. Statement per line; define root = Col(...) first. '
        + 'Every named statement must be reachable from root. This is the UI the user sees.',
    },
    title: {
      type: 'string',
      description: 'Optional short label shown above the rendered answer, e.g. "Day in San Francisco".',
    },
    style: {
      type: 'string',
      enum: PAGE_STYLES,
      description:
        'Answer presentation style for this page. Pass the style named by the session prompt: '
        + '"card" for the compact interactive card, "article" for the reading layout, or the card/article '
        + 'style you chose when the session is in Auto mode.',
    },
  },
  required: ['program', 'style'],
  additionalProperties: false,
} as const

/** Canonical output schema: the call's durable, lossless value. */
const OUTPUT = {
  type: 'object',
  properties: {
    statements: { type: 'number', description: 'Number of parsed openui-lang statements.' },
    style: {
      type: 'string',
      enum: PAGE_STYLES,
      description: 'Resolved answer presentation style recorded with the page.',
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Non-fatal parser findings (unreferenced statements, unresolved references).',
    },
  },
  required: ['statements', 'style'],
  additionalProperties: false,
} as const

const parser = createParser((librarySpec as { readonly schema: unknown }).schema as never, 'Col')

interface ParseFinding {
  readonly message: string
  readonly fatal: boolean
}

/** Parse one complete program; returns model-readable findings plus statement count. */
function inspectProgram(program: string): {
  statements: number
  findings: ParseFinding[]
  types: ReadonlySet<string>
  anchors: { section: string[]; toc: string[]; issues: string[] }
} {
  let result: ReturnType<typeof parser.parse>
  try {
    result = parser.parse(program)
  } catch (error) {
    return { statements: 0, findings: [{ message: error instanceof Error ? error.message : String(error), fatal: true }], types: new Set(), anchors: { section: [], toc: [], issues: [] } }
  }
  const meta = result.meta as {
    readonly incomplete?: boolean
    readonly unresolved?: readonly unknown[]
    readonly orphaned?: readonly unknown[]
    readonly statementCount?: number
    readonly errors?: readonly unknown[]
  }
  const findings: ParseFinding[] = []
  for (const error of meta.errors ?? []) {
    findings.push({ message: String((error as { message?: string }).message ?? error), fatal: true })
  }
  if (meta.incomplete === true) findings.push({ message: 'The program is incomplete.', fatal: true })
  if (result.root == null && findings.length === 0) findings.push({ message: 'No root statement could be resolved.', fatal: true })
  for (const unresolved of meta.unresolved ?? []) {
    findings.push({ message: `Unresolved reference: ${String(unresolved)}`, fatal: false })
  }
  for (const orphaned of meta.orphaned ?? []) {
    findings.push({ message: `Unreferenced statement (will not render): ${String(orphaned)}`, fatal: false })
  }
  const types = new Set<string>()
  collectComponentTypes(result.root, types)
  const anchors = { section: [] as string[], toc: [] as string[], issues: [] as string[] }
  collectArticleAnchors(result.root, anchors.section, anchors.toc, anchors.issues)
  for (const message of layoutWarnings(result.root)) findings.push({ message, fatal: false })
  return { statements: meta.statementCount ?? 0, findings, types, anchors }
}

/**
 * Sentence prepended to the generation prompt while the switch admits the
 * session. The generation prompt itself is static; this line makes the user's
 * opt-in explicit instead of leaving the model to infer it from the tool's
 * presence, and restates the bounded prose exception in one place.
 */
const ENABLED_SESSION_PREFIX =
  'Intelligent UI is enabled for this session. Treat a rendered page as the default answer format; '
  + 'use Markdown only for a single fact or one or two sentences, an explicit request for text, content that cannot be shown as a page, '
  + 'or after render_ui fails twice in the turn.\n\n'

/** Prompt suffix appended when the deployment enables free composition. */
const FREE_COMPOSITION_NOTE =
  '\n\nFree-form layout is on for this deployment: the layout and typography playbook in the intelligent-ui skill, '
  + 'and the design guidance above, are advisory rather than a template. Choose the page shape, hierarchy, density '
  + 'and blocks the content needs, and vary them between answers. The hard rules, the theme tokens and readable text still apply.'

/**
 * Read the free-composition preference from its live config reference.
 * @param config - the plugin Config resolved by the Host, when settings are composed.
 * @returns true only when the deployment opted in; a missing ref means off.
 */
function isFreeComposition(config: IntelligentUIPreferenceConfig | undefined): boolean {
  return readPreference(config?.freeComposition, (value): value is boolean => value === true) === true
}

/** Answer-style guidance appended to the generation prompt for one session. */
const STYLE_NOTES: Readonly<Record<AnswerStyle, string>> = {
  card:
    '\n\nAnswer style for this session: **Card**. Build a compact, scannable interactive card. '
    + 'Keep sections tight and do not turn the answer into a long article; when the request is very broad, '
    + 'cover it with a clear card structure rather than a wall of prose. Pass `style: "card"` to render_ui.',
  article:
    '\n\nAnswer style for this session: **Article**. Build an article-first page in the card: '
    + 'a short coverage summary, a table of contents, and one or more collapsible `Section` components whose body '
    + 'is substantial prose (use `Markdown` inside a Section). Every major part needs specific facts, causes, '
    + 'examples or debates — not a one-line bullet. All core content must be present and readable in the initial '
    + 'render; interactions only add detail or navigation. Do not deliver an outline or a skeleton. '
    + 'Include a reachable `Toc` and at least one `Section`; the Host rejects an article call without both. '
    + 'Pass `style: "article"` to render_ui.',
  auto:
    '\n\nAnswer style for this session: **Auto**. Choose the style the request needs: use Card for interactive, '
    + 'structured, visual or computational answers; use Article when the user asks for a detailed, in-depth, '
    + 'long-form or comprehensive explanation. An Article answer needs a coverage summary, a table of contents, '
    + 'and substantial `Section` prose, not a skeleton. Pass `style: "card"` or `style: "article"` to render_ui '
    + 'to record the style you chose.',
}

/** Register the tool, the switch, the generation prompt, and the embedded Agent Skill. */
export function apply(ctx: {
  tools: { register(definition: unknown): unknown }
  systemPrompt: {
    section(section: {
      name: string
      order: number
      text: string | ((context?: { agent?: { session?: { id?: string } } }) => string)
    }): unknown
  }
  logger?: { warn(message: string): void }
  inject?: (dependencies: readonly string[], callback: (scoped: never) => void) => unknown
  on?: (event: string, handler: (...args: never[]) => unknown) => unknown
  agents?: { list?: () => Iterable<unknown> }
  fiber?: unknown
}, config?: IntelligentUIPreferenceConfig): void {
  // The switch decides whether the prompt section and the tool are visible.
  // A deployment without session projections/commands cannot persist a switch,
  // and `enabledFor` then reports legacy always-on.
  const mode = installSessionControls(ctx as never, config as never)
  // The extension ships its own configuration on the Plugins detail page, so ask
  // the Host settings service to suppress its generated form. Optional: minimal deployments without the
  // settings service keep the tool and prompt working.
  ctx.inject?.(['settings'], (child: never) => {
    const scoped = child as unknown as {
      readonly settings?: { configure?: (options: { auto: boolean }, fiber: unknown) => unknown }
      effect?(fn: () => unknown): unknown
    }
    if (typeof scoped.settings?.configure !== 'function') return
    scoped.effect?.(() => scoped.settings!.configure!({ auto: false }, ctx.fiber))
  })
  ctx.systemPrompt.section({
    name: 'tool:intelligent-ui',
    order: 3100,
    // Resolved per request: empty while the user keeps the switch off, so the
    // ~8.5k-token generation prompt costs nothing in a disabled session. The
    // free-composition preference is read live from its volatile config ref.
    text: (context) => {
      const sessionId = context?.agent?.session?.id
      if (!mode.enabledFor(sessionId)) return ''
      const section = isFreeComposition(config) ? `${promptText}${FREE_COMPOSITION_NOTE}` : promptText
      const note = STYLE_NOTES[mode.styleFor(sessionId)]
      // Keep the style instruction near the top, before the long DSL reference.
      return `${ENABLED_SESSION_PREFIX}${note}

${section}`
    },
  })
  registerEmbeddedSkill(ctx as never)

  // Interactive HTML export needs the standalone renderer assets. Serve them
  // same-origin for the browser export to inline; deployments without a web
  // server simply omit the route and the client reports the page build error.
  ctx.inject?.(['webServer'], (child: never) => {
    const scoped = child as unknown as {
      readonly webServer?: {
        register(route: {
          kind: 'exact'
          path: string
          handler: (req: unknown, res: unknown) => void
        }): () => void
      }
      effect?(fn: () => unknown): unknown
    }
    if (typeof scoped.webServer?.register !== 'function') return
    const server = scoped.webServer
    const assetDir = dirname(fileURLToPath(import.meta.url))
    const serve = (fileName: string, type: string, path: string): (() => void) => {
      let cached: Buffer | undefined
      return server.register({
        kind: 'exact',
        path,
        handler: (req, res) => {
          const request = req as { method?: string }
          const response = res as {
            writeHead(status: number, headers?: Record<string, string>): void
            end(body?: Buffer): void
          }
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405)
            response.end()
            return
          }
          try {
            cached ??= readFileSync(join(assetDir, fileName))
            response.writeHead(200, {
              'content-type': type,
              'cache-control': 'no-store',
              'content-length': String(cached.byteLength),
            })
            if (request.method === 'HEAD') response.end()
            else response.end(cached)
          } catch {
            response.writeHead(404)
            response.end()
          }
        },
      })
    }
    scoped.effect?.(() => {
      const disposeJs = serve('standalone.js', 'text/javascript; charset=utf-8', EXPORT_STANDALONE_JS_PATH)
      const disposeCss = serve('standalone.css', 'text/css; charset=utf-8', EXPORT_STANDALONE_CSS_PATH)
      return () => { disposeJs(); disposeCss() }
    })
  })

  ctx.tools.register({
    name: RENDER_UI_TOOL,
    description:
      'Render an interactive answer as UI in the chat. Pass a complete openui-lang program that follows the '
      + 'Intelligent UI rules in the system prompt. When Intelligent UI is enabled for the session this is the '
      + 'default answer format: use it for any structured answer, including introductions, explainers, timelines, '
      + 'comparisons, dashboards, step-by-step guides, maps, drawings, forms, planners, games or calculators. '
      + 'Answer in prose only for a single fact or a one-line reply, an explicit text request, content that cannot '
      + 'be shown as a page, or after rendering fails. The user sees the rendered page; do not repeat its content '
      + 'in prose. Pass `style` set to the effective session style (card or article; when the session is in Auto, '
      + 'the style you chose). Article pages use Toc and collapsible Section blocks; Card pages stay compact. '
      + 'Call it at most once per turn, after any brief introductory sentence.',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT,
      render: (_args: unknown, value: { statements: number; style: PageStyle; warnings?: readonly string[] }) => [{
        type: 'text' as const,
        text: value.warnings === undefined || value.warnings.length === 0
          ? `Interactive UI rendered for the user (${value.statements} statements, ${value.style} style).`
          : `Interactive UI rendered for the user (${value.statements} statements, ${value.style} style). Parser notes: ${value.warnings.join('; ')}`,
      }],
    },
    async execute(args: { program: string; style?: unknown }, exec?: { agent?: { session?: { id?: string } } }) {
      const sessionId = exec?.agent?.session?.id
      if (!mode.enabledFor(sessionId)) {
        throw new Error(
          'render_ui is disabled for this session. Turn on Intelligent UI with the composer switch or /iui on|inherit.',
        )
      }
      const effective = mode.styleFor(sessionId)
      if (!isPageStyle(args.style)) {
        const expected = effective === 'auto' ? '"card" or "article"' : `"${effective}"`
        throw new Error(`render_ui: pass style ${expected} for this session.`)
      }
      // Forced styles are enforced on the Host: a stale or guessed style must be
      // retried, so the recorded page chrome cannot disagree with the setting.
      if (effective !== 'auto' && args.style !== effective) {
        throw new Error(`render_ui: this session's answer style is "${effective}"; pass style: "${effective}".`)
      }
      const requestedStyle: PageStyle = args.style
      const program = typeof args.program === 'string' ? args.program.trim() : ''
      if (program === '') throw new Error('render_ui: program must be a non-empty openui-lang program.')
      const { statements, findings, types, anchors } = inspectProgram(program)
      const fatal = findings.filter(finding => finding.fatal)
      if (fatal.length > 0) {
        throw new Error(
          'render_ui: the program is not valid openui-lang and was not shown. Fix it and call render_ui again. '
          + fatal.map(finding => finding.message).join('; '),
        )
      }
      if (requestedStyle === 'article' && (!types.has('Toc') || !types.has('Section'))) {
        throw new Error(
          'render_ui: the article style needs a Toc and at least one Section. '
          + 'Use Toc(["..."]) and Section("...", [Markdown("...")]) for every major part; a plain Markdown program is the card style.',
        )
      }
      // Validate anchors whenever Section/Toc appear, not only for Article: a
      // duplicate id is invalid DOM regardless of the card chrome.
      const anchorError = articleAnchorError(anchors, types)
      if (anchorError !== undefined) throw new Error(anchorError)
      return { statements, style: requestedStyle, ...findings.length === 0 ? {} : { warnings: findings.map(finding => finding.message) } }
    },
  })
}
