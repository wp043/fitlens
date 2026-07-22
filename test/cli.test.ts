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

test("demo needs no inputs and rejects analysis arguments", () => {
  const options = parseCliArguments(["demo"]);
  assert.equal(options.command, "demo");
  assert.deepEqual(options.urls, []);
  assert.equal(options.context, undefined);

  const withFormat = parseCliArguments(["demo", "--format", "markdown", "--locale", "zh-CN"]);
  assert.equal(withFormat.format, "markdown");
  assert.equal(withFormat.locale, "zh-CN");

  assert.throws(
    () => parseCliArguments(["demo", "--url", "https://one.test"]),
    /Demo takes no/,
  );
  assert.throws(
    () => parseCliArguments(["demo", "--context", "some workflow context"]),
    /Demo takes no/,
  );
});

test("output format defaults to the caller's choice and accepts text", () => {
  assert.equal(parseCliArguments(["demo"]).format, "json");
  assert.equal(parseCliArguments(["demo"], "text").format, "text");
  // An explicit flag always wins over the default.
  assert.equal(parseCliArguments(["demo", "--format", "json"], "text").format, "json");
  assert.equal(parseCliArguments(["demo", "--format", "text"]).format, "text");
  assert.throws(
    () => parseCliArguments(["demo", "--format", "yaml"]),
    /json, markdown, or text/,
  );
});
