import { cloneCriteria, getBuiltInCriteriaTemplates } from "./criteria.ts";
import type { Locale } from "./i18n.ts";
import { normalizeSavedReport, type SavedReport } from "./report.ts";
import { examplePriorities } from "./sample.ts";
import type { ComparisonCriterion } from "./types.ts";
import type { SourceErrorCode } from "./source.ts";

export interface SourceFailure {
  index: number;
  url: string;
  code: SourceErrorCode;
  message: string;
}

export const MAX_SAVED_REPORTS = 50;

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

export function isSourceFailure(value: unknown): value is SourceFailure {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    Number.isInteger(candidate.index) &&
    typeof candidate.url === "string" &&
    typeof candidate.code === "string" &&
    sourceErrorCodes.has(candidate.code as SourceErrorCode) &&
    typeof candidate.message === "string"
  );
}

export function normalizeReportHistory(input: unknown): SavedReport[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((report) => {
    try {
      return [normalizeSavedReport(report)];
    } catch {
      return [];
    }
  }).slice(0, MAX_SAVED_REPORTS);
}

export function initialWorkbenchCriteria(
  exampleMode: boolean,
  locale: Locale,
): ComparisonCriterion[] {
  const template = getBuiltInCriteriaTemplates(locale).find(
    (item) => item.id === (exampleMode ? "developer-tools" : "general"),
  )!;
  return template.criteria.map((criterion) => ({
    ...criterion,
    weight: exampleMode
      ? (examplePriorities[criterion.key] ?? criterion.weight)
      : criterion.weight,
  }));
}

export function canAnalyzeDraft(
  urls: string[],
  context: string,
  criteria: ComparisonCriterion[],
) {
  return (
    urls.length >= 2 &&
    urls.length <= 8 &&
    urls.every((url) => url.trim().length > 0) &&
    context.trim().length >= 10 &&
    criteria.length >= 2 &&
    criteria.length <= 8 &&
    criteria.every(
      (criterion) =>
        criterion.label.trim().length > 0 && criterion.key.trim().length > 0,
    )
  );
}

export function removeCandidate(
  urls: string[],
  failures: SourceFailure[],
  index: number,
) {
  if (urls.length <= 2 || index < 0 || index >= urls.length) {
    return { urls, failures };
  }
  return {
    urls: urls.filter((_, candidate) => candidate !== index),
    failures: failures
      .filter((failure) => failure.index !== index)
      .map((failure) => ({
        ...failure,
        index: failure.index > index ? failure.index - 1 : failure.index,
      })),
  };
}

export function moveCandidate(
  urls: string[],
  failures: SourceFailure[],
  index: number,
  offset: -1 | 1,
) {
  const target = index + offset;
  if (index < 0 || target < 0 || target >= urls.length) {
    return { urls, failures };
  }
  const reordered = [...urls];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return {
    urls: reordered,
    failures: failures.map((failure) => ({
      ...failure,
      index:
        failure.index === index
          ? target
          : failure.index === target
            ? index
            : failure.index,
    })),
  };
}

export function createCriteriaFromTemplate(criteria: ComparisonCriterion[]) {
  return cloneCriteria(criteria);
}
