/**
 * Unit tests for the M3-2 client-owned restored revision cards.
 *
 * Run: node --test test/client/local-revisions.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_LOCAL_REVISIONS,
  addLocalRevision,
  clearLocalRevisions,
  localRevisionProgram,
  localRevisionsFor,
  restoreRevision,
} from '../../src/client/artifact-edit/local-revisions.ts'

function revision(id, revisionNumber = 2, overrides = {}) {
  return {
    artifactId: 'call_1',
    sourceRevisionId: 'call_1',
    revisionId: id,
    revision: revisionNumber,
    program: 'root = Col([Title("restored")])',
    title: 'Restored',
    style: 'card',
    createdAt: Date.now() + revisionNumber,
    ...overrides,
  }
}

test('restored revisions stay local, replace by id and are capped', () => {
  clearLocalRevisions('chat-a')
  addLocalRevision('chat-a', revision('restore_a', 2))
  addLocalRevision('chat-a', revision('restore_a', 3))
  assert.equal(localRevisionsFor('chat-a').length, 1)
  assert.equal(localRevisionsFor('chat-a')[0].revision, 3)
  for (let index = 0; index < MAX_LOCAL_REVISIONS + 3; index += 1) {
    addLocalRevision('chat-a', revision(`restore_${index}`, index + 2))
  }
  const kept = localRevisionsFor('chat-a')
  assert.equal(kept.length, MAX_LOCAL_REVISIONS)
  assert.equal(kept.at(-1).revisionId, `restore_${MAX_LOCAL_REVISIONS + 2}`)
  clearLocalRevisions('chat-a')
  assert.equal(localRevisionsFor('chat-a').length, 0)
})

test('a local revision converts to an editable, exportable card program', () => {
  const program = localRevisionProgram(revision('restore_b', 4))
  assert.equal(program.callId, 'restore_b')
  assert.equal(program.localRevision, true)
  assert.equal(program.artifactId, 'call_1')
  assert.equal(program.revisionId, 'restore_b')
  assert.equal(program.baseRevisionId, 'call_1')
  assert.equal(program.revision, 4)
  assert.equal(program.running, false)
  assert.equal(program.style, 'card')
})

test('restoreRevision posts the source identity and maps the host revision', async () => {
  let body
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body)
    return new Response(JSON.stringify({
      ok: true,
      revision: {
        artifactId: 'call_1',
        revisionId: 'restore_c',
        baseRevisionId: 'call_old',
        revision: 7,
        program: 'root = Col([Text("old")])',
        title: 'Old page',
        style: 'article',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const restored = await restoreRevision({ artifactId: 'call_1', sourceRevisionId: 'call_old', program: 'root = Col([Text("old")])' })
  assert.equal(body.schemaVersion, 1)
  assert.equal(body.sourceRevisionId, 'call_old')
  assert.ok(restored)
  assert.equal(restored.revisionId, 'restore_c')
  assert.equal(restored.revision, 7)
  assert.equal(restored.sourceRevisionId, 'call_old')
  assert.equal(restored.style, 'article')
  assert.equal(restored.program, 'root = Col([Text("old")])')

  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'already_latest' } }), { status: 409 })
  assert.equal(await restoreRevision({ artifactId: 'call_1', sourceRevisionId: 'call_new', program: 'x' }), undefined)
})
