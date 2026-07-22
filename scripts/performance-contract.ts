import assert from "node:assert/strict";
import {
  MODEL_RETRY_ATTEMPTS,
  PUBLIC_SOURCE_CACHE_MAX_ENTRIES,
  PUBLIC_SOURCE_CACHE_TTL_MS,
} from "../lib/analysis-service.ts";
import { compareResults } from "../lib/diff.ts";
import {
  DEFAULT_OVERALL_CONCURRENCY,
  DEFAULT_PER_HOST_CONCURRENCY,
  DEFAULT_RETRY_POLICY,
  mapWithHostLimits,
  PublicSourceCache,
  withTransientRetry,
  type JobClock,
} from "../lib/job-control.ts";
import {
  MAX_PORTABLE_REPORT_BYTES,
  MAX_REPORT_REVISIONS,
  parseReport,
  serializeReport,
} from "../lib/report.ts";
import {
  MAX_REPLAY_BUNDLE_BYTES,
  parseReplayBundle,
  REPLAY_LIMITS,
  serializeReplayBundle,
} from "../lib/reproducibility.ts";
import { SourceError } from "../lib/source.ts";
import {
  MAX_SAVED_REPORTS,
  moveCandidate,
  normalizeReportHistory,
  removeCandidate,
  type SourceFailure,
} from "../lib/workbench-state.ts";
import { appendWatchTrend, createWatchTrendPoint } from "../lib/watchlist.ts";
import {
  advanceResult,
  createPerformanceReplay,
  createPerformanceReport,
  legacyReport,
} from "./performance-fixtures.ts";

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

async function schedulingContract() {
  const urls = [
    "https://a.example/1", "https://a.example/2",
    "https://b.example/1", "https://b.example/2",
    "https://c.example/1", "https://d.example/1",
    "https://e.example/1", "https://f.example/1",
  ];
  let active = 0;
  let maximumActive = 0;
  let operations = 0;
  const activeHosts = new Map<string, number>();
  let maximumPerHost = 0;
  const settled = await mapWithHostLimits(urls, async (url) => {
    const host = new URL(url).host;
    active += 1;
    operations += 1;
    activeHosts.set(host, (activeHosts.get(host) ?? 0) + 1);
    maximumActive = Math.max(maximumActive, active);
    maximumPerHost = Math.max(maximumPerHost, activeHosts.get(host)!);
    await Promise.resolve();
    active -= 1;
    activeHosts.set(host, activeHosts.get(host)! - 1);
    return url;
  });
  assert.equal(operations, 8);
  assert.equal(settled.length, 8);
  assert.equal(maximumActive, DEFAULT_OVERALL_CONCURRENCY);
  assert.equal(maximumPerHost, DEFAULT_PER_HOST_CONCURRENCY);
  return { operations, maximumActive, maximumPerHost };
}

async function retryContract() {
  let now = 0;
  const sleeps: number[] = [];
  const clock: JobClock = {
    now: () => now,
    random: () => 0.5,
    async sleep(ms) { sleeps.push(ms); now += ms; },
  };
  let sourceAttempts = 0;
  await assert.rejects(withTransientRetry(async () => {
    sourceAttempts += 1;
    throw new SourceError("fetchFailed");
  }, { clock }), SourceError);
  assert.equal(sourceAttempts, DEFAULT_RETRY_POLICY.attempts);
  assert.equal(sleeps.length, DEFAULT_RETRY_POLICY.attempts - 1);
  let modelAttempts = 0;
  await assert.rejects(withTransientRetry(async () => {
    modelAttempts += 1;
    throw new SourceError("fetchFailed");
  }, { clock, policy: { attempts: MODEL_RETRY_ATTEMPTS } }), SourceError);
  assert.equal(modelAttempts, MODEL_RETRY_ATTEMPTS);
  return { sourceAttempts, modelAttempts, retrySleeps: sleeps.length };
}

function cacheContract() {
  let now = 0;
  const cache = new PublicSourceCache<{ value: number }>({
    maxEntries: PUBLIC_SOURCE_CACHE_MAX_ENTRIES,
    ttlMs: PUBLIC_SOURCE_CACHE_TTL_MS,
    now: () => now,
  });
  for (let index = 0; index < PUBLIC_SOURCE_CACHE_MAX_ENTRIES * 2; index += 1) {
    cache.set(`key-${index}`, { value: index });
  }
  assert.equal(cache.size, PUBLIC_SOURCE_CACHE_MAX_ENTRIES);
  assert.equal(cache.get("key-0"), undefined);
  now = PUBLIC_SOURCE_CACHE_TTL_MS + 1;
  for (let index = PUBLIC_SOURCE_CACHE_MAX_ENTRIES; index < PUBLIC_SOURCE_CACHE_MAX_ENTRIES * 2; index += 1) {
    assert.equal(cache.get(`key-${index}`), undefined);
  }
  assert.equal(cache.size, 0);
  return { writes: PUBLIC_SOURCE_CACHE_MAX_ENTRIES * 2, maximumEntries: PUBLIC_SOURCE_CACHE_MAX_ENTRIES };
}

function storageAndPayloadContract() {
  const smallBundle = createPerformanceReplay();
  const smallReport = createPerformanceReport(smallBundle, MAX_REPORT_REVISIONS);
  const history = normalizeReportHistory(
    Array.from({ length: MAX_SAVED_REPORTS + 25 }, (_, index) => legacyReport(smallReport, index)),
  );
  assert.equal(history.length, MAX_SAVED_REPORTS);
  assert.ok(history.every((report) => report.revisions.length === 0));
  const migrated = parseReport(JSON.stringify({
    schemaVersion: 1,
    exportedAt: smallReport.savedAt,
    report: legacyReport(smallReport, 999),
  }));
  assert.equal(migrated.criteria.length, 8);
  assert.equal(migrated.revisions.length, 0);

  const maximumBundle = createPerformanceReplay({ maximumSnapshots: true });
  const replayJson = serializeReplayBundle(maximumBundle);
  assert.ok(bytes(replayJson) <= MAX_REPLAY_BUNDLE_BYTES);
  const parsedBundle = parseReplayBundle(replayJson);
  assert.equal(parsedBundle.sourceSnapshots.length, REPLAY_LIMITS.sources);
  assert.ok(parsedBundle.sourceSnapshots.every(
    (source) => source.documents.length === REPLAY_LIMITS.documentsPerSource,
  ));

  const maximumReport = createPerformanceReport(maximumBundle, MAX_REPORT_REVISIONS);
  const reportJson = serializeReport(maximumReport);
  assert.ok(bytes(reportJson) <= MAX_PORTABLE_REPORT_BYTES);
  assert.equal(JSON.parse(reportJson).schemaVersion, 4);
  assert.equal(parseReport(reportJson).revisions.length, MAX_REPORT_REVISIONS);
  assert.throws(
    () => serializeReport(createPerformanceReport(smallBundle, MAX_REPORT_REVISIONS + 1)),
  );
  assert.throws(() => parseReport("x".repeat(MAX_PORTABLE_REPORT_BYTES + 1)), /too_large/);
  assert.throws(() => parseReplayBundle("x".repeat(MAX_REPLAY_BUNDLE_BYTES + 1)), /too_large/);
  return {
    historyReports: history.length,
    revisions: MAX_REPORT_REVISIONS,
    replayBytes: bytes(replayJson),
    reportBytes: bytes(reportJson),
  };
}

function pureWorkflowContract() {
  const bundle = createPerformanceReplay();
  const report = createPerformanceReport(bundle);
  const next = advanceResult(report.result, 1);
  const diff = compareResults(report.result, next, report.criteria);
  assert.equal(diff.scoreChanges.length, 8);
  assert.equal(diff.evidenceChanges.length, 8);
  assert.ok(diff.dimensionChanges.length <= 64);
  let trend = appendWatchTrend(undefined, "performance", createWatchTrendPoint(report.result, report.criteria));
  for (let index = 1; index <= 150; index += 1) {
    const result = advanceResult(report.result, index);
    trend = appendWatchTrend(trend, "performance", createWatchTrendPoint(result, report.criteria));
  }
  assert.equal(trend.points.length, 100);

  const urls = bundle.trustedRequest.urls;
  const failures: SourceFailure[] = urls.map((url, index) => ({
    index, url, code: "fetchFailed", message: "fixture",
  }));
  const moved = moveCandidate(urls, failures, 0, 1);
  assert.equal(moved.failures[0].index, 1);
  const removed = removeCandidate(moved.urls, moved.failures, 1);
  assert.equal(removed.urls.length, 7);
  assert.equal(removed.failures.length, 7);
  return { trendPoints: trend.points.length, candidateCount: removed.urls.length };
}

async function main() {
  const summary = {
    scheduling: await schedulingContract(),
    retries: await retryContract(),
    cache: cacheContract(),
    storage: storageAndPayloadContract(),
    workflows: pureWorkflowContract(),
  };
  process.stdout.write(`performance contract passed\n${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
