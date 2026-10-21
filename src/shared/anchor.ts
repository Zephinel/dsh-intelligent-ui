/**
 * Shared anchor normalization for article Section/Toc targets.
 *
 * The Host validates effective anchors with exactly the same normalization the
 * renderer uses for DOM ids; keeping it in one module prevents silent drift.
 */

/**
 * Normalize one display title or explicit anchor.
 * @param value - the raw title or anchor.
 * @returns a lowercase slug, or "section" when nothing remains.
 */
export function anchorSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return normalized === '' ? 'section' : normalized
}
