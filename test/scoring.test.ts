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
