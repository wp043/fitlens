"use client";

import { useMemo, useState } from "react";
import { defaultPriorities, sampleComparison } from "@/lib/sample";
import { calculateWeightedWinner } from "@/lib/scoring";
import type {
  ComparisonResult,
  EvidenceLevel,
  PriorityKey,
  PriorityWeights,
} from "@/lib/types";

const priorityMeta: Array<{
  key: PriorityKey;
  label: string;
  hint: string;
}> = [
  { key: "openness", label: "开放与可控", hint: "源码、license、数据边界" },
  { key: "agentWorkflow", label: "Agent workflow", hint: "并行、通知、上下文" },
  { key: "performance", label: "原生性能", hint: "延迟、资源占用、稳定性" },
  { key: "polish", label: "开箱完成度", hint: "交互、学习成本、细节" },
  { key: "automation", label: "自动化能力", hint: "CLI、API、hooks、扩展" },
];

const evidenceLabels: Record<EvidenceLevel, string> = {
  verified: "已核验",
  vendor: "厂商自述",
  inferred: "合理推断",
};

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 42 42">
        <circle cx="19" cy="19" r="12.5" />
        <path d="m28.2 28.2 8.1 8.1" />
        <path d="M12.5 19h13M19 12.5v13" />
      </svg>
    </span>
  );
}

function SourcePill({
  mode,
}: {
  mode: "open-source" | "website-only";
}) {
  return (
    <span className={`source-pill ${mode}`}>
      <span className="source-dot" />
      {mode === "open-source" ? "源码 + 官网" : "官网 / 文档"}
    </span>
  );
}

export function CompareWorkbench() {
  const [urls, setUrls] = useState<[string, string]>([
    "https://cmux.com/",
    "https://otty.sh/",
  ]);
  const [context, setContext] = useState(
    "我在 macOS 上同时运行多个 Codex / Claude Code session。重视开源、速度、隐私和自动化；不介意做少量配置。",
  );
  const [priorities, setPriorities] =
    useState<PriorityWeights>(defaultPriorities);
  const [result, setResult] =
    useState<ComparisonResult>(sampleComparison);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const weightedDecision = useMemo(() => {
    return calculateWeightedWinner(result, priorities);
  }, [priorities, result]);
  const weightedWinner = weightedDecision.winner;
  const currentWinner = result.products.find(
    (product) => product.name === weightedWinner,
  );

  async function analyze() {
    setStatus("loading");
    setError("");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, context, priorities }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "分析失败，请稍后再试。");
      }
      setResult(payload);
      setStatus("idle");
      setTimeout(
        () =>
          document
            .querySelector("#result")
            ?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分析失败");
      setStatus("error");
    }
  }

  return (
    <main>
      <nav className="topbar">
        <a className="brand" href="#">
          <BrandMark />
          <span>FitLens</span>
        </a>
        <div className="nav-note">
          <span className="pulse" />
          Evidence-first comparison
        </div>
      </nav>

      <section className="hero shell">
        <p className="eyebrow">PRODUCT DECISION, PERSONALIZED</p>
        <h1>
          不是谁更强。
          <br />
          是谁<span>更适合你。</span>
        </h1>
        <p className="hero-copy">
          同一套尺度分析开源仓库与闭源产品，分清事实、宣传和推断，
          再按你的真实 workflow 给出选择。
        </p>
      </section>

      <section className="compare-builder shell" aria-label="创建对比">
        <div className="builder-head">
          <div>
            <span className="step-index">01</span>
            <h2>放进两个候选产品</h2>
          </div>
          <span className="sample-tag">已载入 cmux vs Otty 示例</span>
        </div>

        <div className="url-grid">
          {urls.map((url, index) => (
            <label className="url-field" key={index}>
              <span>产品 {index === 0 ? "A" : "B"}</span>
              <div>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7-7.1l-1.1 1" />
                  <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7 7.1l1.1-1" />
                </svg>
                <input
                  value={url}
                  onChange={(event) => {
                    const next = [...urls] as [string, string];
                    next[index] = event.target.value;
                    setUrls(next);
                  }}
                  aria-label={`产品 ${index === 0 ? "A" : "B"} URL`}
                />
              </div>
            </label>
          ))}
        </div>

        <div className="profile-grid">
          <div className="context-block">
            <div className="section-label">
              <span className="step-index">02</span>
              <h2>你的使用场景</h2>
            </div>
            <textarea
              value={context}
              onChange={(event) => setContext(event.target.value)}
              rows={7}
            />
            <p>越具体越好：设备、workflow、不能接受什么、愿意折腾多少。</p>
          </div>

          <div className="priorities-block">
            <div className="section-label">
              <span className="step-index">03</span>
              <h2>选择权重</h2>
            </div>
            <div className="sliders">
              {priorityMeta.map((item) => (
                <label key={item.key}>
                  <span className="slider-copy">
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.hint}</small>
                    </span>
                    <b>{priorities[item.key]}</b>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={priorities[item.key]}
                    onChange={(event) =>
                      setPriorities((current) => ({
                        ...current,
                        [item.key]: Number(event.target.value),
                      }))
                    }
                    style={
                      {
                        "--range": `${priorities[item.key]}%`,
                      } as React.CSSProperties
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="analyze-row">
          <div>
            <span className="status-dot" />
            自动识别 GitHub repository 与官网证据
          </div>
          <button onClick={analyze} disabled={status === "loading"}>
            {status === "loading" ? "正在取证…" : "开始分析"}
            {status !== "loading" && <span>↗</span>}
          </button>
        </div>
        {error && (
          <div className="error-banner">
            {error} 当前页面仍保留可交互的 cmux vs Otty 示例结果。
          </div>
        )}
      </section>

      <section className="result shell" id="result">
        <div className="result-kicker">
          <span>FITLENS REPORT / 001</span>
          <span>基于公开资料 · 权重可实时调整</span>
        </div>

        <div className="verdict-card">
          <div className="verdict-main">
            <p>FOR YOUR WORKFLOW</p>
            <h2>
              目前选择{" "}
              <span>{weightedWinner ?? result.recommendation.winner}</span>
            </h2>
            <p>
              {weightedWinner === result.recommendation.winner
                ? result.recommendation.summary
                : `按当前权重，${weightedWinner} 得分更高。${currentWinner?.verdict ?? ""}`}
            </p>
          </div>
          <div className="score-seal">
            <span>FIT SCORE</span>
            <strong>
              {weightedDecision.normalized[
                weightedWinner ?? result.recommendation.winner
              ] ?? currentWinner?.score ?? result.products[0].score}
            </strong>
            <small>/ 100</small>
          </div>
        </div>

        <div className="product-grid">
          {result.products.map((product, index) => (
            <article
              className={`product-card ${index === 0 ? "featured" : ""}`}
              key={product.name}
            >
              <header>
                <div>
                  <span className="product-letter">
                    {product.name.slice(0, 1)}
                  </span>
                  <div>
                    <h3>{product.name}</h3>
                    <p>{product.tagline}</p>
                  </div>
                </div>
                <SourcePill mode={product.sourceMode} />
              </header>

              <div className="confidence">
                <span>证据置信度</span>
                <div>
                  <i style={{ width: `${product.confidence}%` }} />
                </div>
                <b>{product.confidence}%</b>
              </div>

              <p className="product-verdict">{product.verdict}</p>

              <div className="pros-cons">
                <div>
                  <h4>适合你的地方</h4>
                  <ul>
                    {product.strengths.map((item) => (
                      <li key={item}>
                        <span>+</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>要接受的代价</h4>
                  <ul>
                    {product.tradeoffs.map((item) => (
                      <li key={item}>
                        <span>–</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="evidence-stack">
                <h4>关键证据</h4>
                {product.evidence.map((item) => (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    key={item.claim}
                  >
                    <span className={`evidence-badge ${item.level}`}>
                      {evidenceLabels[item.level]}
                    </span>
                    <p>{item.claim}</p>
                    <small>{item.sourceLabel} ↗</small>
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="matrix-card">
          <header>
            <div>
              <span className="step-index">04</span>
              <h2>为什么是这个结果</h2>
            </div>
            <p>拖动上方权重，结论会按你的偏好重新计算。</p>
          </header>
          <div className="matrix">
            {result.dimensions.map((dimension) => {
              const entries = Object.entries(dimension.productScores);
              return (
                <div className="matrix-row" key={dimension.key}>
                  <div className="matrix-label">
                    <strong>{dimension.label}</strong>
                    <small>权重 {priorities[dimension.key]}</small>
                  </div>
                  <div className="matrix-bars">
                    {entries.map(([product, score]) => (
                      <div key={product}>
                        <span>{product}</span>
                        <i>
                          <b style={{ width: `${score}%` }} />
                        </i>
                        <strong>{score}</strong>
                      </div>
                    ))}
                  </div>
                  <p>{dimension.explanation}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bottom-grid">
          <div className="unknown-card">
            <p className="eyebrow">KNOW WHAT WE DON&apos;T KNOW</p>
            <h2>仍需验证的未知项</h2>
            <ol>
              {result.unknowns.map((unknown) => (
                <li key={unknown}>{unknown}</li>
              ))}
            </ol>
          </div>
          <div className="trial-card">
            <p className="eyebrow">30-MINUTE REALITY CHECK</p>
            <h2>别再看评测，亲自跑这 3 项</h2>
            {result.trialPlan.map((item, index) => (
              <div key={item.task}>
                <span>0{index + 1}</span>
                <p>
                  <strong>{item.task}</strong>
                  <small>{item.reason}</small>
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="shell">
        <a className="brand" href="#">
          <BrandMark />
          <span>FitLens</span>
        </a>
        <p>Choose with evidence. Decide for yourself.</p>
        <span>v0.1 · Built for tools that appear faster than you can test them.</span>
      </footer>
    </main>
  );
}
