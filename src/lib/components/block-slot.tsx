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
import "./nested-edit.css";

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

/** Identity the renderer exposes for one nested block path. */
export interface BlockSlotIdentity {
  /** Display/selection id of the block (the client's ArtifactBlock id). */
  readonly blockId: string;
  /** Revision-scoped structural node id (M4 tree identity). */
  readonly nodeId: string;
  /** 1-based sibling index among the parent slot's children. */
  readonly blockIndex: number;
}

/**
 * Resolve one nested tree path (`root/children/0/children/1`) to its block
 * identity. Supplied by the edit view through {@link BlockSlotPathContext}; when
 * absent the path itself is used as the id so rendering still works.
 */
export type BlockSlotPathResolver = (path: string) => BlockSlotIdentity | undefined;

/** Path plumbing for container renderers plus the client identity resolver. */
export interface BlockSlotPathContextValue {
  /** Path of the enclosing block wrapper; `''` at the renderer root. */
  readonly parentPath: string;
  /** Client-provided path -> identity resolver (M4 edit integration). */
  readonly resolve?: BlockSlotPathResolver;
}

/**
 * Provided by the edit view (or a standalone embed) to resolve nested paths and
 * by every nested BlockSlot to publish its path to descendants. Absent in normal
 * card rendering and for root-level wrappers, so their markup stays unchanged.
 */
export const BlockSlotPathContext = createContext<BlockSlotPathContextValue | undefined>(undefined);

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
    const pathContext = useContext(BlockSlotPathContext);
    const host = useRef<HTMLDivElement>(null);
    // Nested wrappers resolve their display identity from the client resolver.
    const identity = props.path === undefined ? undefined : pathContext?.resolve?.(props.path);
    const blockId = identity?.blockId ?? props.blockId;
    const blockIndex = identity?.blockIndex ?? props.blockIndex;
    const nodeId = identity?.nodeId ?? props.path;
    // A path-aware wrapper publishes its path; children stay in the same DOM.
    const renderedChildren = props.path === undefined
      ? renderNode(props.children)
      : (
        <BlockSlotPathContext.Provider value={{ parentPath: props.path, ...pathContext?.resolve === undefined ? {} : { resolve: pathContext.resolve } }}>
          {renderNode(props.children)}
        </BlockSlotPathContext.Provider>
      );
    // Normal card rendering: layout-transparent pass-through.
    if (context === null) {
      return (
        <div
          className="dsh-iui-block"
          data-dsh-iui-block={blockId}
          data-dsh-iui-block-index={blockIndex}
          data-dsh-iui-block-path={props.path}
          data-dsh-iui-block-node={props.path === undefined ? undefined : nodeId}
        >
          <div className="dsh-iui-block-body">{renderedChildren}</div>
        </div>
      );
    }
    const editing = true;
    const selection = context.selection(blockId);
    const active = context.isActive(blockId);
    const colorIndex = selection === undefined ? undefined : ((selection.order - 1) % COLOR_COUNT) + 1;
    const style = colorIndex === undefined ? undefined : ({ "--iui-edit-block-color": `var(--iui-edit-color-${colorIndex})` } as CSSProperties);
    const activate = (): void => {
      context.onSelect(blockId);
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
        data-dsh-iui-block={blockId}
        data-dsh-iui-block-index={blockIndex}
        data-dsh-iui-block-path={props.path}
        data-dsh-iui-block-node={props.path === undefined ? undefined : nodeId}
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
              {tool(context.labels.edit, () => context.onEdit(blockId), "✎")}
              {tool(context.labels.deselect, () => context.onDeselect(blockId), "×")}
            </span>
          </>
        )}
      </div>
    );
  },
});

/** The subset of a defined component the nested-container wrapper needs. */
export interface NestedContainerComponent {
  readonly name: string;
  readonly component: (input: {
    props: Record<string, unknown>;
    renderNode: (value: unknown) => unknown;
    statementId?: string;
  }) => unknown;
}

/**
 * Synthesize the BlockSlot element node for one direct child of a container.
 * Root children use `root/children/<i>`; nested children extend their parent
 * path with `/children/<i>`.
 * @param parentPath - path of the enclosing slot (`''` at the renderer root).
 * @param index - 0-based sibling index.
 * @param child - evaluated child value (element node, array or primitive).
 * @returns a synthetic BlockSlot element node accepted by `renderNode`.
 */
export function nestedSlotNode(parentPath: string, index: number, child: unknown): unknown {
  const path = parentPath === "" ? `root/children/${index}` : `${parentPath}/children/${index}`;
  return { type: "element", typeName: "BlockSlot", partial: false, props: { blockId: path, blockIndex: index + 1, path, children: child } };
}

/**
 * Candidate-B renderer wrapper (M4): replace a container's direct `children`
 * with synthetic BlockSlot nodes and delegate to the original renderer, which
 * calls `renderNode(props.children)`. `BlockSlot` children are left alone so the
 * production root-level wrappers never get wrapped twice.
 * @param original - the edit-library container component to wrap.
 * @returns a same-name component that renders nested slots.
 */
export function wrapNestedContainer(original: NestedContainerComponent): NestedContainerComponent {
  function NestedContainer({ props, renderNode, statementId }: {
    props: Record<string, unknown>;
    renderNode: (value: unknown) => unknown;
    statementId?: string;
  }): unknown {
    const parentPath = useContext(BlockSlotPathContext)?.parentPath ?? "";
    const children = props.children;
    let wrapped: unknown = children;
    if (Array.isArray(children)) {
      wrapped = children.map((child, index) => {
        const typeName = (child as { typeName?: unknown } | null | undefined)?.typeName;
        return typeName === "BlockSlot" ? child : nestedSlotNode(parentPath, index, child);
      });
    } else if (children !== undefined && children !== null) {
      const typeName = (children as { typeName?: unknown }).typeName;
      wrapped = typeName === "BlockSlot" ? children : nestedSlotNode(parentPath, 0, children);
    }
    return original.component({ props: { ...props, children: wrapped }, renderNode, statementId });
  }
  return { ...original, component: NestedContainer };
}
