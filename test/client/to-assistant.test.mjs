/**
 * Follow-up marker semantics: action buttons must not be removed just because
 * they are buttons; only a bare label or a real continue-conversation action
 * qualifies.
 *
 *   node --test test/client/to-assistant.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasToAssistant, isToAssistantControl } from '../../src/lib/to-assistant.ts'

const plan = (...types) => ({ steps: types.map(type => ({ type })) })

test('only bare buttons and explicit @ToAssistant plans are follow-ups', () => {
  assert.equal(isToAssistantControl(undefined, true), true, 'a bare button sends its label')
  assert.equal(isToAssistantControl(undefined, false), false, 'a non-button control with no action does nothing')
  assert.equal(isToAssistantControl(plan('open_url'), true), false, '@OpenUrl is a local action')
  assert.equal(isToAssistantControl(plan('set'), true), false, '@Set is a local action')
  assert.equal(isToAssistantControl(plan('continue_conversation'), false), true, '@ToAssistant is a follow-up')
  assert.equal(hasToAssistant(plan('continue_conversation', 'open_url')), true, 'mixed plans count once')
})
