import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateEvidenceFreshness,
  getFreshnessStatus,
} from "../lib/freshness.ts";
import { sampleComparison } from "../lib/sample.ts";

test("evidence freshness moves from fresh to stale over time", () => {
  const now = new Date("2026-07-20T00:00:00.000Z");
  assert.equal(getFreshnessStatus("2026-07-19T00:00:00.000Z", now), "fresh");
  assert.equal(getFreshnessStatus("2026-06-25T00:00:00.000Z", now), "aging");
  assert.equal(getFreshnessStatus("2026-05-01T00:00:00.000Z", now), "stale");
  assert.equal(getFreshnessStatus(undefined, now), "unknown");
});

test("freshness summary reports latest and unknown evidence", () => {
  const product = structuredClone(sampleComparison.products[0]);
  product.evidence[0].capturedAt = "2026-07-19T00:00:00.000Z";
  product.evidence[1].capturedAt = "2026-05-01T00:00:00.000Z";
  const summary = calculateEvidenceFreshness(
    product,
    new Date("2026-07-20T00:00:00.000Z"),
  );
  assert.equal(summary.fresh, 1);
  assert.equal(summary.stale, 1);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.latest, "2026-07-19T00:00:00.000Z");
});
