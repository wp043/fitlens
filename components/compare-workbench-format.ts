import type { Locale, Messages } from "../lib/i18n.ts";
import {
  calibrateComparisonConfidence,
  type ConfidenceCalibration,
  type ConfidenceFactor,
} from "../lib/confidence.ts";
import type { EvidenceConflict } from "../lib/conflicts.ts";
import type {
  BillingCadence,
  ComparisonResult,
  EvidenceLevel,
  PairwiseTrialResult,
  PrivacyCategory,
  PrivacyFindingStatus,
  PrivacySecurityReview,
  TrialResult,
  TrialStatus,
} from "../lib/types.ts";

export function formatDelta(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

export function conflictTopicLabel(topic: string, t: Messages) {
  return {
    openSource: t.conflictTopicOpenSource,
    pricing: t.conflictTopicPricing,
    account: t.conflictTopicAccount,
    telemetry: t.conflictTopicTelemetry,
    offline: t.conflictTopicOffline,
    selfHosting: t.conflictTopicSelfHosting,
    other: t.conflictTopicOther,
  }[topic] ?? t.conflictTopicOther;
}

export function cadenceLabel(cadence: BillingCadence, t: Messages) {
  return {
    free: t.cadenceFree,
    monthly: t.cadenceMonthly,
    yearly: t.cadenceYearly,
    "one-time": t.cadenceOneTime,
    "usage-based": t.cadenceUsageBased,
    custom: t.cadenceCustom,
    unknown: t.cadenceUnknown,
  }[cadence];
}

export function privacyCategoryLabel(category: PrivacyCategory, t: Messages) {
  return {
    telemetry: t.privacyTelemetry,
    account: t.privacyAccount,
    retention: t.privacyRetention,
    permissions: t.privacyPermissions,
    encryption: t.privacyEncryption,
    selfHosting: t.privacySelfHosting,
  }[category];
}

export function privacyStatusLabel(status: PrivacyFindingStatus, t: Messages) {
  return {
    positive: t.privacyPositive,
    caution: t.privacyCaution,
    unknown: t.privacyUnknown,
  }[status];
}

export function privacyRiskLabel(
  riskLevel: PrivacySecurityReview["riskLevel"],
  t: Messages,
) {
  return {
    low: t.privacyRiskLow,
    medium: t.privacyRiskMedium,
    high: t.privacyRiskHigh,
    unknown: t.privacyRiskUnknown,
  }[riskLevel];
}

export function confidenceBandLabel(
  calibration: ConfidenceCalibration,
  t: Messages,
) {
  return {
    strong: t.confidenceStrong,
    moderate: t.confidenceModerate,
    limited: t.confidenceLimited,
  }[calibration.band];
}

export function confidenceFactorLabel(factor: ConfidenceFactor, t: Messages) {
  switch (factor.key) {
    case "directVerification":
      return `${t.confidenceDirect}: ${factor.value}%`;
    case "sourceDiversity":
      return `${t.confidenceDiversity}: ${factor.value}`;
    case "freshness":
      return `${t.confidenceFreshness}: ${factor.value}%`;
    case "transparency":
      return t.confidenceTransparency;
    case "limitedSources":
      return t.confidenceLimitedSources;
    case "inferenceHeavy":
      return t.confidenceInferenceHeavy;
    case "conflicts":
      return `${t.confidenceConflicts}: ${factor.value}`;
  }
}

export function comparisonAsMarkdown(
  result: ComparisonResult,
  notes: string,
  locale: Locale,
  t: Messages,
  trialResults: TrialResult[] = [],
  conflicts: EvidenceConflict[] = [],
  redacted = false,
  pairwiseTrials: PairwiseTrialResult[] = [],
) {
  const evidenceLabels: Record<EvidenceLevel, string> = {
    verified: t.verified,
    vendor: t.vendor,
    inferred: t.inferred,
  };
  const trialStatusLabels: Record<TrialStatus, string> = {
    untested: t.trialUntested,
    passed: t.trialPassed,
    failed: t.trialFailed,
    skipped: t.trialSkipped,
  };
  const calibrations = calibrateComparisonConfidence(
    result.products,
    conflicts,
    new Date(result.generatedAt),
  );
  const productSections = result.products
    .map((product) => {
      const pricing = product.pricing;
      const pricingSection = pricing
        ? `### ${t.markdownPricing}
${pricing.summary}

${pricing.plans.length > 0
  ? pricing.plans
      .map(
        (plan) =>
          `- **${plan.name}: ${plan.price} · ${cadenceLabel(plan.cadence, t)}** — ${t.pricingAudience}: ${plan.audience}${plan.limits.length ? `; ${t.pricingLimits}: ${plan.limits.join("; ")}` : ""} ([${evidenceLabels[plan.evidenceLevel]}](${plan.sourceUrl}))`,
      )
      .join("\n")
  : `- ${t.pricingNoPlans}`}

**${t.pricingUncertainty}:** ${pricing.uncertainty}

`
        : "";
      const privacy = product.privacy;
      const privacySection = privacy
        ? `### ${t.markdownPrivacy}: ${t.privacyRisk} — ${privacyRiskLabel(privacy.riskLevel, t)}
${privacy.summary}

${privacy.findings
  .map(
    (finding) =>
      `- **${privacyCategoryLabel(finding.category, t)} · ${privacyStatusLabel(finding.status, t)}:** ${finding.finding} ([${evidenceLabels[finding.evidenceLevel]}](${finding.sourceUrl}))\n  - ${t.privacyUncertainty}: ${finding.uncertainty}`,
  )
  .join("\n")}

`
        : "";
      const calibration = calibrations.find(
        (item) => item.product === product.name,
      )!;
      return `## ${product.name} — ${product.score}/100

${product.verdict}

### ${t.markdownConfidence}: ${calibration.score}/100 · ${confidenceBandLabel(calibration, t)}
${t.confidenceMethod}

- ${t.verified}: ${calibration.verified}; ${t.vendor}: ${calibration.vendor}; ${t.inferred}: ${calibration.inferred}; ${t.sources}: ${calibration.sourceCount}
${calibration.factors.map((factor) => `- **${factor.effect === "supporting" ? t.confidenceSupporting : t.confidenceLimiting}:** ${confidenceFactorLabel(factor, t)}`).join("\n")}

### ${t.markdownStrengths}
${product.strengths.map((item) => `- ${item}`).join("\n")}

### ${t.markdownTradeoffs}
${product.tradeoffs.map((item) => `- ${item}`).join("\n")}

${pricingSection}${privacySection}### ${t.markdownEvidence}
${product.evidence
  .filter((item) => item.reviewStatus !== "rejected")
  .map(
    (item) =>
      `- **${evidenceLabels[item.level]}:** ${item.claim} ([${item.sourceLabel}](${item.sourceUrl}))`,
  )
  .join("\n")}`;
    })
    .join("\n\n");
  const conflictSection = conflicts.length
    ? `## ${t.markdownConflicts}\n${conflicts
        .map(
          (conflict) =>
            `- **${conflict.product} · ${conflictTopicLabel(conflict.topic, t)} (${conflict.severity === "high" ? t.conflictHigh : t.conflictMedium})**\n  - ${conflict.first.claim} ([${conflict.first.sourceLabel}](${conflict.first.sourceUrl}))\n  - ${conflict.second.claim} ([${conflict.second.sourceLabel}](${conflict.second.sourceUrl}))`,
        )
        .join("\n")}\n\n`
    : "";

  const trialSection = redacted
    ? ""
    : `## ${t.markdownTrial}\n${result.trialPlan
        .map((item, index) => {
          const trial = trialResults[index];
          const status = trial ? ` [${trialStatusLabels[trial.status]}]` : "";
          const note = trial?.note.trim() ? ` — ${trial.note.trim()}` : "";
          return `${index + 1}. **${item.task}**${status} — ${item.reason}${note}`;
        })
        .join("\n")}\n\n`;
  const pairwiseSection =
    redacted || pairwiseTrials.length === 0
      ? ""
      : `## ${t.pairwiseTitle}\n${pairwiseTrials
          .map((trial) => {
            const outcome = {
              untested: t.pairwiseUntested,
              first: t.pairwiseFirstWins.replace(
                "{product}",
                trial.firstProduct,
              ),
              second: t.pairwiseSecondWins.replace(
                "{product}",
                trial.secondProduct,
              ),
              tie: t.pairwiseTie,
            }[trial.outcome];
            return `- **${trial.firstProduct} vs ${trial.secondProduct}: ${outcome}** — ${trial.task}${trial.note ? `; ${trial.note}` : ""}`;
          })
          .join("\n")}\n\n`;

  return `# ${result.title}

${t.markdownAnalyzed}: ${new Date(result.generatedAt).toLocaleString(locale)}.

${redacted ? `> ${t.redactedDisclosure}\n\n` : ""}## ${t.markdownRecommendation}: ${result.recommendation.winner}

${result.recommendation.summary}

${result.recommendation.reasons.map((item) => `- ${item}`).join("\n")}

**${t.markdownChooseDifferently}:** ${result.recommendation.switchWhen}

${productSections}

${conflictSection}## ${t.markdownUnknowns}
${result.unknowns.map((item) => `- ${item}`).join("\n")}

${trialSection}${pairwiseSection}${notes.trim() ? `## ${t.markdownNotes}\n${notes.trim()}\n\n` : ""}---
${t.generatedBy} · ${new Date(result.generatedAt).toLocaleDateString(locale)}.
`;
}

export function safeFilename(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "fitlens-report"
  );
}
