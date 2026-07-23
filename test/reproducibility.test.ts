import assert from "node:assert/strict";
import test from "node:test";
import { createRedactedReport } from "../lib/redaction.ts";
import {
  contentHash,
  createReplayBundle,
  createRunManifest,
  parseReplayBundle,
  replayAnalysisBundle,
} from "../lib/reproducibility.ts";
import { parseReport, serializeReport, type SavedReport } from "../lib/report.ts";
import { inferCriteria } from "../lib/criteria.ts";
import { defaultPriorities, sampleComparison } from "../lib/sample.ts";
import type { CollectedSource } from "../lib/source.ts";
import type { AnalyzeRequest } from "../lib/types.ts";

const criteria = inferCriteria(sampleComparison.dimensions, defaultPriorities);
const request: AnalyzeRequest = {
  urls: sampleComparison.products.map((product) => product.url),
  context: "Private local workflow with a do-not-share constraint.",
  criteria,
  locale: "en",
};
const sources: CollectedSource[] = sampleComparison.products.map((product) => ({
  inputUrl: product.url,
  homepageUrl: product.url,
  name: product.name,
  description: product.tagline,
  sourceMode: product.sourceMode,
  pageText: `Captured public page for ${product.name}`,
  documents: [],
  ...(product.repoUrl ? {
    repo: {
      fullName: `example/${product.name.toLowerCase()}`,
      url: product.repoUrl,
      description: product.tagline,
      license: "MIT",
      defaultBranch: "main",
      stars: 1,
      forks: 0,
      openIssues: 0,
      pushedAt: "2026-01-01T00:00:00.000Z",
      archived: false,
      topics: [],
      readme: "Public README",
    },
  } : {}),
}));

function modelOutput() {
  return {
    title: sampleComparison.title,
    recommendation: structuredClone(sampleComparison.recommendation),
    products: sampleComparison.products.map((product) => ({
      name: product.name,
      tagline: product.tagline,
      url: product.url,
      repoUrl: product.repoUrl ?? null,
      score: product.score,
      confidence: product.confidence,
      sourceMode: product.sourceMode,
      verdict: product.verdict,
      strengths: product.strengths,
      tradeoffs: product.tradeoffs,
      evidence: product.evidence.map(({ claim, level, sourceLabel, sourceUrl }) => ({ claim, level, sourceLabel, sourceUrl })),
      pricing: product.pricing,
      privacy: product.privacy,
    })),
    // The model contract expresses productScores as a fixed [{name, score}]
    // array (strict structured output forbids the dynamic-key record shape the
    // final ComparisonResult uses).
    dimensions: sampleComparison.dimensions.map((dimension) => ({
      ...structuredClone(dimension),
      productScores: Object.entries(dimension.productScores).map(
        ([name, score]) => ({ name, score }),
      ),
    })),
    unknowns: sampleComparison.unknowns,
    trialPlan: sampleComparison.trialPlan,
  };
}

function fixture() {
  const startedAt = new Date("2026-07-22T10:00:00.000Z");
  const finishedAt = new Date("2026-07-22T10:00:01.250Z");
  const output = modelOutput();
  const manifest = createRunManifest({
    request,
    sources,
    provider: { kind: "openai", model: "test-model" },
    startedAt,
    finishedAt,
    status: "complete",
    modelOutput: output,
  });
  return createReplayBundle({ request, sources, modelOutput: output, manifest });
}

test("canonical hashes and run identity are deterministic", () => {
  assert.equal(contentHash({ b: 2, a: 1 }), contentHash({ a: 1, b: 2 }));
  const first = fixture();
  const second = fixture();
  assert.equal(first.manifest.runId, second.manifest.runId);
  assert.deepEqual(first.manifest.sources, second.manifest.sources);
  assert.equal(first.manifest.timing.durationMs, 1_250);
  assert.doesNotMatch(JSON.stringify(first.manifest), /api[_-]?key|secret/i);
});

test("provider, model, and validated output are part of run identity", () => {
  const common = {
    request,
    sources,
    startedAt: new Date("2026-07-22T10:00:00.000Z"),
    finishedAt: new Date("2026-07-22T10:00:01.250Z"),
    status: "complete" as const,
  };
  const output = modelOutput();
  const openai = createRunManifest({
    ...common, provider: { kind: "openai", model: "model-a" }, modelOutput: output,
  });
  const compatible = createRunManifest({
    ...common, provider: { kind: "compatible", model: "model-a" }, modelOutput: output,
  });
  const otherModel = createRunManifest({
    ...common, provider: { kind: "openai", model: "model-b" }, modelOutput: output,
  });
  const changedOutput = createRunManifest({
    ...common,
    provider: { kind: "openai", model: "model-a" },
    modelOutput: { ...output, title: `${output.title} changed` },
  });
  assert.equal(openai.modelOutputHash, contentHash(output));
  assert.notEqual(openai.runId, compatible.runId);
  assert.notEqual(openai.runId, otherModel.runId);
  assert.notEqual(openai.runId, changedOutput.runId);
});

test("offline replay verifies sources and returns stable decision data", () => {
  const parsed = parseReplayBundle(JSON.stringify(fixture()));
  const first = replayAnalysisBundle(parsed);
  const second = replayAnalysisBundle(parsed);
  const stable = (result: typeof first) => ({
    ...result,
    analysisRun: undefined,
    replayBundle: undefined,
  });
  assert.deepEqual(stable(first), stable(second));
  assert.equal(first.recommendation.winner, sampleComparison.recommendation.winner);
  assert.equal(first.generatedAt, fixture().manifest.timing.finishedAt);
  assert.equal(first.analysisRun?.provider.kind, "replay");
});

test("offline replay rejects a source snapshot changed after capture", () => {
  const bundle = fixture();
  bundle.sourceSnapshots[0].pageText += " tampered";
  assert.throws(() => replayAnalysisBundle(bundle), /replay_source_hash_mismatch/);
});

test("offline replay rejects a changed validated model payload", () => {
  const bundle = fixture();
  (bundle.modelOutput as { title: string }).title += " tampered";
  assert.throws(
    () => replayAnalysisBundle(bundle),
    /replay_model_output_hash_mismatch/,
  );
});

test("replay schema requires model-output integrity metadata", () => {
  const bundle = fixture();
  delete bundle.manifest.modelOutputHash;
  assert.throws(
    () => parseReplayBundle(JSON.stringify(bundle)),
    /model output hash/i,
  );
});

test("share-safe reports remove replay context and source snapshots", () => {
  const bundle = fixture();
  const replayed = replayAnalysisBundle(bundle);
  const report = {
    id: "private-report", title: replayed.title, savedAt: replayed.generatedAt,
    urls: request.urls, context: request.context, priorities: defaultPriorities,
    criteria, result: replayed, notes: "private note", locale: "en" as const,
    revisions: [], trialResults: [], conflicts: [], confidenceCalibrations: [],
  } satisfies SavedReport;
  const shared = createRedactedReport(report, "2026-07-22T11:00:00.000Z").report;
  assert.equal(shared.result.replayBundle, undefined);
  assert.equal(shared.context, "");
  assert.equal(shared.notes, "");
  assert.equal(shared.result.analysisRun?.requestHash, bundle.manifest.requestHash);
  assert.doesNotMatch(JSON.stringify(shared), /Private local workflow|Captured public page|private note/);
});

test("portable v4 reports retain a bounded complete replay bundle", () => {
  const replayed = replayAnalysisBundle(fixture());
  const report = {
    id: "complete-report", title: replayed.title, savedAt: replayed.generatedAt,
    urls: request.urls, context: request.context, priorities: defaultPriorities,
    criteria, result: replayed, notes: "", locale: "en" as const,
    revisions: [], trialResults: [], conflicts: [], confidenceCalibrations: [],
  } satisfies SavedReport;
  const serialized = serializeReport(report);
  assert.equal(JSON.parse(serialized).schemaVersion, 4);
  const restored = parseReport(serialized);
  assert.equal(restored.result.replayBundle?.manifest.runId, fixture().manifest.runId);
  assert.equal(restored.result.replayBundle?.trustedRequest.context, request.context);
});
