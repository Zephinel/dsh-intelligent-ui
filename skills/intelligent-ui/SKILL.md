---
name: intelligent-ui
description: "Render an interactive answer as UI in DSH: one complete OpenUI Lang program (maps, photos, charts, tables, forms, SVG drawings, games) shown as a turn-tail card. Use it for structured answers — itineraries, comparisons, dashboards, timelines, explainers, guides — when the session has Intelligent UI enabled; it is then the default format and prose is the bounded exception. If render_ui is missing, answer in prose."
whenToUse: "A visual, interactive or computed answer would serve better than prose — day plans, dashboards, comparisons, budgets, how-to drawings, forms, games, timelines, explainers — or the user asks to render, show, visualize or build a page, or invokes /intelligent-ui. Not for a single fact, a one-line reply, or a plain text/code answer."
---

# Intelligent UI

`render_ui` turns one OpenUI Lang program into an interactive card at the end of the turn. The program is not prose and not HTML: it declares named values and components, and the card evaluates them in the browser. In a session with Intelligent UI enabled, the plugin injects the complete language prompt (components, functions, syntax); this skill adds the decision boundary, the workflow, the design playbook and the deep reference that the prompt cannot fit.

## Before you start: is the session enabled?

The extension is opt-in; the host switch has three scopes — **Off**, **This session only**, **All sessions**. You cannot see the composer, so infer the state from the request:

- **`render_ui` is in your tools and the `tool:intelligent-ui` prompt section is present** → enabled. Continue; a page is the default answer format.
- **`render_ui` is absent** → off for this session, or the plugin/host services did not load. Answer in prose. If a page would genuinely serve better, say once that the user can pick **This session only** (仅本会话) or **All sessions** (全部会话) in the **UI** chip on the right side of the composer, or run `/iui session` / `/iui global`. Do not call `render_ui`, do not fake a card, and do not repeat the ask on later turns.
- **Explicit invocation is a directive:** the user invoked `/intelligent-ui`, or asked you to build the page with this skill → render; prose only when the user also asked for text or the tool is unavailable.

A deployment may also enable **Free composition** on the extension's Plugin detail page (Plugins → Intelligent UI). When the injected prompt says "Free composition is on for this deployment", the design playbook below is advisory rather than a template.

## Decide the format

The decision policy is owned by the injected `tool:intelligent-ui` prompt; this skill applies it. In an enabled session `render_ui` is the **default answer format** for any answer with structure: several facts, a timeline, stages, steps, options, numbers, a comparison, or something to explore — including introductions, explainers, overviews and guides about a topic.

Answer in Markdown only when the whole answer is:

- a single fact or one or two sentences;
- an explicit request for text, a document, Markdown, code or a plain answer;
- content that cannot be shown as a page (a safety warning, material that must be quoted verbatim);
- a fallback after two failed render attempts in the turn.

Two consequences matter in practice:

- **A knowledge or explainer topic is not a prose signal.** If the answer would have parts (eras, stages, factors, examples, dynasties, events), make the page — timeline, cards or an explorer — instead of a long text answer.
- **A page is never faked.** If the switch is off or the tool is missing, say so once and answer in prose; never simulate a card with HTML or a fenced block.

## Workflow

### 1. Choose the medium

Pick **one to three hero blocks** that carry the idea, then supporting blocks. Name them before writing: "map + timeline + checklist", "KPI row + trend + region donut + top-orders table". Completion: you can say what the page is for and which block answers the question, without writing any code yet.

Choosing rules of thumb:

| The idea is… | Use |
| --- | --- |
| numbers across time or categories | `Chart` (`line`/`area` for time, `bar` for categories, `pie`/`donut` for shares) |
| an exact comparison or detail list | `Table`, or label/value `Row`s in a `Card` |
| places and a route | `Map` + `MapMarker` (labels are the fallback list) |
| how something looks | `SearchImage` (exact 2–4 word subject), or `Image` for a URL you have |
| how something works or goes together | `Svg` drawings, one per step, with `SvgText` labels |
| a choice the user must make | `SegmentedControl` / `RadioGroup` / `Pressable` tiles / `Slider` |
| learning or a game | `Flashcard`, quiz with scoring, `Celebration`, `HtmlView` for a real animation loop |

### 2. Design the state model

List the `$` variables before writing: name, type, default, which control writes it, which block reads it. Completion: **every control has a visible consumer**, and every computed figure can be traced to a `$` variable or an inline data statement. A control with no visible effect is a dead input; remove it or connect it.

Keep the model small and explicit: 2–6 state variables is typical. Use ordinary statements for everything derived (`total = @Sum($items.amount)`) instead of storing derivations in state. When revising a page from an earlier turn, keep its `$` variable names and re-declare the values the user had chosen, so their inputs carry over.

### 3. Write the program in a stable order

1. `root = Col([...])` first, referencing block names that do not exist yet.
2. `$` declarations with literal defaults.
3. Component statements (blocks, cards, charts, controls).
4. Data statements last.

Completion: the program satisfies the hard rules below, and the pre-flight checklist passes. Prefer references for blocks and inline calls for leaves; keep each statement on one line.

### 4. Call the tool

Call `render_ui({ program: <the complete program>, title: "Short noun phrase" })`. The title is card chrome: 2–6 words, no trailing period ("Lisbon in three days", "Sales, last 90 days"). Before the call, at most one short Markdown sentence; after a successful call, stop or add one short sentence. Never paste the program into the reply, and never repeat the page's content in prose.

**The call is the preflight.** The tool validates the program, reports warnings, and never partially renders a rejected call; retry in the same turn instead of building a local harness. Keep the extension checkout read-only while answering — no scratch programs, tests, fixtures or build output anywhere under the plugin's source tree, including `test/renderer/.build/`; put drafts in a temporary directory outside the repository. Hard rule 11 carries the full version.

### 5. Handle the result

- **Success, no warnings** — done. The page is on screen; do not re-call.
- **Success, with warnings** — a name was unresolved or a statement was unreachable. Fix the program and call once more; the warnings name the exact statement.
- **Fatal error** — read every finding after the `render_ui:` prefix, fix all of them, and retry in the same turn. Two or three attempts are normal. If the same finding returns, re-read the program instead of rewording the message. If retries keep failing, drop the most complex block (Map, HtmlView, nested `@Each`), send a simpler page, and say so in one sentence.
- **Tool missing** — follow [Before you start](#before-you-start-is-the-session-enabled): answer in prose, and point at [integration.md](references/integration.md#troubleshooting-a-missing-render_ui) if the user is setting it up.

## Hard rules (OpenUI Lang)

1. One program, one statement per line: `name = expression`. It starts with `root`; `root` must evaluate to a component, conventionally `Col`.
2. Arguments are **positional**. Omit optional arguments from the end; skip a middle one with `null`. Named syntax (`children: [...]`) is rejected.
3. Every referenced name is declared, and every non-root statement is reachable from `root`. Violations are warnings that silently drop content.
4. Use only the shipped vocabulary: 55 components, 14 core + 59 library `@functions`, 5 action steps — exact names, case-sensitive. Do not invent `@If`, `@Map`, `@Length` or components.
5. `$` state is declared with literal defaults. Inputs bind their first argument to a `$` variable; only actions mutate state (`@Set`, `@Reset`).
6. No control flow: `cond ? a : b` picks values or components, `null` hides a block, `@Each` repeats. No user-defined functions, no string interpolation — concatenate with `+`.
7. `@Each(array, "x", template)`: the loop variable exists only inside the template. Inline the template.
8. Money, percentages, counts and dates shown as text use `@Format` / `@Plural` / `@FormatDate`; relative dates start from `@Today()`, and dates are ordered with `@DaysBetween(a, b) > 0`.
9. The program is complete: no `...`, no TODO, no placeholder comments.
10. One page per turn: a rejected call may be retried; a successful one must not be followed by a second `render_ui` call in the same turn.
11. **Keep the extension checkout read-only while answering.** Never add scratch programs, tests, fixtures or build output under the skill base directory or the plugin's source tree (including `test/renderer/.build/`) to test a program. `render_ui` is the preflight; save drafts in a temporary directory outside the repository. Only an explicit request to develop the extension lifts this rule.

Exact signatures, argument order, enums and function list: [references/components.md](references/components.md). Syntax, state and wrong-vs-right snippets: [references/language.md](references/language.md).

## Design playbook

**Free composition.** When the injected prompt says "Free composition is on for this deployment", this playbook is advisory, not a template: choose the page shape and blocks the content needs, and vary them between answers. The hard rules above and the theme/readability guidance below still apply.

- **Compose a page, not a form letter.** A `Title` (`xl`/`2xl`), one short `Text`, then 2–4 mixed blocks. Group related blocks in `Card`s; do not wrap the whole page in one card.
- **Spacing is a system.** `gap`/`padding` count 4px steps: inner 1–2, group 3–4, section 5–6. Leave `gap` unset on the page root and on card contents (the app applies the article rhythm); set a gap on `Row`/`Grid` only.
- **Cards stay compact.** Card title `md`/`sm`; inside a `Card` the display sizes are capped (`lg` 18 → `xl` 22 → `2xl` 26 → `3xl` 30px), so `xl` is for one KPI number, never for the card heading. Body `sm`, at most one short paragraph, then facts as `Badge`s or label/value rows. Cards side by side in a `Grid` carry the same blocks in the same order so they line up.
- **Media rows beat walls of text.** A photo beside copy: `Row([Box([SearchImage("Sonoma Plaza", 1.33)], null, null, null, null, "lg", null, 120), Col([Title("Sonoma", "md"), Row([Badge("1 h drive", null, "car"), Badge("Wine country", "purple")], 1, null, null, true), Text("A slow plaza and quiet back roads.", "sm")], 2)], 4, "start")`. Give the image box an explicit width so the row is stable; top-align the text.
- **SearchImage for every thing with a look** — place, dish, product, animal, building. Name the exact subject (`"Belém Tower Lisbon"`, not `"Europe trip"`). A photo shows what a thing looks like; `Svg` shows how it works, so how-to answers often need drawings even when photos are present.
- **Draw with `Svg` whenever the user would otherwise picture it.** One drawing per step, viewBox around 240 wide, a dozen shapes in tokens, `SvgText` labels, a `Line` + small `Polygon` for arrows. Drive it from `$step` and offer a thumbnail strip.
- **Make it work on its own.** Every control changes what is rendered; every list, budget or total is computed from state or inline data with `@functions`; nothing waits for another message. `@ToAssistant` is only for what the page cannot compute (form submit, "plan another day").
- **Guard arithmetic.** Number inputs are empty or zero: read them as `@Clamp(@Default($people, 1), 1, 50)` and guard divisions with a `$n > 0 ? … : 1` ternary. `@Avg` of an empty list is `0`.
- **Format for humans.** `@Format(value, "currency", 0, "USD")`, `@Format(value, "percent", 1)`, `@Plural(n, "guest")`, `@FormatDate(date, "long")`. Units belong in the label or unit argument, not in the number.
- **Data stays inline and modest.** A few dozen rows in a literal array is fine; summarize with `@GroupBy`/`@Bucket` and show the top rows in a `Table`. Typical page: 20–80 statements; past ~120, cut blocks rather than shrink everything.
- **Theme with tokens.** `Color` tokens and CSS colors adapt to DSH dark/light automatically. Use raw hexes only for illustration (`Svg` fills, heatmap scales via `@MixColor`), and make sure text stays readable in both themes.

## DSH specifics

- **The card is turn-tail.** It appears after the turn ends; during generation the process area shows one `Interactive answer` row (「交互式回答」 in a Chinese UI). Do not describe the card as if it were streaming; write the intro sentence as if the page appears at the end.
- **Title and collapse are chrome.** The card header shows `title`; when it is omitted the localized default is used ("Interactive answer" in English, 「交互式回答」 in Chinese). The card can be collapsed by the user; the program cannot control that. The rendered card is full-width in the chat column and narrow on mobile — use `Grid` with `minChildWidth`, `Row` with `wrap`, and avoid fixed widths over ~600px.
- **Dark/light is automatic.** Tokens, components and the `HtmlView` document's `color-scheme` follow the host theme. Do not hardcode white backgrounds or black text.
- **`HtmlView` is the only escape hatch** for arbitrary HTML/CSS/JS: canvas games, physics toys, custom animations. It runs in a sandboxed iframe with an opaque origin, no access to the page or its storage, and network limited to script/style/font CDNs and https images. Use it only when components plus `Svg` cannot express the idea, and keep the whole game in one string; it cannot share state with the page.
- **`@ToAssistant` starts a new turn.** In this deployment only the message string is forwarded — the optional `context` object is not delivered — so compose needed values into the message: `@ToAssistant("Plan for " + $people + " people on " + $date)`. Keep it short and first-person, and never use it for something the page can already compute.

## Pitfalls that account for most failures

1. **Named arguments / extra arguments** — `Col(children: [...])` or one argument too many. Positional, optional from the end.
2. **`@Each` template extracted into a statement** — the loop variable is undefined there; the page renders empty rows. Inline the template.
3. **Dead controls** — a Slider or Input bound to a `$` variable nothing reads. Connect it or remove it.
4. **Ignored warnings** — unresolved names null out content; unreachable statements never render. Fix them even when the tool "succeeds". Re-read the program with the warning's name in hand.
5. **Mismatched chart keys** — `Chart` gets rows whose `x` key or `series` keys do not exist, or `@GroupBy` rows fed with the wrong key names. Grouped/bucketed rows use `key` and `value`.
6. **Swapped map coordinates** — `MapMarker(label, lat, lng)`. Latitude is ~31 for Shanghai, ~37.8 for San Francisco; longitude is ~121 or ~-122.
7. **Dates compared with `<`** — comparisons are numeric; use `@DaysBetween`.
8. **Numbers where strings are required** — `Title($n)` fails; write `$n + ""` or `@Format`.
9. **Too much page** — more than four block types, lg+ titles inside cards, or a wall of prose in a card. Choose fewer, bigger ideas.
10. **Program pasted into prose** — the tool carries the program; the reply stays a sentence.
11. **Preflighting by editing the plugin** — a scratch harness written into the extension checkout shows the user a spurious file diff in a repository you were not asked to change. Call `render_ui` and use its findings; keep drafts outside the tree.

## Pre-flight checklist

Before the call, verify:

1. `root` is first and is a component call.
2. Every name is defined; every statement is reachable; no warnings expected.
3. Every `$` binding is declared and every control has a visible consumer.
4. Component names, argument order, optional-argument `null`s and enum values match the reference.
5. Values are derived with `@functions`, formatted for display, and safe against empty/zero input.
6. The program is complete and self-running: no placeholders, no dependence on a follow-up message.
7. No file was created or edited outside the requested deliverable — in particular, nothing in the extension checkout was touched to test the program.
8. The reply around the call is one intro sentence and, after success, at most one closing sentence.

## Reference index

Read these when the task needs more than the injected prompt:

| File | Read it when |
| --- | --- |
| [references/components.md](references/components.md) | You need an exact signature, default, enum, optional argument position, or the full list of 55 components, 73 functions and 5 action steps. |
| [references/language.md](references/language.md) | You are unsure about syntax, hoisting, `$` state, actions, `@Each`, comments, coercion, or want wrong-vs-right snippets. |
| [references/examples.md](references/examples.md) | You want a complete validated program to adapt: itinerary, calculator, SVG tutorial, dashboard, form, quiz + HtmlView game. |
| [references/troubleshooting.md](references/troubleshooting.md) | A call failed, the result carried warnings, the card rendered wrong, or media/map/HtmlView degraded. Contains the verbatim host error strings and the retry loop. |
| [references/integration.md](references/integration.md) | The user is installing or adopting the extension, `render_ui` is missing, the skill is missing from the catalog, or you need the tool contract and limits. |

The references are part of this skill bundle; read them from the skill's base directory (the loaders state it explicitly) and resolve links relative to it.
