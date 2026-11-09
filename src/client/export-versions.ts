/**
 * Export-time program resolution against the M1/M2 artifact version store (D8).
 *
 * The live stage renders the artifact's selected revision, so exporting must use
 * that revision's program/title/style instead of the message's original recording
 * (a suppressed revision card may only exist as a notice row). When the store has
 * no selected revision for the artifact, the recorded program is exported as-is
 * (the pre-M1 behavior).
 */
import type { IntelligentUIProgram } from '../shared/intelligent-ui.ts'
import { artifactVersionFor, stageProgramFor } from './artifact-edit/artifact-version.ts'

/** Root artifact identity one recorded program belongs to. */
export function artifactIdOfProgram(program: Pick<IntelligentUIProgram, 'artifactId' | 'callId'>): string {
  return program.artifactId ?? program.callId
}

/**
 * Replace one recorded program with the artifact's currently displayed revision.
 * @param sessionId - chat session owning the version store (undefined in pure callers).
 * @param program - recorded render_ui program of the exported message.
 * @returns the selected revision's program (same DOM callId) or the original program.
 */
export function selectedRevisionProgram(sessionId: string | undefined, program: IntelligentUIProgram): IntelligentUIProgram {
  if (sessionId === undefined || sessionId === '') return program
  const state = artifactVersionFor(sessionId, artifactIdOfProgram(program))
  const record = state.selectedRevisionId === undefined ? undefined : state.revisions.get(state.selectedRevisionId)
  return record === undefined ? program : stageProgramFor(program, record)
}

/**
 * Resolve every exported program to its artifact's currently displayed revision.
 * @param sessionId - chat session owning the version store.
 * @param programs - recorded programs of the exported message, in order.
 * @returns one resolved program per input, order preserved.
 */
export function programsForExport(sessionId: string | undefined, programs: readonly IntelligentUIProgram[]): IntelligentUIProgram[] {
  return programs.map(program => selectedRevisionProgram(sessionId, program))
}
