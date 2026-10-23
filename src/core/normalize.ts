/* eslint-disable @typescript-eslint/no-explicit-any -- raw SerpApi JSON */
import { createHash } from "node:crypto";
import type { Destination, Event, Flight, Hotel, Place, PlacePrices, Source, TicketOption, TourOption } from "./types.js";

// Raw SerpApi JSON becomes typed results here and nowhere else. Missing fields
// turn into undefined; anything we can't place on a map or price is skipped.
// Ids come from SerpApi's own data so the same result keeps the same id.

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const shortHash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 10);
const dedupe = <T extends { id: string }>(xs: T[]): T[] => [...new Map(xs.map((x) => [x.id, x])).values()];
const mapsLink = (placeId: string) => `https://www.google.com/maps/place/?q=place_id:${placeId}`;

/** When SerpApi ran the search ("2026-10-09 10:12:03 UTC"), as ISO. */
function fetchedAt(json: any): string {
  const raw = str(json?.search_metadata?.created_at);
  const d = raw ? new Date(raw.replace(" UTC", "Z").replace(" ", "T")) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function source(json: any, engine: string, url?: string): Source {
  return { engine, url: url ?? str(json?.search_metadata?.[`${engine}_url`]), fetchedAt: fetchedAt(json) };
}

function coords(o: any): { lat: number; lng: number } | undefined {
  const lat = num(o?.gps_coordinates?.latitude);
  const lng = num(o?.gps_coordinates?.longitude);
  return lat === undefined || lng === undefined ? undefined : { lat, lng };
}

/** operating_hours as an object, or place details' list of one-key objects → { friday: "9 am–8 pm" }. */
function hoursMap(raw: any): Record<string, string> | undefined {
  let entries: [string, unknown][] = [];
  if (Array.isArray(raw)) entries = raw.flatMap((o) => (o && typeof o === "object" ? Object.entries(o) : []));
  else if (raw && typeof raw === "object") entries = Object.entries(raw);
  const out: Record<string, string> = {};
  for (const [day, text] of entries) if (typeof text === "string") out[day.toLowerCase()] = text;
  return Object.keys(out).length ? out : undefined;
}

// ---------- Google Flights ----------

/** best_flights and other_flights merged; a multi-segment trip becomes one Flight with stops and via. */
export function normalizeFlights(json: any): Flight[] {
  const src = source(json, "google_flights");
  const out: Flight[] = [];
  for (const option of [...(json?.best_flights ?? []), ...(json?.other_flights ?? [])]) {
    const segs: any[] = Array.isArray(option?.flights) ? option.flights : [];
    const price = num(option?.price);
    if (!segs.length || price === undefined) continue;
    const first = segs[0];
    const last = segs[segs.length - 1];
    const departTime = str(first?.departure_airport?.time);
    const arriveTime = str(last?.arrival_airport?.time);
    if (!departTime || !arriveTime) continue;
    const flightNumbers = segs.map((s) => str(s?.flight_number)).filter((x): x is string => !!x);
    const airlines = [...new Set(segs.map((s) => str(s?.airline)).filter(Boolean))];
    out.push({
      id: `flight:${flightNumbers.join("+").replace(/\s+/g, "")}@${departTime}`,
      source: src,
      from: str(first?.departure_airport?.id) ?? "",
      to: str(last?.arrival_airport?.id) ?? "",
      departTime,
      arriveTime,
      airline: airlines.join(" + ") || "Unknown airline",
      airlineLogo: str(option?.airline_logo) ?? str(first?.airline_logo),
      flightNumbers,
      stops: segs.length - 1,
      via: segs.slice(0, -1).map((s) => str(s?.arrival_airport?.id)).filter((x): x is string => !!x),
      durationMin: num(option?.total_duration) ?? 0,
      pricePerPerson: price,
    });
  }
  // The same itinerary can appear in both lists.
  return dedupe(out);
}

// ---------- Google Hotels ----------

export function normalizeHotels(json: any): Hotel[] {
  const src = source(json, "google_hotels");
  const out: Hotel[] = [];
  for (const p of json?.properties ?? []) {
    const at = coords(p);
    const token = str(p?.property_token);
    const name = str(p?.name);
    if (!at || !token || !name) continue;
    const link = str(p?.link);
    out.push({
      id: `hotel:${token}`,
      source: { ...src, url: link ?? src.url },
      name,
      ...at,
      pricePerNight: num(p?.rate_per_night?.extracted_lowest),
      rating: num(p?.overall_rating),
      reviews: num(p?.reviews),
      stars: num(p?.extracted_hotel_class),
      thumbnail: str(p?.images?.[0]?.thumbnail),
      amenities: strings(p?.amenities),
      link,
      checkInTime: str(p?.check_in_time),
      checkOutTime: str(p?.check_out_time),
    });
  }
  return out;
}

// ---------- Google Maps ----------

export function normalizePlaces(json: any): Place[] {
  const src = source(json, "google_maps");
  const results: any[] = json?.local_results ?? (json?.place_results ? [json.place_results] : []);
  const out: Place[] = [];
  for (const r of results) {
    const at = coords(r);
    const placeId = str(r?.place_id);
    const name = str(r?.title);
    if (!at || !placeId || !name) continue;
    const mapsUrl = mapsLink(placeId);
    const hoursText = str(r?.hours);
    out.push({
      id: `place:${placeId}`,
      source: { ...src, url: mapsUrl },
      name,
      category: str(r?.type),
      ...at,
      rating: num(r?.rating),
      reviews: num(r?.reviews),
      priceLevel: str(r?.price),
      address: str(r?.address),
      hours: hoursText,
      thumbnail: str(r?.thumbnail),
      description: str(r?.description),
      mapsUrl,
      status: str(r?.open_state) ?? (/closed/i.test(String(r?.hours ?? "")) ? hoursText : undefined),
      operatingHours: hoursMap(r?.operating_hours ?? r?.hours),
    });
  }
  return dedupe(out);
}

/** Place details → entry tickets, tours and typical spend, cheapest first. */
export function normalizePlacePrices(json: any): PlacePrices {
  const r = json?.place_results ?? {};
  const placeId = str(r?.place_id);
  const src = source(json, "google_maps", placeId ? mapsLink(placeId) : undefined);

  const admission: TicketOption[] = [];
  for (const group of Array.isArray(r?.admission) ? r.admission : []) {
    for (const o of Array.isArray(group?.options) ? group.options : []) {
      const price = num(o?.extracted_price);
      const title = str(o?.title);
      if (price === undefined || !title) continue;
      admission.push({ title, price, priceText: str(o?.price) ?? `₹${price}`, link: str(o?.link), official: o?.official_site === true });
    }
  }

  const tours: TourOption[] = [];
  for (const e of Array.isArray(r?.experiences) ? r.experiences : []) {
    const price = num(e?.extracted_price);
    const title = str(e?.title);
    if (price === undefined || !title) continue;
    tours.push({ title, price, priceText: str(e?.price) ?? `₹${price}`, link: str(e?.link), provider: str(e?.source), rating: num(e?.rating), reviews: num(e?.reviews) });
  }

  const cheapestFirst = <T extends { price: number }>(xs: T[]) => xs.sort((a, b) => a.price - b.price);
  const range = str(r?.price);
  return { source: src, admission: cheapestFirst(admission), tours: cheapestFirst(tours), priceRange: range?.includes("₹") ? range : undefined };
}

// ---------- Google events ----------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "21 Nov", "Nov 21" or "Sat, Nov 21" → "2026-11-21", in the trip's year. */
export function parseEventDate(text: string | undefined, year: number): string | undefined {
  if (!text) return undefined;
  const m = text.toLowerCase().match(/(\d{1,2})\s+([a-z]{3})|([a-z]{3})[a-z]*\s+(\d{1,2})/);
  if (!m) return undefined;
  const day = Number(m[1] ?? m[4]);
  const month = MONTHS.indexOf((m[2] ?? m[3]).slice(0, 3));
  if (month < 0 || day < 1 || day > 31) return undefined;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeEvents(json: any, year: number): Event[] {
  const src = source(json, "google");
  const out: Event[] = [];
  for (const e of json?.events_results ?? []) {
    const title = str(e?.title);
    if (!title) continue;
    // `date` is either a plain string or { start_date, when }.
    const d = e?.date;
    const dateText = typeof d === "string" ? str(d) : [str(d?.start_date), str(d?.when)].filter(Boolean).join(" · ") || undefined;
    const startText = typeof d === "string" ? d : (str(d?.start_date) ?? str(d?.when));
    const address = strings(e?.address);
    const link = str(e?.link) ?? str(e?.ticket_info?.[0]?.link);
    out.push({
      id: `event:${shortHash(`${title}|${dateText ?? ""}`)}`,
      source: { ...src, url: link ?? src.url },
      title,
      dateText,
      date: parseEventDate(startText, year),
      venue: str(e?.venue?.name) ?? address[0],
      address: address.join(", ") || undefined,
      link,
      thumbnail: str(e?.thumbnail) ?? str(e?.image),
    });
  }
  return dedupe(out);
}

// ---------- Google Travel Explore ----------

export function normalizeDestinations(json: any): Destination[] {
  const src = source(json, "google_travel_explore");
  const out: Destination[] = [];
  for (const d of json?.destinations ?? []) {
    const id = str(d?.destination_id);
    const name = str(d?.name);
    if (!id || !name) continue;
    const at = coords(d);
    out.push({
      id: `dest:${id}`,
      name,
      country: str(d?.country),
      lat: at?.lat,
      lng: at?.lng,
      airportCode: str(d?.destination_airport?.code),
      flightPrice: num(d?.flight_price),
      hotelPrice: num(d?.hotel_price),
      startDate: str(d?.start_date),
      endDate: str(d?.end_date),
      thumbnail: str(d?.thumbnail),
      airline: str(d?.airline),
      stops: num(d?.number_of_stops),
      source: { ...src, url: str(d?.link) ?? src.url },
    });
  }
  return out;
}
