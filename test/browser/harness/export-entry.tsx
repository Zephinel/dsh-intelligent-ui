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
import { resolveStyleThemeVars } from '../../../src/lib/style-theme.ts'
import type { StyleSnapshot } from '../../../src/shared/style-templates.ts'
import type { IntelligentUIProgram } from '../../../src/shared/intelligent-ui.ts'
import { createStyleCatalog } from '../../../src/client/styles.ts'
import { createWorkspaceImageResolver } from '../../../src/client/image-source.ts'
import { templates } from './style-fixtures.ts'
import { ExportAction } from '../../../src/client/ExportAction.tsx'
import { registerArtifactRevision, selectArtifactRevision } from '../../../src/client/artifact-edit/artifact-version.ts'
import type { ExportChatSnapshot } from '../../../src/client/export-data.ts'
import { fallbackT } from '../../../src/shared/locales.ts'
import { EXPORT_STANDALONE_CSS_PATH, EXPORT_STANDALONE_JS_PATH } from '../../../src/shared/intelligent-ui.ts'
import '../../../src/client/index.css'

const PHOTO = `${location.origin}/photo.svg`

/**
 * A solid-cyan blob image so the PNG export proves the production local-file
 * path (workspace resolver → MIME sniff → same-origin blob URL) is rasterized
 * without tainting the canvas.
 */
const nativeCreateObjectUrl = URL.createObjectURL.bind(URL)
const LOCAL_IMAGE_BYTES = new Promise<Uint8Array>((resolveBytes) => {
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  const context = canvas.getContext('2d')
  if (context !== null) {
    context.fillStyle = '#00ffff'
    context.fillRect(0, 0, 8, 8)
  }
  canvas.toBlob((blob) => {
    if (blob === null) {
      resolveBytes(new Uint8Array())
      return
    }
    void blob.arrayBuffer().then(buffer => resolveBytes(new Uint8Array(buffer)))
  }, 'image/png')
})

/** The production resolver, backed by the in-page cyan PNG bytes. */
const localImageResolver = createWorkspaceImageResolver('export-harness', {
  remote: {
    async stat() {
      const bytes = await LOCAL_IMAGE_BYTES
      return { ok: true as const, value: { bytes: bytes.byteLength } }
    },
    async readBytes() {
      const bytes = await LOCAL_IMAGE_BYTES
      return { ok: true as const, value: { data: bytes } }
    },
  },
  // The harness wraps URL.createObjectURL to record export downloads; the
  // fixture must use the native factory so it does not join that list.
  createObjectUrl: nativeCreateObjectUrl,
})
// Two follow-up shapes, each with a solid colour marker so the PNG can prove
// what the capture kept: a Card with prose keeps its prose marker (#00ff00) and
// loses only its control; a Card that is only a follow-up block disappears,
// taking its marker (#ff00ff) with it.
const PROGRAM = `root = Col([quizCard, photoCard, localPhotoCard, mixedFollowCard, onlyFollowCard], 3)
localPhotoCard = Card([Image("figures/local.png", "Local chart photo")])
quizCard = Flashcard("front question", "back answer")
photoCard = SearchImage("harness search photo", 1.35)
mixedFollowCard = Card([Title("Follow-up card", "sm"), Text("This card keeps its prose when follow-ups are off.", "sm", "muted"), Box([Text("Kept prose map")], null, 2, null, "#00ff00"), Button("Continue")])
onlyFollowCard = Card([Box([Button("Continue only")], null, 2, null, "#ff00ff")])
`

/** Answer both export entries look up: Turn 1 rendered UI, Turn 2 did not. */
const VISIBLE_MESSAGE = 'msg-visible'
const HIDDEN_MESSAGE = 'msg-hidden'
const SNAPSHOT = {
  nodes: {
    values: () => [
      { kind: 'assistant-step', data: { turn: 1, finalNode: { messageId: VISIBLE_MESSAGE } } },
      { kind: 'assistant-step', data: { turn: 2, finalNode: { messageId: HIDDEN_MESSAGE } } },
      { kind: 'assistant-step', data: { turn: 3, finalNode: { messageId: 'msg-stage' } } },
      { kind: 'assistant-step', data: { turn: 5, finalNode: { messageId: 'msg-stage-missing' } } },
    ],
    turnDataSource: (turn: number) => ({
      getSnapshot: () => turn === 1
        ? [{
            root: {
              phase: 'start',
              callId: 'call-1',
              name: 'render_ui',
              argsRaw: JSON.stringify({ program: PROGRAM, title: 'Export harness', style: 'free', temporaryStyle }),
            },
          }]
        : turn === 3
          ? [{
              root: {
                phase: 'start',
                callId: 'stage-raw-call',
                name: 'render_ui',
                argsRaw: JSON.stringify({ program: STAGE_RAW_PROGRAM, title: 'Raw stage version', style: 'card' }),
              },
            }]
          : turn === 5
            ? [{
                root: {
                  phase: 'start',
                  callId: 'missing-stage-call',
                  name: 'render_ui',
                  argsRaw: JSON.stringify({ program: MISSING_STAGE_PROGRAM, title: 'Missing stage', style: 'card' }),
                },
              }]
            : [],
    }),
  },
} as unknown as ExportChatSnapshot

const temporaryStyle: StyleSnapshot = { schemaVersion: 1, baseLayout: 'free', directives: 'Use compact groups and clear hierarchy.', theme: templates[0].theme }
const PROGRAMS: IntelligentUIProgram[] = [{ callId: 'call-1', program: PROGRAM, title: 'Export harness', style: 'free', running: false, temporaryStyle }]
// M3/D8 fixture: a Turn that only shows a revision notice, while the selected
// revision is displayed by a stage card in another Turn.
const STAGE_ARTIFACT = 'stage-art-1'
const STAGE_RAW_PROGRAM = 'root = Col([Card([Title("RAW-STAGE-MARKER", "sm")])])'
const STAGE_SELECTED_PROGRAM = 'root = Col([Card([Title("SELECTED-STAGE-MARKER", "sm"), Text("selected revision body", "sm")])])'
// A second notice-only Turn whose artifact has no mounted stage: the image
// export must report the concrete "no capturable stage" cause instead of a
// generic retry copy.
const MISSING_STAGE_ARTIFACT = 'missing-stage-art-1'
const MISSING_STAGE_PROGRAM = 'root = Col([Card([Title("MISSING-STAGE-MARKER", "sm")])])'
const MISSING_STAGE_PROGRAMS: IntelligentUIProgram[] = [{
  callId: 'missing-stage-call',
  program: MISSING_STAGE_PROGRAM,
  title: 'Missing stage',
  style: 'card',
  running: false,
  artifactId: MISSING_STAGE_ARTIFACT,
  revisionId: 'missing-stage-art-1-rev-1',
  revision: 1,
}]
const STAGE_PROGRAMS: IntelligentUIProgram[] = [{
  callId: 'stage-raw-call',
  program: STAGE_RAW_PROGRAM,
  title: 'Raw stage version',
  style: 'card',
  running: false,
  artifactId: STAGE_ARTIFACT,
  revisionId: 'stage-art-1-rev-1',
  revision: 1,
}]
registerArtifactRevision('e2e-session', STAGE_ARTIFACT, {
  revisionId: 'stage-art-1-rev-1',
  artifactId: STAGE_ARTIFACT,
  revision: 1,
  program: STAGE_RAW_PROGRAM,
  title: 'Raw stage version',
  style: 'card',
})
registerArtifactRevision('e2e-session', STAGE_ARTIFACT, {
  revisionId: 'stage-art-1-rev-2',
  artifactId: STAGE_ARTIFACT,
  revision: 2,
  program: STAGE_SELECTED_PROGRAM,
  title: 'Stage export',
  style: 'card',
})
selectArtifactRevision('e2e-session', STAGE_ARTIFACT, 'stage-art-1-rev-2')
const savedTemplates = [{ ...templates[0], baseLayout: 'free', theme: { ...templates[0].theme, light: { ...templates[0].theme.light, canvas: '#f0fff4' } } }]
const styles = createStyleCatalog({ fetch: async () => new Response(JSON.stringify({ templates: savedTemplates })) })
const SETTINGS: { background: string; scale: '1x' | '2x'; removeFollowUps: boolean } = { background: '#ffffff', scale: '1x', removeFollowUps: false }

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
  const [saved, setSaved] = useState(false)
  ;(window as any).useSavedTemplate = () => {
    PROGRAMS[0] = { ...PROGRAMS[0], style: 'free', temporaryStyle: undefined, styleId: savedTemplates[0].id }
    setSaved(true)
  }
  return (
    <section className="dsh-iui-card" data-dsh-intelligent-ui="card" data-dsh-iui-style="free">
      <button type="button" className="dsh-iui-header" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
        <span className="dsh-iui-title" data-dsh-iui-title>Export harness</span>
      </button>
      <div className="dsh-iui-body" hidden={collapsed}>
        <OpenUIRenderer program={PROGRAM} title="Export harness" themeStyle={resolveStyleThemeVars(saved ? savedTemplates[0].theme : temporaryStyle.theme, 'light')} scheme="light" resolveImage={localImageResolver} />
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
          styles={styles}
          sessionId="e2e-session"
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

/** D8 fixture, mounted on demand after the legacy export scenarios: a notice-only
 * Turn whose artifact's selected revision lives on a stage card in another Turn. */
function StageExportFixture(): ReactElement {
  return (
    <>
  <div data-turn-tail="3">
    <div className="dsh-iui-cards" data-dsh-intelligent-ui-list>
      <section className="dsh-iui-card" data-dsh-intelligent-ui="card" data-dsh-iui-stage-card data-artifact-id={STAGE_ARTIFACT} data-dsh-iui-call-id="stage-card-call">
        <button type="button" className="dsh-iui-header" aria-expanded="true">
          <span className="dsh-iui-title dsh-iui-title">Stage export</span>
        </button>
        <div className="dsh-iui-body">
          <OpenUIRenderer program={STAGE_SELECTED_PROGRAM} title="Stage export" scheme="light" />
        </div>
      </section>
    </div>
  </div>
  <div data-turn-tail="4">
    <div className="dsh-iui-cards" data-dsh-intelligent-ui-list>
      <button type="button" className="dsh-iui-revision-notice" data-dsh-iui-revision-notice data-dsh-iui-artifact-id={STAGE_ARTIFACT}>
        Revision notice
      </button>
    </div>
    <div className="harness-actions" data-stage-export style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <ExportAction
        styles={styles}
        sessionId="e2e-session"
        messageId={'msg-stage' as never}
        programsFor={() => STAGE_PROGRAMS}
        settings={() => SETTINGS}
        useChat={useChat}
        t={fallbackT}
      />
    </div>
  </div>
  <div data-turn-tail="5">
    <div className="dsh-iui-cards" data-dsh-intelligent-ui-list>
      <button type="button" className="dsh-iui-revision-notice" data-dsh-iui-revision-notice data-dsh-iui-artifact-id={MISSING_STAGE_ARTIFACT}>
        Revision notice
      </button>
    </div>
    <div className="harness-actions" data-missing-stage-export style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <ExportAction
        styles={styles}
        sessionId="e2e-session"
        messageId={'msg-stage-missing' as never}
        programsFor={() => MISSING_STAGE_PROGRAMS}
        settings={() => SETTINGS}
        useChat={useChat}
        t={fallbackT}
      />
    </div>
  </div>
    </>
  )
}

/** Mount the D8 fixture only when the E2E needs it, keeping the legacy single-trigger layout. */
;(window as unknown as { __mountStageExportFixture: () => void }).__mountStageExportFixture = () => {
  if (document.getElementById('stage-fixture') !== null) return
  const host = document.createElement('div')
  host.id = 'stage-fixture'
  document.body.appendChild(host)
  createRoot(host).render(<StageExportFixture />)
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
;(window as unknown as { setExportRemoveFollowUps: (value: boolean) => void }).setExportRemoveFollowUps = (value) => {
  SETTINGS.removeFollowUps = value
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
  const cards = [...element.querySelectorAll<HTMLElement>('.iui-card')]
  const mixedCard = cards.find(node => node.textContent?.includes('Follow-up card'))
  const pureCard = cards.find(node => node.textContent?.includes('Continue only'))
  const mixedTitle = mixedCard === undefined ? undefined : [...mixedCard.querySelectorAll<HTMLElement>('.iui-title')].find(node => node.textContent?.includes('Follow-up card'))
  const mixedProse = mixedCard === undefined ? undefined : [...mixedCard.querySelectorAll<HTMLElement>('.iui-text')].find(node => node.textContent?.includes('keeps its prose'))
  const followButtons = [...element.querySelectorAll<HTMLButtonElement>('button')].filter(node => node.textContent?.trim() === 'Continue')
  ;(window as unknown as { captureProbes: unknown[] }).captureProbes.push({
    capturedArtifact: element.getAttribute('data-artifact-id'),
    capturedStage: element.hasAttribute('data-dsh-iui-stage-card'),
    capturedText: (element.textContent ?? '').slice(0, 240),
    layout: element.querySelector('[data-dsh-iui-style]')?.getAttribute('data-dsh-iui-style'),
    themeCanvas: getComputedStyle(element.querySelector('.dsh-iui-host')!).getPropertyValue('--iui-canvas').trim(),
    flipFlattened: inner !== null && inner !== undefined && getComputedStyle(inner).transform === 'none',
    frontHidden: front !== null && front !== undefined && getComputedStyle(front).display === 'none',
    backUnrotated: back !== null && back !== undefined && getComputedStyle(back).transform === 'none',
    transitionsFrozen: transitionsFrozen(card),
    animationsFrozen: card !== null && card !== undefined && getComputedStyle(card).animationName === 'none',
    expandedAtCapture: body !== null && body !== undefined && !body.hidden,
    mapReadyAtCapture: element.querySelector<HTMLElement>('[data-iui-map]')?.dataset.iuiMapReady === 'true',
    hiddenFollowUps: element.querySelectorAll('[data-iui-followup-hidden]').length,
    mixedTitleVisible: mixedTitle !== undefined && mixedTitle.getClientRects().length > 0,
    mixedProseVisible: mixedProse !== undefined && mixedProse.getClientRects().length > 0,
    mixedFollowVisible: followButtons.some(node => node.getClientRects().length > 0),
    pureFollowCardVisible: pureCard !== undefined && pureCard.getClientRects().length > 0,
    pureFollowCardMarked: pureCard !== undefined
      && (pureCard.getAttribute('data-iui-followup-hidden') !== null
        || pureCard.closest('[data-iui-followup-hidden]') !== null),
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
