/**
 * Unit tests for the M3 multi-request envelope contract.
 *
 * Run: node --test test/client/artifact-edit-batch.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DST_PROGRAM, DST_TITLE } from '../browser/fixtures/dst-artifact.ts'
import {
  MAX_ARTIFACT_BATCH_REQUESTS,
  MAX_ARTIFACT_DRAFTS,
  buildEditRequestText,
  describeEditRequestProblem,
  nextEditRequestSummary,
  isRequestId,
  parseEditRequestTexts,
} from '../../src/shared/artifact-edit.ts'

const BASE_ORDER = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']

function requestFor(overrides = {}) {
  return {
    schemaVersion: 1,
    requestId: 'req_A1B2C3D4',
    artifactId: 'call_1',
    baseRevisionId: 'call_1',
    baseRevision: 1,
    title: DST_TITLE,
    style: 'card',
    edits: [],
    targetOrder: [...BASE_ORDER],
    program: DST_PROGRAM,
    ...overrides,
  }
}

test('batch limits are the documented v1 values', () => {
  assert.equal(MAX_ARTIFACT_BATCH_REQUESTS, 3)
  assert.equal(MAX_ARTIFACT_DRAFTS, 6)
})

test('request ids accept the wire shape and reject junk', () => {
  assert.equal(isRequestId('req_A1B2C3D4'), true)
  assert.equal(isRequestId('short'), false)
  assert.equal(isRequestId('req_has spaces here'), false)
  assert.equal(describeEditRequestProblem(requestFor()), undefined)
  assert.equal(describeEditRequestProblem(requestFor({ requestId: 'bad id' })), 'invalid_request_id')
})

test('the envelope header carries the request id and keeps the guidance', () => {
  const text = buildEditRequestText(requestFor({
    edits: [{ blockId: 'b3', nodePath: 'root[2]', originalIndex: 3, selectionOrder: 1, componentType: 'Card', instruction: '改成数字时钟' }],
  }))
  assert.equal(text.includes('"requestId":"req_A1B2C3D4"'), true)
  assert.equal(text.includes('requestId: "req_A1B2C3D4"'), true)
  assert.equal(text.includes('artifactId: "call_1"'), true)
  assert.equal(text.includes('edit_ui_blocks'), true)
})

test('one message parses every envelope in order', () => {
  const first = buildEditRequestText(requestFor({ requestId: 'req_FIRST0001', artifactId: 'call_1' }))
  const second = requestFor({
    requestId: 'req_SECOND002',
    artifactId: 'call_2',
    baseRevisionId: 'call_2',
    baseRevision: 2,
    edits: [{ blockId: 'b3', nodePath: 'root[2]', originalIndex: 3, selectionOrder: 1, componentType: 'Card', instruction: '改成数字时钟' }],
  })
  const text = `${first}\n\n${buildEditRequestText(second)}\n\n请保持两张卡片的视觉风格一致。`
  const parsed = parseEditRequestTexts(text)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].requestId, 'req_FIRST0001')
  assert.equal(parsed[0].artifactId, 'call_1')
  assert.equal(parsed[1].requestId, 'req_SECOND002')
  assert.equal(parsed[1].artifactId, 'call_2')
  assert.equal(parsed[1].edits.length, 1)
  assert.equal(parsed[1].program, DST_PROGRAM)
})

test('a malformed envelope does not hide valid siblings', () => {
  const valid = buildEditRequestText(requestFor({ requestId: 'req_VALID0001' }))
  const broken = '<artifact-edit-request>{not json}</artifact-edit-request>'
  const parsed = parseEditRequestTexts(`${broken}\n${valid}`)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].requestId, 'req_VALID0001')
})

test('ordinary messages parse to no requests', () => {
  assert.deepEqual(parseEditRequestTexts('hello'), [])
  assert.deepEqual(parseEditRequestTexts(''), [])
})

test('sent-message summary ranges stay inside their own envelope', () => {
  const first = buildEditRequestText(requestFor({ requestId: 'req_FIRST0001' }))
  const second = requestFor({
    requestId: 'req_SECOND002',
    artifactId: 'call_2',
    baseRevisionId: 'call_2',
    baseRevision: 2,
    edits: [
      { blockId: 'b3', nodePath: 'root[2]', originalIndex: 3, selectionOrder: 1, componentType: 'Card', instruction: 'a' },
      { blockId: 'b5', nodePath: 'root[4]', originalIndex: 5, selectionOrder: 2, componentType: 'Table', instruction: 'b' },
    ],
  })
  const text = `${first}\n\n${buildEditRequestText(second)}\n\nkeep both consistent`
  const firstSummary = nextEditRequestSummary(text, 0)
  assert.ok(firstSummary)
  assert.equal(firstSummary.count, 0)
  assert.ok(firstSummary.end < second.program.length + first.length + 10, 'first summary ends before the second envelope')
  const secondSummary = nextEditRequestSummary(text, firstSummary.end)
  assert.ok(secondSummary)
  assert.equal(secondSummary.count, 2)
  assert.equal(secondSummary.end, text.indexOf('</artifact-program>', text.indexOf('<artifact-program>', firstSummary.end)) + '</artifact-program>'.length)
})
