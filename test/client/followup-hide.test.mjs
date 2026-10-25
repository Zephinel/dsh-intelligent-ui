/**
 * Export follow-up hiding: only the follow-up control and the wrappers that
 * exist solely for it disappear; a Card or Form that also carries readable
 * content keeps that content. A block that is only a follow-up disappears whole.
 *
 * Node has no DOM, so the test drives the production function with a small
 * structural element tree implementing exactly the DOM surface the module uses.
 *
 *   node --test test/client/followup-hide.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FOLLOWUP_HIDDEN_ATTRIBUTE, hideToAssistantBlocks } from '../../src/lib/to-assistant.ts'

const HIDDEN = FOLLOWUP_HIDDEN_ATTRIBUTE

/** Text node. */
class FakeText {
  constructor(text) {
    this.nodeType = 3
    this.textContent = text
    this.parentElement = null
  }
}

/** Element with parent/child links, classes and attributes. */
class FakeElement {
  constructor(tag, classes = [], attributes = {}) {
    this.nodeType = 1
    this.tag = tag
    this.classes = new Set(classes)
    this.attributes = new Map(Object.entries(attributes))
    this.children = []
    this.parentElement = null
    this.classList = { contains: token => this.classes.has(token) }
  }

  get tagName() { return this.tag.toUpperCase() }

  get childNodes() { return this.children }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement !== null) throw new Error('node already attached')
      node.parentElement = this
      this.children.push(node)
    }
    return this
  }

  getAttribute(name) { return this.attributes.get(name) ?? null }

  hasAttribute(name) { return this.attributes.has(name) }

  setAttribute(name, value) { this.attributes.set(name, value) }

  removeAttribute(name) { this.attributes.delete(name) }

  contains(node) {
    for (let current = node; current !== null; current = current.parentElement) if (current === this) return true
    return false
  }

  querySelectorAll(selector) {
    const match = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector)
    assert.ok(match, `unsupported test selector ${selector}`)
    const [, name, value] = match
    const out = []
    const visit = element => {
      for (const child of element.children) {
        if (child.nodeType !== 1) continue
        const actual = child.getAttribute(name)
        if (actual !== null && (value === undefined || actual === value)) out.push(child)
        visit(child)
      }
    }
    visit(this)
    return out
  }
}

const container = (...children) => new FakeElement('div', ['dsh-iui-cards'], { 'data-dsh-intelligent-ui-list': 'true' }).append(...children)
const card = (...children) => new FakeElement('section', ['iui-card']).append(...children)
const row = (...children) => new FakeElement('div', ['iui-row']).append(...children)
const form = (...children) => new FakeElement('form', ['iui-form']).append(...children)
const field = (...children) => new FakeElement('label', ['iui-field']).append(...children)
const input = () => new FakeElement('input', ['iui-input'])
const text = value => new FakeText(value)
const prose = value => new FakeElement('p', ['iui-text']).append(text(value))
const followUp = () => new FakeElement('button', ['iui-button'], { 'data-iui-to-assistant': 'true' }).append(text('Plan another day'))
const localAction = () => new FakeElement('button', ['iui-button']).append(text('Copy'))

/** Read the hide target the pass chose, by rendering the tree's marks. */
const marked = (root) => root.querySelectorAll(`[${HIDDEN}]`)

test('a Card with prose keeps the prose and hides only the follow-up control', () => {
  const block = followUp()
  const root = container(card(prose('The answer is 42.'), block))
  const restore = hideToAssistantBlocks(root)
  const hidden = marked(root)
  assert.deepEqual(hidden, [block], 'only the control is hidden')
  assert.equal(root.contains(prose('x')), false)
  assert.equal(block.getAttribute(HIDDEN), 'true')
  restore()
  assert.deepEqual(marked(root), [], 'restore removes the mark')
})

test('a Card that is only a follow-up disappears whole', () => {
  const block = followUp()
  const only = card(row(block))
  const root = container(only)
  hideToAssistantBlocks(root)
  assert.deepEqual(marked(root), [only], 'the whole Card is the follow-up block')
})

test('a wrapper that only holds the follow-up is hidden with it, keeping sibling content', () => {
  const block = followUp()
  const padding = row(new FakeElement('div', ['iui-spacer']), block)
  const body = prose('Keep me.')
  const root = container(card(body, padding))
  hideToAssistantBlocks(root)
  assert.deepEqual(marked(root), [padding], 'the spacer+button row is the minimal unit')
})

test('a Form whose fields exist only for the follow-up is hidden as one unit', () => {
  const block = followUp()
  const pref = form(field(text('People'), input()), block)
  const body = prose('Kept prose.')
  const root = container(card(body, pref))
  hideToAssistantBlocks(root)
  assert.deepEqual(marked(root), [pref], 'the form and its dead fields go together')
})

test('a Card holding only a form follow-up disappears whole', () => {
  const block = followUp()
  const only = card(form(field(text('People'), input()), block))
  const root = container(only)
  hideToAssistantBlocks(root)
  assert.deepEqual(marked(root), [only])
})

test('a standalone Label is content even though form labels are chrome', () => {
  const block = followUp()
  const label = new FakeElement('span', ['iui-label']).append(text('Preferred pace'))
  const root = container(card(label, block))
  hideToAssistantBlocks(root)
  assert.deepEqual(marked(root), [block], 'only the control is hidden; the label stays')
})

test('a local-action button next to a follow-up is content and is kept', () => {
  const block = followUp()
  const local = localAction()
  const pair = row(local, block)
  const root = container(card(prose('Body'), pair))
  hideToAssistantBlocks(root)
  assert.deepEqual(marked(root), [block], 'the local button keeps the row')
  assert.equal(local.getAttribute(HIDDEN), null)
})

test('the card-list boundary is never hidden, even for a standalone page root', () => {
  const block = followUp()
  const only = new FakeElement('section', ['dsh-iui-card']).append(
    new FakeElement('div', ['dsh-iui-body']).append(new FakeElement('div', ['dsh-iui-host']).append(card(row(block)))),
  )
  const cards = container(only)
  const page = new FakeElement('div', ['dsh-iui-standalone-page']).append(cards)
  hideToAssistantBlocks(page)
  assert.deepEqual(marked(page), [only], 'the card is hidden, not the list or the page')
})

test('stale marks are cleared before recomputing, so no longer hidden content returns', () => {
  const block = followUp()
  const wrap = row(block)
  const root = container(card(prose('Body'), wrap))
  const restore = hideToAssistantBlocks(root)
  assert.deepEqual(marked(root), [wrap])
  block.removeAttribute('data-iui-to-assistant')
  hideToAssistantBlocks(root)
  assert.deepEqual(marked(root), [], 'without a follow-up marker nothing is hidden')
  restore()
})
