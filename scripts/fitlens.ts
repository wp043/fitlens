#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(cliHelp);
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
