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
