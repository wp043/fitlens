import type { SavedReport } from "./report.ts";
import { calculatePairwiseStandings } from "./pairwise.ts";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function list(items: string[]) {
  return items.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p>—</p>";
}

export function reportToHtml(report: SavedReport) {
  const result = report.result;
  const products = result.products.map((product) => `
    <article class="product">
      <header><h2>${escapeHtml(product.name)}</h2><b>${product.score}/100</b></header>
      <p>${escapeHtml(product.verdict)}</p>
      <div class="columns"><section><h3>Strengths</h3>${list(product.strengths)}</section><section><h3>Tradeoffs</h3>${list(product.tradeoffs)}</section></div>
      <h3>Evidence</h3>
      <ul>${product.evidence.filter((item) => item.reviewStatus !== "rejected").map((item) =>
        `<li><span class="level ${item.level}">${escapeHtml(item.level)}</span> ${escapeHtml(item.claim)} <a href="${escapeHtml(item.sourceUrl)}">${escapeHtml(item.sourceLabel)}</a></li>`,
      ).join("")}</ul>
    </article>`).join("");
  const standings = calculatePairwiseStandings(
    result.products.map((product) => product.name),
    report.pairwiseTrials ?? [],
  );

  return `<!doctype html>
<html lang="${report.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${escapeHtml(report.title)}</title>
<style>
:root{--bg:#1e1e2e;--card:#29293d;--text:#cdd6f4;--muted:#a6adc8;--mauve:#cba6f7;--green:#a6e3a1;--peach:#fab387;--line:rgba(205,214,244,.16)}*{box-sizing:border-box}body{max-width:1050px;margin:0 auto;padding:48px 28px;background:var(--bg);color:var(--text);font:15px/1.65 system-ui,sans-serif}h1{font-size:42px;line-height:1.1}h1 span{color:var(--mauve)}h2,h3{margin:.3em 0}a{color:#89b4fa}.meta,.context{color:var(--muted)}.decision,.product,.criteria,.pairwise{margin:22px 0;padding:24px;border:1px solid var(--line);border-radius:18px;background:var(--card)}.decision{border-color:rgba(203,166,247,.38)}.product header{display:flex;justify-content:space-between}.product header b{color:var(--green);font-size:22px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}.level{padding:2px 6px;border-radius:5px;font-size:11px}.verified{color:var(--green)}.vendor{color:var(--muted)}.inferred{color:var(--peach)}table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid var(--line);text-align:left}.notes{white-space:pre-wrap}@media(max-width:650px){.columns{grid-template-columns:1fr}h1{font-size:32px}}@media print{:root{--bg:#fff;--card:#fff;--text:#191622;--muted:#555;--line:#ccc}body{max-width:none;padding:0;font-size:11pt}.decision,.product,.criteria,.pairwise{break-inside:avoid;border-radius:8px}a{color:#191622;text-decoration:none}a:after{content:" (" attr(href) ")";font-size:8pt}}
</style></head><body>
<p class="meta">FitLens decision record · ${escapeHtml(result.generatedAt)}</p>
<h1>${escapeHtml(result.title)}<br><span>${escapeHtml(result.recommendation.winner)}</span></h1>
<p class="context">${escapeHtml(report.context)}</p>
<section class="decision"><h2>Decision</h2><p>${escapeHtml(result.recommendation.summary)}</p>${list(result.recommendation.reasons)}<p><strong>Reconsider when:</strong> ${escapeHtml(result.recommendation.switchWhen)}</p></section>
<section class="criteria"><h2>Criteria</h2><table><thead><tr><th>Criterion</th><th>Weight</th><th>Scope</th></tr></thead><tbody>${report.criteria.map((criterion) => `<tr><td>${escapeHtml(criterion.label)}</td><td>${criterion.weight}</td><td>${escapeHtml(criterion.hint)}</td></tr>`).join("")}</tbody></table></section>
${products}
<section><h2>Unknowns</h2>${list(result.unknowns)}</section>
${report.pairwiseTrials?.length ? `<section class="pairwise"><h2>Pairwise trial standings</h2><table>${standings.map((item) => `<tr><td>${escapeHtml(item.product)}</td><td>${item.wins}W · ${item.losses}L · ${item.ties}T</td><td>${item.points} pts</td></tr>`).join("")}</table></section>` : ""}
${report.notes ? `<section><h2>Notes</h2><p class="notes">${escapeHtml(report.notes)}</p></section>` : ""}
</body></html>`;
}

function markdownText(value: string) {
  return value
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

export function reportToAdr(report: SavedReport) {
  const result = report.result;
  return `# ADR: ${markdownText(report.title)}

- Status: accepted
- Date: ${result.generatedAt.slice(0, 10)}
- Decision: ${markdownText(result.recommendation.winner)}

## Context

${markdownText(report.context)}

## Decision drivers

${report.criteria.map((criterion) => `- **${markdownText(criterion.label)} (${criterion.weight})** — ${markdownText(criterion.hint)}`).join("\n")}

## Decision

${markdownText(result.recommendation.summary)}

${result.recommendation.reasons.map((reason) => `- ${markdownText(reason)}`).join("\n")}

## Consequences

### Positive

${result.products.find((product) => product.name === result.recommendation.winner)?.strengths.map((item) => `- ${markdownText(item)}`).join("\n") ?? "- Not recorded"}

### Tradeoffs

${result.products.find((product) => product.name === result.recommendation.winner)?.tradeoffs.map((item) => `- ${markdownText(item)}`).join("\n") ?? "- Not recorded"}

## Reconsider when

${markdownText(result.recommendation.switchWhen)}

## Unknowns

${result.unknowns.map((item) => `- ${markdownText(item)}`).join("\n")}

## Evidence

${result.products.flatMap((product) => product.evidence.filter((item) => item.reviewStatus !== "rejected").map((item) => `- **${markdownText(product.name)} · ${item.level}:** ${markdownText(item.claim)} ([${markdownText(item.sourceLabel)}](${item.sourceUrl}))`)).join("\n")}
`;
}
