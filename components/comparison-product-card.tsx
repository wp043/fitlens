"use client";

import { calculateEvidenceCoverage } from "@/lib/report";
import { calculateEvidenceFreshness } from "@/lib/freshness";
import type { ConfidenceCalibration } from "@/lib/confidence";
import type { Locale, Messages } from "@/lib/i18n";
import type {
  Evidence,
  EvidenceLevel,
  EvidenceReviewStatus,
  ProductResult,
} from "@/lib/types";
import { SourcePill } from "@/components/workbench-primitives";
import {
  cadenceLabel,
  confidenceBandLabel,
  confidenceFactorLabel,
  privacyCategoryLabel,
  privacyRiskLabel,
  privacyStatusLabel,
} from "@/components/compare-workbench-format";

interface ComparisonProductCardProps {
  product: ProductResult;
  calibration: ConfidenceCalibration;
  featured: boolean;
  locale: Locale;
  messages: Messages;
  evidenceLabels: Record<EvidenceLevel, string>;
  onReview(
    productName: string,
    evidenceIndex: number,
    update: Partial<Pick<Evidence, "claim" | "reviewStatus" | "reviewNote">>,
  ): void;
}

export function ComparisonProductCard({
  product,
  calibration,
  featured,
  locale,
  messages: t,
  evidenceLabels,
  onReview,
}: ComparisonProductCardProps) {
  const coverage = calculateEvidenceCoverage(product);
  const freshness = calculateEvidenceFreshness(product);
  return (
    <article className={`product-card ${featured ? "featured" : ""}`}>
      <header>
        <div>
          <span className="product-letter">{product.name.slice(0, 1)}</span>
          <div>
            <h3>{product.name}</h3>
            <p>{product.tagline}</p>
          </div>
        </div>
        <SourcePill mode={product.sourceMode} t={t} />
      </header>
      <div className="confidence">
        <span>{t.confidenceCalibrated}</span>
        <div>
          <i style={{ width: `${calibration.score}%` }} />
        </div>
        <b>{calibration.score}%</b>
      </div>
      <section className={`confidence-calibration ${calibration.band}`}>
        <header>
          <div>
            <strong>{confidenceBandLabel(calibration, t)}</strong>
            <span>{t.confidenceWhy}</span>
          </div>
          <p>{t.confidenceMethod}</p>
        </header>
        <div className="confidence-evidence-mix">
          <span>
            <b>{calibration.verified}</b> {t.verified}
          </span>
          <span>
            <b>{calibration.vendor}</b> {t.vendor}
          </span>
          <span>
            <b>{calibration.inferred}</b> {t.inferred}
          </span>
        </div>
        <ul>
          {calibration.factors.map((factor) => (
            <li className={factor.effect} key={factor.key}>
              <span>{factor.effect === "supporting" ? "+" : "!"}</span>
              <div>
                <b>
                  {factor.effect === "supporting"
                    ? t.confidenceSupporting
                    : t.confidenceLimiting}
                </b>
                <p>{confidenceFactorLabel(factor, t)}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="coverage-card">
        <div>
          <span>{t.coverage}</span>
          <strong>
            {
              {
                Strong: t.coverageStrong,
                Moderate: t.coverageModerate,
                Limited: t.coverageLimited,
              }[coverage.label]
            }
          </strong>
        </div>
        <div
          className="coverage-meter"
          role="img"
          aria-label={`${t.coverage} ${coverage.score}%`}
        >
          <i style={{ width: `${coverage.score}%` }} />
        </div>
        <p>
          {coverage.verified} {t.verified} · {coverage.vendor} {t.vendor} ·{" "}
          {coverage.inferred} {t.inferred} · {coverage.sourceCount} {t.sources}{" "}
          · {t.sourceFreshness}: {freshness.fresh} {t.freshSources},{" "}
          {freshness.aging} {t.agingSources}, {freshness.stale} {t.staleSources}
          , {freshness.unknown} {t.unknownFreshness}
        </p>
      </div>
      <p className="product-verdict">{product.verdict}</p>
      {product.pricing && (
        <section
          className="pricing-card"
          aria-label={`${product.name}: ${t.pricingTitle}`}
        >
          <div className="pricing-heading">
            <div>
              <h4>{t.pricingTitle}</h4>
              <p>{product.pricing.summary}</p>
            </div>
            <span
              className={
                product.pricing.hasFreeOption === true
                  ? "free"
                  : product.pricing.hasFreeOption === false
                    ? "paid"
                    : "unknown"
              }
            >
              {product.pricing.hasFreeOption === true
                ? t.pricingFree
                : product.pricing.hasFreeOption === false
                  ? t.pricingNoFree
                  : t.pricingFreeUnknown}
            </span>
          </div>
          <div className="pricing-plans">
            {product.pricing.plans.length > 0 ? (
              product.pricing.plans.map((plan) => (
                <a
                  href={plan.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  key={`${plan.name}-${plan.price}-${plan.sourceUrl}`}
                >
                  <div>
                    <strong>{plan.name}</strong>
                    <span className={`evidence-badge ${plan.evidenceLevel}`}>
                      {evidenceLabels[plan.evidenceLevel]}
                    </span>
                  </div>
                  <p>
                    <b>{plan.price}</b>
                    <small>{cadenceLabel(plan.cadence, t)}</small>
                  </p>
                  <dl>
                    <div>
                      <dt>{t.pricingAudience}</dt>
                      <dd>{plan.audience}</dd>
                    </div>
                    {plan.limits.length > 0 && (
                      <div>
                        <dt>{t.pricingLimits}</dt>
                        <dd>{plan.limits.join(" · ")}</dd>
                      </div>
                    )}
                  </dl>
                </a>
              ))
            ) : (
              <p className="pricing-empty">{t.pricingNoPlans}</p>
            )}
          </div>
          <p className="pricing-uncertainty">
            <strong>{t.pricingUncertainty}</strong>
            {product.pricing.uncertainty}
          </p>
        </section>
      )}
      {product.privacy && (
        <section
          className="privacy-card"
          aria-label={`${product.name}: ${t.privacyTitle}`}
        >
          <header>
            <div>
              <h4>{t.privacyTitle}</h4>
              <p>{t.privacyCopy}</p>
            </div>
            <span className={`privacy-risk ${product.privacy.riskLevel}`}>
              <small>{t.privacyRisk}</small>
              {privacyRiskLabel(product.privacy.riskLevel, t)}
            </span>
          </header>
          <p className="privacy-summary">{product.privacy.summary}</p>
          <div className="privacy-findings">
            {product.privacy.findings.map((finding) => (
              <a
                href={finding.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className={finding.status}
                key={finding.category}
              >
                <div>
                  <strong>{privacyCategoryLabel(finding.category, t)}</strong>
                  <span>{privacyStatusLabel(finding.status, t)}</span>
                </div>
                <p>{finding.finding}</p>
                <small>
                  <b className={`evidence-badge ${finding.evidenceLevel}`}>
                    {evidenceLabels[finding.evidenceLevel]}
                  </b>
                  {t.privacyUncertainty}: {finding.uncertainty} ↗
                </small>
              </a>
            ))}
          </div>
        </section>
      )}
      <div className="pros-cons">
        <div>
          <h4>{t.strengths}</h4>
          <ul>
            {product.strengths.map((item) => (
              <li key={item}>
                <span>+</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>{t.tradeoffs}</h4>
          <ul>
            {product.tradeoffs.map((item) => (
              <li key={item}>
                <span>–</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="evidence-stack">
        <div className="evidence-review-heading">
          <div>
            <h4>{t.evidenceReviewTitle}</h4>
            <p>
              {t.evidenceReviewSummary
                .replace(
                  "{accepted}",
                  String(
                    product.evidence.filter(
                      (item) => item.reviewStatus === "accepted",
                    ).length,
                  ),
                )
                .replace(
                  "{unreviewed}",
                  String(
                    product.evidence.filter(
                      (item) =>
                        !item.reviewStatus ||
                        item.reviewStatus === "unreviewed",
                    ).length,
                  ),
                )
                .replace(
                  "{rejected}",
                  String(
                    product.evidence.filter(
                      (item) => item.reviewStatus === "rejected",
                    ).length,
                  ),
                )}
            </p>
          </div>
        </div>
        {product.evidence.map((item, evidenceIndex) => {
          const reviewStatus: EvidenceReviewStatus =
            item.reviewStatus ?? "unreviewed";
          const reviewLabel = {
            unreviewed: t.evidenceUnreviewed,
            accepted: t.evidenceAccepted,
            rejected: t.evidenceRejected,
          }[reviewStatus];
          return (
            <article
              className={`evidence-review-item ${reviewStatus}`}
              key={`${item.originalClaim ?? item.claim}-${item.sourceUrl}`}
            >
              <header>
                <span className={`evidence-badge ${item.level}`}>
                  {evidenceLabels[item.level]}
                </span>
                <span className={`review-status ${reviewStatus}`}>
                  {reviewLabel}
                </span>
                <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                  {item.sourceLabel} ↗
                </a>
              </header>
              <label>
                <span>{t.evidenceEditClaim}</span>
                <textarea
                  defaultValue={item.claim}
                  rows={2}
                  onBlur={(event) =>
                    onReview(product.name, evidenceIndex, {
                      claim: event.target.value,
                    })
                  }
                />
              </label>
              {item.originalClaim && (
                <details>
                  <summary>{t.evidenceOriginalClaim}</summary>
                  <p>{item.originalClaim}</p>
                </details>
              )}
              <label>
                <span>{t.evidenceReviewNote}</span>
                <input
                  defaultValue={item.reviewNote ?? ""}
                  onBlur={(event) =>
                    onReview(product.name, evidenceIndex, {
                      reviewNote: event.target.value.trim(),
                    })
                  }
                />
              </label>
              <footer>
                <small>
                  {item.capturedAt
                    ? `${t.checked} ${new Date(item.capturedAt).toLocaleDateString(locale)}`
                    : t.unknownFreshness}
                </small>
                <div>
                  <button
                    type="button"
                    className="accept"
                    aria-pressed={reviewStatus === "accepted"}
                    onClick={() =>
                      onReview(product.name, evidenceIndex, {
                        reviewStatus: "accepted",
                      })
                    }
                  >
                    ✓ {t.evidenceAccept}
                  </button>
                  <button
                    type="button"
                    className="reject"
                    aria-pressed={reviewStatus === "rejected"}
                    onClick={() =>
                      onReview(product.name, evidenceIndex, {
                        reviewStatus: "rejected",
                      })
                    }
                  >
                    × {t.evidenceReject}
                  </button>
                  {reviewStatus !== "unreviewed" && (
                    <button
                      type="button"
                      onClick={() =>
                        onReview(product.name, evidenceIndex, {
                          reviewStatus: "unreviewed",
                        })
                      }
                    >
                      {t.evidenceResetReview}
                    </button>
                  )}
                </div>
              </footer>
            </article>
          );
        })}
      </div>
    </article>
  );
}
