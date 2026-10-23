import * as SunCalc from "suncalc";
import type { ToolDef } from "./claude.js";
import { suitsDiet, type ConstraintCheck } from "./constraints.js";
import type { LatLng } from "./directions.js";
import type { CandidatePool, Trip } from "./gather.js";
import type { Solution } from "./solve.js";
import { fame, placeKind, theme } from "./themes.js";
import type { CallLogEntry, Day, Drop, Event, Place, SquadMember } from "./types.js";

// Claude arranges real candidates by id; code checks everything it returns and
// adds the logistics (transfers, leave-by times, hop times, sunset).

export type DraftStop = { id: string; time: string; note: string };
export type Draft = { title: string; summary: string; days: { date: string; title: string; stops: DraftStop[] }[] };

export type TripPlan = {
  title: string;
  summary: string;
  trip: Trip;
  solution: Solution;
  days: Day[];
  hotelDistanceKm?: number;
  verification: { total: number; verified: number; removed: string[] };
  drops: Drop[];
  checks: Record<string, ConstraintCheck[]>;
  receipts: CallLogEntry[];
  createdAt: string;
};

export const MAX_STOPS_FULL_DAY = 5;
/** Sights or activities ([do]) every full day needs, so a day isn't only meals and bars. */
export const MIN_DO_FULL_DAY = 2;
export const SHORT_HOP_KM = 3;
/** Activity shops (water sports, cruises…) in a whole trip, unless the group asked for more. */
export const MAX_ACTIVITIES = 1;
/** A day whose places are further apart than this isn't "one area". */
export const DAY_SPREAD_KM = 15;
/** Leave for the airport this long before departure, plus the transfer time. */
export const AIRPORT_BUFFER_MIN = 120;
const IST = 330; // minutes ahead of UTC

export const SUBMIT: ToolDef = {
  name: "submit_itinerary",
  description: "Submit the day-by-day plan. Every stop id must be copied from the candidate list.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "summary", "days"],
    properties: {
      title: { type: "string", description: "Short trip title, no numbers" },
      summary: { type: "string", description: "Two sentences, no prices, ratings or numbers" },
      days: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["date", "title", "stops"],
          properties: {
            date: { type: "string" },
            title: { type: "string", description: "A few words naming the area or theme" },
            stops: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "time", "note"],
                properties: {
                  id: { type: "string" },
                  time: { type: "string", description: "HH:MM 24h" },
                  note: { type: "string", description: "At most 15 words, using only facts from this candidate's own line" },
                },
              },
            },
          },
        },
      },
    },
  },
};

export const RENOTE: ToolDef = {
  name: "rewrite_notes",
  description: "Rewrite these notes using only facts from each candidate's line.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["notes"],
    properties: { notes: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "note"], properties: { id: { type: "string" }, note: { type: "string" } } } } },
  },
};

export const SYSTEM = `You arrange a friend group's trip like a careful local planner, using ONLY the numbered candidates given. You never invent places, events, prices, ratings, hours or facts.
Rules:
- Copy ids exactly (p12, e1). Use each place at most once.
- At most ${MAX_STOPS_FULL_DAY} stops on a full day; light arrival and departure days. Nothing before the squad is together on the first day or after they leave for the airport on the last day.
- Each day explores ONE area (use the @lat,lng); different days can be in different parts of the destination, and a day out to a famous spot an hour away is good. The hotel is just the base. Meals at meal times (lunch 12:30–14:30, dinner 19:30–22:00). A beach or viewpoint near sunset. Respect opening hours shown.
- On beach trips leave a free afternoon block on one day; after a late night, start the next day late.
- Places are tagged [do:theme] (beach, heritage, faith, nature, viewpoint, market, museum, activity, sight), [eat] or [night]; [highlight] = a must-see, [gem] = loved by fewer people.
- Plan like a well-travelled local friend: every full day has a feel (e.g. old-town heritage, waterfalls and nature, a quiet beach and a fort at sunset) with at least ${MIN_DO_FULL_DAY} [do] stops of DIFFERENT themes. Cover the [highlight]s, and put at least one [gem] in the trip for every two days.
- Variety: never the same theme twice in a day; each theme at most twice in the trip; [do:activity] places (water sports, cruises, operators) at most ${MAX_ACTIVITIES} in the whole trip unless the group asked for that activity. Then at most 2 [eat] and 1 [night] per day.
- The group's interests, must-dos and preferences must be in the trip, but they aren't the whole trip.
- If anyone is veg/jain, every full day needs at least one meal stop from the places marked [veg]. Every must-do MUST be in the plan when a matching place is listed (a must-do activity like "bungee jumping" matches a place of that kind); these count as asked for, not as extra activities.
- Notes: at most 15 words, only facts present in that candidate's line (its category, description, rating words). No superlatives that aren't in its line (no "famous", "iconic", "best"), no numbers, no other place names. Describe events exactly as titled; a tribute or candlelight concert is never the artist performing.
- Titles and the summary: no prices, ratings or numbers.`;

// ---------- Time helpers ----------

const WEEKDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const weekday = (date: string) => WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
/** Minutes after midnight → "HH:MM", wrapping around the day. */
export const hm = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** "2026-11-20 07:45" → "07:45" */
export const clock = (t: string) => t.slice(11, 16);

export function tripDates(t: Pick<Trip, "startDate" | "endDate">): string[] {
  const out: string[] = [];
  for (let d = Date.parse(`${t.startDate}T00:00:00Z`); d <= Date.parse(`${t.endDate}T00:00:00Z`); d += 86_400_000) out.push(new Date(d).toISOString().slice(0, 10));
  return out;
}

/** Local (IST) sunset "HH:MM" for that date and place. */
export function sunsetAt(date: string, at: LatLng): string {
  const t = SunCalc.getTimes(new Date(`${date}T06:30:00Z`), at.lat, at.lng).sunset;
  return t ? hm(t.getUTCHours() * 60 + t.getUTCMinutes() + IST) : "18:00";
}

/** When the squad is together on day 1, and when the first person flies home. */
export function arrivalWindow(sol: Solution) {
  const arrivals = sol.flights.map((f) => f.out?.arriveTime).filter((x): x is string => !!x).sort();
  const departures = sol.flights.map((f) => f.back?.departTime).filter((x): x is string => !!x).sort();
  return { lastArrival: arrivals.at(-1), firstDeparture: departures[0] };
}

// ---------- Candidate lines ----------

/** Short ids Claude copies back: p1, p2… and e1, e2… */
export const alias = { place: (i: number) => `p${i + 1}`, event: (i: number) => `e${i + 1}` };

function tags(p: Place): string {
  const kind = placeKind(p);
  const f = kind === "do" ? fame(p) : undefined;
  return `[${kind}${kind === "do" ? `:${theme(p)}` : ""}]${f ? ` [${f}]` : ""}`;
}

/** One compact line per place; Claude never sees raw JSON. */
export function placeLine(p: Place, i: number, dates: string[], vegOk: boolean): string {
  const hours = [...new Set(dates.map((d) => p.operatingHours?.[weekday(d)]).filter(Boolean))].join(" / ") || "hours not listed";
  const rating = p.rating ? `${p.rating}★ (${p.reviews ?? 0})` : "no rating";
  return [alias.place(i), p.name, p.category ?? "place", rating, p.priceLevel ?? "-", p.description ?? "-", hours, `@${p.lat.toFixed(3)},${p.lng.toFixed(3)}`, tags(p), vegOk ? "[veg]" : ""]
    .filter(Boolean)
    .join(" | ");
}

export const eventLine = (e: Event, i: number) => [alias.event(i), e.title, `on ${e.date}`, e.venue ?? "-", e.address ?? "-"].join(" | ");

export const needsVeg = (squad: SquadMember[]) => squad.some((p) => p.constraints.some((c) => c.kind === "food" && (c.diet === "veg" || c.diet === "jain")));

/** The user message: the trip, everyone's wishes, the day-1 and last-day windows, then every candidate. */
export function buildPrompt(pool: CandidatePool, trip: Trip, sol: Solution, squad: SquadMember[], transferIn?: number, transferOut?: number): string {
  const dates = tripDates(trip);
  const vegNeeded = needsVeg(squad);
  const w = arrivalWindow(sol);
  const freeFrom = w.lastArrival ? hm(toMin(clock(w.lastArrival)) + (transferIn ?? 60) + 30) : "?";
  const leaveBy = w.firstDeparture ? hm(toMin(clock(w.firstDeparture)) - AIRPORT_BUFFER_MIN - (transferOut ?? 60)) : "?";
  const hotel = sol.hotel;
  const mustDos = squad.flatMap((p) => p.constraints.flatMap((c) => (c.kind === "must_do" ? [`${p.name}: ${c.what}`] : [])));
  const vibes = squad.flatMap((p) => p.constraints.flatMap((c) => (c.kind === "vibe" || c.kind === "no_go" ? [`${p.name}: ${c.kind === "no_go" ? "avoid " : ""}${c.what}`] : [])));
  const events = pool.events.map((e, i) => ({ e, i }));
  return [
    `Trip: ${squad.length} friends to ${trip.destination}, ${trip.startDate} to ${trip.endDate}. Days: ${dates.join(", ")}.`,
    `Interests: ${trip.interests.join(", ") || "anything"}. ${vegNeeded ? "Someone is vegetarian: a [veg] meal stop every full day." : ""}`,
    mustDos.length ? `Must-dos: ${mustDos.join("; ")}.` : "",
    vibes.length ? `Preferences: ${vibes.join("; ")}.` : "",
    `Day 1: squad together from ${freeFrom} (last lands ${w.lastArrival ? clock(w.lastArrival) : "?"}). Last day: leave for the airport by ${leaveBy}.`,
    `Sunset: ${dates.map((d) => `${d} ${sunsetAt(d, hotel ?? pool.places[0])}`).join(", ")}.`,
    hotel ? `Hotel (fixed): ${hotel.name} @${hotel.lat.toFixed(3)},${hotel.lng.toFixed(3)}. Prefer places near it.` : "",
    "",
    "PLACES (id | name | category | rating | price | description | hours on trip days | location | kind | diet):",
    ...pool.places.map((p, i) => placeLine(p, i, dates, vegNeeded && suitsDiet(p, "veg"))),
    "",
    events.length ? "EVENTS (id | title | date | venue | address):" : "EVENTS: none on these dates.",
    ...events.map(({ e, i }) => eventLine(e, i)),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ---------- Note check ----------

const BANNED = /\b(famous|iconic|legendary|best|big-name|world-class|must-visit|favourite|favorite|top|renowned|hidden gem|popular)\b/i;
/** Capitalised words that are ordinary in a note, not proper nouns. */
const EVERYDAY = new Set(["A", "An", "The", "Great", "Good", "Easy", "Relaxed", "Quiet", "Local", "Classic", "Sunset", "Morning", "Evening", "Lunch", "Dinner", "Breakfast", "Brunch", "Beach", "Fort", "Cafe", "Café", "Veg", "Vegetarian", "Pure", "Seafood", "Goan", "Indian", "Sea", "Views", "View"]);

/**
 * A note may only use facts in the item's own data: no new numbers, prices,
 * names or superlatives, and a tribute concert is never the artist performing.
 * Returns what's wrong, or undefined.
 */
export function noteProblem(note: string, item: Place | Event, allowNames: string[] = []): string | undefined {
  if (!note.trim()) return undefined;
  const own = (
    "name" in item ? `${item.name} ${item.category ?? ""} ${item.description ?? ""} ${item.address ?? ""} ${item.priceLevel ?? ""}` : `${item.title} ${item.venue ?? ""} ${item.address ?? ""}`
  ).toLowerCase();

  for (const n of note.match(/\d[\d,.]*/g) ?? []) if (!own.includes(n)) return `number "${n}" isn't in its data`;
  if (/[₹★]/.test(note)) return "prices or ratings belong on the card, not in the note";
  const sup = note.match(BANNED)?.[0];
  if (sup && !own.includes(sup.toLowerCase())) return `"${sup}" isn't in its data`;

  // Proper nouns after the first word must come from its data (or be a squad member / the destination).
  const words = note.replace(/^[^A-Za-z]*/, "").split(/[\s,;:.!?()]+/).slice(1);
  for (const w of words) {
    const word = w.replace(/['’]s$/, "");
    if (!/^[A-Z][a-z]/.test(word) || EVERYDAY.has(word)) continue;
    if (!own.includes(word.toLowerCase()) && !allowNames.some((a) => a.toLowerCase() === word.toLowerCase())) return `"${word}" isn't in its data`;
  }
  if (!("name" in item) && /tribute|candlelight|cover/i.test(item.title) && /\b(live|performs?|performing|playing|plays)\b/i.test(note)) return "a tribute concert isn't the artist performing";
  return undefined;
}
