import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeWithModel } from "@/lib/analyzer";
import { sampleComparison } from "@/lib/sample";
import { collectProductSource } from "@/lib/source";
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
  })
  .strict();

function isSamplePair(urls: [string, string]) {
  const hosts = urls
    .map((url) => new URL(url).hostname.replace(/^www\./, ""))
    .sort();
  return hosts.includes("cmux.com") && hosts.includes("otty.sh");
}

export async function POST(request: Request) {
  try {
    const sessionApiKey = request.headers
      .get("x-fitlens-openai-key")
      ?.trim();
    if (
      sessionApiKey &&
      (sessionApiKey.length < 20 || sessionApiKey.length > 512)
    ) {
      return NextResponse.json(
        { error: "OpenAI API key 格式不正确。" },
        { status: 400 },
      );
    }
    const apiKey = sessionApiKey || process.env.OPENAI_API_KEY;
    const body = requestSchema.parse(
      await request.json(),
    ) as AnalyzeRequest;

    if (!apiKey && isSamplePair(body.urls)) {
      return NextResponse.json({
        ...sampleComparison,
        generatedAt: new Date().toISOString(),
      });
    }

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "请在 Local API setup 中临时输入自己的 OpenAI API key，或在 .env.local 配置 OPENAI_API_KEY。",
        },
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
    const message =
      error instanceof z.ZodError
        ? "输入格式不正确，请检查 URL、场景描述和权重。"
        : error instanceof Error
          ? error.message
          : "分析失败，请稍后再试。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
