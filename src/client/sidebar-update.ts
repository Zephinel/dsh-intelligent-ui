/**
 * Mount the sidebar update card into the shell's normal sidebar flow.
 *
 * DSH 0.2.2-rc.1's sidebar contract is `single` for the whole browsing region
 * and exposes no slot between the New Session button and the panel list, so a
 * plugin cannot add a banner there through slots. This mounts one React root
 * into a host node inserted directly before the sidebar's panel `<nav>`; the
 * card is therefore an in-flow sibling that pushes Plugins / Automation tasks
 * down instead of covering them. If the sidebar shape is unknown, the host is
 * never inserted and the feature stays hidden (no broken layout).
 *
 * This is the extension's only sidebar insertion (the input-orbit overlay uses
 * a separate document-level host). When DSH adds a sidebar notice slot, replace
 * this module with a slot registration.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { UpdateNotice, type UpdateNoticeProps } from './UpdateNotice.tsx'

/** Attribute used by the stylesheet to hide the host while the sidebar is a rail. */
const HOST_CLASS = 'dsh-iui-sidebar-update-host'

/** Find the sidebar column that owns the panel list (the New Session button's column). */
function findSidebarRoot(): HTMLElement | null {
  const toggle = document.querySelector<HTMLElement>('[data-sidebar-toggle]')
  if (toggle === null) return null
  let node: HTMLElement | null = toggle.parentElement
  while (node !== null && node !== document.body) {
    if (Array.from(node.children).some((child) => child.tagName === 'NAV')) return node
    node = node.parentElement
  }
  return null
}

/** Find the direct panel-list nav inside one sidebar column. */
function findPanelNav(root: HTMLElement): HTMLElement | undefined {
  return Array.from(root.children).find((child): child is HTMLElement => child.tagName === 'NAV')
}

/**
 * Install the update card and return its disposer.
 * @param props - the card's navigation face and translate seat.
 * @returns cleanup removing the React root, the host and the observer.
 */
export function installSidebarUpdateNotice(props: UpdateNoticeProps): () => void {
  if (typeof document === 'undefined') return () => {}
  const host = document.createElement('div')
  host.className = HOST_CLASS
  host.dataset.dshIuiSidebarUpdateHost = ''
  const root = createRoot(host)
  root.render(createElement(UpdateNotice, props))
  let queued = false
  let disposed = false
  const place = (): void => {
    if (disposed) return
    const sidebar = findSidebarRoot()
    if (sidebar === null) return
    const nav = findPanelNav(sidebar)
    if (nav === undefined) return
    if (host.parentElement !== sidebar || host.nextElementSibling !== nav) sidebar.insertBefore(host, nav)
  }
  const schedule = (): void => {
    if (disposed || queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      place()
    })
  }
  place()
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    disposed = true
    observer.disconnect()
    root.unmount()
    host.remove()
  }
}
