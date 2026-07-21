import type { ComparisonResult, Evidence } from "./types.ts";

function evidenceIdentity(evidence: Evidence) {
  return `${evidence.claim}\u0000${evidence.sourceUrl}`;
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
      const manualEvidence = previousProduct.evidence.filter(
        (evidence) => evidence.origin === "manual",
      );
      return {
        ...product,
        evidence: [
          ...product.evidence,
          ...manualEvidence.filter(
            (evidence) => !existing.has(evidenceIdentity(evidence)),
          ),
        ],
      };
    }),
  };
}
