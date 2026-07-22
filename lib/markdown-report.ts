import type { ComparisonResult } from "./types.ts";

export function comparisonToMarkdown(result: ComparisonResult) {
  const products = result.products.map((product) => `## ${product.name} — ${product.score}/100

${product.verdict}

### Evidence
${product.evidence
  .filter((item) => item.reviewStatus !== "rejected")
  .map((item) => `- **${item.level}:** ${item.claim} ([${item.sourceLabel}](${item.sourceUrl}))`)
  .join("\n")}

### Strengths
${product.strengths.map((item) => `- ${item}`).join("\n")}

### Tradeoffs
${product.tradeoffs.map((item) => `- ${item}`).join("\n")}`).join("\n\n");

  return `# ${result.title}

Generated: ${result.generatedAt}

## Recommendation: ${result.recommendation.winner}

${result.recommendation.summary}

${result.recommendation.reasons.map((item) => `- ${item}`).join("\n")}

**Choose differently when:** ${result.recommendation.switchWhen}

${products}

## Unknowns
${result.unknowns.map((item) => `- ${item}`).join("\n")}

## Trial plan
${result.trialPlan.map((item, index) => `${index + 1}. **${item.task}** — ${item.reason}`).join("\n")}
`;
}
