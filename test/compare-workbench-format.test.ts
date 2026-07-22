import assert from "node:assert/strict";
import test from "node:test";
import {
  comparisonAsMarkdown,
  safeFilename,
} from "../components/compare-workbench-format.ts";
import { messages } from "../lib/i18n.ts";
import { sampleComparisonForLocale } from "../lib/sample.ts";

test("creates a localized, durable Markdown decision brief", () => {
  const result = sampleComparisonForLocale("en");
  const markdown = comparisonAsMarkdown(
    result,
    "Validated locally.",
    "en",
    messages.en,
  );

  assert.match(markdown, new RegExp(`^# ${result.title}`));
  assert.match(markdown, new RegExp(`## ${messages.en.markdownRecommendation}:`));
  assert.match(markdown, new RegExp(`## ${messages.en.markdownUnknowns}`));
  assert.match(markdown, /Validated locally\./);
  for (const product of result.products) {
    assert.match(markdown, new RegExp(`## ${product.name} —`));
  }
});

test("creates portable report filenames", () => {
  assert.equal(safeFilename("cmux vs. Otty: July 2026"), "cmux-vs-otty-july-2026");
  assert.equal(safeFilename("比较"), "fitlens-report");
});
