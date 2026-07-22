"use client";

import { PairwiseTrials } from "@/components/pairwise-trials";
import type { Locale, Messages } from "@/lib/i18n";
import type {
  ComparisonResult,
  Evidence,
  PairwiseTrialResult,
  PriorityWeights,
  TrialResult,
  TrialStatus,
} from "@/lib/types";

interface ManualEvidenceDraft {
  product: string;
  claim: string;
  level: Evidence["level"];
  source: string;
  url: string;
}

interface ComparisonFollowupProps {
  result: ComparisonResult;
  priorities: PriorityWeights;
  messages: Messages;
  locale: Locale;
  manualEvidence: ManualEvidenceDraft;
  onManualEvidenceChange(update: Partial<ManualEvidenceDraft>): void;
  onAddManualEvidence(): void;
  trialResults: TrialResult[];
  onTrialChange(
    index: number,
    update: Partial<Pick<TrialResult, "status" | "note">>,
  ): void;
  pairwiseTrials: PairwiseTrialResult[];
  onPairwiseChange(trials: PairwiseTrialResult[]): void;
  notes: string;
  notesSaved: boolean;
  onNotesChange(notes: string): void;
  onSaveNotes(): void;
}

export function ComparisonFollowup({
  result,
  priorities,
  messages: t,
  manualEvidence,
  onManualEvidenceChange,
  onAddManualEvidence,
  trialResults,
  onTrialChange,
  pairwiseTrials,
  onPairwiseChange,
  notes,
  notesSaved,
  onNotesChange,
  onSaveNotes,
}: ComparisonFollowupProps) {
  return (
    <>
      <section
        className="manual-evidence-card"
        aria-labelledby="manual-evidence-title"
      >
        <div className="manual-evidence-intro">
          <p className="eyebrow">{t.manualEvidenceTitle}</p>
          <h2 id="manual-evidence-title">{t.manualEvidenceTitle}</h2>
          <p>{t.manualEvidenceCopy}</p>
        </div>
        <form
          className="manual-evidence-form"
          onSubmit={(event) => {
            event.preventDefault();
            onAddManualEvidence();
          }}
        >
          <label>
            <span>{t.manualEvidenceProduct}</span>
            <select
              value={manualEvidence.product || result.products[0]?.name || ""}
              onChange={(event) =>
                onManualEvidenceChange({ product: event.target.value })
              }
            >
              {result.products.map((product) => (
                <option key={product.name} value={product.name}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label className="manual-evidence-wide">
            <span>{t.manualEvidenceClaim}</span>
            <input
              value={manualEvidence.claim}
              placeholder={t.manualEvidenceClaim}
              onChange={(event) =>
                onManualEvidenceChange({ claim: event.target.value })
              }
            />
          </label>
          <label>
            <span>{t.manualEvidenceLevel}</span>
            <select
              value={manualEvidence.level}
              onChange={(event) =>
                onManualEvidenceChange({
                  level: event.target.value as Evidence["level"],
                })
              }
            >
              <option value="verified">{t.verified}</option>
              <option value="vendor">{t.vendor}</option>
              <option value="inferred">{t.inferred}</option>
            </select>
          </label>
          <label>
            <span>{t.manualEvidenceSource}</span>
            <input
              value={manualEvidence.source}
              placeholder={t.manualEvidenceSource}
              onChange={(event) =>
                onManualEvidenceChange({ source: event.target.value })
              }
            />
          </label>
          <label>
            <span>{t.manualEvidenceUrl}</span>
            <input
              type="url"
              required
              value={manualEvidence.url}
              placeholder="https://…"
              onChange={(event) =>
                onManualEvidenceChange({ url: event.target.value })
              }
            />
          </label>
          <button
            type="submit"
            disabled={
              !manualEvidence.claim.trim() ||
              !manualEvidence.source.trim() ||
              !manualEvidence.url.trim()
            }
          >
            + {t.addManualEvidence}
          </button>
        </form>
      </section>
      <div className="matrix-card">
        <header>
          <div>
            <span className="step-index">04</span>
            <h2>{t.matrixTitle}</h2>
          </div>
          <p>{t.matrixHint}</p>
        </header>
        <div className="matrix">
          {result.dimensions.map((dimension) => (
            <div className="matrix-row" key={dimension.key}>
              <div className="matrix-label">
                <strong>{dimension.label}</strong>
                <small>
                  {t.weight} {priorities[dimension.key] ?? 0}
                </small>
              </div>
              <div className="matrix-bars">
                {Object.entries(dimension.productScores).map(
                  ([product, score]) => (
                    <div key={product}>
                      <span>{product}</span>
                      <i>
                        <b style={{ width: `${score}%` }} />
                      </i>
                      <strong>{score}</strong>
                    </div>
                  ),
                )}
              </div>
              <p>{dimension.explanation}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="bottom-grid">
        <div className="unknown-card">
          <p className="eyebrow">{t.unknownEyebrow}</p>
          <h2>{t.unknownTitle}</h2>
          <ol>
            {result.unknowns.map((unknown) => (
              <li key={unknown}>{unknown}</li>
            ))}
          </ol>
        </div>
        <div className="trial-card">
          <p className="eyebrow">{t.trialEyebrow}</p>
          <h2>{t.trialTitle}</h2>
          {result.trialPlan.map((item, index) => (
            <div key={item.task}>
              <span>0{index + 1}</span>
              <p>
                <strong>{item.task}</strong>
                <small>{item.reason}</small>
                <select
                  aria-label={`${t.trialStatus}: ${item.task}`}
                  value={trialResults[index]?.status ?? "untested"}
                  onChange={(event) =>
                    onTrialChange(index, {
                      status: event.target.value as TrialStatus,
                    })
                  }
                >
                  <option value="untested">{t.trialUntested}</option>
                  <option value="passed">{t.trialPassed}</option>
                  <option value="failed">{t.trialFailed}</option>
                  <option value="skipped">{t.trialSkipped}</option>
                </select>
                <textarea
                  rows={2}
                  value={trialResults[index]?.note ?? ""}
                  placeholder={t.trialNotePlaceholder}
                  onChange={(event) =>
                    onTrialChange(index, { note: event.target.value })
                  }
                />
              </p>
            </div>
          ))}
        </div>
      </div>
      <PairwiseTrials
        products={result.products.map((product) => product.name)}
        trials={pairwiseTrials}
        messages={t}
        onChange={onPairwiseChange}
      />
      <div className="research-notes-card">
        <div>
          <p className="eyebrow">{t.notesEyebrow}</p>
          <h2>{t.notesTitle}</h2>
          <p>{t.notesCopy}</p>
        </div>
        <div>
          <textarea
            value={notes}
            rows={7}
            placeholder={t.notesPlaceholder}
            onChange={(event) => onNotesChange(event.target.value)}
            onBlur={onSaveNotes}
          />
          <span>{notesSaved ? t.notesSaved : t.notesExported}</span>
        </div>
      </div>
    </>
  );
}
