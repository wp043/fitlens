import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateEvidenceCoverage,
  parseReport,
  serializeReport,
  type SavedReport,
} from "../lib/report.ts";
import { inferCriteria } from "../lib/criteria.ts";
import { detectEvidenceConflicts } from "../lib/conflicts.ts";
import { calibrateComparisonConfidence } from "../lib/confidence.ts";
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
    trialResults: [
      {
        task: sampleComparison.trialPlan[0].task,
        status: "passed",
        note: "Completed in 12 minutes.",
      },
    ],
    conflicts: [],
    confidenceCalibrations: calibrateComparisonConfidence(sampleComparison.products),
  };

  const restored = parseReport(serializeReport(report));

  assert.equal(restored.notes, report.notes);
  assert.equal(restored.locale, "en");
  assert.deepEqual(restored.priorities, defaultPriorities);
  assert.deepEqual(restored.criteria, criteria);
  assert.deepEqual(restored.revisions, []);
  assert.equal(restored.trialResults[0].status, "passed");
  assert.equal(restored.trialResults[0].note, "Completed in 12 minutes.");
  assert.equal(restored.result.products.length, 2);
  assert.equal(restored.result.products[0].pricing?.hasFreeOption, true);
  assert.equal(restored.result.products[0].pricing?.plans[0].cadence, "free");
  assert.equal(
    restored.result.products[0].pricing?.plans[0].sourceUrl,
    "https://cmux.com/",
  );
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

test("version 3 reports preserve a multi-product shortlist", () => {
  const result = structuredClone(sampleComparison);
  result.products.push({
    ...structuredClone(result.products[1]),
    name: "Third",
    url: "https://third.example/",
  });
  result.dimensions = result.dimensions.map((dimension) => ({
    ...dimension,
    productScores: { ...dimension.productScores, Third: 72 },
  }));
  const report: SavedReport = {
    id: "shortlist",
    title: "Three-way shortlist",
    savedAt: result.generatedAt,
    urls: ["https://cmux.com/", "https://otty.sh/", "https://third.example/"],
    context: "A sufficiently detailed local product comparison context.",
    priorities: defaultPriorities,
    criteria,
    result,
    notes: "",
    locale: "en",
    revisions: [structuredClone(result)],
    trialResults: [],
    conflicts: [],
    confidenceCalibrations: calibrateComparisonConfidence(result.products),
  };

  const restored = parseReport(serializeReport(report));

  assert.equal(restored.urls.length, 3);
  assert.equal(restored.result.products.length, 3);
  assert.equal(restored.revisions[0].products.length, 3);
  assert.equal(restored.result.dimensions[0].productScores.Third, 72);
});

test("version 2 two-product reports remain importable", () => {
  const portable = JSON.parse(
    serializeReport({
      id: "legacy-v2",
      title: sampleComparison.title,
      savedAt: sampleComparison.generatedAt,
      urls: ["https://cmux.com/", "https://otty.sh/"],
      context: "A sufficiently detailed local product comparison context.",
      priorities: defaultPriorities,
      criteria,
      result: sampleComparison,
      notes: "",
      locale: "en",
      revisions: [],
      trialResults: [],
      conflicts: [],
      confidenceCalibrations: [],
    }),
  );
  portable.schemaVersion = 2;

  const restored = parseReport(JSON.stringify(portable));

  assert.equal(restored.urls.length, 2);
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
    criteria,
    result: structuredClone(sampleComparison),
    notes: "",
    locale: "en",
    revisions: [],
    trialResults: [],
    conflicts: [],
    confidenceCalibrations: calibrateComparisonConfidence(sampleComparison.products),
  };
  report.result.products[0].evidence[0].sourceUrl =
    "javascript:alert(document.domain)";

  assert.throws(() => parseReport(serializeReport(report)));
});

test("portable reports reject unsafe pricing source links", () => {
  const report: SavedReport = {
    id: "report-unsafe-pricing",
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
    trialResults: [],
    conflicts: [],
    confidenceCalibrations: calibrateComparisonConfidence(sampleComparison.products),
  };
  report.result.products[0].pricing!.plans[0].sourceUrl =
    "javascript:alert(document.domain)";

  assert.throws(() => parseReport(serializeReport(report)));
});

test("portable reports preserve detected evidence conflicts", () => {
  const result = structuredClone(sampleComparison);
  result.products[0].evidence.push({
    claim: "The project is not open source.",
    level: "vendor",
    sourceLabel: "Product policy",
    sourceUrl: "https://cmux.com/policy",
  });
  const conflicts = detectEvidenceConflicts(result);
  const report: SavedReport = {
    id: "report-conflict",
    title: result.title,
    savedAt: result.generatedAt,
    urls: ["https://cmux.com/", "https://otty.sh/"],
    context: "A sufficiently detailed local product comparison context.",
    priorities: defaultPriorities,
    criteria,
    result,
    notes: "",
    locale: "en",
    revisions: [],
    trialResults: [],
    conflicts,
    confidenceCalibrations: calibrateComparisonConfidence(result.products, conflicts),
  };

  const restored = parseReport(serializeReport(report));

  assert.equal(restored.conflicts.length, 1);
  assert.equal(restored.conflicts[0].topic, "openSource");
  assert.equal(restored.conflicts[0].second.sourceUrl, "https://cmux.com/policy");
  assert.equal(restored.confidenceCalibrations.length, 2);
});
