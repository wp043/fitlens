import type { PairwiseTrialResult } from "./types.ts";

export interface PairwiseStanding {
  product: string;
  wins: number;
  losses: number;
  ties: number;
  points: number;
}

export function calculatePairwiseStandings(
  products: string[],
  trials: PairwiseTrialResult[],
) {
  const standings = new Map(
    products.map((product) => [
      product,
      { product, wins: 0, losses: 0, ties: 0, points: 0 },
    ]),
  );
  for (const trial of trials) {
    const first = standings.get(trial.firstProduct);
    const second = standings.get(trial.secondProduct);
    if (!first || !second || first === second) continue;
    if (trial.outcome === "first") {
      first.wins += 1;
      first.points += 3;
      second.losses += 1;
    } else if (trial.outcome === "second") {
      second.wins += 1;
      second.points += 3;
      first.losses += 1;
    } else if (trial.outcome === "tie") {
      first.ties += 1;
      second.ties += 1;
      first.points += 1;
      second.points += 1;
    }
  }
  return [...standings.values()].sort(
    (left, right) =>
      right.points - left.points ||
      right.wins - left.wins ||
      left.product.localeCompare(right.product),
  );
}
