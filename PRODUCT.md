# Product

## Register

product

## Users

DeepSeek Harness users — developers, analysts, and knowledge workers — who ask the model for a structured answer (itinerary, dashboard, form, comparison) and then refine that rendered page in place. They are mid-conversation inside a dense chat surface, often on a laptop, and they care about preserving the rest of the page while changing a few blocks.

## Product Purpose

Turn a model answer into a real, interactive OpenUI page inside the chat, then let the user revise selected blocks, reorder blocks, and record targeted new revisions without the model rewriting the whole page. Success is that editing feels like operating a precise tool on one artifact: the canvas, the request list, the block arrangement, the revision history, and the composer all describe the same object at the same scope.

## Brand Personality

Precise, quiet, instrument-like. The UI should feel like a well-machined workbench inside the chat: confident spacing, restrained color, clear state, no decoration competing with the artifact being edited.

## Anti-references

Card-inside-card layouts, colored outlines and tinted pills used as decoration, oversized rounded corners, always-visible destructive text buttons, emoji or character glyphs standing in for icons, tiny type used to create false density, and any chrome that looks like another content card rather than a control for the composer.

## Design Principles

1. **Scope is visible.** A surface belongs to the chat, one artifact, or one revision; never mix those levels in one list.
2. **The artifact carries the color.** Chrome stays neutral; one accent marks the current selection or primary action.
3. **Density with air.** Compact controls group tightly, but sections and composer chrome get enough space to read as separate levels.
4. **Quiet by default, explicit on demand.** Secondary actions stay out of the way until hover or focus, while keyboard and screen-reader access remain complete.
5. **Every state, not just the happy one.** Hover, focus, active, disabled, conflict, detached, failed, loading, and empty states are part of the component, not afterthoughts.

## Accessibility & Inclusion

WCAG AA contrast for text and controls; focus-visible rings preserved; all icon-only controls carry accessible names and titles; keyboard access for switching, attaching, and discarding drafts; reduced-motion preference honored; color is never the only signal for state.
