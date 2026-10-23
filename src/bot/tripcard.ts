import { InlineKeyboard } from "grammy";
import { esc } from "../cards/templates.js";
import { dateRange } from "./render.js";
import type { ChatState, Stage } from "./state.js";

// The Trip card: stage, squad, decisions and what's pending, edited in place.

const STAGE_LABEL: Record<Stage, string> = {
  intro: "Getting started",
  listening: "👂 Listening",
  heard: "✅ Checking what I heard",
  questions: "❓ A few questions",
  destination_vote: "🗳 Picking where to go",
  solving: "🔎 Searching within everyone's limits",
  negotiating: "🤝 Sorting out a limit",
  hotel_vote: "🏨 Picking the stay",
  planning: "🗺 Building the plan",
  done: "🎉 Plan ready",
};

export function tripCardText(s: ChatState): string {
  const squad = s.squad.length ? s.squad.map((p) => `<b>${esc(p.name)}</b>${p.city ? ` (${esc(p.city)})` : ""}`).join(" · ") : "<i>nobody yet: just say you're in</i>";
  const lines = [`🧳 <b>Trip card</b> · ${STAGE_LABEL[s.stage]}${s.paused ? " · ⏸ paused" : ""}`, "", `👥 ${squad}`];
  if (s.trip.destination || s.trip.startDate) {
    const where = s.trip.destination ? `<b>${esc(s.trip.destination)}</b>` : "<i>where: not decided</i>";
    const when = s.trip.startDate && s.trip.endDate ? ` · <code>${esc(dateRange(s.trip.startDate, s.trip.endDate))}</code>` : "";
    lines.push(`📍 ${where}${when}`);
  }
  if (s.decisions.length) lines.push("", "✅ <b>Decided</b>", ...s.decisions.map((d) => `• ${esc(d)}`));
  if (s.pending.length) lines.push("", "⏳ <b>Pending</b>", ...s.pending.map((p) => `• ${esc(p)}`));
  return lines.join("\n");
}

/** The next step's button, plus Pause/Resume. */
export function tripCardKeyboard(s: ChatState, ready: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (!s.listening && s.stage === "intro") kb.text("Plan a trip ✈️", "plan_trip").row();
  else if (s.stage === "listening" && ready) kb.text("Plan it now 🗺", "plan_now").row();
  kb.text(s.paused ? "▶️ Resume Milo" : "⏸ Pause Milo", s.paused ? "resume" : "pause");
  return kb;
}
