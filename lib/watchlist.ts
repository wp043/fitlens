import { z } from "zod";

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
