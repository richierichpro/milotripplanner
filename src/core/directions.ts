import { directionsParams, type TravelMode } from "./queries.js";
import { serpSearch } from "./serpapi.js";
import type { CallLogEntry } from "./types.js";

export type LatLng = { lat: number; lng: number };
export type TravelTime = { minutes: number; km: number; text: string; mode: TravelMode };

/** At most 12 Directions searches per plan; past that, hops fall back to straight-line estimates. */
export class DirectionsBudget {
  used = 0;
  constructor(readonly max = 12) {}

  take(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }
}

/** Real travel time from Google Maps Directions (first route); undefined when over budget or there's no route. */
export async function getTravelTime(
  from: LatLng,
  to: LatLng,
  mode: TravelMode,
  departAt: Date | undefined,
  opts: { budget?: DirectionsBudget; log?: CallLogEntry[] } = {},
): Promise<TravelTime | undefined> {
  if (opts.budget && !opts.budget.take()) return undefined;
  const departUnix = departAt ? Math.floor(departAt.getTime() / 1000) : undefined;
  const json = await serpSearch(directionsParams(from, to, mode, departUnix), { log: opts.log });
  const route = json?.directions?.[0];
  if (!route || typeof route.duration !== "number") return undefined;
  const minutes = Math.round(route.duration / 60);
  return {
    minutes,
    km: Math.round((route.distance ?? 0) / 100) / 10,
    text: String(route.formatted_duration ?? `${minutes} min`),
    mode,
  };
}
