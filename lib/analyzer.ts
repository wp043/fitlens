import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { messages } from "@/lib/i18n";
import type { AnalyzeRequest, ComparisonResult } from "@/lib/types";
import type { CollectedSource } from "@/lib/source";

const evidenceSchema = z
  .object({
    claim: z.string(),
    level: z.enum(["verified", "vendor", "inferred"]),
    sourceLabel: z.string(),
    sourceUrl: z.string(),
  })
  .strict();

const productSchema = z
  .object({
    name: z.string(),
    tagline: z.string(),
    url: z.string(),
    repoUrl: z.string().nullable(),
    score: z.number().int().min(0).max(100),
    confidence: z.number().int().min(0).max(100),
    sourceMode: z.enum(["open-source", "website-only"]),
    verdict: z.string(),
    strengths: z.array(z.string()).min(2).max(5),
    tradeoffs: z.array(z.string()).min(2).max(5),
    evidence: z.array(evidenceSchema).min(2).max(6),
  })
  .strict();

const dimensionSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    weight: z.number().int().min(0).max(100),
    productScores: z.record(z.number().int().min(0).max(100)),
    winner: z.string(),
    explanation: z.string(),
  })
  .strict();

const comparisonSchema = z
  .object({
    title: z.string(),
    recommendation: z
      .object({
        winner: z.string(),
        summary: z.string(),
        reasons: z.array(z.string()).min(2).max(4),
        switchWhen: z.string(),
      })
      .strict(),
    products: z.array(productSchema).length(2),
    dimensions: z.array(dimensionSchema).min(2).max(8),
    unknowns: z.array(z.string()).min(2).max(5),
    trialPlan: z
      .array(
        z
          .object({
            task: z.string(),
            reason: z.string(),
          })
          .strict(),
      )
      .length(3),
  })
  .strict();

function sourceForPrompt(source: CollectedSource) {
  return {
    inputUrl: source.inputUrl,
    homepageUrl: source.homepageUrl,
    detectedName: source.name,
    description: source.description,
    sourceMode: source.sourceMode,
    homepageText: source.pageText,
    repository: source.repo,
  };
}

export async function analyzeWithModel(
  request: AnalyzeRequest,
  sources: [CollectedSource, CollectedSource],
  apiKey?: string,
): Promise<ComparisonResult> {
  const client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
  const allowedUrls = new Set(
    sources.flatMap((source) =>
      [source.inputUrl, source.homepageUrl, source.repo?.url].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );

  const response = await client.responses.parse({
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    reasoning: { effort: "low" },
    instructions: [
      request.locale === "zh-CN"
        ? "你是严谨的产品研究员。所有面向用户的内容都用简体中文输出。"
        : "You are a rigorous product researcher. Write all user-facing content in English.",
      "目标是判断哪个产品更适合用户的具体场景，不是比较谁的功能更多。",
      "只能依据 SOURCES 中给出的内容。不要把未出现的信息当成事实。",
      "verified 只用于可由公开源码、repository metadata 或 README 直接核验的事实。",
      "vendor 用于产品官网或厂商文档中的声明。",
      "inferred 用于明确标记的推断；“没有找到”不能写成“确定不存在”。",
      "website-only 产品的置信度应低于同时有源码和官网证据的产品。",
      request.locale === "zh-CN"
        ? "每个 CRITERIA 项必须在 dimensions 中恰好出现一次，保留相同的 key、label 和 weight；不要增加或遗漏维度。"
        : "Return exactly one dimension for every CRITERIA item, preserving its key, label, and weight. Do not add or omit dimensions.",
      "分数表示对该用户的适配度，不表示普遍产品质量。",
      "trialPlan 必须是可在 30 分钟内比较两款产品的具体任务。",
    ].join("\n"),
    input: JSON.stringify({
      USER_CONTEXT: request.context,
      CRITERIA: request.criteria,
      SOURCES: sources.map(sourceForPrompt),
    }),
    text: {
      format: zodTextFormat(comparisonSchema, "fitlens_comparison"),
    },
  });

  if (!response.output_parsed) {
    throw new Error(messages[request.locale].modelFailed);
  }

  const parsed = response.output_parsed;
  const returnedDimensions = new Map(
    parsed.dimensions.map((dimension) => [dimension.key, dimension]),
  );
  if (
    returnedDimensions.size !== request.criteria.length ||
    request.criteria.some(
      (criterion) => !returnedDimensions.has(criterion.key),
    )
  ) {
    throw new Error(messages[request.locale].modelFailed);
  }
  const dimensions = request.criteria.map((criterion) => ({
    ...returnedDimensions.get(criterion.key)!,
    key: criterion.key,
    label: criterion.label,
    weight: criterion.weight,
  }));
  const products = parsed.products.map((product, index) => {
    const source = sources[index];
    const safeEvidence = product.evidence.map((evidence) => ({
      ...evidence,
      sourceUrl: allowedUrls.has(evidence.sourceUrl)
        ? evidence.sourceUrl
        : source.repo?.url || source.homepageUrl,
    }));
    return {
      ...product,
      url: source.homepageUrl,
      repoUrl: source.repo?.url,
      sourceMode: source.sourceMode,
      evidence: safeEvidence.map((evidence) => ({
        ...evidence,
        origin: "collected" as const,
        capturedAt: new Date().toISOString(),
      })),
    };
  });

  return {
    ...parsed,
    generatedAt: new Date().toISOString(),
    products,
    dimensions,
  };
}
