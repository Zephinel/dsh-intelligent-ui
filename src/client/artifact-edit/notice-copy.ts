/**
 * Typographic split of one post-Apply notice, without touching its copy.
 *
 * The row renders the status clause as a 600-weight lead and the remaining
 * explanation as a secondary detail. The split prefers the first internal
 * sentence or clause boundary (`；`, `;`, `。` followed by text, or `.` followed
 * by whitespace), falling back to the first comma (`，`/`,`). The separator
 * itself stays at the start of the detail clause, so lead + detail concatenate
 * back to the original string character for character.
 */
export interface NoticeCopyParts {
  /** Status clause rendered in the primary ink. */
  readonly lead: string
  /** Separator plus the remaining explanation rendered as secondary detail. */
  readonly detail: string
}

/**
 * Split one localized notice message for the lead/detail hierarchy.
 * @param message - the localized `edit.applyNotice.*` string.
 * @returns the lead clause and the detail clause (empty when there is no separator).
 */
export function noticeCopyParts(message: string): NoticeCopyParts {
  const clause = message.search(/[；;]|。(?=.)|\.(?=\s)/)
  const comma = message.search(/[，,]/)
  const cut = clause >= 0 ? clause : comma
  if (cut < 0) return { lead: message, detail: '' }
  return { lead: message.slice(0, cut), detail: message.slice(cut) }
}
