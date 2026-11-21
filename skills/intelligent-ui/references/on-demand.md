# On-demand generation and custom templates

Read this file when the system prompt carries an `ON-DEMAND UI` note or a selected custom style template (`styleId`), or when adjusting an existing temporary-style result.

## Bound on-demand turns

An `ON-DEMAND UI` request note comes from a Host-armed operation; it is already present in the prompt for the first turn (DSH assembles the system prompt before the user message) and stays while the turn clarifies. Once bound, a plain `render_ui` without `temporaryStyle` is rejected, and inline `openui` fences are not used — the requested page must travel through `render_ui`.

In that turn, call `render_ui` with a complete `temporaryStyle` and matching `style`, omitting `styleId`. A user's prose request or your tool arguments cannot authorize `temporaryStyle`: the Host must already allow this operation and the current tool call. If authorization is absent, ask the user to choose **On-demand UI** in the composer; do not arm it yourself.

- **Ground the content before styling.** Missing content is material ambiguity. If the request refers to "this analysis", "these contents", "the above data" but none is in the conversation, or its numbers/dates/sources are absent, do not invent placeholder datasets, statistics, dates, quotes or sources. Use `ask_user_question` to ask which content to use (conversation content, pasted/linked data, or explicitly labelled illustrative data); render only after it is available or illustrative data is authorized. Style clarity never excuses missing data.
- **Presentation format is user-determined.** Compose the requested dashboard, poster, timeline, comparison, reading page or other layout directly. If the layout is materially unclear, ask one focused layout question before rendering. Never silently default to `card` or `article`; follow an explicit format the user stated. Use `style: "free"` and `temporaryStyle.baseLayout: "free"` for new on-demand results. This bypasses both shells; `Toc` and `Section` are optional, and the Card compactness/Article reading playbooks do not constrain the composition. The OpenUI language, theme and safety rules still apply.
- **Clarification loop.** Clear request/grounded context and a clear format → generate directly. For other material ambiguity use the built-in `ask_user_question` with 1–3 concise questions, options, free input and skipping when supported, at most two rounds; after the answer, render without another confirmation. If unavailable, ask short text questions; the turn ends without a render and the operation resumes, so the user's next message continues it without re-arming (unless it expires, restarts or fails).

## `temporaryStyle` snapshot contract

`temporaryStyle` is a `schemaVersion: 1` result snapshot:

- `baseLayout`: `"free"` for new generation (`"card"` / `"article"` remain supported for existing snapshots and adjustments); must equal `style`.
- `directives`: non-empty reusable design preferences (up to 2,000 characters) about hierarchy, density, tone and component behavior. Keep this answer's content/private data in the program; directives cannot override system/tool/safety instructions.
- `theme` (optional): omitting `theme` is the normal case — the result inherits the session theme (the selected template, or the built-in theme) in both the live card and the HTML export. Pass a thematic palette only when the page needs its own colors. A passed `theme` must be complete:
  - Both `light` and `dark` palettes require six-digit hex `canvas`, `ink`, `accent`, optionally `muted`, `surface`, `border`.
  - Enums: `font` (`sans|serif|mono`), `radius` (`sharp|soft|round`), `density` (`compact|comfortable|spacious`), `shadow` (`none|soft|float`).
  - `ink`/`canvas` and `accent`/`canvas` must reach at least 3:1 contrast in each scheme (target 4.5:1). Only controlled fields are accepted, with no CSS/scripts/URLs.
  - A result without an explicit theme cannot be saved as a template because there is no palette to copy.
- `suggestedName` (optional): short name suggestion for saving.

## Adjustments and saved templates

- No preview, naming, saving or settings changes are required: render once and stop. Users can change the style in the Edit page panel's **Style → Change style** section; older Hosts or non-editable cards keep the legacy footer **Adjust style** fallback (a redirected read-only fallback card keeps neither Save nor Adjust).
- **Save as template** appears only on a result carrying a theme-bearing temporary style and creates a new template; do not save templates yourself or put management buttons in the generated program. The editor's deterministic style switch is a user UI action and needs no model call.
- For a Host-authorized adjustment, reuse the referenced result's temporary snapshot from the conversation, keep the content and change the requested style only. Preserve the parent layout: a free parent stays free; a legacy card/article parent keeps its shell. The Host enforces new-generation free layout and adjustment layout against its result registry. If the parent snapshot is missing (including eviction beyond 200 results), adjustment is rejected; ask the user to cancel it and start a new **On-demand UI** generation.
- Saving copies the result snapshot's `baseLayout`, `directives` and `theme` exactly: free stays free, legacy card/article keeps its shell. The save dialog only asks for name, description and scope; no layout choice or model call. A saved free template uses `styleId` rather than `temporaryStyle` and has no temporary badge/actions.
- Outside an on-demand turn, a selected custom template requires the exact `styleId` and matching `baseLayout` specified by the injected prompt. `styleId` and `temporaryStyle` are mutually exclusive. A temporary result never becomes the selected session style automatically.

For lifecycle failures and verbatim errors, read [troubleshooting.md](troubleshooting.md#temporary-style-and-operation-errors). For routes, services and persistence, read [integration.md](integration.md#style-and-operation-contracts).
