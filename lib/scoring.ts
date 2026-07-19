import type {
  ComparisonResult,
  PriorityWeights,
} from "@/lib/types";

export function calculateWeightedWinner(
  result: ComparisonResult,
  priorities: PriorityWeights,
) {
  const totals: Record<string, number> = {};
  const totalWeight =
    Object.values(priorities).reduce((sum, value) => sum + value, 0) / 100;
  for (const product of result.products) totals[product.name] = 0;

  for (const dimension of result.dimensions) {
    const weight = priorities[dimension.key] / 100;
    for (const [product, score] of Object.entries(dimension.productScores)) {
      totals[product] = (totals[product] ?? 0) + score * weight;
    }
  }

  const normalized = Object.fromEntries(
    Object.entries(totals).map(([product, total]) => [
      product,
      totalWeight > 0 ? Math.round(total / totalWeight) : 0,
    ]),
  );

  return {
    winner: Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0],
    totals,
    normalized,
  };
}
