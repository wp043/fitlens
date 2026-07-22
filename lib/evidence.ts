import type { ComparisonResult, Evidence } from "./types.ts";

function evidenceIdentity(evidence: Evidence) {
  return `${evidence.originalClaim ?? evidence.claim}\u0000${evidence.sourceUrl}`;
}

export function activeEvidence(evidence: Evidence[]) {
  return evidence.filter((item) => item.reviewStatus !== "rejected");
}

function preserveReview(previous: Evidence, current: Evidence): Evidence {
  return {
    ...current,
    claim: previous.originalClaim ? previous.claim : current.claim,
    originalClaim: previous.originalClaim,
    reviewStatus: previous.reviewStatus,
    reviewNote: previous.reviewNote,
    reviewedAt: previous.reviewedAt,
  };
}

export function mergeManualEvidence(
  previous: ComparisonResult,
  current: ComparisonResult,
): ComparisonResult {
  return {
    ...current,
    products: current.products.map((product) => {
      const previousProduct = previous.products.find(
        (item) => item.name === product.name,
      );
      if (!previousProduct) return product;
      const existing = new Set(product.evidence.map(evidenceIdentity));
      const previousByIdentity = new Map(
        previousProduct.evidence.map((evidence) => [
          evidenceIdentity(evidence),
          evidence,
        ]),
      );
      const manualEvidence = previousProduct.evidence.filter(
        (evidence) => evidence.origin === "manual",
      );
      return {
        ...product,
        evidence: [
          ...product.evidence.map((evidence) => {
            const previousEvidence = previousByIdentity.get(
              evidenceIdentity(evidence),
            );
            return previousEvidence
              ? preserveReview(previousEvidence, evidence)
              : evidence;
          }),
          ...manualEvidence.filter(
            (evidence) => !existing.has(evidenceIdentity(evidence)),
          ),
        ],
      };
    }),
  };
}
