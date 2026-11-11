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
    occurrences: withChip ? [{ source: 'artifact-edit', ref: 'artifact-edit:s1:rev2', offset: 0, length: 1 }] : [],
  }
}

test('waits for the plain phase and the new chip before submitting once', async () => {
  let calls = 0
  let submitted = 0
  let consumed = false
  const access = {
    readInput: () => {
      calls += 1
      // Busy for the first two probes, then plain and chipped (chip insert is async).
      if (calls === 1) return state('busy', false)
      if (calls === 2) return state('plain', false)
      return state('plain', true)
    },
    inputFor: () => undefined,
    submit: () => { submitted += 1; consumed = true },
    isSubmitted: () => consumed,
  }
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
    isSubmitted: () => false,
  }
  const ok = await requestArtifactAutoSubmit(access, 's1', 'artifact-edit:s1:rev2', { retries: 2, intervalMs: 1 })
  assert.equal(ok, false)
  assert.equal(submitted, 0)
})

test('Phase A MAJOR-5: a pressed Send that the send path never confirms is not reported submitted', async () => {
  let submitted = 0
  const access = {
    readInput: () => state('plain', true),
    inputFor: () => undefined,
    submit: () => { submitted += 1 },
    // The codec never ran (e.g. it threw), so the draft stays un-submitted.
    isSubmitted: () => false,
  }
  assert.equal(await requestArtifactAutoSubmit(access, 's1', 'artifact-edit:s1:rev2', { retries: 1, intervalMs: 1, confirmRetries: 3 }), false)
  assert.equal(submitted, 1, 'the probe did press Send once')
})

test('reports failure when submit throws and keeps the caller in control', async () => {
  const access = {
    readInput: () => state('plain', true),
    inputFor: () => undefined,
    submit: () => { throw new Error('composer busy') },
    isSubmitted: () => false,
  }
  assert.equal(await requestArtifactAutoSubmit(access, 's1', 'artifact-edit:s1:rev2', { retries: 1, intervalMs: 1 }), false)
})

test('user prose beside the chip blocks the post-Apply auto-submit', () => {
  assert.equal(composerHasPlainText({ draft: '', occurrences: [{ length: 1 }] }), false, 'an empty draft with only the chip is fine')
  assert.equal(composerHasPlainText({ draft: 'chip', occurrences: [{ offset: 0, length: 4 }] }), false, 'chip label text is not user prose')
  assert.equal(composerHasPlainText({ draft: 'chip 请先看这段', occurrences: [{ offset: 0, length: 4 }] }), true, 'text beside the chip is user prose')
})

test('Phase A MAJOR-3: other chips and their generated separators are not user prose', () => {
  // Two adjacent chips insert one separator space; only chips remain.
  assert.equal(composerHasPlainText({
    draft: 'chip-one chip-two ',
    occurrences: [{ offset: 0, length: 8 }, { offset: 9, length: 8 }],
  }), false, 'two chips with a generated separator are still a chip-only draft')
  assert.equal(composerHasPlainText({
    draft: 'chip-one chip-two 请继续',
    occurrences: [{ offset: 0, length: 8 }, { offset: 9, length: 8 }],
  }), true, 'real prose after the chips is still detected')
  // Attachment chips are occurrences of their own source and are excluded too.
  assert.equal(composerHasPlainText({
    draft: '@notes.md chip-one',
    occurrences: [{ offset: 0, length: 9 }, { offset: 10, length: 8 }],
  }), false, 'attachment and draft chips are not prose')
})

test('a missing submit verb reports failure instead of pretending to send', async () => {
  const access = {
    readInput: () => state('plain', true),
    inputFor: () => undefined,
    isSubmitted: () => true,
  }
  assert.equal(await requestArtifactAutoSubmit(access, 's1', 'artifact-edit:s1:rev2', { retries: 1, intervalMs: 1 }), false)
})

test('a missing confirmation seat downgrades to manual instead of faking success', async () => {
  let submitted = 0
  const access = {
    readInput: () => state('plain', true),
    inputFor: () => undefined,
    submit: () => { submitted += 1 },
  }
  assert.equal(await requestArtifactAutoSubmit(access, 's1', 'artifact-edit:s1:rev2', { retries: 1, intervalMs: 1 }), false)
  assert.equal(submitted, 0, 'without a confirmation seat Send is never pressed')
})
