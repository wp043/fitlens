import assert from "node:assert/strict";
import test from "node:test";
import { inferCriteria } from "../lib/criteria.ts";
import { createRedactedReport } from "../lib/redaction.ts";
import { parseReport, serializeReport, type SavedReport } from "../lib/report.ts";
import { defaultPriorities, sampleComparison } from "../lib/sample.ts";

function privateReport(): SavedReport {
  const result = structuredClone(sampleComparison);
  result.products[0].evidence.push({
    claim: "Private observation from an internal evaluation.",
    level: "verified",
    sourceLabel: "Private notes",
    sourceUrl: "https://private.example.test/evaluation",
    origin: "manual",
  });

  return {
    id: "private-report",
    title: result.title,
    savedAt: result.generatedAt,
    urls: ["https://cmux.com/", "https://otty.sh/"],
    context: "Confidential workflow for an unreleased client project.",
    priorities: defaultPriorities,
    criteria: inferCriteria(result.dimensions, defaultPriorities).map(
      (criterion, index) => ({
        ...criterion,
        hint: index === 0 ? "Secret decision rationale" : criterion.hint,
      }),
    ),
    result,
    notes: "Do not share this internal deal-breaker.",
    locale: "en",
    revisions: [structuredClone(result)],
    trialResults: [
      {
        task: result.trialPlan[0].task,
        status: "failed",
        note: "Private trial result",
      },
    ],
    conflicts: [],
    confidenceCalibrations: [],
  };
}

test("redacted reports preserve conclusions while removing private research", () => {
  const source = privateReport();
  const { report, summary } = createRedactedReport(
    source,
    "2026-07-20T12:00:00.000Z",
  );

  assert.equal(
    report.result.recommendation.winner,
    source.result.recommendation.winner,
  );
  assert.deepEqual(report.result.dimensions, source.result.dimensions);
  assert.equal(
    report.result.products[0].pricing?.summary,
    source.result.products[0].pricing?.summary,
  );
  assert.equal(report.context, "");
  assert.equal(report.notes, "");
  assert.deepEqual(report.result.trialPlan, []);
  assert.deepEqual(report.trialResults, []);
  assert.deepEqual(report.revisions, []);
  assert.ok(report.criteria.every((criterion) => criterion.hint === ""));
  assert.ok(
    report.result.products.every((product) =>
      product.evidence.every((item) => item.origin !== "manual"),
    ),
  );
  assert.deepEqual(summary, {
    manualEvidenceRemoved: 1,
    trialResultsRemoved: 1,
    revisionsRemoved: 1,
  });
  assert.equal(report.redactedAt, "2026-07-20T12:00:00.000Z");
});

test(
  "serialized shared reports are importable and contain no private strings",
  () => {
    const { report } = createRedactedReport(privateReport());
    const serialized = serializeReport(report);

    assert.doesNotMatch(serialized, /Confidential workflow/);
    assert.doesNotMatch(serialized, /Do not share/);
    assert.doesNotMatch(serialized, /Private observation/);
    assert.doesNotMatch(serialized, /Private trial result/);
    assert.doesNotMatch(serialized, /Secret decision rationale/);
    assert.doesNotMatch(serialized, /private-report/);

    const restored = parseReport(serialized);
    assert.ok(restored.redactedAt);
    assert.equal(
      restored.result.recommendation.winner,
      report.result.recommendation.winner,
    );
    assert.deepEqual(restored.trialResults, []);
  },
);

test("creating a shared copy never mutates the local report", () => {
  const source = privateReport();
  createRedactedReport(source);

  assert.match(source.context, /Confidential/);
  assert.match(source.notes, /Do not share/);
  assert.equal(source.result.products[0].evidence.at(-1)?.origin, "manual");
  assert.equal(source.result.trialPlan.length, sampleComparison.trialPlan.length);
  assert.equal(source.revisions.length, 1);
});
