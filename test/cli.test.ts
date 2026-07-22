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

test("parses a scheduled watchlist command", () => {
  const options = parseCliArguments([
    "watch",
    "--config", "fitlens.watch.json",
    "--output-dir", "research/snapshots",
    "--force",
  ]);
  assert.equal(options.command, "watch");
  assert.equal(options.configFile, "fitlens.watch.json");
  assert.equal(options.outputDirectory, "research/snapshots");
  assert.equal(options.force, true);
});

test("parses doctor diagnostics without analysis inputs", () => {
  const options = parseCliArguments([
    "doctor",
    "--json",
    "--output", ".fitlens/doctor.json",
    "--check-playwright",
    "--probe-provider",
  ]);
  assert.equal(options.command, "doctor");
  assert.equal(options.doctorJson, true);
  assert.equal(options.outputFile, ".fitlens/doctor.json");
  assert.equal(options.checkPlaywright, true);
  assert.equal(options.probeProvider, true);
});

test("parses an offline replay without analysis inputs", () => {
  const options = parseCliArguments([
    "replay",
    "--bundle", "decision.fitlens-replay.json",
    "--format", "markdown",
    "--output", "decision.md",
  ]);
  assert.equal(options.command, "replay");
  assert.equal(options.replayFile, "decision.fitlens-replay.json");
  assert.equal(options.format, "markdown");
  assert.throws(() => parseCliArguments(["replay"]), /--bundle/);
});
