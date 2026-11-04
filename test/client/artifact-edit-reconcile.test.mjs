/**
 * Unit tests for M3-1c: submitted-draft reconciliation after a finished Turn.
 *
 * Run: node --test test/client/artifact-edit-reconcile.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DST_PROGRAM, DST_TITLE } from '../browser/fixtures/dst-artifact.ts'
import {
  editKey,
  editSessionFor,
  installArtifactComposerBridge,
  openArtifactBlockEditor,
  openArtifactEditor,
  reconcileArtifactSubmissions,
  referenceForSession,
  saveArtifactBlockInstruction,
  serializeArtifactEditRequest,
  submittedDraftsFor,
} from '../../src/client/artifact-edit/store.ts'
import { translate, en } from '../../src/shared/locales.ts'

installArtifactComposerBridge({
  canEditChip: () => true,
  upsertChip: () => {},
  removeChip: () => {},
  openRequest: () => true,
}, translate(en))

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

function programFor(callId) {
  return { callId, program: DST_PROGRAM, title: DST_TITLE, style: 'card', running: false }
}

async function submitDraft(sessionId, callId) {
  globalThis.fetch = async () => new Response(JSON.stringify({
    artifactId: callId, revisionId: callId, revision: 1, latestRevisionId: callId, latestRevision: 1, conflict: false,
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  openArtifactEditor(sessionId, programFor(callId))
  await settle()
  const key = editKey(sessionId, callId)
  openArtifactBlockEditor(key, 'b3')
  saveArtifactBlockInstruction(key, 'b3', 'change the clock')
  const outcome = await serializeArtifactEditRequest(referenceForSession(key))
  assert.equal(outcome.ok, true)
  return { key, requestId: outcome.request.requestId }
}

test('an unfulfilled submitted draft returns as a failed, detached draft', async () => {
  const sessionId = 'reconcile-unfulfilled'
  const { key, requestId } = await submitDraft(sessionId, 'call_r1')
  assert.deepEqual(submittedDraftsFor(sessionId).map(entry => entry.requestId), [requestId])
  const restored = reconcileArtifactSubmissions(sessionId, [])
  assert.equal(restored, 1)
  const session = editSessionFor(sessionId, 'call_r1')
  assert.ok(session)
  assert.equal(session.status, 'ready')
  assert.equal(session.submitFailed, true)
  assert.equal(session.attached, false)
  assert.equal(session.editing, false)
  assert.notEqual(session.requestId, requestId)
  assert.equal(editKey(sessionId, 'call_r1'), key)
  assert.equal(submittedDraftsFor(sessionId).length, 0)
})

test('a fulfilled submitted draft is removed instead of restored', async () => {
  const sessionId = 'reconcile-fulfilled'
  const { requestId } = await submitDraft(sessionId, 'call_r2')
  const restored = reconcileArtifactSubmissions(sessionId, [requestId])
  assert.equal(restored, 0)
  assert.equal(editSessionFor(sessionId, 'call_r2'), undefined)
  assert.equal(submittedDraftsFor(sessionId).length, 0)
})

test('mixed outcomes reconcile each submitted draft independently', async () => {
  const sessionId = 'reconcile-mixed'
  const first = await submitDraft(sessionId, 'call_r3')
  const second = await submitDraft(sessionId, 'call_r4')
  const restored = reconcileArtifactSubmissions(sessionId, [first.requestId])
  assert.equal(restored, 1)
  assert.equal(editSessionFor(sessionId, 'call_r3'), undefined)
  const survivor = editSessionFor(sessionId, 'call_r4')
  assert.ok(survivor)
  assert.equal(survivor.submitFailed, true)
  assert.notEqual(survivor.requestId, second.requestId)
})

test('historical Turns do not reconcile newer submissions', async () => {
  const sessionId = 'reconcile-window'
  const { requestId } = await submitDraft(sessionId, 'call_r5')
  // An older closed Turn ended long before this submission.
  assert.equal(reconcileArtifactSubmissions(sessionId, [], { until: Date.now() - 60_000 }), 0)
  assert.equal(submittedDraftsFor(sessionId)[0].requestId, requestId)
  // The Turn that actually owns the submission reconciles it.
  assert.equal(reconcileArtifactSubmissions(sessionId, [], { since: Date.now() - 60_000, until: Date.now() + 60_000 }), 1)
  assert.equal(submittedDraftsFor(sessionId).length, 0)
})
