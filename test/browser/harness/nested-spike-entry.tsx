/**
 * M4-0b renderer spike harness: nested BlockSlot wrapping + overlay mapping.
 *
 * This harness deliberately mounts the vendored `Renderer` directly (same
 * `library`/`blockEditLibrary` instances, same CSS) instead of the production
 * `OpenUIRenderer`, so the spike can swap in a derived edit-mode library without
 * touching production render paths.
 *
 * Derived edit library (candidate B): every container component renderer
 * (`Col`, `Row`, `Card`) is wrapped with an HOC that replaces its direct
 * `children` value with synthetic `BlockSlot` element nodes before delegating
 * to the original renderer. Each synthetic node carries a positional `path`
 * (`root/0`, `root/0/1`, ...), which the (path-aware) `BlockSlot` publishes to
 * descendants via `BlockSlotPathContext` and mirrors as a DOM attribute. The
 * wrapper then calls the original component's `renderNode(props.children)`,
 * which proves candidate A: `renderNode` accepts runtime-synthesized element
 * nodes and resolves them through the edit-mode library.
 *
 * Global control surface used by the E2E:
 *   window.__spikeRender(mode, program)
 *     mode: 'baseline' (normal library, no wrapping)
 *         | 'edit-contents' (derived edit library, wrapper boxes display:contents)
 *         | 'edit-fixed' (edit-contents + direct-child CSS compensation layer)
 *         | 'edit-box' (derived edit library, wrapper boxes keep their block box)
 *         | 'production-edit' (blockEditLibrary + source-rewritten root wraps)
 */
import { useContext, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Renderer, createLibrary } from '@openuidev/react-lang'
import { blockEditLibrary, library } from '../../../src/lib/library.ts'
import { BlockSlotPathContext } from '../../../src/lib/components/block-slot.tsx'
import { extractArtifactBlocks, wrapProgramForBlockEditing } from '../../../src/shared/artifact-blocks.ts'
import { NESTED_PROGRAM } from '../fixtures/nested-artifact.ts'

/** Layout modes the spike can compare. */
type SpikeMode = 'baseline' | 'edit-contents' | 'edit-fixed' | 'edit-box' | 'production-edit'

/** Minimal structural view of a defined component (the real type lives in lang-core). */
interface SpikeComponent {
  readonly name: string
  readonly component: (input: { props: Record<string, unknown>; renderNode: (value: unknown) => unknown; statementId?: string }) => unknown
}

/** Elements rendered by the edit-mode library from synthesized AST. */
interface SpikeElementNode {
  readonly type: 'element'
  readonly typeName: string
  readonly partial: false
  readonly props: Record<string, unknown>
}

/**
 * Synthesize one `BlockSlot` element node around a direct child.
 * @param path - positional path of the child.
 * @param blockIndex - 1-based sibling index.
 * @param child - evaluated child value (element node, array or primitive).
 * @returns the synthetic element node.
 */
function syntheticSlot(path: string, blockIndex: number, child: unknown): SpikeElementNode {
  return { type: 'element', typeName: 'BlockSlot', partial: false, props: { blockId: path, blockIndex, path, children: child } }
}

/** Wrap every direct child of one container in a synthetic nested BlockSlot node. */
function wrapChildren(parentPath: string, children: unknown): unknown {
  if (Array.isArray(children)) return children.map((child, index) => syntheticSlot(`${parentPath}/${index}`, index + 1, child))
  if (children === undefined || children === null) return children
  return syntheticSlot(`${parentPath}/0`, 1, children)
}

/**
 * Candidate B: HOC around one container renderer. It reads the enclosing
 * BlockSlot path from context, synthesizes BlockSlot nodes for its direct
 * children, and delegates to the original renderer (which calls
 * `renderNode(props.children)`).
 */
function wrapContainer(original: SpikeComponent): SpikeComponent {
  function SpikeContainer({ props, renderNode, statementId }: {
    props: Record<string, unknown>
    renderNode: (value: unknown) => unknown
    statementId?: string
  }): unknown {
    const pathContext = useContext(BlockSlotPathContext)
    const parentPath = pathContext?.parentPath ?? ''
    const base = parentPath === '' ? 'root' : parentPath
    const wrapped = { ...props, children: wrapChildren(base, props.children) }
    return original.component({ props: wrapped, renderNode, statementId })
  }
  return { ...original, component: SpikeContainer }
}

/** Containers whose direct children become nested blocks in the spike. */
const CONTAINER_NAMES = new Set(['Col', 'Row', 'Card'])

/** All edit-library components, with the containers wrapped for nested slots. */
const spikeComponents = Object.values(blockEditLibrary.components as Record<string, SpikeComponent>)
  .map(component => CONTAINER_NAMES.has(component.name) ? wrapContainer(component) : component)

/** Derived edit-mode library: same components plus nested BlockSlot wrapping. */
const spikeLibrary = createLibrary({
  root: 'Col',
  components: spikeComponents as never,
  componentGroups: blockEditLibrary.componentGroups,
  functions: Object.values((blockEditLibrary.functions ?? {}) as Record<string, unknown>) as never,
  actions: Object.values((blockEditLibrary.actions ?? {}) as Record<string, unknown>) as never,
})

/** Same program wrapped by the current production root-level editor rewrite. */
const PRODUCTION_WRAPPED = wrapProgramForBlockEditing(NESTED_PROGRAM, extractArtifactBlocks(NESTED_PROGRAM)) ?? NESTED_PROGRAM

/** One render of the spike app. */
function SpikeApp({ mode, program }: { readonly mode: SpikeMode; readonly program: string }): ReactElement {
  const activeLibrary = mode === 'baseline'
    ? library as never
    : mode === 'production-edit'
      ? blockEditLibrary as never
      : spikeLibrary as never
  const activeProgram = mode === 'production-edit' ? PRODUCTION_WRAPPED : program
  return (
    <div className="dsh-iui-host dsh-iui-root" data-iui-scheme="light">
      <div className="spike-root" data-spike-mode={mode}>
        <Renderer
          key={`${mode}:${program}`}
          response={activeProgram}
          library={activeLibrary}
          isStreaming={false}
          onAction={() => undefined}
        />
      </div>
    </div>
  )
}

const container = document.getElementById('root')
if (container === null) throw new Error('spike harness: #root missing')
const reactRoot = createRoot(container)

/** E2E control surface: render one mode/program pair, switching layout CSS. */
function renderSpike(mode: SpikeMode, program: string): boolean {
  document.documentElement.dataset.spikeLayout = mode === 'edit-contents' || mode === 'edit-fixed' ? 'contents' : 'box'
  document.documentElement.dataset.spikeCompensate = mode === 'edit-fixed' ? 'true' : 'false'
  reactRoot.render(<SpikeApp mode={mode} program={program} />)
  return true
}

;(window as unknown as { __spikeRender: typeof renderSpike }).__spikeRender = renderSpike
renderSpike('baseline', NESTED_PROGRAM)

