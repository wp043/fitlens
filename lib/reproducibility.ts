import { createHash } from "node:crypto";
import { z } from "zod";
import { finalizeAnalysisResult } from "./analyzer.ts";
import type { ModelProviderConfig } from "./model-provider.ts";
import type { CollectedSource } from "./source.ts";
import type {
  AnalysisReplayBundle,
  AnalysisRunFailure,
  AnalysisRunManifest,
  AnalyzeRequest,
  ComparisonResult,
} from "./types.ts";

export const ANALYSIS_VERSIONS = {
  prompt: "fitlens-analysis-prompt@1",
  schema: "fitlens-comparison-schema@1",
  adapter: "fitlens-source-snapshot@1",
  replay: "fitlens-replay@1",
} as const;

const MAX_PAGE_TEXT = 120_000;
const MAX_DOCUMENT_TEXT = 80_000;
const MAX_REPOSITORY_TEXT = 120_000;
const MAX_DOCUMENTS = 12;
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value: unknown) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function bounded(value: string, maximum: number) {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

export function createSourceSnapshots(sources: CollectedSource[]): CollectedSource[] {
  return sources.map((source) => ({
    inputUrl: source.inputUrl,
    homepageUrl: source.homepageUrl,
    name: bounded(source.name, 500),
    description: bounded(source.description, 4_000),
    sourceMode: source.sourceMode,
    pageText: bounded(source.pageText, MAX_PAGE_TEXT),
    documents: source.documents.slice(0, MAX_DOCUMENTS).map((document) => ({
      kind: document.kind,
      title: bounded(document.title, 500),
      url: document.url,
      text: bounded(document.text, MAX_DOCUMENT_TEXT),
    })),
    ...(source.repo
      ? {
          repo: {
            ...source.repo,
            description: bounded(source.repo.description, 4_000),
            topics: source.repo.topics.slice(0, 50),
            readme: bounded(source.repo.readme, MAX_REPOSITORY_TEXT),
            ...(source.repo.latestRelease
              ? {
                  latestRelease: {
                    ...source.repo.latestRelease,
                    notes: bounded(source.repo.latestRelease.notes, MAX_DOCUMENT_TEXT),
                  },
                }
              : {}),
          },
        }
      : {}),
  }));
}

function sourceManifest(sources: CollectedSource[]) {
  return sources.map((source) => ({
    inputUrl: source.inputUrl,
    contentHash: contentHash(source),
    documentHashes: source.documents.map((document) => ({
      kind: document.kind,
      url: document.url,
      contentHash: contentHash(document.text),
    })),
  }));
}

export function createRunManifest(options: {
  request: AnalyzeRequest;
  sources?: CollectedSource[];
  provider: Pick<ModelProviderConfig, "kind" | "model"> | { kind: "bundled-sample" | "replay"; model: string };
  startedAt: Date;
  finishedAt: Date;
  status: "complete" | "failed";
  failure?: AnalysisRunFailure;
  modelOutput?: unknown;
}): AnalysisRunManifest {
  const snapshots = createSourceSnapshots(options.sources ?? []);
  const requestHash = contentHash(options.request);
  const sources = sourceManifest(snapshots);
  const modelOutputHash = options.modelOutput === undefined
    ? undefined
    : contentHash(options.modelOutput);
  const provider = { kind: options.provider.kind, model: options.provider.model };
  const identity = contentHash({
    requestHash,
    sources,
    provider,
    modelOutputHash,
    versions: ANALYSIS_VERSIONS,
  });
  return {
    schemaVersion: 1,
    runId: `run_${identity.slice("sha256:".length, "sha256:".length + 24)}`,
    status: options.status,
    provider,
    versions: { ...ANALYSIS_VERSIONS },
    requestHash,
    ...(modelOutputHash ? { modelOutputHash } : {}),
    sources,
    timing: {
      startedAt: options.startedAt.toISOString(),
      finishedAt: options.finishedAt.toISOString(),
      durationMs: Math.max(0, options.finishedAt.getTime() - options.startedAt.getTime()),
    },
    ...(options.failure ? { failure: options.failure } : {}),
  };
}

export function createReplayBundle(options: {
  request: AnalyzeRequest;
  sources: CollectedSource[];
  modelOutput: unknown;
  manifest: AnalysisRunManifest;
  generatedAt?: string;
}): AnalysisReplayBundle {
  if (!options.manifest.modelOutputHash) {
    throw new Error("replay_model_output_hash_missing");
  }
  if (contentHash(options.modelOutput) !== options.manifest.modelOutputHash) {
    throw new Error("replay_model_output_hash_mismatch");
  }
  return {
    schemaVersion: 1,
    createdAt: options.manifest.timing.finishedAt,
    generatedAt: options.generatedAt ?? options.manifest.timing.finishedAt,
    manifest: options.manifest,
    trustedRequest: structuredClone(options.request),
    sourceSnapshots: createSourceSnapshots(options.sources),
    modelOutput: structuredClone(options.modelOutput),
  };
}

const criterionSchema = z.object({
  key: z.string().max(200), label: z.string().max(500), hint: z.string().max(4_000), weight: z.number().min(0).max(100),
}).strict();
const sourceSchema = z.object({
  inputUrl: z.string().url(), homepageUrl: z.string().url(), name: z.string().max(500),
  description: z.string().max(4_000), sourceMode: z.enum(["open-source", "website-only"]),
  pageText: z.string().max(MAX_PAGE_TEXT),
  documents: z.array(z.object({ kind: z.string(), title: z.string().max(500), url: z.string().url(), text: z.string().max(MAX_DOCUMENT_TEXT) }).strict()).max(MAX_DOCUMENTS),
  repo: z.object({
    fullName: z.string(), url: z.string().url(), description: z.string().max(4_000), license: z.string(),
    defaultBranch: z.string(), stars: z.number(), forks: z.number(), openIssues: z.number(), pushedAt: z.string(),
    archived: z.boolean(), topics: z.array(z.string()).max(50), readme: z.string().max(MAX_REPOSITORY_TEXT),
    latestRelease: z.object({ name: z.string(), tagName: z.string(), url: z.string().url(), publishedAt: z.string(), notes: z.string().max(MAX_DOCUMENT_TEXT) }).strict().optional(),
  }).strict().optional(),
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string(), status: z.enum(["complete", "failed"]),
  provider: z.object({ kind: z.enum(["openai", "compatible", "bundled-sample", "replay"]), model: z.string() }).strict(),
  versions: z.object({ prompt: z.string(), schema: z.string(), adapter: z.string(), replay: z.string() }).strict(),
  requestHash: sha256Schema,
  modelOutputHash: sha256Schema.optional(),
  sources: z.array(z.object({ inputUrl: z.string().url(), contentHash: sha256Schema, documentHashes: z.array(z.object({ kind: z.string(), url: z.string().url(), contentHash: sha256Schema }).strict()) }).strict()),
  timing: z.object({ startedAt: z.string(), finishedAt: z.string(), durationMs: z.number().min(0) }).strict(),
  failure: z.object({ stage: z.enum(["request", "source", "model", "finalize", "replay"]), code: z.string() }).strict().optional(),
}).strict();
const replaySchema = z.object({
  schemaVersion: z.literal(1), createdAt: z.string(), generatedAt: z.string(), manifest: manifestSchema,
  trustedRequest: z.object({ urls: z.array(z.string().url()).min(2).max(8), context: z.string().max(20_000), criteria: z.array(criterionSchema).min(2).max(8), locale: z.enum(["zh-CN", "en"]) }).strict(),
  sourceSnapshots: z.array(sourceSchema).min(2).max(8), modelOutput: z.unknown(),
}).strict().refine(
  (bundle) => Boolean(bundle.manifest.modelOutputHash),
  "Replay bundle manifest must include a model output hash",
);

export function parseReplayBundle(input: string): AnalysisReplayBundle {
  return replaySchema.parse(JSON.parse(input)) as AnalysisReplayBundle;
}

export function replayAnalysisBundle(input: AnalysisReplayBundle): ComparisonResult {
  const bundle = replaySchema.parse(input) as AnalysisReplayBundle;
  const sources = bundle.sourceSnapshots as CollectedSource[];
  if (contentHash(bundle.trustedRequest) !== bundle.manifest.requestHash) {
    throw new Error("replay_request_hash_mismatch");
  }
  const actualSources = sourceManifest(sources);
  if (contentHash(actualSources) !== contentHash(bundle.manifest.sources)) {
    throw new Error("replay_source_hash_mismatch");
  }
  if (!bundle.manifest.modelOutputHash) {
    throw new Error("replay_model_output_hash_missing");
  }
  if (contentHash(bundle.modelOutput) !== bundle.manifest.modelOutputHash) {
    throw new Error("replay_model_output_hash_mismatch");
  }
  const startedAt = new Date();
  const result = finalizeAnalysisResult(
    bundle.trustedRequest,
    sources,
    bundle.modelOutput,
    bundle.generatedAt,
  );
  const finishedAt = new Date();
  return {
    ...result,
    analysisRun: createRunManifest({
      request: bundle.trustedRequest,
      sources,
      provider: { kind: "replay", model: bundle.manifest.provider.model },
      startedAt,
      finishedAt,
      status: "complete",
      modelOutput: bundle.modelOutput,
    }),
    replayBundle: bundle,
  };
}

export function attachRunManifest(error: unknown, manifest: AnalysisRunManifest) {
  if (error && typeof error === "object") {
    Object.defineProperty(error, "analysisRun", { value: manifest, enumerable: false });
  }
}

export function runManifestFromError(error: unknown): AnalysisRunManifest | undefined {
  if (!error || typeof error !== "object") return undefined;
  return (error as { analysisRun?: AnalysisRunManifest }).analysisRun;
}
