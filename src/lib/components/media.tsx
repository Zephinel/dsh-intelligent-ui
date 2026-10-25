"use client";

import { defineComponent } from "@openuidev/react-lang";
import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod/v4";
import { Glyph } from "./glyph";
import { color, textFg, cx, radius, radiusSchema, webUrl } from "./style";

const ICON_SIZE = { sm: 14, md: 18, lg: 24, xl: 32 } as const;

export const Icon = defineComponent({
  name: "Icon",
  props: z.object({
    name: z.string(),
    size: z.enum(["sm", "md", "lg", "xl"]).optional(),
    color: color.optional(),
  }),
  description: 'Lucide icon by name, e.g. "map-pin".',
  component: ({ props }) => (
    <span className="iui-icon" style={{ color: textFg(props.color) }}>
      <Glyph name={props.name} size={ICON_SIZE[props.size ?? "md"] ?? 18} />
    </span>
  ),
});

// Image search
//
// The upstream Next.js app searched through its own /api/wiki and
// /api/image-search routes. DSH has no such server half, so the browser calls
// the public Wikipedia/Wikimedia APIs directly: both send
// Access-Control-Allow-Origin: *, and the action API is asked for `origin=*`
// explicitly. Requests time out and failures degrade to the placeholder below.
const TIMEOUT_MS = 8000;
const searches = new Map<string, Promise<string[]>>();
// The two routes are several requests; a slow or dead network should settle the
// placeholder instead of animating for the sum of every per-request timeout.
const SEARCH_DEADLINE_MS = 12000;

/** One request, with a timeout so a stalled network never blocks the answer. */
async function getJson(url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

/** An absolute, model-safe image URL: protocol-relative Wikipedia sources become https. */
const photoUrl = (value: unknown): string | null => (typeof value === "string" ? webUrl(value.startsWith("//") ? `https:${value}` : value) : null);

type WikiSummary = { thumbnail?: { source?: string } };
type WikiMedia = { items?: { type?: string; srcset?: { src: string }[] }[] };

/**
 * Photo URLs from the Wikipedia article with this exact title (right for a
 * named place, dish or product). A missing article is a real answer; any other
 * failure is retried next time because the caller does not cache an empty list.
 */
async function wikiPhotos(title: string): Promise<string[]> {
  const t = encodeURIComponent(title.replace(/ /g, "_"));
  const [summary, media] = (await Promise.all([
    getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${t}`).catch((): Record<string, unknown> => ({})),
    getJson(`https://en.wikipedia.org/api/rest_v1/page/media-list/${t}`).catch((): Record<string, unknown> => ({})),
  ])) as [WikiSummary, WikiMedia];
  // Lead image first, then up to two more photos; skip maps, logos, flags and SVGs.
  const photos: string[] = [];
  const key = (u: string) => {
    try {
      return decodeURIComponent(u.split("?")[0].split("/").slice(-1)[0]).replace(/^\d+px-/, "");
    } catch {
      return u;
    }
  };
  const lead = photoUrl(summary?.thumbnail?.source);
  if (lead) photos.push(lead);
  for (const item of media?.items ?? []) {
    if (item.type !== "image" || !item.srcset?.length) continue;
    const url = photoUrl(item.srcset[0].src);
    if (!url || /\.svg|icon|logo|map|flag|seal/i.test(url)) continue;
    if (!photos.some((p) => key(p) === key(url))) photos.push(url);
    if (photos.length >= 3) break;
  }
  return photos;
}

// Photo search for the Image component: Wikipedia lead images for the best
// matching articles, then Wikimedia Commons files.
const SKIP = /\.svg|icon|logo|map|flag|seal|coat_of_arms|signature|diagram/i;
const WIDTH = 960;

type Page = { index?: number; title?: string; thumbnail?: { source?: string }; imageinfo?: { thumburl?: string; url?: string; mime?: string }[] };

/** Query one Wikimedia action API; `origin=*` makes the cross-origin JSON readable. */
async function query(host: string, params: Record<string, string>): Promise<Page[]> {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", origin: "*", ...params })}`;
  const data = (await getJson(url)) as { error?: unknown; query?: { pages?: Page[] } };
  // A rate limit comes back as 200 with an error body: throw so "no photos" is not cached for a day.
  if (data.error) throw new Error(`${host} error`);
  return (data.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/** Words that say what the photo shows; an article must share one with the query. */
const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);

async function searchWikimedia(q: string): Promise<string[]> {
  const images: string[] = [];
  const add = (value: unknown) => {
    const url = photoUrl(value);
    if (url && !SKIP.test(url) && !images.includes(url)) images.push(url);
  };
  const wanted = new Set(words(q));
  // Wikipedia articles first, but only ones whose title is about the query:
  // a search for a dish should not return a restaurant chain's storefront.
  const articles = await query("en.wikipedia.org", { generator: "search", gsrsearch: q, gsrlimit: "6", prop: "pageimages", piprop: "thumbnail", pithumbsize: String(WIDTH) });
  articles.filter((page) => words(page.title ?? "").some((w) => wanted.has(w))).forEach((page) => add(page.thumbnail?.source));
  // Then Commons files, dropping trailing words when a long description finds nothing.
  const terms = q.split(/\s+/);
  const tries = [...new Set([terms.join(" "), terms.slice(0, 3).join(" "), terms.slice(0, 2).join(" ")])];
  for (const t of tries) {
    if (images.length >= 3) break;
    const files = await query("commons.wikimedia.org", { generator: "search", gsrsearch: `${t} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "6", prop: "imageinfo", iiprop: "url|mime", iiurlwidth: String(WIDTH) });
    files.forEach((page) => {
      const info = page.imageinfo?.[0];
      if (info?.mime?.startsWith("image/")) add(info.thumburl ?? info.url);
    });
  }
  return images.slice(0, 4);
}

/**
 * Photo URLs for a query, from both Wikipedia routes. Results (even an empty
 * list) are cached per query; a failed request is dropped from the cache so the
 * next render tries again.
 */
function searchImages(query: string): Promise<string[]> {
  let request = searches.get(query);
  if (!request) {
    request = Promise.race([
      Promise.all([
        wikiPhotos(query).catch((): string[] => []),
        searchWikimedia(query).catch((): string[] => []),
      ]).then(([wiki, found]) => {
        const all = [...new Set([...wiki, ...found])];
        if (!all.length) searches.delete(query);
        return all;
      }),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), SEARCH_DEADLINE_MS)),
    ]);
    if (searches.size > 200) searches.delete(searches.keys().next().value!);
    searches.set(query, request);
  }
  return request;
}

/** Search results for `query`, or undefined while waiting. The query settles first: it may still be streaming. */
function useImageSearch(query: string | null): string[] | undefined {
  const [result, setResult] = useState<{ query: string; images: string[] } | null>(null);
  useEffect(() => {
    if (!query) return;
    let active = true;
    const timer = setTimeout(() => {
      searchImages(query).then((images) => {
        if (active) setResult({ query, images });
      });
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  return query && result?.query === query ? result.images : undefined;
}

type PhotoProps = { query: string; src?: string | null; aspectRatio?: number | null; radius?: unknown; fit?: string | null };

/** A photo from src, or, without one or when it fails, the best search result for query. */
function Photo(props: PhotoProps) {
  const alt = typeof props.query === "string" ? props.query.trim() : "";
  const src = webUrl(props.src);
  const [failed, setFailed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const needSearch = (!src || failed.includes(src)) && alt.length > 2;
  const found = useImageSearch(needSearch ? alt : null);
  const current = [src, ...(found ?? [])].find((url): url is string => !!url && !failed.includes(url));
  const settled = !current && (!needSearch || found !== undefined);
  // The default ratio lives in the stylesheet, not inline: the media-row rule
  // may suggest a 4:3 default without overriding a ratio the program asked
  // for. An explicit aspectRatio stays inline, so no stylesheet rule can win
  // over it. Any finite positive ratio is accepted, clamped to a wide sane
  // range: docs promise a number, not a 0.2-5 window.
  const ratio =
    typeof props.aspectRatio === "number" && Number.isFinite(props.aspectRatio) && props.aspectRatio > 0
      ? Math.min(20, Math.max(0.05, props.aspectRatio))
      : null;
  return (
    <div
      className={cx("iui-image", props.fit === "contain" && "is-contain", loaded === current && "is-loaded")}
      style={{ ...(ratio === null ? {} : { aspectRatio: ratio }), borderRadius: radius(props.radius ?? "lg") }}
      role={current ? undefined : "img"}
      aria-label={current ? undefined : alt}
    >
      {current ? (
        <img
          key={current}
          src={current}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(current)}
          onError={() => setFailed((list) => [...list, current])}
        />
      ) : settled ? (
        <ImageIcon aria-hidden className="iui-image-empty" strokeWidth={1.5} />
      ) : null}
    </div>
  );
}

const fit = z.enum(["cover", "contain"]).optional();

export const SearchImage = defineComponent({
  name: "SearchImage",
  props: z.object({ query: z.string(), aspectRatio: z.number().optional(), radius: radiusSchema.optional(), fit }),
  description:
    'A real photo the app finds for query; it needs no URL and no tool. Name the exact thing in 2 to 4 words: "Belém Tower Lisbon", "iPhone 17", "pastel de nata". Use one for every place, dish, product or thing with a look.',
  component: ({ props }) => <Photo {...props} />,
});

export const Image = defineComponent({
  name: "Image",
  props: z.object({ src: z.string(), alt: z.string(), aspectRatio: z.number().optional(), radius: radiusSchema.optional(), fit }),
  description: "Photo from a URL the user or a tool gave; if it fails, a photo is found for alt.",
  component: ({ props }) => <Photo query={props.alt} src={props.src} aspectRatio={props.aspectRatio} radius={props.radius} fit={props.fit} />,
});
