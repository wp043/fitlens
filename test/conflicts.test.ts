import assert from "node:assert/strict";
import test from "node:test";
import { detectEvidenceConflicts } from "../lib/conflicts.ts";
import type { ComparisonResult, Evidence } from "../lib/types.ts";

function comparison(evidence: Evidence[]): Pick<ComparisonResult, "products"> {
  return {
    products: [
      {
        name: "Product A",
        tagline: "",
        url: "https://product.test",
        score: 50,
        confidence: 50,
        sourceMode: "website-only",
        verdict: "",
        strengths: [],
        tradeoffs: [],
        evidence,
      },
    ],
  };
}

function item(claim: string, level: Evidence["level"], sourceUrl: string): Evidence {
  return { claim, level, sourceLabel: new URL(sourceUrl).hostname, sourceUrl };
}

test("detects opposing pricing claims and keeps both sources", () => {
  const conflicts = detectEvidenceConflicts(
    comparison([
      item("The desktop app is free to use.", "vendor", "https://vendor.test/pricing"),
      item("The desktop app requires a subscription.", "verified", "https://docs.test/billing"),
    ]),
  );

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].topic, "pricing");
  assert.equal(conflicts[0].severity, "high");
  assert.equal(conflicts[0].first.sourceUrl, "https://vendor.test/pricing");
  assert.equal(conflicts[0].second.sourceUrl, "https://docs.test/billing");
});

test("detects bilingual account conflicts", () => {
  const conflicts = detectEvidenceConflicts(
    comparison([
      item("官网称无需账号即可使用。", "vendor", "https://vendor.test"),
      item("实际安装后必须登录账号。", "inferred", "https://notes.test"),
    ]),
  );

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].topic, "account");
  assert.equal(conflicts[0].severity, "medium");
});

test("does not flag compatible or unrelated evidence", () => {
  const conflicts = detectEvidenceConflicts(
    comparison([
      item("The source is public under MIT.", "verified", "https://repo.test"),
      item("The app has a command palette.", "vendor", "https://vendor.test"),
      item("The project is open source.", "vendor", "https://docs.test"),
    ]),
  );

  assert.deepEqual(conflicts, []);
});

test("produces stable identifiers for portable reports", () => {
  const input = comparison([
    item("No telemetry is collected.", "vendor", "https://privacy.test"),
    item("The app collects usage analytics.", "verified", "https://repo.test"),
  ]);

  assert.equal(
    detectEvidenceConflicts(input)[0].id,
    detectEvidenceConflicts(input)[0].id,
  );
});
