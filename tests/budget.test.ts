import { expect, test } from "vitest";
import { typedBudget } from "../src/bot/flow.js";

test("reads typed budgets in the ways people write them", () => {
  expect(typedBudget("25k")).toBe("25000");
  expect(typedBudget("₹30,000/-")).toBe("30000");
  expect(typedBudget("35000rs is my max")).toBe("35000");
  expect(typedBudget("1.5 lakh")).toBe("150000");
  expect(typedBudget("30")).toBe("30000");
  expect(typedBudget("no limit")).toBe("none");
});

test("ignores numbers that aren't budgets", () => {
  expect(typedBudget("add something on day 4")).toBeUndefined();
  expect(typedBudget("haha yes")).toBeUndefined();
});
