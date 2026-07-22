import type { ComparisonCriterion } from "./types.ts";

export interface DecisionProfile {
  id: string;
  name: string;
  context: string;
  criteria: ComparisonCriterion[];
  createdAt: string;
}

export function normalizeDecisionProfiles(input: unknown): DecisionProfile[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const profile = value as Partial<DecisionProfile>;
    if (
      typeof profile.id !== "string" ||
      typeof profile.name !== "string" ||
      typeof profile.context !== "string" ||
      profile.name.trim().length === 0 ||
      profile.context.trim().length < 10 ||
      typeof profile.createdAt !== "string" ||
      !Array.isArray(profile.criteria) ||
      profile.criteria.length < 2 ||
      profile.criteria.length > 8
    ) return [];
    const criteria = profile.criteria.filter(
      (criterion): criterion is ComparisonCriterion =>
        Boolean(criterion) &&
        typeof criterion.key === "string" &&
        typeof criterion.label === "string" &&
        typeof criterion.hint === "string" &&
        typeof criterion.weight === "number" &&
        criterion.weight >= 0 &&
        criterion.weight <= 100,
    );
    if (criteria.length !== profile.criteria.length) return [];
    if (new Set(criteria.map((criterion) => criterion.key)).size !== criteria.length) return [];
    return [{
      id: profile.id,
      name: profile.name.trim(),
      context: profile.context,
      criteria,
      createdAt: profile.createdAt,
    }];
  });
}
