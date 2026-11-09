/**
 * The production default of the stage switch is part of the shipped contract
 * (M7): the browser harness may disable it for pre-M1 assertions, but the real
 * client must start enabled. A separate test file gets its own Node process, so
 * no other suite can toggle the module store before this assertion runs.
 *
 * Run: node --test test/client/artifact-version-default.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isArtifactVersionStageEnabled } from '../../src/client/artifact-edit/artifact-version.ts'

test('the artifact version stage is enabled by production default', () => {
  assert.equal(isArtifactVersionStageEnabled(), true)
})
