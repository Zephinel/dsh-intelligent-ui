/**
 * Inline UI registration wiring.
 *
 * The browser suite exercises `InlineUIFence` behavior; this Node-side guard
 * keeps the DSH slot registration itself from silently disappearing or drifting
 * (it is the only place that mounts the fence layer in the real shell).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../../src/client/index.tsx', import.meta.url), 'utf8')
const fence = source.slice(source.indexOf("ctx.slots.inject('conversation.chat.markdown.fence'"), source.indexOf("ctx.slots.inject('conversation.chat.assistant-actions'"))

test('the client registers the openui fence layer with its injected actions', () => {
  assert.ok(fence.length > 0, 'the fence registration is present')
  assert.match(fence, /name: 'conversation\.chat\.markdown\.fence'/)
  assert.match(fence, /key: 'openui'/)
  assert.match(fence, /id: 'intelligent-ui\.inline-ui'/)
  assert.match(fence, /locale: NS/)
  assert.match(fence, /inject: \(sessionId: SessionId\)/)
  assert.match(fence, /resolveImage: resolveImageFor\(sessionId\)/)
  assert.match(fence, /startFollowUp\(ctx\.conversation\.input\.for\(binding\.ctx\), message\)/)
  assert.match(fence, /}, InlineUIFence\)/)
})

test('the fence layer is registered unconditionally', () => {
  const before = source.slice(0, source.indexOf("ctx.slots.inject('conversation.chat.markdown.fence'"))
  assert.doesNotMatch(before, /enabledFor\(|documentMode|inlineMode/, 'the client layer does not gate on a session mode')
})

test('the client registers compact process rows for both render_ui and edit_ui_blocks', () => {
  assert.match(source, /name: 'tool\.call\.toolview', key: 'render_ui', locale: NS[\s\S]{0,60}RenderUiRow/)
  assert.match(source, /name: 'tool\.call\.toolview', key: BLOCK_EDIT_TOOL, locale: NS[\s\S]{0,60}RenderUiRow/)
})
