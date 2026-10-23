// Renders the latest simulated plan's day cards and boarding passes to a folder (no API calls).
// Usage: npx tsx scripts/render-plan.ts [out-dir]
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dayData } from "../src/bot/postplan.js";
import { passHtml } from "../src/bot/render.js";
import type { ChatState } from "../src/bot/state.js";
import { closeRenderer, renderCard } from "../src/cards/render.js";
import * as t from "../src/cards/templates.js";
import { checkPerson } from "../src/core/constraints.js";
import type { TripPlan } from "../src/core/planner.js";

const out = process.argv[2] ?? "/tmp/milo-plan";
await mkdir(out, { recursive: true });
const dir = path.join(process.env.MILO_DATA_DIR ?? ".data-sim", "chats");
const states = await Promise.all((await readdir(dir)).map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as ChatState));
const s = states.find((x) => x.data.plan);
if (!s) throw new Error("No plan found. Run npm run simulate first.");
const plan = s.data.plan as TripPlan;
for (const [i, d] of plan.days.entries()) {
  const data = dayData(d, i, plan);
  await writeFile(path.join(out, `day-${i + 1}.png`), (await renderCard(t.dayCard(data), () => t.dayCard(data, { withMap: false }))).png);
}
const sol = plan.solution;
const forCheck = { startDate: plan.trip.startDate, endDate: plan.trip.endDate, flights: sol.flights, costs: sol.costs, hotel: sol.hotel, days: plan.days };
for (const [i, p] of s.squad.entries()) {
  const html = passHtml(p, i, sol.flights.find((f) => f.person === p.name), sol.costs.find((c) => c.person === p.name), checkPerson(forCheck, p), plan.trip, sol.hotel?.name);
  await writeFile(path.join(out, `pass-${p.name.toLowerCase()}.png`), (await renderCard(html)).png);
}
await closeRenderer();
console.log(`Wrote ${plan.days.length} day cards and ${s.squad.length} boarding passes to ${out}`);
