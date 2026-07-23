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

test("version is requested before command validation", () => {
  assert.equal(parseCliArguments(["--version"]).command, "version");
  assert.equal(parseCliArguments(["-v"]).command, "version");
  // --version wins even alongside an otherwise-unknown command.
  assert.equal(parseCliArguments(["bogus", "--version"]).command, "version");
});

test("analyze accepts replay-out and a validated min-confidence", () => {
  const options = parseCliArguments([
    "analyze",
    "--url", "https://one.test",
    "--url", "https://two.test",
    "--context", "A detailed workflow context.",
    "--replay-out", "bundle.json",
    "--min-confidence", "70",
  ]);
  assert.equal(options.replayOut, "bundle.json");
  assert.equal(options.minConfidence, 70);

  for (const bad of ["-1", "101", "abc"]) {
    assert.throws(
      () => parseCliArguments([
        "analyze",
        "--url", "https://one.test",
        "--url", "https://two.test",
        "--context", "A detailed workflow context.",
        "--min-confidence", bad,
      ]),
      /min-confidence/,
    );
  }
});

test("demo rejects replay-out because it has no bundle", () => {
  assert.throws(
    () => parseCliArguments(["demo", "--replay-out", "bundle.json"]),
    /produces no replay bundle/,
  );
});

test("analyze defers URL validation when stdin is piped", () => {
  // With a pipe and no --url, parsing succeeds; the runtime supplies URLs.
  const piped = parseCliArguments(
    ["analyze", "--context", "A detailed workflow context."],
    "json",
    true,
  );
  assert.deepEqual(piped.urls, []);
  // Without a pipe, the same arguments fail fast.
  assert.throws(
    () => parseCliArguments(
      ["analyze", "--context", "A detailed workflow context."],
      "json",
      false,
    ),
    /2–8 URLs/,
  );
});

test("timeout is parsed into a millisecond budget and range-checked", () => {
  const options = parseCliArguments([
    "analyze",
    "--url", "https://one.test",
    "--url", "https://two.test",
    "--context", "A detailed workflow context.",
    "--timeout", "120",
  ]);
  assert.equal(options.budgetMs, 120_000);
  for (const bad of ["4", "601", "abc"]) {
    assert.throws(
      () => parseCliArguments([
        "analyze",
        "--url", "https://one.test",
        "--url", "https://two.test",
        "--context", "A detailed workflow context.",
        "--timeout", bad,
      ]),
      /timeout must be between/,
    );
  }
});
