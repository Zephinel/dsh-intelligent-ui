/**
 * Unit tests for the post-Apply notice lead/detail split (option C).
 *
 * Run: node --test test/client/notice-copy.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noticeCopyParts } from '../../src/client/artifact-edit/notice-copy.ts'
import { en, zh } from '../../src/shared/locales.ts'

const noticeKeys = [
  'edit.applyNotice.submitted',
  'edit.applyNotice.manual',
  'edit.applyNotice.extraText',
  'edit.applyNotice.detached',
  'edit.applyNotice.rebaseFailed',
]

test('Chinese notices split the status clause from its follow-up without changing the copy', () => {
  const expected = {
    'edit.applyNotice.submitted': ['结构操作已应用', '，模型请求已发送。'],
    'edit.applyNotice.manual': ['结构操作已应用', '；模型请求已在输入框，请手动发送。'],
    'edit.applyNotice.extraText': ['结构操作已应用', '；输入框已有正文，请手动发送模型请求。'],
    'edit.applyNotice.detached': ['结构操作已应用', '；草稿仍是未附加状态，请先在草稿栏附加 chip，再发送模型请求。'],
    // The failure clause stays in the lead: the first semicolon separates it from the recovery advice.
    'edit.applyNotice.rebaseFailed': ['属性修订已应用，但草稿无法迁移到新修订', '；已保存内容仍在原草稿，请重新打开编辑器。'],
  }
  for (const key of noticeKeys) {
    const copy = noticeCopyParts(zh[key])
    assert.deepEqual([copy.lead, copy.detail], expected[key], key)
    assert.equal(copy.lead + copy.detail, zh[key], `${key} keeps the copy character-identical`)
  }
})

test('English notices split on the semicolon and keep the failure clause in the lead', () => {
  for (const key of noticeKeys) {
    const copy = noticeCopyParts(en[key])
    assert.notEqual(copy.detail, '', `${key} has a detail clause`)
    assert.ok(copy.detail.startsWith(';'), `${key} keeps the separator in the detail`)
    assert.ok(copy.lead.startsWith(key === 'edit.applyNotice.rebaseFailed' ? 'The property revision was applied, but' : 'Structure operations applied'), key)
    assert.equal(copy.lead + copy.detail, en[key], `${key} keeps the copy character-identical`)
  }
})

test('a message without a separator stays one lead clause', () => {
  assert.deepEqual(noticeCopyParts('结构操作已应用'), { lead: '结构操作已应用', detail: '' })
  assert.deepEqual(noticeCopyParts('Nothing to send'), { lead: 'Nothing to send', detail: '' })
})
