/** Recorded-program fixture uses the production card list and a late local catalog. */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { IntelligentUICards } from '../../../src/client/IntelligentUICards.tsx'
import { createStyleCatalog } from '../../../src/client/styles.ts'
import { templates } from './style-fixtures.ts'
import '../../../src/client/index.css'

let load: () => void
let unavailable = false
const gate = new Promise<void>(resolve => { load = resolve })
;(window as unknown as { __loadStyles: () => void }).__loadStyles = () => load()
const styles = createStyleCatalog({ fetch: async () => {
  await gate
  if (unavailable) throw new Error('Fixture offline')
  return new Response(JSON.stringify({ templates }))
} })
;(window as unknown as { __refreshStyles: (fail: boolean) => Promise<void> }).__refreshStyles = (fail) => {
  unavailable = fail
  return styles.refresh()
}
const nodes = [
  { callId: 'custom', styleId: 'cs_ocean01' },
  { callId: 'default' },
  { callId: 'missing', styleId: 'cs_missing' },
].map(({ callId, styleId }) => ({ root: {
  phase: 'start' as const, callId, name: 'render_ui',
  argsRaw: JSON.stringify({ program: 'root = Card([Text("Theme fixture")])', style: 'card', styleId }),
} }))
// A settled call reconstructed from durable arguments: no styleId or catalog entry.
const temporaryStyle = {
  schemaVersion: 1, baseLayout: 'card', directives: 'Use compact groups and clear hierarchy.', theme: templates[0].theme,
}
nodes.push({ root: {
  kind: 'tool-result', callId: 'temporary', name: 'render_ui', isError: false,
  call: { name: 'render_ui', argsRaw: JSON.stringify({ program: 'root = Card([Text("Inline replay fixture")])', style: 'card', temporaryStyle }) },
} } as never)

createRoot(document.getElementById('root')!).render(createElement(IntelligentUICards, {
  turn: { turn: 1 }, inputActions: undefined, sessionId: 'e2e-session', styles, usePrograms: () => nodes,
} as never))
