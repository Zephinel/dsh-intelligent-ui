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
  deleteArtifactRevision,
  isStyleSwitchRevision,
  localRevisionProgram,
  localRevisionsFor,
  removeLocalRevision,
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

test('removeLocalRevision deletes one local card only', () => {
  clearLocalRevisions('chat-remove')
  addLocalRevision('chat-remove', revision('restore_a', 2))
  addLocalRevision('chat-remove', revision('restore_b', 3))
  removeLocalRevision('chat-remove', 'restore_a')
  assert.deepEqual(localRevisionsFor('chat-remove').map(item => item.revisionId), ['restore_b'])
  removeLocalRevision('chat-remove', 'missing')
  assert.equal(localRevisionsFor('chat-remove').length, 1)
})

test('deleteArtifactRevision sends DELETE and maps the host outcome', async () => {
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init.method })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  assert.equal(await deleteArtifactRevision('call_1', 'struct_abcdef0123456789'), 'deleted')
  assert.match(requests[0].url, /artifact-revisions\?artifactId=call_1&revisionId=struct_abcdef0123456789/)
  assert.equal(requests[0].method, 'DELETE')
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'revision_referenced' } }), { status: 409 })
  assert.equal(await deleteArtifactRevision('call_1', 'call_2'), 'referenced')
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'revision_missing' } }), { status: 404 })
  assert.equal(await deleteArtifactRevision('call_1', 'call_3'), 'missing')
  globalThis.fetch = async () => new Response('nope', { status: 500 })
  assert.equal(await deleteArtifactRevision('call_1', 'call_4'), 'failed')
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

test('a style-switch revision is recognized for the history label', () => {
  // B2 switches are `struct_` revisions that change no block.
  assert.equal(isStyleSwitchRevision({ source: 'structure', revisionId: 'struct_abcdef0123456789' }), true)
  assert.equal(isStyleSwitchRevision({ source: 'structure', revisionId: 'struct_abcdef0123456789', editedBlockIds: [] }), true)
  assert.equal(isStyleSwitchRevision({ source: 'structure', revisionId: 'struct_abcdef0123456789', editedBlockIds: ['b2'] }), false)
  // A render_ui order-only/global-only revision is also source 'structure' with
  // no edited blocks, but its id is the model call id: not a style switch.
  assert.equal(isStyleSwitchRevision({ source: 'structure', revisionId: 'call_order_only', editedBlockIds: [] }), false)
  assert.equal(isStyleSwitchRevision({ source: 'edit', revisionId: 'call_edit_2' }), false)
  assert.equal(isStyleSwitchRevision({ source: 'initial', revisionId: 'call_1' }), false)
})

test('a local style revision converts to the style revision kind', () => {
  const program = localRevisionProgram(revision('style_rev', 2, { kind: 'style', style: 'article' }))
  assert.equal(program.localRevisionKind, 'style')
  assert.equal(program.style, 'article')
  assert.equal(program.revision, 2)
})
