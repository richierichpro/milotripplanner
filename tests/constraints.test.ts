import { expect, test } from "vitest";
import { checkPerson, failingHard } from "../src/core/constraints.js";
import type { Flight, SquadMember } from "../src/core/types.js";

const src = { engine: "google_flights", fetchedAt: "2026-10-09T00:00:00Z" };
const flight = (id: string, day: string, depart: string, arrive: string): Flight => ({
  id, source: src, from: "PNQ", to: "GOI", departTime: `${day} ${depart}`, arriveTime: `${day} ${arrive}`,
  airline: "Test Air", flightNumbers: [id], stops: 0, via: [], durationMin: 70, pricePerPerson: 5000,
});

const ishita: SquadMember = {
  id: "i",
  name: "Ishita",
  city: "Pune",
  constraints: [
    { id: "b", hard: true, kind: "budget", max: 15000 },
    { id: "t", hard: true, kind: "flight_time", direction: "any", notBefore: "08:00" },
    { id: "v", hard: true, kind: "food", diet: "veg" },
  ],
};
const vegLunch = { kind: "place" as const, time: "13:00", why: "", item: { id: "place:v", source: src, name: "Veg Treat", category: "Vegetarian restaurant", lat: 0, lng: 0, mapsUrl: "" } };
const plan = (total: number, departOut: string) => ({
  startDate: "2026-11-20",
  endDate: "2026-11-23",
  flights: [{ person: "Ishita", city: "Pune", out: flight("o", "2026-11-20", departOut, "15:25"), back: flight("b", "2026-11-23", "15:05", "16:15") }],
  costs: [{ person: "Ishita", flights: total - 4000, hotelShare: 4000, total }],
  days: [{ date: "2026-11-20", title: "d1", stops: [vegLunch] }],
});

test("passes with evidence taken from the data", () => {
  const r = checkPerson(plan(14900, "14:15"), ishita);
  expect(failingHard(r)).toEqual([]);
  expect(r[0].evidence).toMatch(/₹14,900 for you .*within your ₹15,000/);
  expect(r[1].evidence).toMatch(/Flight leaves PNQ 14:15, after 08:00/);
  expect(r[2].evidence).toMatch(/veg meal every day, e\.g\. Veg Treat \(Vegetarian restaurant\)/);
});

test("reports breaks, and a waiver turns a break into an agreed exception", () => {
  const r = checkPerson(plan(16400, "05:30"), ishita);
  expect(failingHard(r).map((x) => x.constraint.kind)).toEqual(["budget", "flight_time"]);
  expect(r[0].evidence).toMatch(/₹1,400 over your ₹15,000 cap/);

  const waived = { ...ishita, constraints: ishita.constraints.map((c) => (c.kind === "budget" ? { ...c, waived: "agreed to go ₹1,400 over" } : c)) };
  const w = checkPerson(plan(16400, "14:15"), waived);
  expect(failingHard(w)).toEqual([]);
  expect(w[0].waived).toBe("agreed to go ₹1,400 over");
});

test("food and must-dos wait until the days are planned", () => {
  const r = checkPerson({ ...plan(14900, "14:15"), days: undefined }, ishita);
  expect(r[2]).toMatchObject({ pending: true });
  expect(failingHard(r)).toEqual([]);
});
