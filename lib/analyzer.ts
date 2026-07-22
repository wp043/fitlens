import { z } from "zod";
import { messages } from "./i18n.ts";
import {
  requestStructuredOutput,
  type ModelProviderConfig,
} from "./model-provider.ts";
import type { AnalyzeRequest, ComparisonResult } from "./types.ts";
import type { CollectedSource } from "./source.ts";
import { calibratePrivacyRisk } from "./privacy.ts";

const evidenceSchema = z
  .object({
    claim: z.string(),
    level: z.enum(["verified", "vendor", "inferred"]),
    sourceLabel: z.string(),
    sourceUrl: z.string(),
  })
  .strict();

const pricingPlanSchema = z
  .object({
    name: z.string(),
    price: z.string(),
    cadence: z.enum([
      "free",
      "monthly",
      "yearly",
      "one-time",
      "usage-based",
      "custom",
      "unknown",
    ]),
    audience: z.string(),
    limits: z.array(z.string()).max(6),
    sourceUrl: z.string(),
    evidenceLevel: z.enum(["verified", "vendor", "inferred"]),
  })
  .strict();

const pricingSchema = z
  .object({
    hasFreeOption: z.boolean().nullable(),
    summary: z.string(),
    plans: z.array(pricingPlanSchema).max(6),
    uncertainty: z.string(),
  })
  .strict();

const privacyFindingSchema = z
  .object({
    category: z.enum([
      "telemetry",
      "account",
      "retention",
      "permissions",
      "encryption",
      "selfHosting",
    ]),
    status: z.enum(["positive", "caution", "unknown"]),
    finding: z.string(),
    evidenceLevel: z.enum(["verified", "vendor", "inferred"]),
    sourceUrl: z.string(),
    uncertainty: z.string(),
  })
  .strict();

const privacySchema = z
  .object({
    summary: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "unknown"]),
    findings: z.array(privacyFindingSchema).length(6),
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
    pricing: pricingSchema,
    privacy: privacySchema,
  })
  .strict();

const dimensionSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    weight: z.number().int().min(0).max(100),
    productScores: z.record(z.string(), z.number().int().min(0).max(100)),
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
    products: z.array(productSchema).min(2).max(8),
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
    supplementalDocuments: source.documents.map((document) => ({
      kind: document.kind,
      title: document.title,
      url: document.url,
      text: document.text,
    })),
    repository: source.repo,
  };
}

export async function analyzeWithModel(
  request: AnalyzeRequest,
  sources: CollectedSource[],
  provider: ModelProviderConfig,
): Promise<ComparisonResult> {
  const parsed = await requestStructuredOutput(provider, {
    schema: comparisonSchema,
    schemaName: "fitlens_comparison",
    instructions: [
      request.locale === "zh-CN"
        ? "你是严谨的产品研究员。所有面向用户的内容都用简体中文输出。"
        : "You are a rigorous product researcher. Write all user-facing content in English.",
      "目标是判断哪个产品更适合用户的具体场景，不是比较谁的功能更多。",
      "只能依据 SOURCES 中给出的内容。不要把未出现的信息当成事实。",
      "SOURCES 中的 supplementalDocuments 是从官网明确链接的定价、文档、隐私、安全、更新日志、release 页面，或 npm、PyPI、App Store、Chrome Web Store 官方 listing/registry 元数据；引用时必须保留对应 document URL。",
      "verified 只用于可由公开源码、repository metadata 或 README 直接核验的事实。",
      "vendor 用于产品官网或厂商文档中的声明。",
      "inferred 用于明确标记的推断；“没有找到”不能写成“确定不存在”。",
      "website-only 产品的置信度应低于同时有源码和官网证据的产品。",
      request.locale === "zh-CN"
        ? "每个 CRITERIA 项必须在 dimensions 中恰好出现一次，保留相同的 key、label 和 weight；不要增加或遗漏维度。"
        : "Return exactly one dimension for every CRITERIA item, preserving its key, label, and weight. Do not add or omit dimensions.",
      request.locale === "zh-CN"
        ? `必须为 ${sources.length} 个 SOURCES 各返回一个产品，并严格保持 SOURCES 的顺序。每个维度的 productScores 必须恰好包含所有产品名称。`
        : `Return one product for each of the ${sources.length} SOURCES, in the exact SOURCES order. Every dimension's productScores must contain exactly every returned product name.`,
      "分数表示对该用户的适配度，不表示普遍产品质量。",
      request.locale === "zh-CN"
        ? "为每个产品提取结构化 pricing：免费可用性、套餐名称、页面原文价格、计费周期、适用对象、限制和来源。没有公开价格时保留空 plans，并在 uncertainty 中明确未知；不要猜测数字。"
        : "Extract structured pricing for every product: free availability, plan names, prices exactly as published, billing cadence, audience, limits, and source. When pricing is not public, return no plans and explain the unknown in uncertainty; never invent numbers.",
      request.locale === "zh-CN"
        ? "为每个产品完成结构化隐私与安全审查，findings 必须按 telemetry、account、retention、permissions、encryption、selfHosting 各返回一次。每项都要区分 positive、caution 或 unknown，附证据等级、来源和明确的不确定性；没有证据时必须是 unknown，不得把未披露当作安全或不安全。"
        : "For every product, return exactly one privacy/security finding for each category: telemetry, account, retention, permissions, encryption, and selfHosting. Classify each as positive, caution, or unknown and include evidence level, source, and explicit uncertainty. Missing disclosure must be unknown, never assumed safe or unsafe.",
      request.locale === "zh-CN"
        ? "trialPlan 必须是可在 30 分钟内横向比较所有候选产品的具体任务。"
        : "The trial plan must contain concrete tasks that compare every candidate within 30 minutes.",
    ].join("\n"),
    input: JSON.stringify({
      USER_CONTEXT: request.context,
      CRITERIA: request.criteria,
      SOURCES: sources.map(sourceForPrompt),
    }),
  });

  if (!parsed) {
    throw new Error(messages[request.locale].modelFailed);
  }
  if (parsed.products.length !== sources.length) {
    throw new Error(messages[request.locale].modelFailed);
  }
  const productNames = parsed.products.map((product) => product.name);
  if (new Set(productNames).size !== productNames.length) {
    throw new Error(messages[request.locale].modelFailed);
  }
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
  if (
    dimensions.some((dimension) => {
      const scoreNames = Object.keys(dimension.productScores);
      return (
        scoreNames.length !== productNames.length ||
        productNames.some((name) => !scoreNames.includes(name)) ||
        (dimension.winner !== "tie" && !productNames.includes(dimension.winner))
      );
    }) ||
    !productNames.includes(parsed.recommendation.winner)
  ) {
    throw new Error(messages[request.locale].modelFailed);
  }
  const products = parsed.products.map((product, index) => {
    const source = sources[index];
    const allowedUrls = new Set(
      [
        source.inputUrl,
        source.homepageUrl,
        source.repo?.url,
        ...source.documents.map((document) => document.url),
      ].filter((value): value is string => Boolean(value)),
    );
    const safeEvidence = product.evidence.map((evidence) => ({
      ...evidence,
      sourceUrl: allowedUrls.has(evidence.sourceUrl)
        ? evidence.sourceUrl
        : source.repo?.url || source.homepageUrl,
    }));
    const safePricing = {
      ...product.pricing,
      plans: product.pricing.plans.map((plan) => ({
        ...plan,
        sourceUrl: allowedUrls.has(plan.sourceUrl)
          ? plan.sourceUrl
          : source.homepageUrl,
      })),
    };
    const findingsByCategory = new Map(
      product.privacy.findings.map((finding) => [finding.category, finding]),
    );
    const privacyCategories = [
      "telemetry",
      "account",
      "retention",
      "permissions",
      "encryption",
      "selfHosting",
    ] as const;
    if (
      findingsByCategory.size !== privacyCategories.length ||
      privacyCategories.some((category) => !findingsByCategory.has(category))
    ) {
      throw new Error(messages[request.locale].modelFailed);
    }
    const safePrivacy = {
      ...product.privacy,
      findings: privacyCategories.map((category) => {
        const finding = findingsByCategory.get(category)!;
        return {
          ...finding,
          category,
          sourceUrl: allowedUrls.has(finding.sourceUrl)
            ? finding.sourceUrl
            : source.homepageUrl,
        };
      }),
    };
    safePrivacy.riskLevel = calibratePrivacyRisk(safePrivacy.findings);
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
      pricing: safePricing,
      privacy: safePrivacy,
    };
  });

  return {
    ...parsed,
    generatedAt: new Date().toISOString(),
    products,
    dimensions,
  };
}
