/**
 * Soft edit leases between browser tabs (M3-3).
 *
 * A tab editing one revision broadcasts a short-lived lease. Other tabs keep
 * editing locally, but see a takeover notice instead of silently overwriting
 * unsaved work. The Host revision check remains the final authority; a lease
 * only improves the timing of the warning.
 */
import { useSyncExternalStore } from 'react'

const CHANNEL_NAME = 'dsh-iui-artifact-edit-tabs:v1'
const LEASE_TTL_MS = 30_000
const RENEW_MS = 10_000

interface LeaseRecord {
  readonly tabId: string
  readonly expiresAt: number
}

type LeaseMessage =
  | { readonly type: 'lease'; readonly key: string; readonly tabId: string; readonly expiresAt: number }
  | { readonly type: 'release'; readonly key: string; readonly tabId: string }
  | { readonly type: 'query'; readonly tabId: string }

const tabId = (() => {
  const cryptoApi = globalThis.crypto
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `tab_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
})()

const leases = new Map<string, LeaseRecord>()
const renewTimers = new Map<string, ReturnType<typeof setInterval>>()
const listeners = new Set<() => void>()
let channel: BroadcastChannel | undefined
let initialized = false
let version = 0

function publish(): void {
  version += 1
  for (const listener of listeners) listener()
}

function activeLease(key: string): LeaseRecord | undefined {
  const lease = leases.get(key)
  if (lease === undefined) return undefined
  if (lease.expiresAt <= Date.now()) {
    leases.delete(key)
    return undefined
  }
  return lease
}

function isForeignLease(key: string): boolean {
  const lease = activeLease(key)
  return lease !== undefined && lease.tabId !== tabId
}

function broadcast(message: LeaseMessage): void {
  try { channel?.postMessage(message) } catch { /* channel closed; leases degrade to local */ }
}

function ownedKeys(): string[] {
  const keys: string[] = []
  for (const [key, lease] of leases) if (lease.tabId === tabId && lease.expiresAt > Date.now()) keys.push(key)
  return keys
}

function handle(message: LeaseMessage): void {
  if (message.tabId === tabId) return
  if (message.type === 'lease') {
    leases.set(message.key, { tabId: message.tabId, expiresAt: message.expiresAt })
  } else if (message.type === 'release') {
    const current = activeLease(message.key)
    if (current !== undefined && current.tabId === message.tabId) leases.delete(message.key)
  } else {
    // A newly opened tab asks who is editing; owners renew their claims.
    for (const key of ownedKeys()) {
      const lease = activeLease(key)
      if (lease !== undefined) broadcast({ type: 'lease', key, tabId, expiresAt: lease.expiresAt })
    }
  }
  publish()
}

function init(): void {
  if (initialized) return
  initialized = true
  if (typeof BroadcastChannel === 'undefined') return
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = event => {
      const value = event.data as LeaseMessage | undefined
      if (value !== null && typeof value === 'object' && typeof value.type === 'string' && typeof value.key === 'string') handle(value)
      else if (value !== null && typeof value === 'object' && value.type === 'query') handle(value)
    }
  } catch {
    channel = undefined
  }
}

function stopRenewing(key: string): void {
  const timer = renewTimers.get(key)
  if (timer !== undefined) { clearInterval(timer); renewTimers.delete(key) }
}

function startRenewing(key: string): void {
  stopRenewing(key)
  renewTimers.set(key, setInterval(() => {
    if (!isLeaseOwner(key)) { stopRenewing(key); return }
    const expiresAt = Date.now() + LEASE_TTL_MS
    leases.set(key, { tabId, expiresAt })
    broadcast({ type: 'lease', key, tabId, expiresAt })
    publish()
  }, RENEW_MS))
}

/** Whether this tab currently owns the edit lease for one revision. */
export function isLeaseOwner(key: string): boolean {
  init()
  const lease = activeLease(key)
  return lease !== undefined && lease.tabId === tabId
}

/** Whether another tab currently owns the edit lease for one revision. */
export function hasForeignLease(key: string): boolean {
  init()
  return isForeignLease(key)
}

/**
 * Ask for the edit lease of one revision.
 * @param key - edit-session key.
 * @param takeover - replace another tab's lease on an explicit user action.
 * @returns whether this tab owns the lease afterwards.
 */
export function claimEditLease(key: string, takeover = false): boolean {
  init()
  if (isForeignLease(key) && !takeover) return false
  const expiresAt = Date.now() + LEASE_TTL_MS
  leases.set(key, { tabId, expiresAt })
  broadcast({ type: 'lease', key, tabId, expiresAt })
  startRenewing(key)
  publish()
  return true
}

/** Refresh a lease owned by this tab. */
export function renewEditLease(key: string): void {
  init()
  if (!isLeaseOwner(key)) return
  const expiresAt = Date.now() + LEASE_TTL_MS
  leases.set(key, { tabId, expiresAt })
  broadcast({ type: 'lease', key, tabId, expiresAt })
  publish()
}

/** Drop this tab's lease when the editor closes or unmounts. */
export function releaseEditLease(key: string): void {
  init()
  const lease = activeLease(key)
  stopRenewing(key)
  if (lease === undefined || lease.tabId !== tabId) return
  leases.delete(key)
  broadcast({ type: 'release', key, tabId })
  publish()
}

/** Ask other tabs to report their leases (call when an editor opens). */
export function queryEditLeases(): void {
  init()
  broadcast({ type: 'query', tabId })
}

/** Subscribe to lease changes. */
export function subscribeEditLeases(listener: () => void): () => void {
  init()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function leaseSnapshot(): number {
  return version
}

/** React hook: whether another tab currently holds one revision. */
export function useForeignEditLease(key: string, active: boolean): boolean {
  useSyncExternalStore(subscribeEditLeases, leaseSnapshot, leaseSnapshot)
  return active && hasForeignLease(key)
}
