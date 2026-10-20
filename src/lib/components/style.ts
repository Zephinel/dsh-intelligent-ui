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
/** Tokens that only make sense as a surface. As text they are invisible
 *  (surface is a 4% ink wash), so textFg() refuses them and content inherits. */
const BACKGROUND_ONLY = new Set(["surface", "surface-strong", "border"]);
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
 *  surface stays usable here because it is a valid translucent paint. */
export const fg = (value: unknown) => (typeof value === "string" ? (FOREGROUND[value] ?? cssValue(value)) : undefined);
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

/**
 * Text color for a model-chosen CSS color background (hex or rgb). Raw colors
 * do not follow the theme, so text on them is set dark or light to stay legible.
 */
function contrastOn(background: unknown): string | undefined {
  if (typeof background !== "string" || background in BACKGROUND) return undefined;
  let rgb: number[] | null = null;
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(background.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(background.trim());
    if (m) rgb = [m[1], m[2], m[3]].map(Number);
  }
  if (!rgb) return undefined;
  const [r, g, b] = rgb.map((c) => {
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

export function size(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return `${Math.max(0, value)}px`;
  if (typeof value !== "string") return undefined;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return `${value.trim()}px`;
  return /^\d+(\.\d+)?(px|%|em|rem|vh|vw|fr)$|^auto$/.test(value.trim()) ? value.trim() : undefined;
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
