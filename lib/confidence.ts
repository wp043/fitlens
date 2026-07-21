import type { EvidenceConflict } from "./conflicts.ts";
import { getFreshnessStatus } from "./freshness.ts";
import type { ProductResult } from "./types.ts";

export type ConfidenceBand = "strong" | "moderate" | "limited";
export type ConfidenceFactorKey =
  | "directVerification"
  | "sourceDiversity"
  | "freshness"
  | "transparency"
  | "limitedSources"
  | "inferenceHeavy"
  | "conflicts";

export interface ConfidenceFactor {
  key: ConfidenceFactorKey;
  effect: "supporting" | "limiting";
  value: number;
}

export interface ConfidenceCalibration {
  product: string;
  score: number;
  band: ConfidenceBand;
  verified: number;
  vendor: number;
  inferred: number;
  sourceCount: number;
  factors: ConfidenceFactor[];
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function calibrateProductConfidence(
  product: ProductResult,
  conflicts: EvidenceConflict[] = [],
  now = new Date(),
): ConfidenceCalibration {
  const verified = product.evidence.filter((item) => item.level === "verified").length;
  const vendor = product.evidence.filter((item) => item.level === "vendor").length;
  const inferred = product.evidence.filter((item) => item.level === "inferred").length;
  const total = verified + vendor + inferred;
  const sourceCount = new Set(product.evidence.map((item) => item.sourceUrl)).size;
  const directVerification = total ? (verified / total) * 100 : 0;
  const evidenceQuality = total
    ? (verified * 100 + vendor * 55 + inferred * 25) / total
    : 0;
  const sourceDiversity = Math.min(sourceCount / 3, 1) * 100;
  const freshnessValues = product.evidence.map((item) => {
    const status = getFreshnessStatus(item.capturedAt, now);
    return { fresh: 100, aging: 65, stale: 25, unknown: 40 }[status];
  });
  const freshness = freshnessValues.length
    ? freshnessValues.reduce((sum, value) => sum + value, 0) / freshnessValues.length
    : 0;
  const transparency = product.sourceMode === "open-source" ? 100 : 45;
  const productConflicts = conflicts.filter((item) => item.product === product.name);
  const conflictPenalty = productConflicts.reduce(
    (sum, conflict) => sum + (conflict.severity === "high" ? 15 : 8),
    0,
  );
  const limitedSourcePenalty = sourceCount <= 1 ? 8 : 0;
  const noDirectPenalty = verified === 0 ? 10 : 0;
  const inferencePenalty = inferred > verified + vendor ? 7 : 0;
  const score = clamp(
    evidenceQuality * 0.45 +
      sourceDiversity * 0.2 +
      freshness * 0.2 +
      transparency * 0.15 -
      conflictPenalty -
      limitedSourcePenalty -
      noDirectPenalty -
      inferencePenalty,
  );
  const factors: ConfidenceFactor[] = [
    {
      key: "directVerification",
      effect: verified > 0 ? "supporting" : "limiting",
      value: clamp(directVerification),
    },
    {
      key: "sourceDiversity",
      effect: sourceCount >= 2 ? "supporting" : "limiting",
      value: sourceCount,
    },
    {
      key: "freshness",
      effect: freshness >= 60 ? "supporting" : "limiting",
      value: clamp(freshness),
    },
    {
      key: "transparency",
      effect: product.sourceMode === "open-source" ? "supporting" : "limiting",
      value: clamp(transparency),
    },
  ];
  if (sourceCount <= 1) {
    factors.push({ key: "limitedSources", effect: "limiting", value: sourceCount });
  }
  if (verified === 0 || inferred > verified + vendor) {
    factors.push({ key: "inferenceHeavy", effect: "limiting", value: inferred });
  }
  if (productConflicts.length) {
    factors.push({ key: "conflicts", effect: "limiting", value: productConflicts.length });
  }

  return {
    product: product.name,
    score,
    band: score >= 75 ? "strong" : score >= 50 ? "moderate" : "limited",
    verified,
    vendor,
    inferred,
    sourceCount,
    factors,
  };
}

export function calibrateComparisonConfidence(
  products: ProductResult[],
  conflicts: EvidenceConflict[] = [],
  now = new Date(),
) {
  return products.map((product) => calibrateProductConfidence(product, conflicts, now));
}
