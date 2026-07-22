import type { ProductResult } from "./types.ts";
import { activeEvidence } from "./evidence.ts";

export type FreshnessStatus = "fresh" | "aging" | "stale" | "unknown";

export interface EvidenceFreshness {
  latest?: string;
  fresh: number;
  aging: number;
  stale: number;
  unknown: number;
}

export function getFreshnessStatus(
  capturedAt: string | undefined,
  now = new Date(),
): FreshnessStatus {
  if (!capturedAt) return "unknown";
  const timestamp = Date.parse(capturedAt);
  if (Number.isNaN(timestamp)) return "unknown";
  const ageDays = Math.max(0, now.getTime() - timestamp) / 86_400_000;
  if (ageDays <= 14) return "fresh";
  if (ageDays <= 30) return "aging";
  return "stale";
}

export function calculateEvidenceFreshness(
  product: ProductResult,
  now = new Date(),
): EvidenceFreshness {
  const result: EvidenceFreshness = {
    fresh: 0,
    aging: 0,
    stale: 0,
    unknown: 0,
  };
  const timestamps = activeEvidence(product.evidence)
    .map((evidence) => evidence.capturedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => !Number.isNaN(value));
  if (timestamps.length > 0) {
    result.latest = new Date(Math.max(...timestamps)).toISOString();
  }
  for (const evidence of activeEvidence(product.evidence)) {
    result[getFreshnessStatus(evidence.capturedAt, now)] += 1;
  }
  return result;
}
