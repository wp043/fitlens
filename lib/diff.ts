import { criteriaToWeights } from "./criteria.ts";
import { calculateWeightedWinner } from "./scoring.ts";
import type {
  ComparisonCriterion,
  ComparisonResult,
  EvidenceLevel,
} from "./types.ts";

export interface NumericChange {
  before: number;
  after: number;
  delta: number;
}

export interface ProductScoreChange extends NumericChange {
  product: string;
}

export interface EvidenceChange {
  product: string;
  total: NumericChange;
  levels: Record<EvidenceLevel, NumericChange>;
}

export interface DimensionScoreChange extends NumericChange {
  key: string;
  label: string;
  product: string;
}

export interface ComparisonDiff {
  from: string;
  to: string;
  previousWinner?: string;
  currentWinner?: string;
  winnerChanged: boolean;
  scoreChanges: ProductScoreChange[];
  evidenceChanges: EvidenceChange[];
  dimensionChanges: DimensionScoreChange[];
  addedUnknowns: string[];
  removedUnknowns: string[];
  hasChanges: boolean;
}

function numericChange(before: number, after: number): NumericChange {
  return { before, after, delta: after - before };
}

function evidenceCount(
  result: ComparisonResult,
  productName: string,
  level?: EvidenceLevel,
) {
  const product = result.products.find((item) => item.name === productName);
  if (!product) return 0;
  return level
    ? product.evidence.filter((item) => item.level === level).length
    : product.evidence.length;
}

export function compareResults(
  previous: ComparisonResult,
  current: ComparisonResult,
  criteria: ComparisonCriterion[],
): ComparisonDiff {
  const weights = criteriaToWeights(criteria);
  const previousDecision = calculateWeightedWinner(previous, weights);
  const currentDecision = calculateWeightedWinner(current, weights);
  const productNames = Array.from(
    new Set([
      ...previous.products.map((product) => product.name),
      ...current.products.map((product) => product.name),
    ]),
  );

  const scoreChanges = productNames.map((product) => ({
    product,
    ...numericChange(
      previousDecision.normalized[product] ?? 0,
      currentDecision.normalized[product] ?? 0,
    ),
  }));

  const levels: EvidenceLevel[] = ["verified", "vendor", "inferred"];
  const evidenceChanges = productNames.map((product) => ({
    product,
    total: numericChange(
      evidenceCount(previous, product),
      evidenceCount(current, product),
    ),
    levels: Object.fromEntries(
      levels.map((level) => [
        level,
        numericChange(
          evidenceCount(previous, product, level),
          evidenceCount(current, product, level),
        ),
      ]),
    ) as Record<EvidenceLevel, NumericChange>,
  }));

  const previousDimensions = new Map(
    previous.dimensions.map((dimension) => [dimension.key, dimension]),
  );
  const dimensionChanges = current.dimensions.flatMap((dimension) => {
    const before = previousDimensions.get(dimension.key);
    const dimensionProducts = Array.from(
      new Set([
        ...Object.keys(before?.productScores ?? {}),
        ...Object.keys(dimension.productScores),
      ]),
    );
    return dimensionProducts
      .map((product) => ({
        key: dimension.key,
        label: dimension.label,
        product,
        ...numericChange(
          before?.productScores[product] ?? 0,
          dimension.productScores[product] ?? 0,
        ),
      }))
      .filter((change) => change.delta !== 0);
  });

  const previousUnknowns = new Set(previous.unknowns);
  const currentUnknowns = new Set(current.unknowns);
  const addedUnknowns = current.unknowns.filter(
    (unknown) => !previousUnknowns.has(unknown),
  );
  const removedUnknowns = previous.unknowns.filter(
    (unknown) => !currentUnknowns.has(unknown),
  );
  const winnerChanged =
    previousDecision.winner !== currentDecision.winner;
  const hasChanges =
    winnerChanged ||
    scoreChanges.some((change) => change.delta !== 0) ||
    evidenceChanges.some(
      (change) =>
        change.total.delta !== 0 ||
        levels.some((level) => change.levels[level].delta !== 0),
    ) ||
    dimensionChanges.length > 0 ||
    addedUnknowns.length > 0 ||
    removedUnknowns.length > 0;

  return {
    from: previous.generatedAt,
    to: current.generatedAt,
    previousWinner: previousDecision.winner,
    currentWinner: currentDecision.winner,
    winnerChanged,
    scoreChanges,
    evidenceChanges,
    dimensionChanges,
    addedUnknowns,
    removedUnknowns,
    hasChanges,
  };
}
