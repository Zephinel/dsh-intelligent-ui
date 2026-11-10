/**
 * Unit tests for the post-Apply composer submit probe (task-11).
 *
 * Run: node --test test/client/artifact-edit-auto-submit.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composerHasPlainText, requestArtifactAutoSubmit } from '../../src/client/artifact-edit/composer.ts'

/** One composer state with (or without) the artifact-edit chip. */
function state(phase, withChip) {
  return {
    phase,
    occurrences: withChip ? [{ source: 'artifact-edit', ref: 'artifact-edit:s1:rev2' }] : [],
  }
}

test('waits for the plain phase and the new chip before submitting once', async () => {
  let calls = 0
  let phase = 'busy'
  const access = {
    readInput: () => {
      calls += 1
      // Busy for the first two probes, then plain and chipped (chip insert is async).
      if (calls === 1) return state('busy', false)
      if (calls === 2) return state('plain', false)
      phase = 'plain'
      return state(phase, true)
    },
    inputFor: () => undefined,
    submit: () => { submitted += 1 },
  }
  let submitted = 0
  const ok = await requestArtifactAutoSubmit(access, 's1', 'artifact-edit:s1:rev2', { retries: 5, intervalMs: 1 })
  assert.equal(ok, true)
  assert.equal(submitted, 1, 'submits exactly once after the conditions settle')
  assert.ok(calls >= 3)
})

test('gives up without submitting when the composer never becomes ready', async () => {
  let submitted = 0
  const access = {
    readInput: () => state('busy', false),
    inputFor: () => undefined,
    submit: () => { submitted += 1 },
  }
  const ok = await requestArtifactAutoSubmit(access, 's1', 'artifact-edit:s1:rev2', { retries: 2, intervalMs: 1 })
  assert.equal(ok, false)
  assert.equal(submitted, 0)
})

test('reports failure when submit throws and keeps the caller in control', async () => {
  const access = {
    readInput: () => state('plain', true),
    inputFor: () => undefined,
    submit: () => { throw new Error('composer busy') },
  }
  assert.equal(await requestArtifactAutoSubmit(access, 's1', 'artifact-edit:s1:rev2', { retries: 1, intervalMs: 1 }), false)
})

test('user text beside the chip blocks the post-Apply auto-submit', () => {
  assert.equal(composerHasPlainText({ draft: '', occurrences: [{ length: 1 }] }), false, 'an empty draft with only the chip is fine')
  assert.equal(composerHasPlainText({ draft: 'chip', occurrences: [{ length: 4 }] }), false, 'chip label text is not user prose')
  assert.equal(composerHasPlainText({ draft: 'chip 请先看这段', occurrences: [{ length: 4 }] }), true, 'text beside the chip is user prose')
})

test('a missing submit verb reports failure instead of pretending to send', async () => {
  const access = {
    readInput: () => state('plain', true),
    inputFor: () => undefined,
  }
  assert.equal(await requestArtifactAutoSubmit(access, 's1', 'artifact-edit:s1:rev2', { retries: 1, intervalMs: 1 }), false)
})
