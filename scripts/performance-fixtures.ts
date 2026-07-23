import { inferCriteria } from "../lib/criteria.ts";
import {
  createReplayBundle,
  createRunManifest,
  replayAnalysisBundle,
} from "../lib/reproducibility.ts";
import type { SavedReport } from "../lib/report.ts";
import { defaultPriorities, sampleComparison } from "../lib/sample.ts";
import type { CollectedSource } from "../lib/source.ts";
import type {
  AnalysisReplayBundle,
  AnalyzeRequest,
  ComparisonCriterion,
  ComparisonResult,
} from "../lib/types.ts";

function criteria(count: number): ComparisonCriterion[] {
  const inferred = inferCriteria(sampleComparison.dimensions, defaultPriorities);
  return Array.from({ length: count }, (_, index) =>
    inferred[index] ?? {
      key: `performance-${index}`,
      label: `Performance criterion ${index}`,
      hint: "Deterministic performance fixture",
      weight: 50 + index,
    });
}

function sources(count: number, maximumSnapshots: boolean): CollectedSource[] {
  const pageText = maximumSnapshots ? "p".repeat(120_000) : "public page";
  const documentText = maximumSnapshots ? "d".repeat(80_000) : "public document";
  const readme = maximumSnapshots ? "r".repeat(120_000) : "public readme";
  return Array.from({ length: count }, (_, index) => {
    const origin = `https://product-${index}.example`;
    return {
      inputUrl: `${origin}/`,
      homepageUrl: `${origin}/`,
      name: `Product ${index}`,
      description: `Fixture product ${index}`,
      sourceMode: "open-source" as const,
      pageText,
      documents: Array.from(
        { length: maximumSnapshots ? 12 : 2 },
        (_, documentIndex) => ({
          kind: (["pricing", "documentation", "privacy", "security", "changelog", "release"] as const)[documentIndex % 6],
          title: `Document ${documentIndex}`,
          url: `${origin}/document-${documentIndex}`,
          text: documentText,
        }),
      ),
      repo: {
        fullName: `fixture/product-${index}`,
        url: `https://github.com/fixture/product-${index}`,
        description: "Fixture repository",
        license: "MIT",
        defaultBranch: "main",
        stars: index,
        forks: 0,
        openIssues: 0,
        pushedAt: "2026-07-01T00:00:00.000Z",
        archived: false,
        topics: ["fixture"],
        readme,
        latestRelease: {
          name: "v1",
          tagName: "v1.0.0",
          url: `https://github.com/fixture/product-${index}/releases/tag/v1.0.0`,
          publishedAt: "2026-07-01T00:00:00.000Z",
          notes: documentText,
        },
      },
    };
  });
}

function modelOutput(
  collected: CollectedSource[],
  comparisonCriteria: ComparisonCriterion[],
) {
  const template = sampleComparison.products[0];
  const names = collected.map((source) => source.name);
  return {
    title: "Deterministic performance fixture",
    recommendation: {
      winner: names[0],
      summary: "The first fixture wins by construction.",
      reasons: ["Stable fixture reason one", "Stable fixture reason two"],
      switchWhen: "The fixture changes.",
    },
    products: collected.map((source, index) => ({
      name: source.name,
      tagline: source.description,
      url: source.homepageUrl,
      repoUrl: source.repo?.url ?? null,
      score: 90 - index,
      confidence: 80,
      sourceMode: source.sourceMode,
      verdict: `Deterministic verdict ${index}`,
      strengths: ["Stable strength one", "Stable strength two"],
      tradeoffs: ["Stable tradeoff one", "Stable tradeoff two"],
      evidence: template.evidence.slice(0, 2).map((evidence, evidenceIndex) => ({
        claim: `${source.name} evidence ${evidenceIndex}`,
        level: evidence.level,
        sourceLabel: "Fixture source",
        sourceUrl: source.homepageUrl,
      })),
      pricing: {
        ...structuredClone(template.pricing!),
        plans: template.pricing!.plans.map((plan) => ({
          ...structuredClone(plan),
          sourceUrl: source.homepageUrl,
        })),
      },
      privacy: {
        ...structuredClone(template.privacy!),
        findings: template.privacy!.findings.map((finding) => ({
          ...structuredClone(finding),
          sourceUrl: source.homepageUrl,
        })),
      },
    })),
    dimensions: comparisonCriteria.map((criterion, criterionIndex) => ({
      key: criterion.key,
      label: criterion.label,
      weight: criterion.weight,
      productScores: names.map((name, productIndex) => ({
        name,
        score: 90 - productIndex - criterionIndex,
      })),
      winner: names[0],
      explanation: "Deterministic dimension fixture.",
    })),
    unknowns: ["Fixture unknown one", "Fixture unknown two"],
    trialPlan: sampleComparison.trialPlan,
  };
}

export function createPerformanceReplay(options: {
  candidates?: number;
  criteria?: number;
  maximumSnapshots?: boolean;
} = {}): AnalysisReplayBundle {
  const collected = sources(options.candidates ?? 8, options.maximumSnapshots ?? false);
  const comparisonCriteria = criteria(options.criteria ?? 8);
  const request: AnalyzeRequest = {
    urls: collected.map((source) => source.inputUrl),
    context: "Deterministic offline performance and soak workflow.",
    criteria: comparisonCriteria,
    locale: "en",
  };
  const output = modelOutput(collected, comparisonCriteria);
  const startedAt = new Date("2026-07-22T00:00:00.000Z");
  const finishedAt = new Date("2026-07-22T00:00:01.000Z");
  const manifest = createRunManifest({
    request,
    sources: collected,
    provider: { kind: "openai", model: "performance-fixture" },
    startedAt,
    finishedAt,
    status: "complete",
    modelOutput: output,
  });
  return createReplayBundle({
    request,
    sources: collected,
    modelOutput: output,
    manifest,
    generatedAt: finishedAt.toISOString(),
  });
}

export function createPerformanceReport(
  bundle = createPerformanceReplay(),
  revisionCount = 5,
): SavedReport {
  const result = replayAnalysisBundle(bundle);
  const priorities = Object.fromEntries(
    bundle.trustedRequest.criteria.map((criterion) => [criterion.key, criterion.weight]),
  );
  const revision = { ...structuredClone(result), replayBundle: undefined };
  return {
    id: "performance-report",
    title: result.title,
    savedAt: result.generatedAt,
    urls: bundle.trustedRequest.urls,
    context: bundle.trustedRequest.context,
    priorities,
    criteria: bundle.trustedRequest.criteria,
    result,
    notes: "Deterministic local note",
    locale: "en",
    revisions: Array.from({ length: revisionCount }, () => structuredClone(revision)),
    trialResults: [],
    pairwiseTrials: [],
    conflicts: [],
    confidenceCalibrations: [],
  };
}

export function legacyReport(report: SavedReport, id: number) {
  const legacy = structuredClone(report) as Partial<SavedReport> & { id: string };
  legacy.id = `legacy-${id}`;
  delete legacy.criteria;
  delete legacy.revisions;
  delete legacy.trialResults;
  delete legacy.pairwiseTrials;
  return legacy;
}

export function advanceResult(result: ComparisonResult, iteration: number) {
  const next = structuredClone(result);
  next.generatedAt = new Date(Date.parse(result.generatedAt) + iteration * 1_000).toISOString();
  next.products[0].score = (next.products[0].score + iteration) % 101;
  next.dimensions[0].productScores[next.products[0].name] = next.products[0].score;
  next.unknowns = iteration % 2 ? [...next.unknowns, `Unknown ${iteration}`] : next.unknowns;
  return next;
}
