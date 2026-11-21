/**
 * Dictionary regressions, bilingual text fence, and edge-value checks for the
 * extension's user-visible UI copy.
 *
 * Run: node --test test/client/locales.test.mjs
 *
 * The dictionary module is imported as TypeScript source: Node >= 22.18 strips
 * type annotations natively, so this test needs no build step.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NS, en, zh, translate, fallbackT } from '../../src/shared/locales.ts'

const root = join(import.meta.dirname, '..', '..')
const manifestEn = JSON.parse(readFileSync(join(root, 'locale/en.json'), 'utf8'))
const manifestZh = JSON.parse(readFileSync(join(root, 'locale/zh.json'), 'utf8'))

/** Every `{name}` placeholder in one template, sorted. */
const placeholdersOf = (template) => [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

function walkFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkFiles(full))
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

function splitSentences(text) {
  const stripped = text.replace(/\{[^}]+\}/g, 'item')
  return stripped.split(/(?<=[.!?])\s+/).filter(Boolean)
}

function wordCount(sentence) {
  return (sentence.match(/[A-Za-z0-9'-]+/g) || []).length
}

test('the namespace is the extension name', () => {
  assert.equal(NS, 'intelligent-ui')
})

test('English and Chinese dictionaries carry the same key set', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  assert.deepEqual(Object.keys(manifestEn.meta).sort(), Object.keys(manifestZh.meta).sort())
})

test('every dictionary value is a non-empty template', () => {
  for (const [language, dict] of [['zh', zh], ['en', en]]) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', `${language} ${key} is a string`)
      assert.ok(value.length > 0, `${language} ${key} is not empty`)
      assert.doesNotMatch(value, /\n/u, `${language} ${key} stays on one line`)
    }
  }
})

test('each key uses the same placeholders in both languages', () => {
  for (const key of Object.keys(zh)) {
    assert.deepEqual(placeholdersOf(en[key]), placeholdersOf(zh[key]), `${key} placeholders match`)
  }
})

test('translate fills placeholders and leaves unknown keys visible', () => {
  const t = translate(zh)
  assert.equal(t('chip.label', { scope: '关闭' }), 'UI：关闭')
  assert.equal(t('chip.label'), 'UI：{scope}')
  assert.equal(t('missing.key'), 'missing.key')
  assert.equal(t('missing.key', { x: 1 }), 'missing.key')
})

test('English fallback keeps the pre-i18n copy', () => {
  assert.equal(fallbackT('card.title'), 'Interactive answer')
  assert.equal(fallbackT('chip.label', { scope: 'Off' }), 'UI: Off')
  assert.equal(fallbackT('map.action.expand'), 'Expand')
})

test('style switching copy exists in both languages', () => {
  const keys = [
    'edit.styleSwitchGroup', 'edit.styleSwitchApply', 'edit.styleSwitchBusy',
    'edit.styleSwitchCurrentBadge', 'edit.styleSwitchNoChange', 'edit.styleSwitchDirty', 'edit.styleSwitchMissing',
    'edit.styleSwitchArticle', 'edit.styleSwitchStale', 'edit.styleSwitchMismatch',
    'edit.styleSwitchFailed',
    'edit.styleTargetArticle', 'edit.styleStatusChecking', 'edit.styleStatusStale', 'edit.styleStatusDirty',
    'edit.styleStatusInstruction', 'edit.styleStatusNoTarget', 'edit.styleStatusUnavailable', 'edit.styleStatusCurrent',
    'edit.styleStatusReady', 'edit.styleStatusTemporary', 'edit.styleStatusBranch',
    'edit.styleSavedGroup', 'edit.styleRevision', 'edit.historyStyleSwitch',
  ]
  for (const key of keys) {
    assert.equal(typeof zh[key], 'string', `zh ${key} exists`)
    assert.ok(zh[key].length > 0, `zh ${key} is not empty`)
    assert.ok(en[key].length > 0, `en ${key} is not empty`)
  }
  // B1's natural-language disclosure is distinct from the deterministic picker.
  assert.equal(zh['edit.styleAdjustAction'], '更改样式')
  assert.equal(en['edit.styleAdjustAction'], 'Change style')
})

test('every locale key in src/shared/locales.ts is referenced in src/', () => {
  const srcFiles = walkFiles(join(root, 'src')).filter((file) => !file.endsWith('locales.ts'))
  const allSrc = srcFiles.map((file) => readFileSync(file, 'utf8')).join('\n')
  const dynamicPatterns = []
  for (const match of allSrc.matchAll(/`([a-z][a-zA-Z0-9.-]*\$\{[^`]+)`/g)) {
    const raw = match[1]
    if (!raw.includes('.')) continue
    const escaped = raw
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\$\\\{[^}]+\\\}/g, '[^.]+')
    dynamicPatterns.push(new RegExp(`^${escaped}$`))
  }
  for (const key of Object.keys(zh)) {
    const used =
      allSrc.includes(`'${key}'`) ||
      allSrc.includes(`"${key}"`) ||
      dynamicPatterns.some((pattern) => pattern.test(key))
    assert.ok(used, `dead locale key: ${key}`)
  }
})

test('English copy obeys plain-language text fence (STE vocabulary, length, US spelling, no internal leaks)', () => {
  const bannedWords = /\b(may|might|simply|just|easily|please|will|would|sorry|oops|uh-oh|colour|cancelled)\b/i
  const bannedLeaks = /\b(authoritative program record|automatic registration did not finish|record was evicted|stays armed|chromeless|turn tail|editing chrome|template exchange format v1|Host)\b|@ToAssistant/
  const entries = [
    ['locale/en.json:meta.title', manifestEn.meta.title],
    ['locale/en.json:meta.description', manifestEn.meta.description],
    ...Object.entries(en).map(([k, v]) => [`locales.ts:${k}`, v]),
  ]
  for (const [id, text] of entries) {
    assert.doesNotMatch(text, bannedWords, `${id} contains banned filler/modal/UK word: "${text}"`)
    assert.doesNotMatch(text, bannedLeaks, `${id} leaks internal terminology: "${text}"`)
    assert.doesNotMatch(text, /;/, `${id} contains a semicolon chain: "${text}"`)
    assert.doesNotMatch(text, /\(s\)/i, `${id} contains (s) plural shortcut: "${text}"`)
    assert.doesNotMatch(text, /(?<!\.)\.\.(?!\.)|!!|\?\?|\.,|,\./, `${id} contains double punctuation: "${text}"`)
    for (const sentence of splitSentences(text)) {
      const words = wordCount(sentence)
      assert.ok(words <= 25, `${id} sentence exceeds 25 words (${words}): "${sentence}"`)
    }
  }
})

test('Chinese copy obeys terminology consistency and avoids untranslated internal nouns', () => {
  const bannedZh = /Intelligent UI|Artifact|\bHost\b|\bchip\b|\bSession\b|\bWorkspace\b|无须|早见结论|自由版式|权威程序记录|@ToAssistant/
  const entries = [
    ['locale/zh.json:meta.title', manifestZh.meta.title],
    ['locale/zh.json:meta.description', manifestZh.meta.description],
    ...Object.entries(zh).map(([k, v]) => [`locales.ts:${k}`, v]),
  ]
  for (const [id, text] of entries) {
    assert.doesNotMatch(text, bannedZh, `${id} contains banned or unlocalized term: "${text}"`)
    assert.doesNotMatch(text, /。。|，，|；；|\.\./, `${id} contains double punctuation: "${text}"`)
  }
  assert.equal(zh['style.auto.label'], '自动')
  assert.equal(zh['style.card.label'], '卡片')
  assert.equal(zh['style.article.label'], '文章')
})

test('guidance copy quotes exact rendered control labels in both locales', () => {
  for (const dict of [en, zh]) {
    assert.ok(
      dict['edit.conflictBranchHint'].includes(dict['edit.branchAction']),
      'conflictBranchHint quotes branchAction',
    )
    assert.ok(
      dict['edit.nestedHint'].includes(dict['edit.switchToNested']) &&
        dict['edit.nestedHint'].includes(dict['edit.switchToTop']),
      'nestedHint quotes switchToNested and switchToTop',
    )
    assert.ok(
      dict['edit.applyHintBatch'].includes(dict['edit.batchSave']),
      'applyHintBatch quotes batchSave',
    )
    assert.ok(
      dict['edit.applyHintGlobal'].includes(dict['edit.globalSave']),
      'applyHintGlobal quotes globalSave',
    )
    assert.ok(
      dict['edit.errorPendingApply'].includes(dict['edit.apply']),
      'errorPendingApply quotes apply',
    )
  }
})

test('singular and plural count templates render grammatically for 1 vs 2+', () => {
  const tEn = translate(en)
  const pairs = [
    ['version.moreOne', 'version.more', '1 older revision in Details', '2 older revisions in Details'],
    ['edit.blockCountOne', 'edit.blockCount', '1 block', '2 blocks'],
    ['edit.availableBlocksOne', 'edit.availableBlocks', '1 editable block', '2 editable blocks'],
    ['edit.requestsCountOne', 'edit.requestsCount', '1 item', '2 items'],
    ['edit.chipTail.editsOne', 'edit.chipTail.edits', '1 change', '2 changes'],
    ['edit.chipTail.mixedOne', 'edit.chipTail.mixed', '1 change + reorder', '2 changes + reorder'],
    ['edit.chipTail.opsOne', 'edit.chipTail.ops', '1 structure op', '2 structure ops'],
    ['edit.summaryOpsOne', 'edit.summaryOps', '1 structure op', '2 structure ops'],
    ['edit.batchPendingOne', 'edit.batchPending', '1 unsaved structure operation', '2 unsaved structure operations'],
    ['edit.applySummaryModelOne', 'edit.applySummaryModel', '1 edit request', '2 edit requests'],
    ['edit.applyPreviewOpsCountOne', 'edit.applyPreviewOpsCount', '1 structure op', '2 structure ops'],
    ['edit.applyPreviewModelCountOne', 'edit.applyPreviewModelCount', '1 edit request', '2 edit requests'],
    ['edit.chip.editsOne', 'edit.chip.edits', 'Edit page · 1 change', 'Edit page · 2 changes'],
    ['edit.chip.mixedOne', 'edit.chip.mixed', 'Edit page · 1 change + reorder', 'Edit page · 2 changes + reorder'],
  ]
  for (const [oneKey, manyKey, expectedOne, expectedMany] of pairs) {
    assert.equal(tEn(oneKey, { count: 1 }), expectedOne, oneKey)
    assert.equal(tEn(manyKey, { count: 2 }), expectedMany, manyKey)
  }
})
