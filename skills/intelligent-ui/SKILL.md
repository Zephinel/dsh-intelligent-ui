---
name: intelligent-ui
description: "Answer with UI in DSH: explanations stay Markdown with a complete OpenUI Lang program inside an `openui` fence where a visual or interaction helps; call `render_ui` for a standalone interactive page/dashboard/tool/form/game/editable result, or alongside inline UI when both roles differ. Use for structured answers when Intelligent UI is on; the model decides the delivery form per answer and loads this skill only when it renders UI. If render_ui is missing, answer in prose."
whenToUse: "A visual, interactive or computed answer would serve better than prose — day plans, dashboards, comparisons, budgets, how-to drawings, forms, games, timelines, explainers — or the user asks to render, show, visualize or build a page, or invokes /intelligent-ui. Not for a bare fact, a term restatement, a one-line factual reply, or a plain text/code answer."
---

# Intelligent UI

An answer can take four delivery forms: plain Markdown, inline UI, one standalone page artifact, or an inline explanation plus one page artifact. Inline programs live in a fenced `openui` block (rendered in place); a standalone page lives in a `render_ui` call (rendered at the end of the turn). In an enabled session the plugin injects the full OpenUI Lang prompt (components, functions, syntax); this skill adds the workflow, composition rules, and focused references.

## Before you start: is the session enabled?

The extension is opt-in (Plugin detail page sets global defaults; the composer **UI** chip overrides enablement and style per session). Infer state from the request:

- **`render_ui` is in your tools and `tool:intelligent-ui` is present** → enabled. Choose among the four delivery forms.
- **`render_ui` is absent** → off for this session or host services did not load. Answer in prose. If UI would genuinely help, say once that the user can pick **This session only** (仅本会话) in the composer **UI** chip, run `/iui on`, or enable globally on the Plugin detail page. Never fake a card or repeat the ask.
- **Explicit invocation is a directive:** when the user invokes `/intelligent-ui` or explicitly asks for a page, dashboard, card, tool or UI, use this skill — inline UI for an explanation, `render_ui` for a standalone deliverable, or both when the request has both jobs; prose only if the user also asked for text or the tool is unavailable.

When the injected prompt says "Free-form layout is on for this deployment", the design playbook below is advisory rather than a template.

## Decide the delivery form

The decision policy is owned by the injected `tool:intelligent-ui` prompt; this skill applies it rather than restating it. Choose one of four forms per answer:

- **Inline UI — the normal form for explanations.** Keep the answer in Markdown; wherever a visual or interactive block helps, place one complete program in a fenced code block whose info string is exactly `openui`. No `render_ui` call needed.
- **A standalone page artifact — for a deliverable.** Call `render_ui` once when the user asks for a standalone page, dashboard, tool, form, game or editable result, or invokes the skill for that deliverable.
- **Both forms — when the answer has two distinct jobs.** Keep the explanation in Markdown with inline fences and call `render_ui` once for a separate usable page; never duplicate the same content in both.
- **Plain text.** When no UI helps, answer in Markdown and stop.

Prefer the simplest form. Every ordinary session style (Auto, Card, Article, or a saved template) still allows all four delivery forms; the session style only sets the layout when you call `render_ui` (Card/Article/template pin that layout; Auto lets you choose Card, Article, or free). At most one page artifact per answer; never fake a page with HTML.

## Inline UI in ordinary answers

Ordinary explanations use Markdown with inline UI by default (no separate inline switch; already-written fences keep rendering even if the session switch is later turned off). Place each **complete** program (`root = …`) in a fenced code block whose info string is exactly `openui`:

- **Only open a fence when UI beats Markdown.** Use inline UI for interactive controls/calculators, SVG mechanism diagrams, charts, maps, visual flows, or checkable lists. Keep a plain static comparison table or simple bullet list in regular Markdown.
- **Keep inline blocks compact and shell-less.** The inline surface already frames the block, so **do not wrap the root in an outer `Card`**; use `sm` or `md` titles instead of `2xl`/`3xl` hero headings; aim for ~3–18 statements.
- **Multi-fence isolation & theme.** You may place multiple `openui` fences in one answer, keeping prose outside them. Each fence renders in its own isolated scope — `$` state and data declarations are not shared across fences — and inline blocks follow the chat theme rather than a saved custom template theme.
- **No Host preflight.** While streaming, a fence stays a plain code block; once settled it renders in place. Fatal failures show a fallback note; partial drops keep the usable block with a compact warning. Keep inline programs focused and flat rather than large experimental compositions. Inline blocks keep component interaction and `@ToAssistant` follow-ups, but have no card editing, revision history, template saving, or export; their source stays in the message text.

Example (compact shell-less inline timeline — use `List(..., true)` instead of inventing a `Timeline` component):

````markdown
```openui
root = Col([Title("Request lifecycle", "md"), steps])
steps = List([ListItem("Route", "Match session & policy", "1"), ListItem("Stream", "Emit Markdown and openui fences", "2"), ListItem("Settle", "Render inline blocks in place", "3")], "none", true)
```
````

More validated interactive inline examples (SVG stepper, interactive calculator): [references/examples.md](references/examples.md).

## Answer styles (for standalone `render_ui` pages)

When you render a standalone page artifact, follow the effective session style from the injected prompt (inline fences ignore the session style):

- **Card** — compact, scannable interactive page. Keep sections tight; do not turn a broad request into a long article.
- **Article** — article-first reading page inside the card: a short coverage summary, a reachable `Toc`, and collapsible `Section` blocks with substantial `Markdown` prose (specific facts, causes, examples or debates — never a skeleton or "tell me which part to expand"). The Host rejects an article call without both `Toc` and `Section`. Keep `Section` anchors unique (`Section(title, children, anchor?)` + `Toc(items, anchors?)`).
- **Free template** — when the session selects a template with `baseLayout: "free"`, compose the user-requested layout without a Card/Article shell. `Toc` and `Section` are optional; pass `style: "free"` plus the exact selected `styleId`, without `temporaryStyle`. The renderer applies the template theme and retains the DSH card header.
- **Auto** — choose among all four delivery forms (plain text, inline UI, one page artifact, or inline explanation + one page artifact); when rendering a page artifact, pick **Card** for compact interactive pages, **Article** for 详尽/深入/全面/长文/报告/综述 answers, or **free** when neither shell fits (`Toc` and `Section` optional).
- **Document (experimental)** — see next section.

## Document mode (experimental)

A deployment may enable **document mode** (Plugin detail page → Experimental). When the injected `tool:intelligent-ui` prompt opens with the document contract:

- For an ordinary answer that benefits from a page, write the **whole answer** as one complete program (prose, headings, tables, code and interactive/visual blocks in reading order).
- Pass `style: "free"`, omit `styleId` and `temporaryStyle`, call `render_ui` once, and **stop** — write no Markdown outside the call and do not use inline `openui` fences. If no page serves the answer, answer in plain Markdown.
- The client renders it without card chrome (still a turn-tail result: copy/search/transcript export omit it, and there is no editing or revision history).
- For ordinary answers, document mode overrides the session's answer style (including any selected saved template). On-demand results and Artifact edit requests keep their own recorded card contract and layout.

## Conditional workflows (read the linked reference when triggered)

### On-demand generation and custom templates
Triggered when the prompt carries an `ON-DEMAND UI` note or a selected custom style template (`styleId`). Ground missing content with `ask_user_question` first, compose the user-requested layout directly (`If the layout is materially unclear, ask one focused layout question`), pass `style: "free"` + complete `temporaryStyle` (omitting `styleId`) for new on-demand generation, and do not use inline `openui` fences in a bound on-demand turn. Read **[references/on-demand.md](references/on-demand.md)** for the full snapshot schema, theme contrast rules, clarification loop, and adjustment/template contracts.

### Artifact block edits
Triggered when the latest user message carries one or more `<artifact-edit-request>` envelopes. Route targeted block content edits and nested `additions` to `edit_ui_blocks` (mini program `root = Col([...])` with only the target expressions in request order — never rewrite the full page); route order-only, global-only, nested `orderByParent`, and `kind: "style"` requests to `render_ui` (with `editRequestId`). Read **[references/artifact-editing.md](references/artifact-editing.md)** for exact rules on nested blocks, strict mode, multi-artifact batches, and recorded styles.

## Workflow (standalone `render_ui` pages)

1. **Outline & choose the medium.** For Article, outline every major part and its concrete facts/examples first. For Card, pick 1–3 hero blocks (`Chart` for trends/categories, `Table` for exact comparisons, `Map`+`MapMarker` for places/routes, `SearchImage`/`Image` for visuals, `Svg` for mechanisms, `SegmentedControl`/`Slider`/`Pressable` for choices, `Flashcard`/`HtmlView` for learning/games).
2. **Design the state model.** List 2–6 `$` variables with literal defaults; every control must have a visible consumer, and derived values belong in ordinary statements (`total = @Sum(...)`), never `$` state. When revising an earlier page, keep its `$` names and re-seed chosen values.
3. **Write in stable order.** `root = Col([...])` first → `$` declarations → component statements → data statements last. One statement per line.
4. **Call the tool.** Call `render_ui({ program: <the complete program>, style: <"card"|"article"|"free">, title: "Short noun phrase" })`. Add `styleId` (without `temporaryStyle`) for a selected saved template, or `temporaryStyle` for a bound on-demand turn. When the page is the whole answer, write at most one short intro sentence before the call and at most one short closing sentence after; when it accompanies an inline explanation, write the Markdown explanation and its `openui` fences first without duplicating page content. Never paste the `render_ui` program into prose.
   - **The call is the preflight.** It validates the program and never partially renders a rejected call; fix fatal findings and retry at most twice in the same turn, then fall back to text. Keep the extension checkout read-only while answering (never write drafts or build output into the plugin's tree, including `test/renderer/.build/`; use a temporary directory outside the repository). Hard rule 12 carries the full version.
5. **Handle the result.**
   - **Success (no warnings):** done; do not re-call.
   - **Success (with warnings):** page is already on screen; do not re-call in the same turn. Mention significant dropped content briefly for a follow-up (for further style changes on a temporary result, the user can open the card's Edit canvas under **Style → Change style**, or re-arm Adjust style on older Hosts).
   - **Render-time component crash:** contained to that subtree (`render_ui` still reports success); when the user reports a blank area, simplify that block on the next turn.
   - **Fatal error:** read every finding after `render_ui:`, fix all of them, and retry at most twice; if still failing, fall back to text and say so.
   - **Tool missing:** answer in prose and see [references/integration.md](references/integration.md#troubleshooting-a-missing-render_ui).

## Hard rules (OpenUI Lang)

1. One program, one statement per line: `name = expression`. Starts with `root`, which must evaluate to a component (conventionally `Col`).
2. Arguments are **positional**. Omit optional arguments from the end; skip middle ones with `null`. Named syntax (`children: [...]`) is rejected.
3. Every referenced name is declared, and every non-root statement is reachable from `root`.
4. Use only the shipped vocabulary: 57 components, 14 core + 59 library `@functions`, 5 action steps — exact names, case-sensitive. Never invent `@If`, `@Map`, `@Length`, or components.
5. `$` state is declared with literal defaults. Inputs bind their first argument to `$var`; only actions (`@Set`, `@Reset`) mutate state.
6. No control flow: `cond ? a : b` picks values or components, `null` hides a block, `@Each` repeats. No user-defined functions, no string interpolation — concatenate with `+`.
7. `@Each(array, "x", template)`: inline the template (the loop variable exists only inside it).
8. Format numbers/dates for humans with `@Format` / `@Plural` / `@FormatDate`; relative dates start from `@Today()`, ordered with `@DaysBetween(a, b) > 0`.
9. Complete programs only: no `...`, no TODO, no placeholder comments.
10. One successful `render_ui` call per turn (rejected calls may be retried).
11. Inline fences and page artifacts may coexist when roles differ: each `openui` fence holds one complete program, an answer has at most one page artifact, and content is never duplicated in both.
12. **Keep the extension checkout read-only while answering.** Never add scratch programs, tests, fixtures or build output under the skill base directory or the plugin's source tree (including `test/renderer/.build/`). `render_ui` is the preflight; save drafts in a temporary directory outside the repository. Only an explicit request to develop the extension lifts this rule.

Exact signatures/enums: [references/components.md](references/components.md). Syntax & wrong-vs-right snippets: [references/language.md](references/language.md).

## Design playbook

The compactness rules below apply to **Card** pages and side cards inside an Article (not Article prose). For Free-form layout, Auto-chosen free layouts, authorized free results, and selected free templates, page shape and typography guidance is advisory while language, theme, and safety rules still apply.

- **Layout and spacing contract.** The renderer owns vertical rhythm (section 24 / group 12 / inner 8). Leave `gap` unset on the page root `Col`, `Section` children, and `Card` contents; use `gap` only on `Row`, `Grid`, `Carousel`, a list `Col` (2–3), and compact control stacks (1–2 inner, 3–4 grouped). Never create vertical space with `Spacer()`, empty `Box`/`Col`/`Card`/`Text`/`Markdown`, or a blank `Divider`. Do not wrap a whole Section body in a manual-gap `Col`, and do not put a whole Card/Article page side by side. The Host warns about root gaps, vertical Spacers, empty Sections/Text, and `gap: 0` block stacks.
- **Article layout.** One readable column: `Title` (`xl`/`2xl`), short `Text` summary, `Toc`, then collapsible `Section` blocks with substantial `Markdown` prose first and at most a couple of supplemental blocks. Never hide core reading content behind a `Carousel` or skeleton bullets.
- **Card hierarchy.** `Title` (`xl`/`2xl`), one short `Text`, then 2–4 mixed blocks grouped in `Card`s (never wrap the whole page in one card). Inside a `Card`, `Grid` cell, or `Carousel` item, titles are capped (`lg` 18 → `3xl` 30px) and body `Text` is 15px: use `md`/`sm` for card titles and `xl` only for a KPI number. Typical Card page: 20–80 statements (cut blocks past ~120); Article pages are content-driven.
- **Media rows & thumbnail lists.** Keep `SearchImage` to ~1–3 feature photos per page (exact 2–4 word subjects), never one per list row. For a photo beside copy, wrap it in `Box([SearchImage(..., 1.33)], ..., width)` and top-align the `Row`. For repeated lists/rankings use `Table` or `List`; if rows genuinely need thumbnails, leave the list `Col` gap unset (or 2–3), center-align (`Row(..., 2, "center")`), size thumbnails explicitly (`Box(..., 44)`), and give ranks a fixed `26`px `Box` so 9 and 10 align.
- **Use the file path for an image you already have.** Pass workspace-relative (`Image("figures/chart.png", "Quarterly revenue")`) or absolute paths for local PNG/JPEG/WebP/GIF files directly to `Image` or Markdown `![alt](path)`. Never start a local HTTP server or invent a URL. Missing/unsupported/SVG local files render a clear error placeholder; `HtmlView` cannot load local paths.
- **Draw the mechanism, don't describe its shape.** For processes, loops, request paths or state machines, lead with a labeled `Svg` diagram (viewBox ~240 wide, tokens for strokes/fills, `SvgText` labels, `Line`+`Polygon` arrows), driven by `$step` when interaction teaches the sequence.
- **Self-running & guarded.** Compute all totals/filters locally with `@functions`. Guard numeric inputs with `@Clamp(@Default($n, 1), 1, ...)` and guard divisions with `$n > 0 ? ... : 1`. `@ToAssistant` forwards **only the message string** (not the optional `context` object), so interpolate needed values directly into the short first-person string.
- **Theme & DSH chrome.** Use semantic `Color` tokens (auto light/dark; avoid hardcoded white/black). Turn-tail cards render at turn end (full chat width; use `Grid` `minChildWidth` and `Row` `wrap`, avoid fixed widths >600px). Use `HtmlView` only when components + `Svg` cannot express a canvas game or animation loop (sandboxed opaque iframe; script/style/font CDNs + https images only; no shared state).

## Common pitfalls & quick pre-flight

Before calling `render_ui` (or closing an `openui` fence), double-check the top failure causes:
1. Positional args only (no `key: value`, no extra args; use `null` to skip middle optional args).
2. Inline `@Each` templates (never extract to a separate statement); declare every `$` binding and connect every control to a visible consumer.
3. Exact keys/types: `Chart` keys match row keys (`key`/`value` for `@GroupBy`/`@Bucket`); `MapMarker(label, lat, lng)` order; strings for `Title`/`Text` (`$n + ""` or `@Format`); `@DaysBetween` instead of `<` on dates.
4. Respect the spacing contract (no root/Section/Card `gap`, no manual vertical `Spacer()`), feature-photo discipline (no `SearchImage` per list row), and read-only checkout rule.

## Reference index

| File | Read it when |
| --- | --- |
| [references/components.md](references/components.md) | You need an exact signature, default, enum, optional argument position, or the full list of 57 components, 73 functions and 5 action steps. |
| [references/language.md](references/language.md) | You are unsure about syntax, hoisting, `$` state, actions, `@Each`, comments, coercion, or want wrong-vs-right snippets. |
| [references/examples.md](references/examples.md) | You want validated interactive inline examples or complete page programs (itinerary, calculator, SVG tutorial, dashboard, form, quiz + HtmlView, detailed article). |
| [references/on-demand.md](references/on-demand.md) | The prompt carries an `ON-DEMAND UI` note or selected custom template (`styleId`), or you are adjusting a temporary-style result. |
| [references/artifact-editing.md](references/artifact-editing.md) | The user message carries one or more `<artifact-edit-request>` envelopes (block edits, nested additions, reorders, or style edits). |
| [references/troubleshooting.md](references/troubleshooting.md) | A call failed, carried warnings, rendered wrong, or media/map/HtmlView degraded (verbatim host errors + retry loop). |
| [references/integration.md](references/integration.md) | Installing/adopting the extension, `render_ui` or the skill is missing, or you need the `render_ui`/`edit_ui_blocks` tool contracts and limits. |

Resolve all links relative to the skill's base directory.
