import { expect, test } from "vitest";
import { noteProblem, sunsetAt, tripDates } from "../src/core/planner.js";
import type { Event, Place } from "../src/core/types.js";

const src = { engine: "google_maps", fetchedAt: "" };
const fort: Place = { id: "p", source: src, name: "Chapora Fort", category: "Historical landmark", description: "Hilltop fort ruins with views over Vagator beach.", lat: 0, lng: 0, mapsUrl: "" };
const tribute: Event = { id: "e", source: src, title: "Candlelight: Coldplay vs. Ed Sheeran", venue: "Aguada Jail", link: "x" };

test("notes may only use facts in the candidate's own data", () => {
  expect(noteProblem("Hilltop ruins with views over Vagator beach", fort)).toBeUndefined();
  expect(noteProblem("Climb up for views; Aarav's must-do", fort, ["Aarav"])).toBeUndefined();
  expect(noteProblem("Famous fort from Dil Chahta Hai", fort)).toMatch(/Famous|Dil/);
  expect(noteProblem("Rated 4.5 by thousands", fort)).toMatch(/number "4.5"/);
  expect(noteProblem("Great views near Anjuna", fort)).toMatch(/Anjuna/);
});

test("a tribute concert is never described as the artist performing", () => {
  expect(noteProblem("Coldplay songs by candlelight", tribute)).toBeUndefined();
  expect(noteProblem("Watch Coldplay perform live", tribute)).toMatch(/tribute|Watch/);
});

test("trip dates and sunset", () => {
  expect(tripDates({ startDate: "2026-11-20", endDate: "2026-11-23" })).toEqual(["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]);
  expect(sunsetAt("2026-11-21", { lat: 15.6, lng: 73.74 })).toMatch(/^18:0\d$/);
});
