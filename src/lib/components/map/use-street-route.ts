import { useEffect, useState } from "react";
import { coordinate, type LatLng } from "./map-utils";

const cache = new Map<string, LatLng[]>();
// The upstream Next.js app proxied OSRM through /api/street-route; DSH has no
// server half, so the browser calls the public OSRM demo server directly (it
// sends Access-Control-Allow-Origin: *). OSRM's driving profile is a road
// overview, not walking or transit directions.
const OSRM = "https://router.project-osrm.org/route/v1/driving";

/**
 * Street geometry for a "lng,lat;lng,lat" key, fetched in the background so the
 * answer never waits for a map service.
 * Returns points, `null` when routing failed, or `undefined` while loading.
 */
export function useStreetRoute(routingKey: string, enabled: boolean): LatLng[] | null | undefined {
  const [result, setResult] = useState<{ key: string; points: LatLng[] | null } | null>(null);
  useEffect(() => {
    if (!enabled || !routingKey.includes(";") || cache.has(routingKey)) return;
    const controller = new AbortController();
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const debounce = setTimeout(async () => {
      timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const url = `${OSRM}/${routingKey}?overview=full&geometries=geojson&steps=false`;
        const response = await fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok) throw new Error("Route service unavailable");
        const data: { code?: string; routes?: { geometry?: { coordinates?: [number, number][] } }[] } = await response.json();
        const coordinates = data.routes?.[0]?.geometry?.coordinates ?? [];
        if (data.code !== "Ok" || coordinates.length < 2) throw new Error("No street route available");
        // OSRM returns [lng, lat]; the map works in [lat, lng].
        const points = coordinates.flatMap(([lng, lat]) => {
          const result = coordinate({ lat, lng });
          return result ? [result] : [];
        });
        if (points.length < 2) throw new Error("No street route available");
        if (cache.size >= 64) cache.delete(cache.keys().next().value!);
        cache.set(routingKey, points);
        if (active) setResult({ key: routingKey, points });
      } catch {
        if (active) setResult({ key: routingKey, points: null });
      } finally { clearTimeout(timeout); }
    }, 700);
    return () => { active = false; clearTimeout(debounce); clearTimeout(timeout); controller.abort(); };
  }, [routingKey, enabled]);
  return cache.get(routingKey) ?? (result?.key === routingKey ? result.points : undefined);
}
