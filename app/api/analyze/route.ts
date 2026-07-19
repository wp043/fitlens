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
    priorities: z
      .object({
        openness: z.number().min(0).max(100),
        agentWorkflow: z.number().min(0).max(100),
        performance: z.number().min(0).max(100),
        polish: z.number().min(0).max(100),
        automation: z.number().min(0).max(100),
      })
      .strict(),
    locale: z.enum(["zh-CN", "en"]).default("zh-CN"),
  })
  .strict();

function isSamplePair(urls: [string, string]) {
  const hosts = urls
    .map((url) => new URL(url).hostname.replace(/^www\./, ""))
    .sort();
  return hosts.includes("cmux.com") && hosts.includes("otty.sh");
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

    if (!apiKey && isSamplePair(body.urls)) {
      return NextResponse.json({
        ...sampleComparisonForLocale(locale),
        generatedAt: new Date().toISOString(),
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
