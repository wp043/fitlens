"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateEvidenceCoverage,
  parseReport,
  serializeReport,
  type SavedReport,
} from "@/lib/report";
import {
  messages,
  normalizeLocale,
  type Locale,
  type Messages,
} from "@/lib/i18n";
import {
  defaultPriorities,
  examplePriorities,
  sampleComparisonForLocale,
} from "@/lib/sample";
import { calculateWeightedWinner } from "@/lib/scoring";
import type {
  ComparisonResult,
  EvidenceLevel,
  PriorityKey,
  PriorityWeights,
} from "@/lib/types";

interface PreferenceProfile {
  id: string;
  name: string;
  weights: PriorityWeights;
  builtIn?: boolean;
  nameKey?:
    | "profileBalanced"
    | "profileOpen"
    | "profileAgent"
    | "profilePolish";
}

const historyKey = "fitlens-report-history-v1";
const sessionApiKey = "fitlens-openai-api-key-v1";
const preferenceProfilesKey = "fitlens-preference-profiles-v1";
const localeKey = "fitlens-locale-v1";

const builtInProfiles: PreferenceProfile[] = [
  {
    id: "balanced",
    name: "",
    nameKey: "profileBalanced",
    weights: defaultPriorities,
    builtIn: true,
  },
  {
    id: "open-control",
    name: "",
    nameKey: "profileOpen",
    weights: {
      openness: 95,
      agentWorkflow: 72,
      performance: 68,
      polish: 42,
      automation: 82,
    },
    builtIn: true,
  },
  {
    id: "agent-heavy",
    name: "",
    nameKey: "profileAgent",
    weights: {
      openness: 62,
      agentWorkflow: 96,
      performance: 72,
      polish: 58,
      automation: 90,
    },
    builtIn: true,
  },
  {
    id: "polish-first",
    name: "",
    nameKey: "profilePolish",
    weights: {
      openness: 38,
      agentWorkflow: 70,
      performance: 72,
      polish: 96,
      automation: 44,
    },
    builtIn: true,
  },
];

function comparisonAsMarkdown(
  result: ComparisonResult,
  notes: string,
  locale: Locale,
  t: Messages,
) {
  const evidenceLabels: Record<EvidenceLevel, string> = {
    verified: t.verified,
    vendor: t.vendor,
    inferred: t.inferred,
  };
  const productSections = result.products
    .map(
      (product) => `## ${product.name} — ${product.score}/100

${product.verdict}

### ${t.markdownStrengths}
${product.strengths.map((item) => `- ${item}`).join("\n")}

### ${t.markdownTradeoffs}
${product.tradeoffs.map((item) => `- ${item}`).join("\n")}

### ${t.markdownEvidence}
${product.evidence
  .map(
    (item) =>
      `- **${evidenceLabels[item.level]}:** ${item.claim} ([${item.sourceLabel}](${item.sourceUrl}))`,
  )
  .join("\n")}`,
    )
    .join("\n\n");

  return `# ${result.title}

${t.markdownAnalyzed}: ${new Date(result.generatedAt).toLocaleString(locale)}.

## ${t.markdownRecommendation}: ${result.recommendation.winner}

${result.recommendation.summary}

${result.recommendation.reasons.map((item) => `- ${item}`).join("\n")}

**${t.markdownChooseDifferently}:** ${result.recommendation.switchWhen}

${productSections}

## ${t.markdownUnknowns}
${result.unknowns.map((item) => `- ${item}`).join("\n")}

## ${t.markdownTrial}
${result.trialPlan
  .map((item, index) => `${index + 1}. **${item.task}** — ${item.reason}`)
  .join("\n")}

${notes.trim() ? `## ${t.markdownNotes}\n${notes.trim()}\n\n` : ""}---
${t.generatedBy} · ${new Date(result.generatedAt).toLocaleDateString(locale)}.
`;
}

function safeFilename(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "fitlens-report"
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 42 42">
        <circle cx="19" cy="19" r="12.5" />
        <path d="m28.2 28.2 8.1 8.1" />
        <path d="M12.5 19h13M19 12.5v13" />
      </svg>
    </span>
  );
}

function SourcePill({
  mode,
  t,
}: {
  mode: "open-source" | "website-only";
  t: Messages;
}) {
  return (
    <span className={`source-pill ${mode}`}>
      <span className="source-dot" />
      {mode === "open-source" ? t.sourceOpen : t.sourceWebsite}
    </span>
  );
}

interface CompareWorkbenchProps {
  exampleMode?: boolean;
  initialResult?: ComparisonResult;
}

export function CompareWorkbench({
  exampleMode = false,
  initialResult,
}: CompareWorkbenchProps) {
  const [locale, setLocale] = useState<Locale>("zh-CN");
  const t = messages[locale];
  const priorityMeta: Array<{
    key: PriorityKey;
    label: string;
    hint: string;
  }> = [
    {
      key: "openness",
      label: t.priorityOpenness,
      hint: t.hintOpenness,
    },
    {
      key: "agentWorkflow",
      label: t.priorityAgent,
      hint: t.hintAgent,
    },
    {
      key: "performance",
      label: t.priorityPerformance,
      hint: t.hintPerformance,
    },
    { key: "polish", label: t.priorityPolish, hint: t.hintPolish },
    {
      key: "automation",
      label: t.priorityAutomation,
      hint: t.hintAutomation,
    },
  ];
  const evidenceLabels: Record<EvidenceLevel, string> = {
    verified: t.verified,
    vendor: t.vendor,
    inferred: t.inferred,
  };
  const [urls, setUrls] = useState<[string, string]>(
    exampleMode
      ? ["https://cmux.com/", "https://otty.sh/"]
      : ["", ""],
  );
  const [context, setContext] = useState(
    exampleMode
      ? messages["zh-CN"].exampleContext
      : "",
  );
  const [priorities, setPriorities] = useState<PriorityWeights>(
    exampleMode ? examplePriorities : defaultPriorities,
  );
  const [result, setResult] = useState<ComparisonResult | undefined>(
    initialResult,
  );
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<SavedReport[]>([]);
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [currentReportId, setCurrentReportId] = useState<string>();
  const [notes, setNotes] = useState("");
  const [customProfiles, setCustomProfiles] = useState<PreferenceProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(historyKey);
        if (stored) {
          const saved = (JSON.parse(stored) as SavedReport[]).map((report) => ({
            ...report,
            notes: report.notes ?? "",
            locale: report.locale ?? "zh-CN",
          }));
          setHistory(saved);
        }
        const storedProfiles = window.localStorage.getItem(
          preferenceProfilesKey,
        );
        if (storedProfiles) {
          setCustomProfiles(JSON.parse(storedProfiles) as PreferenceProfile[]);
        }
        setApiKey(window.sessionStorage.getItem(sessionApiKey) ?? "");
        const requestedLocale = new URLSearchParams(window.location.search).get(
          "lang",
        );
        const nextLocale = normalizeLocale(
          requestedLocale ??
            window.localStorage.getItem(localeKey) ??
            navigator.language,
        );
        setLocale(nextLocale);
        document.documentElement.lang = nextLocale;
        if (exampleMode) {
          setContext(messages[nextLocale].exampleContext);
          setResult(sampleComparisonForLocale(nextLocale));
        }
      } catch {
        // A malformed or unavailable local store should never block comparing.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exampleMode]);

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    window.localStorage.setItem(localeKey, nextLocale);
    document.documentElement.lang = nextLocale;
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("lang", nextLocale);
    window.history.replaceState({}, "", currentUrl);
    if (exampleMode && !currentReportId) {
      setContext(messages[nextLocale].exampleContext);
      setResult(sampleComparisonForLocale(nextLocale));
    }
  }

  const weightedDecision = useMemo<{
    winner: string | undefined;
    totals: Record<string, number>;
    normalized: Record<string, number>;
  }>(() => {
    return result
      ? calculateWeightedWinner(result, priorities)
      : { winner: undefined, totals: {}, normalized: {} };
  }, [priorities, result]);
  const weightedWinner = weightedDecision.winner;
  const currentWinner = result?.products.find(
    (product) => product.name === weightedWinner,
  );
  const canAnalyze =
    urls.every((url) => url.trim().length > 0) && context.trim().length >= 10;

  async function analyze() {
    setStatus("loading");
    setError("");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey.trim()
            ? { "X-FitLens-OpenAI-Key": apiKey.trim() }
            : {}),
        },
        body: JSON.stringify({ urls, context, priorities, locale }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? t.analyzeFailed);
      }
      setResult(payload);
      const saved: SavedReport = {
        id: crypto.randomUUID(),
        title: payload.title,
        savedAt: new Date().toISOString(),
        urls,
        context,
        priorities,
        result: payload,
        notes: "",
        locale,
      };
      const nextHistory = [saved, ...history].slice(0, 6);
      setHistory(nextHistory);
      setCurrentReportId(saved.id);
      setNotes("");
      window.localStorage.setItem(historyKey, JSON.stringify(nextHistory));
      setStatus("idle");
      setTimeout(
        () =>
          document
            .querySelector("#result")
            ?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.analyzeFailed);
      setStatus("error");
    }
  }

  function loadReport(saved: SavedReport) {
    changeLocale(saved.locale ?? "zh-CN");
    setUrls(saved.urls);
    setContext(saved.context);
    setPriorities(saved.priorities);
    setResult(saved.result);
    setCurrentReportId(saved.id);
    setNotes(saved.notes ?? "");
    setTimeout(
      () =>
        document
          .querySelector("#result")
          ?.scrollIntoView({ behavior: "smooth" }),
      50,
    );
  }

  function clearHistory() {
    setHistory([]);
    window.localStorage.removeItem(historyKey);
  }

  async function copyBrief() {
    if (!result) return;
    await navigator.clipboard.writeText(
      comparisonAsMarkdown(result, notes, locale, t),
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  }

  function exportMarkdown() {
    if (!result) return;
    const blob = new Blob(
      [comparisonAsMarkdown(result, notes, locale, t)],
      {
      type: "text/markdown;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFilename(result.title)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function currentPortableReport(): SavedReport | undefined {
    if (!result) return;
    const stored = history.find((report) => report.id === currentReportId);
    return {
      id: currentReportId ?? crypto.randomUUID(),
      title: result.title,
      savedAt: stored?.savedAt ?? result.generatedAt,
      urls,
      context,
      priorities,
      result,
      notes,
      locale: stored?.locale ?? locale,
    };
  }

  function exportJson() {
    const report = currentPortableReport();
    if (!report) return;
    const blob = new Blob([serializeReport(report)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFilename(report.title)}.fitlens.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = parseReport(await file.text());
      const saved = {
        ...imported,
        id: crypto.randomUUID(),
        savedAt: new Date().toISOString(),
        notes: imported.notes ?? "",
      };
      const nextHistory = [saved, ...history].slice(0, 6);
      setHistory(nextHistory);
      window.localStorage.setItem(historyKey, JSON.stringify(nextHistory));
      loadReport(saved);
      setError("");
    } catch {
      setError(t.invalidImport);
    }
  }

  function updateApiKey(value: string) {
    setApiKey(value);
    if (value) {
      window.sessionStorage.setItem(sessionApiKey, value);
    } else {
      window.sessionStorage.removeItem(sessionApiKey);
    }
  }

  function saveNotes() {
    if (!currentReportId) return;
    const nextHistory = history.map((report) =>
      report.id === currentReportId ? { ...report, notes } : report,
    );
    setHistory(nextHistory);
    window.localStorage.setItem(historyKey, JSON.stringify(nextHistory));
  }

  function savePreferenceProfile() {
    const name = profileName.trim();
    if (!name) return;
    const nextProfiles = [
      ...customProfiles,
      {
        id: crypto.randomUUID(),
        name,
        weights: priorities,
      },
    ];
    setCustomProfiles(nextProfiles);
    setProfileName("");
    window.localStorage.setItem(
      preferenceProfilesKey,
      JSON.stringify(nextProfiles),
    );
  }

  function deletePreferenceProfile(id: string) {
    const nextProfiles = customProfiles.filter((profile) => profile.id !== id);
    setCustomProfiles(nextProfiles);
    window.localStorage.setItem(
      preferenceProfilesKey,
      JSON.stringify(nextProfiles),
    );
  }

  function startOver() {
    setResult(undefined);
    setUrls(["", ""]);
    setContext("");
    setError("");
    setCurrentReportId(undefined);
    setNotes("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main>
      <nav className="topbar">
        <Link className="brand" href="/">
          <BrandMark />
          <span>FitLens</span>
        </Link>
        <div className="nav-links">
          <Link href="/#method">{t.navHow}</Link>
          <Link href="/examples/cmux-vs-otty">{t.navExample}</Link>
          <button
            className="language-switch"
            onClick={() => changeLocale(locale === "zh-CN" ? "en" : "zh-CN")}
          >
            {t.language}
          </button>
        </div>
      </nav>

      <section className="hero shell">
        <p className="eyebrow">
          {exampleMode ? t.exampleEyebrow : t.homeEyebrow}
        </p>
        <h1>
          {exampleMode ? (
            <>
              cmux <i>or</i> Otty?
              <br />
              <span>{t.exampleTitleSecond}</span>
            </>
          ) : (
            <>
              {t.homeTitleFirst}
              <br />
              <span>{t.homeTitleSecond}</span>
            </>
          )}
        </h1>
        <p className="hero-copy">
          {exampleMode
            ? t.exampleHero
            : t.homeHero}
        </p>
        {exampleMode && (
          <Link className="back-link" href="/">
            {t.backToComparison}
          </Link>
        )}
      </section>

      <section className="compare-builder shell" aria-label={t.builderAria}>
        <div className="builder-head">
          <div>
            <span className="step-index">01</span>
            <h2>{t.candidatesTitle}</h2>
          </div>
          <span className="sample-tag">
            {exampleMode ? t.exampleLoaded : t.twoLinks}
          </span>
        </div>

        {!exampleMode && (
          <div className="local-api-setup">
            <div className="local-api-copy">
              <span className="status-dot" />
              <div>
                <strong>{t.localApiTitle}</strong>
                <small>
                  {apiKey
                    ? t.sessionKeyActive
                    : t.envKeyFallback}
                </small>
              </div>
            </div>
            <div className="api-key-field">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                autoComplete="off"
                spellCheck={false}
                placeholder={t.apiKeyPlaceholder}
                aria-label={t.apiKeyAria}
                onChange={(event) => updateApiKey(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowApiKey((visible) => !visible)}
              >
                {showApiKey ? t.hide : t.show}
              </button>
              {apiKey && (
                <button type="button" onClick={() => updateApiKey("")}>
                  {t.clear}
                </button>
              )}
            </div>
            <p>
              {t.keyPrivacy}
            </p>
          </div>
        )}

        <div className="url-grid">
          {urls.map((url, index) => (
            <label className="url-field" key={index}>
              <span>
                {t.product} {index === 0 ? "A" : "B"}
              </span>
              <div>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7-7.1l-1.1 1" />
                  <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7 7.1l1.1-1" />
                </svg>
                <input
                  value={url}
                  placeholder={
                    index === 0
                      ? "https://product-a.com"
                      : "https://product-b.com"
                  }
                  onChange={(event) => {
                    const next = [...urls] as [string, string];
                    next[index] = event.target.value;
                    setUrls(next);
                  }}
                  aria-label={`${t.product} ${index === 0 ? "A" : "B"} URL`}
                />
              </div>
            </label>
          ))}
        </div>

        <div className="profile-grid">
          <div className="context-block">
            <div className="section-label">
              <span className="step-index">02</span>
              <h2>{t.scenarioTitle}</h2>
            </div>
            <textarea
              value={context}
              placeholder={t.scenarioPlaceholder}
              onChange={(event) => setContext(event.target.value)}
              rows={7}
            />
            <p>{t.scenarioHint}</p>
          </div>

          <div className="priorities-block">
            <div className="section-label">
              <span className="step-index">03</span>
              <h2>{t.prioritiesTitle}</h2>
            </div>
            <div className="preference-profiles">
              <div className="profile-chips">
                {[...builtInProfiles, ...customProfiles].map((profile) => (
                  <span className="profile-chip" key={profile.id}>
                    <button
                      type="button"
                      onClick={() => setPriorities(profile.weights)}
                    >
                      {profile.nameKey ? t[profile.nameKey] : profile.name}
                    </button>
                    {!profile.builtIn && (
                      <button
                        type="button"
                        aria-label={`${t.deletePreference}: ${profile.name}`}
                        onClick={() => deletePreferenceProfile(profile.id)}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <div className="save-profile">
                <input
                  value={profileName}
                  maxLength={32}
                  placeholder={t.saveWeightsPlaceholder}
                  aria-label={t.preferenceNameAria}
                  onChange={(event) => setProfileName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") savePreferenceProfile();
                  }}
                />
                <button
                  type="button"
                  disabled={!profileName.trim()}
                  onClick={savePreferenceProfile}
                >
                  {t.save}
                </button>
              </div>
            </div>
            <div className="sliders">
              {priorityMeta.map((item) => (
                <label key={item.key}>
                  <span className="slider-copy">
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.hint}</small>
                    </span>
                    <b>{priorities[item.key]}</b>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={priorities[item.key]}
                    onChange={(event) =>
                      setPriorities((current) => ({
                        ...current,
                        [item.key]: Number(event.target.value),
                      }))
                    }
                    style={
                      {
                        "--range": `${priorities[item.key]}%`,
                      } as React.CSSProperties
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="analyze-row">
          <div>
            <span className="status-dot" />
            {t.autoDetect}
          </div>
          <button
            onClick={analyze}
            disabled={status === "loading" || !canAnalyze}
          >
            {status === "loading" ? t.analyzing : t.analyze}
            {status !== "loading" && <span>↗</span>}
          </button>
        </div>
        {error && (
          <div className="error-banner">{error}</div>
        )}
        <input
          ref={importInputRef}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          onChange={importJson}
        />
      </section>

      {!result && (
        <section className="methodology shell" id="method">
          <div className="method-intro">
            <p className="eyebrow">{t.methodEyebrow}</p>
            <h2>{t.methodTitle}</h2>
            <p>{t.methodIntro}</p>
          </div>
          <div className="method-cards">
            <article>
              <span>01</span>
              <div className="method-icon">◎</div>
              <h3>{t.officialStory}</h3>
              <p>{t.officialStoryCopy}</p>
            </article>
            <article>
              <span>02</span>
              <div className="method-icon">⌘</div>
              <h3>{t.openReality}</h3>
              <p>{t.openRealityCopy}</p>
            </article>
            <article>
              <span>03</span>
              <div className="method-icon">♡</div>
              <h3>{t.yourBetter}</h3>
              <p>{t.yourBetterCopy}</p>
            </article>
          </div>
          <div className="local-data-tools">
            <div>
              <p className="eyebrow">{t.localDataEyebrow}</p>
              <strong>{t.localDataTitle}</strong>
              <small>{t.localDataCopy}</small>
            </div>
            <button onClick={() => importInputRef.current?.click()}>
              {t.importReport}
            </button>
          </div>
          {history.length > 0 && (
            <div className="history-panel">
              <div className="history-head">
                <div>
                  <p className="eyebrow">{t.recentEyebrow}</p>
                  <h3>{t.recentTitle}</h3>
                </div>
                <div>
                  <button onClick={() => importInputRef.current?.click()}>
                    {t.import}
                  </button>
                  <button onClick={clearHistory}>{t.clear}</button>
                </div>
              </div>
              <div className="history-list">
                {history.map((saved) => (
                  <button key={saved.id} onClick={() => loadReport(saved)}>
                    <span>{saved.title}</span>
                    <small>
                      {new Date(saved.savedAt).toLocaleDateString(locale)} ·{" "}
                      {saved.result.recommendation.winner}
                    </small>
                    <b>{t.open}</b>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Link className="example-link" href="/examples/cmux-vs-otty">
            {t.exampleLink} <span>↗</span>
          </Link>
        </section>
      )}

      {result && (
      <section className="result shell" id="result">
        <div className="result-kicker">
          <span>
            {t.report} ·{" "}
            {new Date(result.generatedAt).toLocaleString(locale, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
          <div className="report-actions">
            <button onClick={copyBrief}>
              {copied ? t.copied : t.copyBrief}
            </button>
            <button onClick={exportMarkdown}>{t.exportMarkdown}</button>
            <button onClick={exportJson}>{t.exportJson}</button>
            <button onClick={() => importInputRef.current?.click()}>
              {t.import}
            </button>
            {!exampleMode && (
              <button onClick={startOver}>{t.newComparison}</button>
            )}
          </div>
        </div>

        <div className="verdict-card">
          <div className="verdict-main">
            <p>{t.forWorkflow}</p>
            <h2>
              {t.chooseNow}{" "}
              <span>{weightedWinner ?? result.recommendation.winner}</span>
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
              {weightedDecision.normalized[
                weightedWinner ?? result.recommendation.winner
              ] ?? currentWinner?.score ?? result.products[0].score}
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

        <div className="product-grid">
          {result.products.map((product, index) => {
            const coverage = calculateEvidenceCoverage(product);
            return (
              <article
                className={`product-card ${index === 0 ? "featured" : ""}`}
                key={product.name}
              >
              <header>
                <div>
                  <span className="product-letter">
                    {product.name.slice(0, 1)}
                  </span>
                  <div>
                    <h3>{product.name}</h3>
                    <p>{product.tagline}</p>
                  </div>
                </div>
                <SourcePill mode={product.sourceMode} t={t} />
              </header>

              <div className="confidence">
                <span>{t.confidence}</span>
                <div>
                  <i style={{ width: `${product.confidence}%` }} />
                </div>
                <b>{product.confidence}%</b>
              </div>

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
                  aria-label={`${t.coverage} ${coverage.score}%`}
                >
                  <i style={{ width: `${coverage.score}%` }} />
                </div>
                <p>
                  {coverage.verified} {t.verified} · {coverage.vendor} {t.vendor}{" "}
                  · {coverage.inferred} {t.inferred} · {coverage.sourceCount}{" "}
                  {t.sources}
                </p>
              </div>

              <p className="product-verdict">{product.verdict}</p>

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
                <h4>{t.keyEvidence}</h4>
                {product.evidence.map((item) => (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    key={item.claim}
                  >
                    <span className={`evidence-badge ${item.level}`}>
                      {evidenceLabels[item.level]}
                    </span>
                    <p>{item.claim}</p>
                    <small>{item.sourceLabel} ↗</small>
                  </a>
                ))}
              </div>
              </article>
            );
          })}
        </div>

        <div className="matrix-card">
          <header>
            <div>
              <span className="step-index">04</span>
              <h2>{t.matrixTitle}</h2>
            </div>
            <p>{t.matrixHint}</p>
          </header>
          <div className="matrix">
            {result.dimensions.map((dimension) => {
              const entries = Object.entries(dimension.productScores);
              return (
                <div className="matrix-row" key={dimension.key}>
                  <div className="matrix-label">
                    <strong>{dimension.label}</strong>
                    <small>
                      {t.weight} {priorities[dimension.key]}
                    </small>
                  </div>
                  <div className="matrix-bars">
                    {entries.map(([product, score]) => (
                      <div key={product}>
                        <span>{product}</span>
                        <i>
                          <b style={{ width: `${score}%` }} />
                        </i>
                        <strong>{score}</strong>
                      </div>
                    ))}
                  </div>
                  <p>{dimension.explanation}</p>
                </div>
              );
            })}
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
                </p>
              </div>
            ))}
          </div>
        </div>

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
              onChange={(event) => setNotes(event.target.value)}
              onBlur={saveNotes}
            />
            <span>
              {currentReportId
                ? t.notesSaved
                : t.notesExported}
            </span>
          </div>
        </div>
      </section>
      )}

      <footer className="shell">
        <Link className="brand" href="/">
          <BrandMark />
          <span>FitLens</span>
        </Link>
        <p>{t.footerMotto}</p>
        <span>{t.footerVersion}</span>
      </footer>
    </main>
  );
}
