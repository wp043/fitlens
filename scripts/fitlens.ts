#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { parseCliArguments, cliHelp } from "../lib/cli.ts";
import { getBuiltInCriteriaTemplates } from "../lib/criteria.ts";
import { comparisonToMarkdown } from "../lib/markdown-report.ts";
import {
  CandidateSourceCollectionError,
  MissingModelCredentialsError,
  runAnalysis,
} from "../lib/analysis-service.ts";
import {
  ModelProviderConfigError,
  ModelProviderRequestError,
} from "../lib/model-provider.ts";
import {
  appendWatchTrend,
  createWatchTrendPoint,
  dueWatchEntries,
  markWatchEntryRun,
  parseWatchlist,
  renderWatchTrendHtml,
  snapshotFilename,
  type WatchTrend,
} from "../lib/watchlist.ts";
import { compareResults, type ComparisonDiff } from "../lib/diff.ts";
import { sendLocalNotification } from "../lib/local-notifications.ts";
import type { ComparisonResult } from "../lib/types.ts";
import { createDoctorReport, formatDoctorReport } from "../lib/doctor.ts";
import { parseReplayBundle, replayAnalysisBundle } from "../lib/reproducibility.ts";

async function writeJsonAtomic(path: string, value: unknown) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function writeTextAtomic(path: string, value: string) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, path);
}

async function readJsonIfPresent<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

function watchNotificationMessage(
  entryId: string,
  result: ComparisonResult,
  change?: ComparisonDiff,
) {
  if (!change) return `${entryId}: first snapshot captured; winner ${result.recommendation.winner}.`;
  if (change.winnerChanged) {
    return `${entryId}: winner changed from ${change.previousWinner ?? "unknown"} to ${change.currentWinner ?? "unknown"}.`;
  }
  const scoreChanges = change.scoreChanges.filter((item) => item.delta !== 0).length;
  return `${entryId}: ${scoreChanges} score changes, ${change.dimensionChanges.length} dimension changes, ${change.addedUnknowns.length} new unknowns.`;
}

async function runWatchlist(
  options: ReturnType<typeof parseCliArguments>,
  signal: AbortSignal,
) {
  const configPath = resolve(options.configFile!);
  let watchlist = parseWatchlist(JSON.parse(await readFile(configPath, "utf8")));
  const entries = options.force ? watchlist.entries : dueWatchEntries(watchlist);
  if (entries.length === 0) {
    process.stdout.write("No watch entries are due.\n");
    return;
  }
  let failures = 0;
  for (const entry of entries) {
    try {
      const criteria =
        entry.criteria ??
        getBuiltInCriteriaTemplates(entry.locale).find(
          (template) => template.id === entry.template,
        )!.criteria;
      const result = await runAnalysis(
        {
          urls: entry.urls,
          context: entry.context,
          criteria,
          locale: entry.locale,
        },
        { env: process.env, signal },
      );
      const capturedAt = result.generatedAt;
      const directory = resolve(options.outputDirectory!, entry.id);
      await mkdir(directory, { recursive: true });
      const previousSnapshot = await readJsonIfPresent<{
        result?: ComparisonResult;
      }>(join(directory, "latest.json"));
      const previousResult = previousSnapshot?.result;
      const change = previousResult
        ? compareResults(previousResult, result, criteria)
        : undefined;
      const snapshot = {
        schemaVersion: 1,
        watchId: entry.id,
        capturedAt,
        result,
        change,
      };
      await writeJsonAtomic(join(directory, snapshotFilename(capturedAt)), snapshot);
      await writeJsonAtomic(join(directory, "latest.json"), snapshot);
      const existingTrend = await readJsonIfPresent<WatchTrend>(
        join(directory, "trend.json"),
      );
      const trend = appendWatchTrend(
        existingTrend,
        entry.id,
        createWatchTrendPoint(result, criteria),
      );
      await writeJsonAtomic(join(directory, "trend.json"), trend);
      await writeTextAtomic(join(directory, "trend.html"), renderWatchTrendHtml(trend));
      watchlist = markWatchEntryRun(watchlist, entry.id, capturedAt);
      await mkdir(dirname(configPath), { recursive: true });
      await writeJsonAtomic(configPath, watchlist);
      process.stdout.write(`refreshed ${entry.id} -> ${directory}\n`);
      const shouldNotify =
        entry.notifications === "always" ||
        (entry.notifications === "changes" && Boolean(change?.hasChanges));
      if (shouldNotify) {
        try {
          await sendLocalNotification(
            "FitLens watch updated",
            watchNotificationMessage(entry.id, result, change),
          );
        } catch (notificationError) {
          process.stderr.write(
            `watch ${entry.id} notification unavailable: ${notificationError instanceof Error ? notificationError.message : "unknown error"}\n`,
          );
        }
      }
    } catch (error) {
      failures += 1;
      process.stderr.write(
        `watch ${entry.id} failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
      );
    }
  }
  if (failures > 0) process.exitCode = 1;
}

/**
 * Inputs the bundled sample recognizes. Keep in sync with
 * `isBundledSampleRequest` in lib/analysis-service.ts.
 */
const DEMO_URLS = ["https://cmux.com", "https://otty.sh"];
const DEMO_CONTEXT =
  "Evaluating terminal-first coding agents for a small team that runs several " +
  "agents in parallel and cares about openness and automation.";

async function main() {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const options = parseCliArguments(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(cliHelp);
    return;
  }
  if (options.command === "watch") {
    await runWatchlist(options, controller.signal);
    return;
  }
  if (options.command === "doctor") {
    const report = await createDoctorReport({
      checkPlaywright: options.checkPlaywright,
      probeProvider: options.probeProvider,
    });
    const output = options.doctorJson
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatDoctorReport(report);
    if (options.outputFile) {
      const outputPath = resolve(options.outputFile);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, output, "utf8");
      process.stdout.write(`Redacted diagnostics written to ${outputPath}\n`);
    } else {
      process.stdout.write(output);
    }
    if (!report.healthy) process.exitCode = 1;
    return;
  }

  if (options.command === "replay") {
    const bundle = parseReplayBundle(await readFile(resolve(options.replayFile!), "utf8"));
    const result = replayAnalysisBundle(bundle);
    const output = options.format === "markdown"
      ? comparisonToMarkdown(result)
      : `${JSON.stringify(result, null, 2)}\n`;
    if (options.outputFile) {
      await writeFile(resolve(options.outputFile), output, "utf8");
    } else {
      process.stdout.write(output);
    }
    return;
  }

  // `demo` is the zero-configuration entry point. It pins the inputs that the
  // bundled sample recognizes so the report renders offline without a
  // provider, and it hides any ambient credentials so the output stays
  // identical on a configured machine.
  const demo = options.command === "demo";
  const context = demo
    ? DEMO_CONTEXT
    : options.contextFile
      ? await readFile(resolve(options.contextFile), "utf8")
      : options.context!;
  const criteria = demo
    ? getBuiltInCriteriaTemplates(options.locale).find(
        (template) => template.id === "developer-tools",
      )!.criteria
    : options.criteriaFile
      ? JSON.parse(await readFile(resolve(options.criteriaFile), "utf8"))
      : getBuiltInCriteriaTemplates(options.locale).find(
          (template) => template.id === options.template,
        )!.criteria;
  const result = await runAnalysis(
    {
      urls: demo ? DEMO_URLS : options.urls,
      context,
      criteria,
      locale: options.locale,
    },
    {
      env: demo ? {} : process.env,
      allowBundledSample: demo ? true : options.allowBundledSample,
      signal: controller.signal,
    },
  );
  const output =
    options.format === "markdown"
      ? comparisonToMarkdown(result)
      : `${JSON.stringify(result, null, 2)}\n`;
  if (options.outputFile) {
    await writeFile(resolve(options.outputFile), output, "utf8");
  } else {
    process.stdout.write(output);
  }
}

main().catch((error: unknown) => {
  if (error instanceof CandidateSourceCollectionError) {
    for (const failure of error.failures) {
      process.stderr.write(`source error [${failure.code}] ${failure.url}\n`);
    }
  } else if (error instanceof MissingModelCredentialsError) {
    process.stderr.write("No model credentials configured. Set OPENAI_API_KEY or a compatible provider.\n");
  } else if (error instanceof ModelProviderConfigError || error instanceof ModelProviderRequestError) {
    process.stderr.write(`provider error: ${error.code}\n`);
  } else if (error instanceof z.ZodError) {
    process.stderr.write(`invalid input: ${error.issues.map((issue) => issue.message).join("; ")}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : "FitLens CLI failed"}\n`);
  }
  process.exitCode = 1;
});
