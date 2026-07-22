export type EvidenceLevel = "verified" | "vendor" | "inferred";
export type EvidenceReviewStatus = "unreviewed" | "accepted" | "rejected";

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
  originalClaim?: string;
  level: EvidenceLevel;
  sourceLabel: string;
  sourceUrl: string;
  origin?: "collected" | "manual";
  capturedAt?: string;
  reviewStatus?: EvidenceReviewStatus;
  reviewNote?: string;
  reviewedAt?: string;
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

export type PairwiseTrialOutcome = "untested" | "first" | "second" | "tie";

export interface PairwiseTrialResult {
  id: string;
  firstProduct: string;
  secondProduct: string;
  task: string;
  outcome: PairwiseTrialOutcome;
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
  /** Non-secret provenance for auditing how this result was produced. */
  analysisRun?: AnalysisRunManifest;
  /** Local-only material for a zero-network, zero-model-cost replay. */
  replayBundle?: AnalysisReplayBundle;
}

export interface AnalysisRunFailure {
  stage: "request" | "source" | "model" | "finalize" | "replay";
  code: string;
}

export interface AnalysisSourceManifest {
  inputUrl: string;
  contentHash: string;
  documentHashes: Array<{ kind: string; url: string; contentHash: string }>;
}

export interface AnalysisRunManifest {
  schemaVersion: 1;
  runId: string;
  status: "complete" | "failed";
  provider: { kind: "openai" | "compatible" | "bundled-sample" | "replay"; model: string };
  versions: { prompt: string; schema: string; adapter: string; replay: string };
  requestHash: string;
  /** Present when a validated model payload exists (live or replay runs). */
  modelOutputHash?: string;
  sources: AnalysisSourceManifest[];
  timing: { startedAt: string; finishedAt: string; durationMs: number };
  failure?: AnalysisRunFailure;
}

export interface ReplaySourceSnapshot {
  inputUrl: string;
  homepageUrl: string;
  name: string;
  description: string;
  sourceMode: "open-source" | "website-only";
  pageText: string;
  documents: Array<{ kind: string; title: string; url: string; text: string }>;
  repo?: {
    fullName: string;
    url: string;
    description: string;
    license: string;
    defaultBranch: string;
    stars: number;
    forks: number;
    openIssues: number;
    pushedAt: string;
    archived: boolean;
    topics: string[];
    readme: string;
    latestRelease?: { name: string; tagName: string; url: string; publishedAt: string; notes: string };
  };
}

export interface AnalysisReplayBundle {
  schemaVersion: 1;
  createdAt: string;
  generatedAt: string;
  manifest: AnalysisRunManifest;
  trustedRequest: AnalyzeRequest;
  sourceSnapshots: ReplaySourceSnapshot[];
  /** Validated model payload, never credentials or provider response metadata. */
  modelOutput: unknown;
}

export interface AnalyzeRequest {
  urls: string[];
  context: string;
  criteria: ComparisonCriterion[];
  locale: Locale;
}
import type { Locale } from "./i18n.ts";
