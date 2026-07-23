import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateWatchAlert,
  formatWatchAlerts,
  parseAlertConditions,
} from "../lib/watch-alerts.ts";
import type { ComparisonDiff } from "../lib/diff.ts";
import type { ComparisonResult } from "../lib/types.ts";

function result(winner: string, confidence: number): ComparisonResult {
  return {
    title: "A vs B",
    generatedAt: "2026-07-23T00:00:00.000Z",
    recommendation: { winner, summary: "", reasons: [], switchWhen: "" },
    products: [
      {
        name: winner,
        tagline: "",
        url: "https://a.test",
        score: 80,
        confidence,
        sourceMode: "open-source",
        verdict: "",
        strengths: [],
        tradeoffs: [],
        evidence: [],
      },
    ],
    dimensions: [],
    unknowns: [],
    trialPlan: [],
  };
}

function diff(overrides: Partial<ComparisonDiff>): ComparisonDiff {
  return {
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-23T00:00:00.000Z",
    winnerChanged: false,
    scoreChanges: [],
    evidenceChanges: [],
    dimensionChanges: [],
    addedUnknowns: [],
    removedUnknowns: [],
    hasChanges: false,
    ...overrides,
  };
}

test("parseAlertConditions accepts known conditions and rejects others", () => {
  assert.deepEqual(parseAlertConditions("winner, confidence"), [
    "winner",
    "confidence",
  ]);
  assert.deepEqual(parseAlertConditions("any"), ["any"]);
  assert.throws(() => parseAlertConditions("winner,bogus"), /Unknown alert condition: bogus/);
});

test("no configured condition never alerts", () => {
  const alert = evaluateWatchAlert({
    entryId: "e",
    result: result("A", 10),
    change: diff({ winnerChanged: true, hasChanges: true }),
    conditions: [],
  });
  assert.equal(alert, undefined);
});

test("a confidence threshold fires on the first run, without a diff", () => {
  const alert = evaluateWatchAlert({
    entryId: "e",
    result: result("A", 60),
    conditions: [],
    minConfidence: 70,
  });
  assert.ok(alert);
  assert.match(alert.reasons[0], /confidence 60% is below 70%/);
  // At or above the threshold does not fire.
  assert.equal(
    evaluateWatchAlert({
      entryId: "e",
      result: result("A", 70),
      conditions: [],
      minConfidence: 70,
    }),
    undefined,
  );
});

test("winner and unknowns conditions require the change to have happened", () => {
  const noChange = evaluateWatchAlert({
    entryId: "e",
    result: result("A", 90),
    change: diff({}),
    conditions: ["winner", "unknowns"],
  });
  assert.equal(noChange, undefined);

  const changed = evaluateWatchAlert({
    entryId: "e",
    result: result("B", 90),
    change: diff({
      winnerChanged: true,
      previousWinner: "A",
      currentWinner: "B",
      addedUnknowns: ["telemetry?"],
      hasChanges: true,
    }),
    conditions: ["winner", "unknowns"],
  });
  assert.ok(changed);
  assert.equal(changed.reasons.length, 2);
  assert.match(changed.reasons[0], /winner changed from A to B/);
  assert.match(changed.reasons[1], /1 new unknown/);
});

test("multiple conditions accumulate into one alert", () => {
  const alert = evaluateWatchAlert({
    entryId: "tools",
    result: result("B", 40),
    change: diff({ winnerChanged: true, previousWinner: "A", currentWinner: "B", hasChanges: true }),
    conditions: ["winner"],
    minConfidence: 70,
  });
  assert.ok(alert);
  assert.equal(alert.reasons.length, 2);
  assert.equal(alert.winner, "B");
  assert.equal(alert.confidence, 40);
});

test("formatWatchAlerts renders one prefixed line per alert", () => {
  const line = formatWatchAlerts([
    { entryId: "tools", winner: "B", confidence: 40, reasons: ["winner changed from A to B", "x"] },
  ]);
  assert.equal(line, "ALERT tools: winner changed from A to B; x");
});
