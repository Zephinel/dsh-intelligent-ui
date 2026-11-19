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

**Fix.** Open the **UI** chip in the composer and pick **This session only** (「仅本会话」 in a Chinese UI; or run `/iui on`), or enable the extension globally on the Plugin detail page, then retry in the same turn. If the chip already shows a scope that includes this session, the host half may be stale — restart the DSH host (next section). Never emulate the card with HTML; a fenced block belongs to the plugin's own inline-UI path and will not render while the plugin is off.

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

Document-mode errors reject a layout the deployment does not use for ordinary answers:

```text
render_ui: document mode renders the answer as one free-layout document; pass style: "free" without styleId or temporaryStyle.
render_ui: document mode does not use saved templates; omit styleId and pass style: "free".
```

This deployment records ordinary answers as documents: pass `style: "free"`, put the whole answer (prose plus interactive blocks) in the program, and write no Markdown outside the call. Card/Article and saved-template layouts are rejected for these answers; apply on-demand results, saved templates and Artifact edit requests with their own recorded layout instead.

Inline `openui` fences are rendered by the client, not preflighted by the Host. An invalid program keeps the renderer's failure note (with the source still available) instead of rendering a partial page; there is no Host error to retry in the same turn. A Host without the `conversation.chat.markdown.fence` slot leaves every `openui` fence as a plain code block, so an older DSH shows the source rather than inline UI.

If the user wants a standalone interactive deliverable (a page, dashboard, tool, form, game or editable result), use `render_ui` instead: the answer's delivery decision is inline UI for an explanation, a page artifact for a deliverable. Never call `render_ui` merely to replace an inline fences block that failed to render.

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
| Photo search offline or rate-limited | `SearchImage` shows a neutral placeholder. An explicit `Image` whose source is missing, too large, unsupported (e.g. SVG) or fails to load shows a short localized error placeholder and never searches for a substitute. Search timeouts are 8 s per request, 12 s total. | Nothing. Do not add prose about images failing; for a local file, pass the workspace path instead of a URL. |
| Map tiles unavailable | `Map tiles are temporarily unavailable. The places are still shown.`（「地图瓦片暂时不可用，地点仍会显示。」）The pins stay interactive. | Nothing; keep the place list near the map. |
| Map renderer cannot start (old browser, no WebGL) | `Map preview unavailable`（「地图预览不可用」）plus `The places are listed below.`（「地点列表见下方。」）with a numbered list of labels and coordinates. | Keep marker labels short and recognizable; the fallback is a list. |
| Routing service down | `Street routing unavailable. Showing direct connections.`（「街道路线不可用，改为直线连接。」）Straight lines still join the pins in order. | Nothing; route is an enhancement. |
| HtmlView blank or inert | The sandbox has an opaque origin (no access to the chat, cookies or storage) and allows network only for script/style/font CDNs and https images. Some CSS (`light-dark()`) depends on the host theme. | Keep games self-contained with inline JS/CSS; fetch nothing; don't rely on parent-page state. |
| HtmlView shows `Preparing the interactive view…`（「正在准备交互视图…」） | Normal: the iframe mounts once the program has finished arriving. | Nothing. |
| Math renders as plain text | KaTeX inherits the host's global styles; if they are absent the formula degrades. | Prefer plain text for casual math; use `Math` for real formulas. |
| Clipboard write fails | `@CopyToClipboard` falls back to `document.execCommand("copy")`. | Nothing; it is best-effort. |
| A `render_ui` program crashes while rendering | The failing subtree disappears or keeps its last valid render; a renderer-level crash additionally shows `This generated UI could not be rendered.`（「生成的 UI 无法渲染。」）with the message and a collapsible `Show the UI program`（「显示 UI 程序」）. | The success result carries no finding — you cannot detect this crash yourself. Recovery is user-initiated: when the user reports it, simplify the offending component (usually a Chart with malformed data or an Svg with invalid path text) in the next turn. |
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
9. **Silent `null` from a function** — a `@function` call with a wrong-typed or out-of-domain argument (for example `@Sum($items.score)` when `score` holds strings, or `@Range(0, 5, 0)`) evaluates to `null` with no warning, so the surrounding `Text` or KPI renders blank while the tool reports success. Check that the fields are numbers before aggregating and fall back with `@Default(expr, neutral)` where a blank is not acceptable.

If the page is merely visually weak, do not re-call for cosmetic fixes: choose better blocks next turn ([SKILL.md](../SKILL.md#design-playbook) has the composition rules).


### Free saved templates

A selected free template requires `style: "free"` and its exact `styleId`, without `temporaryStyle`. An Auto session may also pass `style: "free"` directly (no `styleId`/`temporaryStyle`); the Host records it as a built-in free layout. A forced Card/Article selection still rejects free, and adding an arbitrary styleId cannot authorize free. Free layouts require no Toc/Section or Article wrapper. Saving a result copies the registered layout, directives and theme; a theme-less result has no palette to copy, so the client hides Save and the API answers `no_theme`. A legacy client sending `baseLayout` receives `invalid_input` and must reload the updated client. Missing/deleted templates retain the existing default-theme fallback.
