/**
 * Browser harness for the answer image export.
 *
 * Renders one card with a flashcard and a real `SearchImage` whose Wikipedia
 * lookup is stubbed to a local SVG, plus two real `ExportAction` entries. Both
 * entries drive the **real** Chat selector lookup against a structural snapshot:
 * one message's Turn recorded `render_ui`, the other did not. The E2E flips the
 * flashcard, opens the visible entry's menu and runs the production export
 * pipeline; the patched `snapdom.toCanvas` reports the DOM normalization the
 * capture receives (flattened flip, frozen transitions, eager/loaded photo)
 * while still rendering a real image.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { snapdom } from '@zumer/snapdom'
import { OpenUIRenderer } from '../../../src/lib/render.tsx'
import { ExportAction } from '../../../src/client/ExportAction.tsx'
import type { ExportChatSnapshot } from '../../../src/client/export-data.ts'
import { fallbackT } from '../../../src/shared/locales.ts'
import { EXPORT_STANDALONE_CSS_PATH, EXPORT_STANDALONE_JS_PATH } from '../../../src/shared/intelligent-ui.ts'
import '../../../src/client/index.css'

const PHOTO = `${location.origin}/photo.svg`
const PROGRAM = `root = Col([quizCard, photoCard, followCard], 3)
quizCard = Flashcard("front question", "back answer")
photoCard = SearchImage("harness search photo", 1.35)
followCard = Card([Title("Follow-up card", "sm"), Text("This card should disappear when follow-ups are off.", "sm", "muted"), Button("Continue")])
`

/** Answer both export entries look up: Turn 1 rendered UI, Turn 2 did not. */
const VISIBLE_MESSAGE = 'msg-visible'
const HIDDEN_MESSAGE = 'msg-hidden'
const SNAPSHOT = {
  nodes: {
    values: () => [
      { kind: 'assistant-step', data: { turn: 1, finalNode: { messageId: VISIBLE_MESSAGE } } },
      { kind: 'assistant-step', data: { turn: 2, finalNode: { messageId: HIDDEN_MESSAGE } } },
    ],
    turnDataSource: (turn: number) => ({
      getSnapshot: () => turn === 1
        ? [{
            root: {
              phase: 'start',
              callId: 'call-1',
              name: 'render_ui',
              argsRaw: JSON.stringify({ program: PROGRAM, title: 'Export harness' }),
            },
          }]
        : [],
    }),
  },
} as unknown as ExportChatSnapshot

const PROGRAMS = [{ callId: 'call-1', program: PROGRAM, title: 'Export harness', running: false }]
const SETTINGS: { background: string; scale: '1x' | '2x'; toAssistant: boolean } = { background: '#ffffff', scale: '1x', toAssistant: true }

// The SearchImage component searches Wikipedia for its photo. Keep the E2E
// offline and deterministic while still exercising the real debounce, pending
// placeholder and "photo arrives after mount" settling path.
const realFetch = window.fetch.bind(window)
function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
}
const STANDALONE_JS = 'window.mountIUI = function (element, cards, options) { window.__standaloneMount = { hasElement: element !== null, cards: cards.length, lang: options.lang } }'
const STANDALONE_CSS = '.dsh-iui-card{--standalone-css:true}'
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('/api/rest_v1/page/summary/')) return jsonResponse({ thumbnail: { source: PHOTO } })
  if (url.includes('/api/rest_v1/page/media-list/')) return jsonResponse({ items: [] })
  if (url.includes('/w/api.php')) return jsonResponse({ query: { pages: [] } })
  if (url.endsWith(EXPORT_STANDALONE_JS_PATH)) {
    return new Response(STANDALONE_JS, { status: 200, headers: { 'content-type': 'text/javascript' } })
  }
  if (url.endsWith(EXPORT_STANDALONE_CSS_PATH)) {
    return new Response(STANDALONE_CSS, { status: 200, headers: { 'content-type': 'text/css' } })
  }
  return realFetch(input, init)
}

/**
 * Stand-in for the renderer's map: publishes the same data-iui-map readiness
 * attribute and goes not-ready on every resize, then ready again after a beat.
 * This lets the E2E prove the export waits for the map signal.
 */
function FakeMap(): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    let timer = 0
    const observer = new ResizeObserver(() => {
      element.dataset.iuiMapReady = 'false'
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { element.dataset.iuiMapReady = 'true' }, 450)
    })
    observer.observe(element)
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [])
  return <div ref={ref} data-iui-map data-iui-map-ready="false" style={{ height: 120, background: '#dfe6f0', borderRadius: 8 }} />
}

/** One collapsible card shell matching the rendered-answer chrome. */
function Card(): ReactElement {
  const [collapsed, setCollapsed] = useState(true)
  return (
    <section className="dsh-iui-card" data-dsh-intelligent-ui="card">
      <button type="button" className="dsh-iui-header" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
        <span className="dsh-iui-title" data-dsh-iui-title>Export harness</span>
      </button>
      <div className="dsh-iui-body" hidden={collapsed}>
        <OpenUIRenderer program={PROGRAM} title="Export harness" />
        <FakeMap />
      </div>
    </section>
  )
}

/** The fake Chat hook the slot kit would supply: run the real selector. */
const useChat = (selector: (snapshot: ExportChatSnapshot) => boolean): boolean => selector(SNAPSHOT)

function App(): ReactElement {
  return (
    <div data-turn-tail="1">
      <div className="dsh-iui-cards" data-dsh-intelligent-ui-list>
        <Card />
      </div>
      <div
        className="harness-actions"
        style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, width: 600, color: '#555' }}
      >
        <button type="button" aria-label="copy">copy</button>
        <ExportAction
          messageId={VISIBLE_MESSAGE as never}
          programsFor={() => PROGRAMS}
          settings={() => SETTINGS}
          useChat={useChat}
          t={fallbackT}
        />
        <button type="button" aria-label="branch">branch</button>
        <span style={{ marginLeft: 8 }}>usage 1.2k</span>
        <ExportAction
          messageId={HIDDEN_MESSAGE as never}
          programsFor={() => []}
          settings={() => SETTINGS}
          useChat={useChat}
          t={fallbackT}
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('app')!).render(<App />)

/** Whether the element and its ancestors have no running transition duration. */
function transitionsFrozen(element: Element | null | undefined): boolean {
  if (element === null || element === undefined) return false
  return getComputedStyle(element).transitionDuration === '0s'
}

// Record every raster capture call instead of depending on snapshots.
;(window as unknown as { setExportScale: (scale: '1x' | '2x') => void }).setExportScale = (scale) => {
  SETTINGS.scale = scale
}
;(window as unknown as { setExportToAssistant: (value: boolean) => void }).setExportToAssistant = (value) => {
  SETTINGS.toAssistant = value
}
;(window as unknown as { captureProbes: unknown[] }).captureProbes = []
const originalToCanvas = snapdom.toCanvas.bind(snapdom)
;(snapdom as unknown as { toCanvas: typeof snapdom.toCanvas }).toCanvas = (async (element: Element, options?: Parameters<typeof snapdom.toCanvas>[1]) => {
  const card = element.querySelector('.iui-flashcard')
  const inner = card?.querySelector<HTMLElement>('.iui-flashcard-inner')
  const front = card?.querySelector<HTMLElement>('.iui-flashcard-face.is-front')
  const back = card?.querySelector<HTMLElement>('.iui-flashcard-face.is-back')
  const photo = element.querySelector<HTMLImageElement>('.iui-image img')
  const body = element.querySelector<HTMLElement>('.dsh-iui-body')
  ;(window as unknown as { captureProbes: unknown[] }).captureProbes.push({
    flipFlattened: inner !== null && inner !== undefined && getComputedStyle(inner).transform === 'none',
    frontHidden: front !== null && front !== undefined && getComputedStyle(front).display === 'none',
    backUnrotated: back !== null && back !== undefined && getComputedStyle(back).transform === 'none',
    transitionsFrozen: transitionsFrozen(card),
    animationsFrozen: card !== null && card !== undefined && getComputedStyle(card).animationName === 'none',
    expandedAtCapture: body !== null && body !== undefined && !body.hidden,
    mapReadyAtCapture: element.querySelector<HTMLElement>('[data-iui-map]')?.dataset.iuiMapReady === 'true',
    hiddenFollowUps: element.querySelectorAll('[data-iui-followup-hidden]').length,
    photoEager: photo?.loading === 'eager',
    photoComplete: photo?.complete === true && (photo?.naturalWidth ?? 0) > 0,
  })
  return originalToCanvas(element, options)
}) as typeof snapdom.toCanvas

// Keep downloads in-page so the E2E can inspect the encoded PNGs.
;(window as unknown as { downloads: string[]; exportedBlobs: Blob[] }).downloads = []
;(window as unknown as { downloads: string[]; exportedBlobs: Blob[] }).exportedBlobs = []
URL.createObjectURL = (blob: Blob) => {
  ;(window as unknown as { exportedBlobs: Blob[] }).exportedBlobs.push(blob)
  return 'blob:export-harness'
}
HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
  ;(window as unknown as { downloads: string[] }).downloads.push(this.download)
}
