/**
 * Unit tests for the M1 artifact version store (active stage + visibility
 * fallback). The registration/role rules are pure reducers, so they are tested
 * without React or DOM; the module store is then exercised through its public
 * registration/selection/deletion entry points.
 *
 * Run: node --test test/client/artifact-version.test.mjs
 */
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_ARTIFACT_VERSION_STATE,
  artifactCardRole,
  artifactVersionFor,
  forgetArtifactRevision,
  forgetRevisionInState,
  isArtifactVersionStageEnabled,
  latestRecord,
  registerArtifactVersionCard,
  registerCardInState,
  resetArtifactVersions,
  selectArtifactRevision,
  selectRevisionInState,
  selectedArtifactRevisionIds,
  setArtifactStageVisibility,
  setArtifactVersionStageEnabled,
  setStageVisibilityInState,
  stageProgramFor,
  stagedArtifactIds,
  unregisterCardInState,
} from '../../src/client/artifact-edit/artifact-version.ts'

const SESSION = 's-version'
const ARTIFACT = 'call_stage'

/** One card spec for the fixture artifact. */
function card(overrides = {}) {
  return {
    cardId: 'card-1',
    artifactId: ARTIFACT,
    revisionId: 'rev-1',
    revision: 1,
    turn: 1,
    program: 'root = Col([Title("v1")])',
    title: 'Stage fixture',
    style: 'card',
    ...overrides,
  }
}

/** Fold a sequence of card registrations into one artifact state. */
function registerAll(specs) {
  let state = EMPTY_ARTIFACT_VERSION_STATE
  let seq = 0
  for (const spec of specs) {
    seq += 1
    state = registerCardInState(state, spec, seq)
  }
  return state
}

beforeEach(() => {
  resetArtifactVersions()
  setArtifactVersionStageEnabled(true)
})

test('the first card becomes the stage and selects the latest known revision', () => {
  const state = registerAll([card()])
  assert.equal(state.stageCardId, 'card-1')
  assert.equal(state.selectedRevisionId, 'rev-1')
  assert.equal(state.latestRevisionId, 'rev-1')
  assert.equal(state.stageVisible, false, 'visibility is reported by the observer, not assumed')
  assert.equal(artifactCardRole(state, 'card-1'), 'stage')
})

test('a visible stage updates in place: the new card is a notice and selection advances', () => {
  let state = registerAll([card()])
  state = setStageVisibilityInState(state, true)
  state = registerCardInState(state, card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2, program: 'root = Col([Title("v2")])' }), 2)
  assert.equal(state.stageCardId, 'card-1', 'the stage card identity is stable')
  assert.equal(state.latestRevisionId, 'rev-2')
  assert.equal(state.selectedRevisionId, 'rev-2', 'the next stage render shows the new revision')
  assert.equal(artifactCardRole(state, 'card-2'), 'notice')
  assert.equal(state.stageVisible, true)
})

test('an invisible stage hands over: the new card promotes and the old one freezes', () => {
  let state = registerAll([card()])
  state = setStageVisibilityInState(state, false)
  state = registerCardInState(state, card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 }), 2)
  assert.equal(state.stageCardId, 'card-2')
  assert.equal(state.latestRevisionId, 'rev-2')
  assert.equal(state.selectedRevisionId, 'rev-2')
  assert.equal(state.stageVisible, false)
  assert.equal(artifactCardRole(state, 'card-1'), 'frozen')
  assert.equal(artifactCardRole(state, 'card-2'), 'stage')
})

test('initial load converges to the latest loaded card as the stage', () => {
  const state = registerAll([
    card(),
    card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 }),
    card({ cardId: 'card-3', revisionId: 'rev-3', revision: 3, turn: 3 }),
  ])
  assert.equal(state.stageCardId, 'card-3')
  assert.equal(state.latestRevisionId, 'rev-3')
  assert.equal(state.selectedRevisionId, 'rev-3')
  assert.equal(artifactCardRole(state, 'card-1'), 'frozen')
  assert.equal(artifactCardRole(state, 'card-2'), 'frozen')
  assert.equal(artifactCardRole(state, 'card-3'), 'stage')
})

test('older revisions registering after the stage become frozen cards', () => {
  let state = registerAll([
    card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 }),
    card({ cardId: 'card-3', revisionId: 'rev-3', revision: 3, turn: 3 }),
  ])
  state = setStageVisibilityInState(state, true)
  state = registerCardInState(state, card({ cardId: 'card-1', revisionId: 'rev-1', revision: 1, turn: 1 }), 4)
  assert.equal(state.stageCardId, 'card-3', 'an old card never steals the stage')
  assert.equal(artifactCardRole(state, 'card-1'), 'frozen')
  assert.equal(state.selectedRevisionId, 'rev-3')
})

test('the stage card re-registering keeps its role and repairs a stale selection', () => {
  let state = registerAll([card(), card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 })])
  state = setStageVisibilityInState(state, true)
  state = selectRevisionInState(state, 'rev-1')
  assert.equal(state.stageCardId, 'card-2')
  // The stage card re-registers with the same revision (e.g. a re-render).
  state = registerCardInState(state, card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 }), 3)
  assert.equal(state.stageCardId, 'card-2')
  assert.equal(state.selectedRevisionId, 'rev-1', 'a re-render keeps the selected revision')
  // A fallback redirect makes the stage card re-register with an older revision;
  // it must keep the stage role instead of handing over to a notice.
  state = forgetRevisionInState(state, 'rev-2')
  state = registerCardInState(state, card({ cardId: 'card-2', revisionId: 'rev-1', revision: 1, turn: 2 }), 4)
  assert.equal(state.stageCardId, 'card-2')
  assert.equal(state.selectedRevisionId, 'rev-1')
  assert.equal(artifactCardRole(state, 'card-2'), 'stage')
})

test('unregistering the stage promotes the newest remaining card and selects latest', () => {
  let state = registerAll([
    card(),
    card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 }),
    card({ cardId: 'card-3', revisionId: 'rev-3', revision: 3, turn: 3 }),
  ])
  state = unregisterCardInState(state, 'card-3')
  assert.equal(state.stageCardId, 'card-2', 'the newest remaining card takes over')
  assert.equal(state.selectedRevisionId, 'rev-3', 'selection stays on the latest known revision')
  state = unregisterCardInState(state, 'card-2')
  assert.equal(state.stageCardId, 'card-1')
  assert.equal(state.selectedRevisionId, 'rev-3')
  state = unregisterCardInState(state, 'card-1')
  assert.equal(state.stageCardId, undefined, 'no cards left clears the stage')
  assert.equal(state.selectedRevisionId, undefined, 'the artifact is forgotten so a remount converges from loaded cards')
  assert.equal(state.revisions.size, 0)
})

test('a full remount re-converges on the newest loaded revision after the artifact was forgotten', () => {
  let state = registerAll([
    card(),
    card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 }),
    card({ cardId: 'card-3', revisionId: 'rev-3', revision: 3, turn: 3 }),
  ])
  state = setStageVisibilityInState(state, true)
  state = selectRevisionInState(state, 'rev-1')
  // Unmount every card (Turn window/remount), then register them again in order.
  state = unregisterCardInState(state, 'card-1')
  state = unregisterCardInState(state, 'card-2')
  state = unregisterCardInState(state, 'card-3')
  assert.equal(state.revisions.size, 0)
  state = registerCardInState(state, card(), 10)
  assert.equal(state.stageCardId, 'card-1', 'the first re-registered card starts the convergence')
  state = registerCardInState(state, card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 }), 11)
  state = registerCardInState(state, card({ cardId: 'card-3', revisionId: 'rev-3', revision: 3, turn: 3 }), 12)
  assert.equal(state.stageCardId, 'card-3', 'the newest loaded card ends up as the stage')
  assert.equal(state.selectedRevisionId, 'rev-3', 'D6: a remount returns to the latest revision')
  assert.equal(state.stageVisible, false)
})

test('unregistering a non-stage card never changes the stage', () => {
  let state = registerAll([card(), card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 })])
  state = unregisterCardInState(state, 'card-1')
  assert.equal(state.stageCardId, 'card-2')
  assert.equal(state.selectedRevisionId, 'rev-2')
})

test('same-revision cards fall back to turn order for their role', () => {
  const state = registerAll([
    card({ cardId: 'early', revisionId: 'rev-same', revision: 2, turn: 1 }),
    card({ cardId: 'late', revisionId: 'rev-same', revision: 2, turn: 2 }),
    card({ cardId: 'stage', revisionId: 'rev-3', revision: 3, turn: 3 }),
  ])
  assert.equal(state.stageCardId, 'stage')
  assert.equal(artifactCardRole(state, 'early'), 'frozen')
  assert.equal(artifactCardRole(state, 'late'), 'frozen', 'same revision as the owned cards is older than the stage own revision')
})

test('selectRevision only accepts known revisions and is a no-op when unchanged', () => {
  let state = registerAll([card(), card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 })])
  state = setStageVisibilityInState(state, true)
  assert.equal(selectRevisionInState(state, 'missing'), state)
  assert.equal(selectRevisionInState(state, 'rev-2'), state)
  const selected = selectRevisionInState(state, 'rev-1')
  assert.equal(selected.selectedRevisionId, 'rev-1')
  assert.equal(selected.stageCardId, 'card-2', 'selection does not change the stage card')
  assert.equal(artifactCardRole(selected, 'card-1'), 'frozen')
})

test('forgetting a deleted revision repoints latest and selection at a live record', () => {
  let state = registerAll([card(), card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 })])
  state = forgetRevisionInState(state, 'rev-2')
  assert.equal(state.latestRevisionId, 'rev-1')
  assert.equal(state.selectedRevisionId, 'rev-1')
  assert.equal(state.stageCardId, 'card-2', 'the stage card keeps its DOM identity')
})

test('forgetting a revision with a prepared fallback registers the fallback record', () => {
  let state = registerAll([card(), card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 })])
  state = forgetRevisionInState(state, 'rev-2', {
    deletedRevisionId: 'rev-2',
    artifactId: ARTIFACT,
    revisionId: 'rev-1',
    revision: 1,
    program: 'root = Col([Title("fallback")])',
    title: 'Fallback',
    style: 'card',
    createdAt: 1,
  })
  assert.equal(state.latestRevisionId, 'rev-1')
  assert.equal(state.revisions.get('rev-1').program, 'root = Col([Title("fallback")])')
  assert.equal(state.selectedRevisionId, 'rev-1')
})

test('stageProgramFor keeps the DOM callId while every revision identity comes from the record', () => {
  let state = registerAll([card(), card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2, styleId: 'cs_ocean01', title: 'v2 title' })])
  state = setStageVisibilityInState(state, true)
  const record = state.revisions.get('rev-2')
  const program = stageProgramFor(
    { callId: 'card-1', program: 'root = Col([Title("card own")])', running: false, title: 'card title' },
    record,
  )
  assert.equal(program.callId, 'card-1', 'the stage keeps its own DOM identity')
  assert.equal(program.program, record.program)
  assert.equal(program.revisionId, 'rev-2')
  assert.equal(program.artifactId, ARTIFACT)
  assert.equal(program.revision, 2)
  assert.equal(program.styleId, 'cs_ocean01')
  assert.equal(program.title, 'v2 title')
})

test('stageProgramFor carries local revision provenance for the stage card badge', () => {
  const state = registerAll([
    card(),
    card({
      cardId: 'local-rev-2',
      revisionId: 'local-rev-2',
      revision: 2,
      turn: 1,
      localRevision: true,
      localRevisionKind: 'structure',
    }),
  ])
  const program = stageProgramFor(
    { callId: 'card-1', program: 'root = Col([])', running: false },
    state.revisions.get('local-rev-2'),
  )
  assert.equal(program.localRevision, true)
  assert.equal(program.localRevisionKind, 'structure')
})

test('latestRecord prefers the revision number and then registration order', () => {
  const revisions = new Map([
    ['a', { revisionId: 'a', artifactId: ARTIFACT, revision: 2, program: 'root = Col([])', style: 'card', callId: 'a', seq: 9 }],
    ['b', { revisionId: 'b', artifactId: ARTIFACT, revision: 2, program: 'root = Col([])', style: 'card', callId: 'b', seq: 10 }],
    ['c', { revisionId: 'c', artifactId: ARTIFACT, revision: 1, program: 'root = Col([])', style: 'card', callId: 'c', seq: 11 }],
  ])
  assert.equal(latestRecord(revisions).revisionId, 'b')
  assert.equal(latestRecord(new Map()), undefined)
})

test('the module store registers, promotes with visibility and unregisters', () => {
  const first = registerArtifactVersionCard(SESSION, card())
  let state = artifactVersionFor(SESSION, ARTIFACT)
  assert.equal(state.stageCardId, 'card-1')
  assert.equal(isArtifactVersionStageEnabled(), true)

  setArtifactStageVisibility(SESSION, ARTIFACT, 'card-1', true)
  const second = registerArtifactVersionCard(SESSION, card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 }))
  state = artifactVersionFor(SESSION, ARTIFACT)
  assert.equal(state.stageCardId, 'card-1')
  assert.equal(state.selectedRevisionId, 'rev-2')
  assert.equal(artifactCardRole(state, 'card-2'), 'notice')

  second()
  state = artifactVersionFor(SESSION, ARTIFACT)
  assert.equal(state.cards.has('card-2'), false)
  assert.equal(state.latestRevisionId, 'rev-2', 'known revisions survive card unmounts')
  first()
  state = artifactVersionFor(SESSION, ARTIFACT)
  assert.equal(state.stageCardId, undefined)
  assert.deepEqual(stagedArtifactIds(SESSION), [])
})

test('the module store selection, deletion and session queries stay consistent', () => {
  registerArtifactVersionCard(SESSION, card())
  registerArtifactVersionCard(SESSION, card({ cardId: 'card-2', revisionId: 'rev-2', revision: 2, turn: 2 }))
  assert.equal(selectArtifactRevision(SESSION, ARTIFACT, 'rev-1'), true)
  assert.equal(selectArtifactRevision(SESSION, ARTIFACT, 'rev-1'), false, 'unchanged selection is a no-op')
  assert.equal(selectArtifactRevision(SESSION, ARTIFACT, 'missing'), false)
  assert.equal(artifactVersionFor(SESSION, ARTIFACT).selectedRevisionId, 'rev-1')
  assert.deepEqual([...selectedArtifactRevisionIds(SESSION)].sort(), ['rev-1', 'rev-2'])

  forgetArtifactRevision(SESSION, ARTIFACT, 'rev-2')
  const state = artifactVersionFor(SESSION, ARTIFACT)
  assert.equal(state.latestRevisionId, 'rev-1')
  assert.equal(state.selectedRevisionId, 'rev-1')
})

test('disabling the stage switch makes registrations no-ops (browser harness switch)', () => {
  setArtifactVersionStageEnabled(false)
  const release = registerArtifactVersionCard(SESSION, card())
  assert.equal(artifactVersionFor(SESSION, ARTIFACT), EMPTY_ARTIFACT_VERSION_STATE)
  assert.equal(setArtifactStageVisibility(SESSION, ARTIFACT, 'card-1', true), undefined)
  assert.equal(selectArtifactRevision(SESSION, ARTIFACT, 'rev-1'), false)
  release()
  setArtifactVersionStageEnabled(true)
  assert.equal(isArtifactVersionStageEnabled(), true)
})
