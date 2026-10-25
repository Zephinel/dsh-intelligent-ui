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
 * The decision policy and the layout/spacing contract are owned here: this
 * section is injected only when the switch admits the session, so an enabled
 * session defaults to a page and the prose exceptions are deliberately bounded
 * (single fact, explicit text request, non-visual content, two failed calls). The Agent Skill points at this
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

// The vendored component doc and page-composition bullet still invite a photo
// per list item. Photos are page-level feature media here: a photo in a
// repeated row becomes a tall media row and its search can come back empty.
const photoDocLine = 'Use one for every place, dish, product or thing with a look.'
const photoDocReplacement = 'Use one for a place, dish, product or thing with a look; treat it as feature media, not one photo per list row.'
const photoBulletLine = 'SearchImage for every place, dish, product or thing that has a look (the app finds the photo, so never say you cannot show photos);'
const photoBulletReplacement = 'SearchImage for a place, dish, product or thing that has a look, as feature media rather than one photo per list row (the app finds the photo, so never say you cannot show photos);'
if (!rewritten.includes(photoDocLine)) {
  throw new Error('generate-prompt: the vendored SearchImage description changed; update the rewrite.')
}
if (!rewritten.includes(photoBulletLine)) {
  throw new Error('generate-prompt: the vendored SearchImage composition bullet changed; update the rewrite.')
}
const withPhotos = rewritten.replace(photoDocLine, photoDocReplacement).replace(photoBulletLine, photoBulletReplacement)

// The Host forwards only the @ToAssistant message text: the action event's
// formState and context are dropped before the composer draft is submitted, so
// the vendored prompt must not promise "hidden data" or that "the form values
// travel with it". Every line that makes that promise is rewritten here; the
// guard fails the build when a re-vendored prompt changes the text underneath.
const forwardingRewrites = [
  {
    label: 'Form description',
    from: 'Form(children: Node[]) — Groups fields; their values go with any @ToAssistant inside.',
    to: "Form(children: Node[]) — Groups fields; only a Button's @ToAssistant message text is forwarded, so write the values it needs into that message.",
  },
  {
    label: 'input composition bullet',
    from: '- Every input either changes something shown on the page, or sits in a Form whose submit Button sends a short first-person @ToAssistant ("Help me choose a bike"); the form values go with it. No dead inputs.',
    to: '- Every input either changes something shown on the page, or sits in a Form whose submit Button sends a short first-person @ToAssistant ("Help me choose a bike"); only that message text is forwarded, so write the values it needs into the message. No dead inputs.',
  },
  {
    label: '@ToAssistant action description',
    from: '- @ToAssistant(message: string, context?: any) — Send a message to the assistant (for conversational buttons like "Tell me more", "Explain this"). The optional context is any value (object, array, string, number) passed to the assistant as hidden data, e.g. @ToAssistant("Show details", {orderId: 42})',
    to: '- @ToAssistant(message: string, context?: any) — Send a message to the assistant (for conversational buttons like "Tell me more", "Explain this"). Only the message text is forwarded; the optional context is accepted but not delivered, so compose the values into the message, e.g. @ToAssistant("Show details for order 42")',
  },
  {
    label: '@ToAssistant usage bullet',
    from: '- Use @ToAssistant only for what the page cannot compute: a Form\'s submit Button, or a new request ("Plan another day"). Its message is short and first person, like the user typing it ("Help me choose a bike"); the form values travel with it, so never repeat them in the message.',
    to: '- Use @ToAssistant only for what the page cannot compute: a Form\'s submit Button, or a new request ("Plan another day"). Its message is short and first person, like the user typing it ("Help me choose a bike"); only the message text is forwarded, so put the values it needs into the message itself.',
  },
  {
    label: 'carry-over bullet',
    from: '- To change a page from an earlier answer, keep its $variable names and start them from that answer\'s "context and form values", so what the user typed, added or ticked carries over.',
    to: '- To change a page from an earlier answer, keep its $variable names and start them from the values the earlier @ToAssistant message carried, so what the user typed, added or ticked carries over.',
  },
]
let withForwarding = withPhotos
for (const { label, from, to } of forwardingRewrites) {
  if (!withForwarding.includes(from)) throw new Error(`generate-prompt: the vendored ${label} changed; update the rewrite.`)
  withForwarding = withForwarding.replace(from, to)
}

// Example 2 must follow this prompt's own layout contract: a hand-built list of
// Rows leaves its Col gap unset, instead of the old gap 5.
const exampleTwoLine = 'days = Col(@Each(plan, "d", Row([Box([SearchImage(d.place, 1, "lg")], null, null, null, null, null, null, 96), Col([Text([Icon("map-pin", "sm"), " Day " + d.day + " · " + d.title], "md", null, "semibold"), Text(d.text, "sm", "muted")], 1)], 4, "start")), 5)'
const exampleTwoReplacement = 'days = Col(@Each(plan, "d", Row([Box([SearchImage(d.place, 1, "lg")], null, null, null, null, null, null, 96), Col([Text([Icon("map-pin", "sm"), " Day " + d.day + " · " + d.title], "md", null, "semibold"), Text(d.text, "sm", "muted")], 1)], 4, "start")))'
if (!withForwarding.includes(exampleTwoLine)) throw new Error('generate-prompt: the vendored Example 2 day-list line changed; update the rewrite.')
const withExampleTwo = withForwarding.replace(exampleTwoLine, exampleTwoReplacement)

// The HtmlView sandbox is not script-CDN-only: its CSP also loads style/font
// CDNs and any https image, while fetch/XHR/WebSocket stay on the script CDNs.
const htmlViewLine = 'HtmlView(html: string, height?: number, title?: string) — Sandboxed HTML page with inline JS, for games and canvas. No network except script CDNs. Fits its content unless height is set.'
const htmlViewReplacement = 'HtmlView(html: string, height?: number, title?: string) — Sandboxed HTML page with inline JS, for games and canvas. Its CSP allows inline code, script/style/font CDNs and https images; fetch, XHR and WebSocket reach only those CDN hosts. Fits its content unless height is set.'
if (!withExampleTwo.includes(htmlViewLine)) throw new Error('generate-prompt: the vendored HtmlView description changed; update the rewrite.')
const withFacts = withExampleTwo.replace(htmlViewLine, htmlViewReplacement)

// Behavior docs that changed with the component batch: the Length grammar
// accepts safe CSS length functions and a wider unit set, canvas/on-ink joined
// the background-only token guard, and a number Input accepts a decimal comma.
// Rewrite the injected token/component docs so they match the renderer.
const behaviorRewrites = [
  {
    label: 'Length token grammar',
    from: 'Length is px or a CSS length like "50%".',
    to: 'Length is a px number or a safe CSS length: px, %, em, rem, vh, vw, vmin, vmax, ch, ex, pt, pc, cm, mm, in, and calc()/min()/max()/clamp() built from them (e.g. "calc(100% - 32px)"); var(), url(), attr() and env() are rejected.',
  },
  {
    label: 'Color token background-only rule',
    from: '"surface", "surface-strong" and "border" are surface/paint tokens: use them as backgrounds or SVG fills, never as text, caption or icon colors (they are washes and would disappear).',
    to: '"surface", "surface-strong", "border", "canvas" and "on-ink" are background/paint tokens: use them as backgrounds or SVG fills; as text, caption or icon colors they are ignored and the theme ink is used instead (they would disappear).',
  },
  {
    label: 'number Input description',
    from: 'Input(value: $binding<string | number>, label?: string, type?: "text" | "number", placeholder?: string) — Text or number field; a number field stores numbers.',
    to: 'Input(value: $binding<string | number>, label?: string, type?: "text" | "number", placeholder?: string) — Text or number field; a number field stores numbers. A decimal comma is accepted ("1,5" is 1.5); other commas group digits ("1,000" is 1000).',
  },
]
let withBehavior = withFacts
for (const { label, from, to } of behaviorRewrites) {
  if (!withBehavior.includes(from)) throw new Error(`generate-prompt: the vendored ${label} changed; update the rewrite.`)
  withBehavior = withBehavior.replace(from, to)
}

/** Layout and spacing contract: the renderer owns the rhythm, the model owns the block sequence. */
const layoutContract = [
  '## Layout and spacing contract',
  '',
  'The renderer owns the vertical rhythm. Card/Article pages use one readable column. For an authorized free-layout result or selected free template, page shape and typography guidance is advisory: compose the user-requested layout, ask if materially unclear, and keep language, theme and safety rules.',
  '',
  '- Leave `gap` unset on the page root `Col`, on the children of a `Section`, and on `Card` contents. The renderer already applies section/group spacing; an explicit gap there overrides it or doubles the blank space.',
  '- Use an explicit `gap` only on `Row`, `Grid`, `Carousel`, a list `Col` (2–3), and small compact control stacks: 1–2 for inner pairs, 3–4 for grouped blocks (4px steps). Do not use a gap of 5–6 on a nested `Col` to imitate page spacing.',
  '- Never create vertical space with `Spacer()`, an empty `Box`/`Col`/`Card`, empty `Text`/`Markdown`, or a `Divider` used as a blank. Group related blocks in a `Card` or let the flow space them.',
  '- A `Section` body is a sequence of blocks: prose (`Markdown`/`Text`) first, then at most a couple of supplemental blocks (`Grid`, `Table`, `Chart`, `Code`, `Quote`). Do not wrap the whole body in a `Col` with a manual gap.',
  '- For Card/Article pages, keep one page measure; do not put a whole page side by side. Use `Grid` only for genuinely parallel blocks. Free result and template layouts may compose parallel page regions as requested.',
  '- Photos are page-level media, not list furniture: a `Row` gives a photo a 120–200px media slot when the program leaves the size to the renderer, so repeated lists and rankings use `Table` or `List`. When a row genuinely needs a thumbnail, wrap it in a `Box` with an explicit `width` and pass `SearchImage(..., aspectRatio)`.',
  '- Use only a few feature photos per page (roughly one to three): every `SearchImage` is a network lookup that can fall back to an empty placeholder for a niche, non-English or not-yet-documented subject, so do not attach one to every row of a list.',
  '- A hand-built list of `Row`s is page rhythm, not an inner pair: leave the list `Col` gap unset (the 12px flow rhythm) or use 2–3, never 1; center-align a row whose photo is taller than its copy (`Row(..., 2, "center")`); and give the rank a fixed-width slot (`Box([Text(m.r + "", ...)], ..., 26)`) so 9 and 10 line up. Rankings are still clearest as `Table` or `List`.',
].join('\n')

const withLayout = withBehavior.replace('\n## Important Rules\n', `\n${layoutContract}\n\n## Important Rules\n`)
if (!withLayout.includes(layoutContract)) throw new Error('generate-prompt: could not place the layout contract before Important Rules')

const toolResponseLine = `

After a successful \`render_ui\` call the page is already on screen: the closing Markdown reply, when present, is one short sentence only.`

await mkdir(dirname(target), { recursive: true })
await writeFile(target, `${preamble}${withLayout.trimEnd()}${toolResponseLine}\n`, 'utf8')
console.log(`generate-prompt: wrote ${target}`)
