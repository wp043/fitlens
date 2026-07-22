"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseReport,
  serializeReport,
  type SavedReport,
} from "@/lib/report";
import {
  messages,
  normalizeLocale,
  type Locale,
} from "@/lib/i18n";
import { sampleComparisonForLocale } from "@/lib/sample";
import {
  cloneCriteria,
  criteriaToWeights,
  getBuiltInCriteriaTemplates,
  type CriteriaTemplate,
} from "@/lib/criteria";
import { compareResults, type ComparisonDiff } from "@/lib/diff";
import { mergeManualEvidence } from "@/lib/evidence";
import { calibrateComparisonConfidence } from "@/lib/confidence";
import { calculateWeightedWinner } from "@/lib/scoring";
import { createRedactedReport } from "@/lib/redaction";
import { reportToAdr, reportToHtml } from "@/lib/durable-exports";
import { CandidateInbox } from "@/components/candidate-inbox";
import { BrandMark } from "@/components/workbench-primitives";
import { ComparisonProductCard } from "@/components/comparison-product-card";
import { ComparisonFollowup } from "@/components/comparison-followup";
import { ComparisonReportSummary } from "@/components/comparison-report-summary";
import { ComparisonBuilderEditor } from "@/components/comparison-builder-editor";
import { ResearchLibraryPanel } from "@/components/research-library-panel";
import {
  comparisonAsMarkdown,
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
  TrialResult,
  PairwiseTrialResult,
  PriorityWeights,
} from "@/lib/types";
import {
  canAnalyzeDraft,
  initialWorkbenchCriteria,
  isSourceFailure,
  moveCandidate,
  normalizeReportHistory,
  removeCandidate,
  type SourceFailure,
} from "@/lib/workbench-state";

class SourceCollectionRequestError extends Error {
  readonly failures: SourceFailure[];

  constructor(message: string, failures: SourceFailure[]) {
    super(message);
    this.name = "SourceCollectionRequestError";
    this.failures = failures;
  }
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
    initialWorkbenchCriteria(exampleMode, "zh-CN"),
  );
  const priorities = useMemo(() => criteriaToWeights(criteria), [criteria]);
  const [activeTemplateId, setActiveTemplateId] = useState(
    exampleMode ? "developer-tools" : "general",
  );
  const [result, setResult] = useState<ComparisonResult | undefined>(
    initialResult,
  );
  const [status, setStatus] = useState<
    "idle" | "loading" | "refreshing" | "cancelling" | "error"
  >("idle");
  const [analysisProgress, setAnalysisProgress] = useState("");
  const analysisAbortRef = useRef<AbortController | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => () => analysisAbortRef.current?.abort(), []);
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
            setCriteria(initialWorkbenchCriteria(true, nextLocale));
          } else {
            setCriteria(initialWorkbenchCriteria(false, nextLocale));
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
      setCriteria(initialWorkbenchCriteria(true, nextLocale));
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
  const canAnalyze = canAnalyzeDraft(urls, context, criteria);

  async function requestAnalysis(signal: AbortSignal) {
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
      signal,
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
    const next = removeCandidate(urls, sourceFailures, index);
    setUrls(next.urls);
    setSourceFailures(next.failures);
  }

  function moveProductUrl(index: number, offset: -1 | 1) {
    const next = moveCandidate(urls, sourceFailures, index, offset);
    setUrls(next.urls);
    setSourceFailures(next.failures);
  }

  async function analyze() {
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setStatus("loading");
    setAnalysisProgress(t.progressSource);
    setError("");
    try {
      const progressTimer = window.setTimeout(
        () => setAnalysisProgress(t.progressModel),
        1_500,
      );
      const payload = await requestAnalysis(controller.signal).finally(() =>
        clearTimeout(progressTimer),
      );
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
      handleAnalysisError(
        controller.signal.aborted ? new Error(t.analysisCancelled) : caught,
        "analyze",
        t.analyzeFailed,
      );
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = undefined;
      }
      setAnalysisProgress("");
    }
  }

  async function refreshAnalysis() {
    if (!result || !canAnalyze) return;
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setStatus("refreshing");
    setAnalysisProgress(t.progressSource);
    setError("");
    try {
      const previous = result;
      const progressTimer = window.setTimeout(
        () => setAnalysisProgress(t.progressModel),
        1_500,
      );
      const refreshed = await requestAnalysis(controller.signal).finally(() =>
        clearTimeout(progressTimer),
      );
      const payload = mergeManualEvidence(previous, refreshed);
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
        // Keep provenance for revisions without multiplying private source
        // snapshots in every report refresh.
        revisions: [
          ...(stored?.revisions ?? []),
          { ...previous, replayBundle: undefined },
        ].slice(
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
      handleAnalysisError(
        controller.signal.aborted ? new Error(t.analysisCancelled) : caught,
        "refresh",
        t.refreshFailed,
      );
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = undefined;
      }
      setAnalysisProgress("");
    }
  }

  function cancelAnalysis() {
    if (!analysisAbortRef.current) return;
    setStatus("cancelling");
    analysisAbortRef.current.abort();
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

  function exportReplayBundle() {
    if (!result?.replayBundle) return;
    downloadArtifact(
      `${JSON.stringify(result.replayBundle, null, 2)}\n`,
      `${safeFilename(result.title)}.fitlens-replay.json`,
      "application/json;charset=utf-8",
    );
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

        <ComparisonBuilderEditor
          urls={urls}
          failures={sourceFailures}
          context={context}
          criteria={criteria}
          templates={[...builtInTemplates, ...customTemplates]}
          activeTemplateId={activeTemplateId}
          templateName={templateName}
          decisionProfiles={decisionProfiles}
          decisionProfileName={decisionProfileName}
          showDecisionProfiles={!exampleMode}
          messages={t}
          onUrlsChange={(next, changedIndex) => {
            setUrls(next);
            setSourceFailures((current) => current.filter((failure) => failure.index !== changedIndex));
          }}
          onMove={moveProductUrl}
          onRemove={removeProductUrl}
          onAdd={addProductUrl}
          onContextChange={setContext}
          onApplyTemplate={applyTemplate}
          onDeleteTemplate={deleteCriteriaTemplate}
          onTemplateNameChange={setTemplateName}
          onSaveTemplate={saveCriteriaTemplate}
          onCriterionChange={updateCriterion}
          onRemoveCriterion={removeCriterion}
          onAddCriterion={addCriterion}
          onApplyDecisionProfile={applyDecisionProfile}
          onDeleteDecisionProfile={deleteDecisionProfile}
          onDecisionProfileNameChange={setDecisionProfileName}
          onSaveDecisionProfile={saveDecisionProfile}
        />

        <div className="analyze-row">
          <div>
            <span className="status-dot" />
            {t.autoDetect}
          </div>
          <button
            onClick={
              status === "loading" ||
              status === "refreshing" ||
              status === "cancelling"
                ? cancelAnalysis
                : analyze
            }
            disabled={
              status === "cancelling" || (status !== "loading" && status !== "refreshing" && !canAnalyze)
            }
          >
            {status === "cancelling"
              ? t.cancellingAnalysis
              : status === "loading" || status === "refreshing"
                ? t.cancelAnalysis
                : t.analyze}
            {status !== "loading" && status !== "refreshing" && status !== "cancelling" && <span>↗</span>}
          </button>
        </div>
        {analysisProgress && (
          <p role="status" aria-live="polite">{analysisProgress}</p>
        )}
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
              disabled={
                status === "loading" ||
                status === "refreshing" ||
                status === "cancelling"
              }
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
        <ComparisonReportSummary
          result={result}
          locale={locale}
          messages={t}
          status={status}
          canAnalyze={canAnalyze}
          copied={copied}
          exampleMode={exampleMode}
          error={error}
          weightedWinner={weightedWinner}
          weightedScores={weightedDecision.normalized}
          currentWinner={currentWinner}
          conflicts={conflicts}
          comparisonDiff={comparisonDiff}
          evidenceLabels={evidenceLabels}
          actions={{
            refresh: () => void refreshAnalysis(), copy: () => void copyBrief(),
            markdown: exportMarkdown, json: exportJson, replay: exportReplayBundle,
            html: exportHtml, adr: exportAdr, pdf: exportPdf,
            redactedMarkdown: exportRedactedMarkdown, redactedJson: exportRedactedJson,
            import: () => importInputRef.current?.click(), startOver,
          }}
        />

        <div className="product-grid">
          {result.products.map((product) => (
            <ComparisonProductCard
              key={product.name}
              product={product}
              calibration={confidenceCalibrations.find((item) => item.product === product.name)!}
              featured={product.name === (weightedWinner ?? result.recommendation.winner)}
              locale={locale}
              messages={t}
              evidenceLabels={evidenceLabels}
              onReview={updateEvidenceReview}
            />
          ))}
        </div>

        <ComparisonFollowup
          result={result}
          priorities={priorities}
          locale={locale}
          messages={t}
          manualEvidence={{ product: manualEvidenceProduct, claim: manualEvidenceClaim, level: manualEvidenceLevel, source: manualEvidenceSource, url: manualEvidenceUrl }}
          onManualEvidenceChange={(update) => {
            if (update.product !== undefined) setManualEvidenceProduct(update.product);
            if (update.claim !== undefined) setManualEvidenceClaim(update.claim);
            if (update.level !== undefined) setManualEvidenceLevel(update.level);
            if (update.source !== undefined) setManualEvidenceSource(update.source);
            if (update.url !== undefined) setManualEvidenceUrl(update.url);
          }}
          onAddManualEvidence={addManualEvidence}
          trialResults={trialResults}
          onTrialChange={updateTrialResult}
          pairwiseTrials={pairwiseTrials}
          onPairwiseChange={updatePairwiseTrials}
          notes={notes}
          notesSaved={Boolean(currentReportId)}
          onNotesChange={setNotes}
          onSaveNotes={saveNotes}
        />
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
