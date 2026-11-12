/**
 * Typographic split of one post-Apply notice, without touching its copy.
 *
 * The row renders the status clause as a 600-weight lead and the remaining
 * explanation as a secondary detail. The split prefers the first semicolon
 * (`；`/`;`) because it separates the status from the follow-up in both
 * locales; a message without one falls back to the first comma (`，`/`,`).
 * The separator itself stays at the start of the detail clause, so lead +
 * detail concatenate back to the original string character for character.
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
  const semicolon = message.search(/[；;]/)
  const comma = message.search(/[，,]/)
  const cut = semicolon >= 0 ? semicolon : comma
  if (cut < 0) return { lead: message, detail: '' }
  return { lead: message.slice(0, cut), detail: message.slice(cut) }
}
