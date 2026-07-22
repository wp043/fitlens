import assert from "node:assert/strict";
import test from "node:test";
import { activeEvidence, mergeManualEvidence } from "../lib/evidence.ts";
import { sampleComparison } from "../lib/sample.ts";

test("manual evidence survives a refreshed model report", () => {
  const previous = structuredClone(sampleComparison);
  previous.products[1].evidence.push({
    claim: "A hands-on observation.",
    level: "verified",
    sourceLabel: "My test notes",
    sourceUrl: "https://otty.sh/",
    origin: "manual",
  });
  const current = structuredClone(sampleComparison);
  current.generatedAt = "2026-07-20T12:00:00.000Z";

  const merged = mergeManualEvidence(previous, current);
  assert.equal(merged.products[1].evidence.at(-1)?.origin, "manual");
  assert.equal(merged.products[1].evidence.length, current.products[1].evidence.length + 1);
});

test("manual evidence is not duplicated when the model returns the same claim", () => {
  const previous = structuredClone(sampleComparison);
  const manual = {
    claim: "A manually verified claim.",
    level: "vendor" as const,
    sourceLabel: "My notes",
    sourceUrl: "https://otty.sh/",
    origin: "manual" as const,
  };
  previous.products[1].evidence.push(manual);
  const current = structuredClone(sampleComparison);
  current.products[1].evidence.push(manual);

  const merged = mergeManualEvidence(previous, current);
  assert.equal(
    merged.products[1].evidence.filter((evidence) => evidence.claim === manual.claim).length,
    1,
  );
});

test("review decisions and edited claims survive a source refresh", () => {
  const previous = structuredClone(sampleComparison);
  const originalClaim = previous.products[0].evidence[0].claim;
  previous.products[0].evidence[0] = {
    ...previous.products[0].evidence[0],
    claim: "A clearer human-reviewed claim.",
    originalClaim,
    reviewStatus: "accepted",
    reviewNote: "Confirmed in the linked implementation.",
    reviewedAt: "2026-07-20T12:00:00.000Z",
  };

  const merged = mergeManualEvidence(previous, structuredClone(sampleComparison));
  assert.equal(merged.products[0].evidence[0].claim, "A clearer human-reviewed claim.");
  assert.equal(merged.products[0].evidence[0].originalClaim, originalClaim);
  assert.equal(merged.products[0].evidence[0].reviewStatus, "accepted");
  assert.match(merged.products[0].evidence[0].reviewNote ?? "", /Confirmed/);
});

test("rejected evidence is excluded from active decision signals", () => {
  const evidence = structuredClone(sampleComparison.products[0].evidence);
  evidence[0].reviewStatus = "rejected";
  assert.deepEqual(activeEvidence(evidence), evidence.slice(1));
});
