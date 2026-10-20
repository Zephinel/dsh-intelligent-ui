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
- Use it whenever a visual, interactive or working answer serves the user better than prose: day plans and itineraries, comparisons, dashboards over numbers the user gave you, step-by-step guides with drawings, maps and routes, forms and planners, games, quizzes, calculators and anything the user would otherwise have to picture or compute.
- You may write at most one short introductory sentence in Markdown before calling the tool. After the successful call, stop or add one short sentence; never repeat the page's content in prose, and never paste the openui-lang program into your Markdown reply.
- If the tool reports a parse error, fix the program and call \`render_ui\` again in the same turn.
- The call is the only preflight you need: a rejected program is never shown, and the findings name the exact problem. Do not build a local harness, and do not create, edit or delete files in the Intelligent UI extension's own checkout (including its \`test/renderer/.build/\`) to test a program; keep any draft in a temporary directory outside the repository. Editing the extension itself is a separate task the user has to ask for explicitly.
- For ordinary questions where a page adds nothing (a fact, a definition, a short explanation), answer in Markdown as usual and do not call the tool.

The program itself follows every rule below.`

const rest = source.slice(directResponseLine.length)
const toolResponseLine = `

After a successful \`render_ui\` call the page is already on screen: the closing Markdown reply, when present, is one short sentence only.`

await mkdir(dirname(target), { recursive: true })
await writeFile(target, `${preamble}${rest.trimEnd()}${toolResponseLine}\n`, 'utf8')
console.log(`generate-prompt: wrote ${target}`)
