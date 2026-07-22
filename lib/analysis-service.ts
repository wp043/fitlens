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
  collectSource?: (url: string) => Promise<CollectedSource>;
  allowBundledSample?: boolean;
}

export async function runAnalysis(
  input: unknown,
  options: AnalysisServiceOptions,
): Promise<ComparisonResult> {
  const startedAt = new Date();
  const body = parseAnalyzeRequest(input);
  let stage: "source" | "model" | "finalize" = "source";
  let collectedSources: CollectedSource[] = [];
  let provider: ReturnType<typeof resolveModelProviderConfig> | undefined;
  try {
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
    const finishedAt = new Date();
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

  const collected = await collectCandidateSources(
    body.urls,
    options.collectSource ?? collectProductSource,
  );
  if (!collected.ok) throw new CandidateSourceCollectionError(collected.failures);
  collectedSources = collected.sources;
  stage = "model";
  let modelOutput: unknown;
  const result = await analyzeWithModel(body, collected.sources, provider, (output) => {
    modelOutput = output;
    stage = "finalize";
  });
  const finishedAt = new Date();
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
    const finishedAt = new Date();
    const code =
      error instanceof MissingModelCredentialsError
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
  }
}
