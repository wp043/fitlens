"use client";

import { useMemo, useState } from "react";
import type { Locale, Messages } from "@/lib/i18n";
import type { SavedReport } from "@/lib/report";
import {
  buildResearchLibrary,
  filterResearchLibrary,
  listLibraryProducts,
  type LibraryReviewFilter,
  type LibrarySourceFilter,
} from "@/lib/research-library";
import type { EvidenceLevel } from "@/lib/types";

interface ResearchLibraryPanelProps {
  history: SavedReport[];
  locale: Locale;
  messages: Messages;
  onImport: () => void;
  onClear: () => void;
  onOpen: (report: SavedReport) => void;
  onReuse: (report: SavedReport) => void;
}

export function ResearchLibraryPanel({
  history,
  locale,
  messages: t,
  onImport,
  onClear,
  onOpen,
  onReuse,
}: ResearchLibraryPanelProps) {
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("");
  const [source, setSource] = useState<LibrarySourceFilter>("all");
  const [evidence, setEvidence] = useState<EvidenceLevel | "all">("all");
  const [review, setReview] = useState<LibraryReviewFilter>("all");
  const products = useMemo(() => listLibraryProducts(history), [history]);
  const entries = useMemo(
    () =>
      filterResearchLibrary(buildResearchLibrary(history), {
        query,
        product,
        sourceMode: source,
        evidenceLevel: evidence,
        review,
      }),
    [history, query, product, source, evidence, review],
  );

  return (
    <div className="history-panel library-panel">
      <div className="history-head">
        <div>
          <p className="eyebrow">{t.libraryEyebrow}</p>
          <h3>{t.libraryTitle}</h3>
          <small>{t.libraryCopy}</small>
        </div>
        <div>
          <button onClick={onImport}>{t.import}</button>
          <button onClick={onClear}>{t.clear}</button>
        </div>
      </div>
      <div className="library-tools">
        <label className="library-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.librarySearchPlaceholder}
            aria-label={t.librarySearchAria}
          />
        </label>
        <div className="library-filters">
          <select
            value={product}
            onChange={(event) => setProduct(event.target.value)}
            aria-label={t.libraryProductFilter}
          >
            <option value="">{t.libraryAllProducts}</option>
            {products.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            value={source}
            onChange={(event) =>
              setSource(event.target.value as LibrarySourceFilter)
            }
            aria-label={t.librarySourceFilter}
          >
            <option value="all">{t.libraryAllSources}</option>
            <option value="open-source">{t.sourceOpen}</option>
            <option value="website-only">{t.sourceWebsite}</option>
          </select>
          <select
            value={evidence}
            onChange={(event) =>
              setEvidence(event.target.value as EvidenceLevel | "all")
            }
            aria-label={t.libraryEvidenceFilter}
          >
            <option value="all">{t.libraryAllEvidence}</option>
            <option value="verified">{t.verified}</option>
            <option value="vendor">{t.vendor}</option>
            <option value="inferred">{t.inferred}</option>
          </select>
          <select
            value={review}
            onChange={(event) =>
              setReview(event.target.value as LibraryReviewFilter)
            }
            aria-label={t.libraryReviewFilter}
          >
            <option value="all">{t.libraryAllDecisions}</option>
            <option value="ready">{t.libraryReady}</option>
            <option value="needs-review">{t.libraryNeedsReview}</option>
          </select>
        </div>
      </div>
      <div className="library-summary">
        {t.libraryShowing
          .replace("{shown}", String(entries.length))
          .replace("{total}", String(history.length))}
      </div>
      {entries.length > 0 ? (
        <div className="history-list library-list">
          {entries.map((entry) => {
            const saved = entry.report;
            return (
              <article key={saved.id} className="library-card">
                <div className="library-card-top">
                  <div>
                    <span>{saved.title}</span>
                    <small>
                      {new Date(saved.savedAt).toLocaleDateString(locale)}
                      {saved.revisions.length > 0
                        ? ` · ${saved.revisions.length} ${t.revisions}`
                        : ""}
                    </small>
                  </div>
                  <i className={entry.needsReview ? "review" : "ready"}>
                    {entry.needsReview
                      ? t.libraryNeedsReview
                      : t.libraryReady}
                  </i>
                </div>
                <div className="library-product-chips">
                  {entry.products.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
                <div className="library-decision">
                  <small>{t.libraryDecision}</small>
                  <strong>{saved.result.recommendation.winner}</strong>
                </div>
                <div className="library-metrics">
                  <span>
                    {entry.evidenceCount} {t.libraryEvidence}
                  </span>
                  <span>
                    {entry.verifiedCount} {t.verified}
                  </span>
                  <span>
                    {entry.sourceCount} {t.sources}
                  </span>
                </div>
                <div className="library-card-actions">
                  <button onClick={() => onOpen(saved)}>{t.open}</button>
                  <button onClick={() => onReuse(saved)}>
                    {t.libraryReuseInputs}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="library-empty">
          <span>⌕</span>
          <strong>{t.libraryNoResults}</strong>
          <small>{t.libraryNoResultsCopy}</small>
        </div>
      )}
    </div>
  );
}
