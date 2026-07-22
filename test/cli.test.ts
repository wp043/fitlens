import assert from "node:assert/strict";
import test from "node:test";
import { parseCliArguments } from "../lib/cli.ts";

test("parses a repeatable URL headless analysis command", () => {
  const options = parseCliArguments([
    "analyze",
    "--url", "https://one.test",
    "--url", "https://two.test",
    "--context", "A detailed workflow context.",
    "--format", "markdown",
    "--locale", "zh-CN",
    "--template", "developer-tools",
    "--no-sample",
  ]);
  assert.equal(options.command, "analyze");
  assert.deepEqual(options.urls, ["https://one.test", "https://two.test"]);
  assert.equal(options.format, "markdown");
  assert.equal(options.locale, "zh-CN");
  assert.equal(options.template, "developer-tools");
  assert.equal(options.allowBundledSample, false);
});

test("rejects ambiguous context and incomplete shortlists", () => {
  assert.throws(() => parseCliArguments([
    "analyze", "--url", "https://one.test", "--context", "context",
  ]), /2–8/);
  assert.throws(() => parseCliArguments([
    "analyze",
    "--url", "https://one.test",
    "--url", "https://two.test",
    "--context", "context",
    "--context-file", "context.txt",
  ]), /either/);
});
