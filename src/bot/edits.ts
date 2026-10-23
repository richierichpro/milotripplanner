import { randomBytes } from "node:crypto";
import { InlineKeyboard, InputFile, type Context } from "grammy";
import { renderCard } from "../cards/render.js";
import * as t from "../cards/templates.js";
import { checkPlaces, isOpenAt } from "../core/checks.js";
import { callTool, type ToolDef } from "../core/claude.js";
import { haversineKm, type LatLng } from "../core/geo.js";
import { normalizePlaces } from "../core/normalize.js";
import type { TripPlan } from "../core/planner.js";
import { mapsParams } from "../core/queries.js";
import { serpSearch } from "../core/serpapi.js";
import { matchesWish, placeKind } from "../core/themes.js";
import type { Day, Place } from "../core/types.js";
import type { Milo } from "./conversation.js";
import type { Heard } from "./listen.js";
import { dayData } from "./postplan.js";
import { dayLabel } from "./render.js";
import { loadState, saveState, type ChatState } from "./state.js";

// After the plan is posted Milo keeps listening. "Add a spa session on day 4" →
// a Google Maps search near that day's area, the best open match goes in, and
// the updated day is posted with an Undo. Chit-chat is ignored.

type Edit = { action: "add" | "remove"; day: number; what: string };
type EditUndo = { token: string; days: Day[] };

const QUIET_MS = 6_000;
const NEAR_KM = 15;
/** Every half hour from 09:30 to 20:30, afternoons first (the usual time for an extra). */
const SLOTS = Array.from({ length: 23 }, (_, i) => 570 + i * 30).sort((a, b) => Math.abs(a - 960) - Math.abs(b - 960));
const GAP_MIN = 60;
/** Listings a group wouldn't want in their plan (seen in real "spa" results). */
const SKETCHY = /happy ending|\bb2b\b|body ?to ?body|nuru|erotic|escort|cross massage|female to male|russian|full body massage/i;
/** Cheap pre-filter: only spend a model call when a message sounds like a change. */
const SOUNDS_LIKE_EDIT = /\b(add|include|put|swap|replace|remove|drop|skip|cancel|change|instead|also|day\s*\d)\b/i;

const EDIT: ToolDef = {
  name: "plan_edits",
  description: "Changes the group asked for to their posted trip plan.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["edits"],
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["action", "day", "what"],
          properties: {
            action: { type: "string", enum: ["add", "remove"] },
            day: { type: "integer", description: "Day number they said (1-based); 0 if they didn't say" },
            what: { type: "string", description: "add: what to search on Google Maps, short (e.g. 'spa', 'scuba diving'). remove: the stop's name as listed" },
          },
        },
      },
    },
  },
};

const SYSTEM = `You read a friend group's chat AFTER Milo posted their trip plan. Return only clear requests to change the plan: add something (to a day) or remove a listed stop. Questions, thanks, jokes and general chat are not edits: return an empty list. Never invent days that aren't listed.`;

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const stopName = (x: Day["stops"][number]) => (x.kind === "place" ? x.item.name : x.item.title);

export class EditFlow {
  private buffers = new Map<number, { msgs: Heard[]; timer?: NodeJS.Timeout }>();

  constructor(private milo: Milo) {
    milo.hooks.onEditRequest = async (chatId, heard) => this.hear(chatId, heard);
    const prev = milo.hooks.onCallback;
    milo.hooks.onCallback = async (ctx, s) => (await this.onCallback(ctx, s)) || prev(ctx, s);
  }

  private hear(chatId: number, heard: Heard) {
    const b = this.buffers.get(chatId) ?? { msgs: [] };
    this.buffers.set(chatId, b);
    b.msgs.push(heard);
    clearTimeout(b.timer);
    b.timer = setTimeout(() => void this.flush(chatId).catch((err) => console.error(`edit failed in ${chatId}:`, (err as Error).message)), QUIET_MS);
    b.timer.unref?.();
  }

  async flush(chatId: number) {
    const b = this.buffers.get(chatId);
    if (!b?.msgs.length) return;
    const msgs = b.msgs.splice(0);
    const s = await loadState(chatId);
    const plan = s.data.plan as TripPlan | undefined;
    if (!plan || s.stage !== "done") return;
    if (!msgs.some((m) => SOUNDS_LIKE_EDIT.test(m.text))) return;
    const days = plan.days.map((d, i) => `Day ${i + 1} (${d.date}): ${d.stops.map(stopName).join(", ") || "free"}`).join("\n");
    const lines = msgs.map((m) => `${m.name}: ${m.text}`).join("\n");
    const { edits } = await callTool<{ edits: Edit[] }>(SYSTEM, [{ role: "user", content: `Plan:\n${days}\n\nMessages:\n${lines}` }], EDIT, { fast: true, maxTokens: 600 });
    for (const e of edits ?? []) await this.apply(s, plan, e);
  }

  private async apply(s: ChatState, plan: TripPlan, e: Edit) {
    const before = structuredClone(plan.days);
    // No day given: the emptiest full day.
    const fullDays = plan.days.map((_, i) => i).filter((i) => i > 0 && i < plan.days.length - 1);
    const index = e.day >= 1 && e.day <= plan.days.length ? e.day - 1 : ([...fullDays].sort((a, b) => plan.days[a].stops.length - plan.days[b].stops.length)[0] ?? 0);
    if (e.action === "remove") return this.remove(s, plan, index, e.what, before);
    return this.add(s, plan, index, e.what, before);
  }

  private async remove(s: ChatState, plan: TripPlan, index: number, what: string, before: Day[]) {
    const matches = (x: Day["stops"][number]) => (x.kind === "place" ? matchesWish(x.item, what) : x.item.title.toLowerCase().includes(what.toLowerCase()));
    // That day first, then anywhere in the plan.
    const at = plan.days[index].stops.findIndex(matches);
    const where = at >= 0 ? index : plan.days.findIndex((d) => d.stops.some((x) => x.kind === "place" && matchesWish(x.item, what)));
    if (where < 0) return void (await this.milo.say(s.chatId, `🤔 I couldn't find “${t.esc(what)}” in the plan.`));
    const d = plan.days[where];
    const i = at >= 0 && where === index ? at : d.stops.findIndex((x) => x.kind === "place" && matchesWish(x.item, what));
    const [gone] = d.stops.splice(i, 1);
    return this.post(s, plan, where, before, `✏️ <b>Day ${where + 1}</b> updated: removed ${t.esc(stopName(gone))}`);
  }

  /** Searches near that day's places and keeps only real, open, well-reviewed matches. */
  private async add(s: ChatState, plan: TripPlan, index: number, what: string, before: Day[]) {
    const day = plan.days[index];
    const pts = day.stops.flatMap((x) => (x.kind === "place" ? [x.item] : []));
    const centre: LatLng | undefined = pts.length ? { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length } : plan.solution.hotel;
    await this.milo.bot.api.sendChatAction(s.chatId, "typing").catch(() => {});
    let found: Place[] = [];
    try {
      found = checkPlaces(normalizePlaces(await serpSearch(mapsParams(`${what} in ${plan.trip.destination}`, centre)))).kept;
    } catch (err) {
      console.error(`edit search failed in ${s.chatId}:`, (err as Error).message);
    }

    // A place asked for by name goes in wherever it is; a kind of thing ("spa") must be near the day's area.
    const inPlan = new Set(plan.days.flatMap((d) => d.stops.map((x) => x.item.id)));
    const named = (p: Place) => matchesWish(p, what);
    const candidates = found.filter((p) => !inPlan.has(p.id) && !SKETCHY.test(p.name) && (named(p) || !centre || haversineKm(centre, p) <= NEAR_KM));
    const score = (p: Place) => (named(p) ? 100 : 0) + (p.rating ?? 0) * Math.log10((p.reviews ?? 0) + 10);
    const taken = () => day.stops.map((x) => toMin(x.time));
    const freeSlot = (p: Place) => SLOTS.map(hm).find((h) => taken().every((m) => Math.abs(m - toMin(h)) >= GAP_MIN) && isOpenAt(p, day.date, h) !== false);

    // On a packed day, swap out its lowest-rated sight (never a meal, a night out or someone's must-do).
    const mustDos = s.squad.flatMap((m) => m.constraints.flatMap((c) => (c.kind === "must_do" && !c.waived ? [c.what] : [])));
    const swappable = day.stops
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => x.kind === "place" && placeKind(x.item) === "do" && !mustDos.some((w) => matchesWish(x.item as Place, w)))
      .sort((a, b) => score(a.x.item as Place) - score(b.x.item as Place));

    for (const p of candidates.sort((a, b) => score(b) - score(a))) {
      let time = freeSlot(p);
      let swapped: string | undefined;
      if (!time) {
        const out = swappable.find(({ x }) => isOpenAt(p, day.date, x.time) !== false);
        if (!out) continue;
        time = out.x.time;
        swapped = out.x.kind === "place" ? out.x.item.name : undefined;
        day.stops.splice(out.i, 1);
      }
      day.stops.push({ kind: "place", item: p, time, why: p.description ?? "", hoursNote: isOpenAt(p, day.date, time) === undefined ? "hours not listed" : undefined });
      day.stops.sort((a, b) => toMin(a.time) - toMin(b.time));
      const facts = [p.category, p.rating ? `⭐ ${p.rating}${p.reviews ? ` (${p.reviews.toLocaleString("en-IN")})` : ""}` : ""].filter(Boolean).join(" · ");
      const caption = `✏️ <b>Day ${index + 1}</b> updated: added <b>${t.esc(p.name)}</b> at <code>${time}</code>${swapped ? ` instead of ${t.esc(swapped)}` : ""}${facts ? ` · ${t.esc(facts)}` : ""}${p.mapsUrl ? ` · <a href="${t.esc(p.mapsUrl)}">map ↗</a>` : ""}`;
      return this.post(s, plan, index, before, caption);
    }
    await this.milo.say(s.chatId, `🤔 I couldn't find a good ${t.esc(what)} near Day ${index + 1}'s area that's open then.`);
  }

  /** Saves the change and posts the updated day card with an Undo. */
  private async post(s: ChatState, plan: TripPlan, index: number, before: Day[], caption: string) {
    const token = randomBytes(3).toString("hex");
    s.data.plan = plan;
    s.data.editUndo = { token, days: before } satisfies EditUndo;
    s.decisions.push(caption.replace(/<[^>]+>/g, ""));
    await saveState(s);
    const data = dayData(plan.days[index], index, plan);
    const png = (await renderCard(t.dayCard(data), () => t.dayCard(data, { withMap: false }))).png;
    const kb = new InlineKeyboard().text("Undo ↩️", `edit_undo:${token}`);
    const fullCaption = `${caption}\n<i>${t.esc(dayLabel(plan.days[index].date))}</i>`;
    await this.milo.send(s.chatId, () => this.milo.bot.api.sendPhoto(s.chatId, new InputFile(png, `day-${index + 1}.png`), { caption: fullCaption, parse_mode: "HTML", reply_markup: kb }));
  }

  private async onCallback(ctx: Context, s: ChatState): Promise<boolean> {
    const data = ctx.callbackQuery?.data ?? "";
    if (!data.startsWith("edit_undo:")) return false;
    const undo = s.data.editUndo as EditUndo | undefined;
    const plan = s.data.plan as TripPlan | undefined;
    if (!undo || !plan || undo.token !== data.slice(10)) {
      await ctx.answerCallbackQuery({ text: "Only the latest change can be undone." });
      return true;
    }
    plan.days = undo.days;
    s.data.editUndo = undefined;
    s.decisions.push("Last change undone");
    await saveState(s);
    await ctx.answerCallbackQuery({ text: "Undone ↩️" });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await this.milo.say(s.chatId, "↩️ Undone, the day is back to how it was.");
    return true;
  }
}
