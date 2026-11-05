"use client";

/**
 * Internal edit-mode wrapper for one root-level Artifact block.
 *
 * `wrapProgramForBlockEditing` rewrites the root `Col` so each editable block
 * sits inside this component. In normal rendering the context is absent and the
 * wrapper is layout-transparent. In edit mode it adds a selection overlay, a
 * numbered badge and per-block actions; the overlay captures pointer events so
 * clicking any part of the block selects it instead of operating its controls
 * (the read-only behaviour the edit mode promises).
 *
 * It also carries an optional nested `path` (M4 spike): a path-aware wrapper
 * provides `BlockSlotPathContext` to its descendants so container renderers can
 * derive stable child paths, and exposes the path as an attribute for overlay
 * anchoring. Without `path` every behaviour above stays byte-identical.
 *
 * This component is registered only in the edit-mode library, never in the
 * model-facing catalog.
 */
import { defineComponent } from "@openuidev/react-lang";
import { createContext, useContext, useRef, type CSSProperties, type KeyboardEvent, type ReactElement } from "react";
import { z } from "zod/v4";
import { children, cx } from "./style";
import "./artifact-edit.css";

/** One block's live selection state inside the edit view. */
export interface BlockSlotSelection {
  /** 1-based selection order; also the badge number and colour index. */
  readonly order: number;
  /** Whether this block's instruction popover is open. */
  readonly active: boolean;
}

/** Copy and callbacks the edit view provides to every block wrapper. */
export interface BlockSlotContextValue {
  readonly labels: {
    readonly select: string;
    readonly edit: string;
    readonly deselect: string;
    readonly selected: string;
  };
  /** Selection data for one block; undefined when it is not selected. */
  readonly selection: (blockId: string) => BlockSlotSelection | undefined
  /** Whether this block's instruction popover is open (even before a request is saved). */
  readonly isActive: (blockId: string) => boolean;
  /** Click or keyboard activation of the block. */
  readonly onSelect: (blockId: string) => void;
  /** Open the instruction popover for a selected block. */
  readonly onEdit: (blockId: string) => void;
  /** Remove the block from this edit session. */
  readonly onDeselect: (blockId: string) => void;
}

/** Provided by the edit view; absent in normal card rendering. */
export const BlockSlotContext = createContext<BlockSlotContextValue | null>(null);

/**
 * Path of the nearest nested block wrapper, when the wrapper was created with a
 * `path`. Root-level wrappers leave it undefined, so existing edit rendering is
 * unchanged; nested wrappers (M4) let container renderers build child paths.
 */
export const BlockSlotPathContext = createContext<string | undefined>(undefined);

/** Palette size used by the selection colours. */
const COLOR_COUNT = 6;

/** One block wrapper rendered by the edit-mode library. */
export const BlockSlot = defineComponent({
  name: "BlockSlot",
  props: z.object({
    blockId: z.string(),
    blockIndex: z.number(),
    children,
    /** Nested path (M4): `root/0`, `root/0/1`, ...; absent for root-level wrappers. */
    path: z.string().optional(),
  }),
  description: "Internal edit-mode block wrapper. Not for model use.",
  component: function BlockSlotView({ props, renderNode }) {
    const context = useContext(BlockSlotContext);
    const host = useRef<HTMLDivElement>(null);
    // A path-aware wrapper publishes its path; children stay in the same DOM.
    const renderedChildren = props.path === undefined
      ? renderNode(props.children)
      : <BlockSlotPathContext.Provider value={props.path}>{renderNode(props.children)}</BlockSlotPathContext.Provider>;
    // Normal card rendering: layout-transparent pass-through.
    if (context === null) {
      return (
        <div
          className="dsh-iui-block"
          data-dsh-iui-block={props.blockId}
          data-dsh-iui-block-index={props.blockIndex}
          data-dsh-iui-block-path={props.path}
        >
          <div className="dsh-iui-block-body">{renderedChildren}</div>
        </div>
      );
    }
    const editing = true;
    const selection = context.selection(props.blockId);
    const active = context.isActive(props.blockId);
    const colorIndex = selection === undefined ? undefined : ((selection.order - 1) % COLOR_COUNT) + 1;
    const style = colorIndex === undefined ? undefined : ({ "--iui-edit-block-color": `var(--iui-edit-color-${colorIndex})` } as CSSProperties);
    const activate = (): void => {
      context.onSelect(props.blockId);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    };
    const tool = (label: string, action: () => void, content: string): ReactElement => (
      <button
        type="button"
        className="dsh-iui-block-tool"
        title={label}
        aria-label={label}
        onClick={(event) => { event.stopPropagation(); action(); }}
      >
        {content}
      </button>
    );
    return (
      <div
        ref={host}
        className={cx("dsh-iui-block", "dsh-iui-block-editing", selection !== undefined && "dsh-iui-block-selected", active && "dsh-iui-block-active")}
        style={style}
        data-dsh-iui-block={props.blockId}
        data-dsh-iui-block-index={props.blockIndex}
        data-dsh-iui-block-order={selection?.order}
        data-dsh-iui-block-selected={selection === undefined ? undefined : "true"}
        role={editing ? "button" : undefined}
        tabIndex={editing ? 0 : undefined}
        aria-label={editing ? context.labels.select : undefined}
        aria-pressed={selection === undefined ? undefined : true}
        onClick={editing ? (event) => { event.stopPropagation(); activate(); } : undefined}
        onKeyDown={editing ? onKeyDown : undefined}
      >
        <div className="dsh-iui-block-body">{renderedChildren}</div>
        <span className="dsh-iui-block-layer" aria-hidden="true" />
        {selection === undefined ? null : (
          <>
            <span className="dsh-iui-block-badge" aria-hidden="true">{selection.order}</span>
            <span className="dsh-iui-block-tools" role="group" aria-label={context.labels.selected}>
              {tool(context.labels.edit, () => context.onEdit(props.blockId), "✎")}
              {tool(context.labels.deselect, () => context.onDeselect(props.blockId), "×")}
            </span>
          </>
        )}
      </div>
    );
  },
});
