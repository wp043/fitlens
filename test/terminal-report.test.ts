import assert from "node:assert/strict";
import test from "node:test";
import {
  comparisonToTerminal,
  displayWidth,
  wrapText,
} from "../lib/terminal-report.ts";
import { sampleComparison, sampleComparisonEn } from "../lib/sample.ts";

const ANSI = /\[[0-9;]*m/g;

test("display width counts terminal cells, not code units", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("中文"), 4);
  assert.equal(displayWidth("a中b"), 4);
  assert.equal(displayWidth("[32mok[0m"), 2);
  assert.equal(displayWidth(""), 0);
});

test("wrapping never exceeds the budget in either script", () => {
  const latin = wrapText(sampleComparisonEn.recommendation.summary, 40);
  for (const line of latin) assert.ok(displayWidth(line) <= 40, line);

  const chinese = wrapText(sampleComparison.recommendation.summary, 30);
  for (const line of chinese) {
    // Hanging punctuation may exceed by one wide glyph, never more.
    assert.ok(displayWidth(line) <= 32, line);
  }
  assert.ok(chinese.length > 1);
});

test("Chinese punctuation never opens a line", () => {
  const lines = wrapText("这是一个很长的句子，需要在某处换行。再来一段文字。", 12);
  for (const line of lines) {
    assert.ok(!"。，、；：？！".includes(line[0] ?? ""), `line opened with punctuation: ${line}`);
  }
});

test("wrapping preserves every non-space character", () => {
  const source = sampleComparisonEn.recommendation.switchWhen;
  const rejoined = wrapText(source, 25).join(" ").replace(/\s+/g, "");
  assert.equal(rejoined, source.replace(/\s+/g, ""));
});

test("the title box aligns at any width, in either locale", () => {
  for (const result of [sampleComparison, sampleComparisonEn]) {
    for (const width of [48, 60, 88]) {
      const lines = comparisonToTerminal(result, { width, color: false })
        .split("\n");
      const top = lines[0];
      const middle = lines[1];
      const bottom = lines[2];
      assert.equal(displayWidth(top), width, `top @${width}`);
      assert.equal(displayWidth(middle), width, `middle @${width}`);
      assert.equal(displayWidth(bottom), width, `bottom @${width}`);
      assert.ok(middle.startsWith("│") && middle.endsWith("│"));
    }
  }
});

test("no rendered line overflows the requested width", () => {
  const width = 72;
  const lines = comparisonToTerminal(sampleComparisonEn, { width, color: false })
    .split("\n");
  for (const line of lines) {
    assert.ok(displayWidth(line) <= width + 2, `overflow: ${line}`);
  }
});

test("color is opt-in and absent by default", () => {
  const plain = comparisonToTerminal(sampleComparisonEn, { width: 72 });
  assert.equal(ANSI.test(plain), false);
  ANSI.lastIndex = 0;

  const colored = comparisonToTerminal(sampleComparisonEn, {
    width: 72,
    color: true,
  });
  assert.ok(/\[/.test(colored));
  assert.equal(colored.replace(ANSI, ""), plain);
});

test("rejected evidence stays out of the rendered report", () => {
  const [first, ...rest] = sampleComparisonEn.products;
  const claim = first.evidence[0].claim;
  const withRejection = {
    ...sampleComparisonEn,
    products: [
      {
        ...first,
        evidence: [
          { ...first.evidence[0], reviewStatus: "rejected" as const },
          ...first.evidence.slice(1),
        ],
      },
      ...rest,
    ],
  };
  assert.ok(comparisonToTerminal(sampleComparisonEn, { width: 88 }).includes(claim));
  assert.equal(
    comparisonToTerminal(withRejection, { width: 88 }).includes(claim),
    false,
  );
});

test("the report carries the decision content a reader needs", () => {
  const output = comparisonToTerminal(sampleComparisonEn, { width: 88 });
  assert.ok(output.includes(sampleComparisonEn.recommendation.winner));
  assert.ok(output.includes(sampleComparisonEn.title));
  for (const product of sampleComparisonEn.products) {
    assert.ok(output.includes(`${product.score}/100`), product.name);
  }
  assert.ok(output.includes("Unknowns"));
  assert.ok(output.includes("Trial plan"));
});
