/**
 * Props contract between the edit-session store and the presentational edit
 * view. The store owns state transitions and the composer chip; the view owns
 * layout, overlays, the block popover and the request panel.
 */
import type { CSSProperties } from 'react'
import type { Translate } from '../../shared/locales.ts'
import type { ArtifactBlockPropComponent, ArtifactBlockProps } from '../../shared/artifact-block-props.ts'
import type { ArtifactBlock, ArtifactBlockKind } from '../../shared/artifact-edit.ts'
import type { ArtifactStyleTarget } from '../../shared/artifact-structure.ts'
import type { RenderLayout } from '../../shared/intelligent-ui.ts'
import type { StyleSnapshot, StyleTheme } from '../../shared/style-templates.ts'

/**
 * Smallest viewport width that can host the edit canvas and the request panel.
 * Below it block editing is unavailable (the card shows a short notice instead).
 */
export const MIN_EDIT_WIDTH = 720

/** Whether the viewport is wide enough for block editing. */
export function isEditViewportWideEnough(width: number): boolean {
  return width >= MIN_EDIT_WIDTH
}

/** Result of trying to enter (or re-activate) edit mode for one rendered card. */
export type OpenEditorResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unsupported' | 'conflict' | 'empty' | 'limit' }

/** One visible block selection in the current edit session. */
export interface ArtifactEditSelectionView {
  readonly blockId: string
  /** 1-based selection order; also the badge number and colour index. */
  readonly order: number
  /** Saved instruction; empty while the user has not written one yet. */
  readonly instruction: string
}

/** Immutable snapshot of one artifact edit session. */
/** One diff line in the structure preview dialog. */
export interface ArtifactStructurePreviewLine {
  readonly kind: 'same' | 'add' | 'remove'
  readonly text: string
}

/** Client state for one deterministic structure dry-run. */
export interface ArtifactStructurePreviewState {
  readonly kind: 'delete' | 'duplicate' | 'move'
  readonly blockId: string
  /** Set when the preview covers a batch (selection toolbar action). */
  readonly batch?: true
  /** Every selected block id when the preview covers a batch, in arrangement order. */
  readonly blockIds?: readonly string[]
  readonly targetParentBlockId?: string
  readonly status: 'loading' | 'ready' | 'failed'
  readonly afterProgram?: string
  readonly changedBlockIds?: readonly string[]
  readonly diff?: readonly ArtifactStructurePreviewLine[]
  readonly error?: string
}

/** Batch arrangement move: one step, or straight to the first/last position. */
export type BatchOrderMode = 'up' | 'down' | 'top' | 'bottom'

export interface ArtifactEditSession {
  /** `${sessionId}:${baseRevisionId}`. */
  readonly key: string
  readonly sessionId: string
  /** Root artifact identity; the first revision's result id. */
  readonly artifactId: string
  /** Result id of the revision being edited. */
  readonly baseRevisionId: string
  /** 1-based revision number of `baseRevisionId`. */
  readonly baseRevision: number
  /**
   * Stable id of this draft's structured request, regenerated when the draft is
   * reused after a send. The Host binds tool calls of one batch by this id.
   */
  readonly requestId: string
  /**
   * Whether this draft contributes a composer chip to the next Send. A draft
   * whose chip the user deleted stays in the switcher but is detached until the
   * user attaches it again.
   */
  readonly attached: boolean
  /**
   * Branch mode: the base revision is not the current head, and sending records
   * a new revision on top of it instead of overwriting the head. Enabled from
   * the conflict banner; the Host re-validates the branch on apply.
   */
  readonly branch?: boolean
  /**
   * Latest known revision number of this artifact, learned from the last
   * successful revision probe (kept for the branch banner copy).
   */
  readonly latestRevision?: number
  readonly title?: string
  readonly style: RenderLayout
  readonly styleId?: string
  /**
   * Result-owned style snapshot for a temporary-style artifact. Content edits
   * carry it in the request (and never carry a styleId); order-only/global-only
   * requests are rejected for these drafts.
   */
  readonly temporaryStyle?: StyleSnapshot
  /** Original program (never rewrapped). */
  readonly program: string
  /** Whether the canvas shows editable blocks nested inside supported containers. */
  readonly nestedMode?: boolean
  /** Strict mode: the Host rejects edits that change unselected blocks. */
  readonly strict?: boolean
  /** Display parent block id -> child display ids in the pending nested order. */
  readonly nestedOrder?: Readonly<Record<string, readonly string[]>>
  /** Display parent block id -> base child display ids (for reset/change detection). */
  readonly nestedOriginalOrder?: Readonly<Record<string, readonly string[]>>
  /** Whether any nested group differs from its base order. */
  readonly nestedOrderChanged?: boolean
  /** Program with internal block wrappers, for the edit-mode renderer. */
  readonly wrappedProgram?: string
  readonly blocks: readonly ArtifactBlock[]
  /** Block ids in the base revision's page order. */
  readonly originalOrder: readonly string[]
  /** Block ids in the pending target order shown by the arrangement list. */
  readonly targetOrder: readonly string[]
  /** Whether the target order differs from the original page order. */
  readonly orderChanged: boolean
  readonly selection: readonly ArtifactEditSelectionView[]
  /** Block whose popover is open; absent when no popover is open. */
  readonly activeBlockId?: string
  /** Draft text of the open popover, kept while switching targets asks to discard. */
  readonly activeDraft: string
  /** Whether unsaved popover text differs from the saved instruction. */
  readonly activeDirty: boolean
  readonly globalInstruction: string
  /**
   * Revision-bound natural-language style requirement. When non-empty this
   * draft sends a style envelope instead of block edits: style and block
   * content can never be combined in one send.
   */
  readonly styleInstruction: string
  readonly editing: boolean
  readonly drawerOpen: boolean
  readonly status: 'checking' | 'ready' | 'conflict' | 'submitted' | 'error'
  /** A submitted request that no revision fulfilled; the draft is kept for retry. */
  readonly submitFailed?: boolean
  /** When this draft was submitted, for bounded retention. */
  readonly submittedAt?: number
  readonly error?: string
  /** Structure operation dry-run preview awaiting confirmation. */
  readonly structurePreview?: ArtifactStructurePreviewState
  /** Pending model-generated additions, one per target container in v1. */
  readonly additions?: readonly { readonly parentBlockId: string; readonly instruction: string }[]
  /** Canvas-only property preview for one quick-adjustable block (Divider/Spacer). */
  readonly propsPreview?: ArtifactBlockPropsPreview
  /** Property adjustment request in flight. */
  readonly propsBusy?: boolean
  /** Last property adjustment failure, shown in the quick-adjust popover. */
  readonly propsError?: string
  /** Why quick adjust cannot persist for this artifact (legacy page without an authoritative base). */
  readonly propsFallback?: 'base_missing' | 'artifact_missing'
  /** Structural operation request in flight; row actions are disabled meanwhile. */
  readonly structureBusy?: boolean
  /** Last structural operation failure, shown inline in the arrangement panel. */
  readonly structureError?: string
  /** Most recent removal, offered as an inline undo in the panel. */
  readonly removable?: { readonly blockId: string; readonly order: number; readonly instruction: string; readonly title?: string }
  /** Deterministic style switch selected in the picker (pending until Apply). */
  readonly styleSwitchTarget?: ArtifactStyleTarget
  /** Stable operation id so a retried switch after a lost response is idempotent. */
  readonly styleSwitchOperationId?: string
  /** Resolved layout of the selected template target (Host identity compare). */
  readonly styleSwitchTargetLayout?: RenderLayout
  /** Deterministic style switch request in flight. */
  readonly styleSwitchBusy?: boolean
  /** Last deterministic style switch failure, shown inline in the style section. */
  readonly styleSwitchError?: string
}

/** One selectable durable style target resolved for the picker. */
export interface ArtifactStyleTargetOption {
  readonly target: ArtifactStyleTarget
  /** Display name: built-in layout label or the saved template's name. */
  readonly name: string
  readonly layout: RenderLayout
  /** Saved-template theme, used for the palette swatch and the edit-canvas preview. */
  readonly theme?: StyleTheme
  /** Article targets need the page's Toc+Section invariant; invalid targets are disabled with one note. */
  readonly requiresArticleLayout?: boolean
}

/** Canvas-only preview of one quick-adjustable block's pending properties. */
export interface ArtifactBlockPropsPreview {
  readonly blockId: string
  readonly nodeId: string
  readonly componentType: ArtifactBlockPropComponent
  readonly props: ArtifactBlockProps
  /** Base program with the block's definition rewritten for preview rendering. */
  readonly program: string
}

/** Actions the edit view invokes; all state transitions stay in the store. */
export interface ArtifactEditActions {
  /** Open a block's instruction popover, loading the saved request when one exists. */
  openBlockEditor(blockId: string): void
  /** Close the popover; unsaved text is discarded by the caller's confirmation. */
  closeBlockEditor(): void
  /** Replace the popover draft. */
  updateBlockDraft(blockId: string, text: string): void
  /** Persist the popover text and close it. Empty text keeps the block selected. */
  saveBlockInstruction(blockId: string, text: string): void
  /** Remove the saved request but keep the block selected. */
  clearBlockInstruction(blockId: string): void
  /** Preview a Divider/Spacer property bag on the canvas without recording it. */
  previewBlockProps(blockId: string, props: ArtifactBlockProps): void
  /** Drop the canvas-only property preview. */
  clearBlockPropsPreview(): void
  /** Apply one Divider/Spacer property bag through the deterministic Host route. */
  applyBlockProps(blockId: string, props: ArtifactBlockProps): void
  /** Remove the block from this edit session (deselect). */
  removeSelection(blockId: string): void
  /** Undo the latest removal. */
  undoRemove(): void
  /** Move one block to a target index of the arrangement draft. */
  moveBlock(blockId: string, toIndex: number): void
  /** Move one block by a relative number of positions (keyboard reordering). */
  moveBlockBy(blockId: string, delta: number): void
  /** Move every selected block one step or to an end, keeping their relative order. */
  moveBlocks(blockIds: readonly string[], mode: BatchOrderMode): void
  /** Move every selected nested block inside its own parent group. */
  moveNestedBlocks(blockIds: readonly string[], mode: BatchOrderMode): void
  /** Restore the target order to the base revision's page order (keeps edits/numbers/global). */
  resetOrder(): void
  /** Remove every saved block request but keep the arrangement draft and global instruction. */
  clearAllEdits(): void
  setGlobalInstruction(text: string): void
  /** Replace the natural-language style instruction of this draft. */
  setStyleInstruction(text: string): void
  /** Exit the edit canvas; a non-empty draft stays as a detached draft + chip. */
  closeEditor(): void
  setDrawerOpen(open: boolean): void
  /** Toggle nested-container block selection in the edit canvas. */
  setNestedMode(key: string, enabled: boolean): void
  /** Toggle strict unselected-block protection for this draft. */
  setStrictMode(key: string, enabled: boolean): void
  /** Reorder one child inside its display parent group. */
  moveNestedBlock(parentBlockId: string, blockId: string, toIndex: number): void
  /** Move one nested child by a relative number of positions. */
  moveNestedBlockBy(parentBlockId: string, blockId: string, delta: number): void
  /** Restore every nested group to its base order. */
  resetNestedOrder(): void
  /** Apply one deterministic delete/duplicate operation without a model turn. */
  applyStructure(blockId: string, op: 'delete' | 'duplicate'): void
  /** Preview a delete/duplicate operation and open its diff confirmation. */
  previewStructure(blockId: string, op: 'delete' | 'duplicate'): void
  /** Preview one batch delete/duplicate and open its diff confirmation. */
  previewBatchStructure(blockIds: readonly string[], op: 'delete' | 'duplicate'): void
  /** Preview moving a block into another container / the page root. */
  previewMoveBlockTo(blockId: string, targetParentBlockId: string | 'root'): void
  /** Apply the currently previewed structure operation. */
  confirmStructurePreview(): void
  /** Dismiss the current structure preview without applying it. */
  cancelStructurePreview(): void
  /** Save (or replace) a model-generated addition for one nested container. */
  saveBlockAddition(parentBlockId: string, instruction: string): void
  /** Remove the pending addition of one nested container. */
  removeBlockAddition(parentBlockId: string): void
  /** Move a block into another container (or the page root) as a structural revision. */
  moveBlockTo(blockId: string, targetParentBlockId: string | 'root'): void
  /** Re-run the revision check after a conflict or error. */
  retryCheck(): void
  /** Turn the conflict into a branch edit based on this (older) revision. */
  enableBranch(key: string): void
  /** Activate one draft of this chat as the edit canvas (switches the active draft). */
  activateDraft(key: string): void
  /** Attach one detached draft to the next Send (no-op when the batch is full). */
  attachDraft(key: string): void
  /** Discard one draft of this chat for good. */
  discardDraft(key: string): void
  /** Select (or clear) the deterministic style switch target of the active draft. */
  selectStyleTarget(target: ArtifactStyleTarget | undefined, layout?: RenderLayout): void
  /** Apply the selected deterministic style switch (zero model turn). */
  applyStyleSwitch(): void
}

/** Full props of the edit view. */
export interface ArtifactEditViewProps {
  readonly t: Translate
  readonly session: ArtifactEditSession
  readonly actions: ArtifactEditActions
  /** Theme tokens resolved for the card, forwarded to the edit-mode renderer. */
  readonly themeStyle?: CSSProperties
  readonly scheme?: 'light' | 'dark'
  /** In-card action continuation, forwarded to the edit-mode renderer. */
  readonly onToAssistant?: (message: string) => void
  /**
   * Host capability for revision-bound style editing (B1). Absent/false keeps
   * the legacy on-demand style fallback and hides the style section.
   */
  readonly styleEditSupported?: boolean
  /** Host capability for deterministic style switching (B2). */
  readonly styleSwitchSupported?: boolean
  /** Durable style targets offered by the picker (built-ins, then saved templates). */
  readonly styleTargets?: readonly ArtifactStyleTargetOption[]
  /**
   * Reports the transiently previewed target (hover/focus/checked choice) so the
   * parent card can swap the edit-canvas skin without any request.
   */
  readonly onPreviewStyleTarget?: (target: ArtifactStyleTarget | undefined) => void
}

/** Localized label for one block kind. */
export function blockKindLabel(kind: ArtifactBlockKind, t: Translate): string {
  return t(`edit.type.${kind}`)
}
