import assert from "node:assert/strict";
import test from "node:test";
import { calibrateProductConfidence } from "../lib/confidence.ts";
import type { ProductResult } from "../lib/types.ts";

const now = new Date("2026-07-20T12:00:00.000Z");

function product(overrides: Partial<ProductResult> = {}): ProductResult {
  return {
    name: "Candidate",
    tagline: "A candidate",
    url: "https://candidate.test",
    score: 80,
    confidence: 99,
    sourceMode: "open-source",
    verdict: "Worth considering.",
    strengths: [],
    tradeoffs: [],
    evidence: [
      {
        claim: "The implementation is public.",
        level: "verified",
        sourceLabel: "Repository",
        sourceUrl: "https://github.com/example/candidate",
        capturedAt: "2026-07-20T10:00:00.000Z",
      },
      {
        claim: "The license is MIT.",
        level: "verified",
        sourceLabel: "License",
        sourceUrl: "https://github.com/example/candidate/blob/main/LICENSE",
        capturedAt: "2026-07-20T10:00:00.000Z",
      },
      {
        claim: "Supports the documented workflow.",
        level: "vendor",
        sourceLabel: "Documentation",
        sourceUrl: "https://candidate.test/docs",
        capturedAt: "2026-07-20T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

test("direct, diverse, fresh evidence produces strong calibrated confidence", () => {
  const calibration = calibrateProductConfidence(product(), [], now);

  assert.equal(calibration.band, "strong");
  assert.equal(calibration.verified, 2);
  assert.equal(calibration.sourceCount, 3);
  assert.ok(calibration.score >= 75);
  assert.equal(
    calibration.factors.find((factor) => factor.key === "directVerification")?.effect,
    "supporting",
  );
});

test("vendor and inferred claims from one source remain explicitly limited", () => {
  const candidate = product({
    sourceMode: "website-only",
    evidence: [
      {
        claim: "The vendor says it is private.",
        level: "vendor",
        sourceLabel: "Homepage",
        sourceUrl: "https://candidate.test",
      },
      {
        claim: "This may imply local processing.",
        level: "inferred",
        sourceLabel: "Homepage",
        sourceUrl: "https://candidate.test",
      },
    ],
  });
  const calibration = calibrateProductConfidence(candidate, [], now);

  assert.equal(calibration.band, "limited");
  assert.equal(calibration.verified, 0);
  assert.ok(calibration.factors.some((factor) => factor.key === "limitedSources"));
  assert.ok(calibration.factors.some((factor) => factor.key === "inferenceHeavy"));
});

test("conflicting claims lower confidence and appear as a limiting factor", () => {
  const candidate = product();
  const baseline = calibrateProductConfidence(candidate, [], now);
  const withConflict = calibrateProductConfidence(
    candidate,
    [
      {
        id: "conflict-1",
        product: candidate.name,
        topic: "pricing",
        severity: "high",
        first: candidate.evidence[0],
        second: candidate.evidence[1],
      },
    ],
    now,
  );

  assert.ok(withConflict.score < baseline.score);
  assert.ok(withConflict.factors.some((factor) => factor.key === "conflicts"));
});
