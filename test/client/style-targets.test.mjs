/**
 * Unit tests for the pure style-switch eligibility rules.
 *
 *   node --test test/client/style-targets.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { styleSwitchBlocker, styleTargetDisableReason } from '../../src/client/artifact-edit/style-targets.ts'

const option = { target: { kind: 'builtin', layout: 'article' }, name: 'Article', layout: 'article', requiresArticleLayout: true }
const card = { target: { kind: 'builtin', layout: 'card' }, name: 'Card', layout: 'card' }

test('Article targets are disabled when the current program fails the shared predicate', () => {
  assert.equal(styleTargetDisableReason(option, 'needs a Toc and Section'), 'article')
  assert.equal(styleTargetDisableReason(option, undefined), undefined)
  assert.equal(styleTargetDisableReason(card, 'needs a Toc and Section'), undefined)
})

test('the blocker priority explains the first real reason Apply is unavailable', () => {
  const base = { status: 'ready', branch: false, busy: false, hasTarget: true, targetDisabled: false, current: false, dirty: false, instruction: false }
  assert.equal(styleSwitchBlocker(base), undefined)
  assert.equal(styleSwitchBlocker({ ...base, status: 'checking' }), 'checking')
  assert.equal(styleSwitchBlocker({ ...base, status: 'conflict' }), 'stale')
  assert.equal(styleSwitchBlocker({ ...base, status: 'conflict', branch: true }), undefined, 'an explicit branch may switch')
  assert.equal(styleSwitchBlocker({ ...base, busy: true }), 'busy')
  assert.equal(styleSwitchBlocker({ ...base, dirty: true }), 'dirty')
  assert.equal(styleSwitchBlocker({ ...base, instruction: true }), 'instruction')
  assert.equal(styleSwitchBlocker({ ...base, hasTarget: false }), 'no_target')
  assert.equal(styleSwitchBlocker({ ...base, targetDisabled: true }), 'unavailable')
  assert.equal(styleSwitchBlocker({ ...base, current: true }), 'current')
  assert.equal(styleSwitchBlocker({ ...base, dirty: true, current: true }), 'dirty')
})
