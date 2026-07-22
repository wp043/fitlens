import assert from "node:assert/strict";
import test from "node:test";
import { calculatePairwiseStandings } from "../lib/pairwise.ts";

test("ranks products from completed head-to-head trials only", () => {
  const standings = calculatePairwiseStandings(
    ["Alpha", "Beta", "Gamma"],
    [
      { id: "1", firstProduct: "Alpha", secondProduct: "Beta", task: "Task 1", outcome: "first", note: "" },
      { id: "2", firstProduct: "Alpha", secondProduct: "Gamma", task: "Task 2", outcome: "tie", note: "" },
      { id: "3", firstProduct: "Beta", secondProduct: "Gamma", task: "Task 3", outcome: "untested", note: "" },
    ],
  );
  assert.deepEqual(standings.map((item) => item.product), ["Alpha", "Gamma", "Beta"]);
  assert.deepEqual(standings[0], {
    product: "Alpha",
    wins: 1,
    losses: 0,
    ties: 1,
    points: 4,
  });
});
