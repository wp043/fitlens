import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { compareResults } from "../lib/diff.ts";
import {
  PUBLIC_SOURCE_CACHE_MAX_ENTRIES,
  PUBLIC_SOURCE_CACHE_TTL_MS,
} from "../lib/analysis-service.ts";
import { PublicSourceCache } from "../lib/job-control.ts";
import {
  parseReplayBundle,
  replayAnalysisBundle,
  serializeReplayBundle,
} from "../lib/reproducibility.ts";
import {
  MAX_SAVED_REPORTS,
  moveCandidate,
  normalizeReportHistory,
  removeCandidate,
  type SourceFailure,
} from "../lib/workbench-state.ts";
import { appendWatchTrend, createWatchTrendPoint, type WatchTrend } from "../lib/watchlist.ts";
import {
  advanceResult,
  createPerformanceReplay,
  createPerformanceReport,
  legacyReport,
} from "./performance-fixtures.ts";

interface SoakOptions {
  iterations: number;
  heapGrowthBytes: number;
  progressEvery: number;
}

function numericArgument(args: string[], name: string, fallback: number) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} requires a positive integer`);
  }
  return value;
}

function parseOptions(args: string[]): SoakOptions {
  args = args.filter((argument) => argument !== "--");
  const known = new Set(["--iterations", "--heap-growth-mib", "--progress-every"]);
  for (let index = 0; index < args.length; index += 2) {
    if (!known.has(args[index]) || args[index + 1] === undefined) {
      throw new Error(`Unknown or incomplete option: ${args[index] ?? ""}`);
    }
  }
  return {
    iterations: numericArgument(args, "--iterations", 500),
    heapGrowthBytes: numericArgument(args, "--heap-growth-mib", 64) * 1024 * 1024,
    progressEvery: numericArgument(args, "--progress-every", 100),
  };
}

function collectHeap() {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  return process.memoryUsage().heapUsed;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const started = performance.now();
  const bundle = createPerformanceReplay();
  const serializedBundle = serializeReplayBundle(bundle);
  const baseReport = createPerformanceReport(bundle);
  const rawHistory = Array.from(
    { length: MAX_SAVED_REPORTS + 25 },
    (_, index) => legacyReport(baseReport, index),
  );
  const originalUrls = bundle.trustedRequest.urls;
  const originalFailures: SourceFailure[] = originalUrls.map((url, index) => ({
    index,
    url,
    code: "fetchFailed",
    message: "soak fixture",
  }));
  let cacheNow = 0;
  const cache = new PublicSourceCache<{ iteration: number; payload: string }>({
    maxEntries: PUBLIC_SOURCE_CACHE_MAX_ENTRIES,
    ttlMs: PUBLIC_SOURCE_CACHE_TTL_MS,
    now: () => cacheNow,
  });
  let trend: WatchTrend | undefined;
  let previous = baseReport.result;
  const warmupIteration = Math.max(1, Math.floor(options.iterations / 10));
  let heapAfterWarmup = 0;
  let maximumHeap = collectHeap();
  const counters = {
    historyReportsNormalized: 0,
    replayValidations: 0,
    replayFinalizations: 0,
    diffs: 0,
    trendAppends: 0,
    cacheWrites: 0,
    cacheReads: 0,
    candidateMoves: 0,
    candidateRemovals: 0,
  };

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    const history = normalizeReportHistory(rawHistory);
    assert.equal(history.length, MAX_SAVED_REPORTS);
    assert.ok(history.every((report) => report.criteria.length === 8));
    counters.historyReportsNormalized += history.length;

    const parsed = parseReplayBundle(serializedBundle);
    counters.replayValidations += 1;
    const replayed = replayAnalysisBundle(parsed);
    counters.replayFinalizations += 1;
    assert.equal(replayed.products.length, 8);
    assert.equal(replayed.dimensions.length, 8);

    const current = advanceResult(replayed, iteration);
    const diff = compareResults(previous, current, baseReport.criteria);
    counters.diffs += 1;
    assert.equal(diff.scoreChanges.length, 8);
    assert.equal(diff.evidenceChanges.length, 8);
    trend = appendWatchTrend(
      trend,
      "performance-soak",
      createWatchTrendPoint(current, baseReport.criteria),
    );
    counters.trendAppends += 1;
    assert.ok(trend.points.length <= 100);
    previous = current;

    for (let offset = 0; offset < 4; offset += 1) {
      const key = `cache-${iteration}-${offset}`;
      cache.set(key, { iteration, payload: "x".repeat(256) });
      counters.cacheWrites += 1;
      assert.equal(cache.get(key)?.iteration, iteration);
      counters.cacheReads += 1;
    }
    assert.ok(cache.size <= PUBLIC_SOURCE_CACHE_MAX_ENTRIES);
    if (iteration % 100 === 0) {
      cacheNow += PUBLIC_SOURCE_CACHE_TTL_MS + 1;
      assert.equal(cache.get(`cache-${iteration}-0`), undefined);
      counters.cacheReads += 1;
    }

    const moved = moveCandidate(originalUrls, originalFailures, iteration % 7, 1);
    counters.candidateMoves += 1;
    const removed = removeCandidate(moved.urls, moved.failures, (iteration + 1) % 8);
    counters.candidateRemovals += 1;
    assert.equal(removed.urls.length, 7);
    assert.equal(removed.failures.length, 7);
    assert.deepEqual(
      removed.failures.map((failure) => removed.urls[failure.index]),
      removed.failures.map((failure) => failure.url),
    );

    if (iteration === warmupIteration) heapAfterWarmup = collectHeap();
    if (iteration % options.progressEvery === 0 || iteration === options.iterations) {
      const heap = collectHeap();
      maximumHeap = Math.max(maximumHeap, heap);
      process.stdout.write(
        `soak ${iteration}/${options.iterations} heap=${(heap / 1024 / 1024).toFixed(1)}MiB cache=${cache.size} trend=${trend.points.length}\n`,
      );
    }
  }

  const finalHeap = collectHeap();
  const heapGrowth = finalHeap - heapAfterWarmup;
  assert.ok(
    heapGrowth <= options.heapGrowthBytes,
    `heap grew ${(heapGrowth / 1024 / 1024).toFixed(1)}MiB after warmup; budget is ${(options.heapGrowthBytes / 1024 / 1024).toFixed(1)}MiB`,
  );
  assert.equal(counters.replayValidations, options.iterations);
  assert.equal(counters.diffs, options.iterations);
  assert.equal(counters.candidateRemovals, options.iterations);
  assert.ok(cache.size <= PUBLIC_SOURCE_CACHE_MAX_ENTRIES);
  assert.ok((trend?.points.length ?? 0) <= 100);
  const elapsedMs = Math.round(performance.now() - started);
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    iterations: options.iterations,
    elapsedMs,
    counters,
    retained: { cacheEntries: cache.size, trendPoints: trend?.points.length ?? 0 },
    heap: {
      afterWarmupBytes: heapAfterWarmup,
      finalBytes: finalHeap,
      maximumSampledBytes: maximumHeap,
      growthBytes: heapGrowth,
      growthBudgetBytes: options.heapGrowthBytes,
      explicitGc: typeof (globalThis as { gc?: () => void }).gc === "function",
    },
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
