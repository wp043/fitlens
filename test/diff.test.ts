import assert from "node:assert/strict";
import test from "node:test";
import { inferCriteria } from "../lib/criteria.ts";
import { compareResults } from "../lib/diff.ts";
import { defaultPriorities, sampleComparison } from "../lib/sample.ts";

const criteria = inferCriteria(sampleComparison.dimensions, defaultPriorities);

test("report diff tracks score, evidence, dimension, and unknown changes", () => {
  const current = structuredClone(sampleComparison);
  current.generatedAt = "2026-07-19T12:00:00.000Z";
  current.dimensions[0].productScores.cmux -= 12;
  current.products[0].evidence.push({
    claim: "A newly collected public claim.",
    level: "vendor",
    sourceLabel: "Product documentation",
    sourceUrl: "https://cmux.com/docs",
  });
  current.unknowns = [
    ...current.unknowns.slice(1),
    "A new pricing detail needs validation.",
  ];

  const diff = compareResults(sampleComparison, current, criteria);

  assert.equal(diff.hasChanges, true);
  assert.equal(diff.dimensionChanges.length, 1);
  assert.equal(diff.dimensionChanges[0].delta, -12);
  assert.equal(diff.evidenceChanges[0].total.delta, 1);
  assert.deepEqual(diff.addedUnknowns, [
    "A new pricing detail needs validation.",
  ]);
  assert.deepEqual(diff.removedUnknowns, [sampleComparison.unknowns[0]]);
});

test("timestamp-only refreshes do not count as material changes", () => {
  const current = structuredClone(sampleComparison);
  current.generatedAt = "2026-07-19T12:00:00.000Z";

  const diff = compareResults(sampleComparison, current, criteria);

  assert.equal(diff.hasChanges, false);
  assert.equal(diff.winnerChanged, false);
});

test("evidence-level changes count even when evidence totals stay equal", () => {
  const current = structuredClone(sampleComparison);
  current.products[1].evidence[0].level = "verified";

  const diff = compareResults(sampleComparison, current, criteria);
  const productEvidence = diff.evidenceChanges.find(
    (change) => change.product === current.products[1].name,
  )!;

  assert.equal(productEvidence.total.delta, 0);
  assert.equal(productEvidence.levels.verified.delta, 1);
  assert.equal(productEvidence.levels.vendor.delta, -1);
  assert.equal(diff.hasChanges, true);
});
