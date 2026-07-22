import type { ComparisonResult, Evidence, ProductResult } from "./types.ts";

export interface TerminalReportOptions {
  /** Total render width. Clamped to a readable range. */
  width?: number;
  /** Emit ANSI styling. Callers should pass false for pipes and NO_COLOR. */
  color?: boolean;
}

const MIN_WIDTH = 48;
const MAX_WIDTH = 96;

const SGR = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
} as const;

type Style = keyof typeof SGR;

/**
 * Terminal cells occupied by a string. East Asian wide characters take two
 * columns, combining marks take none, and ANSI sequences take none. Box
 * drawing misaligns without this whenever the report renders in zh-CN.
 */
export function displayWidth(input: string) {
  let width = 0;
  for (const character of stripAnsi(input)) {
    const code = character.codePointAt(0)!;
    if (code === 0x200b) continue;
    if (code >= 0x0300 && code <= 0x036f) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

function isWide(code: number) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

function stripAnsi(input: string) {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Punctuation that must not open a line. Chinese line-breaking rules forbid it,
 * and a stray leading comma is the most visible way a zh-CN report looks wrong.
 * Such a token is allowed to hang past the limit instead.
 */
const NO_LINE_START = new Set([
  ..."。，、；：？！）》」』】〉…·",
  ...",.;:!?)]}",
]);

/**
 * Wrap to a column budget measured in display cells. Latin text breaks on
 * spaces; CJK runs have no spaces to break on, so they break between
 * characters.
 */
export function wrapText(input: string, width: number) {
  const limit = Math.max(8, width);
  const lines: string[] = [];
  for (const paragraph of input.split("\n")) {
    let line = "";
    for (const token of tokenize(paragraph)) {
      if (token === " " && line === "") continue;
      if (displayWidth(line + token) <= limit) {
        line += token;
        continue;
      }
      if (line !== "" && NO_LINE_START.has(token)) {
        line += token;
        continue;
      }
      if (line !== "") lines.push(line.trimEnd());
      line = token === " " ? "" : token;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function tokenize(input: string) {
  const tokens: string[] = [];
  let word = "";
  for (const character of input) {
    if (character === " ") {
      if (word !== "") tokens.push(word);
      tokens.push(" ");
      word = "";
      continue;
    }
    if (isWide(character.codePointAt(0)!)) {
      if (word !== "") tokens.push(word);
      tokens.push(character);
      word = "";
      continue;
    }
    word += character;
  }
  if (word !== "") tokens.push(word);
  return tokens;
}

function padEnd(input: string, width: number) {
  return input + " ".repeat(Math.max(0, width - displayWidth(input)));
}

type Painter = (input: string, ...styles: Style[]) => string;

function createPainter(enabled: boolean): Painter {
  return (input, ...styles) => {
    if (!enabled || styles.length === 0) return input;
    return `${styles.map((style) => SGR[style]).join("")}${input}${SGR.reset}`;
  };
}

const EVIDENCE_MARKS: Record<Evidence["level"], { mark: string; style: Style }> = {
  verified: { mark: "✓", style: "green" },
  vendor: { mark: "~", style: "yellow" },
  inferred: { mark: "?", style: "blue" },
};

function scoreBar(score: number, cells: number) {
  const filled = Math.round((Math.min(100, Math.max(0, score)) / 100) * cells);
  return "█".repeat(filled) + "░".repeat(Math.max(0, cells - filled));
}

function scoreStyle(score: number): Style {
  if (score >= 75) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

function acceptedEvidence(product: ProductResult) {
  return product.evidence.filter((item) => item.reviewStatus !== "rejected");
}

function titleBox(result: ComparisonResult, width: number, paint: Painter) {
  const inner = width - 2;
  const winner = `▸ ${result.recommendation.winner}`;
  const confidence =
    result.products.find((item) => item.name === result.recommendation.winner)
      ?.confidence;
  const right = confidence === undefined ? "" : `confidence ${confidence}%`;
  const gap = Math.max(1, inner - 2 - displayWidth(winner) - displayWidth(right));
  const heading = ` ${paint(winner, "bold")}${" ".repeat(gap)}${paint(right, "dim")} `;
  const label = ` ${result.title} `;
  const rule = "─".repeat(Math.max(0, inner - displayWidth(label)));
  return [
    paint(`╭─${label}${rule.slice(1)}╮`, "dim"),
    `${paint("│", "dim")}${padEnd(heading, inner)}${paint("│", "dim")}`,
    paint(`╰${"─".repeat(inner)}╯`, "dim"),
  ];
}

function sectionRule(label: string, width: number, paint: Painter) {
  const text = `─ ${label} `;
  const rule = "─".repeat(Math.max(0, width - displayWidth(text)));
  return paint(text, "bold") + paint(rule, "dim");
}

function bulletBlock(
  items: string[],
  marker: string,
  style: Style | undefined,
  width: number,
  paint: Painter,
) {
  const lines: string[] = [];
  for (const item of items) {
    const wrapped = wrapText(item, width - 4);
    lines.push(`  ${style ? paint(marker, style) : marker} ${wrapped[0] ?? ""}`);
    for (const continuation of wrapped.slice(1)) lines.push(`    ${continuation}`);
  }
  return lines;
}

function evidenceBlock(product: ProductResult, width: number, paint: Painter) {
  const lines: string[] = [];
  for (const item of acceptedEvidence(product)) {
    const { mark, style } = EVIDENCE_MARKS[item.level];
    const label = padEnd(item.level, 9);
    const indent = 2 + 2 + displayWidth(label);
    const wrapped = wrapText(item.claim, width - indent);
    lines.push(
      `  ${paint(mark, style)} ${paint(label, style)}${wrapped[0] ?? ""}`,
    );
    for (const continuation of wrapped.slice(1)) {
      lines.push(`${" ".repeat(indent)}${continuation}`);
    }
    lines.push(
      `${" ".repeat(indent)}${paint(item.sourceUrl, "dim")}`,
    );
  }
  return lines;
}

function productSection(
  product: ProductResult,
  width: number,
  paint: Painter,
): string[] {
  const heading = `${product.name} ─ ${product.score}/100`;
  const lines = [sectionRule(heading, width, paint), ""];
  for (const line of wrapText(product.verdict, width - 2)) lines.push(`  ${line}`);
  lines.push("");
  lines.push(...evidenceBlock(product, width, paint));
  lines.push("");
  lines.push(...bulletBlock(product.strengths, "+", "green", width, paint));
  lines.push(...bulletBlock(product.tradeoffs, "−", "red", width, paint));
  lines.push("");
  return lines;
}

function standings(result: ComparisonResult, width: number, paint: Painter) {
  const nameWidth = Math.max(
    ...result.products.map((product) => displayWidth(product.name)),
  );
  const cells = Math.max(8, Math.min(28, width - nameWidth - 22));
  return result.products.map((product) => {
    const bar = paint(scoreBar(product.score, cells), scoreStyle(product.score));
    const score = paint(String(product.score).padStart(3), "bold");
    const mode = paint(product.sourceMode, "dim");
    return `  ${padEnd(product.name, nameWidth)}  ${bar}  ${score}  ${mode}`;
  });
}

/**
 * Render a comparison for a human reading a terminal. `--format json` stays
 * the machine contract; this format is free to change.
 */
export function comparisonToTerminal(
  result: ComparisonResult,
  options: TerminalReportOptions = {},
) {
  const width = Math.max(
    MIN_WIDTH,
    Math.min(MAX_WIDTH, options.width ?? MAX_WIDTH),
  );
  const paint = createPainter(options.color ?? false);
  const lines: string[] = [];

  lines.push(...titleBox(result, width, paint));
  lines.push("");
  for (const line of wrapText(result.recommendation.summary, width - 2)) {
    lines.push(`  ${line}`);
  }
  lines.push("");
  lines.push(...standings(result, width, paint));
  lines.push("");
  lines.push(...bulletBlock(result.recommendation.reasons, "·", "dim", width, paint));
  lines.push("");
  for (const line of wrapText(
    `Choose differently when: ${result.recommendation.switchWhen}`,
    width - 4,
  )) {
    lines.push(`  ${paint(line, "dim")}`);
  }
  lines.push("");

  for (const product of result.products) {
    lines.push(...productSection(product, width, paint));
  }

  if (result.unknowns.length > 0) {
    lines.push(
      sectionRule(`⚠ Unknowns (${result.unknowns.length})`, width, paint),
    );
    lines.push("");
    lines.push(...bulletBlock(result.unknowns, "·", "yellow", width, paint));
    lines.push("");
  }

  if (result.trialPlan.length > 0) {
    lines.push(
      sectionRule(`→ Trial plan (${result.trialPlan.length} steps)`, width, paint),
    );
    lines.push("");
    result.trialPlan.forEach((task, index) => {
      const number = paint(`${index + 1}.`, "bold");
      const wrapped = wrapText(task.task, width - 6);
      lines.push(`  ${number} ${wrapped[0] ?? ""}`);
      for (const continuation of wrapped.slice(1)) lines.push(`     ${continuation}`);
      for (const line of wrapText(task.reason, width - 6)) {
        lines.push(`     ${paint(line, "dim")}`);
      }
      lines.push("");
    });
  }

  lines.push(paint(`Generated ${result.generatedAt}`, "dim"));
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}
