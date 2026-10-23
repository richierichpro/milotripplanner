import { InputFile, InputMediaBuilder } from "grammy";
import { renderCard } from "../cards/render.js";
import * as t from "../cards/templates.js";
import type { TripPlan } from "../core/planner.js";
import type { Day, Flight, SquadMember } from "../core/types.js";
import type { Milo } from "./conversation.js";
import { costHtml, dateRange, dayLabel, engineLabel, flightsHtml, hotelHtml, proofText, timeAgo } from "./render.js";
import type { ChatState } from "./state.js";

// Posts the finished plan: albums of cards, each followed by one short text with
// the key facts and source links (Telegram images aren't clickable).

export const TEXT_MAX = 4096;
export const CAPTION_MAX = 1024;
const e = t.esc;
const link = (url: string | undefined, label: string) => (url ? `<a href="${e(url)}">${e(label)}</a>` : e(label));
const stopName = (s: Day["stops"][number]) => (s.kind === "place" ? s.item.name : s.item.title);
const stopLink = (s: Day["stops"][number]) => (s.kind === "place" ? s.item.mapsUrl : s.item.link);

/** Day card input from a planned day, with arrival and airport rows around the stops. */
export function dayData(day: Day, index: number, plan: TripPlan, now = Date.now()): t.DayData {
  const logistics = (at: "start" | "end") => (day.logistics ?? []).filter((x) => x.at === at).map((l): t.DayStop => ({ time: l.time, name: l.label, proof: "", kind: "logistics" }));
  const stops: t.DayStop[] = day.stops.map((s) => {
    const p = s.kind === "place" ? s.item : undefined;
    return {
      time: s.time,
      name: stopName(s),
      category: s.kind === "place" ? s.item.category : `Event · ${s.item.dateText ?? ""}`,
      rating: p?.rating,
      reviews: p?.reviews,
      price: p?.prices?.admission[0]?.priceText ?? p?.priceLevel,
      note: s.why || undefined,
      photo: s.item.thumbnail,
      proof: `${proofText(s.item.source, now)}${s.hoursNote ? ` · ${s.hoursNote}` : ""}`,
      lat: p?.lat,
      lng: p?.lng,
      hop: s.hop,
    };
  });
  const h = plan.solution.hotel;
  return {
    index,
    date: dayLabel(day.date),
    title: day.title,
    stops: [...logistics("start"), ...stops, ...logistics("end")],
    leaveBy: day.leaveBy,
    travel: day.travelMinutes ? `≈ ${day.travelMinutes} min` : undefined,
    hotel: h ? { lat: h.lat, lng: h.lng, name: h.name } : undefined,
  };
}

/** After the header album: the stay and everyone's flights, with links. */
export function flightsText(plan: TripPlan): string {
  const rows = plan.solution.flights.map(
    (p) =>
      `✈️ <b>${e(p.person)}</b>: <code>${e(p.out?.from ?? "?")} ${e(p.out?.departTime.slice(11) ?? "")} → ${e(p.out?.to ?? "?")} ${e(p.out?.arriveTime.slice(11) ?? "")}</code> · back <code>${e(p.back?.departTime.slice(11) ?? "?")}</code> · ${link(p.out?.source.url, "Google Flights")}`,
  );
  const h = plan.solution.hotel;
  return [
    `🏨 <b>${e(h?.name ?? "No hotel found")}</b>${h?.pricePerNight ? ` · ${t.rupees(h.pricePerNight)}/night` : ""}${h ? ` · ${link(h.link ?? h.source.url, "Google Hotels")}` : ""}`,
    "",
    ...rows,
    "",
    `<i>Every item is a live Google result (${plan.verification.verified}/${plan.verification.total} verified).</i>`,
  ].join("\n");
}

/** After the day album: every stop with a map link, in an expandable quote. */
export function daysText(plan: TripPlan): string {
  const blocks = plan.days.map((d, i) => {
    const lines = d.stops.map((s) => `<code>${s.time}</code> ${s.kind === "place" ? "📍" : "🎟"} ${link(stopLink(s), stopName(s))}`);
    return `<b>Day ${i + 1} · ${e(dayLabel(d.date))}</b>${d.leaveBy ? ` · leave <code>${d.leaveBy}</code>` : ""}\n${lines.join("\n") || "<i>free</i>"}`;
  });
  return `📍 <b>Your days</b>, with map links:\n<blockquote expandable>${blocks.join("\n\n")}</blockquote>`;
}

/** One line per person: how many of their limits the plan meets. */
export function passText(plan: TripPlan, squad: SquadMember[]): string {
  return squad
    .map((p) => {
      const checks = (plan.checks[p.id] ?? []).filter((c) => !c.pending);
      const ok = checks.filter((c) => c.ok).length;
      const waived = checks.filter((c) => c.waived).length;
      return `${ok === checks.length ? "✅" : "⚠️"} <b>${e(p.name)}</b>: ${ok}/${checks.length} met${waived ? ` (${waived} agreed exception)` : ""}`;
    })
    .join("\n");
}

/** "✅ Everyone's limits are met", or each person's count when someone has an exception. */
export function limitsLine(plan: TripPlan, squad: SquadMember[]): string {
  const off = squad.some((p) => (plan.checks[p.id] ?? []).some((c) => !c.pending && !c.ok && !c.waived));
  const waived = squad.some((p) => (plan.checks[p.id] ?? []).some((c) => c.waived));
  return off || waived ? passText(plan, squad) : "✅ <b>Everyone's limits are met.</b> Ready to book?";
}

/** The closing message: everything to book (flights, the stay, every stop) and who pays what. */
export function bookingList(plan: TripPlan): string {
  const sol = plan.solution;
  const leg = (f: Flight) =>
    `<code>${e(f.from)} ${f.departTime.slice(11)} → ${e(f.to)} ${f.arriveTime.slice(11)}</code> ${e(f.flightNumbers.join("/"))} · ${t.rupees(f.pricePerPerson)} · ${link(f.source.url, "Book ↗")}`;
  const flights = sol.flights.map((p) => [`<b>${e(p.person)}</b>`, p.out ? `  out ${leg(p.out)}` : "  out: couldn't check", p.back ? `  back ${leg(p.back)}` : "  back: couldn't check"].join("\n"));
  const h = sol.hotel;
  const price = h?.pricePerNight ? `${t.rupees(h.pricePerNight)}/night × ${sol.nights} nights × ${sol.rooms} room${sol.rooms > 1 ? "s" : ""}` : "price not listed";
  const stay = h ? `<b>${e(h.name)}</b> · ${price} · ${link(h.link ?? h.source.url, "Book ↗")}` : "No stay found";
  const days = plan.days.map((d, i) => {
    const stops = d.stops.map((s) => `  <code>${s.time}</code> ${link(stopLink(s), stopName(s))}`);
    return `<b>Day ${i + 1} · ${e(dayLabel(d.date))}</b>\n${stops.join("\n") || "  free"}`;
  });
  const pays = sol.costs.map((c) => `${e(c.person)} ${t.rupees(c.total)}`).join(" · ");
  const msg = [
    "🧾 <b>Your booking list</b>",
    "",
    "✈️ <b>Flights</b>",
    ...flights,
    "",
    "🏨 <b>Stay</b>",
    stay,
    "",
    "📍 <b>Plan</b>",
    `<blockquote expandable>${days.join("\n\n")}</blockquote>`,
    `💸 <b>Each pays</b> (flights + stay): ${pays}`,
  ].join("\n");
  return msg.length <= TEXT_MAX ? msg : msg.replace(/<blockquote expandable>[\s\S]*<\/blockquote>/, "<i>Day-by-day links are in the message above.</i>");
}

/** Every search and every dropped item, for "See sources", split into messages under 4,096 chars. */
export function sourcesMessages(plan: TripPlan, now = Date.now()): string[] {
  const searches = plan.receipts.map((r) => `• ${e(engineLabel(r.engine))}: ${e(r.summary)} <i>(${r.source}, ${r.ms} ms)</i>`);
  const drops = plan.drops.map((d) => `• ✗ ${e(d.name)}: <i>${e(d.reason)}</i>`);
  const engines = new Set(plan.receipts.map((r) => r.engine)).size;
  const head = `🔎 <b>Sources</b> · ${plan.receipts.length} searches across ${engines} Google engines · checked ${timeAgo(plan.createdAt, now)}`;
  const parts = [`${head}\n<blockquote expandable>${searches.join("\n")}</blockquote>`, `🗑 <b>Left out</b> (${drops.length})\n<blockquote expandable>${drops.join("\n") || "nothing"}</blockquote>`];
  return parts.flatMap((p) => (p.length <= TEXT_MAX ? [p] : chunk(p)));
}

/** Splits a long "head + quote" message on line breaks, keeping each piece valid HTML. */
function chunk(html: string): string[] {
  const [head, body] = html.split("<blockquote expandable>");
  const lines = body.replace("</blockquote>", "").split("\n");
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => out.push(`${out.length ? "" : head}<blockquote expandable>${cur.join("\n")}</blockquote>`);
  for (const l of lines) {
    if ((head + cur.join("\n") + l).length > TEXT_MAX - 60) {
      flush();
      cur = [];
    }
    cur.push(l);
  }
  flush();
  return out;
}

export async function postPlan(milo: Milo, s: ChatState, plan: TripPlan) {
  const chatId = s.chatId;
  const api = milo.bot.api;
  const now = Date.now();
  const sol = plan.solution;
  const render = async (html: string, withoutMap?: () => string) => (await renderCard(html, withoutMap)).png;
  const album = async (pngs: Buffer[], caption: string) => {
    await api.sendChatAction(chatId, "upload_photo").catch(() => {});
    const media = pngs.map((png, i) => InputMediaBuilder.photo(new InputFile(png, `milo-${i}.png`), i === 0 ? { caption: caption.slice(0, CAPTION_MAX), parse_mode: "HTML" } : {}));
    return milo.send(chatId, () => api.sendMediaGroup(chatId, media));
  };

  // 1. Header, flights and hotel.
  const avg = sol.costs.reduce((a, c) => a + c.total, 0) / Math.max(1, sol.costs.length);
  const dates = dateRange(plan.trip.startDate, plan.trip.endDate);
  const header = t.headerCard({
    title: plan.title,
    destination: plan.trip.destination,
    dates,
    perPerson: avg,
    summary: plan.summary,
    squad: s.squad.map((p) => p.name),
    verified: plan.verification,
    searches: plan.receipts.length,
  });
  const firstAlbum = [await render(header), await render(flightsHtml(plan.trip.destination, sol.flights, sol.extraVsCheapest, now))];
  if (sol.hotel) firstAlbum.push(await render(hotelHtml(sol.hotel, sol.nights, sol.rooms, plan.hotelDistanceKm, now)));
  await album(firstAlbum, `🗺 <b>${e(plan.title)}</b> · ${e(dates)} · ≈ ${t.rupees(avg)} each`);
  await milo.say(chatId, flightsText(plan));

  // 2. One card per day.
  const dayPngs: Buffer[] = [];
  for (const [i, d] of plan.days.entries()) {
    const data = dayData(d, i, plan, now);
    dayPngs.push(await render(t.dayCard(data), () => t.dayCard(data, { withMap: false })));
  }
  await album(dayPngs, "📍 <b>Day by day</b> · each day stays in one area");
  await milo.say(chatId, daysText(plan));

  // 3. Cost split, then the booking list closes the plan.
  await api.sendChatAction(chatId, "upload_photo").catch(() => {});
  const cost = await render(costHtml(sol.costs, s.squad, sol.nights, sol.rooms));
  await milo.send(chatId, () => api.sendPhoto(chatId, new InputFile(cost, "cost.png"), { caption: "💸 <b>Cost split</b> · flights + hotel share per person", parse_mode: "HTML" }));
  await milo.say(chatId, bookingList(plan));
}
