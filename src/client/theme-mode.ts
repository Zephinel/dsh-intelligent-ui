/** Follow the DSH body hook, falling back to the system preference outside DSH. */
import { useSyncExternalStore } from 'react'

function readScheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  if (document.body?.hasAttribute('data-ds-dark-theme')) return 'dark'
  if (typeof window !== 'undefined' && '__DSH_BOOT__' in window) return 'light'
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function subscribe(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined
  const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(listener)
  if (document.body !== null) observer?.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  const media = typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-color-scheme: dark)')
  media?.addEventListener('change', listener)
  return () => {
    observer?.disconnect()
    media?.removeEventListener('change', listener)
  }
}

/** The server snapshot stays light even on Node versions that expose navigator. */
export function useStyleScheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, readScheme, () => 'light')
}
