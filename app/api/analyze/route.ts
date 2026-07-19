import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeWithModel } from "@/lib/analyzer";
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

const requestSchema = z
  .object({
    urls: z.tuple([z.string().url(), z.string().url()]),
    context: z.string().trim().min(10).max(2_000),
    criteria: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(80),
            label: z.string().trim().min(1).max(80),
            hint: z.string().trim().max(200),
            weight: z.number().min(0).max(100),
          })
          .strict(),
      )
      .min(2)
      .max(8)
      .refine(
        (criteria) =>
          new Set(criteria.map((criterion) => criterion.key)).size ===
          criteria.length,
        "Criterion keys must be unique",
      ),
    locale: z.enum(["zh-CN", "en"]).default("zh-CN"),
  })
  .strict();

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
    const apiKey = sessionApiKey || process.env.OPENAI_API_KEY;
    const body = requestSchema.parse(input) as AnalyzeRequest;

    if (!apiKey && isBundledSampleRequest(body)) {
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

    if (!apiKey) {
      return NextResponse.json(
        { error: t.missingKey },
        { status: 503 },
      );
    }

    const sources = (await Promise.all(
      body.urls.map((url) => collectProductSource(url)),
    )) as Awaited<ReturnType<typeof collectProductSource>>[];

    const result = await analyzeWithModel(
      body,
      [sources[0], sources[1]],
      apiKey,
    );
    return NextResponse.json(result);
  } catch (error) {
    const t = messages[locale];
    const message =
      error instanceof z.ZodError
        ? t.invalidInput
        : error instanceof SourceError
          ? `${t[error.code]}${error.detail ? `: ${error.detail}` : ""}`
        : error instanceof Error
          ? error.message
          : t.genericFailure;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
