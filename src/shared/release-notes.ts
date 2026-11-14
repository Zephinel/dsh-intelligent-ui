/**
 * Release-notes format and parsing shared by the Host update check.
 *
 * Each release commits `release-notes/<version>.md` before its `v<version>` tag
 * is pushed, so the note text is human-reviewed in the same change as the
 * version and is immutable once the tag exists. The Host reads that file from
 * the tag-pinned raw URL and turns its `## Highlights` bullets into the card's
 * update points; the full document stays the source for a later detail view.
 */

/** Heading that starts the card's bullet list. */
const HIGHLIGHTS_HEADING = /^##\s+highlights\s*$/im

/** A bullet line with its marker; nested continuation lines are not part of a point. */
const BULLET = /^(?:[-*+]|\d+[.)])\s+(.+)$/u

/** Inline Markdown that should not leak into the compact popover. */
function plainText(line: string): string {
  return line
    .replace(/\[\s*([^\]]*)\s*\]\([^)]*\)/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/gu, '$1$2')
    .replace(/<[^>]*>/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Extract the `## Highlights` bullets from one release-notes document.
 * @param markdown - the `release-notes/<version>.md` content.
 * @returns plain-text bullets in document order; empty without a Highlights section.
 */
export function parseHighlights(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/u)
  const start = lines.findIndex(line => HIGHLIGHTS_HEADING.test(line))
  if (start === -1) return []
  const points: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/u.test(line)) break
    const match = BULLET.exec(line.trim())
    if (match === null) continue
    const text = plainText(match[1] ?? '')
    if (text !== '') points.push(text)
  }
  return points
}
