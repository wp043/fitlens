import assert from "node:assert/strict";
import test from "node:test";
import {
  appendWatchTrend,
  createWatchTrendPoint,
  dueWatchEntries,
  markWatchEntryRun,
  parseWatchlist,
  renderWatchTrendHtml,
  snapshotFilename,
} from "../lib/watchlist.ts";
import { sampleComparisonForLocale } from "../lib/sample.ts";

const input = {
  version: 1,
  entries: [
    {
      id: "terminal-tools",
      urls: ["https://one.test", "https://two.test"],
      context: "A detailed recurring terminal-tool decision.",
      intervalHours: 24,
      lastRunAt: "2026-07-20T00:00:00.000Z",
    },
    {
      id: "fresh-entry",
      urls: ["https://three.test", "https://four.test"],
      context: "Another sufficiently detailed recurring decision.",
      intervalHours: 168,
      lastRunAt: "2026-07-21T11:00:00.000Z",
    },
  ],
};

test("selects only due watch entries and applies defaults", () => {
  const watchlist = parseWatchlist(input);
  const due = dueWatchEntries(watchlist, new Date("2026-07-21T12:00:00.000Z"));
  assert.deepEqual(due.map((entry) => entry.id), ["terminal-tools"]);
  assert.equal(watchlist.entries[0].template, "general");
  assert.equal(watchlist.entries[0].notifications, "off");
});

test("builds bounded score trends and renders an offline chart", () => {
  const result = sampleComparisonForLocale("en");
  const criteria = result.dimensions.map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    hint: dimension.explanation,
    weight: dimension.weight,
  }));
  const first = createWatchTrendPoint(result, criteria);
  const trend = appendWatchTrend(undefined, "terminal-tools", first);
  const replacement = {
    ...first,
    scores: { ...first.scores, cmux: 99 },
  };
  const deduplicated = appendWatchTrend(trend, "terminal-tools", replacement);
  assert.equal(deduplicated.points.length, 1);
  assert.equal(deduplicated.points[0].scores.cmux, 99);
  const html = renderWatchTrendHtml({
    ...deduplicated,
    watchId: "terminal-tools<script>",
  });
  assert.match(html, /<svg/);
  assert.match(html, /terminal-tools&lt;script&gt;/);
  assert.doesNotMatch(html, /<h1>terminal-tools<script>/);
});

test("marks successful runs immutably", () => {
  const watchlist = parseWatchlist(input);
  const next = markWatchEntryRun(
    watchlist,
    "terminal-tools",
    "2026-07-21T12:00:00.000Z",
  );
  assert.equal(next.entries[0].lastRunAt, "2026-07-21T12:00:00.000Z");
  assert.equal(watchlist.entries[0].lastRunAt, "2026-07-20T00:00:00.000Z");
});

test("creates portable timestamped snapshot filenames", () => {
  assert.equal(
    snapshotFilename("2026-07-21T12:34:56.789Z"),
    "2026-07-21T12-34-56-789Z.fitlens.json",
  );
});
