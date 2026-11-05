/**
 * M4-1 production renderer harness: nested block wrapping through
 * `OpenUIRenderer` (`nestedBlockSlots`) and the client path resolver.
 *
 * Modes:
 *   - `baseline`: ordinary renderer, no block wrappers.
 *   - `nested`: `nestedBlockSlots` with a `BlockSlotPathContext` resolver whose
 *     identity is derived deterministically from the path (so the E2E can verify
 *     that blockId/nodeId/blockIndex come from the resolver, not the wrapper).
 *   - `nested-fallback`: `nestedBlockSlots` without a resolver; BlockSlot falls
 *     back to the path for blockId/nodeId.
 *   - `toplevel`: the previous top-level edit rendering (`blockSlots`), given a
 *     source-rewritten program by the caller.
 *
 * Global control surface: `window.__renderNested(mode, program)`.
 */
import { type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { OpenUIRenderer } from '../../../src/lib/render.tsx'
import { BlockSlotPathContext, type BlockSlotIdentity } from '../../../src/lib/components/block-slot.tsx'
import type { Translate } from '../../../src/shared/locales.ts'
import { fallbackT } from '../../../src/shared/locales.ts'
import { NESTED_PROGRAM } from '../fixtures/nested-artifact.ts'

/** Renderer modes the E2E can request. */
type RenderMode = 'baseline' | 'nested' | 'nested-fallback' | 'toplevel'

/**
 * Deterministic resolver: exposes the path in every identity field so the E2E
 * can tell resolver-provided values from the wrapper's fallback props.
 * @param path - nested tree path (`root/children/0/children/1`).
 * @returns the display identity for that path.
 */
function resolvePath(path: string): BlockSlotIdentity {
  const segments = path.split('/children/')
  const last = Number(segments[segments.length - 1])
  const dotted = path.replaceAll('/children/', '.')
  return {
    blockId: `b-${dotted}`,
    nodeId: `n-${dotted}`,
    blockIndex: Number.isFinite(last) ? last + 1 : 1,
  }
}

/** One render; the t seat is the English fallback used by standalone embeds. */
function RenderApp({ mode, program, t = fallbackT }: {
  readonly mode: RenderMode
  readonly program: string
  readonly t?: Translate
}): ReactElement {
  const renderer = (
    <div className="dsh-iui-surface">
      <OpenUIRenderer
        program={program}
        title="nested"
        scopeId="nested-render"
        blockSlots={mode === 'toplevel'}
        nestedBlockSlots={mode === 'nested' || mode === 'nested-fallback'}
        t={t}
      />
    </div>
  )
  return (
    <div data-render-mode={mode}>
      {mode === 'nested'
        ? <BlockSlotPathContext.Provider value={{ parentPath: '', resolve: resolvePath }}>{renderer}</BlockSlotPathContext.Provider>
        : renderer}
    </div>
  )
}

const container = document.getElementById('root')
if (container === null) throw new Error('nested-render harness: #root missing')
const reactRoot = createRoot(container)

/** E2E control surface. */
function renderNested(mode: RenderMode, program: string): boolean {
  reactRoot.render(<RenderApp mode={mode} program={program} />)
  return true
}

;(window as unknown as { __renderNested: typeof renderNested }).__renderNested = renderNested
renderNested('baseline', NESTED_PROGRAM)
