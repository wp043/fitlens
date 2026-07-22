import type { Locale } from "./i18n.ts";
import type {
  ComparisonCriterion,
  DimensionResult,
  PriorityWeights,
} from "./types.ts";

export interface CriteriaTemplate {
  id: string;
  name: string;
  criteria: ComparisonCriterion[];
  builtIn?: boolean;
}

interface LocalizedCriterion {
  key: string;
  weight: number;
  label: Record<Locale, string>;
  hint: Record<Locale, string>;
}

interface LocalizedTemplate {
  id: string;
  name: Record<Locale, string>;
  criteria: LocalizedCriterion[];
}

const localizedTemplates: LocalizedTemplate[] = [
  {
    id: "general",
    name: { "zh-CN": "通用产品", en: "General product" },
    criteria: [
      {
        key: "value",
        weight: 60,
        label: { "zh-CN": "价值与成本", en: "Value and cost" },
        hint: {
          "zh-CN": "价格、时间成本、长期价值",
          en: "Price, time cost, and long-term value",
        },
      },
      {
        key: "usability",
        weight: 60,
        label: { "zh-CN": "易用性", en: "Usability" },
        hint: {
          "zh-CN": "学习成本、日常操作、无障碍",
          en: "Learning curve, daily interaction, accessibility",
        },
      },
      {
        key: "reliability",
        weight: 60,
        label: { "zh-CN": "可靠性", en: "Reliability" },
        hint: {
          "zh-CN": "稳定性、成熟度、维护状态",
          en: "Stability, maturity, and maintenance",
        },
      },
      {
        key: "privacyControl",
        weight: 60,
        label: { "zh-CN": "隐私与控制", en: "Privacy and control" },
        hint: {
          "zh-CN": "数据边界、可控性、退出成本",
          en: "Data boundaries, control, and exit cost",
        },
      },
      {
        key: "ecosystem",
        weight: 60,
        label: { "zh-CN": "生态与支持", en: "Ecosystem and support" },
        hint: {
          "zh-CN": "兼容性、集成、社区与支持",
          en: "Compatibility, integrations, community, and support",
        },
      },
    ],
  },
  {
    id: "developer-tools",
    name: { "zh-CN": "开发工具", en: "Developer tools" },
    criteria: [
      {
        key: "openness",
        weight: 75,
        label: { "zh-CN": "开放与可控", en: "Openness and control" },
        hint: {
          "zh-CN": "源码、license、数据边界",
          en: "Source, license, and data boundaries",
        },
      },
      {
        key: "agentWorkflow",
        weight: 75,
        label: { "zh-CN": "工作流适配", en: "Workflow fit" },
        hint: {
          "zh-CN": "上下文、协作、日常流程",
          en: "Context, collaboration, and daily flow",
        },
      },
      {
        key: "performance",
        weight: 65,
        label: { "zh-CN": "性能与稳定性", en: "Performance and stability" },
        hint: {
          "zh-CN": "延迟、资源占用、可靠性",
          en: "Latency, resource use, and reliability",
        },
      },
      {
        key: "polish",
        weight: 55,
        label: { "zh-CN": "开箱完成度", en: "Out-of-box polish" },
        hint: {
          "zh-CN": "交互、学习成本、细节",
          en: "Interaction, learning curve, and details",
        },
      },
      {
        key: "automation",
        weight: 70,
        label: { "zh-CN": "自动化能力", en: "Automation" },
        hint: {
          "zh-CN": "CLI、API、hooks、扩展",
          en: "CLI, API, hooks, and extensions",
        },
      },
    ],
  },
  {
    id: "privacy-first",
    name: { "zh-CN": "隐私优先", en: "Privacy-first" },
    criteria: [
      {
        key: "dataPrivacy",
        weight: 95,
        label: { "zh-CN": "数据隐私", en: "Data privacy" },
        hint: {
          "zh-CN": "收集范围、保留、第三方共享",
          en: "Collection, retention, and third-party sharing",
        },
      },
      {
        key: "localControl",
        weight: 90,
        label: { "zh-CN": "本地控制", en: "Local control" },
        hint: {
          "zh-CN": "离线能力、本地存储、自托管",
          en: "Offline use, local storage, and self-hosting",
        },
      },
      {
        key: "openness",
        weight: 80,
        label: { "zh-CN": "透明度", en: "Transparency" },
        hint: {
          "zh-CN": "源码、政策清晰度、可审计性",
          en: "Source, policy clarity, and auditability",
        },
      },
      {
        key: "security",
        weight: 85,
        label: { "zh-CN": "安全性", en: "Security" },
        hint: {
          "zh-CN": "权限、加密、更新与响应",
          en: "Permissions, encryption, updates, and response",
        },
      },
      {
        key: "portability",
        weight: 75,
        label: { "zh-CN": "可迁移性", en: "Portability" },
        hint: {
          "zh-CN": "导出、开放格式、退出成本",
          en: "Exports, open formats, and switching cost",
        },
      },
    ],
  },
  {
    id: "daily-use",
    name: { "zh-CN": "日常软件", en: "Everyday software" },
    criteria: [
      {
        key: "ease",
        weight: 85,
        label: { "zh-CN": "简单易用", en: "Ease of use" },
        hint: {
          "zh-CN": "上手、操作频率、认知负担",
          en: "Onboarding, frequent actions, and cognitive load",
        },
      },
      {
        key: "quality",
        weight: 80,
        label: { "zh-CN": "核心体验", en: "Core experience" },
        hint: {
          "zh-CN": "主要功能的质量与一致性",
          en: "Quality and consistency of the main workflow",
        },
      },
      {
        key: "compatibility",
        weight: 65,
        label: { "zh-CN": "兼容性", en: "Compatibility" },
        hint: {
          "zh-CN": "设备、平台、格式与集成",
          en: "Devices, platforms, formats, and integrations",
        },
      },
      {
        key: "support",
        weight: 55,
        label: { "zh-CN": "支持与持续性", en: "Support and continuity" },
        hint: {
          "zh-CN": "维护、客服、社区、长期可用性",
          en: "Maintenance, service, community, and longevity",
        },
      },
      {
        key: "value",
        weight: 70,
        label: { "zh-CN": "价格价值", en: "Price value" },
        hint: {
          "zh-CN": "价格、订阅、替换成本",
          en: "Price, subscription, and replacement cost",
        },
      },
    ],
  },
];

export function getBuiltInCriteriaTemplates(
  locale: Locale,
): CriteriaTemplate[] {
  return localizedTemplates.map((template) => ({
    id: template.id,
    name: template.name[locale],
    builtIn: true,
    criteria: template.criteria.map((criterion) => ({
      key: criterion.key,
      label: criterion.label[locale],
      hint: criterion.hint[locale],
      weight: criterion.weight,
    })),
  }));
}

export function cloneCriteria(criteria: ComparisonCriterion[]) {
  return criteria.map((criterion) => ({ ...criterion }));
}

export function criteriaToWeights(
  criteria: ComparisonCriterion[],
): PriorityWeights {
  return Object.fromEntries(
    criteria.map((criterion) => [criterion.key, criterion.weight]),
  );
}

export function inferCriteria(
  dimensions: DimensionResult[],
  priorities: PriorityWeights,
): ComparisonCriterion[] {
  return dimensions.map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    hint: dimension.explanation,
    weight: priorities[dimension.key] ?? dimension.weight ?? 60,
  }));
}
