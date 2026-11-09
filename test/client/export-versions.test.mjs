/**
 * Unit tests for D8 export-time revision resolution: the exported program
 * follows the artifact's selected revision, and falls back to the recorded
 * program when the version store does not know the artifact.
 *
 * Run: node --test test/client/export-versions.test.mjs
 */
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  artifactVersionFor,
  registerArtifactRevision,
  resetArtifactVersions,
  selectArtifactRevision,
  setArtifactVersionStageEnabled,
} from '../../src/client/artifact-edit/artifact-version.ts'
import { artifactIdOfProgram, programsForExport, selectedRevisionProgram } from '../../src/client/export-versions.ts'

const SESSION = 's-export'
const ARTIFACT = 'call_export'

/** One recorded render_ui program of the exported message. */
function rawProgram(overrides = {}) {
  return {
    callId: 'turn-call-1',
    program: 'root = Col([Title("recorded")])',
    title: 'Recorded title',
    style: 'card',
    artifactId: ARTIFACT,
    revisionId: 'rev-3',
    revision: 3,
    running: false,
    ...overrides,
  }
}

beforeEach(() => {
  resetArtifactVersions()
  setArtifactVersionStageEnabled(true)
})

test('the recorded program is exported unchanged when the store does not know the artifact', () => {
  const program = rawProgram()
  assert.equal(selectedRevisionProgram(SESSION, program), program)
  assert.equal(selectedRevisionProgram(undefined, program), program)
})

test('the selected revision replaces the recorded program while keeping the DOM callId', () => {
  registerArtifactRevision(SESSION, ARTIFACT, {
    revisionId: 'rev-2',
    artifactId: ARTIFACT,
    revision: 2,
    program: 'root = Col([Title("selected older")])',
    title: 'Selected title',
    style: 'card',
    styleId: 'cs_saved1',
  })
  registerArtifactRevision(SESSION, ARTIFACT, {
    revisionId: 'rev-3',
    artifactId: ARTIFACT,
    revision: 3,
    program: 'root = Col([Title("latest")])',
    title: 'Latest title',
    style: 'card',
  })
  assert.equal(selectArtifactRevision(SESSION, ARTIFACT, 'rev-2'), true)
  assert.equal(artifactVersionFor(SESSION, ARTIFACT).selectedRevisionId, 'rev-2')
  const resolved = selectedRevisionProgram(SESSION, rawProgram())
  assert.equal(resolved.callId, 'turn-call-1', 'the exported card identity is stable')
  assert.match(resolved.program, /selected older/)
  assert.match(resolved.program, /selected older/)
  assert.equal(resolved.title, 'Selected title')
  assert.equal(resolved.revisionId, 'rev-2')
  assert.equal(resolved.styleId, 'cs_saved1')
})

test('every program of a message resolves independently and keeps order', () => {
  registerArtifactRevision(SESSION, 'call_a', { revisionId: 'a1', artifactId: 'call_a', revision: 1, program: 'root = Col([Title("A-sel")])', style: 'card' })
  registerArtifactRevision(SESSION, 'call_b', { revisionId: 'b1', artifactId: 'call_b', revision: 1, program: 'root = Col([Title("B-sel")])', style: 'card' })
  selectArtifactRevision(SESSION, 'call_a', 'a1')
  const programs = [
    rawProgram({ callId: 'call_a', artifactId: 'call_a', program: 'root = Col([Title("A-raw")])' }),
    rawProgram({ callId: 'call_b', artifactId: 'call_b', program: 'root = Col([Title("B-raw")])' }),
    rawProgram({ callId: 'unknown', artifactId: undefined, program: 'root = Col([Title("C-raw")])' }),
  ]
  const resolved = programsForExport(SESSION, programs)
  assert.equal(resolved.length, 3)
  assert.match(resolved[0].program, /A-sel/)
  assert.match(resolved[1].program, /B-raw/)
  assert.match(resolved[2].program, /C-raw/)
  assert.deepEqual(resolved.map(program => program.callId), ['call_a', 'call_b', 'unknown'])
  assert.equal(artifactIdOfProgram(programs[0]), 'call_a')
  assert.equal(artifactIdOfProgram({ callId: 'only-call' }), 'only-call')
})
