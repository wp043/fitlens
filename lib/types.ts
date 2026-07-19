export type EvidenceLevel = "verified" | "vendor" | "inferred";

export type PriorityKey =
  | "openness"
  | "agentWorkflow"
  | "performance"
  | "polish"
  | "automation";

export type PriorityWeights = Record<PriorityKey, number>;

export interface Evidence {
  claim: string;
  level: EvidenceLevel;
  sourceLabel: string;
  sourceUrl: string;
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
  priorities: PriorityWeights;
}
