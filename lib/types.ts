export type EvidenceLevel = "verified" | "vendor" | "inferred";

export type PriorityKey = string;

export type PriorityWeights = Record<PriorityKey, number>;

export interface ComparisonCriterion {
  key: string;
  label: string;
  hint: string;
  weight: number;
}

export interface Evidence {
  claim: string;
  level: EvidenceLevel;
  sourceLabel: string;
  sourceUrl: string;
  origin?: "collected" | "manual";
  capturedAt?: string;
}

export type BillingCadence =
  | "free"
  | "monthly"
  | "yearly"
  | "one-time"
  | "usage-based"
  | "custom"
  | "unknown";

export interface PricingPlan {
  name: string;
  price: string;
  cadence: BillingCadence;
  audience: string;
  limits: string[];
  sourceUrl: string;
  evidenceLevel: EvidenceLevel;
}

export interface ProductPricing {
  hasFreeOption: boolean | null;
  summary: string;
  plans: PricingPlan[];
  uncertainty: string;
}

export type PrivacyCategory =
  | "telemetry"
  | "account"
  | "retention"
  | "permissions"
  | "encryption"
  | "selfHosting";

export type PrivacyFindingStatus = "positive" | "caution" | "unknown";

export interface PrivacyFinding {
  category: PrivacyCategory;
  status: PrivacyFindingStatus;
  finding: string;
  evidenceLevel: EvidenceLevel;
  sourceUrl: string;
  uncertainty: string;
}

export interface PrivacySecurityReview {
  summary: string;
  riskLevel: "low" | "medium" | "high" | "unknown";
  findings: PrivacyFinding[];
}

export interface ProductResult {
  name: string;
  tagline: string;
  url: string;
  repoUrl?: string;
  score: number;
  confidence: number;
  sourceMode: "open-source" | "website-only";
  verdict: string;
  strengths: string[];
  tradeoffs: string[];
  evidence: Evidence[];
  pricing?: ProductPricing;
  privacy?: PrivacySecurityReview;
}

export interface DimensionResult {
  key: PriorityKey;
  label: string;
  weight: number;
  productScores: Record<string, number>;
  winner: string | "tie";
  explanation: string;
}

export interface TrialTask {
  task: string;
  reason: string;
}

export type TrialStatus = "untested" | "passed" | "failed" | "skipped";

export interface TrialResult {
  task: string;
  status: TrialStatus;
  note: string;
  updatedAt?: string;
}

export interface ComparisonResult {
  title: string;
  generatedAt: string;
  recommendation: {
    winner: string;
    summary: string;
    reasons: string[];
    switchWhen: string;
  };
  products: ProductResult[];
  dimensions: DimensionResult[];
  unknowns: string[];
  trialPlan: TrialTask[];
}

export interface AnalyzeRequest {
  urls: [string, string];
  context: string;
  criteria: ComparisonCriterion[];
  locale: Locale;
}
import type { Locale } from "@/lib/i18n";
