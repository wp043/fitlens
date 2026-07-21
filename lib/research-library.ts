import type { EvidenceLevel } from "./types.ts";
import type { SavedReport } from "./report.ts";

export type LibrarySourceFilter = "all" | "open-source" | "website-only";
export type LibraryReviewFilter = "all" | "ready" | "needs-review";

export interface ResearchLibraryFilters {
  query: string;
  product: string;
  sourceMode: LibrarySourceFilter;
  evidenceLevel: EvidenceLevel | "all";
  review: LibraryReviewFilter;
}

export interface ResearchLibraryEntry {
  report: SavedReport;
  products: string[];
  evidenceCount: number;
  verifiedCount: number;
  sourceCount: number;
  needsReview: boolean;
}

function searchableText(report: SavedReport) {
  return [
    report.title,
    report.context,
    report.notes,
    report.result.recommendation.winner,
    report.result.recommendation.summary,
    report.result.recommendation.switchWhen,
    ...report.result.recommendation.reasons,
    ...report.result.unknowns,
    ...report.result.products.flatMap((product) => [
      product.name,
      product.tagline,
      product.verdict,
      product.url,
      product.repoUrl ?? "",
      ...product.strengths,
      ...product.tradeoffs,
      ...product.evidence.flatMap((evidence) => [
        evidence.claim,
        evidence.sourceLabel,
        evidence.sourceUrl,
      ]),
    ]),
  ]
    .join("\n")
    .toLocaleLowerCase();
}

export function buildResearchLibrary(reports: SavedReport[]) {
  return [...reports]
    .sort(
      (first, second) =>
        new Date(second.savedAt).getTime() - new Date(first.savedAt).getTime(),
    )
    .map<ResearchLibraryEntry>((report) => {
      const evidence = report.result.products.flatMap(
        (product) => product.evidence,
      );
      return {
        report,
        products: report.result.products.map((product) => product.name),
        evidenceCount: evidence.length,
        verifiedCount: evidence.filter((item) => item.level === "verified")
          .length,
        sourceCount: new Set(evidence.map((item) => item.sourceUrl)).size,
        needsReview:
          report.conflicts.length > 0 || report.result.unknowns.length > 0,
      };
    });
}

export function listLibraryProducts(reports: SavedReport[]) {
  return Array.from(
    new Set(
      reports.flatMap((report) =>
        report.result.products.map((product) => product.name),
      ),
    ),
  ).sort((first, second) => first.localeCompare(second));
}

export function filterResearchLibrary(
  entries: ResearchLibraryEntry[],
  filters: ResearchLibraryFilters,
) {
  const queryTokens = filters.query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return entries.filter((entry) => {
    const { report } = entry;
    if (
      filters.product &&
      !entry.products.some((product) => product === filters.product)
    ) {
      return false;
    }
    if (
      filters.sourceMode !== "all" &&
      !report.result.products.some(
        (product) => product.sourceMode === filters.sourceMode,
      )
    ) {
      return false;
    }
    if (
      filters.evidenceLevel !== "all" &&
      !report.result.products.some((product) =>
        product.evidence.some(
          (evidence) => evidence.level === filters.evidenceLevel,
        ),
      )
    ) {
      return false;
    }
    if (
      (filters.review === "ready" && entry.needsReview) ||
      (filters.review === "needs-review" && !entry.needsReview)
    ) {
      return false;
    }

    const text = searchableText(report);
    return queryTokens.every((token) => text.includes(token));
  });
}
