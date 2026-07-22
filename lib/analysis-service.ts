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
  const body = parseAnalyzeRequest(input);
  const provider = resolveModelProviderConfig(options.env, options.sessionApiKey);

  if (
    options.allowBundledSample !== false &&
    !modelProviderCanRun(provider) &&
    isBundledSampleRequest(body)
  ) {
    const sample = sampleComparisonForLocale(body.locale);
    const dimensions = new Map(
      sample.dimensions.map((dimension) => [dimension.key, dimension]),
    );
    return {
      ...sample,
      generatedAt: new Date().toISOString(),
      dimensions: body.criteria.map((criterion) => ({
        ...dimensions.get(criterion.key)!,
        key: criterion.key,
        label: criterion.label,
        weight: criterion.weight,
      })),
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
  return analyzeWithModel(body, collected.sources, provider);
}
