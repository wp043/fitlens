import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
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
    key: z.enum([
      "openness",
      "agentWorkflow",
      "performance",
      "polish",
      "automation",
    ]),
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
    dimensions: z.array(dimensionSchema).length(5),
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
      "你是严谨的产品研究员。用中文输出。",
      "目标是判断哪个产品更适合用户的具体场景，不是比较谁的功能更多。",
      "只能依据 SOURCES 中给出的内容。不要把未出现的信息当成事实。",
      "verified 只用于可由公开源码、repository metadata 或 README 直接核验的事实。",
      "vendor 用于产品官网或厂商文档中的声明。",
      "inferred 用于明确标记的推断；“没有找到”不能写成“确定不存在”。",
      "website-only 产品的置信度应低于同时有源码和官网证据的产品。",
      "五个 dimension 必须各出现一次，并使用用户提供的权重。",
      "分数表示对该用户的适配度，不表示普遍产品质量。",
      "trialPlan 必须是可在 30 分钟内比较两款产品的具体任务。",
    ].join("\n"),
    input: JSON.stringify({
      USER_CONTEXT: request.context,
      PRIORITIES: request.priorities,
      SOURCES: sources.map(sourceForPrompt),
    }),
    text: {
      format: zodTextFormat(comparisonSchema, "fitlens_comparison"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("模型未返回可用的结构化结果。");
  }

  const parsed = response.output_parsed;
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
      evidence: safeEvidence,
    };
  });

  return {
    ...parsed,
    generatedAt: new Date().toISOString(),
    products,
  };
}
