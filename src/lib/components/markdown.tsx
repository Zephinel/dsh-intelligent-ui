import { Fragment, type ReactNode } from "react";
import { CURRENCY_PREFIX, hasCjk, webUrl } from "./style";

// A small Markdown renderer that builds React elements and never injects HTML.
// Inline: **bold**, *italic*, ~~strike~~, `code`, [text](https://...).
// Blocks: paragraphs, # headings (h5/h6 render at the h4 size), nested - and 1.
// lists, > quotes, ``` code, ---, | tables |.

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*|__[^_\n]+?__)|(~~[^~\n]+?~~)|(\*[^*\s][^*\n]*?\*|_[^_\s][^_\n]*?_)|(\[[^\]\n]+\]\([^)\s]+\))/;

export function inline(text: string, key = "i"): ReactNode {
  // Currency symbols are set tight in display type; don't let a heading's negative
  // tracking close the gap between the sign and the amount.
  const currency = CURRENCY_PREFIX.exec(text);
  if (currency !== null) {
    return (
      <Fragment key={key}>
        <span className="iui-currency-prefix">{currency[1]}</span>
        {inline(text.slice(1), `${key}-c`)}
      </Fragment>
    );
  }
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index) out.push(rest.slice(0, m.index));
    const token = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="iui-code">{token.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(token.slice(2, -2), k)}</strong>);
    else if (m[3]) out.push(<s key={k}>{inline(token.slice(2, -2), k)}</s>);
    else if (m[4]) out.push(<em key={k}>{inline(token.slice(1, -1), k)}</em>);
    else {
      const close = token.indexOf("](");
      const label = token.slice(1, close);
      const href = webUrl(token.slice(close + 2, -1));
      out.push(
        href ? (
          <a key={k} className="iui-link" href={href} target="_blank" rel="noopener noreferrer">
            {inline(label, k)}
          </a>
        ) : (
          <Fragment key={k}>{inline(label, k)}</Fragment>
        ),
      );
    }
    rest = rest.slice(m.index + token.length);
  }
  return out.length === 1 ? out[0] : out;
}

type ListItem = { text: string; children: Block[] };
type Block =
  | { kind: "p" | "quote"; text: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "code"; text: string }
  | { kind: "hr" }
  | { kind: "table"; head: string[]; rows: string[][] };

// The marker is captured with its indentation: a deeper marker is a child list
// of the item above it, not another item of the same list.
const LIST_ITEM = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/;
const indentOf = (line: string) => line.match(/^[ \t]*/)![0].replace(/\t/g, "    ").length;
const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** One list and its nested lists: the items at the first marker's indentation. */
function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = LIST_ITEM.exec(lines[start])!;
  const base = indentOf(lines[start]);
  const ordered = first[3] !== undefined;
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const match = LIST_ITEM.exec(line);
    if (!match) {
      // An indented line that is not a marker continues the item text.
      if (items.length && line.trim() && indentOf(line) > base) {
        items[items.length - 1].text += ` ${line.trim()}`;
        i++;
        continue;
      }
      break;
    }
    const indent = indentOf(line);
    if (indent < base) break;
    if (indent > base) {
      if (!items.length) break;
      const nested = parseList(lines, i);
      items[items.length - 1].children.push(nested.block);
      i = nested.next;
      continue;
    }
    // A different marker kind at the same indentation starts another list.
    if ((match[3] !== undefined) !== ordered) break;
    items.push({ text: match[4], children: [] });
    i++;
  }
  return { block: { kind: "list", ordered, start: ordered ? Number(first[3]) : 1, items }, next: i };
}

function blocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      out.push({ kind: "code", text: body.join("\n") });
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ kind: "h", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ kind: "hr" });
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(cells(lines[i]));
      out.push({ kind: "table", head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ""));
      out.push({ kind: "quote", text: body.join(" ") });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const list = parseList(lines, i);
      out.push(list.block);
      i = list.next;
      continue;
    }
    const body: string[] = [];
    for (; i < lines.length && lines[i].trim() && !LIST_ITEM.test(lines[i]) && !/^(#{1,6})\s|^\s*```|^\s*>/.test(lines[i]); i++) body.push(lines[i].trim());
    out.push({ kind: "p", text: body.join(" ") });
  }
  return out;
}

function renderBlock(b: Block, key: string): ReactNode {
  switch (b.kind) {
    case "p":
      return <p key={key}>{inline(b.text, key)}</p>;
    case "quote":
      return <blockquote key={key}>{inline(b.text, key)}</blockquote>;
    case "h": {
      // h5/h6 are visually h4: the reference only promises four display sizes.
      const level = Math.min(4, b.level);
      return (
        <div key={key} role="heading" aria-level={level + 1} className={`iui-md-h iui-md-h${level}${hasCjk(b.text) ? " iui-title-cjk" : ""}`}>
          {inline(b.text, key)}
        </div>
      );
    }
    case "code":
      return (
        <pre key={key} className="iui-code-block">
          <code>{b.text}</code>
        </pre>
      );
    case "hr":
      return <hr key={key} className="iui-divider" />;
    case "list": {
      const items = b.items.map((item, j) => (
        <li key={j}>
          {inline(item.text, `${key}-${j}`)}
          {item.children.map((child, c) => renderBlock(child, `${key}-${j}-${c}`))}
        </li>
      ));
      return b.ordered ? (
        <ol key={key} start={b.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case "table":
      return (
        <div key={key} className="iui-table-scroll">
          <table className="iui-table">
            <thead>
              <tr>{b.head.map((h, j) => <th key={j}>{inline(h, `${key}-h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>{r.map((c, m) => <td key={m}>{inline(c, `${key}-${j}-${m}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function MarkdownBlocks({ text }: { text: string }) {
  return <>{blocks(text).map((b, i) => renderBlock(b, `b${i}`))}</>;
}
