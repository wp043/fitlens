import type { ComparisonDiff } from "./diff.ts";
import type { ComparisonResult } from "./types.ts";

/**
 * Conditions a scheduled watch can alert on. `confidence` needs a threshold and
 * fires on the first run too; the others describe a change from the previous
 * snapshot and only fire once a comparison exists.
 */
export type WatchAlertCondition = "winner" | "confidence" | "unknowns" | "any";

export const WATCH_ALERT_CONDITIONS: readonly WatchAlertCondition[] = [
  "winner",
  "confidence",
  "unknowns",
  "any",
];

export function parseAlertConditions(input: string): WatchAlertCondition[] {
  const parsed = input
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const invalid = parsed.filter(
    (token) => !WATCH_ALERT_CONDITIONS.includes(token as WatchAlertCondition),
  );
  if (invalid.length > 0) {
    throw new Error(
      `Unknown alert condition: ${invalid.join(", ")}. Use ${WATCH_ALERT_CONDITIONS.join(", ")}.`,
    );
  }
  return parsed as WatchAlertCondition[];
}

export interface WatchAlert {
  entryId: string;
  winner: string;
  confidence?: number;
  /** Human-readable reasons, one per triggered condition. */
  reasons: string[];
}

function winnerConfidence(result: ComparisonResult) {
  return result.products.find(
    (product) => product.name === result.recommendation.winner,
  )?.confidence;
}

/**
 * Decide whether a completed watch run should raise an alert. Pure and
 * snapshot-free so it can be unit tested and reused by any scheduler wrapper.
 * Returns undefined when nothing crosses a configured condition.
 */
export function evaluateWatchAlert(options: {
  entryId: string;
  result: ComparisonResult;
  change?: ComparisonDiff;
  conditions: WatchAlertCondition[];
  minConfidence?: number;
}): WatchAlert | undefined {
  const { entryId, result, change, conditions, minConfidence } = options;
  const wants = new Set(conditions);
  const confidence = winnerConfidence(result);
  const reasons: string[] = [];

  // A confidence threshold implies the condition even if not listed explicitly,
  // so `--min-confidence` alone is enough to gate on.
  if (
    (wants.has("confidence") || minConfidence !== undefined) &&
    minConfidence !== undefined &&
    confidence !== undefined &&
    confidence < minConfidence
  ) {
    reasons.push(`winner confidence ${confidence}% is below ${minConfidence}%`);
  }

  if (change) {
    if (wants.has("winner") && change.winnerChanged) {
      reasons.push(
        `winner changed from ${change.previousWinner ?? "unknown"} to ${change.currentWinner ?? "unknown"}`,
      );
    }
    if (wants.has("unknowns") && change.addedUnknowns.length > 0) {
      reasons.push(`${change.addedUnknowns.length} new unknown(s)`);
    }
    if (wants.has("any") && change.hasChanges) {
      reasons.push("the comparison changed since the last run");
    }
  }

  if (reasons.length === 0) return undefined;
  return { entryId, winner: result.recommendation.winner, confidence, reasons };
}

export interface WatchAlertReport {
  generatedAt: string;
  alerts: WatchAlert[];
}

/** One line per alert, for a terminal or a scheduler log. */
export function formatWatchAlerts(alerts: WatchAlert[]) {
  return alerts
    .map((alert) => `ALERT ${alert.entryId}: ${alert.reasons.join("; ")}`)
    .join("\n");
}
