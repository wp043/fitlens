import assert from "node:assert/strict";
import test from "node:test";
import { defaultPriorities, sampleComparison } from "../lib/sample.ts";
import { calculateWeightedWinner } from "../lib/scoring.ts";

test("balanced default priorities select the stronger overall fit", () => {
  const result = calculateWeightedWinner(
    sampleComparison,
    defaultPriorities,
  );
  assert.equal(result.winner, "cmux");
  assert.ok(result.totals.cmux > result.totals.Otty);
});

test("polish-heavy priorities can select Otty", () => {
  const result = calculateWeightedWinner(sampleComparison, {
    openness: 0,
    agentWorkflow: 100,
    performance: 0,
    polish: 100,
    automation: 0,
  });
  assert.equal(result.winner, "Otty");
});

test("criteria not present in a report do not dilute its fit score", () => {
  const result = calculateWeightedWinner(sampleComparison, {
    openness: 100,
    notYetAnalyzed: 100,
  });

  assert.equal(result.normalized.cmux, 98);
  assert.equal(result.normalized.Otty, 35);
});

test("scores and selects across a shortlist of more than two products", () => {
  const shortlist = structuredClone(sampleComparison);
  shortlist.products.push({
    ...structuredClone(shortlist.products[1]),
    name: "Third",
    url: "https://third.example/",
    score: 0,
  });
  shortlist.dimensions = shortlist.dimensions.map((dimension, index) => ({
    ...dimension,
    productScores: {
      ...dimension.productScores,
      Third: index === 0 ? 100 : 96,
    },
  }));

  const result = calculateWeightedWinner(shortlist, defaultPriorities);

  assert.equal(result.winner, "Third");
  assert.equal(Object.keys(result.normalized).length, 3);
  assert.ok(result.normalized.Third > result.normalized.cmux);
});
