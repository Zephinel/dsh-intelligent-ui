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
  exportTemplatesFor,
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

test('programs to export cards snapshots the inline theme for each scheme without a catalog', async () => {
  const { programsToExportCards } = await import('../../src/client/export-html-plan.ts')
  const { THEME } = await import('../host/style-fixtures.mjs')
  const program = { callId: 'temporary', program: 'root = Text("Result")', style: 'card', running: false,
    temporaryStyle: { schemaVersion: 1, baseLayout: 'card', directives: 'Compact sections.', theme: THEME } }
  for (const scheme of ['light', 'dark']) {
    const [card, builtin] = programsToExportCards([program, { ...program, callId: 'builtin', temporaryStyle: undefined }], scheme)
    assert.equal(card.scheme, scheme)
    assert.equal(card.themeStyle['--iui-canvas'], THEME[scheme].canvas)
    assert.equal(card.themeStyle['--iui-ink'], THEME[scheme].ink)
    assert.equal(card.themeStyle.colorScheme, scheme)
    assert.equal(card.callId, 'temporary')
    assert.equal(card.program, program.program)
    assert.equal(builtin.themeStyle, undefined)
    assert.equal(builtin.scheme, undefined)
    assert.equal('temporaryStyle' in card, false)
    card.themeStyle['--iui-canvas'] = '#123456'
    assert.notEqual(THEME[scheme].canvas, '#123456', 'export is detached from the recorded snapshot')
  }
})

test('export resolves saved templates for each scheme, temporary overrides catalog, missing styles fall back', async () => {
  const { programsToExportCards } = await import('../../src/client/export-html-plan.ts')
  const { template } = await import('../host/style-fixtures.mjs')
  const saved = template()
  const program = { callId: 'saved', program: 'root = Text("Saved")', style: 'card', styleId: saved.id, running: false }
  for (const scheme of ['light', 'dark']) {
    const [card, missing, temporary] = programsToExportCards([program, { ...program, styleId: 'cs_missing' },
      { ...program, temporaryStyle: { theme: { ...saved.theme, [scheme]: { ...saved.theme[scheme], canvas: '#123456' } } } }], scheme, [saved])
    assert.equal(card.themeStyle['--iui-canvas'], saved.theme[scheme].canvas)
    assert.equal(card.scheme, scheme)
    assert.equal(missing.themeStyle, undefined)
    assert.equal(temporary.themeStyle['--iui-canvas'], '#123456')
  }
})


test('an unavailable catalog falls back to default export themes like the live cards', () => {
  const globalTemplate = { id: 'cs_global', name: 'Global', scope: 'global', sessionId: undefined }
  const sessionTemplate = { id: 'cs_session', name: 'Session', scope: 'session', sessionId: 's1' }
  const otherSession = { id: 'cs_other', name: 'Other', scope: 'session', sessionId: 's2' }
  assert.deepEqual(exportTemplatesFor({ status: 'unavailable', templates: [globalTemplate, sessionTemplate] }, 's1'), [])
  assert.deepEqual(exportTemplatesFor({ status: 'ready', templates: [globalTemplate, sessionTemplate, otherSession] }, 's1'), [globalTemplate, sessionTemplate])
})
