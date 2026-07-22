import type { ComparisonResult, Evidence, EvidenceLevel } from "./types.ts";
import { activeEvidence } from "./evidence.ts";

export type ConflictSeverity = "high" | "medium";

export interface EvidenceConflict {
  id: string;
  product: string;
  topic: string;
  severity: ConflictSeverity;
  first: Evidence;
  second: Evidence;
}

interface TopicPattern {
  topic: string;
  positive: RegExp;
  negative: RegExp;
}

const topics: TopicPattern[] = [
  {
    topic: "openSource",
    positive: /\bopen[ -]?source\b|\bsource (?:code )?(?:is )?public\b|源码公开|开源/i,
    negative: /\bclosed[ -]?source\b|\bproprietary\b|\bno public source\b|\bnot open[ -]?source\b|未(?:发现|提供|公开).*源码|源码.*不公开|闭源/i,
  },
  {
    topic: "pricing",
    positive: /\bfree(?: plan| tier| to use)?\b|免费(?:使用|版本|套餐)?/i,
    negative: /\bnot free\b|\bpaid only\b|\brequires? (?:a )?subscription\b|仅限付费|需要订阅|收费|不免费/i,
  },
  {
    topic: "account",
    positive: /\brequires? (?:an? )?account\b|\bsign[ -]?in required\b|需要(?:注册|账号|登录)|必须登录/i,
    negative: /\bno account (?:is )?required\b|\bwithout (?:an? )?account\b|无需(?:注册|账号|登录)|不要求账号/i,
  },
  {
    topic: "telemetry",
    positive: /\btelemetry (?:is )?(?:enabled|collected)\b|\bcollects? (?:usage|analytics|telemetry)\b|收集(?:遥测|使用数据|分析数据)|启用遥测/i,
    negative: /\bno telemetry\b|\bdoes not collect (?:usage|analytics|telemetry)\b|不收集(?:遥测|使用数据|分析数据)|无遥测/i,
  },
  {
    topic: "offline",
    positive: /\bworks? offline\b|\boffline (?:mode|support)\b|支持离线|可离线使用/i,
    negative: /\brequires? (?:an? )?(?:internet|network) connection\b|\bno offline (?:mode|support)\b|必须联网|不支持离线/i,
  },
  {
    topic: "selfHosting",
    positive: /\bself[ -]?host(?:ed|ing)?\b|支持自托管|可自托管/i,
    negative: /\bnot self[ -]?hostable\b|\bno self[ -]?hosting\b|不支持自托管|无法自托管/i,
  },
];

const negativeWords = /\b(?:no|not|never|without|cannot|doesn'?t|isn'?t|unavailable)\b|不|无|未|不能|无法|没有/i;
const tokenStopWords = new Set([
  "the", "a", "an", "is", "are", "was", "were", "it", "this", "that",
  "product", "currently", "website", "site", "page", "and", "or", "to",
  "of", "for", "with", "from", "does", "not", "no", "没有", "当前", "官网",
  "产品", "提供", "支持",
]);

function polarityForTopic(claim: string, topic: TopicPattern) {
  if (topic.negative.test(claim)) return -1;
  if (topic.positive.test(claim)) return 1;
  return 0;
}

function words(claim: string) {
  return new Set(
    claim
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !tokenStopWords.has(word)),
  );
}

function sharedSubject(first: string, second: string) {
  const a = words(first);
  const b = words(second);
  if (!a.size || !b.size) return false;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap >= 2 && overlap / Math.min(a.size, b.size) >= 0.5;
}

function conflictTopic(first: string, second: string) {
  for (const topic of topics) {
    const a = polarityForTopic(first, topic);
    const b = polarityForTopic(second, topic);
    if (a !== 0 && b !== 0 && a !== b) return topic.topic;
  }
  if (negativeWords.test(first) !== negativeWords.test(second) && sharedSubject(first, second)) {
    return "other";
  }
  return undefined;
}

function evidenceRank(level: EvidenceLevel) {
  return level === "verified" ? 3 : level === "vendor" ? 2 : 1;
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function detectEvidenceConflicts(
  result: Pick<ComparisonResult, "products">,
): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];
  for (const product of result.products) {
    const evidence = activeEvidence(product.evidence);
    for (let firstIndex = 0; firstIndex < evidence.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < evidence.length; secondIndex += 1) {
        const first = evidence[firstIndex];
        const second = evidence[secondIndex];
        const topic = conflictTopic(first.claim, second.claim);
        if (!topic) continue;
        const identity = `${product.name}\u0000${topic}\u0000${first.claim}\u0000${second.claim}`;
        conflicts.push({
          id: hash(identity),
          product: product.name,
          topic,
          severity:
            Math.max(evidenceRank(first.level), evidenceRank(second.level)) >= 3
              ? "high"
              : "medium",
          first,
          second,
        });
      }
    }
  }
  return conflicts;
}
