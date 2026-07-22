"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateEvidenceCoverage,
  normalizeSavedReport,
  parseReport,
  serializeReport,
  type SavedReport,
} from "@/lib/report";
import {
  messages,
  normalizeLocale,
  type Locale,
} from "@/lib/i18n";
import { examplePriorities, sampleComparisonForLocale } from "@/lib/sample";
import {
  cloneCriteria,
  criteriaToWeights,
  getBuiltInCriteriaTemplates,
  type CriteriaTemplate,
} from "@/lib/criteria";
import { compareResults, type ComparisonDiff } from "@/lib/diff";
import { mergeManualEvidence } from "@/lib/evidence";
import { calculateEvidenceFreshness } from "@/lib/freshness";
import { calibrateComparisonConfidence } from "@/lib/confidence";
import { calculateWeightedWinner } from "@/lib/scoring";
import { createRedactedReport } from "@/lib/redaction";
import { reportToAdr, reportToHtml } from "@/lib/durable-exports";
import { CandidateInbox } from "@/components/candidate-inbox";
import { PairwiseTrials } from "@/components/pairwise-trials";
import { BrandMark, SourcePill } from "@/components/workbench-primitives";
import { ResearchLibraryPanel } from "@/components/research-library-panel";
import {
  cadenceLabel,
  comparisonAsMarkdown,
  confidenceBandLabel,
  confidenceFactorLabel,
  conflictTopicLabel,
  formatDelta,
  privacyCategoryLabel,
  privacyRiskLabel,
  privacyStatusLabel,
  safeFilename,
} from "@/components/compare-workbench-format";
import {
  normalizeDecisionProfiles,
  type DecisionProfile,
} from "@/lib/decision-profiles";
import {
  deleteBrowserValue,
  loadBrowserValue,
  persistBrowserValue,
} from "@/lib/persistence";
import {
  normalizeCandidateInbox,
  type CandidateInboxItem,
} from "@/lib/candidate-inbox";
import {
  detectEvidenceConflicts,
  type EvidenceConflict,
} from "@/lib/conflicts";
import type {
  ComparisonCriterion,
  ComparisonResult,
  Evidence,
  EvidenceLevel,
  EvidenceReviewStatus,
  TrialResult,
  PairwiseTrialResult,
  TrialStatus,
  PriorityWeights,
} from "@/lib/types";
import type { SourceErrorCode } from "@/lib/source";

interface SourceFailure {
  index: number;
  url: string;
  code: SourceErrorCode;
  message: string;
}

const sourceErrorCodes = new Set<SourceErrorCode>([
  "invalidUrl",
  "httpOnly",
  "credentialsNotAllowed",
  "privateNetwork",
  "fetchFailed",
  "unsupportedContentType",
  "pageTooLarge",
  "githubFailed",
]);

class SourceCollectionRequestError extends Error {
  readonly failures: SourceFailure[];

  constructor(message: string, failures: SourceFailure[]) {
    super(message);
    this.name = "SourceCollectionRequestError";
    this.failures = failures;
  }
}

function isSourceFailure(value: unknown): value is SourceFailure {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Number.isInteger(candidate.index) &&
    typeof candidate.url === "string" &&
    typeof candidate.code === "string" &&
    sourceErrorCodes.has(candidate.code as SourceErrorCode) &&
    typeof candidate.message === "string";
}

interface LegacyPreferenceProfile {
  id: string;
  name: string;
  weights: PriorityWeights;
}

const historyKey = "fitlens-report-history-v1";
const sessionApiKey = "fitlens-openai-api-key-v1";
const preferenceProfilesKey = "fitlens-preference-profiles-v1";
const criteriaTemplatesKey = "fitlens-criteria-templates-v1";
const localeKey = "fitlens-locale-v1";
const candidateInboxKey = "fitlens-candidate-inbox-v1";
const decisionProfilesKey = "fitlens-decision-profiles-v1";

const maxSavedReports = 50;
const maxRevisions = 5;

function normalizeReportHistory(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((report) => {
      try {
        return normalizeSavedReport(report);
      } catch {
        return undefined;
      }
    })
    .filter((report): report is SavedReport => Boolean(report));
}

function initialCriteria(exampleMode: boolean, locale: Locale) {
  const templates = getBuiltInCriteriaTemplates(locale);
  const template = templates.find(
    (item) => item.id === (exampleMode ? "developer-tools" : "general"),
  )!;
  return template.criteria.map((criterion) => ({
    ...criterion,
    weight: exampleMode
      ? (examplePriorities[criterion.key] ?? criterion.weight)
      : criterion.weight,
  }));
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
  const builtInTemplates = useMemo(
    () => getBuiltInCriteriaTemplates(locale),
    [locale],
  );
  const evidenceLabels: Record<EvidenceLevel, string> = {
    verified: t.verified,
    vendor: t.vendor,
    inferred: t.inferred,
  };
  const [urls, setUrls] = useState<string[]>(
    exampleMode
      ? ["https://cmux.com/", "https://otty.sh/"]
      : ["", ""],
  );
  const [context, setContext] = useState(
    exampleMode
      ? messages["zh-CN"].exampleContext
      : "",
  );
  const [criteria, setCriteria] = useState<ComparisonCriterion[]>(
    initialCriteria(exampleMode, "zh-CN"),
  );
  const priorities = useMemo(() => criteriaToWeights(criteria), [criteria]);
  const [activeTemplateId, setActiveTemplateId] = useState(
    exampleMode ? "developer-tools" : "general",
  );
  const [result, setResult] = useState<ComparisonResult | undefined>(
    initialResult,
  );
  const [status, setStatus] = useState<
    "idle" | "loading" | "refreshing" | "error"
  >("idle");
  const [error, setError] = useState("");
  const [sourceFailures, setSourceFailures] = useState<SourceFailure[]>([]);
  const [sourceRetryMode, setSourceRetryMode] = useState<"analyze" | "refresh">(
    "analyze",
  );
  const [history, setHistory] = useState<SavedReport[]>([]);
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [currentReportId, setCurrentReportId] = useState<string>();
  const [notes, setNotes] = useState("");
  const [customTemplates, setCustomTemplates] = useState<CriteriaTemplate[]>(
    [],
  );
  const [templateName, setTemplateName] = useState("");
  const [comparisonDiff, setComparisonDiff] = useState<ComparisonDiff>();
  const [trialResults, setTrialResults] = useState<TrialResult[]>([]);
  const [pairwiseTrials, setPairwiseTrials] = useState<PairwiseTrialResult[]>([]);
  const [decisionProfiles, setDecisionProfiles] = useState<DecisionProfile[]>([]);
  const [decisionProfileName, setDecisionProfileName] = useState("");
  const [conflicts, setConflicts] = useState<EvidenceConflict[]>(() =>
    initialResult ? detectEvidenceConflicts(initialResult) : [],
  );
  const [manualEvidenceProduct, setManualEvidenceProduct] = useState("");
  const [manualEvidenceClaim, setManualEvidenceClaim] = useState("");
  const [manualEvidenceSource, setManualEvidenceSource] = useState("");
  const [manualEvidenceUrl, setManualEvidenceUrl] = useState("");
  const [manualEvidenceLevel, setManualEvidenceLevel] = useState<Evidence["level"]>(
    "verified",
  );
  const [candidateInbox, setCandidateInbox] = useState<CandidateInboxItem[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void (async () => {
        try {
          const requestedLocale = new URLSearchParams(
            window.location.search,
          ).get("lang");
          const nextLocale = normalizeLocale(
            requestedLocale ??
              window.localStorage.getItem(localeKey) ??
              navigator.language,
          );
          setLocale(nextLocale);
          document.documentElement.lang = nextLocale;

          const saved = await loadBrowserValue(
            historyKey,
            normalizeReportHistory,
          );
          if (saved) {
            setHistory(saved);
          }
          setApiKey(window.sessionStorage.getItem(sessionApiKey) ?? "");
          const candidates = await loadBrowserValue(
            candidateInboxKey,
            normalizeCandidateInbox,
          );
          if (candidates) setCandidateInbox(candidates);
          const storedDecisionProfiles = window.localStorage.getItem(decisionProfilesKey);
          if (storedDecisionProfiles) {
            setDecisionProfiles(
              normalizeDecisionProfiles(JSON.parse(storedDecisionProfiles)),
            );
          }
          const storedTemplates = window.localStorage.getItem(
            criteriaTemplatesKey,
          );
          if (storedTemplates) {
            setCustomTemplates(
              (JSON.parse(storedTemplates) as CriteriaTemplate[]).map(
                (template) => ({
                  ...template,
                  builtIn: false,
                  criteria: cloneCriteria(template.criteria),
                }),
              ),
            );
          } else {
            const legacyProfiles = window.localStorage.getItem(
              preferenceProfilesKey,
            );
            if (legacyProfiles) {
              const developerCriteria =
                getBuiltInCriteriaTemplates(nextLocale).find(
                  (template) => template.id === "developer-tools",
                )!.criteria;
              const migrated = (
                JSON.parse(legacyProfiles) as LegacyPreferenceProfile[]
              ).map((profile) => ({
                id: profile.id,
                name: profile.name,
                criteria: developerCriteria.map((criterion) => ({
                  ...criterion,
                  weight: profile.weights[criterion.key] ?? criterion.weight,
                })),
                builtIn: false,
              }));
              setCustomTemplates(migrated);
              window.localStorage.setItem(
                criteriaTemplatesKey,
                JSON.stringify(migrated),
              );
              window.localStorage.removeItem(preferenceProfilesKey);
            }
          }

          if (exampleMode) {
            setContext(messages[nextLocale].exampleContext);
            setResult(sampleComparisonForLocale(nextLocale));
            setConflicts(
              detectEvidenceConflicts(sampleComparisonForLocale(nextLocale)),
            );
            setCriteria(initialCriteria(true, nextLocale));
          } else {
            setCriteria(initialCriteria(false, nextLocale));
          }
        } catch {
          // A malformed or unavailable local store should never block comparing.
        }
      })();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exampleMode]);

  function changeLocale(nextLocale: Locale) {
    const localizedTemplate = getBuiltInCriteriaTemplates(nextLocale).find(
      (template) => template.id === activeTemplateId,
    );
    setLocale(nextLocale);
    if (localizedTemplate) {
      setCriteria(
        localizedTemplate.criteria.map((criterion) => ({
          ...criterion,
          weight:
            criteria.find((current) => current.key === criterion.key)?.weight ??
            criterion.weight,
        })),
      );
    }
    window.localStorage.setItem(localeKey, nextLocale);
    document.documentElement.lang = nextLocale;
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("lang", nextLocale);
    window.history.replaceState({}, "", currentUrl);
    if (exampleMode && !currentReportId) {
      setContext(messages[nextLocale].exampleContext);
      setResult(sampleComparisonForLocale(nextLocale));
      setConflicts(
        detectEvidenceConflicts(sampleComparisonForLocale(nextLocale)),
      );
      setCriteria(initialCriteria(true, nextLocale));
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
  const confidenceCalibrations = useMemo(
    () =>
      result
        ? calibrateComparisonConfidence(result.products, conflicts)
        : [],
    [conflicts, result],
  );
  const currentWinner = result?.products.find(
    (product) => product.name === weightedWinner,
  );
  const canAnalyze =
    urls.length >= 2 &&
    urls.length <= 8 &&
    urls.every((url) => url.trim().length > 0) &&
    context.trim().length >= 10 &&
    criteria.length >= 2 &&
    criteria.length <= 8 &&
    criteria.every(
      (criterion) =>
        criterion.label.trim().length > 0 && criterion.key.trim().length > 0,
    );

  async function requestAnalysis() {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey.trim()
          ? { "X-FitLens-OpenAI-Key": apiKey.trim() }
          : {}),
      },
      body: JSON.stringify({
        urls,
        context,
        criteria: cloneCriteria(criteria),
        locale,
      }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      if (
        payload.code === "source_collection_failed" &&
        Array.isArray(payload.sourceFailures) &&
        payload.sourceFailures.every(isSourceFailure)
      ) {
        throw new SourceCollectionRequestError(
          typeof payload.error === "string" ? payload.error : t.analyzeFailed,
          payload.sourceFailures,
        );
      }
      throw new Error(
        typeof payload.error === "string" ? payload.error : t.analyzeFailed,
      );
    }
    return payload as unknown as ComparisonResult;
  }

  function handleAnalysisError(
    caught: unknown,
    retryMode: "analyze" | "refresh",
    fallback: string,
  ) {
    if (caught instanceof SourceCollectionRequestError) {
      setSourceFailures(caught.failures);
      setSourceRetryMode(retryMode);
      setError("");
    } else {
      setSourceFailures([]);
      setError(caught instanceof Error ? caught.message : fallback);
    }
    setStatus("error");
  }

  function addProductUrl() {
    if (urls.length < 8) setUrls((current) => [...current, ""]);
  }

  function removeProductUrl(index: number) {
    if (urls.length <= 2) return;
    setUrls((current) => current.filter((_, candidate) => candidate !== index));
    setSourceFailures((current) =>
      current
        .filter((failure) => failure.index !== index)
        .map((failure) => ({
          ...failure,
          index: failure.index > index ? failure.index - 1 : failure.index,
        })),
    );
  }

  function moveProductUrl(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= urls.length) return;
    setUrls((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSourceFailures((current) =>
      current.map((failure) => ({
        ...failure,
        index:
          failure.index === index
            ? target
            : failure.index === target
              ? index
              : failure.index,
      })),
    );
  }

  async function analyze() {
    setStatus("loading");
    setError("");
    try {
      const payload = await requestAnalysis();
      const detectedConflicts = detectEvidenceConflicts(payload);
      setResult(payload);
      setSourceFailures([]);
      setConflicts(detectedConflicts);
      setTrialResults(
        payload.trialPlan.map((task) => ({ task: task.task, status: "untested", note: "" })),
      );
      setPairwiseTrials([]);
      setComparisonDiff(undefined);
      const saved: SavedReport = {
        id: crypto.randomUUID(),
        title: payload.title,
        savedAt: new Date().toISOString(),
        urls,
        context,
        priorities,
        criteria: cloneCriteria(criteria),
        result: payload,
        notes: "",
        locale,
        revisions: [],
        trialResults: payload.trialPlan.map((task) => ({
          task: task.task,
          status: "untested",
          note: "",
        })),
        pairwiseTrials: [],
        conflicts: detectedConflicts,
        confidenceCalibrations: calibrateComparisonConfidence(
          payload.products,
          detectedConflicts,
        ),
      };
      const nextHistory = [saved, ...history].slice(0, maxSavedReports);
      setHistory(nextHistory);
      setCurrentReportId(saved.id);
      setNotes("");
      void persistBrowserValue(historyKey, nextHistory);
      setStatus("idle");
      setTimeout(
        () =>
          document
            .querySelector("#result")
            ?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    } catch (caught) {
      handleAnalysisError(caught, "analyze", t.analyzeFailed);
    }
  }

  async function refreshAnalysis() {
    if (!result || !canAnalyze) return;
    setStatus("refreshing");
    setError("");
    try {
      const previous = result;
      const payload = mergeManualEvidence(previous, await requestAnalysis());
      const detectedConflicts = detectEvidenceConflicts(payload);
      const nextDiff = compareResults(previous, payload, criteria);
      const stored = history.find((report) => report.id === currentReportId);
      const reportId = stored?.id ?? currentReportId ?? crypto.randomUUID();
      const saved: SavedReport = {
        id: reportId,
        title: payload.title,
        savedAt: stored?.savedAt ?? new Date().toISOString(),
        urls,
        context,
        priorities,
        criteria: cloneCriteria(criteria),
        result: payload,
        notes,
        locale,
        revisions: [...(stored?.revisions ?? []), previous].slice(
          -maxRevisions,
        ),
        trialResults: stored?.trialResults ?? trialResults,
        pairwiseTrials: stored?.pairwiseTrials ?? pairwiseTrials,
        conflicts: detectedConflicts,
        confidenceCalibrations: calibrateComparisonConfidence(
          payload.products,
          detectedConflicts,
        ),
      };
      const nextHistory = stored
        ? history.map((report) => (report.id === reportId ? saved : report))
        : [saved, ...history].slice(0, maxSavedReports);
      setResult(payload);
      setSourceFailures([]);
      setConflicts(detectedConflicts);
      setTrialResults(
        stored?.trialResults ??
          payload.trialPlan.map((task) => ({
            task: task.task,
            status: "untested",
            note: "",
          })),
      );
      setPairwiseTrials(stored?.pairwiseTrials ?? pairwiseTrials);
      setComparisonDiff(nextDiff);
      setHistory(nextHistory);
      setCurrentReportId(reportId);
      void persistBrowserValue(historyKey, nextHistory);
      setStatus("idle");
    } catch (caught) {
      handleAnalysisError(caught, "refresh", t.refreshFailed);
    }
  }

  function loadReport(saved: SavedReport) {
    changeLocale(saved.locale ?? "zh-CN");
    setUrls(saved.urls);
    setContext(saved.context);
    setCriteria(cloneCriteria(saved.criteria));
    setActiveTemplateId("");
    setResult(saved.result);
    setTrialResults(saved.trialResults);
    setPairwiseTrials(saved.pairwiseTrials ?? []);
    setConflicts(saved.conflicts);
    setSourceFailures([]);
    setError("");
    setCurrentReportId(saved.id);
    setNotes(saved.notes ?? "");
    setManualEvidenceProduct(saved.result.products[0]?.name ?? "");
    const previous = saved.revisions.at(-1);
    setComparisonDiff(
      previous
        ? compareResults(previous, saved.result, saved.criteria)
        : undefined,
    );
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
    void deleteBrowserValue(historyKey);
  }

  function reuseReportInputs(saved: SavedReport) {
    changeLocale(saved.locale ?? "zh-CN");
    setUrls(saved.urls);
    setContext(saved.context);
    setCriteria(cloneCriteria(saved.criteria));
    setActiveTemplateId("");
    setResult(undefined);
    setCurrentReportId(undefined);
    setNotes("");
    setComparisonDiff(undefined);
    setTrialResults([]);
    setPairwiseTrials([]);
    setConflicts([]);
    setSourceFailures([]);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copyBrief() {
    if (!result) return;
    await navigator.clipboard.writeText(
      comparisonAsMarkdown(result, notes, locale, t, trialResults, conflicts, false, pairwiseTrials),
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  }

  function exportMarkdown() {
    if (!result) return;
    const blob = new Blob(
      [comparisonAsMarkdown(result, notes, locale, t, trialResults, conflicts, false, pairwiseTrials)],
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
      criteria: cloneCriteria(criteria),
      result,
      notes,
      locale: stored?.locale ?? locale,
      revisions: stored?.revisions ?? [],
      trialResults,
      pairwiseTrials,
      conflicts,
      confidenceCalibrations,
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

  function downloadArtifact(content: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportHtml() {
    const report = currentPortableReport();
    if (!report) return;
    downloadArtifact(
      reportToHtml(report),
      `${safeFilename(report.title)}.html`,
      "text/html;charset=utf-8",
    );
  }

  function exportAdr() {
    const report = currentPortableReport();
    if (!report) return;
    downloadArtifact(
      reportToAdr(report),
      `${safeFilename(report.title)}.adr.md`,
      "text/markdown;charset=utf-8",
    );
  }

  function exportPdf() {
    const report = currentPortableReport();
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([reportToHtml(report)], { type: "text/html;charset=utf-8" }),
    );
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.src = url;
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 1_000);
    };
    document.body.appendChild(frame);
  }

  function exportRedactedMarkdown() {
    const localReport = currentPortableReport();
    if (!localReport) return;
    const { report } = createRedactedReport(localReport);
    const blob = new Blob(
      [
        comparisonAsMarkdown(
          report.result,
          "",
          locale,
          t,
          [],
          report.conflicts,
          true,
        ),
      ],
      { type: "text/markdown;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFilename(report.title)}.shared.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportRedactedJson() {
    const localReport = currentPortableReport();
    if (!localReport) return;
    const { report } = createRedactedReport(localReport);
    const blob = new Blob([serializeReport(report)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFilename(report.title)}.shared.fitlens.json`;
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
      const nextHistory = [saved, ...history].slice(0, maxSavedReports);
      setHistory(nextHistory);
      void persistBrowserValue(historyKey, nextHistory);
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
    void persistBrowserValue(historyKey, nextHistory);
  }

  function updateTrialResult(
    index: number,
    update: Partial<Pick<TrialResult, "status" | "note">>,
  ) {
    if (!result) return;
    const nextResults = result.trialPlan.map((task, taskIndex) => ({
      ...(trialResults[taskIndex] ?? {
        task: task.task,
        status: "untested" as const,
        note: "",
      }),
      ...(taskIndex === index ? update : {}),
      ...(taskIndex === index ? { updatedAt: new Date().toISOString() } : {}),
    }));
    setTrialResults(nextResults);
    if (currentReportId) {
      const nextHistory = history.map((report) =>
        report.id === currentReportId
          ? { ...report, trialResults: nextResults }
          : report,
      );
      setHistory(nextHistory);
      void persistBrowserValue(historyKey, nextHistory);
    }
  }

  function updatePairwiseTrials(nextTrials: PairwiseTrialResult[]) {
    setPairwiseTrials(nextTrials);
    if (!currentReportId) return;
    const nextHistory = history.map((report) =>
      report.id === currentReportId
        ? { ...report, pairwiseTrials: nextTrials }
        : report,
    );
    setHistory(nextHistory);
    void persistBrowserValue(historyKey, nextHistory);
  }

  function updateEvidenceReview(
    productName: string,
    evidenceIndex: number,
    update: Partial<
      Pick<Evidence, "claim" | "reviewStatus" | "reviewNote">
    >,
  ) {
    if (!result) return;
    const nextResult: ComparisonResult = {
      ...result,
      products: result.products.map((product) => {
        if (product.name !== productName) return product;
        return {
          ...product,
          evidence: product.evidence.map((evidence, index) => {
            if (index !== evidenceIndex) return evidence;
            const nextClaim = update.claim?.trim() || evidence.claim;
            const claimChanged = nextClaim !== evidence.claim;
            return {
              ...evidence,
              ...update,
              claim: nextClaim,
              originalClaim: claimChanged
                ? evidence.originalClaim ?? evidence.claim
                : evidence.originalClaim,
              reviewedAt:
                update.reviewStatus && update.reviewStatus !== "unreviewed"
                  ? new Date().toISOString()
                  : update.reviewStatus === "unreviewed"
                    ? undefined
                    : evidence.reviewedAt,
            };
          }),
        };
      }),
    };
    const nextConflicts = detectEvidenceConflicts(nextResult);
    setResult(nextResult);
    setConflicts(nextConflicts);
    const nextHistory = history.map((report) =>
      report.id === currentReportId
        ? {
            ...report,
            result: nextResult,
            conflicts: nextConflicts,
            confidenceCalibrations: calibrateComparisonConfidence(
              nextResult.products,
              nextConflicts,
            ),
          }
        : report,
    );
    setHistory(nextHistory);
    if (currentReportId) {
      void persistBrowserValue(historyKey, nextHistory);
    }
  }

  function addManualEvidence() {
    const productName = manualEvidenceProduct || result?.products[0]?.name;
    if (!result || !productName) return;
    const claim = manualEvidenceClaim.trim();
    const sourceLabel = manualEvidenceSource.trim();
    const sourceUrl = manualEvidenceUrl.trim();
    if (!claim || !sourceLabel) return;
    try {
      const parsedUrl = new URL(sourceUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) return;
    } catch {
      return;
    }
    const evidence: Evidence = {
      claim,
      level: manualEvidenceLevel,
      sourceLabel,
      sourceUrl,
      origin: "manual",
      capturedAt: new Date().toISOString(),
      reviewStatus: "accepted",
      reviewedAt: new Date().toISOString(),
    };
    const nextResult: ComparisonResult = {
      ...result,
      products: result.products.map((product) =>
        product.name === productName
          ? {
              ...product,
              evidence: product.evidence.some(
                (item) =>
                  item.claim === evidence.claim &&
                  item.sourceUrl === evidence.sourceUrl,
              )
                ? product.evidence
                : [...product.evidence, evidence],
            }
          : product,
      ),
    };
    const nextConflicts = detectEvidenceConflicts(nextResult);
    setResult(nextResult);
    setConflicts(nextConflicts);
    const stored = history.find((report) => report.id === currentReportId);
    const previousRevision = stored?.revisions.at(-1);
    if (previousRevision) {
      setComparisonDiff(compareResults(previousRevision, nextResult, criteria));
    }
    const nextHistory = history.map((report) =>
      report.id === currentReportId
        ? {
            ...report,
            result: nextResult,
            conflicts: nextConflicts,
            confidenceCalibrations: calibrateComparisonConfidence(
              nextResult.products,
              nextConflicts,
            ),
          }
        : report,
    );
    setHistory(nextHistory);
    if (currentReportId) {
      void persistBrowserValue(historyKey, nextHistory);
    }
    setManualEvidenceClaim("");
    setManualEvidenceSource("");
    setManualEvidenceUrl("");
  }

  function applyTemplate(template: CriteriaTemplate) {
    setCriteria(cloneCriteria(template.criteria));
    setActiveTemplateId(template.id);
  }

  function updateCriterion(
    key: string,
    update: Partial<Omit<ComparisonCriterion, "key">>,
  ) {
    setCriteria((current) =>
      current.map((criterion) =>
        criterion.key === key ? { ...criterion, ...update } : criterion,
      ),
    );
    setActiveTemplateId("");
  }

  function addCriterion() {
    if (criteria.length >= 8) return;
    setCriteria((current) => [
      ...current,
      {
        key: `custom-${crypto.randomUUID()}`,
        label: t.newCriterion,
        hint: t.newCriterionHint,
        weight: 60,
      },
    ]);
    setActiveTemplateId("");
  }

  function removeCriterion(key: string) {
    if (criteria.length <= 2) return;
    setCriteria((current) =>
      current.filter((criterion) => criterion.key !== key),
    );
    setActiveTemplateId("");
  }

  function saveCriteriaTemplate() {
    const name = templateName.trim();
    if (!name) return;
    const nextTemplates = [
      ...customTemplates,
      {
        id: crypto.randomUUID(),
        name,
        criteria: cloneCriteria(criteria),
        builtIn: false,
      },
    ];
    setCustomTemplates(nextTemplates);
    setTemplateName("");
    window.localStorage.setItem(
      criteriaTemplatesKey,
      JSON.stringify(nextTemplates),
    );
  }

  function deleteCriteriaTemplate(id: string) {
    const nextTemplates = customTemplates.filter(
      (template) => template.id !== id,
    );
    setCustomTemplates(nextTemplates);
    window.localStorage.setItem(
      criteriaTemplatesKey,
      JSON.stringify(nextTemplates),
    );
  }

  function saveDecisionProfile() {
    const name = decisionProfileName.trim();
    if (!name || context.trim().length < 10) return;
    const nextProfiles = [
      ...decisionProfiles,
      {
        id: crypto.randomUUID(),
        name,
        context: context.trim(),
        criteria: cloneCriteria(criteria),
        createdAt: new Date().toISOString(),
      },
    ];
    setDecisionProfiles(nextProfiles);
    setDecisionProfileName("");
    window.localStorage.setItem(decisionProfilesKey, JSON.stringify(nextProfiles));
  }

  function applyDecisionProfile(profile: DecisionProfile) {
    setContext(profile.context);
    setCriteria(cloneCriteria(profile.criteria));
    setActiveTemplateId("");
  }

  function deleteDecisionProfile(id: string) {
    const nextProfiles = decisionProfiles.filter((profile) => profile.id !== id);
    setDecisionProfiles(nextProfiles);
    window.localStorage.setItem(decisionProfilesKey, JSON.stringify(nextProfiles));
  }

  function persistCandidateInbox(items: CandidateInboxItem[]) {
    setCandidateInbox(items);
    void persistBrowserValue(candidateInboxKey, items);
  }

  function compareCandidateUrls(candidateUrls: string[]) {
    setUrls(candidateUrls);
    setSourceFailures([]);
    document
      .querySelector(".compare-builder")
      ?.scrollIntoView({ behavior: "smooth" });
  }

  function startOver() {
    setResult(undefined);
    setUrls(["", ""]);
    setContext("");
    setError("");
    setCurrentReportId(undefined);
    setNotes("");
    setComparisonDiff(undefined);
    setConflicts([]);
    setTrialResults([]);
    setPairwiseTrials([]);
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

      {!exampleMode && (
        <CandidateInbox
          items={candidateInbox}
          locale={locale}
          messages={t}
          onChange={persistCandidateInbox}
          onCompare={compareCandidateUrls}
        />
      )}

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
          {urls.map((url, index) => {
            const sourceFailure = sourceFailures.find(
              (failure) => failure.index === index,
            );
            const diagnosticId = `source-failure-${index}`;
            return (
              <div
                className={`url-field${sourceFailure ? " source-failed" : ""}`}
                key={index}
              >
                <span>
                  {t.product} {String.fromCharCode(65 + index)}
                </span>
                <div className="url-input-row">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7-7.1l-1.1 1" />
                    <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7 7.1l1.1-1" />
                  </svg>
                  <input
                    value={url}
                    placeholder={`https://product-${String.fromCharCode(97 + index)}.com`}
                    onChange={(event) => {
                      const next = [...urls];
                      next[index] = event.target.value;
                      setUrls(next);
                      setSourceFailures((current) =>
                        current.filter((failure) => failure.index !== index),
                      );
                    }}
                    aria-label={`${t.product} ${String.fromCharCode(65 + index)} URL`}
                    aria-invalid={sourceFailure ? true : undefined}
                    aria-describedby={sourceFailure ? diagnosticId : undefined}
                  />
                  <div className="url-actions">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveProductUrl(index, -1)}
                      aria-label={`${t.moveProductUp}: ${index + 1}`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === urls.length - 1}
                      onClick={() => moveProductUrl(index, 1)}
                      aria-label={`${t.moveProductDown}: ${index + 1}`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={urls.length <= 2}
                      onClick={() => removeProductUrl(index)}
                      aria-label={`${t.removeProduct}: ${index + 1}`}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {sourceFailure && (
                  <p className="source-failure-detail" id={diagnosticId}>
                    <strong>{sourceFailure.code}</strong>
                    {t[sourceFailure.code]}
                  </p>
                )}
              </div>
            );
          })}
          {urls.length < 8 && (
            <button
              className="add-product-button"
              type="button"
              onClick={addProductUrl}
            >
              + {t.addProduct}
            </button>
          )}
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
                {[...builtInTemplates, ...customTemplates].map((template) => (
                  <span
                    className={`profile-chip ${
                      activeTemplateId === template.id ? "active" : ""
                    }`}
                    key={template.id}
                  >
                    <button
                      type="button"
                      onClick={() => applyTemplate(template)}
                    >
                      {template.name}
                    </button>
                    {!template.builtIn && (
                      <button
                        type="button"
                        aria-label={`${t.deleteTemplate}: ${template.name}`}
                        onClick={() => deleteCriteriaTemplate(template.id)}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <div className="save-profile">
                <input
                  value={templateName}
                  maxLength={32}
                  placeholder={t.saveTemplatePlaceholder}
                  aria-label={t.templateNameAria}
                  onChange={(event) => setTemplateName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveCriteriaTemplate();
                  }}
                />
                <button
                  type="button"
                  disabled={!templateName.trim()}
                  onClick={saveCriteriaTemplate}
                >
                  {t.save}
                </button>
              </div>
            </div>
            <div className="criteria-editor">
              <p className="criteria-help">{t.criteriaHelp}</p>
              {criteria.map((criterion, index) => (
                <div className="criterion-card" key={criterion.key}>
                  <div className="criterion-fields">
                    <span className="criterion-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <label>
                      <span>{t.criterionName}</span>
                      <input
                        value={criterion.label}
                        maxLength={80}
                        onChange={(event) =>
                          updateCriterion(criterion.key, {
                            label: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>{t.criterionDescription}</span>
                      <input
                        value={criterion.hint}
                        maxLength={200}
                        onChange={(event) =>
                          updateCriterion(criterion.key, {
                            hint: event.target.value,
                          })
                        }
                      />
                    </label>
                    <button
                      className="remove-criterion"
                      type="button"
                      disabled={criteria.length <= 2}
                      aria-label={`${t.removeCriterion}: ${criterion.label}`}
                      onClick={() => removeCriterion(criterion.key)}
                    >
                      ×
                    </button>
                  </div>
                  <label className="criterion-weight">
                    <span className="slider-copy">
                      <span>
                        <strong>{t.weight}</strong>
                        <small>{criterion.hint}</small>
                      </span>
                      <b>{criterion.weight}</b>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={criterion.weight}
                      onChange={(event) =>
                        updateCriterion(criterion.key, {
                          weight: Number(event.target.value),
                        })
                      }
                      style={
                        {
                          "--range": `${criterion.weight}%`,
                        } as React.CSSProperties
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                className="add-criterion"
                type="button"
                disabled={criteria.length >= 8}
                onClick={addCriterion}
              >
                <span>+</span> {t.addCriterion}
                <small>{criteria.length}/8</small>
              </button>
            </div>
          </div>
        </div>

        {!exampleMode && (
          <section className="decision-profiles-card">
            <div>
              <p className="eyebrow">{t.decisionProfilesTitle}</p>
              <h3>{t.decisionProfilesTitle}</h3>
              <p>{t.decisionProfilesCopy}</p>
            </div>
            <div className="decision-profile-list">
              {decisionProfiles.length > 0 ? (
                decisionProfiles.map((profile) => (
                  <span key={profile.id}>
                    <button type="button" onClick={() => applyDecisionProfile(profile)}>
                      {profile.name}
                    </button>
                    <button type="button" aria-label={`${t.deleteTemplate}: ${profile.name}`} onClick={() => deleteDecisionProfile(profile.id)}>
                      ×
                    </button>
                  </span>
                ))
              ) : (
                <small>{t.noDecisionProfiles}</small>
              )}
            </div>
            <div className="decision-profile-save">
              <input
                value={decisionProfileName}
                placeholder={t.decisionProfileName}
                onChange={(event) => setDecisionProfileName(event.target.value)}
              />
              <button
                type="button"
                disabled={!decisionProfileName.trim() || context.trim().length < 10}
                onClick={saveDecisionProfile}
              >
                {t.saveDecisionProfile}
              </button>
            </div>
          </section>
        )}

        <div className="analyze-row">
          <div>
            <span className="status-dot" />
            {t.autoDetect}
          </div>
          <button
            onClick={analyze}
            disabled={
              status === "loading" || status === "refreshing" || !canAnalyze
            }
          >
            {status === "loading" ? t.analyzing : t.analyze}
            {status !== "loading" && <span>↗</span>}
          </button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {sourceFailures.length > 0 && (
          <div
            className="source-failure-summary"
            role="alert"
            aria-live="assertive"
          >
            <div>
              <strong>
                {t.sourceFailureSummary.replace(
                  "{count}",
                  String(sourceFailures.length),
                )}
              </strong>
              <span>{t.sourceCollectionFailed}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (sourceRetryMode === "refresh") void refreshAnalysis();
                else void analyze();
              }}
              disabled={status === "loading" || status === "refreshing"}
            >
              {t.retrySources} <span aria-hidden="true">↻</span>
            </button>
          </div>
        )}
        <input
          ref={importInputRef}
          className="visually-hidden"
          type="file"
          aria-label={t.importReport}
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
            <ResearchLibraryPanel
              history={history}
              locale={locale}
              messages={t}
              onImport={() => importInputRef.current?.click()}
              onClear={clearHistory}
              onOpen={loadReport}
              onReuse={reuseReportInputs}
            />
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
            <button
              className="refresh-report"
              onClick={refreshAnalysis}
              disabled={
                status === "refreshing" || status === "loading" || !canAnalyze
              }
            >
              {status === "refreshing" ? t.refreshing : t.refreshReport}
            </button>
            <button onClick={copyBrief}>
              {copied ? t.copied : t.copyBrief}
            </button>
            <button onClick={exportMarkdown}>{t.exportMarkdown}</button>
            <button onClick={exportJson}>{t.exportJson}</button>
            <button onClick={exportHtml}>{t.exportHtml}</button>
            <button onClick={exportAdr}>{t.exportAdr}</button>
            <button onClick={exportPdf}>{t.exportPdf}</button>
            <details className="share-menu">
              <summary>{t.shareSafeCopy}</summary>
              <div>
                <strong>{t.shareSafeTitle}</strong>
                <p>{t.shareSafeCopyDetail}</p>
                <button onClick={exportRedactedMarkdown}>
                  {t.shareMarkdown}
                </button>
                <button onClick={exportRedactedJson}>{t.shareJson}</button>
              </div>
            </details>
            <button onClick={() => importInputRef.current?.click()}>
              {t.import}
            </button>
            {!exampleMode && (
              <button onClick={startOver}>{t.newComparison}</button>
            )}
          </div>
        </div>
        {error && <div className="error-banner report-error">{error}</div>}

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
                        {t.verified}{" "}
                        {formatDelta(change.levels.verified.delta)} · {t.vendor}{" "}
                        {formatDelta(change.levels.vendor.delta)} · {t.inferred}{" "}
                        {formatDelta(change.levels.inferred.delta)}
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

        <div className="product-grid">
          {result.products.map((product) => {
            const coverage = calculateEvidenceCoverage(product);
            const freshness = calculateEvidenceFreshness(product);
            const calibration = confidenceCalibrations.find(
              (item) => item.product === product.name,
            )!;
            return (
              <article
                className={`product-card ${product.name === (weightedWinner ?? result.recommendation.winner) ? "featured" : ""}`}
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
                  <span><b>{calibration.verified}</b> {t.verified}</span>
                  <span><b>{calibration.vendor}</b> {t.vendor}</span>
                  <span><b>{calibration.inferred}</b> {t.inferred}</span>
                </div>
                <ul>
                  {calibration.factors.map((factor) => (
                    <li className={factor.effect} key={factor.key}>
                      <span>{factor.effect === "supporting" ? "+" : "!"}</span>
                      <div>
                        <b>{factor.effect === "supporting" ? t.confidenceSupporting : t.confidenceLimiting}</b>
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
                  {coverage.verified} {t.verified} · {coverage.vendor} {t.vendor}{" "}
                  · {coverage.inferred} {t.inferred} · {coverage.sourceCount}{" "}
                  {t.sources} · {t.sourceFreshness}: {freshness.fresh} {t.freshSources},{" "}
                  {freshness.aging} {t.agingSources}, {freshness.stale} {t.staleSources},{" "}
                  {freshness.unknown} {t.unknownFreshness}
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
                            updateEvidenceReview(product.name, evidenceIndex, {
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
                            updateEvidenceReview(product.name, evidenceIndex, {
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
                              updateEvidenceReview(product.name, evidenceIndex, {
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
                              updateEvidenceReview(product.name, evidenceIndex, {
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
                                updateEvidenceReview(product.name, evidenceIndex, {
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
          })}
        </div>

        <section className="manual-evidence-card" aria-labelledby="manual-evidence-title">
          <div className="manual-evidence-intro">
            <p className="eyebrow">{t.manualEvidenceTitle}</p>
            <h2 id="manual-evidence-title">{t.manualEvidenceTitle}</h2>
            <p>{t.manualEvidenceCopy}</p>
          </div>
          <form
            className="manual-evidence-form"
            onSubmit={(event) => {
              event.preventDefault();
              addManualEvidence();
            }}
          >
            <label>
              <span>{t.manualEvidenceProduct}</span>
              <select
                value={manualEvidenceProduct || result.products[0]?.name || ""}
                onChange={(event) => setManualEvidenceProduct(event.target.value)}
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
                value={manualEvidenceClaim}
                placeholder={t.manualEvidenceClaim}
                onChange={(event) => setManualEvidenceClaim(event.target.value)}
              />
            </label>
            <label>
              <span>{t.manualEvidenceLevel}</span>
              <select
                value={manualEvidenceLevel}
                onChange={(event) =>
                  setManualEvidenceLevel(event.target.value as Evidence["level"])
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
                value={manualEvidenceSource}
                placeholder={t.manualEvidenceSource}
                onChange={(event) => setManualEvidenceSource(event.target.value)}
              />
            </label>
            <label>
              <span>{t.manualEvidenceUrl}</span>
              <input
                type="url"
                required
                value={manualEvidenceUrl}
                placeholder="https://…"
                onChange={(event) => setManualEvidenceUrl(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={
                !manualEvidenceClaim.trim() ||
                !manualEvidenceSource.trim() ||
                !manualEvidenceUrl.trim()
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
            {result.dimensions.map((dimension) => {
              const entries = Object.entries(dimension.productScores);
              return (
                <div className="matrix-row" key={dimension.key}>
                  <div className="matrix-label">
                    <strong>{dimension.label}</strong>
                    <small>
                      {t.weight} {priorities[dimension.key] ?? 0}
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
                  <select
                    aria-label={`${t.trialStatus}: ${item.task}`}
                    value={trialResults[index]?.status ?? "untested"}
                    onChange={(event) =>
                      updateTrialResult(index, {
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
                      updateTrialResult(index, { note: event.target.value })
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
          onChange={updatePairwiseTrials}
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
