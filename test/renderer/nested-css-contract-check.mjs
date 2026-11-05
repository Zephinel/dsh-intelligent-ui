#!/usr/bin/env node
/**
 * Static CSS contract check for the nested edit-mode wrappers (M4-1).
 *
 * Every direct-child selector in `components.css` whose owner can be an
 * allowlisted nested container (`Col`, `Row`, `Card`, or a `.iui-flow` element)
 * is silently broken by the `display:contents` BlockSlot wrapper. This script
 * scans those selectors, requires an explicit compensation entry, and verifies
 * that `nested-edit.css` really contains the compensation selector text.
 *
 * Run: node test/renderer/nested-css-contract-check.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const componentsCss = readFileSync(resolve(root, 'src/lib/components/components.css'), 'utf8')
const nestedCss = readFileSync(resolve(root, 'src/lib/components/nested-edit.css'), 'utf8')

/** Owners whose direct children are replaced by a nested BlockSlot wrapper. */
const NESTED_OWNER = /(\.iui-col|\.iui-row|\.iui-card|\.iui-flow)(?![\w-])/

/**
 * Source selector (components.css) -> compensation selector fragment that must
 * exist in nested-edit.css. Whitespace is normalized before matching.
 */
const COMPENSATIONS = new Map([
  ['.iui-row > *', '.iui-row > [data-dsh-iui-block-path] > .dsh-iui-block-body > *'],
  ['.iui-row > .iui-badge', '.iui-row > [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-badge'],
  ['.iui-row > .iui-button', '.iui-row > [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-button'],
  ['.iui-row[style*="align-items"] > :is(.iui-badge, .iui-button)', '.iui-row[style*="align-items"] > [data-dsh-iui-block-path] > .dsh-iui-block-body > :is(.iui-badge, .iui-button)'],
  ['.iui-col[style*="align-items"] > :is(.iui-badge, .iui-button)', '.iui-col[style*="align-items"] > [data-dsh-iui-block-path] > .dsh-iui-block-body > :is(.iui-badge, .iui-button)'],
  ['.iui-form > .iui-row:last-child:has(> .iui-button)', '.iui-form > .iui-row:last-child:has(> [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-button)'],
  ['.iui-row:has(> .iui-image)', '.iui-row:has(> [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-image)'],
  ['.iui-row:has(> .iui-box > .iui-image)', '.iui-row:has(> [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-box > .iui-image)'],
  ['.iui-row:has(> .iui-pressable .iui-image)', '.iui-row:has(> [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-pressable .iui-image)'],
  ['.iui-row > :is(.iui-image, .iui-box:has(> .iui-image), .iui-pressable:has(.iui-image)):not([style*="width"])', '.iui-row > [data-dsh-iui-block-path] > .dsh-iui-block-body > :is(.iui-image, .iui-box:has(> .iui-image), .iui-pressable:has(.iui-image)):not([style*="width"])'],
  ['.iui-row > .iui-box:has(> .iui-image) > .iui-image', '.iui-row > [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-box:has(> .iui-image) > .iui-image'],
  ['.iui-row > .iui-pressable:has(.iui-image) .iui-image', '.iui-row > [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-pressable:has(.iui-image) .iui-image'],
  ['.iui-row > .iui-image', '.iui-row > [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-image'],
  ['.iui-row > .iui-box:has(> .iui-image)', '.iui-row > [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-box:has(> .iui-image)'],
  ['.iui-row > .iui-pressable:has(.iui-image)', '.iui-row > [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-pressable:has(.iui-image)'],
  ['.iui-card > :is(.iui-title-sm, .iui-title-md):first-child', '.iui-card > [data-dsh-iui-block-path]:first-child > .dsh-iui-block-body > :is(.iui-title-sm, .iui-title-md):first-child'],
  ['.iui-card > .iui-row:first-child > :is(.iui-title-sm, .iui-title-md):first-child', '.iui-card > [data-dsh-iui-block-path]:first-child > .dsh-iui-block-body > .iui-row:first-child > [data-dsh-iui-block-path]:first-child > .dsh-iui-block-body > :is(.iui-title-sm, .iui-title-md):first-child'],
  ['.iui-card > :is(.iui-title-sm, .iui-title-md):first-child + .iui-caption', '.iui-card > [data-dsh-iui-block-path]:has(> .dsh-iui-block-body > :is(.iui-title-sm, .iui-title-md):first-child) + [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-caption:first-child'],
  ['.iui-card > .iui-row:first-child > :is(.iui-title-sm, .iui-title-md):first-child + .iui-caption', '.iui-card > [data-dsh-iui-block-path]:first-child > .dsh-iui-block-body > .iui-row:first-child > [data-dsh-iui-block-path]:has(> .dsh-iui-block-body > :is(.iui-title-sm, .iui-title-md):first-child) + [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-caption:first-child'],
  ['.iui-flow > * + *', '.iui-flow > [data-dsh-iui-block-path] + [data-dsh-iui-block-path] > .dsh-iui-block-body > :first-child'],
  [':is(.iui-flow .iui-flow, .iui-card.iui-flow) > * + *', ':is(.iui-flow .iui-flow, .iui-card.iui-flow) > [data-dsh-iui-block-path] + [data-dsh-iui-block-path] > .dsh-iui-block-body > :first-child'],
  ['.iui-flow > .iui-title + *', '.iui-flow > [data-dsh-iui-block-path]:has(> .dsh-iui-block-body > .iui-title:first-child) + [data-dsh-iui-block-path] > .dsh-iui-block-body > :first-child'],
  ['.iui-flow > .iui-text + .iui-text', '.iui-flow > [data-dsh-iui-block-path] + [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-text:first-child'],
  ['.iui-flow > .iui-title + :is(.iui-text, .iui-caption, .iui-row:has(> .iui-badge))', '.iui-flow > [data-dsh-iui-block-path]:has(> .dsh-iui-block-body > .iui-title:first-child) + [data-dsh-iui-block-path] > .dsh-iui-block-body > :is(.iui-text, .iui-caption)'],
  ['.iui-flow > .iui-caption + .iui-title', '.iui-flow > [data-dsh-iui-block-path]:has(> .dsh-iui-block-body > .iui-caption:first-child) + [data-dsh-iui-block-path] > .dsh-iui-block-body > .iui-title:first-child'],
])

/** Collapse whitespace so selector fragments compare reliably. */
function normalize(selector) {
  return selector.replace(/\s+/g, ' ').trim()
}

/** Split a selector list on top-level commas (commas in :is()/() stay together). */
function splitSelectorList(selectorText) {
  const parts = []
  let depth = 0
  let start = 0
  for (let index = 0; index < selectorText.length; index += 1) {
    const character = selectorText[index]
    if (character === '(') depth += 1
    else if (character === ')') depth = Math.max(0, depth - 1)
    else if (character === ',' && depth === 0) {
      parts.push(selectorText.slice(start, index))
      start = index + 1
    }
  }
  parts.push(selectorText.slice(start))
  return parts.map(normalize).filter(part => part !== '')
}

/** Strip comments and collect selector texts of every style rule. */
function selectorTexts(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = []
  const rulePattern = /([^{}]+)\{/g
  let match
  while ((match = rulePattern.exec(withoutComments)) !== null) {
    const header = match[1].trim()
    // Skip at-rule preambles (`@media …`) — they are covered by their inner rules.
    if (header.startsWith('@')) continue
    selectors.push(...splitSelectorList(header))
  }
  return selectors
}

const nestedSelectors = selectorTexts(nestedCss)
const nestedAllText = normalize(nestedSelectors.join(' '))
const sourceSelectors = selectorTexts(componentsCss)
/** Index of the first top-level `>` combinator, or -1 (commas/:is() ignored). */
function topLevelChildCombinator(selector) {
  let depth = 0
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index]
    if (character === '(') depth += 1
    else if (character === ')') depth = Math.max(0, depth - 1)
    else if (character === '>' && depth === 0) return index
  }
  return -1
}

const flagged = sourceSelectors.filter(selector => {
  const directChild = topLevelChildCombinator(selector)
  if (directChild >= 0 && NESTED_OWNER.test(selector.slice(0, directChild))) return true
  // `:has(> .child)` also breaks: the child is no longer a direct DOM child.
  const hasDirectChild = selector.indexOf(':has(> ')
  return hasDirectChild >= 0 && NESTED_OWNER.test(selector.slice(0, hasDirectChild))
})

const uncompensated = []
const missingSelectorText = []
for (const selector of flagged) {
  const compensation = COMPENSATIONS.get(selector)
  if (compensation === undefined) { uncompensated.push(selector); continue }
  if (!nestedAllText.includes(normalize(compensation))) missingSelectorText.push({ selector, compensation })
}

console.log(`nested-css-contract: scanned ${sourceSelectors.length} selectors, ${flagged.length} direct-child selectors under Col/Row/Card/iui-flow`)
console.log(`nested-css-contract: ${flagged.length - uncompensated.length - missingSelectorText.length}/${flagged.length} compensated`)
if (uncompensated.length > 0) {
  console.error('uncompensated direct-child selectors (add a rule to nested-edit.css and an entry here):')
  for (const selector of uncompensated) console.error(`  - ${selector}`)
}
if (missingSelectorText.length > 0) {
  console.error('compensation declared but missing from nested-edit.css:')
  for (const entry of missingSelectorText) console.error(`  - ${entry.selector}\n      expected: ${entry.compensation}`)
}
const stale = [...COMPENSATIONS.keys()].filter(selector => !flagged.includes(selector))
if (stale.length > 0) {
  console.warn(`nested-css-contract: ${stale.length} stale compensation entries (source selector no longer found):`)
  for (const selector of stale) console.warn(`  - ${selector}`)
}
if (uncompensated.length > 0 || missingSelectorText.length > 0) process.exit(1)
console.log('nested-css-contract: ok')
