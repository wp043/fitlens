import { calibrateComparisonConfidence } from "./confidence.ts";
import { detectEvidenceConflicts } from "./conflicts.ts";
import type { SavedReport } from "./report.ts";
import type { ComparisonResult } from "./types.ts";

export interface RedactionSummary {
  manualEvidenceRemoved: number;
  trialResultsRemoved: number;
  revisionsRemoved: number;
}

/**
 * Build a public-facing result without mutating the locally saved report.
 * Generated conclusions remain useful, while user-authored evidence and trial
 * details never cross the sharing boundary.
 */
export function redactComparisonResult(
  result: ComparisonResult,
): ComparisonResult {
  return {
    ...result,
    products: result.products.map((product) => ({
      ...product,
      evidence: product.evidence
        .filter((item) => item.origin !== "manual")
        .map((item) => ({ ...item })),
      strengths: [...product.strengths],
      tradeoffs: [...product.tradeoffs],
      pricing: product.pricing
        ? {
            ...product.pricing,
            plans: product.pricing.plans.map((plan) => ({
              ...plan,
              limits: [...plan.limits],
            })),
          }
        : undefined,
    })),
    dimensions: result.dimensions.map((dimension) => ({
      ...dimension,
      productScores: { ...dimension.productScores },
    })),
    recommendation: {
      ...result.recommendation,
      reasons: [...result.recommendation.reasons],
    },
    unknowns: [...result.unknowns],
    trialPlan: [],
  };
}

export function createRedactedReport(
  report: SavedReport,
  redactedAt = new Date().toISOString(),
): { report: SavedReport; summary: RedactionSummary } {
  const manualEvidenceRemoved = report.result.products.reduce(
    (count, product) =>
      count + product.evidence.filter((item) => item.origin === "manual").length,
    0,
  );
  const result = redactComparisonResult(report.result);
  const conflicts = detectEvidenceConflicts(result);

  return {
    report: {
      ...report,
      id: "shared-report",
      context: "",
      criteria: report.criteria.map((criterion) => ({
        ...criterion,
        hint: "",
      })),
      result,
      notes: "",
      revisions: [],
      trialResults: [],
      conflicts,
      confidenceCalibrations: calibrateComparisonConfidence(
        result.products,
        conflicts,
        new Date(result.generatedAt),
      ),
      redactedAt,
    },
    summary: {
      manualEvidenceRemoved,
      trialResultsRemoved: report.trialResults.length,
      revisionsRemoved: report.revisions.length,
    },
  };
}
