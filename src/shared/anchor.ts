/**
 * Shared anchor normalization for article Section/Toc targets.
 *
 * The Host validates effective anchors with exactly the same normalization the
 * renderer uses for DOM ids; keeping it in one module prevents silent drift.
 */

/**
 * Normalize one display title or explicit anchor.
 * @param value - the raw title or anchor.
 * @returns a lowercase slug; a title with no letters or numbers (symbols,
 *   emoji) gets a stable hashed fallback so distinct titles stay distinct.
 */
export function anchorSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  if (normalized !== '') return normalized
  // Titles such as "①" or "🎬" used to all collapse to "section", which then
  // looked like duplicate anchors. Hash the source so each title keeps a
  // stable, unique target (the renderer uses the same function for DOM ids).
  let hash = 5381
  for (const char of value.trim()) hash = ((hash * 33) ^ (char.codePointAt(0) ?? 0)) >>> 0
  return `section-${hash.toString(36)}`
}
