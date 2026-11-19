/**
 * Classify parser/render diagnostics for display.
 *
 * The permissive OpenUI parser keeps rendering when most diagnostics fire: a
 * component with a missing prop is dropped, a prop value is ignored, an extra
 * positional argument is discarded. Only a missing/unparseable root leaves no
 * usable page. Keeping this policy pure makes the fatal/warning/silent split
 * testable without a browser.
 */
import type { OpenUIError } from '@openuidev/react-lang'

/** Extra positional args are dropped and change nothing visible. */
const IGNORED_CODES = new Set(['excess-args'])

/** No usable page: parsing failed or no component became the root. */
const FATAL_CODES = new Set(['parse-failed', 'parse-exception', 'no-root'])

/** The three display buckets for one diagnostic list. */
export interface DiagnosticBuckets {
  /** Errors that should replace the page with the full fallback. */
  readonly fatal: readonly OpenUIError[]
  /** Errors that keep the page and add a compact warning strip. */
  readonly warnings: readonly OpenUIError[]
  /** Errors that are intentionally silent (for example dropped extras). */
  readonly ignored: readonly OpenUIError[]
}

/** Split diagnostics into fatal, recoverable-warning and silent buckets. */
export function classifyDiagnostics(errors: readonly OpenUIError[]): DiagnosticBuckets {
  const fatal: OpenUIError[] = []
  const warnings: OpenUIError[] = []
  const ignored: OpenUIError[] = []
  for (const error of errors) {
    if (IGNORED_CODES.has(error.code)) ignored.push(error)
    else if (error.severity === 'warning') continue
    else if (FATAL_CODES.has(error.code)) fatal.push(error)
    else warnings.push(error)
  }
  return { fatal, warnings, ignored }
}
