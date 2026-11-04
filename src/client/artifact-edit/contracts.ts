/**
 * Props contract between the edit-session store and the presentational edit
 * view. The store owns state transitions and the composer chip; the view owns
 * layout, overlays, the block popover and the request panel.
 */
import type { CSSProperties } from 'react'
import type { Translate } from '../../shared/locales.ts'
import type { ArtifactBlock, ArtifactBlockKind } from '../../shared/artifact-edit.ts'
import type { RenderLayout } from '../../shared/intelligent-ui.ts'

/**
 * Smallest viewport width that can host the edit canvas and the request panel.
 * Below it block editing is unavailable (the card shows a short notice instead).
 */
export const MIN_EDIT_WIDTH = 720

/** Whether the viewport is wide enough for block editing. */
export function isEditViewportWideEnough(width: number): boolean {
  return width >= MIN_EDIT_WIDTH
}

/** One visible block selection in the current edit session. */
export interface ArtifactEditSelectionView {
  readonly blockId: string
  /** 1-based selection order; also the badge number and colour index. */
  readonly order: number
  /** Saved instruction; empty while the user has not written one yet. */
  readonly instruction: string
}

/** Immutable snapshot of one artifact edit session. */
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
  readonly title?: string
  readonly style: RenderLayout
  readonly styleId?: string
  /** Original program (never rewrapped). */
  readonly program: string
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
  readonly editing: boolean
  readonly drawerOpen: boolean
  readonly status: 'checking' | 'ready' | 'conflict' | 'submitted' | 'error'
  readonly error?: string
  /** Most recent removal, offered as an inline undo in the panel. */
  readonly removable?: { readonly blockId: string; readonly order: number; readonly instruction: string; readonly title?: string }
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
  /** Remove the block from this edit session (deselect). */
  removeSelection(blockId: string): void
  /** Undo the latest removal. */
  undoRemove(): void
  /** Move one block to a target index of the arrangement draft. */
  moveBlock(blockId: string, toIndex: number): void
  /** Move one block by a relative number of positions (keyboard reordering). */
  moveBlockBy(blockId: string, delta: number): void
  /** Restore the target order to the base revision's page order (keeps edits/numbers/global). */
  resetOrder(): void
  /** Remove every saved block request but keep the arrangement draft and global instruction. */
  clearAllEdits(): void
  setGlobalInstruction(text: string): void
  /** Exit edit mode; saved requests stay in the session and the composer chip remains. */
  closeEditor(): void
  setDrawerOpen(open: boolean): void
  /** Re-run the revision check after a conflict or error. */
  retryCheck(): void
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
}

/** Localized label for one block kind. */
export function blockKindLabel(kind: ArtifactBlockKind, t: Translate): string {
  return t(`edit.type.${kind}`)
}
