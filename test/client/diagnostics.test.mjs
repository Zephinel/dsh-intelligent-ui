/**
 * Diagnostic classification: silent extras, fatal no-root/parse failures and
 * recoverable warnings. Pure Node test (no browser needed).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { classifyDiagnostics } from '../../src/lib/diagnostics.ts'

const error = (code, message = code, severity) => ({ source: 'parser', code, message, ...severity === undefined ? {} : { severity } })

test('excess positional args are silent', () => {
  const buckets = classifyDiagnostics([error('excess-args')])
  assert.equal(buckets.fatal.length, 0)
  assert.equal(buckets.warnings.length, 0)
  assert.equal(buckets.ignored.length, 1)
})

test('a missing or unparseable root is fatal', () => {
  for (const code of ['parse-failed', 'parse-exception', 'no-root']) {
    const buckets = classifyDiagnostics([error(code)])
    assert.equal(buckets.fatal.length, 1, code)
    assert.equal(buckets.warnings.length, 0, code)
  }
})

test('a recoverable diagnostic keeps the page and warns', () => {
  const buckets = classifyDiagnostics([error('missing-required'), error('excess-args'), error('unknown-component')])
  assert.deepEqual(buckets.fatal, [])
  assert.deepEqual(buckets.warnings.map((entry) => entry.code), ['missing-required', 'unknown-component'])
  assert.deepEqual(buckets.ignored.map((entry) => entry.code), ['excess-args'])
})

test('the parser warning severity stays out of both display buckets', () => {
  const buckets = classifyDiagnostics([error('no-root', 'fallback', 'warning')])
  assert.equal(buckets.fatal.length, 0)
  assert.equal(buckets.warnings.length, 0)
})
