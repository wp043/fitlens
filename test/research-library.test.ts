import assert from "node:assert/strict";
import test from "node:test";
import { calibrateComparisonConfidence } from "../lib/confidence.ts";
import { inferCriteria } from "../lib/criteria.ts";
import {
  buildResearchLibrary,
  filterResearchLibrary,
  listLibraryProducts,
  type ResearchLibraryFilters,
} from "../lib/research-library.ts";
import type { SavedReport } from "../lib/report.ts";
import { defaultPriorities, sampleComparison } from "../lib/sample.ts";

function savedReport(
  id: string,
  savedAt: string,
  result = structuredClone(sampleComparison),
): SavedReport {
  return {
    id,
    title: result.title,
    savedAt,
    urls: ["https://cmux.com/", "https://otty.sh/"],
    context: "I need reliable agent sessions and local-first research.",
    priorities: defaultPriorities,
    criteria: inferCriteria(result.dimensions, defaultPriorities),
    result,
    notes: "Otty had smoother keyboard navigation during the trial.",
    locale: "en",
    revisions: [],
    trialResults: [],
    conflicts: [],
    confidenceCalibrations: calibrateComparisonConfidence(result.products),
  };
}

const allFilters: ResearchLibraryFilters = {
  query: "",
  product: "",
  sourceMode: "all",
  evidenceLevel: "all",
  review: "all",
};

function acceptAllEvidence(report: SavedReport) {
  for (const product of report.result.products) {
    for (const evidence of product.evidence) evidence.reviewStatus = "accepted";
  }
  return report;
}

test("research library summarizes evidence and sorts newest reports first", () => {
  const older = savedReport("older", "2025-01-01T00:00:00.000Z");
  const newer = acceptAllEvidence(
    savedReport("newer", "2026-01-01T00:00:00.000Z"),
  );
  newer.result.unknowns = [];

  const entries = buildResearchLibrary([older, newer]);

  assert.equal(entries[0].report.id, "newer");
  assert.equal(entries[0].needsReview, false);
  assert.ok(entries[0].evidenceCount > 0);
  assert.ok(entries[0].sourceCount > 0);
  assert.ok(entries[0].verifiedCount > 0);
});

test("search covers products, evidence, decisions, context, and local notes", () => {
  const entries = buildResearchLibrary([
    savedReport("searchable", "2026-01-01T00:00:00.000Z"),
  ]);

  for (const query of [
    "Otty navigation",
    "agent sessions",
    sampleComparison.recommendation.winner,
    sampleComparison.products[0].evidence[0].claim,
  ]) {
    assert.equal(
      filterResearchLibrary(entries, { ...allFilters, query }).length,
      1,
      `expected ${query} to be searchable`,
    );
  }
  assert.equal(
    filterResearchLibrary(entries, { ...allFilters, query: "no such tool" })
      .length,
    0,
  );
});

test("library combines product, source, evidence, and review filters", () => {
  const first = savedReport("first", "2026-01-01T00:00:00.000Z");
  const secondResult = structuredClone(sampleComparison);
  secondResult.products = secondResult.products.map((product) => ({
    ...product,
    name: `${product.name} Next`,
    sourceMode: "website-only" as const,
    evidence: product.evidence.map((evidence) => ({
      ...evidence,
      level: "vendor" as const,
    })),
  }));
  secondResult.unknowns = [];
  const second = acceptAllEvidence(
    savedReport("second", "2026-02-01T00:00:00.000Z", secondResult),
  );
  const entries = buildResearchLibrary([first, second]);

  assert.equal(
    filterResearchLibrary(entries, {
      ...allFilters,
      product: first.result.products[0].name,
      sourceMode: "open-source",
      evidenceLevel: "verified",
      review: "needs-review",
    })[0].report.id,
    "first",
  );
  assert.equal(
    filterResearchLibrary(entries, {
      ...allFilters,
      sourceMode: "website-only",
      evidenceLevel: "vendor",
      review: "ready",
    })[0].report.id,
    "second",
  );
});

test("product facets are unique and stable", () => {
  const report = savedReport("products", "2026-01-01T00:00:00.000Z");
  const products = listLibraryProducts([report, structuredClone(report)]);

  assert.deepEqual(
    products,
    [...new Set(report.result.products.map((product) => product.name))].sort(
      (first, second) => first.localeCompare(second),
    ),
  );
});
