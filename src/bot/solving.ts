import { randomBytes } from "node:crypto";
import { InlineKeyboard, InputFile, type Context } from "grammy";
import { renderCard } from "../cards/render.js";
import { esc, hotelChoiceCard } from "../cards/templates.js";
import { gatherCandidates, type CandidatePool, type Trip } from "../core/gather.js";
import { formatINR } from "../core/money.js";
import { planTrip, type TripPlan } from "../core/planner.js";
import { budgetCompromises, problems, solve, type Compromise, type Solution } from "../core/solve.js";
import type { SquadMember } from "../core/types.js";
import type { Milo } from "./conversation.js";
import { actsFor, mention, type PlanningFlow } from "./flow.js";
import { hotelButtons, hotelOptions, hotelVoteText, hotelWinner, letter, type HotelVote } from "./hotelvote.js";
import { bookingList, postPlan, sourcesMessages } from "./postplan.js";
import { flightsHtml } from "./render.js";
import { loadState, saveState, type ChatState } from "./state.js";
import { newQuickVote, quickTick, type QuickVote } from "./votes.js";

// Solve within everyone's limits; when a hard limit breaks, ask only the person
// affected, with 2–3 real options. Changes that touch everyone get a quick 👍/👎.

type SolveData = {
  choice?: { priceFirst: string[]; hotelId?: string };
  asking?: { memberId: string; options: Compromise[] };
  quick?: QuickVote & { option: Compromise; by: string };
  hotelVote?: HotelVote;
  flightsShown?: boolean;
};
const sd = (s: ChatState) => (s.data.solve ??= {}) as SolveData;
const tripOf = (s: ChatState): Trip => ({ destination: s.trip.destination!, startDate: s.trip.startDate!, endDate: s.trip.endDate!, interests: s.trip.interests });
const letterAt = (i: number) => String.fromCharCode(65 + i);

/** "▰▰▰▱▱▱▱▱▱▱" */
export const bar = (done: number, total: number, width = 10) => {
  const n = Math.max(0, Math.min(width, Math.round((done / Math.max(1, total)) * width)));
  return "▰".repeat(n) + "▱".repeat(width - n);
};

/** Progress in plain words: what Milo is doing for the group, not which search it's running. */
function friendly(step: string): string {
  if (/flights/i.test(step)) return "✈️ Finding flights for everyone…";
  if (/hotels/i.test(step)) return "🏨 Finding a stay that fits…";
  if (/maps|places/i.test(step)) return "📍 Finding the best things to do…";
  if (/arrange/i.test(step)) return "🧭 Building your itinerary…";
  if (/checking every/i.test(step)) return "✅ Double-checking everything…";
  if (/travel times/i.test(step)) return "🚕 Working out travel times…";
  return "🗺 Planning your trip…";
}

export class SolvingFlow {
  /** Pools stay in memory; after a restart they're rebuilt from the search cache for free. */
  readonly pools = new Map<number, CandidatePool>();
  /** Called once every hard limit passes or is waived. */
  next: (chatId: number, sol: Solution, pool: CandidatePool) => Promise<void> = (chatId, sol, pool) => this.itinerary(chatId, sol, pool);

  constructor(private milo: Milo, flow: PlanningFlow) {
    flow.next = (chatId) => this.start(chatId);
    const prev = milo.hooks.onCallback;
    milo.hooks.onCallback = async (ctx, s) => (await this.onCallback(ctx, s)) || prev(ctx, s);
  }

  private get api() {
    return this.milo.bot.api;
  }

  async pool(s: ChatState, onProgress?: (text: string) => void): Promise<CandidatePool> {
    const hit = this.pools.get(s.chatId);
    if (hit) return hit;
    const pool = await gatherCandidates(tripOf(s), s.squad, onProgress);
    this.pools.set(s.chatId, pool);
    return pool;
  }

  async start(chatId: number) {
    const s = await loadState(chatId);
    s.stage = "solving";
    s.pending = ["Searching within everyone's limits"];
    await saveState(s);
    await this.milo.updateTripCard(s);
    await this.api.sendChatAction(chatId, "typing").catch(() => {});

    // One self-updating status message with a progress bar, edited at most every 1.2 s.
    const status = await this.milo.say(chatId, `✈️ Finding flights for everyone…\n${bar(0, 1)}`);
    let started = 0;
    let lastEdit = 0;
    const pool = await this.pool(s, (text) => {
      started++;
      const now = Date.now();
      if (now - lastEdit < 1200) return;
      lastEdit = now;
      void this.api.editMessageText(chatId, status.message_id, `${friendly(text)}\n${bar(started, started + 4)}`).catch(() => {});
    });
    await this.api.deleteMessage(chatId, status.message_id).catch(() => {});
    await this.check(s, pool);
  }

  private current(s: ChatState, pool: CandidatePool): Solution {
    const c = sd(s).choice;
    return solve(pool, tripOf(s), s.squad, { priceFirst: c?.priceFirst, hotel: c?.hotelId ? pool.hotels.find((h) => h.id === c.hotelId) : undefined });
  }

  /** Checks every hard limit; asks about the first one that breaks, or moves on. */
  private async check(s: ChatState, pool: CandidatePool): Promise<void> {
    const sol = this.current(s, pool);
    const broken = problems(sol, s.squad);
    if (!broken.length) {
      // Everyone's limits are met: the group picks the stay once, then Milo builds the days.
      if (!sd(s).hotelVote?.done) return this.startHotelVote(s, pool, sol);
      s.stage = "planning";
      s.pending = [];
      const waived = s.squad.some((p) => p.constraints.some((c) => c.waived));
      s.decisions.push(`Everyone's hard limits met${waived ? " (with agreed exceptions)" : ""}`);
      await saveState(s);
      await this.milo.updateTripCard(s);
      return this.next(s.chatId, sol, pool);
    }

    const { member, check } = broken[0];
    s.stage = "negotiating";
    s.pending = [`${member.name} picks how to handle a limit`];
    await saveState(s);
    await this.milo.updateTripCard(s);

    if (check.constraint.kind === "budget") {
      const cap = check.constraint.max;
      const options = budgetCompromises(pool, tripOf(s), s.squad, sol, member, cap);
      sd(s).asking = { memberId: member.id, options };
      await saveState(s);
      const now = sol.costs.find((c) => c.person === member.name)!.total;
      const lines = options.map(
        (o, i) =>
          `<b>${letterAt(i)}</b>: ${esc(o.label)} → <b>${formatINR(o.total ?? 0)}</b>${o.stillOver ? ` <i>(still ${formatINR(o.stillOver)} over)</i>` : ""}${o.affects.length ? `\n     <i>changes the stay for ${esc(o.affects.join(", "))}</i>` : ""}`,
      );
      const kb = new InlineKeyboard();
      options.forEach((_, i) => kb.text(letterAt(i), `neg:${member.id}:${i}`));
      await this.milo.say(
        s.chatId,
        `💸 ${mention(member)}, ${esc(s.trip.destination ?? "")} comes to <b>${formatINR(now)}</b> for you, <b>${formatINR(now - cap)} over</b> your cap.\n\n${lines.join("\n")}\n\nYour call 🙂`,
        kb,
      );
      return;
    }

    // Any other hard limit that can't be met: the person can let it go.
    const options: Compromise[] = [{ key: "go_over", label: `Let this one go: ${check.evidence}`, affects: [], apply: { waive: "let this limit go" } }];
    sd(s).asking = { memberId: member.id, options };
    await saveState(s);
    await this.milo.say(s.chatId, `⚠️ ${mention(member)}, I can't meet one of your limits with what's available: ${esc(check.evidence)}.`, new InlineKeyboard().text("OK, let it go", `neg:${member.id}:0`));
  }

  // ---------- Buttons ----------

  private async onCallback(ctx: Context, s: ChatState): Promise<boolean> {
    const data = ctx.callbackQuery?.data ?? "";
    const tg = ctx.from!.id;
    const plan = s.data.plan as TripPlan | undefined;

    if (data.startsWith("neg:")) {
      const [, memberId, idx] = data.split(":");
      const ask = sd(s).asking;
      const member = s.squad.find((p) => p.id === memberId);
      if (!ask || ask.memberId !== memberId || !member) {
        await ctx.answerCallbackQuery({ text: "That question's done." });
        return true;
      }
      if (!actsFor(member, tg)) {
        await ctx.answerCallbackQuery({ text: `This one's for ${member.name}`, show_alert: true });
        return true;
      }
      const option = ask.options[Number(idx)];
      await ctx.answerCallbackQuery({ text: "Got it!" });
      sd(s).asking = undefined;
      // A change that affects others goes to a quick 👍/👎; a personal one just applies.
      if (option.affects.length) await this.quickVote(s, member, option);
      else await this.applyOption(s, member, option);
      return true;
    }

    if (data.startsWith("hv:")) {
      const [, id, idx] = data.split(":");
      const v = sd(s).hotelVote;
      if (!v || v.id !== id || v.done) {
        await ctx.answerCallbackQuery({ text: "The stay's already picked." });
        return true;
      }
      // A tap counts for whoever tapped; once they've voted, for a friend they added who hasn't.
      const mine = s.squad.filter((p) => actsFor(p, tg));
      if (!mine.length) {
        await ctx.answerCallbackQuery({ text: "Only the squad votes on this." });
        return true;
      }
      const voter =
        mine.find((p) => p.telegramUserId === tg && v.votes[p.id] === undefined) ??
        mine.find((p) => v.votes[p.id] === undefined) ??
        mine.find((p) => p.telegramUserId === tg) ??
        mine[0];
      v.votes[voter.id] = Number(idx);
      await ctx.answerCallbackQuery({ text: `${letter(Number(idx))} for ${voter.name} 👍` });
      await saveState(s);
      await this.settleHotelVote(s);
      return true;
    }

    if (data.startsWith("qv:")) {
      const [, id, dir] = data.split(":");
      const q = sd(s).quick;
      if (!q || q.id !== id || q.status !== "open") {
        await ctx.answerCallbackQuery({ text: "This one's settled." });
        return true;
      }
      const voter = s.squad.find((p) => actsFor(p, tg) && !q.up.includes(p.id) && !q.down.includes(p.id)) ?? s.squad.find((p) => actsFor(p, tg));
      if (!voter) {
        await ctx.answerCallbackQuery({ text: "Only the squad votes on this." });
        return true;
      }
      q.up = q.up.filter((x) => x !== voter.id);
      q.down = q.down.filter((x) => x !== voter.id);
      (dir === "up" ? q.up : q.down).push(voter.id);
      await ctx.answerCallbackQuery({ text: dir === "up" ? "👍 noted" : "👎 noted" });
      await this.settleQuick(s);
      return true;
    }

    if (data === "retry_plan") {
      if (s.stage !== "planning") {
        await ctx.answerCallbackQuery({ text: "Already done 👍" });
        return true;
      }
      await ctx.answerCallbackQuery({ text: "On it!" });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      const pool = await this.pool(s);
      await this.next(s.chatId, this.current(s, pool), pool);
      return true;
    }

    if (data === "booking" || data === "sources") {
      await ctx.answerCallbackQuery();
      if (!plan) return true;
      const messages = data === "booking" ? [bookingList(plan)] : sourcesMessages(plan);
      for (const m of messages) await this.milo.say(s.chatId, m);
      return true;
    }
    return false;
  }

  // ---------- Stay vote ----------

  private async startHotelVote(s: ChatState, pool: CandidatePool, sol: Solution): Promise<void> {
    const options = hotelOptions(pool, tripOf(s), s.squad, sd(s).choice?.priceFirst ?? []);
    const v: HotelVote = { id: randomBytes(3).toString("hex"), options, votes: {} };
    sd(s).hotelVote = v;
    if (options.length < 2) {
      // Nothing to choose between.
      v.done = true;
      if (options[0]) (sd(s).choice ??= { priceFirst: [] }).hotelId = options[0].hotelId;
      await saveState(s);
      return this.check(s, pool);
    }
    s.stage = "hotel_vote";
    s.pending = ["Everyone picks the stay"];
    await saveState(s);
    await this.milo.updateTripCard(s);

    // Flights first: everyone sees how they get there, then the group picks the stay.
    if (!sd(s).flightsShown) await this.showFlights(s, sol);
    await this.api.sendChatAction(s.chatId, "upload_photo").catch(() => {});
    const hotels = options.map((o) => pool.hotels.find((h) => h.id === o.hotelId)!);
    const card = hotelChoiceCard(
      hotels.map((h, i) => ({ number: i + 1, tag: options[i].label, name: h.name, photo: h.thumbnail, rating: h.rating, reviews: h.reviews, stars: h.stars, perNight: h.pricePerNight, each: options[i].each })),
      sol.nights,
      sol.rooms,
    );
    const png = (await renderCard(card)).png;
    const kb = new InlineKeyboard();
    for (const b of hotelButtons(v)) kb.text(b.text, b.data);
    const msg = await this.milo.send(s.chatId, () => this.api.sendPhoto(s.chatId, new InputFile(png, "stays.png"), { caption: hotelVoteText(v, pool.hotels, s.squad), parse_mode: "HTML", reply_markup: kb }));
    v.messageId = msg.message_id;
    await saveState(s);
  }

  private async showFlights(s: ChatState, sol: Solution) {
    const chatId = s.chatId;
    await this.api.sendChatAction(chatId, "upload_photo").catch(() => {});
    const png = (await renderCard(flightsHtml(s.trip.destination ?? "", sol.flights, sol.extraVsCheapest))).png;
    const clock = (t?: string) => t?.slice(11, 16) ?? "?";
    const rows = sol.flights.map((f) =>
      f.out
        ? `<b>${esc(f.person)}</b>: <code>${esc(f.out.from)} ${clock(f.out.departTime)} → ${esc(f.out.to)} ${clock(f.out.arriveTime)}</code>${f.back ? ` · back <code>${clock(f.back.departTime)}</code>` : ""}`
        : `<b>${esc(f.person)}</b>: no flight found`,
    );
    const w = sol.arrivalWindow;
    const spread = w ? Math.round((Date.parse(`${w.last.replace(" ", "T")}:00Z`) - Date.parse(`${w.first.replace(" ", "T")}:00Z`)) / 60_000) : undefined;
    const together =
      spread !== undefined && spread >= 0 && spread <= 120 ? ` · everyone lands within <b>${spread < 60 ? `${spread} min` : `${Math.floor(spread / 60)}h ${spread % 60}m`}</b>` : "";
    const caption = `✈️ <b>Your flights</b>${together}\n\n${rows.join("\n")}`.slice(0, 1024);
    await this.milo.send(chatId, () => this.api.sendPhoto(chatId, new InputFile(png, "flights.png"), { caption, parse_mode: "HTML" }));
    sd(s).flightsShown = true;
    await saveState(s);
  }

  private async settleHotelVote(s: ChatState) {
    const v = sd(s).hotelVote;
    if (!v || v.done) return;
    const pool = await this.pool(s);
    const win = hotelWinner(v, s.squad.length);
    if (win !== undefined) v.done = true;
    const kb = new InlineKeyboard();
    if (!v.done) for (const b of hotelButtons(v)) kb.text(b.text, b.data);
    if (v.messageId)
      await this.api.editMessageCaption(s.chatId, v.messageId, { caption: hotelVoteText(v, pool.hotels, s.squad), parse_mode: "HTML", reply_markup: v.done ? undefined : kb }).catch(() => {});
    if (win === undefined) {
      await saveState(s);
      return;
    }
    const pick = v.options[win];
    const hotel = pool.hotels.find((h) => h.id === pick.hotelId);
    (sd(s).choice ??= { priceFirst: [] }).hotelId = pick.hotelId;
    s.decisions.push(`Stay: ${hotel?.name ?? "?"}`);
    await saveState(s);
    await this.milo.say(s.chatId, `🏨 Going with <b>${esc((hotel?.name ?? "").replace(/[.\s]+$/, ""))}</b>! Building your days now…`);
    await this.check(s, pool);
  }

  // ---------- Compromises ----------

  /** A fix that changes the stay for everyone: before/after in ₹ and a quick 👍/👎. */
  private async quickVote(s: ChatState, member: SquadMember, option: Compromise) {
    const pool = await this.pool(s);
    const before = this.current(s, pool);
    const after = solve(pool, tripOf(s), s.squad, {
      priceFirst: option.apply.priceFirst ?? sd(s).choice?.priceFirst,
      hotel: option.apply.hotelId ? pool.hotels.find((h) => h.id === option.apply.hotelId) : before.hotel,
    });
    const total = (sol: Solution, name: string) => sol.costs.find((c) => c.person === name)?.total ?? 0;
    const diff = (name: string) => total(after, name) - total(before, name);
    const q = { ...newQuickVote(randomBytes(3).toString("hex"), s.squad, Date.now()), option, by: member.id };
    q.up.push(member.id);
    sd(s).quick = q;
    await saveState(s);
    const changes = option.affects.map((n) => `${n} ${diff(n) <= 0 ? `saves ${formatINR(-diff(n))}` : `pays ${formatINR(diff(n))} more`}`).join(", ");
    await this.milo.say(s.chatId, `🏨 ${esc(member.name)} picked a cheaper stay. ${esc(changes)}.\nOK? 👍`, new InlineKeyboard().text("👍", `qv:${q.id}:up`).text("👎", `qv:${q.id}:down`));
    await this.settleQuick(s);
  }

  private async settleQuick(s: ChatState) {
    const q = sd(s).quick;
    if (!q) return;
    const status = quickTick(q, Date.now());
    await saveState(s);
    if (status === "open") return;
    const member = s.squad.find((p) => p.id === q.by)!;
    sd(s).quick = undefined;
    if (status === "passed") {
      await this.milo.say(s.chatId, "✅ Going with it.");
      return this.applyOption(s, member, q.option);
    }
    await this.milo.say(s.chatId, `👎 Most of you said no, so the stay stays as it is. ${esc(member.name)}, here are your other options:`);
    await this.check(s, await this.pool(s));
  }

  private async applyOption(s: ChatState, member: SquadMember, o: Compromise) {
    const choice = (sd(s).choice ??= { priceFirst: [] });
    if (o.apply.priceFirst) choice.priceFirst = o.apply.priceFirst;
    if (o.apply.hotelId) choice.hotelId = o.apply.hotelId;
    const pool = await this.pool(s);
    if (o.apply.waive) {
      // Record the person's explicit OK on the limit that's breaking.
      const broken = problems(this.current(s, pool), s.squad).find((x) => x.member.id === member.id);
      const c = broken && member.constraints.find((x) => x.id === broken.check.constraint.id);
      if (c) c.waived = o.apply.waive;
    }
    s.decisions.push(`${member.name}: ${o.label}`);
    await saveState(s);
    await this.check(s, pool);
  }

  // ---------- Itinerary ----------

  private async itinerary(chatId: number, sol: Solution, pool: CandidatePool) {
    const s = await loadState(chatId);
    await this.api.sendChatAction(chatId, "typing").catch(() => {});
    const status = await this.milo.say(chatId, `🗺 Planning your trip…\n${bar(1, 5)}`);
    let step = 1;
    let plan: TripPlan;
    try {
      plan = await planTrip(pool, tripOf(s), sol, s.squad, {
        onProgress: (text) => void this.api.editMessageText(chatId, status.message_id, `${friendly(text)}\n${bar(++step, 5)}`).catch(() => {}),
      });
    } catch (err) {
      // Never go silent: say so and let the group retry (searches are cached, so a retry is free).
      console.error(`planning failed in ${chatId}:`, (err as Error).message);
      await this.api.deleteMessage(chatId, status.message_id).catch(() => {});
      await this.milo.say(chatId, "😕 I hit a snag building your days. Tap to try again 👇", new InlineKeyboard().text("Try again 🔁", "retry_plan"));
      return;
    }
    await this.api.deleteMessage(chatId, status.message_id).catch(() => {});
    s.data.plan = plan;
    s.stage = "done";
    s.decisions.push(`Plan ready: ${plan.title}`);
    s.pending = [];
    await saveState(s);
    await postPlan(this.milo, s, plan);
    await this.milo.updateTripCard(s);
  }
}
