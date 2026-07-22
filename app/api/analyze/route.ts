import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ModelProviderConfigError,
  ModelProviderRequestError,
} from "@/lib/model-provider";
import {
  messages,
  normalizeLocale,
  type Locale,
} from "@/lib/i18n";
import { SourceError } from "@/lib/source";
import {
  createSourceFailureResponse,
  sourceFailureHttpStatus,
} from "@/lib/source-diagnostics";
import {
  CandidateSourceCollectionError,
  MissingModelCredentialsError,
  runAnalysis,
} from "@/lib/analysis-service";
import {
  acquireAnalysisSlot,
  isTrustedOrigin,
  MAX_ANALYZE_BODY_BYTES,
  readBoundedJson,
  RequestGuardError,
} from "@/lib/request-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let locale: Locale = "zh-CN";
  let releaseAnalysisSlot: (() => void) | undefined;
  try {
    if (!isTrustedOrigin(request)) {
      return NextResponse.json(
        { error: messages[locale].crossOriginRejected },
        { status: 403 },
      );
    }
    const input = (await readBoundedJson(
      request,
      MAX_ANALYZE_BODY_BYTES,
    )) as Record<string, unknown>;
    locale = normalizeLocale(
      typeof input.locale === "string" ? input.locale : "zh-CN",
    );
    const t = messages[locale];
    const sessionApiKey = request.headers
      .get("x-fitlens-openai-key")
      ?.trim();
    if (
      sessionApiKey &&
      (sessionApiKey.length < 20 || sessionApiKey.length > 512)
    ) {
      return NextResponse.json(
        { error: t.invalidKey },
        { status: 400 },
      );
    }
    releaseAnalysisSlot = acquireAnalysisSlot() ?? undefined;
    if (!releaseAnalysisSlot) {
      return NextResponse.json(
        { error: t.analysisBusy },
        { status: 429, headers: { "retry-after": "5" } },
      );
    }
    const result = await runAnalysis(input, {
      env: process.env,
      sessionApiKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    const t = messages[locale];
    if (error instanceof MissingModelCredentialsError) {
      return NextResponse.json({ error: t.missingKey }, { status: 503 });
    }
    if (error instanceof CandidateSourceCollectionError) {
      return NextResponse.json(
        createSourceFailureResponse(
          error.failures,
          t.sourceCollectionFailed,
          (code) => t[code],
        ),
        { status: sourceFailureHttpStatus(error.failures) },
      );
    }
    if (error instanceof RequestGuardError) {
      return NextResponse.json(
        { error: t[error.code] },
        { status: error.status },
      );
    }
    const message =
      error instanceof z.ZodError
        ? t.invalidInput
        : error instanceof SourceError
          ? t[error.code]
        : error instanceof ModelProviderConfigError ||
            error instanceof ModelProviderRequestError
          ? t[error.code]
        : error instanceof Error
          ? error.message
          : t.genericFailure;
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    releaseAnalysisSlot?.();
  }
}
