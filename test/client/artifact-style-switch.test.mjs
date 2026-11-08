/**
 * Contract tests for deterministic (zero-model) style switching.
 *
 * Run: node --test test/client/artifact-style-switch.test.mjs
 *
 * The contract is pure data: the browser posts a durable style target with an
 * empty operation list and the Host records a revision with the same program.
 * These tests pin the target shape and the single-intent rules so a structural
 * batch and a style switch can never be mixed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ARTIFACT_STRUCTURE_ROUTE_PATH,
  MAX_ARTIFACT_STRUCTURE_OPERATIONS,
  describeStyleTargetProblem,
  describeStructureRequestProblem,
} from '../../src/shared/artifact-structure.ts'

/** One shape-valid structural operation. */
const DELETE_OPERATION = { op: 'delete', nodeId: 'n3', sourceDigest: '9abc7e39' }

/** Minimal shape-valid structural request. */
function requestFor(overrides = {}) {
  return {
    schemaVersion: 1,
    artifactId: 'call_1',
    baseRevisionId: 'call_1',
    operationId: 'req_operation01',
    operations: [DELETE_OPERATION],
    style: 'card',
    ...overrides,
  }
}

/** Minimal shape-valid style-switch request (single intent, empty operations). */
function styleSwitchFor(overrides = {}) {
  return requestFor({
    operations: [],
    targetStyle: { kind: 'builtin', layout: 'article' },
    sessionStyleScope: 'session_1',
    ...overrides,
  })
}

test('the structure route path still serves both apply models', () => {
  assert.equal(ARTIFACT_STRUCTURE_ROUTE_PATH, '/api/intelligent-ui/artifact-structure')
  assert.equal(MAX_ARTIFACT_STRUCTURE_OPERATIONS, 20)
})

test('style targets accept durable built-in layouts and saved templates', () => {
  assert.equal(describeStyleTargetProblem({ kind: 'builtin', layout: 'card' }), undefined)
  assert.equal(describeStyleTargetProblem({ kind: 'builtin', layout: 'article' }), undefined)
  assert.equal(describeStyleTargetProblem({ kind: 'template', styleId: 'cs_ocean01' }), undefined)
  assert.equal(describeStyleTargetProblem({ kind: 'template', styleId: 'cs_free004' }), undefined)
})

test('style targets reject Free built-ins and malformed identities', () => {
  // Free composition is only reachable through a saved free template.
  assert.equal(describeStyleTargetProblem({ kind: 'builtin', layout: 'free' }), 'invalid_target_layout')
  assert.equal(describeStyleTargetProblem({ kind: 'builtin' }), 'invalid_target_layout')
  assert.equal(describeStyleTargetProblem({ kind: 'builtin', layout: 'auto' }), 'invalid_target_layout')
  assert.equal(describeStyleTargetProblem({ kind: 'template', styleId: 'card' }), 'invalid_target_style_id')
  assert.equal(describeStyleTargetProblem({ kind: 'template', styleId: 'cs_short' }), 'invalid_target_style_id')
  assert.equal(describeStyleTargetProblem({ kind: 'template' }), 'invalid_target_style_id')
  assert.equal(describeStyleTargetProblem({ kind: 'snapshot', layout: 'card' }), 'invalid_target_style')
  assert.equal(describeStyleTargetProblem('article'), 'invalid_target_style')
  assert.equal(describeStyleTargetProblem(null), 'invalid_target_style')
})

test('style targets reject fields that belong to the other target kind', () => {
  assert.equal(describeStyleTargetProblem({ kind: 'builtin', layout: 'card', styleId: 'cs_ocean01' }), 'invalid_target_fields')
  assert.equal(describeStyleTargetProblem({ kind: 'template', styleId: 'cs_ocean01', layout: 'card' }), 'invalid_target_fields')
  assert.equal(describeStyleTargetProblem({ kind: 'builtin', layout: 'card', theme: {} }), 'invalid_target_fields')
})

test('a style switch is a single-intent request with empty operations', () => {
  assert.equal(describeStructureRequestProblem(requestFor()), undefined)
  assert.equal(describeStructureRequestProblem(styleSwitchFor()), undefined)
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ targetStyle: { kind: 'template', styleId: 'cs_ocean01' } })), undefined)
  // preview is a structural-batch feature only.
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ preview: true })), 'preview_not_supported')
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ preview: false })), undefined)
  // Operations must be present and empty; the apply models never mix.
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ operations: [DELETE_OPERATION] })), 'style_with_operations')
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ operations: undefined })), 'invalid_operations')
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ operations: 'delete-n3' })), 'invalid_operations')
  // The chat scope resolves session-owned templates and is style-only.
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ sessionStyleScope: undefined })), 'invalid_session_scope')
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ sessionStyleScope: '' })), 'invalid_session_scope')
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ sessionStyleScope: 42 })), 'invalid_session_scope')
})

test('structural batches keep their rules and reject style-switch fields', () => {
  assert.equal(describeStructureRequestProblem(requestFor({ preview: true })), undefined)
  assert.equal(describeStructureRequestProblem(requestFor({ operations: [] })), 'invalid_operations')
  const tooMany = Array.from({ length: MAX_ARTIFACT_STRUCTURE_OPERATIONS + 1 }, () => DELETE_OPERATION)
  assert.equal(describeStructureRequestProblem(requestFor({ operations: tooMany })), 'invalid_operations')
  // A structural request cannot carry the style-switch fields.
  assert.equal(describeStructureRequestProblem(requestFor({ sessionStyleScope: 'session_1' })), 'unexpected_session_scope')
  assert.equal(describeStructureRequestProblem(requestFor({ targetStyle: undefined })), 'invalid_target_style')
  assert.equal(describeStructureRequestProblem(requestFor({ extra: 1 })), 'unknown_field')
})

test('a style switch still validates the base-style identity fields', () => {
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ style: 'free' })), undefined)
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ style: 'wide' })), 'invalid_style')
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ styleId: 'cs_ocean01' })), undefined)
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ styleId: 'bad' })), 'invalid_style_id')
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ branch: true })), undefined)
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ branch: 'yes' })), 'invalid_branch')
  const snapshot = {
    schemaVersion: 1,
    baseLayout: 'card',
    directives: 'Keep the temporary skin.',
    theme: {
      light: { canvas: '#ffffff', ink: '#111111', accent: '#3366cc' },
      dark: { canvas: '#111111', ink: '#eeeeee', accent: '#66aaff' },
      font: 'sans', radius: 'soft', density: 'comfortable', shadow: 'soft',
    },
  }
  // A temporary base is allowed for the identity check; the Host drops it.
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ temporaryStyle: snapshot })), undefined)
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ temporaryStyle: { schemaVersion: 1, baseLayout: 'card', directives: '' } })), 'invalid_temporary_style')
  assert.equal(describeStructureRequestProblem(styleSwitchFor({ temporaryStyle: snapshot, styleId: 'cs_ocean01' })), undefined)
})
