/**
 * Unit tests for the update-prompt state machine and its persisted document.
 *
 * Run: node --test test/client/update-prompt.test.mjs
 *
 * The module is imported as TypeScript source: Node >= 22.18 strips type
 * annotations natively, so these tests need no browser and no build step.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideUpdatePrompt,
  noteUpdatePromptLater,
  offersSilence,
  parseUpdatePromptState,
  serializeUpdatePromptState,
  silenceUpdatePromptVersion,
  UPDATE_PROMPT_SCHEMA_VERSION,
} from '../../src/client/update-prompt.ts'

/** One Host answer with the shape the route serves. */
const view = (current, latest, highlights = []) => ({
  current,
  latest,
  updateAvailable: latest !== null && latest !== current,
  highlights,
})

test('the first explicit open records a newer version without prompting', () => {
  const decision = decideUpdatePrompt(view('0.6.1', '0.6.2', ['修正 A', '修正 B']), 'explicit-enable', {})
  assert.equal(decision.action, 'record')
  assert.deepEqual(decision.state, { pendingVersion: '0.6.2', pendingHighlights: ['修正 A', '修正 B'] })
})

test('the next explicit open prompts for the recorded version with its highlights', () => {
  const recorded = { pendingVersion: '0.6.2', pendingHighlights: ['修正 A'] }
  const decision = decideUpdatePrompt(view('0.6.1', '0.6.2', ['修正 A']), 'explicit-enable', recorded)
  assert.equal(decision.action, 'prompt')
  assert.deepEqual(decision.prompt, { current: '0.6.1', latest: '0.6.2', highlights: ['修正 A'], laterClicks: 0 })
  assert.deepEqual(decision.state, { pendingVersion: '0.6.2', pendingHighlights: ['修正 A'] })
})

test('fresh highlights win over recorded ones and are capped at six points', () => {
  const recorded = { pendingVersion: '0.6.2', pendingHighlights: ['旧要点'] }
  const highlights = ['一', '二', '三', '四', '五', '六', '七', '八']
  const decision = decideUpdatePrompt(view('0.6.1', '0.6.2', highlights), 'explicit-enable', recorded)
  assert.equal(decision.action, 'prompt')
  assert.deepEqual(decision.prompt.highlights, ['一', '二', '三', '四', '五', '六'])
})

test('a newer release keeps the later-click cycle only when the version matches', () => {
  const recorded = { pendingVersion: '0.6.2', laterVersion: '0.6.2', laterClicks: 3 }
  const decision = decideUpdatePrompt(view('0.6.1', '0.6.3'), 'explicit-enable', recorded)
  assert.equal(decision.action, 'prompt')
  assert.equal(decision.prompt.laterClicks, 0)
  assert.deepEqual(decision.state, { pendingVersion: '0.6.3' })
})

test('default-open prompts as soon as the check answers', () => {
  const decision = decideUpdatePrompt(view('0.6.1', '0.6.2', ['新增']), 'default-open', {})
  assert.equal(decision.action, 'prompt')
  assert.deepEqual(decision.prompt, { current: '0.6.1', latest: '0.6.2', highlights: ['新增'], laterClicks: 0 })
  assert.deepEqual(decision.state, { pendingVersion: '0.6.2', pendingHighlights: ['新增'] })
})

test('an up-to-date answer clears the recorded cycle', () => {
  const decision = decideUpdatePrompt(view('0.6.2', '0.6.2'), 'explicit-enable', {
    pendingVersion: '0.6.2',
    laterVersion: '0.6.2',
    laterClicks: 2,
  })
  assert.equal(decision.action, 'none')
  assert.deepEqual(decision.state, {})
})

test('a failed registry read still prompts for a recorded version that remains newer', () => {
  const recorded = { pendingVersion: '0.6.3', pendingHighlights: ['要点'] }
  const decision = decideUpdatePrompt(view('0.6.1', null), 'explicit-enable', recorded)
  assert.equal(decision.action, 'prompt')
  assert.deepEqual(decision.prompt, { current: '0.6.1', latest: '0.6.3', highlights: ['要点'], laterClicks: 0 })
})

test('a failed registry read does not prompt for a version the user already installed', () => {
  const decision = decideUpdatePrompt(view('0.6.3', null), 'explicit-enable', { pendingVersion: '0.6.3' })
  assert.equal(decision.action, 'none')
  assert.deepEqual(decision.state, {})
})

test('an unreadable running version is never compared against a recorded one', () => {
  const decision = decideUpdatePrompt(view('0.0.0', null), 'explicit-enable', { pendingVersion: '0.6.3' })
  assert.equal(decision.action, 'none')
  assert.deepEqual(decision.state, { pendingVersion: '0.6.3' })
})

test('a silenced version never prompts again and its pending record is settled', () => {
  const silenced = { silencedVersion: '0.6.2', pendingVersion: '0.6.2', laterVersion: '0.6.2', laterClicks: 4 }
  const explicit = decideUpdatePrompt(view('0.6.1', '0.6.2'), 'explicit-enable', silenced)
  assert.equal(explicit.action, 'none')
  assert.deepEqual(explicit.state, { silencedVersion: '0.6.2' })
  const fallback = decideUpdatePrompt(view('0.6.1', null), 'explicit-enable', silenced)
  assert.equal(fallback.action, 'none')
  assert.deepEqual(fallback.state, { silencedVersion: '0.6.2' })
})

test('silencing one version does not silence a later release', () => {
  const silenced = { silencedVersion: '0.6.2' }
  const first = decideUpdatePrompt(view('0.6.1', '0.6.3'), 'explicit-enable', silenced)
  assert.equal(first.action, 'record')
  assert.deepEqual(first.state, { silencedVersion: '0.6.2', pendingVersion: '0.6.3' })
  const second = decideUpdatePrompt(view('0.6.1', '0.6.3'), 'explicit-enable', first.state)
  assert.equal(second.action, 'prompt')
  assert.equal(second.prompt.latest, '0.6.3')
})

test('the silence marker clears once the installed version reaches it', () => {
  const decision = decideUpdatePrompt(view('0.6.2', '0.6.2'), 'explicit-enable', { silencedVersion: '0.6.2' })
  assert.deepEqual(decision.state, {})
})

test('later clicks accumulate per version and offer silence from the third click on', () => {
  let state = {}
  state = noteUpdatePromptLater(state, '0.6.2')
  assert.equal(offersSilence(state, '0.6.2'), false)
  state = noteUpdatePromptLater(state, '0.6.2')
  state = noteUpdatePromptLater(state, '0.6.2')
  assert.deepEqual(state, { laterVersion: '0.6.2', laterClicks: 3 })
  assert.equal(offersSilence(state, '0.6.2'), true)
  assert.equal(offersSilence(state, '0.6.3'), false)
  state = noteUpdatePromptLater(state, '0.6.3')
  assert.deepEqual(state, { laterVersion: '0.6.3', laterClicks: 1 })
})

test('the prompt re-opens with the accumulated later-click count', () => {
  const recorded = { pendingVersion: '0.6.2', laterVersion: '0.6.2', laterClicks: 3 }
  const decision = decideUpdatePrompt(view('0.6.1', '0.6.2'), 'explicit-enable', recorded)
  assert.equal(decision.action, 'prompt')
  assert.equal(decision.prompt.laterClicks, 3)
  assert.equal(offersSilence(decision.state, decision.prompt.latest), true)
})

test('silencing drops the whole cycle but keeps the version marker', () => {
  const state = silenceUpdatePromptVersion({
    pendingVersion: '0.6.2',
    pendingHighlights: ['要点'],
    laterVersion: '0.6.2',
    laterClicks: 3,
  }, '0.6.2')
  assert.deepEqual(state, { silencedVersion: '0.6.2' })
})

test('a stored document round-trips', () => {
  const state = {
    pendingVersion: '0.6.2',
    pendingHighlights: ['一', '二'],
    laterVersion: '0.6.2',
    laterClicks: 2,
    silencedVersion: '0.6.1',
  }
  assert.deepEqual(parseUpdatePromptState(serializeUpdatePromptState(state)), state)
  assert.deepEqual(parseUpdatePromptState(serializeUpdatePromptState({})), {})
})

test('corrupt, foreign and future documents reset to empty', () => {
  assert.deepEqual(parseUpdatePromptState('not json'), {})
  assert.deepEqual(parseUpdatePromptState(null), {})
  assert.deepEqual(parseUpdatePromptState(''), {})
  assert.deepEqual(parseUpdatePromptState('[]'), {})
  assert.deepEqual(parseUpdatePromptState(JSON.stringify({ schema: UPDATE_PROMPT_SCHEMA_VERSION + 1, pendingVersion: '0.6.2' })), {})
  assert.deepEqual(parseUpdatePromptState(JSON.stringify({ pendingVersion: '0.6.2' })), {})
})

test('the stored document rejects unreadable fields and dangling counters', () => {
  const parsed = parseUpdatePromptState(JSON.stringify({
    schema: UPDATE_PROMPT_SCHEMA_VERSION,
    pendingVersion: 'not-a-version',
    pendingHighlights: ['有效', 7, '', '也有效'],
    laterVersion: '0.6.2',
    laterClicks: -1,
    silencedVersion: '0.6.1-rc.1',
  }))
  // Highlights only exist as part of a pending version, so they are dropped too.
  assert.deepEqual(parsed, {})
})

test('the stored document caps highlights and keeps only a paired later counter', () => {
  const parsed = parseUpdatePromptState(JSON.stringify({
    schema: UPDATE_PROMPT_SCHEMA_VERSION,
    pendingVersion: '0.6.2',
    pendingHighlights: ['一', '二', '三', '四', '五', '六', '七'],
    laterVersion: '0.6.2',
    laterClicks: 2,
  }))
  assert.deepEqual(parsed, { pendingVersion: '0.6.2', pendingHighlights: ['一', '二', '三', '四', '五', '六'], laterVersion: '0.6.2', laterClicks: 2 })
})
