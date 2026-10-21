#!/usr/bin/env node
/**
 * Generate the system-prompt section the Host half ships.
 *
 * The base text is Open Intelligent UI's own generated openui-lang prompt
 * (vendored under vendor/system-prompt.txt because it is generated from the
 * same component library the browser renders). This script only rewrites the
 * framing: that project answers with openui-lang directly, while in DSH the
 * program travels inside the `render_ui` tool call, so the model must be told
 * when to call it and that the normal Markdown reply stays available.
 *
 * The decision policy is owned here, in one place: this section is injected only
 * when the switch admits the session, so an enabled session defaults to a page
 * and the prose exceptions are deliberately bounded (single fact, explicit text
 * request, non-visual content, two failed calls). The Agent Skill points at this
 * policy instead of restating it, so the model cannot find a second opinion.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(resolve(root, 'vendor/system-prompt.txt'), 'utf8')
const target = resolve(root, 'src/generated/prompt.txt')

const directResponseLine =
  'You are an AI assistant that responds using openui-lang, a declarative UI language. Your ENTIRE response must be valid openui-lang code — no markdown, no explanations, just openui-lang.'
if (!source.startsWith(directResponseLine)) {
  throw new Error('generate-prompt: vendor/system-prompt.txt no longer starts with the expected preamble; update the rewrite.')
}

const preamble = `You are an AI assistant that can answer with an interactive UI written in openui-lang, a declarative UI language.

## The render_ui tool
The UI travels inside a tool call, not in your Markdown reply:
- Call \`render_ui\` with \`program\` set to one complete openui-lang program. The program must be valid openui-lang code — no markdown, no explanations, no surrounding prose.
- This prompt is present only when Intelligent UI is enabled for the session, so in this session a \`render_ui\` page is the default answer format. Call it whenever the answer has structure — several facts, a timeline, stages, steps, options, numbers, a comparison, or something to explore — including introductions, explainers, overviews and guides about a topic. Do not fall back to Markdown just because the topic is knowledge or an explanation.
- Answer in Markdown only when one of these is true: (1) the whole answer is a single fact or at most one or two sentences; (2) the user explicitly asks for text, a document, Markdown, code or a plain answer; (3) the content cannot be shown as a page, for example a safety warning or a passage that must be quoted verbatim; (4) \`render_ui\` failed twice in this turn — then fall back to text and say so.
- If the user explicitly invokes the \`intelligent-ui\` skill (\`/intelligent-ui\`) or asks you to build the page with it, that is a direct instruction: answer with \`render_ui\`. Prose is allowed only when the user also asked for text or the tool is unavailable.
- You may write at most one short introductory sentence in Markdown before calling the tool. After the successful call, stop or add one short sentence; never repeat the page's content in prose, and never paste the openui-lang program into your Markdown reply.
- If the tool reports a parse error, fix the program and call \`render_ui\` again in the same turn.
- The call is the only preflight you need: a rejected program is never shown, and the findings name the exact problem. Do not build a local harness, and do not create, edit or delete files in the Intelligent UI extension's own checkout (including its \`test/renderer/.build/\`) to test a program; keep any draft in a temporary directory outside the repository. Editing the extension itself is a separate task the user has to ask for explicitly.
- One successful call per turn; a rejected call may be retried. A successful call must not be followed by a second \`render_ui\` call in the same turn.

The program itself follows every rule below.`

/** The vendored prompt's prose-biased rule, rewritten to match the enabled-session policy. */
const knowledgeLine =
  '- Answer a plain knowledge or safety question with Markdown text, adding a SearchImage or a Quote only where it helps.'
const knowledgeReplacement =
  '- Answer a safety warning, or a question whose whole answer is one fact or one sentence, in Markdown text directly; do not build a page around a single sentence.'

const rest = source.slice(directResponseLine.length)
if (!rest.includes(knowledgeLine)) {
  throw new Error('generate-prompt: the vendored knowledge-question rule changed; update the rewrite.')
}
const rewritten = rest.replace(knowledgeLine, knowledgeReplacement)

const toolResponseLine = `

After a successful \`render_ui\` call the page is already on screen: the closing Markdown reply, when present, is one short sentence only.`

await mkdir(dirname(target), { recursive: true })
await writeFile(target, `${preamble}${rewritten.trimEnd()}${toolResponseLine}\n`, 'utf8')
console.log(`generate-prompt: wrote ${target}`)
