import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateEvidenceCoverage,
  parseReport,
  serializeReport,
  type SavedReport,
} from "../lib/report.ts";
import { defaultPriorities, sampleComparison } from "../lib/sample.ts";

test("open-source evidence has stronger coverage in the sample report", () => {
  const openSource = calculateEvidenceCoverage(sampleComparison.products[0]);
  const websiteOnly = calculateEvidenceCoverage(sampleComparison.products[1]);

  assert.ok(openSource.score > websiteOnly.score);
  assert.equal(openSource.verified, 3);
  assert.equal(websiteOnly.vendor, 2);
});

test("portable reports preserve notes and preference weights", () => {
  const report: SavedReport = {
    id: "report-1",
    title: sampleComparison.title,
    savedAt: sampleComparison.generatedAt,
    urls: ["https://cmux.com/", "https://otty.sh/"],
    context: "A sufficiently detailed local product comparison context.",
    priorities: defaultPriorities,
    result: sampleComparison,
    notes: "The hands-on test confirmed the notification difference.",
    locale: "en",
  };

  const restored = parseReport(serializeReport(report));

  assert.equal(restored.notes, report.notes);
  assert.equal(restored.locale, "en");
  assert.deepEqual(restored.priorities, defaultPriorities);
  assert.equal(restored.result.products.length, 2);
});

test("portable reports reject non-HTTP evidence links", () => {
  const report: SavedReport = {
    id: "report-unsafe",
    title: sampleComparison.title,
    savedAt: sampleComparison.generatedAt,
    urls: ["https://cmux.com/", "https://otty.sh/"],
    context: "A sufficiently detailed local product comparison context.",
    priorities: defaultPriorities,
    result: structuredClone(sampleComparison),
    notes: "",
    locale: "en",
  };
  report.result.products[0].evidence[0].sourceUrl =
    "javascript:alert(document.domain)";

  assert.throws(() => parseReport(serializeReport(report)));
});
