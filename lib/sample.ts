import type { ComparisonResult, PriorityWeights } from "@/lib/types";
import type { Locale } from "@/lib/i18n";

export const defaultPriorities: PriorityWeights = {
  openness: 60,
  agentWorkflow: 60,
  performance: 60,
  polish: 60,
  automation: 60,
};

export const examplePriorities: PriorityWeights = {
  openness: 88,
  agentWorkflow: 92,
  performance: 72,
  polish: 54,
  automation: 84,
};

export const sampleComparison: ComparisonResult = {
  title: "cmux vs Otty",
  generatedAt: "2026-07-19T00:00:00.000Z",
  recommendation: {
    winner: "cmux",
    summary:
      "如果你同时跑很多 Codex / Claude Code session，而且重视可审计、可脚本化和长期可控，cmux 目前更适合你。",
    reasons: [
      "源码与 GPL-3.0-or-later license 可直接核验，产品风险更透明。",
      "CLI、socket API、内置 browser 更适合把 agent workflow 组合成自己的系统。",
      "Otty 在 prompt queue、session history 和交互完成度上更积极，但这些目前主要来自厂商材料。",
    ],
    switchWhen:
      "如果你最在意开箱即用的 agent UI、prompt queue、fork/branch，而不需要审计或扩展底层行为，优先试 Otty。",
  },
  products: [
    {
      name: "cmux",
      tagline: "开放、可编程的 agent terminal primitive",
      url: "https://cmux.com/",
      repoUrl: "https://github.com/manaflow-ai/cmux",
      score: 86,
      confidence: 91,
      sourceMode: "open-source",
      verdict: "更适合需要控制力与自动化的 power user。",
      strengths: [
        "GPL 开源，可检查实现与演进速度",
        "CLI + socket API + 内置浏览器",
        "原生 Swift/AppKit，基于 libghostty",
        "agent 通知、workspace 与 session restore",
      ],
      tradeoffs: [
        "现阶段仅支持 macOS",
        "更像 composable primitive，需要自己形成 workflow",
        "移动端与部分 AI 能力仍属于早期访问",
      ],
      evidence: [
        {
          claim: "源码公开，使用 GPL-3.0-or-later license。",
          level: "verified",
          sourceLabel: "GitHub repository",
          sourceUrl: "https://github.com/manaflow-ai/cmux",
        },
        {
          claim: "提供 CLI、socket API、split panes 与内置浏览器。",
          level: "verified",
          sourceLabel: "README + product site",
          sourceUrl: "https://github.com/manaflow-ai/cmux",
        },
        {
          claim: "macOS 原生 Swift/AppKit 应用，终端渲染使用 libghostty。",
          level: "verified",
          sourceLabel: "README",
          sourceUrl: "https://github.com/manaflow-ai/cmux",
        },
      ],
    },
    {
      name: "Otty",
      tagline: "更完整、更产品化的 agent terminal",
      url: "https://otty.sh/",
      score: 74,
      confidence: 63,
      sourceMode: "website-only",
      verdict: "更适合追求开箱体验、不想自己拼 workflow 的用户。",
      strengths: [
        "prompt queue、fork/branch、session history",
        "command palette、autocomplete 与 recipes",
        "macOS 免费且无需账号",
        "强调原生 GPU 渲染和现代化交互",
      ],
      tradeoffs: [
        "未从官网发现公开源码入口",
        "底层实现、遥测和长期商业策略较难独立核验",
        "Windows / Linux 尚未正式提供",
      ],
      evidence: [
        {
          claim: "macOS 版免费使用且不要求账号。",
          level: "vendor",
          sourceLabel: "Otty product site",
          sourceUrl: "https://otty.sh/",
        },
        {
          claim: "提供 agent task monitoring、session history、fork/branch 和 prompt queue。",
          level: "vendor",
          sourceLabel: "Otty product site",
          sourceUrl: "https://otty.sh/",
        },
        {
          claim: "官网当前未展示公开源码或 license 入口。",
          level: "inferred",
          sourceLabel: "Homepage inspection",
          sourceUrl: "https://otty.sh/",
        },
      ],
    },
  ],
  dimensions: [
    {
      key: "openness",
      label: "开放与可控",
      weight: 88,
      productScores: { cmux: 98, Otty: 35 },
      winner: "cmux",
      explanation: "cmux 的源码与 license 可核验；Otty 只能确认官网未提供源码入口。",
    },
    {
      key: "agentWorkflow",
      label: "Agent 工作流",
      weight: 92,
      productScores: { cmux: 86, Otty: 91 },
      winner: "Otty",
      explanation: "Otty 的 prompt queue 与 fork/branch 更完整；cmux 的优势是通用和可组合。",
    },
    {
      key: "performance",
      label: "原生性能",
      weight: 72,
      productScores: { cmux: 90, Otty: 86 },
      winner: "cmux",
      explanation: "两者都宣称原生 GPU 渲染；cmux 的实现可通过源码进一步核验。",
    },
    {
      key: "polish",
      label: "开箱完成度",
      weight: 54,
      productScores: { cmux: 77, Otty: 91 },
      winner: "Otty",
      explanation: "从公开界面与功能范围看，Otty 更偏完整产品，cmux 更偏工具原语。",
    },
    {
      key: "automation",
      label: "自动化能力",
      weight: 84,
      productScores: { cmux: 96, Otty: 67 },
      winner: "cmux",
      explanation: "cmux 明确公开 CLI、socket API 与浏览器脚本接口。",
    },
  ],
  unknowns: [
    "Otty 是否收集遥测、未来的商业模式与高级功能边界。",
    "两者在你的真实 repo 中连续运行 8 小时的内存占用与稳定性。",
    "Otty 的自动化接口是否足以覆盖你现有的 agent hooks。",
  ],
  trialPlan: [
    {
      task: "同时启动 6 个 agent session，记录找到“等待输入”任务所需时间。",
      reason: "直接检验多任务注意力管理，而不是比较 feature 数量。",
    },
    {
      task: "重启应用并恢复 workspace，检查目录、scrollback 与 agent session。",
      reason: "验证两者对 session restore 的实际边界。",
    },
    {
      task: "把一个常用动作接入快捷键或脚本，并记录完成时间。",
      reason: "确认你真正需要的是成品 workflow 还是可编程 primitive。",
    },
  ],
};

export const sampleComparisonEn: ComparisonResult = {
  ...sampleComparison,
  recommendation: {
    winner: "cmux",
    summary:
      "If you run many Codex or Claude Code sessions and value auditability, scripting, and long-term control, cmux is currently the better fit.",
    reasons: [
      "Its source and GPL-3.0-or-later license are directly verifiable, making product risk more transparent.",
      "The CLI, socket API, and built-in browser are a stronger base for composing your own agent workflow.",
      "Otty pushes further on prompt queues, session history, and interaction polish, but the public evidence is mainly vendor-provided.",
    ],
    switchWhen:
      "Prefer Otty if a ready-made agent UI, prompt queues, and fork/branch matter more than auditing or extending the underlying behavior.",
  },
  products: [
    {
      ...sampleComparison.products[0],
      tagline: "An open, programmable agent-terminal primitive",
      verdict: "Better for power users who want control and automation.",
      strengths: [
        "GPL source makes implementation and progress inspectable",
        "CLI, socket API, and built-in browser",
        "Native Swift/AppKit application using libghostty",
        "Agent notifications, workspaces, and session restore",
      ],
      tradeoffs: [
        "Currently available only on macOS",
        "A composable primitive that asks you to shape the workflow",
        "Mobile access and some AI features remain early",
      ],
      evidence: [
        {
          ...sampleComparison.products[0].evidence[0],
          claim:
            "The source is public under the GPL-3.0-or-later license.",
          sourceLabel: "GitHub repository",
        },
        {
          ...sampleComparison.products[0].evidence[1],
          claim:
            "The project provides a CLI, socket API, split panes, and a built-in browser.",
          sourceLabel: "README and product site",
        },
        {
          ...sampleComparison.products[0].evidence[2],
          claim:
            "It is a native macOS Swift/AppKit application with terminal rendering based on libghostty.",
          sourceLabel: "README",
        },
      ],
    },
    {
      ...sampleComparison.products[1],
      tagline: "A more complete, productized agent terminal",
      verdict:
        "Better for people who want a polished workflow without assembling it themselves.",
      strengths: [
        "Prompt queue, fork/branch, and session history",
        "Command palette, autocomplete, and recipes",
        "Free on macOS without requiring an account",
        "Emphasis on native GPU rendering and modern interaction",
      ],
      tradeoffs: [
        "No public source link was found on the product site",
        "Implementation, telemetry, and long-term business choices are harder to verify",
        "Windows and Linux versions are not generally available",
      ],
      evidence: [
        {
          ...sampleComparison.products[1].evidence[0],
          claim: "The macOS version is free and does not require an account.",
          sourceLabel: "Otty product site",
        },
        {
          ...sampleComparison.products[1].evidence[1],
          claim:
            "The product site lists agent task monitoring, session history, fork/branch, and a prompt queue.",
          sourceLabel: "Otty product site",
        },
        {
          ...sampleComparison.products[1].evidence[2],
          claim:
            "The current homepage does not expose a public source repository or license.",
          sourceLabel: "Homepage inspection",
        },
      ],
    },
  ],
  dimensions: [
    {
      ...sampleComparison.dimensions[0],
      label: "Openness and control",
      explanation:
        "cmux has verifiable source and licensing; for Otty, we can only confirm that its homepage does not link to source.",
    },
    {
      ...sampleComparison.dimensions[1],
      label: "Agent workflow",
      explanation:
        "Otty offers a more complete prompt queue and fork/branch flow; cmux is more general and composable.",
    },
    {
      ...sampleComparison.dimensions[2],
      label: "Native performance",
      explanation:
        "Both claim native GPU rendering, while cmux allows the implementation to be inspected.",
    },
    {
      ...sampleComparison.dimensions[3],
      label: "Out-of-box polish",
      explanation:
        "Based on the public interface and feature scope, Otty behaves more like a finished product and cmux more like a tool primitive.",
    },
    {
      ...sampleComparison.dimensions[4],
      label: "Automation",
      explanation:
        "cmux publicly documents a CLI, socket API, and browser scripting interface.",
    },
  ],
  unknowns: [
    "Whether Otty collects telemetry, how its business model may evolve, and where paid feature boundaries will sit.",
    "Memory use and stability for both products during an eight-hour session in a real repository.",
    "Whether Otty's automation surface can cover the user's existing agent hooks.",
  ],
  trialPlan: [
    {
      task:
        "Start six agent sessions and record how long it takes to find the one waiting for input.",
      reason:
        "This tests multi-task attention management instead of counting features.",
    },
    {
      task:
        "Restart the application and restore the workspace, checking directories, scrollback, and agent sessions.",
      reason: "This reveals the real boundary of session restore.",
    },
    {
      task:
        "Connect one frequent action to a shortcut or script and record the setup time.",
      reason:
        "This distinguishes a need for a finished workflow from a programmable primitive.",
    },
  ],
};

export function sampleComparisonForLocale(locale: Locale) {
  return locale === "zh-CN" ? sampleComparison : sampleComparisonEn;
}
