import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateEvidenceCoverage,
  parseReport,
  serializeReport,
  type SavedReport,
} from "../lib/report.ts";
import { inferCriteria } from "../lib/criteria.ts";
import { defaultPriorities, sampleComparison } from "../lib/sample.ts";

const criteria = inferCriteria(sampleComparison.dimensions, defaultPriorities);

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
    criteria,
    result: sampleComparison,
    notes: "The hands-on test confirmed the notification difference.",
    locale: "en",
    revisions: [],
  };

  const restored = parseReport(serializeReport(report));

  assert.equal(restored.notes, report.notes);
  assert.equal(restored.locale, "en");
  assert.deepEqual(restored.priorities, defaultPriorities);
  assert.deepEqual(restored.criteria, criteria);
  assert.deepEqual(restored.revisions, []);
  assert.equal(restored.result.products.length, 2);
});

test("version 1 reports migrate criteria and revision history", () => {
  const legacy = {
    schemaVersion: 1,
    exportedAt: sampleComparison.generatedAt,
    report: {
      id: "legacy-report",
      title: sampleComparison.title,
      savedAt: sampleComparison.generatedAt,
      urls: ["https://cmux.com/", "https://otty.sh/"],
      context: "A sufficiently detailed local product comparison context.",
      priorities: defaultPriorities,
      result: sampleComparison,
      notes: "",
      locale: "en",
    },
  };

  const restored = parseReport(JSON.stringify(legacy));

  assert.equal(restored.criteria.length, sampleComparison.dimensions.length);
  assert.equal(restored.criteria[0].key, sampleComparison.dimensions[0].key);
  assert.equal(
    restored.criteria[0].weight,
    defaultPriorities[sampleComparison.dimensions[0].key],
  );
  assert.deepEqual(restored.revisions, []);
});

test("portable reports reject non-HTTP evidence links", () => {
  const report: SavedReport = {
    id: "report-unsafe",
    title: sampleComparison.title,
    savedAt: sampleComparison.generatedAt,
    urls: ["https://cmux.com/", "https://otty.sh/"],
    context: "A sufficiently detailed local product comparison context.",
    priorities: defaultPriorities,
    criteria,
    result: structuredClone(sampleComparison),
    notes: "",
    locale: "en",
    revisions: [],
  };
  report.result.products[0].evidence[0].sourceUrl =
    "javascript:alert(document.domain)";

  assert.throws(() => parseReport(serializeReport(report)));
});
