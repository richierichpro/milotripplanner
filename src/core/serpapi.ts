/* eslint-disable @typescript-eslint/no-explicit-any -- raw SerpApi JSON */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CallLogEntry } from "./types.js";

// The only place Milo talks to SerpApi. Every response is cached on disk by a
// hash of its params, demo mode replays recorded responses, and every call is
// logged for "See sources". The API key is never written anywhere.

export type SerpParams = Record<string, string | number | boolean | undefined>;

const ENDPOINT = "https://serpapi.com/search.json";
const TIMEOUT_MS = 30_000;
const CACHE_DIR = path.join(process.cwd(), ".cache", "serpapi");
const DEMO_DIR = path.join(process.cwd(), "demo-data", "serpapi");

/** No key, or DEMO_MODE=true: answer only from demo-data/. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true" || !process.env.SERPAPI_API_KEY;
}

const recording = () => process.env.RECORD_DEMO === "true";

/** Non-empty params except the key, sorted, as strings. */
function cleanParams(params: SerpParams): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (k === "api_key" || v === undefined || v === "") continue;
    out.push([k, String(v)]);
  }
  return out.sort(([a], [b]) => a.localeCompare(b));
}

export function cacheKey(params: SerpParams): string {
  return createHash("sha1").update(JSON.stringify(cleanParams(params))).digest("hex");
}

export function cachePath(params: SerpParams, demo = false): string {
  const engine = String(params.engine ?? "unknown");
  return path.join(demo ? DEMO_DIR : CACHE_DIR, engine, `${cacheKey(params)}.json`);
}

/** A short human label for the call log. */
function summarize(params: SerpParams): string {
  if (params.q) return String(params.q);
  if (params.departure_id && params.arrival_id) return `${params.departure_id} → ${params.arrival_id}`;
  if (params.departure_id) return `from ${params.departure_id}`;
  return String(params.engine);
}

async function readJson(file: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file: string, json: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(json));
}

/** Drop the fields that echo the request URL (and with it the key). */
function scrub(json: any): any {
  if (json && typeof json === "object") {
    if (json.search_metadata) {
      delete json.search_metadata.json_endpoint;
      delete json.search_metadata.raw_html_file;
    }
    if (json.search_parameters) delete json.search_parameters.api_key;
  }
  return json;
}

function throwIfError(engine: string, json: any) {
  const error = json && typeof json === "object" ? json.error : undefined;
  if (!error) return;
  // An empty result is a valid answer, not a failure.
  if (/hasn't returned any results/i.test(String(error))) return;
  throw new Error(`SerpApi ${engine}: ${error}`);
}

export async function serpSearch(params: SerpParams, opts?: { log?: CallLogEntry[] }): Promise<any> {
  const engine = String(params.engine ?? "unknown");
  const started = Date.now();
  const logAs = (source: CallLogEntry["source"]) =>
    opts?.log?.push({ engine, summary: summarize(params), source, ms: Date.now() - started, at: new Date().toISOString() });

  if (isDemoMode()) {
    const json = await readJson(cachePath(params, true));
    if (!json) throw new Error(`No demo data for this search: ${engine} ${summarize(params)}`);
    throwIfError(engine, json);
    logAs("demo");
    return json;
  }

  // MILO_FRESH=true skips the cache (results are still saved).
  const cacheFile = cachePath(params);
  const cached = process.env.MILO_FRESH === "true" ? null : await readJson(cacheFile);
  if (cached) {
    throwIfError(engine, cached);
    if (recording()) await writeJson(cachePath(params, true), cached);
    logAs("cache");
    return cached;
  }

  // Tests and the simulator set SERPAPI_OFFLINE=true: a miss fails instead of spending a search.
  if (process.env.SERPAPI_OFFLINE === "true") throw new Error(`Offline and not cached: ${engine} ${summarize(params)}`);

  const url = new URL(ENDPOINT);
  for (const [k, v] of cleanParams(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", process.env.SERPAPI_API_KEY!);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`SerpApi ${engine}: request failed (${(err as Error).name})`);
  }
  const json = scrub(await res.json().catch(() => ({ error: `HTTP ${res.status}` })));
  throwIfError(engine, json);
  if (!res.ok) throw new Error(`SerpApi ${engine}: HTTP ${res.status}`);

  await writeJson(cacheFile, json);
  if (recording()) await writeJson(cachePath(params, true), json);
  logAs("live");
  return json;
}
