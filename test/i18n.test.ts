import assert from "node:assert/strict";
import test from "node:test";
import { messages, normalizeLocale } from "../lib/i18n.ts";
import {
  sampleComparison,
  sampleComparisonForLocale,
} from "../lib/sample.ts";

test("locale normalization supports Chinese variants and defaults to English", () => {
  assert.equal(normalizeLocale("zh-TW"), "zh-CN");
  assert.equal(normalizeLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("fr-FR"), "en");
});

test("English and Chinese dictionaries expose the same keys", () => {
  assert.deepEqual(
    Object.keys(messages.en).sort(),
    Object.keys(messages["zh-CN"]).sort(),
  );
});

test("the bundled report follows the requested locale", () => {
  const english = sampleComparisonForLocale("en");
  const chinese = sampleComparisonForLocale("zh-CN");

  assert.equal(chinese, sampleComparison);
  assert.match(english.products[0].tagline, /programmable/i);
  assert.match(chinese.products[0].tagline, /开放/);
});
