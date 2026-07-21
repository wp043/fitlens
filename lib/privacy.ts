import type {
  PrivacyFinding,
  PrivacySecurityReview,
} from "./types.ts";

/**
 * Keep the headline risk honest when the evidence is sparse. A product cannot
 * receive a reassuring rating simply because important controls are silent.
 */
export function calibratePrivacyRisk(
  findings: PrivacyFinding[],
): PrivacySecurityReview["riskLevel"] {
  const caution = findings.filter((finding) => finding.status === "caution").length;
  const unknown = findings.filter((finding) => finding.status === "unknown").length;

  if (unknown >= 3) return "unknown";
  if (caution >= 3) return "high";
  if (caution > 0 || unknown > 1) return "medium";
  return "low";
}
