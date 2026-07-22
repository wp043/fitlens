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
  dueWatchEntries,
  markWatchEntryRun,
  parseWatchlist,
  snapshotFilename,
} from "../lib/watchlist.ts";

async function writeJsonAtomic(path: string, value: unknown) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function runWatchlist(options: ReturnType<typeof parseCliArguments>) {
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
        { env: process.env },
      );
      const capturedAt = result.generatedAt;
      const snapshot = {
        schemaVersion: 1,
        watchId: entry.id,
        capturedAt,
        result,
      };
      const directory = resolve(options.outputDirectory!, entry.id);
      await mkdir(directory, { recursive: true });
      await writeJsonAtomic(join(directory, snapshotFilename(capturedAt)), snapshot);
      await writeJsonAtomic(join(directory, "latest.json"), snapshot);
      watchlist = markWatchEntryRun(watchlist, entry.id, capturedAt);
      await mkdir(dirname(configPath), { recursive: true });
      await writeJsonAtomic(configPath, watchlist);
      process.stdout.write(`refreshed ${entry.id} -> ${directory}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(
        `watch ${entry.id} failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
      );
    }
  }
  if (failures > 0) process.exitCode = 1;
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(cliHelp);
    return;
  }
  if (options.command === "watch") {
    await runWatchlist(options);
    return;
  }

  const context = options.contextFile
    ? await readFile(resolve(options.contextFile), "utf8")
    : options.context!;
  const criteria = options.criteriaFile
    ? JSON.parse(await readFile(resolve(options.criteriaFile), "utf8"))
    : getBuiltInCriteriaTemplates(options.locale).find(
        (template) => template.id === options.template,
      )!.criteria;
  const result = await runAnalysis(
    { urls: options.urls, context, criteria, locale: options.locale },
    { env: process.env, allowBundledSample: options.allowBundledSample },
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
