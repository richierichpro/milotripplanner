import type { Drop, Event, Place, TripInput } from "./types.js";

// The "No fakes" rules for search results. Every drop keeps its reason so the
// "See sources" list can show what was left out and why.

export const MIN_REVIEWS = 100;

export function checkPlaces(places: Place[]): { kept: Place[]; drops: Drop[] } {
  const kept: Place[] = [];
  const drops: Drop[] = [];
  for (const p of places) {
    const status = p.status ?? "";
    let reason: string | undefined;
    if (/permanently closed/i.test(status)) reason = "Google lists it as permanently closed";
    else if (/temporarily closed/i.test(status)) reason = "Google lists it as temporarily closed";
    else if ((p.reviews ?? 0) < MIN_REVIEWS) reason = `only ${p.reviews ?? 0} reviews (needs ${MIN_REVIEWS}+)`;
    if (reason) drops.push({ id: p.id, name: p.name, kind: "place", reason });
    else kept.push(p);
  }
  return { kept, drops };
}

/** Keep events dated inside the trip, located in the destination, with a link. */
export function checkEvents(events: Event[], trip: Pick<TripInput, "destination" | "startDate" | "endDate">): { kept: Event[]; drops: Drop[] } {
  const kept: Event[] = [];
  const drops: Drop[] = [];
  const dest = trip.destination.toLowerCase();
  for (const e of events) {
    const where = `${e.venue ?? ""} ${e.address ?? ""}`.toLowerCase();
    let reason: string | undefined;
    if (!e.date) reason = `date "${e.dateText ?? "?"}" couldn't be read`;
    else if (e.date < trip.startDate || e.date > trip.endDate) reason = `on ${e.date}, outside the trip dates`;
    else if (!where.includes(dest)) reason = `venue/address doesn't mention ${trip.destination}`;
    else if (!e.link) reason = "no link or ticket link";
    if (reason) drops.push({ id: e.id, name: e.title, kind: "event", reason });
    else kept.push(e);
  }
  return { kept, drops };
}

// ---------- Opening hours ----------

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "9 am", "10:30 pm", "4" (with a meridiem borrowed from the range end) → minutes after midnight. */
function toMinutes(t: string, fallbackMeridiem?: string): number | undefined {
  const m = t.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return undefined;
  let hour = Number(m[1]) % 12;
  if ((m[3] ?? fallbackMeridiem) === "pm") hour += 12;
  return hour * 60 + Number(m[2] ?? 0);
}

/** "19:30" → "7:30 pm", the format Google uses. */
function to12h(hhmm: string): string {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "pm" : "am"}`;
}

/**
 * Is the place open at this local time on this date? undefined when Google
 * lists no hours for that weekday (shown as "hours not listed").
 */
export function isOpenAt(place: Pick<Place, "operatingHours">, date: string, hhmm: string): boolean | undefined {
  const text = place.operatingHours?.[WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]];
  if (!text) return undefined;
  if (/open 24 hours/i.test(text)) return true;
  if (/^closed$/i.test(text.trim())) return false;
  const at = toMinutes(to12h(hhmm));
  if (at === undefined) return undefined;

  // "9 am–1 pm, 4–9 pm": open if any range contains the time.
  for (const range of text.split(",")) {
    const [a, b] = range.split(/[–-]/).map((x) => x.trim());
    if (!a || !b) continue;
    const endMeridiem = b.toLowerCase().match(/am|pm/)?.[0];
    const start = toMinutes(a, /am|pm/i.test(a) ? undefined : endMeridiem);
    let end = toMinutes(b);
    if (start === undefined || end === undefined) continue;
    if (end <= start) end += 24 * 60; // closes after midnight
    const t = at < start ? at + 24 * 60 : at;
    if (t >= start && t < end) return true;
  }
  return false;
}
