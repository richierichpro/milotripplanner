import { expect, test } from "vitest";
import { costSplit, equalSplit, formatINR, formatRange, parsePriceRange, roomsFor } from "../src/core/money.js";
import type { Hotel } from "../src/core/types.js";

test("formats rupees the Indian way", () => {
  expect(formatINR(123456.4)).toBe("₹1,23,456");
  expect(formatRange({ min: 1600, max: 3200 })).toBe("₹1,600–3,200");
  expect(formatRange({ min: 2400 })).toBe("₹2,400+");
});

test("reads Google Maps price text", () => {
  expect(parsePriceRange("₹400–1,200")).toEqual({ min: 400, max: 1200 });
  expect(parsePriceRange("₹2,000+")).toEqual({ min: 2000 });
  expect(parsePriceRange("$$")).toBeUndefined();
});

test("hotel share is per night × nights × rooms ÷ people", () => {
  const hotel = { pricePerNight: 4000 } as Hotel;
  expect(roomsFor(4)).toBe(2);
  const [line] = costSplit([{ person: "A", city: "Pune", out: { pricePerPerson: 5000 } as never }, { person: "B", city: "Delhi" }], hotel, 3);
  expect(line).toEqual({ person: "A", flights: 5000, hotelShare: 6000, total: 11000 });
});

test("equalSplit settles everyone to zero", () => {
  const line = (person: string, total: number) => ({ person, flights: total, hotelShare: 0, total });
  const costs = [line("Aarav", 15000), line("Meera", 14000), line("Kabir", 22000), line("Ishita", 13000)];
  const { average, transfers } = equalSplit(costs);
  const paid = new Map(costs.map((c) => [c.person, c.total]));
  for (const t of transfers) {
    paid.set(t.from, paid.get(t.from)! + t.amount);
    paid.set(t.to, paid.get(t.to)! - t.amount);
  }
  for (const v of paid.values()) expect(v).toBe(average);
});
