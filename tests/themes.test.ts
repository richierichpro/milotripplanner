import { expect, test } from "vitest";
import { matchesWish, placeKind, theme } from "../src/core/themes.js";

test("classifies places by category and name", () => {
  expect(placeKind({ category: "Vegetarian restaurant" })).toBe("eat");
  expect(placeKind({ category: "Night club" })).toBe("night");
  expect(placeKind({ category: "Tourist attraction" })).toBe("do");
  expect(theme({ name: "Chapora Fort", category: "Tourist attraction" })).toBe("heritage");
  expect(theme({ name: "Basilica of Bom Jesus", category: "Church" })).toBe("faith");
  expect(theme({ name: "Grand Island Scuba", category: "Diving center" })).toBe("activity");
});

test("matches must-dos by name or by activity", () => {
  expect(matchesWish({ name: "Chapora Fort", category: "Historical landmark" }, "Chapora fort")).toBe(true);
  expect(matchesWish({ name: "Jumpin Heights", category: "Bungee jumping center" }, "bungee jumping")).toBe(true);
  expect(matchesWish({ name: "Fort Tiracol", category: "Historical landmark" }, "Fort Aguada")).toBe(false);
});
