import { expect, test } from "vitest";
import { airportSplitNote, pickSquadFlights } from "../src/core/squad.js";
import type { Constraint, Flight } from "../src/core/types.js";

const src = { engine: "google_flights", fetchedAt: "2026-10-09T00:00:00Z" };
const f = (id: string, depart: string, arrive: string, price: number, extra: Partial<Flight> = {}): Flight => ({
  id, source: src, from: "X", to: "GOI", departTime: `2026-11-20 ${depart}`, arriveTime: `2026-11-20 ${arrive}`,
  airline: "Test Air", flightNumbers: [id], stops: 0, via: [], durationMin: 90, pricePerPerson: price, ...extra,
});
const back = (id: string, depart: string, price: number) => f(id, depart, "23:59", price, { departTime: `2026-11-23 ${depart}` });
const dated = (id: string, day: string, depart: string, arrive: string, price: number, extra: Partial<Flight> = {}) =>
  f(id, depart, arrive, price, { departTime: `${day} ${depart}`, arriveTime: `${day} ${arrive}`, ...extra });
const limit = (c: Omit<Extract<Constraint, { kind: "flight_time" }>, "id" | "hard" | "kind">): Constraint => ({ id: "t", hard: true, kind: "flight_time", ...c });
const squad = [{ name: "A", city: "Pune" }, { name: "B", city: "Delhi" }];
const backs = { A: [back("Ab", "18:00", 4000)], B: [back("Bb", "18:30", 4000)] };

test("prefers aligned arrivals when the price difference is small", () => {
  const out = { A: [f("A-cheap-early", "05:00", "07:00", 4000), f("A-aligned", "09:00", "11:00", 4300)], B: [f("B-only", "08:30", "11:20", 5000)] };
  const r = pickSquadFlights(out, backs, squad);
  expect(r.flights[0].out?.id).toBe("A-aligned"); // 20 min apart for ₹300 more beats 4h20m apart
  expect(r.arrivalWindow).toEqual({ first: "2026-11-20 11:00", last: "2026-11-20 11:20", extraVsCheapest: 300 });
});

test("still picks the cheap flight when lining up would cost a lot more", () => {
  const out = { A: [f("A-cheap", "05:00", "07:00", 4000), f("A-pricey", "09:00", "11:00", 20000)], B: [f("B-only", "08:30", "07:30", 5000)] };
  expect(pickSquadFlights(out, backs, squad).flights[0].out?.id).toBe("A-cheap");
});

test("return departures are lined up too", () => {
  const out = { A: [f("Ao", "09:00", "11:00", 4000)], B: [f("Bo", "09:00", "11:10", 4000)] };
  const r = pickSquadFlights(out, { A: [back("A-0600", "06:00", 3500), back("A-1800", "18:00", 3800)], B: [back("B-1830", "18:30", 4000)] }, squad);
  expect(r.flights[0].back?.id).toBe("A-1800");
});

test("a friend whose flight search failed doesn't block everyone else", () => {
  const r = pickSquadFlights({ A: [f("Ao", "09:00", "11:00", 4000)], B: [] }, { A: [back("Ab", "18:00", 4000)] }, squad);
  expect(r.flights[0].out?.id).toBe("Ao");
  expect(r.flights[1].out).toBeUndefined();
});

test("prefers everyone at the same airport over a slightly cheaper split", () => {
  const out = { A: [f("A-GOX", "09:00", "11:00", 4000, { to: "GOX" })], B: [f("B-GOI-cheap", "09:00", "11:05", 4500), f("B-GOX", "09:00", "11:10", 6000, { to: "GOX" })] };
  const r = pickSquadFlights(out, backs, squad);
  expect(r.flights[1].out?.id).toBe("B-GOX"); // ₹1,500 more beats a ₹4,000 split
  expect(airportSplitNote([{ person: "A", city: "", out: out.A[0] }, { person: "B", city: "", out: out.B[0] }, { person: "C", city: "", out: out.A[0] }], "out")).toBe("B lands at GOI, ~1.5 h from the others at GOX.");
});

test("prefers a nonstop over a long one-stop at a similar price", () => {
  const slow = f("A-1stop", "05:00", "11:00", 4000, { stops: 1, durationMin: 360 });
  const fast = f("A-nonstop", "09:45", "11:00", 4800, { durationMin: 75 });
  const r = pickSquadFlights({ A: [slow, fast], B: [f("Bo", "09:00", "11:00", 4000)] }, backs, squad);
  expect(r.flights[0].out?.id).toBe("A-nonstop");
});

test("same-airport nonstops beat a cheap 6-hour one-stop when the price gap is small", () => {
  const out = {
    A: [
      dated("A-1stop-GOI", "2026-11-20", "05:00", "11:00", 4000, { stops: 1, via: ["BOM"], durationMin: 360 }),
      dated("A-nonstop-GOX", "2026-11-20", "09:50", "11:00", 5200, { durationMin: 70, to: "GOX" }),
    ],
    B: [dated("B-nonstop-GOX", "2026-11-20", "08:30", "11:10", 9000, { durationMin: 160, to: "GOX" })],
  };
  expect(pickSquadFlights(out, backs, squad).flights[0].out?.id).toBe("A-nonstop-GOX");
});

test("priceFirst gives that person their cheapest flight; keep leaves others where they are", () => {
  const bOld = f("B-old", "08:30", "11:20", 5000);
  const out = { A: [f("A-cheap", "05:00", "07:00", 3000), f("A-aligned", "09:00", "11:00", 4300)], B: [f("B-new", "04:00", "06:00", 4000), bOld] };
  expect(pickSquadFlights({ A: out.A, B: [bOld] }, backs, squad).flights[0].out?.id).toBe("A-aligned");
  const r = pickSquadFlights(out, backs, squad, { priceFirst: ["A"], keep: [{ person: "B", city: "Delhi", out: bOld, back: backs.B[0] }] });
  expect(r.flights[0].out?.id).toBe("A-cheap");
  expect(r.flights[1].out?.id).toBe("B-old");
});

test("Kabir never gets a flight before 18:00 on Friday 20 Nov, even when it's much cheaper", () => {
  const kabir = { name: "Kabir", city: "Delhi", constraints: [limit({ direction: "out", date: "2026-11-20", notBefore: "18:00", reason: "office till 6" })] };
  const aarav = { name: "Aarav", city: "Hyderabad", constraints: [] };
  const out = {
    Kabir: [dated("K-0845", "2026-11-20", "08:45", "11:30", 4000), dated("K-1835", "2026-11-20", "18:35", "21:15", 10087)],
    Aarav: [dated("A-1100", "2026-11-20", "11:00", "12:20", 5000), dated("A-1900", "2026-11-20", "19:00", "20:20", 6000)],
  };
  const r = pickSquadFlights(out, { Kabir: [back("Kb", "18:00", 4000)], Aarav: [back("Ab", "18:00", 4000)] }, [kabir, aarav]);
  expect(r.flights[0].out?.id).toBe("K-1835");
});

test("Ishita never gets a flight before 08:00 in either direction", () => {
  const ishita = { name: "Ishita", city: "Pune", constraints: [limit({ direction: "any", notBefore: "08:00" })] };
  const out = { Ishita: [dated("I-0530", "2026-11-20", "05:30", "06:40", 3000), dated("I-1415", "2026-11-20", "14:15", "15:25", 5497)] };
  const home = { Ishita: [dated("Ib-0715", "2026-11-23", "07:15", "08:30", 3000), dated("Ib-1505", "2026-11-23", "15:05", "16:15", 5500)] };
  const r = pickSquadFlights(out, home, [ishita]);
  expect(r.flights[0].out?.id).toBe("I-1415");
  expect(r.flights[0].back?.id).toBe("Ib-1505");
});
