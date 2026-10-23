import { expect, test } from "vitest";
import { primaryCode, resolveAirport, suggestCities } from "../src/core/airports.js";

test("resolves cities case-insensitively, including both Goa airports", () => {
  expect(resolveAirport("  Bengaluru ")?.codes).toBe("BLR");
  expect(resolveAirport("goa")?.codes).toBe("GOI,GOX");
  expect(primaryCode("GOI,GOX")).toBe("GOI");
  expect(resolveAirport("Atlantis")).toBeNull();
});

test("places without an airport point at the nearest one with a note", () => {
  expect(resolveAirport("Manali")).toMatchObject({ codes: "KUU", note: expect.stringMatching(/Kullu/) });
});

test("suggests close city names for typos", () => {
  expect(suggestCities("Banglore")).toContain("bangalore");
  expect(suggestCities("Hydrabad")).toContain("hyderabad");
});
