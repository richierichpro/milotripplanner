import { expect, test } from "vitest";
import { hotelButtons, hotelWinner, type HotelVote } from "../src/bot/hotelvote.js";

const vote = (votes: Record<string, number>): HotelVote => ({
  id: "h",
  options: [
    { hotelId: "a", label: "Best pick", each: 15000 },
    { hotelId: "b", label: "Cheapest", each: 13000 },
    { hotelId: "c", label: "Top rated", each: 17000 },
  ],
  votes,
});

test("a majority settles the stay early", () => {
  expect(hotelWinner(vote({ aarav: 0, meera: 0 }), 4)).toBeUndefined(); // 2 of 4 isn't more than half
  expect(hotelWinner(vote({ aarav: 0, meera: 0, kabir: 0 }), 4)).toBe(0);
});

test("once everyone has voted, a tie goes to the cheaper stay", () => {
  expect(hotelWinner(vote({ aarav: 0, meera: 0, kabir: 1, ishita: 1 }), 4)).toBe(1);
});

test("buttons show live counts", () => {
  expect(hotelButtons(vote({ aarav: 2, meera: 2 })).map((b) => b.text)).toEqual(["1", "2", "3 · 🗳 2"]);
});
