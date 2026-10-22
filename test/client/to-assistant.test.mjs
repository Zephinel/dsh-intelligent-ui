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
import { readImageExportSettings } from '../../src/shared/intelligent-ui.ts'

const plan = (...types) => ({ steps: types.map(type => ({ type })) })

test('only bare buttons and explicit @ToAssistant plans are follow-ups', () => {
  assert.equal(isToAssistantControl(undefined, true), true, 'a bare button sends its label')
  assert.equal(isToAssistantControl(undefined, false), false, 'a non-button control with no action does nothing')
  assert.equal(isToAssistantControl(plan('open_url'), true), false, '@OpenUrl is a local action')
  assert.equal(isToAssistantControl(plan('set'), true), false, '@Set is a local action')
  assert.equal(isToAssistantControl(plan('continue_conversation'), false), true, '@ToAssistant is a follow-up')
  assert.equal(hasToAssistant(plan('continue_conversation', 'open_url')), true, 'mixed plans count once')
})

test('legacy exportToAssistant values migrate to the remove switch', () => {
  assert.equal(readImageExportSettings({}).removeFollowUps, true, 'default remains remove')
  assert.equal(readImageExportSettings({ exportToAssistant: false }).removeFollowUps, true, 'old remove stays remove')
  assert.equal(readImageExportSettings({ exportToAssistant: true }).removeFollowUps, false, 'old keep stays keep')
  assert.equal(readImageExportSettings({ removeFollowUps: false, exportToAssistant: true }).removeFollowUps, false, 'new field wins')
})
