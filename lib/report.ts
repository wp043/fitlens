import { z } from "zod";
import type { Locale } from "@/lib/i18n";
import type {
  ComparisonCriterion,
  ComparisonResult,
  PriorityWeights,
  ProductResult,
} from "@/lib/types";

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Only HTTP and HTTPS URLs are allowed");

const prioritySchema = z.record(z.number().min(0).max(100));

const criterionSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    hint: z.string(),
    weight: z.number().min(0).max(100),
  })
  .passthrough();

const evidenceSchema = z
  .object({
    claim: z.string(),
    level: z.enum(["verified", "vendor", "inferred"]),
    sourceLabel: z.string(),
    sourceUrl: httpUrlSchema,
    origin: z.enum(["collected", "manual"]).optional(),
  })
  .passthrough();

const productSchema = z
  .object({
    name: z.string(),
    tagline: z.string(),
    url: httpUrlSchema,
    repoUrl: httpUrlSchema.optional(),
    score: z.number(),
    confidence: z.number(),
    sourceMode: z.enum(["open-source", "website-only"]),
    verdict: z.string(),
    strengths: z.array(z.string()),
    tradeoffs: z.array(z.string()),
    evidence: z.array(evidenceSchema),
  })
  .passthrough();

const resultSchema = z
  .object({
    title: z.string(),
    generatedAt: z.string(),
    recommendation: z
      .object({
        winner: z.string(),
        summary: z.string(),
        reasons: z.array(z.string()),
        switchWhen: z.string(),
      })
      .passthrough(),
    products: z.array(productSchema).length(2),
    dimensions: z.array(
      z
        .object({
          key: z.string(),
          label: z.string(),
          weight: z.number(),
          productScores: z.record(z.number()),
          winner: z.string(),
          explanation: z.string(),
        })
        .passthrough(),
    ),
    unknowns: z.array(z.string()),
    trialPlan: z.array(
      z
        .object({
          task: z.string(),
          reason: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const savedReportSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    savedAt: z.string(),
    urls: z.tuple([httpUrlSchema, httpUrlSchema]),
    context: z.string(),
    priorities: prioritySchema,
    result: resultSchema,
    notes: z.string().optional().default(""),
    locale: z.enum(["zh-CN", "en"]).optional().default("zh-CN"),
    criteria: z.array(criterionSchema).min(2).max(8).optional(),
    revisions: z.array(resultSchema).max(5).optional().default([]),
  })
  .passthrough();

const portableReportSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    exportedAt: z.string(),
    report: savedReportSchema,
  })
  .strict();

export interface SavedReport {
  id: string;
  title: string;
  savedAt: string;
  urls: [string, string];
  context: string;
  priorities: PriorityWeights;
  criteria: ComparisonCriterion[];
  result: ComparisonResult;
  notes: string;
  locale: Locale;
  revisions: ComparisonResult[];
}

export interface EvidenceCoverage {
  score: number;
  label: "Strong" | "Moderate" | "Limited";
  verified: number;
  vendor: number;
  inferred: number;
  sourceCount: number;
}

export function calculateEvidenceCoverage(
  product: ProductResult,
): EvidenceCoverage {
  const verified = product.evidence.filter(
    (item) => item.level === "verified",
  ).length;
  const vendor = product.evidence.filter(
    (item) => item.level === "vendor",
  ).length;
  const inferred = product.evidence.filter(
    (item) => item.level === "inferred",
  ).length;
  const sourceCount = new Set(
    product.evidence.map((item) => item.sourceUrl),
  ).size;
  const evidenceWeight = verified * 1.25 + vendor + inferred * 0.6;
  const score = Math.min(
    100,
    Math.round(
      Math.min(evidenceWeight / 4.5, 1) * 60 +
        Math.min(sourceCount / 3, 1) * 25 +
        (product.sourceMode === "open-source" ? 15 : 0),
    ),
  );

  return {
    score,
    label: score >= 75 ? "Strong" : score >= 50 ? "Moderate" : "Limited",
    verified,
    vendor,
    inferred,
    sourceCount,
  };
}

export function serializeReport(report: SavedReport) {
  return JSON.stringify(
    {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      report,
    },
    null,
    2,
  );
}

export function normalizeSavedReport(input: unknown): SavedReport {
  const report = savedReportSchema.parse(input);
  return {
    ...report,
    criteria:
      report.criteria ??
      report.result.dimensions.map((dimension) => ({
        key: dimension.key,
        label: dimension.label,
        hint: dimension.explanation,
        weight: report.priorities[dimension.key] ?? dimension.weight ?? 60,
      })),
    revisions: report.revisions ?? [],
  } as SavedReport;
}

export function parseReport(input: string): SavedReport {
  const parsed = portableReportSchema.parse(JSON.parse(input));
  return normalizeSavedReport(parsed.report);
}
