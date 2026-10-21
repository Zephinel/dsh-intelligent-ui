"use client";

import { defineComponent } from "@openuidev/react-lang";
import { ChevronDown } from "lucide-react";
import { createContext, useContext, useId, useState } from "react";
import { z } from "zod/v4";
import { children, cx } from "./style";
import { useT } from "../i18n";
import { anchorSlug } from "../../shared/anchor.ts";

/** Per-renderer scope so equal Section titles in different cards do not collide. */
export const ArticleScope = createContext<string | undefined>(undefined);

/** One card-scoped anchor id; the anchor is independent of the displayed title. */
const sectionId = (scope: string | undefined, anchor: string): string => `${scope ?? "iui"}-section-${anchorSlug(anchor)}`;

/** Treat an empty author anchor like an absent one. */
const anchorValue = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
};

/** A collapsible article section; its optional anchor is the Toc target. */
export const Section = defineComponent({
  name: "Section",
  props: z.object({
    title: z.string(),
    children,
    anchor: z.string().optional(),
  }),
  description: "Collapsible article section; starts open. The optional anchor is the Toc target; falls back to the title.",
  component: function SectionView({ props, renderNode }) {
    const [open, setOpen] = useState(true);
    const scope = useContext(ArticleScope);
    const id = useId();
    const bodyId = `${id}-body`;
    return (
      <section className="iui-section" id={sectionId(scope, anchorValue(props.anchor) ?? props.title)}>
        <h2 className="iui-section-heading">
          <button
            type="button"
            className="iui-section-header"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="iui-section-title">{props.title}</span>
            <ChevronDown className={cx("iui-section-chevron", open && "is-open")} size={16} aria-hidden />
          </button>
        </h2>
        <div id={bodyId} className="iui-section-body" hidden={!open}>
          {renderNode(props.children)}
        </div>
      </section>
    );
  },
});

/** A compact table of contents whose entries link to Section titles. */
export const Toc = defineComponent({
  name: "Toc",
  props: z.object({ items: z.array(z.string()), anchors: z.array(z.string()).optional() }),
  description: "Compact table of contents linking to Section anchors. `items` are labels; optional parallel `anchors` decouple them from the displayed text.",
  component: function TocView({ props }) {
    const t = useT();
    const scope = useContext(ArticleScope);
    return (
      <nav className="iui-toc" aria-label={t("toc.aria")}>
        <ol>
          {props.items.map((item, index) => (
            <li key={`${item}-${index}`}>
              <a href={`#${sectionId(scope, anchorValue(props.anchors?.[index]) ?? item)}`}>{item}</a>
            </li>
          ))}
        </ol>
      </nav>
    );
  },
});
