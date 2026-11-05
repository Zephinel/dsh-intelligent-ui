/**
 * Unit tests for the cross-tab soft edit lease (M3-3b).
 *
 * Run: node --test test/client/edit-tabs.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const CHANNEL = 'dsh-iui-artifact-edit-tabs:v1'
const channels = new Set()

class FakeBroadcastChannel {
  constructor(name) {
    this.name = name
    this.onmessage = undefined
    channels.add(this)
  }
  postMessage(value) {
    for (const other of channels) {
      if (other === this || other.name !== this.name || typeof other.onmessage !== 'function') continue
      setTimeout(() => other.onmessage({ data: structuredClone(value) }), 0)
    }
  }
  close() { channels.delete(this) }
}

globalThis.BroadcastChannel = FakeBroadcastChannel
const tabs = await import('../../src/client/artifact-edit/tabs.ts')

const tick = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await new Promise(resolve => setTimeout(resolve, 0)) }

test('another tab lease shows up and blocks a silent claim', async () => {
  tabs.queryEditLeases()
  const other = new FakeBroadcastChannel(CHANNEL)
  other.postMessage({ type: 'lease', key: 'chat:rev', tabId: 'tab-other', expiresAt: Date.now() + 30_000 })
  await tick()
  assert.equal(tabs.hasForeignLease('chat:rev'), true)
  assert.equal(tabs.claimEditLease('chat:rev'), false)
  assert.equal(tabs.isLeaseOwner('chat:rev'), false)
  other.close()
})

test('takeover replaces the foreign lease and releases it', async () => {
  tabs.queryEditLeases()
  const other = new FakeBroadcastChannel(CHANNEL)
  const received = []
  other.onmessage = ({ data }) => received.push(data)
  other.postMessage({ type: 'lease', key: 'chat:rev2', tabId: 'tab-other', expiresAt: Date.now() + 30_000 })
  await tick()
  assert.equal(tabs.claimEditLease('chat:rev2', true), true)
  assert.equal(tabs.isLeaseOwner('chat:rev2'), true)
  assert.equal(tabs.hasForeignLease('chat:rev2'), false)
  await tick()
  assert.equal(received.some(message => message.type === 'lease' && message.key === 'chat:rev2'), true)
  tabs.releaseEditLease('chat:rev2')
  await tick()
  assert.equal(tabs.isLeaseOwner('chat:rev2'), false)
  assert.equal(received.some(message => message.type === 'release' && message.key === 'chat:rev2'), true)
  other.close()
})

test('expired leases are ignored', async () => {
  tabs.queryEditLeases()
  const other = new FakeBroadcastChannel(CHANNEL)
  other.postMessage({ type: 'lease', key: 'chat:rev3', tabId: 'tab-other', expiresAt: Date.now() - 1 })
  await tick()
  assert.equal(tabs.hasForeignLease('chat:rev3'), false)
  assert.equal(tabs.claimEditLease('chat:rev3'), true)
  tabs.releaseEditLease('chat:rev3')
  other.close()
})
