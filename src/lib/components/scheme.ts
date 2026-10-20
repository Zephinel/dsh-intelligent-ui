"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * "dark" when the element's used color-scheme is dark, else "light".
 *
 * The renderer host sets `color-scheme` from theme.css: light by default and
 * dark under `body[data-ds-dark-theme]` (the attribute DSH toggles for its own
 * theme). `getComputedStyle` reads the inherited/used value, so this follows
 * the DSH theme without any global mutation.
 */
export function useColorScheme(ref: RefObject<HTMLElement | null>): "light" | "dark" {
  const [scheme, setScheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const read = () => {
      const value = ref.current ? getComputedStyle(ref.current).colorScheme : "";
      setScheme(value.trim() === "dark" ? "dark" : "light");
    };
    read();
    // DSH flips body[data-ds-dark-theme] when the theme changes; keep observing
    // the legacy data-theme hook too so the library still works in other hosts.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-theme", "data-ds-dark-theme"],
    });
    return () => observer.disconnect();
  }, [ref]);
  return scheme;
}
