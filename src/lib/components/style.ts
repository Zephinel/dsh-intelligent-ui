import { tagSchemaId } from "@openuidev/react-lang";
import type { CSSProperties } from "react";
import { z } from "zod/v4";

// Safety
// A model-written style value could otherwise load a resource: `background: url(...)`.
const UNSAFE_CSS = /(url|image|image-set|cross-fade|element|expression|paint|var|attr|env)\s*\(|@import|[\\;{}<>]/i;
const isSafeCss = (value: string) => !UNSAFE_CSS.test(value);

function protocolOf(value: string): string | null {
  try {
    return new URL(value.trim()).protocol;
  } catch {
    return null;
  }
}

/** An absolute http(s) URL, or null. Relative URLs would resolve against this app. */
export function webUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const protocol = protocolOf(value);
  return protocol === "http:" || protocol === "https:" ? value.trim() : null;
}

// Shared prop schemas
/** Children slot: any component, or a list of them (from @Each). Printed as `Node[]`. */
const node = z.any();
tagSchemaId(node, "Node");
export const children = z.array(node);

/** A token or a CSS color. Printed once as `Color` and explained in the prompt notes. */
export const color = z.string();
tagSchemaId(color, "Color");

/** A px number or a CSS length such as "50%". Printed as `Length`. */
export const length = z.union([z.number(), z.string()]);
tagSchemaId(length, "Length");

export const radiusSchema = z.union([z.enum(["sm", "md", "lg", "xl", "full"]), z.number()]);
tagSchemaId(radiusSchema, "Radius");

export const option = z.union([z.string(), z.object({ value: z.string(), label: z.string() })]);
export type Option = z.infer<typeof option>;
export const toOption = (o: Option) => (typeof o === "string" ? { value: o, label: o } : o);

// Values to CSS
const STATUS = ["info", "success", "warning", "danger", "purple", "pink"] as const;
const FOREGROUND: Record<string, string> = {
  ink: "var(--iui-ink)",
  muted: "var(--iui-muted)",
  faint: "var(--iui-faint)",
  canvas: "var(--iui-canvas)",
  "on-ink": "var(--iui-on-ink)",
  surface: "var(--iui-surface)",
  ...Object.fromEntries(STATUS.map((s) => [s, `var(--iui-${s})`])),
  ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`chart${i + 1}`, `var(--iui-chart-${i + 1})`])),
};
/** Tokens that only make sense as a surface. As text they are invisible (a
 *  wash, or the page canvas painted on the page canvas), so textFg() refuses
 *  them and content inherits. "canvas"/"on-ink" pair only with the opposite
 *  background; they stay valid SVG paints. */
const BACKGROUND_ONLY = new Set(["surface", "surface-strong", "border", "canvas", "on-ink"]);
const BACKGROUND: Record<string, string> = {
  ...FOREGROUND,
  surface: "var(--iui-surface)",
  "surface-strong": "var(--iui-surface-strong)",
  border: "var(--iui-border)",
  ...Object.fromEntries(STATUS.map((s) => [s, `var(--iui-${s}-soft)`])),
};

/** Text/icon tokens read the content layer, which a container can re-point
 *  without touching the paint tokens nested controls use. */
const TEXT_FOREGROUND: Record<string, string> = {
  ...FOREGROUND,
  ink: "var(--iui-content-ink)",
  muted: "var(--iui-content-muted)",
  faint: "var(--iui-content-faint)",
};

const cssValue = (value: unknown) => (typeof value === "string" && value.trim() && isSafeCss(value) ? value.trim() : undefined);

/** Paint colors (SVG fill/stroke and chart series): a token or a CSS color.
 *  The surface/paint tokens stay usable here because they are valid paints
 *  (docs: use "surface", "surface-strong" and "border" as SVG fills). */
const PAINT: Record<string, string> = {
  ...FOREGROUND,
  "surface-strong": "var(--iui-surface-strong)",
  border: "var(--iui-border)",
};
export const fg = (value: unknown) => (typeof value === "string" ? (PAINT[value] ?? cssValue(value)) : undefined);
/** Text and icon colors: like fg, but reads content tokens (so inverted
 *  containers re-point them) and ignores surface-only tokens, which would be
 *  invisible when used as text. */
export const textFg = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  if (BACKGROUND_ONLY.has(value)) return undefined;
  return TEXT_FOREGROUND[value] ?? cssValue(value);
};
/** Backgrounds: status tokens become their soft tints. */
export const bg = (value: unknown) => (typeof value === "string" ? (BACKGROUND[value] ?? cssValue(value)) : undefined);

type Rgba = { r: number; g: number; b: number; a: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** `255` or `80%` as a 0-255 channel. */
function channel(value: string): number | null {
  const n = Number(value.replace("%", ""));
  if (!Number.isFinite(n)) return null;
  return clamp(value.endsWith("%") ? (n / 100) * 255 : n, 0, 255);
}

/** `0.5`, `.5` or `50%` as 0-1. */
function alphaOf(value: string | undefined): number {
  if (value === undefined) return 1;
  const n = Number(value.replace("%", ""));
  return Number.isFinite(n) ? clamp(value.endsWith("%") ? n / 100 : n, 0, 1) : 1;
}

function hueDegrees(value: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return NaN;
  if (value.endsWith("turn")) return n * 360;
  if (value.endsWith("rad")) return (n * 180) / Math.PI;
  if (value.endsWith("grad")) return n * 0.9;
  return n;
}

/** HSL to 0-255 RGB: the CSS `hsl()` form, so a "deep blue" is not read as black. */
function hslToRgb(hue: string, saturation: string, lightness: string): [number, number, number] | null {
  const h = hueDegrees(hue);
  const s = Number(saturation.replace("%", "")) / 100;
  const l = Number(lightness.replace("%", "")) / 100;
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
  const k = (n: number) => (n + h / 30) % 12;
  const a = clamp(s, 0, 1) * Math.min(clamp(l, 0, 1), 1 - clamp(l, 0, 1));
  const f = (n: number) => clamp(l, 0, 1) - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => clamp(v * 255, 0, 255)) as [number, number, number];
}

/** A color written as hex (3/4/6/8 digits), rgb()/rgba() or hsl()/hsla(), without the DOM. */
function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(text);
  if (hex) {
    const raw = hex[1];
    const h = raw.length <= 4 ? raw.replace(/./g, "$&$&") : raw;
    const at = (i: number) => parseInt(h.slice(i, i + 2), 16);
    // 3/6 digits are opaque; 4/8 digits carry an alpha pair.
    return { r: at(0), g: at(2), b: at(4), a: raw.length === 4 || raw.length === 8 ? at(6) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(text);
  if (fn === null) return null;
  // `rgb(0 0 0 / 6%)` and `rgba(0, 0, 0, 0.06)` are the same color.
  const [head, tail] = fn[2].split("/");
  const parts = head.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const a = alphaOf(tail?.trim() ?? parts[3]);
  if (fn[1].startsWith("rgb")) {
    const [r, g, b] = parts.slice(0, 3).map(channel);
    return r === null || g === null || b === null ? null : { r, g, b, a };
  }
  const rgb = hslToRgb(parts[0], parts[1], parts[2]);
  return rgb === null ? null : { r: rgb[0], g: rgb[1], b: rgb[2], a };
}

let colorProbe: CanvasRenderingContext2D | null | undefined;

/** The browser's own parser, for named colors and newer syntaxes. Cached: one canvas. */
function browserColor(value: string): Rgba | null {
  if (colorProbe === undefined) {
    colorProbe = null;
    try {
      colorProbe = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    } catch {
      colorProbe = null;
    }
  }
  if (colorProbe === null || typeof CSS === "undefined" || !CSS.supports("color", value)) return null;
  // An invalid color leaves fillStyle untouched, so compare against two sentinels.
  colorProbe.fillStyle = "#010203";
  colorProbe.fillStyle = value;
  const first = colorProbe.fillStyle;
  colorProbe.fillStyle = "#040506";
  colorProbe.fillStyle = value;
  if (colorProbe.fillStyle !== first) return null;
  return parseColor(first);
}

/**
 * Text color for a model-chosen CSS color background. Raw colors do not follow
 * the theme, so an opaque fill sets the text dark or light to stay legible.
 * A translucent color is a wash over the theme canvas, so it keeps the theme's
 * own ink; a color we cannot resolve is left to the theme as well.
 */
function contrastOn(background: unknown): string | undefined {
  if (typeof background !== "string" || background in BACKGROUND) return undefined;
  const color = parseColor(background) ?? browserColor(background);
  if (color === null || color.a < 0.85) return undefined;
  const [r, g, b] = [color.r, color.g, color.b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? "#0d0d0d" : "#ffffff";
}

/** Re-point the content tokens (never the paint tokens) at one readable color. */
const contentOn = (color: string): CSSProperties => ({
  color,
  "--iui-content-ink": color,
  "--iui-content-muted": `color-mix(in srgb, ${color} 72%, transparent)`,
  "--iui-content-faint": `color-mix(in srgb, ${color} 55%, transparent)`,
} as CSSProperties);

/**
 * Style for content on a chosen background. The "ink" token is the theme's
 * inverted fill (content follows on-ink) and the chart tokens are solid brand
 * fills (content follows their computed on-color). A raw CSS color is a fixed
 * paint, so text is set dark or light to stay legible. Other tokens are
 * theme-aware washes or soft tints that already flip with the page ink.
 */
export function onColor(background: unknown): CSSProperties {
  if (background === "ink") return contentOn("var(--iui-on-ink)");
  const chart = /^chart([1-6])$/.exec(String(background));
  if (chart !== null) return contentOn(`var(--iui-chart-${chart[1]}-on)`);
  const ink = contrastOn(background);
  return ink === undefined ? {} : contentOn(ink);
}

/** Spacing in 4px steps. */
export const space = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? `${Math.max(0, value) * 4}px` : undefined);

// A Length may be a number with a unit or a calc()/min()/max()/clamp()
// expression of them. Only those four names may open a parenthesis, and the
// remaining characters are arithmetic, so a value can never load a resource,
// read a token or add a second declaration.
const LENGTH_UNIT = /(?:px|%|em|rem|vh|vw|vmin|vmax|dvh|svh|lvh|ch|ex|lh|pt|pc|cm|mm|in|fr)(?![a-z])/gi;
const LENGTH_FUNCTION = /(?:calc|min|max|clamp)\(/gi;
const LENGTH_UNSAFE = /(?:url|var|attr|env|image|image-set|cross-fade|element|expression|paint)\s*\(|[\\;{}<>@!#:"'`]/i;
const LENGTH_BODY = /^[\d.+\-*/(),%\s]+$/;

function isCssLength(value: string): boolean {
  const text = value.trim();
  if (text.length === 0 || text.length > 120 || LENGTH_UNSAFE.test(text) || !/\d/.test(text)) return false;
  // Function names become plain parentheses; every remaining letter must be a unit.
  const body = text.replace(LENGTH_FUNCTION, "(").replace(LENGTH_UNIT, "");
  if (/[a-z]/i.test(body) || !LENGTH_BODY.test(body)) return false;
  let depth = 0;
  for (const ch of body) {
    if (ch === "(") depth += 1;
    else if (ch === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

export function size(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return `${Math.max(0, value)}px`;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (/^\d+(\.\d+)?$/.test(text)) return `${text}px`;
  if (text === "auto") return text;
  return isCssLength(text) ? text : undefined;
}

const RADIUS: Record<string, string> = {
  sm: "var(--iui-radius-sm)",
  md: "var(--iui-radius-md)",
  lg: "var(--iui-radius-lg)",
  xl: "var(--iui-radius-xl)",
  full: "999px",
};
export const radius = (value: unknown) => (typeof value === "string" ? RADIUS[value] : size(value));

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ") || undefined;

/** A short plain-text name for an element, from its rendered text, for action messages. */
export const textOf = (element: HTMLElement | null) => (element?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

/** True when text contains CJK ideographs, kana or hangul. Display tracking is a Latin-size choice. */
export const hasCjk = (text: string): boolean => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(text);

/** A leading currency sign immediately followed by a digit, e.g. "¥3,000" — the gap after it must not inherit negative display tracking. */
export const CURRENCY_PREFIX = /^([$€£¥￥₹₩₽₺₪₫฿₴₦₱])(?=\d)/;
