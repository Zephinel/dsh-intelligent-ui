/**
 * Client mapping from the M4 CST tree to editable display blocks.
 *
 * Root children keep the historical `bN` labels so existing target orders and
 * tests stay valid. Nested children get `parent.N` labels. The CST node id and
 * source digest are carried alongside for the Host-side nested edit validation.
 */
import { buildArtifactTree, type ArtifactTreeNode } from '../../shared/program-cst.ts'
import { NESTED_CONTAINER_TYPES } from '../../shared/artifact-containers.ts'
import type { ArtifactBlock, ArtifactBlockKind } from '../../shared/artifact-edit.ts'

/** Containers whose direct children are offered as nested blocks in M4-1. */
export const NESTED_CONTAINERS = NESTED_CONTAINER_TYPES

/** One editable display block plus its path mapping for the renderer. */
export interface NestedBlockEntry {
  readonly block: ArtifactBlock
  /** Renderer path (`root/children[0]/...`) used by the edit-mode BlockSlot HOC. */
  readonly path: string
}

/** Result of mapping one program to nested display blocks. */
export interface NestedBlockMap {
  readonly blocks: readonly ArtifactBlock[]
  /** Renderer path (`root/children/0/...`) -> display block, for the path context. */
  readonly byPath: ReadonlyMap<string, ArtifactBlock>
  /** CST node id -> display block. */
  readonly byNodeId: ReadonlyMap<string, ArtifactBlock>
  /** CST node id of the root Col (used as a move target). */
  readonly rootNodeId: string
  /** Whether the program contains at least one block below the root level. */
  readonly hasNested: boolean
}

const INTERACTIVE = new Set([
  'Button', 'IconButton', 'Pressable', 'Input', 'TextArea', 'Select', 'SegmentedControl',
  'Slider', 'Checkbox', 'RadioGroup', 'DatePicker', 'Timer', 'Form', 'Flashcard', 'Celebration',
])
const DRAWING = new Set(['Svg', 'HtmlView', 'Path', 'Polyline', 'Polygon'])
const MEDIA = new Set(['Image', 'SearchImage', 'YouTube'])
const CHART = new Set(['Chart', 'Map', 'MapView'])
const CONTAINER = new Set(['Col', 'Row', 'Box', 'Grid', 'Carousel', 'Card', 'Section', 'Popover'])

/** Coarse display kind for panel copy. */
function kindOf(componentType: string): ArtifactBlockKind {
  if (componentType === 'Card') return 'card'
  if (componentType === 'Section') return 'section'
  if (componentType === 'Table') return 'table'
  if (CHART.has(componentType)) return 'chart'
  if (INTERACTIVE.has(componentType)) return 'interactive'
  if (DRAWING.has(componentType)) return 'drawing'
  if (MEDIA.has(componentType)) return 'media'
  if (CONTAINER.has(componentType)) return 'container'
  return 'content'
}

/**
 * Build display blocks from the CST tree: all editable root children plus the
 * editable children of the supported nested containers.
 * @param program - complete OpenUI Lang program.
 * @returns display blocks and path maps, or undefined when the program is unsupported.
 */
export function nestedBlocksForProgram(program: string): NestedBlockMap | undefined {
  const tree = buildArtifactTree(program, { containerTypes: [...NESTED_CONTAINERS] })
  if (tree.problems.length > 0 || tree.limitsExceeded !== undefined) return undefined
  const root = tree.nodes.get(tree.rootNodeId)
  if (root === undefined) return undefined
  const blocks: ArtifactBlock[] = []
  const byPath = new Map<string, ArtifactBlock>()
  const byNodeId = new Map<string, ArtifactBlock>()
  let displayOrder = 0
  let hasNested = false

  const visit = (parentDisplayId: string | undefined, nodeIds: readonly string[], depth: number, rootIndex: number): void => {
    let ordinal = 0
    nodeIds.forEach(nodeId => {
      const node = tree.nodes.get(nodeId)
      if (node === undefined || !node.editable || node.problem !== undefined) return
      ordinal += 1
      displayOrder += 1
      const blockId = parentDisplayId === undefined ? `b${ordinal}` : `${parentDisplayId}.${ordinal}`
      const block: ArtifactBlock = {
        blockId,
        nodeId: node.nodeId,
        ...parentDisplayId === undefined ? {} : { parentBlockId: parentDisplayId },
        depth,
        sourceDigest: node.digest,
        nodePath: node.nodePath,
        originalIndex: displayOrder,
        rootIndex,
        componentType: node.componentType,
        kind: kindOf(node.componentType),
        ...node.statementId === undefined ? {} : { statementId: node.statementId },
        ...node.title === undefined ? {} : { title: node.title },
      }
      blocks.push(block)
      // The nested renderer HOC publishes slash-style paths; the Host/CST
      // contract keeps the bracketed nodePath on the block itself.
      byPath.set(node.nodePath.replace(/\[(\d+)\]/g, '/$1'), block)
      byNodeId.set(node.nodeId, block)
      if (depth > 0) hasNested = true
      // Only supported containers expose their direct children as blocks.
      if (depth < 4 && NESTED_CONTAINERS.includes(node.componentType as never)) {
        visit(blockId, node.children, depth + 1, rootIndex)
      }
    })
  }

  visit(undefined, root.children, 0, 0)
  if (blocks.length === 0) return undefined
  return { blocks, byPath, byNodeId, rootNodeId: tree.rootNodeId, hasNested }
}
