# Usage guide

[中文](usage.md) | [Back to README](../README.en.md)

This is a practical tour of the extension. For implementation details, Host/Client contracts and the full boundaries, see [Architecture and behavior](architecture.en.md).

## Turn it on

1. Click the **UI** control to the right of the composer and choose **This session only**, or send `/iui on`.
2. A structured answer is then rendered as a card at the end of its turn.
3. To enable it for new sessions by default, open **Plugins → Intelligent UI** and turn on **Enable in all sessions**.

While the switch is off the model does not see `render_ui` and answers in text; turn it back on. To force a card (or when the model still answers in text), invoke the skill explicitly with `/intelligent-ui` in an enabled session.

## Ask

Describe the page and the interactive parts you need, for example:

- "Plan two days in Shanghai, with checkboxes and adjustments"
- "Build a 7-speed bicycle shifting simulator"
- "Turn these tables into a filterable sales dashboard"
- "Introduce Chinese history with expandable dynasties"

The model decides whether an answer uses a page: it renders one when structure, visuals, interaction or computation help, and answers in Markdown when text serves better. The layout used for a page can be set per session under **UI → Display style** — Card / Article, or Auto (Card, Article or a free layout).

## Answer as a document (experimental)

With **Answer as a document (experimental)** enabled under **Plugins → Intelligent UI → Experimental**, an ordinary rendered answer has no card header, collapse control or frame and reads as this turn's chat message text. The model puts prose, headings, tables and interactive blocks into one page and adds no Markdown outside it; this suits explanations, analyses and debugging answers that should read like a reply rather than a deliverable.

Note: this is a stopgap for in-message UI — the page still lives at the turn tail, and copying, search and transcript Markdown export omit its body; the document page has no card editing entry or revision history; only the Web renderer (Web/Desktop) shows it, and clients that do not render plugin cards (TUI/headless) show nothing. On-demand generation, saved templates and Artifact edit requests still render as cards. The switch affects future answers only; a recorded document answer keeps its recorded presentation, and new answers go back to Card / Article cards when it is off. See [Known limitations](limitations.en.md) for the full boundaries.

## Images

- After the agent generates or captures an image, the answer can reference the workspace file directly: a workspace-relative path such as `figures/chart.png`, or an absolute path. The client reads it through the Host workspace-files API (the same authority as the file preview, able to read absolute paths outside the workspace) and renders a same-origin blob URL, so no local HTTP server is needed and PNG export never taints the canvas.
- PNG / JPEG / WebP / GIF are accepted, plus small inline `data:image/…;base64` images (≤512 KiB decoded). Local files are capped at 10 MiB and 40 MP (local files and inline data are pre-checked from recognized headers), and the type is sniffed from the bytes, not the extension.
- An explicit source that cannot load shows an **error placeholder** (missing, too large, unsupported type) and never searches for an unrelated photo; searching belongs to `SearchImage` only.
- SVG from a path or data source is not supported (it shows an error placeholder); an `http(s)` SVG URL still renders through the browser's `<img>` behavior (no scripts). Markdown `![alt](path)` uses the same resolver; local images inside a sandboxed `HtmlView` are not supported.
- Local images are read from the viewing session's workspace at render time; restart/re-render after moving or deleting a file. The single-file HTML export inlines them as data URLs so the page works offline.
- Requires the workspace-files service from DSH 0.2.2. On an older Host without it, local paths show the "This Host cannot read local images" placeholder while http(s)/data sources keep working.

## Edit a rendered page

- Click **Edit** in the card header; top-level editable blocks show a soft orbit glow.
- The arrangement rows and canvas hover-sync both ways. Each row's **More** menu offers Locate, Edit, Duplicate, Move and Delete; Delete confirms inside the menu.
- Click a block to write a change request and **Save**; requests stay in the pending list. Drag rows or use ↑/↓/Home/End to reorder top-level blocks.
- Switch **Top level / Nested blocks** to edit content inside `Col`/`Row`/`Box`/`Grid`/`Card`/`Section`/`Carousel`.
- The **Style** section at the top of the panel (**Change style**) offers two paths, both exclusive with block requests: (1) **Switch style** — pick a built-in Card/Article or a saved template; hover previews the theme and Article shell locally, and **Apply style** makes the Host record a zero-model revision (same program, style identity and theme only; a temporary-style page becomes saved/built-in, and template directives do not reflow existing content). Article needs a page with contents and sections; otherwise its row is disabled with a one-line reason, and a single status line explains the current state. When the description is filled, the collapsed style row shows "Style note pending" and the send summary adds the style description. Only theme-bearing temporary style results offer **Save as template**; it creates a new template without overwriting built-in or existing templates, and other pages are unaffected. Built-in/saved-template results show no Save entry; there is no "update original" or "copy saved template" entry. (2) **Or describe it (model-applied)** (max 2000 chars) — the model restyles the page (the Host enforces the layout and only warns about content changes) and records a new temporary-style revision. Editable cards on a new Host no longer show the footer Adjust style button (old Hosts or non-editable cards keep the fallback; a redirected read-only fallback card keeps neither Save nor Adjust).
- `Divider`/`Spacer` open quick-adjust fields: plugin-drawn colour/unit pickers and sliders preview on the canvas and apply through the deterministic Host property route without a model turn. Each unit carries a one-line explanation under its row and in the menu: Default means no explicit length, px is a fixed size, and % is a share of the container (a percentage height needs a definite container height).
- Duplicate/delete/move first enter this round's pending queue (batch mode keeps a local batch draft until **Save batch**); **Apply** opens the total preview and, once confirmed, the Host records one structural revision atomically. Queueing, cancelling a batch edit and removing a chip never lose the draft; a structure-only Apply closes the draft after recording, while a mixed round auto-sends the remaining request (the chip stays for a manual send while the composer holds prose). Turn on **Strict protection** to reject changes to unselected top-level blocks.
- **Exit editing** in the panel header or the card header leaves the canvas. Block requests, the global note and ordering still travel in composer chips and produce a new revision when you send normally; structural operations are recorded through the **Apply** total preview, or auto-sent after the structural revision in a mixed Apply.
- Cards rendered by an older version need no manual migration: the first time you open editing, revision history or restore, the client registers the currently rendered content as the Host's authoritative base, after which structure operations, history and restore work. With an older Host or a failed registration, the affected operations fall back to instruction editing or suggest re-rendering the page.

## Requests, drafts and revisions

- Each edited artifact gets one composer chip: `Edit {title} · revision N · {summary}`.
- One chat keeps several drafts (one active canvas); one send can merge up to 3 artifacts' requests, each producing its own revision.
- Removing a chip only detaches its draft from the send; re-attach it from the **pending edits** area.
- An older revision can be **Restored as a new revision** (zero model calls, local revision card); a conflict banner can create a branch from an older revision.
- Revision history can delete a recorded revision behind an inline confirmation: the initial render cannot be deleted, and an old revision referenced as a newer revision's base must have the newer revision deleted first. Before deleting a revision that a card renders, the client fetches the newest older revision whose program is still retained and, after the DELETE, rolls the cards still showing the deleted revision back to it (the fallback is kept per session in browser `localStorage`, so it survives a reload); when no fallback exists the rendered revision itself offers no delete; a revision that an unsent draft in the chat is editing cannot be deleted, a revision still used as a newer revision's base hides its delete with an explanation, and other cards still showing the deleted revision only roll back when a fallback is available (they may otherwise become stale). The stage selects the rollback target named by the confirmation, stays read-only while it displays that target, and selecting another revision restores editing. The redirected card is read-only, and deleting the fallback target later resolves the fallback chain to a revision that still exists. Deletion is a real, irreversible Host delete; the matching local revision card is removed, while already-generated model message cards stay; a `revision_missing` answer (for example after a lost response) is treated as already deleted and refreshes history.
- Temporary-style results keep their style snapshot through content edits; reorder-only or global-only requests still need a page with a saved/built-in style. Natural-language style adjustment for a temporary-style page happens in the **Style → Change style** section of the edit canvas.

## On-demand and templates

- Choose **On-demand UI**, then send a normal request; material ambiguity is clarified with structured questions.
- Use the result immediately; open the card's **Edit** canvas and describe or switch under **Style → Change style** (the Host keeps the layout, only warns about content changes, and records a new temporary-style revision). Only a theme-bearing temporary-style result has the footer **Save as template**; it saves the layout, preferences and theme as a new template. Old Hosts or non-editable cards keep the footer Adjust style fallback; redirected read-only fallback cards keep neither Save nor Adjust.
- Export/import templates in **Plugins → My styles** or the composer's style panel. Import creates global templates only and requires an explicit acknowledgement.

## Export

The **Export** button at the right of the message actions can:

- Export all cards in the turn as one PNG (original / rounded / card; background and 1x/2x live in the plugin settings).
- Export a single-file HTML page that stays interactive in a browser; workspace images are inlined as data URLs so it works offline, and `@ToAssistant` copies its message and asks you to paste it back into DSH.

## Related

- [Architecture and behavior](architecture.en.md) — component tree, Host/Client contracts, editing and export internals.
- [Known limitations](limitations.en.md) — current boundaries and unverified areas.
- [Development and deployment](development.en.md) — install, uninstall, development commands and restart notes.
