import { z } from "zod";
import { criteriaToWeights } from "./criteria.ts";
import { calculateWeightedWinner } from "./scoring.ts";
import type { ComparisonCriterion, ComparisonResult } from "./types.ts";

const criterionSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  hint: z.string().max(200),
  weight: z.number().min(0).max(100),
}).strict();

const watchEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  urls: z.array(z.string().url()).min(2).max(8),
  context: z.string().min(10).max(2_000),
  locale: z.enum(["en", "zh-CN"]).default("en"),
  template: z.enum(["general", "developer-tools", "privacy-first", "daily-use"]).default("general"),
  criteria: z.array(criterionSchema).min(2).max(8).optional(),
  intervalHours: z.number().int().min(1).max(8_760).default(168),
  notifications: z.enum(["off", "changes", "always"]).default("off"),
  lastRunAt: z.string().datetime().optional(),
}).strict();

export const watchlistSchema = z.object({
  version: z.literal(1),
  entries: z.array(watchEntrySchema).min(1).max(100).refine(
    (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
    "Watch entry IDs must be unique",
  ),
}).strict();

export type Watchlist = z.infer<typeof watchlistSchema>;
export type WatchEntry = Watchlist["entries"][number];

export function parseWatchlist(input: unknown) {
  return watchlistSchema.parse(input);
}

export function isWatchEntryDue(entry: WatchEntry, now = new Date()) {
  if (!entry.lastRunAt) return true;
  const lastRun = Date.parse(entry.lastRunAt);
  if (Number.isNaN(lastRun)) return true;
  return now.getTime() - lastRun >= entry.intervalHours * 3_600_000;
}

export function dueWatchEntries(watchlist: Watchlist, now = new Date()) {
  return watchlist.entries.filter((entry) => isWatchEntryDue(entry, now));
}

export function markWatchEntryRun(
  watchlist: Watchlist,
  id: string,
  ranAt: string,
): Watchlist {
  return {
    ...watchlist,
    entries: watchlist.entries.map((entry) =>
      entry.id === id ? { ...entry, lastRunAt: ranAt } : entry,
    ),
  };
}

export function snapshotFilename(capturedAt: string) {
  return `${capturedAt.replace(/[:.]/g, "-")}.fitlens.json`;
}

export interface WatchTrendPoint {
  capturedAt: string;
  winner?: string;
  scores: Record<string, number>;
  evidence: Record<string, number>;
  unknowns: number;
}

export interface WatchTrend {
  schemaVersion: 1;
  watchId: string;
  updatedAt: string;
  points: WatchTrendPoint[];
}

export function createWatchTrendPoint(
  result: ComparisonResult,
  criteria: ComparisonCriterion[],
): WatchTrendPoint {
  const decision = calculateWeightedWinner(result, criteriaToWeights(criteria));
  return {
    capturedAt: result.generatedAt,
    winner: decision.winner,
    scores: decision.normalized,
    evidence: Object.fromEntries(
      result.products.map((product) => [product.name, product.evidence.length]),
    ),
    unknowns: result.unknowns.length,
  };
}

export function appendWatchTrend(
  existing: WatchTrend | undefined,
  watchId: string,
  point: WatchTrendPoint,
  limit = 100,
): WatchTrend {
  const previousPoints =
    existing?.schemaVersion === 1 &&
    existing.watchId === watchId &&
    Array.isArray(existing.points)
      ? existing.points
      : [];
  const deduplicated = previousPoints.filter(
    (item) => item.capturedAt !== point.capturedAt,
  );
  const points = [...deduplicated, point]
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt))
    .slice(-limit);
  return {
    schemaVersion: 1,
    watchId,
    updatedAt: point.capturedAt,
    points,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const trendColors = ["#cba6f7", "#89b4fa", "#a6e3a1", "#fab387", "#f5c2e7", "#f9e2af", "#94e2d5", "#eba0ac"];

export function renderWatchTrendHtml(trend: WatchTrend) {
  const products = Array.from(
    new Set(trend.points.flatMap((point) => Object.keys(point.scores))),
  );
  const width = 920;
  const height = 360;
  const padding = 44;
  const x = (index: number) =>
    trend.points.length <= 1
      ? width / 2
      : padding + (index / (trend.points.length - 1)) * (width - padding * 2);
  const y = (score: number) =>
    height - padding - (Math.max(0, Math.min(100, score)) / 100) * (height - padding * 2);
  const lines = products.map((product, productIndex) => {
    const points = trend.points
      .map((point, index) => `${x(index)},${y(point.scores[product] ?? 0)}`)
      .join(" ");
    const color = trendColors[productIndex % trendColors.length];
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`;
  }).join("");
  const guides = [0, 25, 50, 75, 100].map((score) => {
    const position = y(score);
    return `<line x1="${padding}" y1="${position}" x2="${width - padding}" y2="${position}" stroke="#45475a" stroke-width="1" /><text x="8" y="${position + 4}" fill="#a6adc8" font-size="11">${score}</text>`;
  }).join("");
  const legend = products.map((product, index) =>
    `<span><i style="background:${trendColors[index % trendColors.length]}"></i>${escapeHtml(product)}</span>`,
  ).join("");
  const rows = [...trend.points].reverse().map((point) =>
    `<tr><td>${escapeHtml(new Date(point.capturedAt).toLocaleString("en"))}</td><td>${escapeHtml(point.winner ?? "—")}</td><td>${products.map((product) => `${escapeHtml(product)} ${point.scores[product] ?? 0}`).join(" · ")}</td><td>${point.unknowns}</td></tr>`,
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(trend.watchId)} · FitLens trend</title><style>:root{color-scheme:dark;font:14px Inter,system-ui;background:#1e1e2e;color:#cdd6f4}body{max-width:1040px;margin:auto;padding:48px 24px}h1{font-size:36px}.muted{color:#a6adc8}.card{margin-top:24px;padding:24px;border:1px solid #45475a;border-radius:20px;background:#262637}svg{width:100%;height:auto}.legend{display:flex;gap:18px;flex-wrap:wrap}.legend span{display:flex;align-items:center;gap:7px}.legend i{width:10px;height:10px;border-radius:50%}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:12px;text-align:left;border-bottom:1px solid #45475a}th{color:#a6adc8;font-size:11px;text-transform:uppercase}@media(max-width:700px){body{padding:24px 14px}.card{overflow:auto}table{min-width:720px}}</style></head><body><p class="muted">FITLENS · WATCH TREND</p><h1>${escapeHtml(trend.watchId)}</h1><p class="muted">${trend.points.length} snapshots · updated ${escapeHtml(new Date(trend.updatedAt).toLocaleString("en"))}</p><section class="card"><div class="legend">${legend}</div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Weighted fit score trend from zero to one hundred">${guides}${lines}</svg></section><section class="card"><table><thead><tr><th>Captured</th><th>Winner</th><th>Scores</th><th>Unknowns</th></tr></thead><tbody>${rows}</tbody></table></section></body></html>`;
}
