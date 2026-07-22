import { z } from "zod";
import type { Locale } from "@/lib/i18n";
import type {
  ComparisonCriterion,
  ComparisonResult,
  PriorityWeights,
  ProductResult,
  TrialResult,
  PairwiseTrialResult,
} from "@/lib/types";
import { detectEvidenceConflicts, type EvidenceConflict } from "./conflicts.ts";
import { activeEvidence } from "./evidence.ts";
import {
  calibrateComparisonConfidence,
  type ConfidenceCalibration,
} from "./confidence.ts";

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Only HTTP and HTTPS URLs are allowed");

const prioritySchema = z.record(z.string(), z.number().min(0).max(100));

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
    originalClaim: z.string().optional(),
    level: z.enum(["verified", "vendor", "inferred"]),
    sourceLabel: z.string(),
    sourceUrl: httpUrlSchema,
    origin: z.enum(["collected", "manual"]).optional(),
    capturedAt: z.string().optional(),
    reviewStatus: z.enum(["unreviewed", "accepted", "rejected"]).optional(),
    reviewNote: z.string().optional(),
    reviewedAt: z.string().optional(),
  })
  .passthrough();

const pricingPlanSchema = z
  .object({
    name: z.string(),
    price: z.string(),
    cadence: z.enum([
      "free",
      "monthly",
      "yearly",
      "one-time",
      "usage-based",
      "custom",
      "unknown",
    ]),
    audience: z.string(),
    limits: z.array(z.string()),
    sourceUrl: httpUrlSchema,
    evidenceLevel: z.enum(["verified", "vendor", "inferred"]),
  })
  .passthrough();

const pricingSchema = z
  .object({
    hasFreeOption: z.boolean().nullable(),
    summary: z.string(),
    plans: z.array(pricingPlanSchema),
    uncertainty: z.string(),
  })
  .passthrough();

const privacySchema = z
  .object({
    summary: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "unknown"]),
    findings: z
      .array(
        z.object({
          category: z.enum([
            "telemetry",
            "account",
            "retention",
            "permissions",
            "encryption",
            "selfHosting",
          ]),
          status: z.enum(["positive", "caution", "unknown"]),
          finding: z.string(),
          evidenceLevel: z.enum(["verified", "vendor", "inferred"]),
          sourceUrl: httpUrlSchema,
          uncertainty: z.string(),
        }).passthrough(),
      )
      .length(6)
      .refine(
        (findings) =>
          new Set(findings.map((finding) => finding.category)).size === 6,
        "Privacy review categories must be unique",
      ),
  })
  .passthrough();

const evidenceConflictSchema = z
  .object({
    id: z.string(),
    product: z.string(),
    topic: z.string(),
    severity: z.enum(["high", "medium"]),
    first: evidenceSchema,
    second: evidenceSchema,
  })
  .passthrough();

const confidenceCalibrationSchema = z
  .object({
    product: z.string(),
    score: z.number().min(0).max(100),
    band: z.enum(["strong", "moderate", "limited"]),
    verified: z.number().int().min(0),
    vendor: z.number().int().min(0),
    inferred: z.number().int().min(0),
    sourceCount: z.number().int().min(0),
    factors: z.array(
      z.object({
        key: z.enum([
          "directVerification",
          "sourceDiversity",
          "freshness",
          "transparency",
          "limitedSources",
          "inferenceHeavy",
          "conflicts",
        ]),
        effect: z.enum(["supporting", "limiting"]),
        value: z.number(),
      }),
    ),
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
    pricing: pricingSchema.optional(),
    privacy: privacySchema.optional(),
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
    products: z.array(productSchema).min(2).max(8),
    dimensions: z.array(
      z
        .object({
          key: z.string(),
          label: z.string(),
          weight: z.number(),
          productScores: z.record(z.string(), z.number()),
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
  .passthrough()
  .superRefine((result, context) => {
    const productNames = result.products.map((product) => product.name);
    if (new Set(productNames).size !== productNames.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Product names must be unique",
        path: ["products"],
      });
    }
    if (!productNames.includes(result.recommendation.winner)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recommendation winner must be in the shortlist",
        path: ["recommendation", "winner"],
      });
    }
    result.dimensions.forEach((dimension, index) => {
      const scoreNames = Object.keys(dimension.productScores);
      if (
        scoreNames.length !== productNames.length ||
        productNames.some((name) => !scoreNames.includes(name))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Dimension scores must cover the complete shortlist",
          path: ["dimensions", index, "productScores"],
        });
      }
    });
  });

const savedReportSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    savedAt: z.string(),
    urls: z.array(httpUrlSchema).min(2).max(8),
    context: z.string(),
    priorities: prioritySchema,
    result: resultSchema,
    notes: z.string().optional().default(""),
    locale: z.enum(["zh-CN", "en"]).optional().default("zh-CN"),
    criteria: z.array(criterionSchema).min(2).max(8).optional(),
    revisions: z.array(resultSchema).max(5).optional().default([]),
    trialResults: z
      .array(
        z
          .object({
            task: z.string(),
            status: z.enum(["untested", "passed", "failed", "skipped"]),
            note: z.string(),
            updatedAt: z.string().optional(),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    pairwiseTrials: z.array(z.object({
      id: z.string(),
      firstProduct: z.string(),
      secondProduct: z.string(),
      task: z.string(),
      outcome: z.enum(["untested", "first", "second", "tie"]),
      note: z.string(),
      updatedAt: z.string().optional(),
    }).passthrough()).optional().default([]),
    conflicts: z.array(evidenceConflictSchema).optional(),
    confidenceCalibrations: z.array(confidenceCalibrationSchema).optional(),
    redactedAt: z.string().optional(),
  })
  .passthrough();

const portableReportSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    exportedAt: z.string(),
    report: savedReportSchema,
  })
  .strict();

export interface SavedReport {
  id: string;
  title: string;
  savedAt: string;
  urls: string[];
  context: string;
  priorities: PriorityWeights;
  criteria: ComparisonCriterion[];
  result: ComparisonResult;
  notes: string;
  locale: Locale;
  revisions: ComparisonResult[];
  trialResults: TrialResult[];
  pairwiseTrials?: PairwiseTrialResult[];
  conflicts: EvidenceConflict[];
  confidenceCalibrations: ConfidenceCalibration[];
  redactedAt?: string;
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
  const evidence = activeEvidence(product.evidence);
  const verified = evidence.filter(
    (item) => item.level === "verified",
  ).length;
  const vendor = evidence.filter(
    (item) => item.level === "vendor",
  ).length;
  const inferred = evidence.filter(
    (item) => item.level === "inferred",
  ).length;
  const sourceCount = new Set(
    evidence.map((item) => item.sourceUrl),
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
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      report,
    },
    null,
    2,
  );
}

export function normalizeSavedReport(input: unknown): SavedReport {
  const report = savedReportSchema.parse(input);
  const conflicts = detectEvidenceConflicts(report.result);
  const productNames = new Set(report.result.products.map((product) => product.name));
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
    trialResults:
      report.trialResults?.length
        ? report.trialResults
        : report.result.trialPlan.map((task) => ({
            task: task.task,
            status: "untested" as const,
            note: "",
          })),
    pairwiseTrials: (report.pairwiseTrials ?? []).filter(
      (trial) =>
        trial.firstProduct !== trial.secondProduct &&
        productNames.has(trial.firstProduct) &&
        productNames.has(trial.secondProduct),
    ),
    conflicts,
    confidenceCalibrations: calibrateComparisonConfidence(
      report.result.products,
      conflicts,
    ),
  } as SavedReport;
}

export function parseReport(input: string): SavedReport {
  const parsed = portableReportSchema.parse(JSON.parse(input));
  return normalizeSavedReport(parsed.report);
}
