import { parseAnalyzeRequest } from "./analyze-request.ts";
import { analyzeWithModel } from "./analyzer.ts";
import {
  modelProviderCanRun,
  resolveModelProviderConfig,
} from "./model-provider.ts";
import { sampleComparisonForLocale } from "./sample.ts";
import { collectProductSource, type CollectedSource } from "./source.ts";
import {
  collectCandidateSources,
  type SourceFailureDiagnostic,
} from "./source-diagnostics.ts";
import type { AnalyzeRequest, ComparisonResult } from "./types.ts";
import {
  attachRunManifest,
  createReplayBundle,
  createRunManifest,
} from "./reproducibility.ts";
import {
  AnalysisBudgetExceededError,
  AnalysisCancelledError,
  createJobDeadline,
  DEFAULT_OVERALL_CONCURRENCY,
  DEFAULT_PER_HOST_CONCURRENCY,
  type JobClock,
  PublicSourceCache,
  systemJobClock,
  throwIfAborted,
  withTransientRetry,
} from "./job-control.ts";

export const PUBLIC_SOURCE_CACHE_MAX_ENTRIES = 64;
export const PUBLIC_SOURCE_CACHE_TTL_MS = 5 * 60_000;
export const MODEL_RETRY_ATTEMPTS = 2;

const publicSourceCache = new PublicSourceCache<CollectedSource>({
  maxEntries: PUBLIC_SOURCE_CACHE_MAX_ENTRIES,
  ttlMs: PUBLIC_SOURCE_CACHE_TTL_MS,
});

export function clearPublicSourceCache() {
  publicSourceCache.clear();
}

export class MissingModelCredentialsError extends Error {
  constructor() {
    super("missing_model_credentials");
    this.name = "MissingModelCredentialsError";
  }
}

export class CandidateSourceCollectionError extends Error {
  readonly failures: SourceFailureDiagnostic[];

  constructor(failures: SourceFailureDiagnostic[]) {
    super("candidate_source_collection_failed");
    this.name = "CandidateSourceCollectionError";
    this.failures = failures;
  }
}

function isBundledSampleRequest(body: AnalyzeRequest) {
  const hosts = body.urls
    .map((url) => new URL(url).hostname.replace(/^www\./, ""))
    .sort();
  const sampleKeys = new Set([
    "openness",
    "agentWorkflow",
    "performance",
    "polish",
    "automation",
  ]);
  return (
    body.urls.length === 2 &&
    hosts.includes("cmux.com") &&
    hosts.includes("otty.sh") &&
    body.criteria.length === sampleKeys.size &&
    body.criteria.every((criterion) => sampleKeys.has(criterion.key))
  );
}

export interface AnalysisServiceOptions {
  env: Record<string, string | undefined>;
  sessionApiKey?: string;
  collectSource?: (url: string, signal?: AbortSignal) => Promise<CollectedSource>;
  allowBundledSample?: boolean;
  signal?: AbortSignal;
  clock?: JobClock;
  budgetMs?: number;
  onProgress?: (stage: "source" | "model" | "finalize") => void;
}

export async function runAnalysis(
  input: unknown,
  options: AnalysisServiceOptions,
): Promise<ComparisonResult> {
  const clock = options.clock ?? systemJobClock;
  const startedAt = new Date(clock.now());
  const body = parseAnalyzeRequest(input);
  const budgetMs = options.budgetMs ?? 55_000;
  const deadline = clock.now() + budgetMs;
  const job = createJobDeadline(options.signal, budgetMs, clock);
  let stage: "source" | "model" | "finalize" = "source";
  let collectedSources: CollectedSource[] = [];
  let provider: ReturnType<typeof resolveModelProviderConfig> | undefined;
  try {
  throwIfAborted(job.signal);
  if (options.env.FITLENS_DISABLE_LIVE_ANALYSIS === "1") {
    throw new MissingModelCredentialsError();
  }
  provider = resolveModelProviderConfig(options.env, options.sessionApiKey);

  if (
    options.allowBundledSample !== false &&
    !modelProviderCanRun(provider) &&
    isBundledSampleRequest(body)
  ) {
    const sample = sampleComparisonForLocale(body.locale);
    const dimensions = new Map(
      sample.dimensions.map((dimension) => [dimension.key, dimension]),
    );
    const finishedAt = new Date(clock.now());
    return {
      ...sample,
      generatedAt: new Date().toISOString(),
      dimensions: body.criteria.map((criterion) => ({
        ...dimensions.get(criterion.key)!,
        key: criterion.key,
        label: criterion.label,
        weight: criterion.weight,
      })),
      analysisRun: createRunManifest({
        request: body,
        provider: { kind: "bundled-sample", model: "fitlens-bundled-sample@1" },
        startedAt,
        finishedAt,
        status: "complete",
      }),
    };
  }

  if (!modelProviderCanRun(provider)) {
    throw new MissingModelCredentialsError();
  }

  options.onProgress?.("source");
  const cacheEligible = !options.collectSource && !options.env.GITHUB_TOKEN;
  const collect =
    options.collectSource ??
    ((url: string, signal?: AbortSignal) =>
      collectProductSource(url, undefined, signal));
  const collected = await collectCandidateSources(
    body.urls,
    async (url) => {
      throwIfAborted(job.signal);
      const key = new URL(url).toString();
      const cached = cacheEligible ? publicSourceCache.get(key) : undefined;
      if (cached) return cached;
      const source = await withTransientRetry(() => collect(url, job.signal), {
        signal: job.signal,
        clock,
        deadline,
      });
      if (cacheEligible) publicSourceCache.set(key, source);
      return source;
    },
    {
      overallConcurrency: DEFAULT_OVERALL_CONCURRENCY,
      perHostConcurrency: DEFAULT_PER_HOST_CONCURRENCY,
      signal: job.signal,
    },
  );
  if (!collected.ok) throw new CandidateSourceCollectionError(collected.failures);
  collectedSources = collected.sources;
  stage = "model";
  options.onProgress?.("model");
  let modelOutput: unknown;
  const result = await withTransientRetry(
    () => analyzeWithModel(body, collected.sources, provider!, (output) => {
      modelOutput = output;
      stage = "finalize";
      options.onProgress?.("finalize");
    }, job.signal),
    { signal: job.signal, clock, deadline, policy: { attempts: MODEL_RETRY_ATTEMPTS } },
  );
  const finishedAt = new Date(clock.now());
  const analysisRun = createRunManifest({
    request: body,
    sources: collected.sources,
    provider,
    startedAt,
    finishedAt,
    status: "complete",
    modelOutput,
  });
  return {
    ...result,
    analysisRun,
    replayBundle: createReplayBundle({
      request: body,
      sources: collected.sources,
      modelOutput,
      manifest: analysisRun,
      generatedAt: result.generatedAt,
    }),
  };
  } catch (error) {
    const finishedAt = new Date(clock.now());
    const code =
      error instanceof AnalysisBudgetExceededError
        ? "analysis_budget_exceeded"
        : error instanceof AnalysisCancelledError || options.signal?.aborted
          ? "analysis_cancelled"
        : error instanceof MissingModelCredentialsError
        ? "missing_model_credentials"
        : error instanceof CandidateSourceCollectionError
          ? "candidate_source_collection_failed"
          : error instanceof Error && /^[a-z0-9_]+$/i.test(error.message)
            ? error.message
            : "analysis_failed";
    attachRunManifest(
      error,
      createRunManifest({
        request: body,
        sources: collectedSources,
        provider: provider ?? { kind: "bundled-sample", model: "unresolved" },
        startedAt,
        finishedAt,
        status: "failed",
        failure: { stage, code },
      }),
    );
    throw error;
  } finally {
    job.dispose();
  }
}
