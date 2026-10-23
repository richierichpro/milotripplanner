import { AVATAR_COLORS, CARD_WIDTH, DAY_COLORS, baseCss, colors, fontsCss, leafletAssets, radius } from "./theme.js";

// Every card is plain HTML + CSS built from the web app's tokens. Templates only
// lay out the data they're given; they never add facts of their own.

export { CARD_WIDTH };

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const rupees = (n: number) => `₹${inr.format(Math.round(n))}`;

const initial = (name: string) => esc(name.trim().slice(0, 1).toUpperCase());
const avatar = (name: string, i: number, size = 52) =>
  `<span style="display:inline-grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;border:3px solid ${colors.sand};background:${AVATAR_COLORS[i % AVATAR_COLORS.length]};color:#fff;font-weight:700;font-size:${Math.round(size * 0.42)}px">${initial(name)}</span>`;

const proof = (text: string) => `<p style="margin-top:8px;font-size:19px;color:${colors.muted};font-style:italic">${esc(text)}</p>`;
const rowBorder = (i: number) => (i ? `border-top:2px solid ${colors.line}` : "");

/**
 * Wraps a card body in a full page. The closing script sets window.__ready once
 * images (and the map, if any) have loaded, with a 9 s safety net.
 */
export function page(body: string, opts: { title?: string; map?: string; extraCss?: string } = {}): string {
  const lf = opts.map ? leafletAssets() : undefined;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title ?? "Milo")}</title>
<style>${fontsCss()}${baseCss}${lf ? lf.css : ""}${opts.extraCss ?? ""}</style></head>
<body>${body}
<div class="brand"><b>Milo</b><span>planned in your group chat</span></div>
${lf ? `<script>${lf.js}</script>` : ""}
<script>
(function(){
  var imgs=[].slice.call(document.images);
  var imgsDone=Promise.all(imgs.map(function(im){return im.complete?Promise.resolve():new Promise(function(r){im.onload=r;im.onerror=function(){im.style.visibility="hidden";r()}})}));
  var mapDone=Promise.resolve(true);
  ${opts.map ?? ""}
  Promise.race([Promise.all([imgsDone,mapDone]),new Promise(function(r){setTimeout(r,9000)})]).then(function(){document.fonts.ready.then(function(){window.__ready=true})});
})();
</script></body></html>`;
}

// ---------- Heard: everyone's limits ----------

export type HeardRow = { name: string; city?: string; chips: { label: string; hard: boolean }[] };

function chip(c: { label: string; hard: boolean }): string {
  return c.hard
    ? `<span class="pill" style="background:${colors.teal};color:#fff">🔒 ${esc(c.label)}</span>`
    : `<span class="pill" style="background:${colors.sandDeep};color:${colors.ink}">${esc(c.label)}</span>`;
}

export function heardCard(rows: HeardRow[]): string {
  const people = rows
    .map(
      (r, i) => `
  <div style="display:flex;gap:20px;padding:22px 26px;${rowBorder(i)}">
    ${avatar(r.name, i, 60)}
    <div style="flex:1;min-width:0">
      <p style="font-size:28px;font-weight:600">${esc(r.name)}${r.city ? ` <span class="muted" style="font-weight:400">· ${esc(r.city)}</span>` : ""}</p>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px">${
        r.chips.length ? r.chips.map(chip).join("") : `<span class="pill muted" style="border:2px dashed ${colors.line}">no limits</span>`
      }</div>
    </div>
  </div>`,
    )
    .join("");
  const body = `
<p class="eyebrow">The squad</p>
<h1 class="display" style="font-size:52px;line-height:1.1;margin:6px 0 24px">Everyone's plans, in one place</h1>
<div class="card">${people}
</div>
<p class="muted" style="margin-top:16px;font-size:20px">🔒 = a hard limit Milo will never break without that person's OK</p>`;
  return page(body, { title: "Heard" });
}

// ---------- Destination shortlist ----------

export type ShortlistOption = {
  name: string;
  thumbnail?: string;
  each: number;
  perPerson: { person: string; total: number; within: boolean }[];
  hotelNote?: string;
  mentioned?: boolean;
};

function postcard(o: ShortlistOption, i: number): string {
  const fit = o.perPerson.filter((p) => p.within).length;
  const allFit = fit === o.perPerson.length;
  const people = o.perPerson
    .map((p) => `<span class="pill" style="font-size:20px;border:2px solid ${p.within ? colors.line : "#f3c3b6"};color:${p.within ? colors.ink : colors.coral}">${esc(p.person)} ${rupees(p.total)}</span>`)
    .join("");
  return `
  <div class="card">
    <div style="position:relative">
      ${o.thumbnail ? `<img class="photo" src="${esc(o.thumbnail)}" style="width:100%;height:230px">` : `<div class="photo" style="height:230px"></div>`}
      <span class="pill" style="position:absolute;left:14px;top:14px;background:rgba(255,255,255,.92);color:${colors.teal};font-weight:700">#${i + 1}${o.mentioned ? " · from your chat" : ""}</span>
    </div>
    <div style="padding:18px 22px 22px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
        <p class="display" style="font-size:40px">${esc(o.name)}</p>
        <p style="font-size:26px;font-weight:600;color:${colors.teal}">≈ ${rupees(o.each)} each</p>
      </div>
      <p style="margin-top:8px"><span class="pill" style="background:${allFit ? "#e6f2ec" : "#fbe9e4"};color:${allFit ? colors.ok : colors.coral}">${fit}/${o.perPerson.length} within budget</span></p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">${people}</div>
      ${o.hotelNote ? `<p class="muted" style="margin-top:10px;font-size:19px">${esc(o.hotelNote)}</p>` : ""}
    </div>
  </div>`;
}

export function shortlistCard(options: ShortlistOption[], note: string): string {
  const body = `
<p class="eyebrow">Where can everyone go?</p>
<h1 class="display" style="font-size:52px;line-height:1.1;margin:6px 0 24px">Your shortlist</h1>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:22px">${options.map(postcard).join("")}
</div>
${proof(note)}`;
  return page(body, { title: "Shortlist" });
}

// ---------- Vote and Decided ----------

export type VoteOption = { label: string; sub?: string; votes: number; voters: string[]; needsOk?: string; blocked?: boolean };

export function voteCard(question: string, options: VoteOption[], footer: string): string {
  const max = Math.max(1, ...options.map((o) => o.votes));
  const rows = options
    .map(
      (o, i) => `
  <div style="padding:22px 26px;${rowBorder(i)};${o.blocked ? "opacity:.45" : ""}">
    <div style="display:flex;justify-content:space-between;gap:16px;align-items:baseline">
      <p style="font-size:30px;font-weight:600">${String.fromCharCode(65 + i)} · ${esc(o.label)}</p>
      <p style="font-size:28px;font-weight:700;color:${colors.teal}">${o.votes}</p>
    </div>
    ${o.sub ? `<p class="muted" style="font-size:22px;margin-top:4px">${esc(o.sub)}</p>` : ""}
    ${o.needsOk ? `<p style="font-size:22px;margin-top:6px;color:${colors.coral}">⚠ needs ${esc(o.needsOk)}'s OK</p>` : ""}
    <div style="height:12px;border-radius:9999px;background:${colors.sandDeep};margin-top:12px;overflow:hidden"><div style="height:100%;width:${(o.votes / max) * 100}%;background:${colors.marigold}"></div></div>
    <p class="muted" style="font-size:20px;margin-top:8px">${o.voters.length ? esc(o.voters.join(" · ")) : "no votes yet"}</p>
  </div>`,
    )
    .join("");
  const body = `
<p class="eyebrow">🗳 Squad vote</p>
<h1 class="display" style="font-size:50px;line-height:1.1;margin:6px 0 24px">${esc(question)}</h1>
<div class="card">${rows}
</div>
${proof(footer)}`;
  return page(body, { title: "Vote" });
}

export function decidedCard(question: string, winner: string, detail: string, reason: string): string {
  const body = `
<p class="eyebrow">✅ Decided</p>
<p class="muted" style="font-size:26px;margin-top:6px">${esc(question)}</p>
<div class="card" style="margin-top:20px;padding:34px 36px;border-color:${colors.teal}">
  <p class="display" style="font-size:72px;line-height:1.05;color:${colors.teal}">${esc(winner)}</p>
  <p style="font-size:26px;margin-top:10px">${esc(detail)}</p>
</div>
${proof(reason)}`;
  return page(body, { title: "Decided" });
}

// ---------- Plan header ----------

export type HeaderData = {
  title: string;
  destination: string;
  dates: string;
  perPerson: number;
  summary: string;
  squad: string[];
  verified: { verified: number; total: number };
  searches: number;
};

export function headerCard(h: HeaderData): string {
  const allOk = h.verified.verified === h.verified.total;
  const body = `
<p class="eyebrow">${esc(h.destination)} · ${esc(h.dates)}</p>
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-top:6px">
  <h1 class="display" style="font-size:56px;line-height:1.08;flex:1">${esc(h.title)}</h1>
  <div style="text-align:right">
    <p class="display" style="font-size:56px;color:${colors.teal};line-height:1">${rupees(h.perPerson)}</p>
    <p class="muted" style="font-size:20px">per person, on average</p>
  </div>
</div>
<p style="font-size:24px;line-height:1.45;margin-top:16px;color:#3b4747">${esc(h.summary)}</p>
<div style="display:flex;align-items:center;gap:18px;margin-top:22px;flex-wrap:wrap">
  <div style="display:flex">${h.squad.map((n, i) => `<span style="margin-left:${i ? -12 : 0}px">${avatar(n, i)}</span>`).join("")}</div>
  <span class="pill" style="background:${allOk ? "#e6f2ec" : "#fbe9e4"};color:${allOk ? colors.ok : colors.coral};font-weight:600">✓ ${h.verified.verified}/${h.verified.total} verified with live Google data</span>
  <span class="pill" style="background:${colors.white};border:2px solid ${colors.line}">${h.searches} searches</span>
</div>`;
  return page(body, { title: "Plan" });
}

// ---------- Flights and the arrival timeline ----------

export type FlightLeg = { from: string; to: string; depart: string; arrive: string; nextDay: boolean; airline: string; logo?: string; duration: string; stops: string; price: number; numbers: string };
export type FlightRow = { person: string; city: string; out?: FlightLeg; back?: FlightLeg; checked?: string };
export type ArrivalDot = { person: string; time: string; minutes: number; airport: string };

function legRow(l: FlightLeg | undefined, label: string): string {
  if (!l) return `<p class="muted" style="font-size:22px">${label}: couldn't check this</p>`;
  return `<div style="display:flex;align-items:center;gap:12px;font-size:23px;margin-top:6px">
    <span class="muted" style="width:60px;font-size:18px;letter-spacing:.08em;text-transform:uppercase">${label}</span>
    ${l.logo ? `<img src="${esc(l.logo)}" style="width:28px;height:28px;border-radius:6px">` : ""}
    <span style="font-weight:600">${esc(l.from)} ${esc(l.depart)} → ${esc(l.to)} ${esc(l.arrive)}${l.nextDay ? `<sup style="color:${colors.coral}">+1</sup>` : ""}</span>
    <span class="muted">· ${esc(l.duration)} · ${esc(l.stops)}</span>
    <span style="margin-left:auto;font-weight:600">${rupees(l.price)}</span>
  </div>`;
}

/** Arrival dots on a bar with the window highlighted; labels stack into rows so none overlap. */
function arrivalTimeline(arrivals: ArrivalDot[], window: { headline: string; sub: string; warning?: string }): string {
  const lo = Math.min(...arrivals.map((a) => a.minutes)) - 60;
  const hi = Math.max(...arrivals.map((a) => a.minutes)) + 60;
  const pct = (m: number) => ((m - lo) / Math.max(1, hi - lo)) * 100;
  const LABEL = 24;
  const rowEnds: number[] = [];
  const labelRow: number[] = [];
  for (const { p, i } of arrivals.map((a, i) => ({ p: pct(a.minutes), i })).sort((x, y) => x.p - y.p)) {
    let r = rowEnds.findIndex((end) => p - LABEL / 2 >= end);
    if (r < 0) r = rowEnds.push(0) - 1;
    rowEnds[r] = p + LABEL / 2;
    labelRow[i] = r;
  }
  const lines = Math.max(1, ...labelRow.map((r) => r + 1));
  const first = Math.min(...arrivals.map((a) => a.minutes));
  const last = Math.max(...arrivals.map((a) => a.minutes));
  const dots = arrivals
    .map((a) => `<div style="position:absolute;left:${pct(a.minutes)}%;top:-7px;width:28px;height:28px;margin-left:-14px;border-radius:50%;border:4px solid #fff;background:${colors.teal};box-shadow:0 1px 4px rgba(0,0,0,.25)"></div>`)
    .join("");
  const labels = arrivals
    .map((a, i) => `<p style="position:absolute;white-space:nowrap;transform:translateX(-50%);left:${Math.min(88, Math.max(12, pct(a.minutes)))}%;top:${labelRow[i] * 30}px;font-size:20px"><b>${esc(a.person)}</b> ${esc(a.time)} <span class="muted">${esc(a.airport)}</span></p>`)
    .join("");
  return `<div class="card" style="padding:24px 28px;margin-bottom:22px">
    <p style="font-size:26px;font-weight:600">${esc(window.headline)} <span class="muted" style="font-weight:400">· ${esc(window.sub)}</span></p>
    ${window.warning ? `<p style="font-size:22px;font-weight:600;color:${colors.coral};margin-top:6px">⚠ ${esc(window.warning)}</p>` : ""}
    <div style="position:relative;height:14px;border-radius:9999px;background:${colors.sandDeep};margin-top:30px">
      <div style="position:absolute;top:0;bottom:0;left:${pct(first)}%;right:${100 - pct(last)}%;border-radius:9999px;background:rgba(240,162,2,.5)"></div>
      ${dots}
    </div>
    <div style="position:relative;height:${lines * 30}px;margin-top:16px">${labels}</div>
  </div>`;
}

export function flightsCard(destination: string, rows: FlightRow[], arrivals: ArrivalDot[], window?: { headline: string; sub: string; warning?: string }): string {
  const people = rows
    .map(
      (r, i) => `
  <div style="padding:20px 26px;${rowBorder(i)}">
    <p style="font-size:24px"><b>${esc(r.person)}</b> <span class="muted">· ${esc(r.city)} → ${esc(destination)}</span></p>
    ${legRow(r.out, "Out")}
    ${legRow(r.back, "Back")}
    ${r.out ? proof(`Google Flights · ${r.out.numbers}${r.checked ? ` · checked ${r.checked}` : ""}`) : ""}
  </div>`,
    )
    .join("");
  const body = `
<p class="eyebrow">✈️ Flights</p>
<h1 class="display" style="font-size:48px;margin:6px 0 22px">Everyone to ${esc(destination)}</h1>
${arrivals.length > 1 && window ? arrivalTimeline(arrivals, window) : ""}
<div class="card">${people}
</div>`;
  return page(body, { title: "Flights" });
}

// ---------- Hotel ----------

export type HotelData = {
  name: string;
  photo?: string;
  stars?: number;
  rating?: number;
  reviews?: number;
  perNight?: number;
  rooms: number;
  nights: number;
  distanceKm?: number;
  checkIn?: string;
  checkOut?: string;
  amenities: string[];
  checked?: string;
};

const ratingHtml = (rating?: number, reviews?: number) =>
  rating ? `<span><span style="color:${colors.marigold}">★</span> ${rating.toFixed(1)}${reviews ? ` <span class="muted">(${inr.format(reviews)})</span>` : ""}</span>` : "";
const starsHtml = (stars?: number) => (stars ? `<span class="muted">${"★".repeat(stars)} hotel</span>` : "");
const photoBox = (src: string | undefined, style: string) => (src ? `<img class="photo" src="${esc(src)}" style="${style}">` : `<div class="photo" style="${style}"></div>`);
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

export function hotelCard(h: HotelData): string {
  const body = `
<p class="eyebrow">🏨 Where you'll stay</p>
<div class="card" style="display:flex;margin-top:18px">
  ${photoBox(h.photo, "width:360px;min-height:300px")}
  <div style="flex:1;min-width:0;padding:26px 28px">
    <p class="display" style="font-size:38px;line-height:1.15">${esc(h.name)}</p>
    <p style="font-size:23px;margin-top:8px;display:flex;gap:14px;flex-wrap:wrap">${starsHtml(h.stars)}${ratingHtml(h.rating, h.reviews)}</p>
    <p style="font-size:24px;margin-top:10px"><b>${h.perNight ? rupees(h.perNight) : "–"}</b><span class="muted"> /night · ${plural(h.rooms, "room")} × ${h.nights} nights</span></p>
    ${h.distanceKm !== undefined ? `<p class="muted" style="font-size:22px;margin-top:8px">📍 ≈ ${h.distanceKm < 1 ? "<1" : Math.round(h.distanceKm)} km from most of your plan</p>` : ""}
    ${h.checkIn || h.checkOut ? `<p class="muted" style="font-size:22px;margin-top:6px">Check-in ${esc(h.checkIn ?? "not listed")} · check-out ${esc(h.checkOut ?? "not listed")}</p>` : ""}
    ${h.amenities.length ? `<p class="muted" style="font-size:20px;margin-top:8px">${esc(h.amenities.slice(0, 4).join(" · "))}</p>` : ""}
    ${proof(`Google Hotels${h.checked ? ` · checked ${h.checked}` : ""}`)}
  </div>
</div>`;
  return page(body, { title: "Hotel" });
}

// ---------- Hotel choice: three stays on one card ----------

export type HotelChoice = { number: number; tag: string; name: string; photo?: string; rating?: number; reviews?: number; stars?: number; perNight?: number; each: number };

export function hotelChoiceCard(options: HotelChoice[], nights: number, rooms: number): string {
  const rows = options
    .map(
      (h) => `
<div class="card" style="display:flex;margin-top:18px">
  ${photoBox(h.photo, "width:260px;min-height:210px")}
  <div style="flex:1;min-width:0;padding:20px 26px">
    <p style="font-size:22px;letter-spacing:.08em;text-transform:uppercase" class="muted"><b style="color:${colors.teal}">${h.number}</b> · ${esc(h.tag)}</p>
    <p class="display" style="font-size:32px;line-height:1.15;margin-top:4px">${esc(h.name)}</p>
    <p style="font-size:22px;margin-top:6px;display:flex;gap:14px;flex-wrap:wrap">${starsHtml(h.stars)}${ratingHtml(h.rating, h.reviews)}</p>
    <p style="font-size:23px;margin-top:8px"><b>${h.perNight ? rupees(h.perNight) : "–"}</b><span class="muted"> /night</span> · <b>≈ ${rupees(h.each)}</b><span class="muted"> each, all in</span></p>
  </div>
</div>`,
    )
    .join("");
  const body = `
<p class="eyebrow">🏨 Pick your stay</p>
<h1 class="display" style="font-size:46px;line-height:1.1;margin:6px 0 4px">Three stays that fit everyone</h1>
<p class="muted" style="font-size:22px">${plural(rooms, "room")} × ${nights} nights · "each" = flights + your share of the room</p>
${rows}
${proof("Google Hotels")}`;
  return page(body, { title: "Pick your stay" });
}
