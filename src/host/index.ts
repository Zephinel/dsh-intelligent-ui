/**
 * Host half of the DSH Intelligent UI extension.
 *
 * Registers one model-facing tool (`render_ui`) whose canonical argument is a
 * complete OpenUI Lang program, validates that program against the vendored
 * component library, and contributes the OpenUI Lang generation prompt as a
 * system-prompt section. Both the tool and the prompt are gated by the
 * per-session switch in ./mode.ts, which is off by default. The browser half
 * (exports["./client"]) renders the recorded programs and hosts the composer
 * switch, which only mirrors the host projection.
 *
 * This file is bundled by scripts/build.mjs into lib/index.js; it intentionally
 * imports no DSH package so the artifact runs against the installed CLI.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createParser } from '@openuidev/lang-core'
import librarySpec from '../../vendor/spec.json'
import promptText from '../generated/prompt.txt'
import { installModeControl } from './mode.ts'
import { RENDER_UI_TOOL } from '../shared/intelligent-ui.ts'

export const name = 'intelligent-ui'

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
  },
  required: ['program'],
  additionalProperties: false,
} as const

/** Canonical output schema: the call's durable, lossless value. */
const OUTPUT = {
  type: 'object',
  properties: {
    statements: { type: 'number', description: 'Number of parsed openui-lang statements.' },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Non-fatal parser findings (unreferenced statements, unresolved references).',
    },
  },
  required: ['statements'],
  additionalProperties: false,
} as const

const parser = createParser((librarySpec as { readonly schema: unknown }).schema as never, 'Col')

interface ParseFinding {
  readonly message: string
  readonly fatal: boolean
}

/** Parse one complete program; returns model-readable findings plus statement count. */
function inspectProgram(program: string): { statements: number; findings: ParseFinding[] } {
  let result: ReturnType<typeof parser.parse>
  try {
    result = parser.parse(program)
  } catch (error) {
    return { statements: 0, findings: [{ message: error instanceof Error ? error.message : String(error), fatal: true }] }
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
  return { statements: meta.statementCount ?? 0, findings }
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
  inject?: SkillHostContext['inject']
  on?: (event: string, handler: (...args: never[]) => unknown) => unknown
  agents?: { list?: () => Iterable<unknown> }
}): void {
  // The switch decides whether the prompt section and the tool are visible.
  // A deployment without session projections/commands cannot persist a switch,
  // and `enabledFor` then reports legacy always-on.
  const mode = installModeControl(ctx as never)
  ctx.systemPrompt.section({
    name: 'tool:intelligent-ui',
    order: 3100,
    // Resolved per request: empty while the user keeps the switch off, so the
    // ~8.5k-token generation prompt costs nothing in a disabled session.
    text: (context) => {
      const sessionId = context?.agent?.session?.id
      return mode.enabledFor(sessionId) ? promptText : ''
    },
  })
  registerEmbeddedSkill(ctx)

  ctx.tools.register({
    name: RENDER_UI_TOOL,
    description:
      'Render an interactive answer as UI in the chat. Pass a complete openui-lang program that follows the '
      + 'Intelligent UI rules in the system prompt. Use it whenever a visual, interactive or working answer '
      + 'serves the user better than prose: itineraries, comparisons, dashboards, step-by-step guides, maps, '
      + 'drawings, forms, planners, games or calculators. The user sees the rendered page; do not repeat its '
      + 'content in prose. Call it at most once per turn, after any brief introductory sentence.',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT,
      render: (_args: unknown, value: { statements: number; warnings?: readonly string[] }) => [{
        type: 'text' as const,
        text: value.warnings === undefined || value.warnings.length === 0
          ? `Interactive UI rendered for the user (${value.statements} statements).`
          : `Interactive UI rendered for the user (${value.statements} statements). Parser notes: ${value.warnings.join('; ')}`,
      }],
    },
    async execute(args: { program: string }, exec?: { agent?: { session?: { id?: string } } }) {
      const sessionId = exec?.agent?.session?.id
      if (!mode.enabledFor(sessionId)) {
        throw new Error(
          'render_ui is disabled for this session. Turn on Intelligent UI with the composer switch or /iui on|session|global.',
        )
      }
      const program = typeof args.program === 'string' ? args.program.trim() : ''
      if (program === '') throw new Error('render_ui: program must be a non-empty openui-lang program.')
      const { statements, findings } = inspectProgram(program)
      const fatal = findings.filter(finding => finding.fatal)
      if (fatal.length > 0) {
        throw new Error(
          'render_ui: the program is not valid openui-lang and was not shown. Fix it and call render_ui again. '
          + fatal.map(finding => finding.message).join('; '),
        )
      }
      return { statements, ...findings.length === 0 ? {} : { warnings: findings.map(finding => finding.message) } }
    },
  })
}
