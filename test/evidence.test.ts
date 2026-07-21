import assert from "node:assert/strict";
import test from "node:test";
import { mergeManualEvidence } from "../lib/evidence.ts";
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
