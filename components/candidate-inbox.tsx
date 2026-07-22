"use client";

import { useMemo, useState } from "react";
import {
  captureCandidates,
  filterCandidates,
  type CandidateInboxItem,
} from "@/lib/candidate-inbox";
import type { Locale, Messages } from "@/lib/i18n";

interface CandidateInboxProps {
  items: CandidateInboxItem[];
  locale: Locale;
  messages: Messages;
  onChange(items: CandidateInboxItem[]): void;
  onCompare(urls: string[]): void;
}

export function CandidateInbox({
  items,
  locale,
  messages: t,
  onChange,
  onCompare,
}: CandidateInboxProps) {
  const [capture, setCapture] = useState("");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [captureResult, setCaptureResult] = useState("");
  const filtered = useMemo(
    () => filterCandidates(items, query, showArchived),
    [items, query, showArchived],
  );

  function addLinks() {
    const result = captureCandidates(items, capture, () => crypto.randomUUID());
    onChange(result.items);
    if (result.added > 0) setCapture("");
    setCaptureResult(
      t.inboxCaptureResult
        .replace("{added}", String(result.added))
        .replace("{duplicates}", String(result.duplicates))
        .replace("{invalid}", String(result.invalid)),
    );
  }

  function update(
    id: string,
    change: Partial<Pick<CandidateInboxItem, "note" | "tags" | "archived">>,
  ) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...change } : item)));
    if (change.archived === true) {
      setSelectedIds((current) => current.filter((candidateId) => candidateId !== id));
    }
  }

  function remove(id: string) {
    onChange(items.filter((item) => item.id !== id));
    setSelectedIds((current) => current.filter((candidateId) => candidateId !== id));
  }

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((candidateId) => candidateId !== id)
        : current.length < 8
          ? [...current, id]
          : current,
    );
  }

  function compare() {
    const urls = selectedIds.flatMap((id) => {
      const candidate = items.find((item) => item.id === id);
      return candidate ? [candidate.url] : [];
    });
    if (urls.length >= 2) onCompare(urls);
  }

  return (
    <section className="candidate-inbox shell" aria-labelledby="candidate-inbox-title">
      <header>
        <div>
          <p className="eyebrow">{t.inboxEyebrow}</p>
          <h2 id="candidate-inbox-title">{t.inboxTitle}</h2>
          <p>{t.inboxCopy}</p>
        </div>
        <div className="candidate-capture">
          <textarea
            value={capture}
            rows={3}
            placeholder={t.inboxCapturePlaceholder}
            onChange={(event) => setCapture(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                addLinks();
              }
            }}
          />
          <button type="button" disabled={!capture.trim()} onClick={addLinks}>
            + {t.inboxCapture}
          </button>
          {captureResult && <small>{captureResult}</small>}
        </div>
      </header>

      <div className="candidate-inbox-toolbar">
        <input
          type="search"
          value={query}
          placeholder={t.inboxSearch}
          aria-label={t.inboxSearch}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          {t.inboxShowArchived}
        </label>
        <span>{t.inboxSelected.replace("{count}", String(selectedIds.length))}</span>
        <button type="button" disabled={selectedIds.length < 2} onClick={compare}>
          {t.inboxCompare} →
        </button>
      </div>

      {filtered.length > 0 ? (
        <div className="candidate-inbox-grid">
          {filtered.map((candidate) => {
            const selected = selectedIds.includes(candidate.id);
            return (
              <article
                className={`${candidate.archived ? "archived" : ""} ${selected ? "selected" : ""}`}
                key={candidate.id}
              >
                <header>
                  <label className="candidate-select">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={candidate.archived}
                      onChange={() => toggle(candidate.id)}
                    />
                    <span>{candidate.name.slice(0, 1).toUpperCase()}</span>
                  </label>
                  <div>
                    <strong>{candidate.name}</strong>
                    <a href={candidate.url} target="_blank" rel="noreferrer">
                      {candidate.url} ↗
                    </a>
                  </div>
                </header>
                <label>
                  <span>{t.inboxNote}</span>
                  <input
                    value={candidate.note}
                    onChange={(event) => update(candidate.id, { note: event.target.value })}
                  />
                </label>
                <label>
                  <span>{t.inboxTags}</span>
                  <input
                    value={candidate.tags.join(", ")}
                    onChange={(event) =>
                      update(candidate.id, {
                        tags: event.target.value
                          .split(",")
                          .map((tag) => tag.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                <footer>
                  <time dateTime={candidate.addedAt}>
                    {new Date(candidate.addedAt).toLocaleDateString(locale)}
                  </time>
                  <button
                    type="button"
                    onClick={() => update(candidate.id, { archived: !candidate.archived })}
                  >
                    {candidate.archived ? t.inboxRestore : t.inboxArchive}
                  </button>
                  <button type="button" onClick={() => remove(candidate.id)}>
                    {t.inboxDelete}
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="candidate-inbox-empty">
          <strong>{t.inboxEmpty}</strong>
          <p>{t.inboxEmptyCopy}</p>
        </div>
      )}
    </section>
  );
}
