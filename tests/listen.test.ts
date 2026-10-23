import { expect, test } from "vitest";
import { apply, sanitize, type Understanding } from "../src/bot/listen.js";
import { freshState } from "../src/bot/state.js";

test("a home city is never the destination, and a friend's home city is never suggested", () => {
  const s = freshState(1);
  s.squad = [
    { id: "1", name: "Nihal", city: "Udaipur", constraints: [] },
    { id: "2", name: "Rishi", city: "Mumbai", constraints: [] },
  ];
  s.mentioned = ["Udaipur", "Mumbai"];
  s.trip.destination = "Udaipur";
  sanitize(s);
  expect(s.squad[0].city).toBeUndefined(); // Milo will ask Nihal where he's flying from
  expect(s.squad[1].city).toBe("Mumbai");
  expect(s.mentioned).toEqual(["Udaipur"]);
  expect(s.trip.destination).toBe("Udaipur");
});

test("applying an understanding adds people, keeps only limits, and marks proxies", () => {
  const s = freshState(1);
  const msgs = [{ messageId: 10, userId: 1001, name: "Aarav", text: "x" }];
  const u: Understanding = {
    people: [{ name: "Aarav", city: "Hyderabad", action: "add", source_message_id: 10 }, { name: "kabir", city: "Delhi", action: "add", source_message_id: 10 }],
    constraints: [
      { person: "Aarav", kind: "budget", hard: true, source_message_id: 10, max: 20000 },
      { person: "Aarav", kind: "budget", hard: true, source_message_id: 10, max: 25000 },
    ],
    trip: { start_date: "2026-11-20", end_date: "2026-11-23" },
    destinations_mentioned: ["Goa"],
    intents: [],
  };
  const r = apply(s, u, msgs);
  expect(s.squad.map((p) => p.id)).toEqual(["1001", "name:kabir"]);
  expect(s.squad[1]).toMatchObject({ name: "Kabir", proxyFor: "1001" });
  expect(r.addedByOthers.map((x) => x.member.name)).toEqual(["Kabir"]);
  // A newer budget replaces the old one.
  expect(s.squad[0].constraints).toEqual([expect.objectContaining({ kind: "budget", max: 25000, hard: true })]);
  expect(s.trip).toMatchObject({ startDate: "2026-11-20", endDate: "2026-11-23" });
  expect(s.mentioned).toEqual(["Goa"]);
  expect(r.sourceIds).toEqual([10]);
});
