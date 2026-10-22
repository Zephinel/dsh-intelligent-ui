/**
 * Unit tests for the standalone interactive-page assembler.
 *
 * Run: node --test test/client/export-html-plan.test.mjs
 *
 * The module is imported as TypeScript source (Node >= 22.18 strips types), and
 * no DOM is needed: the browser export fetches assets and theme tokens first.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStandaloneHtml,
  escapeHtml,
  pageFileName,
  scriptJson,
} from '../../src/client/export-html-plan.ts'

const cards = [
  { program: 'root = Title("上海两日")', title: 'Two-day Shanghai', style: 'card', callId: 'call-1' },
  { program: 'root = Markdown("Read more")', title: 'Notes', style: 'article', callId: 'call-2' },
]

test('one document carries every card, the theme, the renderer and the mount call', () => {
  const html = buildStandaloneHtml({
    cards,
    js: 'window.mountIUI=function(){};',
    css: '.dsh-iui-card{color:red}',
    tokens: ':root{--dsw-alias-bg-base:#111}',
    colorScheme: 'dark',
    title: 'Two-day Shanghai',
    lang: 'zh-CN',
    removeFollowUps: false,
  })
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<html lang="zh-CN">/)
  assert.match(html, /<meta name="color-scheme" content="dark">/)
  assert.match(html, /<title>Two-day Shanghai<\/title>/)
  assert.match(html, /:root\{--dsw-alias-bg-base:#111\}/)
  assert.match(html, /\.dsh-iui-card\{color:red\}/)
  assert.match(html, /window\.mountIUI=function\(\)\{\};/)
  assert.match(html, /window\.mountIUI\(document\.getElementById\("iui-root"\), /)
  assert.match(html, /"callId":"call-1"/)
  assert.match(html, /"callId":"call-2"/)
  assert.match(html, /lang:"zh-CN"/)
  assert.match(html, /hideToAssistant:false/)
})

test('the page can omit the follow-up controls', () => {
  const html = buildStandaloneHtml({
    cards: [],
    js: '',
    css: '',
    tokens: ':root{}',
    colorScheme: 'light',
    title: 'No follow-ups',
    lang: 'en',
    removeFollowUps: true,
  })
  assert.match(html, /hideToAssistant:true/)
})

test('embedded source cannot close its script or style element early', () => {
  const html = buildStandaloneHtml({
    cards: [],
    js: 'const a = "</script><script>alert(1)</script>"',
    css: '.x::after{content:"</style>"}',
    tokens: ':root{}',
    colorScheme: 'light',
    title: '<Two & "One">',
    lang: 'en',
    removeFollowUps: false,
  })
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2, 'only the two real script closers remain')
  assert.match(html, /<\\\/script>/)
  assert.match(html, /<\\\/style>/)
  assert.match(html, /<title>&lt;Two &amp; &quot;One&quot;&gt;<\/title>/)
})

test('card data is JSON with < escaped for the inline script', () => {
  assert.equal(scriptJson({ program: 'a </script> b' }), '{"program":"a \\u003c/script> b"}')
  assert.equal(escapeHtml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;')
})

test('the page file name carries a sortable local timestamp and strips unsafe characters', () => {
  const when = new Date(2026, 9, 22, 2, 3, 4)
  assert.equal(pageFileName('Sales/dashboard', when), 'Sales-dashboard-20261022-020304.html')
  assert.match(pageFileName(undefined, when), /^interactive-answer-\d{8}-\d{6}\.html$/)
})
