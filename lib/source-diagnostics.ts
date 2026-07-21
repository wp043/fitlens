import type { CollectedSource } from "./source.ts";
import { SourceError, type SourceErrorCode } from "./source.ts";

export const sourceCollectionErrorCode = "source_collection_failed" as const;

export interface SourceFailureDiagnostic {
  index: number;
  url: string;
  code: SourceErrorCode;
}

export interface SourceFailureResponse {
  error: string;
  code: typeof sourceCollectionErrorCode;
  sourceFailures: Array<SourceFailureDiagnostic & { message: string }>;
}

export type CandidateSourceCollection =
  | { ok: true; sources: CollectedSource[] }
  | { ok: false; failures: SourceFailureDiagnostic[] };

type SourceCollector = (url: string) => Promise<CollectedSource>;

/** Collect every candidate so the caller can identify all rows that need attention. */
export async function collectCandidateSources(
  urls: string[],
  collect: SourceCollector,
): Promise<CandidateSourceCollection> {
  const outcomes = await Promise.allSettled(urls.map((url) => collect(url)));
  const failures = outcomes.flatMap((outcome, index) => {
    if (outcome.status === "fulfilled") return [];
    return [{
      index,
      url: urls[index],
      code:
        outcome.reason instanceof SourceError
          ? outcome.reason.code
          : ("fetchFailed" as const),
    }];
  });

  if (failures.length > 0) return { ok: false, failures };
  return {
    ok: true,
    sources: outcomes.map((outcome) =>
      (outcome as PromiseFulfilledResult<CollectedSource>).value),
  };
}

export function sourceFailureHttpStatus(failures: SourceFailureDiagnostic[]) {
  return failures.some(({ code }) =>
    code === "fetchFailed" || code === "githubFailed")
    ? 502
    : 422;
}

export function createSourceFailureResponse(
  failures: SourceFailureDiagnostic[],
  summary: string,
  messageFor: (code: SourceErrorCode) => string,
): SourceFailureResponse {
  return {
    error: summary,
    code: sourceCollectionErrorCode,
    sourceFailures: failures.map((failure) => ({
      ...failure,
      message: messageFor(failure.code),
    })),
  };
}
