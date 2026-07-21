import { NextResponse } from "next/server";
import { z } from "zod";
import { parseAnalyzeRequest } from "@/lib/analyze-request";
import { analyzeWithModel } from "@/lib/analyzer";
import {
  ModelProviderConfigError,
  ModelProviderRequestError,
  modelProviderCanRun,
  resolveModelProviderConfig,
} from "@/lib/model-provider";
import {
  messages,
  normalizeLocale,
  type Locale,
} from "@/lib/i18n";
import { sampleComparisonForLocale } from "@/lib/sample";
import { collectProductSource, SourceError } from "@/lib/source";
import type { AnalyzeRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function isBundledSampleRequest(body: AnalyzeRequest) {
  const urls = body.urls;
  const hosts = urls
    .map((url) => new URL(url).hostname.replace(/^www\./, ""))
    .sort();
  const sampleKeys = new Set([
    "openness",
    "agentWorkflow",
    "performance",
    "polish",
    "automation",
  ]);
  return (
    urls.length === 2 &&
    hosts.includes("cmux.com") &&
    hosts.includes("otty.sh") &&
    body.criteria.length === sampleKeys.size &&
    body.criteria.every((criterion) => sampleKeys.has(criterion.key))
  );
}

export async function POST(request: Request) {
  let locale: Locale = "zh-CN";
  try {
    const input = (await request.json()) as Record<string, unknown>;
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
    const provider = resolveModelProviderConfig(process.env, sessionApiKey);
    const body = parseAnalyzeRequest(input) as AnalyzeRequest;

    if (!modelProviderCanRun(provider) && isBundledSampleRequest(body)) {
      const sample = sampleComparisonForLocale(locale);
      const sampleDimensions = new Map(
        sample.dimensions.map((dimension) => [dimension.key, dimension]),
      );
      return NextResponse.json({
        ...sample,
        generatedAt: new Date().toISOString(),
        dimensions: body.criteria.map((criterion) => ({
          ...sampleDimensions.get(criterion.key)!,
          key: criterion.key,
          label: criterion.label,
          weight: criterion.weight,
        })),
      });
    }

    if (!modelProviderCanRun(provider)) {
      return NextResponse.json(
        { error: t.missingKey },
        { status: 503 },
      );
    }

    const sources = (await Promise.all(
      body.urls.map((url) => collectProductSource(url)),
    )) as Awaited<ReturnType<typeof collectProductSource>>[];

    const result = await analyzeWithModel(body, sources, provider);
    return NextResponse.json(result);
  } catch (error) {
    const t = messages[locale];
    const message =
      error instanceof z.ZodError
        ? t.invalidInput
        : error instanceof SourceError
          ? `${t[error.code]}${error.detail ? `: ${error.detail}` : ""}`
        : error instanceof ModelProviderConfigError ||
            error instanceof ModelProviderRequestError
          ? t[error.code]
        : error instanceof Error
          ? error.message
          : t.genericFailure;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
