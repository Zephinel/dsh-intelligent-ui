/** Stable per-tab command identity; no DOM is required to test the storage path. */
const KEY = 'dsh-intelligent-ui-client-instance'
const valid = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) && value.toLowerCase() !== 'off'

export function createClientTokenReader(options: {
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined
  uuid: () => string
}): () => string {
  let token: string | undefined
  return () => {
    if (token !== undefined) return token
    let storage
    try {
      storage = options.storage()
      const stored = storage?.getItem(KEY)
      if (valid(stored)) return (token = stored)
    } catch { /* storage can be denied; retain the in-memory identity */ }
    const generated = options.uuid()
    if (!valid(generated)) throw new Error('Invalid client instance token')
    token = generated
    try { storage?.setItem(KEY, token) } catch { /* same tab keeps its cached token */ }
    return token
  }
}

export const clientToken = createClientTokenReader({
  storage: () => typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
  uuid: () => globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
})
