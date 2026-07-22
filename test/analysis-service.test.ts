import assert from "node:assert/strict";
import test from "node:test";
import {
  CandidateSourceCollectionError,
  MissingModelCredentialsError,
  runAnalysis,
} from "../lib/analysis-service.ts";
import { getBuiltInCriteriaTemplates } from "../lib/criteria.ts";
import { SourceError } from "../lib/source.ts";
import { runManifestFromError } from "../lib/reproducibility.ts";
import type { JobClock } from "../lib/job-control.ts";
import { AnalysisCancelledError } from "../lib/job-control.ts";

const instantClock: JobClock = {
  now: () => 0,
  random: () => 0,
  sleep: async () => {},
};

test("an already-cancelled job never reaches collection and records cancellation", async () => {
  const criteria = getBuiltInCriteriaTemplates("en").find(
    (template) => template.id === "general",
  )!.criteria;
  const controller = new AbortController();
  controller.abort();
  let collected = false;
  let captured: unknown;
  try {
    await runAnalysis(
      {
        urls: ["https://one.test/", "https://two.test/"],
        context: "A sufficiently detailed comparison workflow.",
        criteria,
        locale: "en",
      },
      {
        env: { OPENAI_API_KEY: "sk-test-key-that-is-long-enough" },
        signal: controller.signal,
        collectSource: async () => {
          collected = true;
          throw new Error("unreachable");
        },
        clock: instantClock,
      },
    );
  } catch (error) {
    captured = error;
  }
  assert.equal(collected, false);
  assert.ok(captured instanceof AnalysisCancelledError);
  assert.equal(
    runManifestFromError(captured)?.failure?.code,
    "analysis_cancelled",
  );
});

test("returns the bundled comparison through the shared headless service", async () => {
  const criteria = getBuiltInCriteriaTemplates("en").find(
    (template) => template.id === "developer-tools",
  )!.criteria;
  const result = await runAnalysis(
    {
      urls: ["https://cmux.com/", "https://otty.sh/"],
      context: "I compare local agent terminals on macOS.",
      criteria,
      locale: "en",
    },
    { env: {} },
  );
  assert.equal(result.products.length, 2);
  assert.equal(result.dimensions.length, criteria.length);
  assert.equal(result.analysisRun?.provider.kind, "bundled-sample");
  assert.equal(result.analysisRun?.modelOutputHash, undefined);
  assert.equal(result.replayBundle, undefined);
});

test("requires credentials for non-sample headless analysis", async () => {
  const criteria = getBuiltInCriteriaTemplates("en").find(
    (template) => template.id === "general",
  )!.criteria;
  await assert.rejects(
    runAnalysis(
      {
        urls: ["https://one.test/", "https://two.test/"],
        context: "A sufficiently detailed comparison workflow.",
        criteria,
        locale: "en",
      },
      { env: {} },
    ),
    MissingModelCredentialsError,
  );
});

test("live-analysis kill switch prevents provider and source activity", async () => {
  const criteria = getBuiltInCriteriaTemplates("en").find(
    (template) => template.id === "general",
  )!.criteria;
  let collected = false;
  await assert.rejects(
    runAnalysis(
      {
        urls: ["https://one.test/", "https://two.test/"],
        context: "A sufficiently detailed comparison workflow.",
        criteria,
        locale: "en",
      },
      {
        env: {
          FITLENS_DISABLE_LIVE_ANALYSIS: "1",
          OPENAI_API_KEY: "sk-test-key-that-would-otherwise-run",
        },
        collectSource: async () => {
          collected = true;
          throw new Error("must not run");
        },
      },
    ),
    MissingModelCredentialsError,
  );
  assert.equal(collected, false);
});

test("returns ordered source diagnostics before any model request", async () => {
  const criteria = getBuiltInCriteriaTemplates("en").find(
    (template) => template.id === "general",
  )!.criteria;
  await assert.rejects(
    runAnalysis(
      {
        urls: ["https://one.test/", "https://two.test/"],
        context: "A sufficiently detailed comparison workflow.",
        criteria,
        locale: "en",
      },
      {
        env: { OPENAI_API_KEY: "sk-test-key-that-is-long-enough" },
        collectSource: async (url) => {
          throw new SourceError(url.includes("one") ? "privateNetwork" : "fetchFailed");
        },
        clock: instantClock,
      },
    ),
    (error: unknown) =>
      error instanceof CandidateSourceCollectionError &&
      error.failures[0].code === "privateNetwork" &&
      error.failures[1].code === "fetchFailed",
  );
});

test("failed analysis exposes only stable non-secret run metadata", async () => {
  const criteria = getBuiltInCriteriaTemplates("en").find(
    (template) => template.id === "general",
  )!.criteria;
  let captured: unknown;
  try {
    await runAnalysis(
      {
        urls: ["https://one.test/", "https://two.test/"],
        context: "A sufficiently detailed comparison workflow.",
        criteria,
        locale: "en",
      },
      {
        env: { OPENAI_API_KEY: "super-secret-provider-key" },
        collectSource: async () => { throw new SourceError("fetchFailed", "secret upstream body"); },
        clock: instantClock,
      },
    );
  } catch (error) {
    captured = error;
  }
  const manifest = runManifestFromError(captured);
  assert.equal(manifest?.status, "failed");
  assert.equal(manifest?.failure?.stage, "source");
  assert.equal(manifest?.failure?.code, "candidate_source_collection_failed");
  assert.equal(manifest?.modelOutputHash, undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /super-secret|upstream body/);
});
