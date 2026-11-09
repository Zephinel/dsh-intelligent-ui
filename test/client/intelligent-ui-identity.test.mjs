/**
 * Unit tests for the Host result identity shared by card actions.
 *
 * Run: node --test test/client/intelligent-ui-identity.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resultIdOf } from '../../src/shared/intelligent-ui.ts'

test('a normal card addresses its result by the tool call id', () => {
  assert.equal(resultIdOf({ callId: 'call_1' }), 'call_1')
})

test('an edited or rolled-back card addresses the recorded revision id', () => {
  assert.equal(resultIdOf({ callId: 'call_1', revisionId: 'rev_2' }), 'rev_2')
  // Rollback keeps the original callId while rendering the fallback revision.
  assert.equal(resultIdOf({ callId: 'call_9', revisionId: 'rev_2' }), 'rev_2')
})
