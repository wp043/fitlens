"use client";

import type { ComparisonDiff } from "@/lib/diff";
import type { EvidenceConflict } from "@/lib/conflicts";
import type { Locale, Messages } from "@/lib/i18n";
import type {
  ComparisonResult,
  EvidenceLevel,
  ProductResult,
} from "@/lib/types";
import {
  conflictTopicLabel,
  formatDelta,
} from "@/components/compare-workbench-format";

export type AnalysisStatus =
  | "idle"
  | "loading"
  | "refreshing"
  | "cancelling"
  | "error";

interface ReportActions {
  refresh(): void;
  copy(): void;
  markdown(): void;
  json(): void;
  html(): void;
  pdf(): void;
  redactedMarkdown(): void;
  redactedJson(): void;
  import(): void;
  startOver(): void;
}

interface ComparisonReportSummaryProps {
  result: ComparisonResult;
  locale: Locale;
  messages: Messages;
  status: AnalysisStatus;
  canAnalyze: boolean;
  copied: boolean;
  exampleMode: boolean;
  error: string;
  weightedWinner?: string;
  weightedScores: Record<string, number>;
  currentWinner?: ProductResult;
  conflicts: EvidenceConflict[];
  comparisonDiff?: ComparisonDiff;
  evidenceLabels: Record<EvidenceLevel, string>;
  actions: ReportActions;
}

export function ComparisonReportSummary({
  result,
  locale,
  messages: t,
  status,
  canAnalyze,
  copied,
  exampleMode,
  error,
  weightedWinner,
  weightedScores,
  currentWinner,
  conflicts,
  comparisonDiff,
  evidenceLabels,
  actions,
}: ComparisonReportSummaryProps) {
  const recommendedWinner = weightedWinner ?? result.recommendation.winner;
  return (
    <>
      <div className="result-kicker">
        <span>
          {t.report} ·{" "}
          {new Date(result.generatedAt).toLocaleString(locale, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
        <div className="report-actions">
          <button
            className="refresh-report"
            onClick={actions.refresh}
            disabled={
              status === "refreshing" ||
              status === "loading" ||
              status === "cancelling" ||
              !canAnalyze
            }
          >
            {status === "refreshing" ? t.refreshing : t.refreshReport}
          </button>
          <button onClick={actions.copy}>
            {copied ? t.copied : t.copyBrief}
          </button>
          <details className="export-menu">
            <summary>{t.exportMenu}</summary>
            <div>
              <button onClick={actions.markdown}>{t.exportMarkdown}</button>
              <button onClick={actions.json}>{t.exportJson}</button>
              <button onClick={actions.html}>{t.exportHtml}</button>
              <button onClick={actions.pdf}>{t.exportPdf}</button>
              <div className="export-menu-group">
                <strong>{t.shareSafeTitle}</strong>
                <p>{t.shareSafeCopyDetail}</p>
                <button onClick={actions.redactedMarkdown}>
                  {t.shareMarkdown}
                </button>
                <button onClick={actions.redactedJson}>{t.shareJson}</button>
              </div>
            </div>
          </details>
          {!exampleMode && (
            <button onClick={actions.startOver}>{t.newComparison}</button>
          )}
          <button className="action-secondary" onClick={actions.import}>
            {t.import}
          </button>
        </div>
      </div>
      {result.analysisRun && (
        <div className="run-provenance">
          <strong>{t.runProvenance}</strong>{" "}
          <span>
            {result.analysisRun.provider.kind} ·{" "}
            {result.analysisRun.provider.model}
          </span>{" "}
          <code>{result.analysisRun.runId}</code>
          {result.replayBundle && <small>{t.replayPrivate}</small>}
        </div>
      )}
      {error && <div className="error-banner report-error">{error}</div>}
      <div className="verdict-card">
        <div className="verdict-main">
          <p>{t.forWorkflow}</p>
          <h2>
            {t.chooseNow} <span>{recommendedWinner}</span>
          </h2>
          <p>
            {weightedWinner === result.recommendation.winner
              ? result.recommendation.summary
              : `${t.weightedSummary.replace("{winner}", weightedWinner ?? "")} ${currentWinner?.verdict ?? ""}`}
          </p>
        </div>
        <div className="score-seal">
          <span>{t.fitScore}</span>
          <strong>
            {weightedScores[recommendedWinner] ??
              currentWinner?.score ??
              result.products[0].score}
          </strong>
          <small>/ 100</small>
        </div>
      </div>
      <div className="decision-notes">
        <div>
          <p className="eyebrow">{t.whyThis}</p>
          <ul>
            {result.recommendation.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow">{t.chooseDifferently}</p>
          <p>{result.recommendation.switchWhen}</p>
        </div>
      </div>
      {conflicts.length > 0 && (
        <section className="conflict-card" aria-labelledby="conflicts-title">
          <header>
            <div>
              <p className="eyebrow">{t.conflictsEyebrow}</p>
              <h2 id="conflicts-title">{t.conflictsTitle}</h2>
              <p>{t.conflictsCopy}</p>
            </div>
            <strong>{conflicts.length}</strong>
          </header>
          <div className="conflict-list">
            {conflicts.map((conflict) => (
              <article key={conflict.id}>
                <div className="conflict-heading">
                  <span className={`conflict-severity ${conflict.severity}`}>
                    {conflict.severity === "high"
                      ? t.conflictHigh
                      : t.conflictMedium}
                  </span>
                  <strong>{conflict.product}</strong>
                  <small>{conflictTopicLabel(conflict.topic, t)}</small>
                </div>
                <div className="conflict-claims">
                  {[conflict.first, conflict.second].map((evidence, index) => (
                    <a
                      href={evidence.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      key={`${conflict.id}-${index}`}
                    >
                      <span className={`evidence-badge ${evidence.level}`}>
                        {evidenceLabels[evidence.level]}
                      </span>
                      <p>{evidence.claim}</p>
                      <small>{evidence.sourceLabel} ↗</small>
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {comparisonDiff && (
        <section className="diff-card" aria-labelledby="diff-title">
          <header>
            <div>
              <p className="eyebrow">{t.sinceLastRefresh}</p>
              <h2 id="diff-title">
                {comparisonDiff.hasChanges ? t.whatChanged : t.noChanges}
              </h2>
            </div>
            <span className={comparisonDiff.winnerChanged ? "changed" : ""}>
              {comparisonDiff.winnerChanged
                ? `${comparisonDiff.previousWinner} → ${comparisonDiff.currentWinner}`
                : `${t.winnerStable}: ${comparisonDiff.currentWinner}`}
            </span>
          </header>
          {comparisonDiff.hasChanges && (
            <div className="diff-grid">
              <div>
                <h3>{t.fitScoreChanges}</h3>
                {comparisonDiff.scoreChanges.map((change) => (
                  <p key={change.product}>
                    <strong>{change.product}</strong>
                    <span>
                      {change.before} → {change.after}
                      <b className={change.delta < 0 ? "negative" : ""}>
                        {formatDelta(change.delta)}
                      </b>
                    </span>
                  </p>
                ))}
              </div>
              <div>
                <h3>{t.evidenceChanges}</h3>
                {comparisonDiff.evidenceChanges.map((change) => (
                  <p key={change.product}>
                    <strong>{change.product}</strong>
                    <span>
                      {change.total.before} → {change.total.after}
                      <b className={change.total.delta < 0 ? "negative" : ""}>
                        {formatDelta(change.total.delta)}
                      </b>
                    </span>
                    <small>
                      {t.verified} {formatDelta(change.levels.verified.delta)} ·{" "}
                      {t.vendor} {formatDelta(change.levels.vendor.delta)} ·{" "}
                      {t.inferred} {formatDelta(change.levels.inferred.delta)}
                    </small>
                  </p>
                ))}
              </div>
              <div className="dimension-diffs">
                <h3>{t.dimensionChanges}</h3>
                {comparisonDiff.dimensionChanges.length > 0 ? (
                  comparisonDiff.dimensionChanges.map((change) => (
                    <p key={`${change.key}-${change.product}`}>
                      <strong>
                        {change.label} · {change.product}
                      </strong>
                      <span>
                        {change.before} → {change.after}
                        <b className={change.delta < 0 ? "negative" : ""}>
                          {formatDelta(change.delta)}
                        </b>
                      </span>
                    </p>
                  ))
                ) : (
                  <small>{t.none}</small>
                )}
              </div>
              <div className="unknown-diffs">
                <h3>{t.unknownChanges}</h3>
                {comparisonDiff.addedUnknowns.map((unknown) => (
                  <p key={`added-${unknown}`}>
                    <b>+</b> {unknown}
                  </p>
                ))}
                {comparisonDiff.removedUnknowns.map((unknown) => (
                  <p className="resolved" key={`removed-${unknown}`}>
                    <b>✓</b> {unknown}
                  </p>
                ))}
                {comparisonDiff.addedUnknowns.length === 0 &&
                  comparisonDiff.removedUnknowns.length === 0 && (
                    <small>{t.none}</small>
                  )}
              </div>
            </div>
          )}
          <footer>
            {new Date(comparisonDiff.from).toLocaleString(locale)} →{" "}
            {new Date(comparisonDiff.to).toLocaleString(locale)}
          </footer>
        </section>
      )}
    </>
  );
}
