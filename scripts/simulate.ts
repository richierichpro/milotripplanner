// Plays the demo through Milo's real handlers with a fake Telegram, using only
// natural-language chat and button taps, and prints the conversation.
// Usage: npm run simulate   (DEMO_MODE=true npm run simulate needs no keys)
import { createMilo } from "../src/bot/index.js";
import { FakeTelegram, FAKE_BOT, type Sent } from "../src/bot/fake.js";
import { loadState } from "../src/bot/state.js";
import { closeRenderer } from "../src/cards/render.js";
import { DEMO_CHAT } from "../src/core/demo.js";

process.env.MILO_TODAY ??= "2026-10-11";
// Keep the simulator's fake chat away from the real bot's .data/.
process.env.MILO_DATA_DIR ??= ".data-sim";
process.env.MESSAGE_GAP_MS ??= "0";
process.env.SERPAPI_OFFLINE ??= process.env.DEMO_MODE === "true" ? "false" : "true";

const people = Object.fromEntries(["Aarav", "Meera", "Kabir", "Ishita"].map((n, i) => [n, { id: 1001 + i, name: n }]));
const user = (name: string) => people[name];
const homes: Record<string, string> = { Aarav: "Hyderabad", Meera: "Bengaluru", Kabir: "Delhi", Ishita: "Pune" };

const tg = new FakeTelegram();
const { bot, milo, flow, edits } = createMilo("0:sim", { botInfo: FAKE_BOT, quietMs: 60_000 });
bot.api.config.use(tg.transformer());

// ---------- Printing ----------

const strip = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const indent = (s: string) => s.replace(/\n/g, "\n          ");

let shown = 0;
function print() {
  for (const s of tg.sent.slice(shown) as Sent[]) {
    const p = s.payload;
    const buttons = (p.reply_markup as { inline_keyboard?: { text: string }[][] } | undefined)?.inline_keyboard?.flat().map((b) => `[${b.text}]`).join(" ");
    const caption = String(p.caption ?? (p.media as { caption?: string }[] | undefined)?.[0]?.caption ?? "");
    if (s.method === "sendMessage") console.log(`🤖 Milo: ${indent(strip(String(p.text)))}${buttons ? `\n          ${buttons}` : ""}`);
    else if (s.method === "editMessageText") console.log(`🤖 (edits msg ${p.message_id}) ${strip(String(p.text)).split("\n")[0]}…`);
    else if (s.method === "editMessageCaption") console.log(`🤖 (updates card ${p.message_id}) ${indent(strip(String(p.caption)))}`);
    else if (s.method === "deleteMessage") console.log(`🤖 (deletes msg ${p.message_id})`);
    else if (s.method === "setMessageReaction") console.log(`🤖 reacts 👀 to msg ${p.message_id}`);
    else if (s.method === "sendPhoto") console.log(`🤖 [card] ${strip(caption)}`);
    else if (s.method === "sendMediaGroup") console.log(`🤖 [album of ${(p.media as unknown[]).length} cards] ${strip(caption)}`);
    else if (s.method === "answerCallbackQuery" && p.text) console.log(`   (pop-up: ${p.text})`);
    else if (s.method === "pinChatMessage") console.log("🤖 pins the Trip card");
  }
  shown = tg.sent.length;
}

/** Buttons Milo sent, newest first. */
function buttons(): { data: string; text: string; messageId?: number }[] {
  const out: { data: string; text: string; messageId?: number }[] = [];
  for (let i = tg.sent.length - 1; i >= 0; i--) {
    const s = tg.sent[i];
    const kb = (s.payload.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard;
    for (const b of kb?.flat() ?? []) if (b.callback_data) out.push({ data: b.callback_data, text: b.text, messageId: s.messageId ?? (s.payload.message_id as number) });
  }
  return out;
}

async function tapButton(who: string, match: (b: { data: string; text: string }) => boolean, note = "") {
  const b = buttons().find(match);
  if (!b) throw new Error(`No button for ${who}`);
  console.log(`👆 ${who} taps [${b.text}]${note ? ` ${note}` : ""}`);
  await tg.tap(bot, user(who), b.data, b.messageId);
  print();
}

async function say(who: string, text: string) {
  console.log(`💬 ${who}: ${text}`);
  await tg.say(bot, user(who), text);
}

// ---------- The demo ----------

console.log("— Aarav adds Milo to the group —");
await tg.addBot(bot, user("Aarav"));
print();
console.log("\n— Aarav taps [Plan a trip ✈️] —");
await tg.tap(bot, user("Aarav"), "plan_trip");
print();

console.log("\n— The chat —");
for (const line of DEMO_CHAT) await say(line.from, line.text);
await milo.flushAll();
print();
if (!(await loadState(tg.chatId)).squad.length) {
  console.log("\n✗ Listening needs Claude: add ANTHROPIC_API_KEY to .env.local, or record the demo with npm run record-demo.");
  await closeRenderer();
  process.exit(1);
}

// Answer whatever Milo asks: cities from the demo squad, no extra budgets, food by tap.
for (let i = 0; i < 16; i++) {
  const st = await loadState(tg.chatId);
  const q = (st.data as { question?: { memberId: string; kind: string; pending?: string[] } }).question;
  if (!q) break;
  if (q.memberId === "all") {
    const who = st.squad.find((p) => p.id === q.pending![0])!.name;
    if (q.kind === "budget") {
      await say(who, "no limit");
      print();
    } else await tapButton(who, (b) => b.data === (who === "Kabir" ? "q:all:nonveg" : "q:all:none"));
    continue;
  }
  const who = st.squad.find((p) => p.id === q.memberId)!.name;
  await tapButton(who, (b) => b.data === `q:${q.memberId}:${q.kind === "city" ? homes[who] : "none"}`);
}

console.log("\n— Meera tries to fix Kabir's row —");
await tapButton("Meera", (b) => b.data.startsWith("fix:") && b.text.includes("Kabir"));
console.log("\n— Aarav confirms —");
await tapButton("Aarav", (b) => b.data === "heard_ok");

console.log("\n— The vote —");
for (const who of ["Aarav", "Meera", "Kabir", "Ishita"]) {
  const st = await loadState(tg.chatId);
  if (!(st.data as { vote?: { status: string } }).vote || (st.data as { vote?: { status: string } }).vote?.status === "closed") break;
  await tapButton(who, (b) => b.data.startsWith("v:") && / · Goa · /.test(b.text));
}

console.log("\n— Solving within everyone's limits —");
type SolveState = { asking?: { memberId: string }; quick?: { status: string }; hotelVote?: { done?: boolean } };
for (let i = 0; i < 6; i++) {
  const st = await loadState(tg.chatId);
  const sv = st.data.solve as SolveState | undefined;
  if (sv?.hotelVote && !sv.hotelVote.done) {
    // Three of four tap 1, Ishita taps 2.
    for (const [who, pick] of [["Aarav", 0], ["Meera", 0], ["Ishita", 1], ["Kabir", 0]] as const) {
      if (((await loadState(tg.chatId)).data.solve as SolveState | undefined)?.hotelVote?.done) break;
      await tapButton(who, (b) => b.data.startsWith("hv:") && b.data.endsWith(`:${pick}`));
    }
    continue;
  }
  if (sv?.asking) {
    const who = st.squad.find((p) => p.id === sv.asking!.memberId)!.name;
    await tapButton(who, (b) => b.data === `neg:${sv.asking!.memberId}:0`, "(the option that fits her cap)");
    continue;
  }
  if (sv?.quick?.status === "open") {
    for (const who of ["Aarav", "Meera"]) await tapButton(who, (b) => b.data.startsWith("qv:") && b.data.endsWith(":up"));
    continue;
  }
  break;
}

console.log("\n— After the plan, the chat asks for a change —");
await say("Kabir", "add a spa session on day 3 pls");
await say("Meera", "haha yes");
await edits.flush(tg.chatId);
print();

const state = await loadState(tg.chatId);
console.log("\n— What Milo stored (limits only, no message text) —");
for (const p of state.squad) {
  const limits = p.constraints.map(
    (c) =>
      `${c.hard ? "🔒" : ""}${c.kind}${"max" in c ? ` ${c.max}` : ""}${"diet" in c ? ` ${c.diet}` : ""}${"notBefore" in c && c.notBefore ? ` ≥${c.notBefore}${c.date ? ` on ${c.date}` : ""}` : ""}${"what" in c ? ` "${c.what}"` : ""}`,
  );
  console.log(`${p.name}${p.city ? ` (${p.city})` : ""}: ${limits.join(", ")}`);
}
console.log(`trip ${JSON.stringify(state.trip)} · mentioned ${state.mentioned.join(", ")} · stage ${state.stage}`);

flow.stopClock();
await closeRenderer();
process.exit(0);
