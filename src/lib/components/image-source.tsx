"use client";

/**
 * Renderer-side image source resolution.
 *
 * The card list provides one resolver that reads a Session's local image file
 * and returns a displayable URL; this module turns the shared source policy
 * into React state and keeps the blob URL alive exactly as long as the image is
 * on screen. Standalone embeds and the renderer tests simply omit the
 * resolver: local paths then show a clear unavailable placeholder while
 * http(s) and inline data URLs keep working.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  MAX_IMAGE_PIXELS,
  classifyImageSource,
  imageDataUrlDimensions,
  describeImagePathProblem,
  type ImageSourceProblem,
  type ImageSourceResolver,
  type ResolvedImageSource,
} from "../../shared/image-source.ts";
import { useT } from "../i18n.tsx";
import { RemixIcon } from "./remix-icon.tsx";
import type { Translate } from "../../shared/locales.ts";

/** Reads one local image path; absent in tests and plain embeds. */
export const ImageSourceContext = createContext<ImageSourceResolver | undefined>(undefined);

/** Publish one path resolver to the renderer subtree. */
export function ImageSourceProvider({ resolver, children }: { resolver?: ImageSourceResolver; children: ReactNode }) {
  return <ImageSourceContext.Provider value={resolver}>{children}</ImageSourceContext.Provider>;
}

/** Display state of one image source. */
export type ImageDisplayState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly url: string;
      readonly origin: "remote" | "data" | "path";
      /** Canonical (trimmed) local path for path sources; export maps key on it. */
      readonly source?: string;
    }
  | { readonly status: "error"; readonly problem: ImageSourceProblem };

const LOADING: ImageDisplayState = { status: "loading" };

/**
 * Classify and resolve one image source for display.
 * @param source - explicit `Image` source, or null when the component searches instead.
 * @returns loading, a displayable URL, or the localized problem code.
 */
export function useImageSource(source: string | null): ImageDisplayState {
  const resolver = useContext(ImageSourceContext);
  const classified = useMemo<ResolvedImageSource | undefined>(
    () => (source === null ? undefined : classifyImageSource(source)),
    [source],
  );
  const [state, setState] = useState<ImageDisplayState>(LOADING);
  useEffect(() => {
    if (classified === undefined) {
      setState(LOADING);
      return;
    }
    if (classified.kind === "error") {
      setState({ status: "error", problem: classified.problem });
      return;
    }
    if (classified.kind === "remote") {
      setState({ status: "ready", url: classified.url, origin: "remote" });
      return;
    }
    if (classified.kind === "data") {
      // Reject an oversized inline image from its header before <img> decodes
      // it; local files get the same pre-check in the workspace reader.
      const dimensions = imageDataUrlDimensions(classified.url);
      if (dimensions !== undefined && dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
        setState({ status: "error", problem: "too-large" });
        return;
      }
      setState({ status: "ready", url: classified.url, origin: "data" });
      return;
    }
    const problem = describeImagePathProblem(classified.path);
    if (problem !== undefined) {
      setState({ status: "error", problem });
      return;
    }
    if (resolver === undefined) {
      setState({ status: "error", problem: "unsupported-host" });
      return;
    }
    let active = true;
    let revoke: (() => void) | undefined;
    setState(LOADING);
    resolver(classified.path)
      .then((result) => {
        if (!active) {
          if (result.ok) result.revoke?.();
          return;
        }
        if (!result.ok) {
          setState({ status: "error", problem: result.problem });
          return;
        }
        revoke = result.revoke;
        setState({ status: "ready", url: result.url, origin: "path", source: classified.path });
      })
      .catch(() => {
        if (active) setState({ status: "error", problem: "unavailable" });
      });
    return () => {
      active = false;
      revoke?.();
    };
  }, [classified, resolver]);
  return state;
}

/**
 * Whether one loaded image is above the accepted pixel cap.
 * @param image - the loaded `<img>`.
 * @param origin - where the image came from; remote images keep their old behavior.
 * @returns true when a local/inline image should be rejected.
 */
export function isOversizedImage(image: HTMLImageElement, origin: "remote" | "data" | "path"): boolean {
  if (origin === "remote") return false;
  return image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS;
}

/** Localized one-line reason for one image problem. */
function imageProblemMessage(t: Translate, problem: ImageSourceProblem): string {
  switch (problem) {
    case "svg-unsupported":
      return t("image.svgUnsupported");
    case "data-too-large":
    case "too-large":
      return t("image.tooLarge");
    case "path-invalid":
    case "path-escape":
      return t("image.invalidPath");
    case "unsupported-host":
      return t("image.hostUnsupported");
    case "load-failed":
      return t("image.loadFailed");
    case "unavailable":
      return t("image.localUnavailable");
    case "unsupported-scheme":
    case "type-unsupported":
    case "data-invalid":
    default:
      return t("image.unsupportedSource");
  }
}

/** Error placeholder shared by `Image` and Markdown images. */
export function ImageError({ problem, alt, inline = false }: { problem: ImageSourceProblem; alt: string; inline?: boolean }) {
  const t = useT();
  const reason = imageProblemMessage(t, problem);
  // The visible reason must reach assistive tech too: role="img" children are
  // presentational, so the accessible name carries both the alt text and why.
  const label = alt === "" ? reason : `${alt}: ${reason}`;
  return (
    <span className={inline ? "iui-image-error iui-image-error-inline" : "iui-image-error"} data-iui-image-error={problem} role="img" aria-label={label}>
      <RemixIcon name="image-line" size={inline ? 12 : 22} className="iui-image-error-icon" aria-hidden="true" />
      <span className="iui-image-error-text" aria-hidden="true">{reason}</span>
    </span>
  );
}

/** One inline Markdown image with the same source policy as `Image`. */
export function InlineImage({ src, alt }: { src: string; alt: string }) {
  const source = useImageSource(src);
  const [failed, setFailed] = useState(false);
  const [rejected, setRejected] = useState(false);
  useEffect(() => {
    setFailed(false);
    setRejected(false);
  }, [src]);
  const ready = source.status === "ready" ? source : undefined;
  const problem: ImageSourceProblem | null =
    source.status === "error"
      ? source.problem
      : ready !== undefined && rejected
        ? "too-large"
        : ready !== undefined && failed
          ? "load-failed"
          : null;
  if (problem !== null) return <ImageError problem={problem} alt={alt} inline />;
  if (ready === undefined) return <span className="iui-image-pending" data-iui-image-pending="true" aria-hidden="true" />;
  return (
    <img
      className="iui-markdown-image"
      src={ready.url}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      data-iui-image-src={ready.origin === "path" ? ready.source : undefined}
      onLoad={(event) => {
        if (isOversizedImage(event.currentTarget, ready.origin)) setRejected(true);
      }}
      onError={() => setFailed(true)}
    />
  );
}
