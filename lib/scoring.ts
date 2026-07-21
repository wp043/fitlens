import type {
  ComparisonResult,
  PriorityWeights,
} from "@/lib/types";

export function calculateWeightedWinner(
  result: ComparisonResult,
  priorities: PriorityWeights,
) {
  const totals: Record<string, number> = {};
  const productNames = new Set(result.products.map((product) => product.name));
  let totalWeight = 0;
  for (const product of result.products) totals[product.name] = 0;

  for (const dimension of result.dimensions) {
    const requestedWeight = priorities[dimension.key];
    if (requestedWeight === undefined) continue;
    const weight = requestedWeight / 100;
    totalWeight += weight;
    for (const [product, score] of Object.entries(dimension.productScores)) {
      if (!productNames.has(product)) continue;
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
