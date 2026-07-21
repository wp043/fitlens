import assert from "node:assert/strict";
import test from "node:test";
import { inferCriteria } from "../lib/criteria.ts";
import { parseReport, serializeReport, type SavedReport } from "../lib/report.ts";
import { createRedactedReport } from "../lib/redaction.ts";
import { calibratePrivacyRisk } from "../lib/privacy.ts";
import { defaultPriorities, sampleComparison, sampleComparisonEn } from "../lib/sample.ts";

function reportWithPrivacy(): SavedReport {
  return {
    id: "privacy-report",
    title: sampleComparison.title,
    savedAt: sampleComparison.generatedAt,
    urls: ["https://cmux.com/", "https://otty.sh/"],
    context: "A sufficiently detailed privacy-focused comparison context.",
    priorities: defaultPriorities,
    criteria: inferCriteria(sampleComparison.dimensions, defaultPriorities),
    result: structuredClone(sampleComparison),
    notes: "",
    locale: "en",
    revisions: [],
    trialResults: [],
    conflicts: [],
    confidenceCalibrations: [],
  };
}

test("sample reviews cover every privacy and security boundary in both locales", () => {
  const expected = [
    "account",
    "encryption",
    "permissions",
    "retention",
    "selfHosting",
    "telemetry",
  ];

  for (const comparison of [sampleComparison, sampleComparisonEn]) {
    for (const product of comparison.products) {
      assert.deepEqual(
        product.privacy?.findings.map((finding) => finding.category).sort(),
        expected,
      );
      assert.ok(
        product.privacy?.findings.every(
          (finding) => finding.sourceUrl && finding.uncertainty,
        ),
      );
    }
  }
});

test("privacy reviews persist through portable reports and safe exports", () => {
  const source = reportWithPrivacy();
  const restored = parseReport(serializeReport(source));
  const shared = createRedactedReport(source).report;

  assert.deepEqual(restored.result.products[0].privacy, source.result.products[0].privacy);
  assert.deepEqual(shared.result.products[1].privacy, source.result.products[1].privacy);
});

test("portable reports reject incomplete and unsafe privacy findings", () => {
  const incomplete = reportWithPrivacy();
  incomplete.result.products[0].privacy!.findings.pop();
  assert.throws(() => parseReport(serializeReport(incomplete)));

  const unsafe = reportWithPrivacy();
  unsafe.result.products[0].privacy!.findings[0].sourceUrl = "javascript:alert(1)";
  assert.throws(() => parseReport(serializeReport(unsafe)));
});

test("privacy risk calibration does not reward missing disclosure", () => {
  const sparse = sampleComparison.products[1].privacy!.findings;
  assert.equal(calibratePrivacyRisk(sparse), "unknown");

  const transparent = sparse.map((finding) => ({
    ...finding,
    status: "positive" as const,
  }));
  assert.equal(calibratePrivacyRisk(transparent), "low");
});
