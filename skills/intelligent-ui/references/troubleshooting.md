# Troubleshooting

`render_ui` either returns a success value or throws. A thrown error is the host's own message, verbatim: read the quoted fragment, fix the named problem, and call again in the same turn, or request the user action named by an operation error below. A success can still carry parser warnings; treat those as bugs too.

## The retry loop

1. **Read the error text.** Fatal program-validation errors use `render_ui: the program is not valid openui-lang and was not shown. Fix it and call render_ui again. ` and then list one or more findings separated by `; `. Fix **all** findings, not just the first.
2. **Locate the statement.** The finding names a field path (`/text`, `/children`, `/size`), a component (`Unknown component "Baz"`), a function (`Unknown function "@Magic"`) or a signature. Match it to the offending statement.
3. **Fix the smallest thing.** A rejected program is never partially rendered, so there is no advantage in rewriting the whole page. Change the argument, the name or the missing reference.
4. **Call `render_ui` again in the same turn.** Two or three attempts are normal; the validator errors are precise. If the same finding comes back twice, the fix did not apply — re-read the program rather than rephrasing the message.
5. **On success, stop.** The page is on screen; do not call `render_ui` a second time in the same turn. Close with at most one short sentence. If warnings came back, fix them and re-call once; a successful call with warnings still renders, but the missing pieces are user-visible.
6. **If retries keep failing**, degrade deliberately: remove the most complex block (Map, HtmlView, nested `@Each`), keep the shell and the core content, call once more, and tell the user in one sentence that the interactive part could not be shown.

## Preflight: call the tool, do not build a harness

`render_ui` is the supported preflight, and retrying is cheap: a rejected program is never partially rendered, and a successful result that carries `Notes:` tells you exactly what was dropped. Do not validate a program by adding scratch scripts, tests, fixtures or build output to the extension's own checkout — not even inside a gitignored directory such as `test/renderer/.build/`. The user sees those writes as changes in a repository you were not asked to touch.

- Write any draft program to a temporary file (for example under `$TMPDIR` or `/tmp`) if it must exist on disk.
- Treat the extension source tree as read-only while answering; the only exception is a request that explicitly asks you to change the extension itself.
- If a program fails only at render time, simplify the offending block and re-call; see [Runtime fallbacks](#runtime-fallbacks-valid-program-degraded-media).

## The switch does not admit this session

```text
render_ui is disabled for this session. Turn on Intelligent UI with the composer switch or /iui on|inherit.
```

**Cause.** This is a tool-admission error, not a validator error: the program never reached the parser. The session override is **Off**, the session follows a globally disabled switch, or the `/iui` command that flips it has not settled.

**Fix.** Open the **UI** chip in the composer and pick **This session only** (「仅本会话」 in a Chinese UI; or run `/iui on`), or enable the extension globally on the Plugin detail page, then retry in the same turn. If the chip already shows a scope that includes this session, the host half may be stale — restart the DSH host (next section). Never emulate the card with HTML or a fenced block.

## Red `/iui` rows or a missing UI control

- A red command row reading `Usage: /iui [on|off|inherit]` while the **UI** menu offers a **Follow global** entry means the browser half is newer than the host half: restart the process serving the DSH Web UI, then refresh the page. This is version skew, not a program error.
- If the **UI** chip is absent, the profile lacks the `sessionProjections` + `commands` services or the browser half did not load. In that deployment the extension is always-on, so a missing `render_ui` points at the plugin itself — see [integration.md](integration.md#troubleshooting-a-missing-render_ui).
- A `Switch failed`（「切换失败」）inline label means the command request failed before it reached the switch; retry once, then report the exact failure line.

## Host error strings (verbatim) and fixes

### Temporary style and operation errors

These messages are copied from the current Host. Authorization and schema failures happen before program parsing.

```text
render_ui: styleId and temporaryStyle are mutually exclusive.
render_ui: temporaryStyle requires a bound, running on-demand operation and its current tool call. The model cannot authorize one.
render_ui: invalid temporaryStyle: <field-specific reason>. Pass schemaVersion 1, baseLayout, and non-empty directives; add a theme (light and dark palettes plus font, radius, density and shadow) only when the page should not inherit the session theme.
render_ui: temporaryStyle.baseLayout must match style.
render_ui: on-demand generation requires style: "free" and temporaryStyle.baseLayout: "free"; card/article layouts are only supported when adjusting an existing result.
render_ui: on-demand operation was cancelled or replaced before completion.
render_ui: this turn is an on-demand UI request; pass a complete temporaryStyle with a matching style (omit styleId), or ask the user a clarifying question first.
```

Use only one style source. A temporary snapshot needs a Host-armed operation bound to the human message and current observed `render_ui` call; the model cannot self-authorize. Ask the user to re-arm in the composer after expiry, cancellation or restart. A text-only fallback turn keeps the operation pending (resume) so the next message can continue without re-arming; retry is offered for failed/interrupted turns. A structured question still awaiting an answer blocks rendering; wait for the built-in `ask_user_question` answer first. Match `baseLayout` and `style`, use only schemaVersion 1/controlled theme tokens and bounded reusable directives; omit styleId.

Adjustment errors identify the stored parent layout or an unavailable parent; for a legacy Card parent and a missing result named `old-result`:

```text
render_ui: on-demand adjustment must preserve the parent result layout; pass style: "card" and temporaryStyle.baseLayout: "card".
render_ui: cannot adjust result "old-result": its parent snapshot is unavailable in the result registry. Ask the user to cancel this adjustment and start a new on-demand generation.
```

Retry layout mismatches using both required fields. Adjustments must retain the parent snapshot's free/card/article layout. Missing or evicted snapshots cannot be recovered from model arguments or conversation content: ask the user to cancel and start a new **On-demand UI** generation. Rejection does not record a result or complete the operation; historical replay remains available.

For the light ink pair, the exact contrast error is below; the same format uses `dark` and/or `accent` for the other pairs:

```text
render_ui: temporaryStyle light ink/canvas contrast must be at least 3:1.
```

Raise the named pair's contrast in the named palette, targeting 4.5:1. Ratios from 3:1 to below 4.5:1 succeed with a `Temporary style … contrast is …:1; 4.5:1 is recommended.` warning.

Selected-template errors identify the required template/base layout; for example:

```text
render_ui: this session uses custom style "Ocean notes"; pass styleId: "cs_ocean01" and style: "card".
```

Follow that exact id/layout outside an authorized on-demand call. If the template is gone, let the user select another style; do not fabricate it.

Command and result-save failures include:

```text
Enable Intelligent UI for this session before arming on-demand UI (/iui on).
Usage: /iui on-demand [off|<client-instance-token> [adjust <resultId>]]
Invalid session or client instance token.
Invalid on-demand adjustment parent result id.
An on-demand UI operation is already running in this session; wait for it to finish or cancel it first.
Too many active on-demand operations. Cancel one and retry.
This result snapshot is no longer available.
This result has no explicit theme, so it cannot become a style template. Adjust it with a theme first, then save.
A style with this name already exists.
The style library has reached its scope limit.
The session must match the result.
This template no longer exists.
Could not save the style. Check its name, scope and theme, then retry.
```

The result registry retains only 200 records; eviction can prevent saving while recorded arguments still replay. Save from the result's extension action rather than asking the model to write templates. Re-arming replaces the previous active operation. Keep other tabs from sending in that session while armed: the hint is tab-specific, but the Host binds the next human session message.

### The program is empty

```text
render_ui: program must be a non-empty openui-lang program.
```

**Cause.** `program` was missing, empty or whitespace. **Fix.** Send a complete program. A UI answer always has statements, starting with `root`.

### The program is not valid (generic wrapper)

```text
render_ui: the program is not valid openui-lang and was not shown. Fix it and call render_ui again. <findings joined with ";">
```

Every fatal parse or validation error appears in this wrapper. Read what follows the wrapper — the findings below are the usual ones.

### Missing root / root is not a component

```text
No root statement, and no statement calls the root component Col
root does not evaluate to a component
No root statement could be resolved.
```

**Cause.** No `root` statement; or `root` is a string, number, boolean, array, or a bare name (`root = Col`) instead of a component call. **Fix.**

```openui
// wrong
root = "hello"
// wrong
root = Col
// right
root = Col([Text("hello")])
```

The root may be any component, but keep the convention `root = Col([...])`: it gives the answer an article-like page with sane spacing.

### Unknown component

```text
Unknown component "Baz" — not found in catalog or builtins. Available components: Col, Row, Box, ...
```

**Cause.** A typo, wrong case, or invented component. **Fix.** Use the exact name from [components.md](components.md). Common confusions: `Segmented` → `SegmentedControl`, `SegmentedControl` is one word, `MapPin` → `MapMarker`, `Markdown` (component) vs `Text` with inline marks, `Action` is syntax not a component, `Math` not `MathBlock`.

### Named arguments / missing required field

```text
required field "/children" cannot be null — signature: Col(children*: array, gap: number, align: "start"|"center"|"end"|"stretch")
missing required field "/text" — signature: Title(text*: string, size: "sm"|"md"|"lg"|"xl"|"2xl"|"3xl", color: string)
```

The echo of the signature marks required arguments with `*`. The first message usually means **named-argument syntax was used**: `Col(children: [...])` parses `children: [...]` as one object argument, so the real positional `children` is missing. The second means the first required argument was omitted or a nested value evaluated to `null`.

```openui
// wrong — colon syntax
root = Col(children: [Text("hi")])
// right
root = Col([Text("hi")])
// wrong — no required text
root = Col([Title()])
// right
root = Col([Title("Reporting", "lg")])
```

To skip a middle optional argument, pass `null` in its place: `Row([a, b], 3, null, null, true)`.

### Wrong type

```text
field "/value" expects number but got string
field "/text" expects string but got number
```

**Cause.** An argument's value has the wrong primitive type — a numeric field received a string, or a string field received a number. **Fix.** Convert explicitly:

```openui
// wrong: $cups is a number, Title needs a string
Title($cups, "xl")
// right
Title($cups + "", "xl")
// wrong: Slider value is a string
Slider("40", 0, 100)
// right
$level = 40
Slider($level, 0, 100)
```

Also watch `Input($people, "People")` without `"number"`: a text field stores a string, and later arithmetic on it produces junk. Declare number inputs as `Input($people, "People", "number")` and guard with `@Clamp(@Default($people, 1), 1, 50)`.

### Invalid enum value

```text
field "/size" expects one of ["sm", "md", "lg", "xl", "2xl", "3xl"] but got "giant"
```

**Fix.** Use one of the listed values exactly, with the same case. Enum lists are also in the signature echo of the error and in [components.md](components.md).

### Too many arguments

```text
Text takes 8 arg(s), got 9 (1 excess dropped)
```

**Cause.** An extra positional argument, often from copying a signature with the wrong count or adding a `null` at the end. **Fix.** Remove the extra argument. Count required + optional arguments in the signature; optional arguments cannot be skipped from the end without `null` placeholders for the ones before them.

### Unknown function / action step

```text
Unknown function "@Magic": not a built-in or action step. The call evaluates to null
```

**Cause.** A function that does not exist (invented, or from another library) or a misspelled action step. The parser turns the call into `null`, which often triggers a second finding on the component that received it. **Fix.** Use only the functions and action steps in [components.md](components.md#core-functions-14) and [components.md](components.md#library-functions-59). Frequent traps: `@Length` → `@Count`, `@Mean` → `@Avg`, `@FormatNumber` → `@Format`, `@If` → ternary, `@Map` → `@Each`, `@Set` used in a text position.

### Incomplete program

```text
The program is incomplete.
```

**Cause.** Unclosed `(`, `[`, `{` or string, a truncated last line, or a statement split across lines with a trailing comma. It can appear together with a missing-field finding for the same reason. **Fix.** Balance all brackets and quotes; every statement must fit on one line. Re-send the complete program — never send a continuation fragment.

### Warnings that are not fatal

These do **not** throw; they come back in the success value and, in the UI, as the `Notes:` suffix in the tool result:

```text
Unresolved reference: missing
Unreferenced statement (will not render): extra
```

- `Unresolved reference` — a name is used but never declared. The component receives `null`; part of the page disappears. Declare the statement, or fix the spelling.
- `Unreferenced statement` — a component was declared but nothing reachable from `root` uses it. Either reference it from a parent or delete it.

The tool result on success is:

```text
Interactive UI rendered for the user (23 statements, card style).
Interactive UI rendered for the user (23 statements, card style). Notes: Unreferenced statement (will not render): extra
```

### The tool is missing entirely

First check the switch (previous sections). If the switch admits this session and `render_ui` is still not in the tool list, the plugin is not loaded for this profile — a deployment problem, not a program problem. See [integration.md](integration.md#troubleshooting-a-missing-render_ui). Do not try to emulate the tool with HTML in the chat reply.

## Limits

- **No statement cap in the host.** The validator accepts 200+ statements. The real limits are token budget, render cost and readability: aim for **20–80 statements**; past ~120, cut blocks rather than shrink everything.
- **Inline data is fine but keep it modest.** A few dozen rows are cheap; hundreds of rows in a literal array waste tokens and make the card slow. Summarize with `@GroupBy`/`@Bucket` and show a table of the top rows.
- **`HtmlView` height** is clamped to 80–2400 px; longer content scrolls inside the frame or is clipped.
- **Huge programs cost more than they return.** If a page needs many data points, generate them with `@Range`/`@Each` instead of writing them out, and hand heavy animation to `HtmlView`.
- **Once per turn.** The tool description asks for at most one successful `render_ui` call per turn; retries after a rejection are expected, multiple pages are not.

## Runtime fallbacks (valid program, degraded media)

These are not errors to fix in the program; they are how the card behaves when the environment is limited. The quoted chrome follows the app's UI language (Chinese equivalents in parentheses).

| Situation | What the user sees | What to do |
| --- | --- | --- |
| Photo search offline or rate-limited | `SearchImage` and a failed `Image` show a neutral image placeholder, not a broken icon. Search timeouts are 8 s per request, 12 s total. | Nothing. Do not add prose about images failing. |
| Map tiles unavailable | `Map tiles are temporarily unavailable. The places are still shown.`（「地图瓦片暂时不可用，地点仍会显示。」）The pins stay interactive. | Nothing; keep the place list near the map. |
| Map renderer cannot start (old browser, no WebGL) | `Map preview unavailable`（「地图预览不可用」）plus `The places are listed below.`（「地点列表见下方。」）with a numbered list of labels and coordinates. | Keep marker labels short and recognizable; the fallback is a list. |
| Routing service down | `Street routing unavailable. Showing direct connections.`（「街道路线不可用，改为直线连接。」）Straight lines still join the pins in order. | Nothing; route is an enhancement. |
| HtmlView blank or inert | The sandbox has an opaque origin (no access to the chat, cookies or storage) and allows network only for script/style/font CDNs and https images. Some CSS (`light-dark()`) depends on the host theme. | Keep games self-contained with inline JS/CSS; fetch nothing; don't rely on parent-page state. |
| HtmlView shows `Preparing the interactive view…`（「正在准备交互视图…」） | Normal: the iframe mounts once the program has finished arriving. | Nothing. |
| Math renders as plain text | KaTeX inherits the host's global styles; if they are absent the formula degrades. | Prefer plain text for casual math; use `Math` for real formulas. |
| Clipboard write fails | `@CopyToClipboard` falls back to `document.execCommand("copy")`. | Nothing; it is best-effort. |
| A `render_ui` program crashes while rendering | The card shows `This generated UI could not be rendered.`（「生成的 UI 无法渲染。」）with the message and a collapsible `Show the UI program`（「显示 UI 程序」）. | This is a runtime crash, not a parse error: simplify the offending component (usually a Chart with malformed data or an Svg with invalid path text) and re-call. |
| `@ToAssistant` follow-up misses the form values | Only the message string is forwarded in this deployment; the optional `context` object is not delivered. | Build the message from the bindings: `@ToAssistant("Plan for " + $people + " people")`. |

## Rendered but wrong

No error appears, yet the page is not what you intended. Check these in order:

1. **Warnings** — did the success result include `Notes:`? Unresolved references silently null out content.
2. **Bindings not bound** — a `$` variable that no component references never changes anything visible; a control that writes an unused variable is a dead input.
3. **Chart keys** — `Chart` needs `x` to name a key that exists in every row and `series` to name number keys. Mismatched keys render an empty plot. `@GroupBy`/`@Bucket` rows use `key` and `value`.
4. **Map coordinates** — `MapMarker(label, lat, lng)`, in that order; swapped values put the pin in the ocean.
5. **Missing `String` coercion** — a number concatenated into a label usually works (`"Step " + ($i + 1)`), but passing a raw number where a string is required fails validation.
6. **Conditional nulls** — a ternary in a children array is fine, but a top-level statement that evaluates to `null` and is then referenced as a component breaks the page. Keep ternaries inside children arrays.
7. **Empty state** — `@Sum`, `@Avg` and `@Count` over an empty array return `0`; division by a count needs a guard (`$people > 0 ? ... : 1`). `@Pick([])` returns `null`, and `@First([])` returns `null`; provide a fallback with `@Default` or a ternary.
8. **Dates** — comparisons are numeric; order dates with `@DaysBetween(a, b) > 0`, and format them with `@FormatDate`.

If the page is merely visually weak, do not re-call for cosmetic fixes: choose better blocks next turn ([SKILL.md](../SKILL.md#design-playbook) has the composition rules).


### Free saved templates

A selected free template requires `style: "free"` and its exact `styleId`, without `temporaryStyle`. A Card/Article selection still rejects free; a built-in selection cannot authorize free by adding an arbitrary styleId. Free templates require no Toc/Section or Article wrapper. Saving a result copies the registered layout, directives and theme; a theme-less result has no palette to copy, so the client hides Save and the API answers `no_theme`. A legacy client sending `baseLayout` receives `invalid_input` and must reload the updated client. Missing/deleted templates retain the existing default-theme fallback.
