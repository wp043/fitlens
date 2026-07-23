import type { Locale } from "./i18n.ts";
import { parseAlertConditions, type WatchAlertCondition } from "./watch-alerts.ts";

export type CliOutputFormat = "json" | "markdown" | "text";

export interface CliOptions {
  command: "analyze" | "demo" | "replay" | "watch" | "doctor" | "help" | "version";
  urls: string[];
  context?: string;
  contextFile?: string;
  criteriaFile?: string;
  template: "general" | "developer-tools" | "privacy-first" | "daily-use";
  locale: Locale;
  format: CliOutputFormat;
  outputFile?: string;
  allowBundledSample: boolean;
  configFile?: string;
  outputDirectory?: string;
  force: boolean;
  doctorJson: boolean;
  checkPlaywright: boolean;
  probeProvider: boolean;
  replayFile?: string;
  /** Write the offline replay bundle for this run to a file. */
  replayOut?: string;
  /** Exit non-zero when the winner's confidence is below this percentage. */
  minConfidence?: number;
  /** Watch alert conditions, e.g. "winner,confidence,unknowns". */
  alertOn?: WatchAlertCondition[];
  /** Analysis deadline in milliseconds; overrides the default budget. */
  budgetMs?: number;
}

/** Analyze accepts 2–8 candidate URLs, whether from --url or piped stdin. */
export function validateAnalyzeUrls(urls: string[]) {
  if (urls.length < 2 || urls.length > 8) {
    throw new Error("Analyze requires 2–8 URLs (via --url or piped stdin)");
  }
}

export function parseCliArguments(
  args: string[],
  defaultFormat: CliOutputFormat = "json",
  stdinIsPipe = false,
): CliOptions {
  const base = {
    urls: [] as string[],
    locale: "en" as Locale,
    format: defaultFormat,
    template: "general" as CliOptions["template"],
    allowBundledSample: true,
    force: false,
    doctorJson: false,
    checkPlaywright: false,
    probeProvider: false,
  };
  // Version is checked before command validation so `fitlens --version` works
  // without a subcommand, the way every CLI is expected to behave.
  if (args.includes("--version") || args.includes("-v")) {
    return { command: "version", ...base };
  }
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return { command: "help", ...base };
  }
  if (
    args[0] !== "analyze" &&
    args[0] !== "demo" &&
    args[0] !== "replay" &&
    args[0] !== "watch" &&
    args[0] !== "doctor"
  ) {
    throw new Error(`Unknown command: ${args[0]}`);
  }

  const options: CliOptions = { command: args[0], ...base };
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--no-sample") {
      options.allowBundledSample = false;
      continue;
    }
    if (flag === "--force") {
      options.force = true;
      continue;
    }
    if (flag === "--json") {
      options.doctorJson = true;
      continue;
    }
    if (flag === "--check-playwright") {
      options.checkPlaywright = true;
      continue;
    }
    if (flag === "--probe-provider") {
      options.probeProvider = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    index += 1;
    switch (flag) {
      case "--url":
        options.urls.push(value);
        break;
      case "--context":
        options.context = value;
        break;
      case "--context-file":
        options.contextFile = value;
        break;
      case "--criteria":
        options.criteriaFile = value;
        break;
      case "--template":
        if (!["general", "developer-tools", "privacy-first", "daily-use"].includes(value)) {
          throw new Error("Unknown criteria template");
        }
        options.template = value as CliOptions["template"];
        break;
      case "--locale":
        if (value !== "en" && value !== "zh-CN") throw new Error("Locale must be en or zh-CN");
        options.locale = value;
        break;
      case "--format":
        if (value !== "json" && value !== "markdown" && value !== "text") {
          throw new Error("Format must be json, markdown, or text");
        }
        options.format = value;
        break;
      case "--output":
        options.outputFile = value;
        break;
      case "--config":
        options.configFile = value;
        break;
      case "--output-dir":
        options.outputDirectory = value;
        break;
      case "--bundle":
        options.replayFile = value;
        break;
      case "--replay-out":
        options.replayOut = value;
        break;
      case "--min-confidence": {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
          throw new Error("--min-confidence must be between 0 and 100");
        }
        options.minConfidence = parsed;
        break;
      }
      case "--alert-on":
        options.alertOn = parseAlertConditions(value);
        break;
      case "--timeout": {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds < 5 || seconds > 600) {
          throw new Error("--timeout must be between 5 and 600 seconds");
        }
        options.budgetMs = Math.round(seconds * 1000);
        break;
      }
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.command === "doctor") return options;
  // `demo` supplies its own URLs, context, and criteria.
  if (options.command === "demo") {
    if (options.urls.length > 0 || options.context || options.contextFile) {
      throw new Error("Demo takes no --url, --context, or --context-file");
    }
    if (options.replayOut) {
      throw new Error(
        "Demo uses a bundled sample and produces no replay bundle; use analyze",
      );
    }
    return options;
  }
  if (options.command === "replay") {
    if (!options.replayFile) throw new Error("Replay requires --bundle");
    return options;
  }
  if (options.command === "watch") {
    if (!options.configFile) throw new Error("Watch requires --config");
    options.outputDirectory ??= ".fitlens/snapshots";
    return options;
  }
  // When stdin is piped, URLs may arrive there; the count is checked at
  // runtime after the merge. Otherwise validate now for a fast, clear error.
  if (!(stdinIsPipe && options.urls.length === 0)) {
    validateAnalyzeUrls(options.urls);
  }
  if (options.context && options.contextFile) {
    throw new Error("Use either --context or --context-file, not both");
  }
  if (!options.context && !options.contextFile) {
    throw new Error("Analyze requires --context or --context-file");
  }
  return options;
}

export const cliHelp = `FitLens CLI

Usage:
  fitlens demo [--format text|markdown|json] [--locale en|zh-CN] [--output <path>]
  fitlens analyze --url <url> --url <url> --context <text> [options]
  fitlens replay --bundle <path> [--format text|markdown|json] [--output <path>]
  fitlens watch --config <path> [--output-dir <path>] [--force]
                [--alert-on winner,confidence,unknowns] [--min-confidence <n>]
  fitlens doctor [--json] [--output <path>] [--check-playwright] [--probe-provider]

Run "fitlens demo" first: it renders a complete bundled comparison report
offline, with no API key and no network access, so you can see the output
shape before configuring a provider.

Candidate URLs may also be piped, one per line:
  cat urls.txt | fitlens analyze --context "..."

Options:
  --url <url>            Product URL; repeat 2–8 times (or pipe via stdin)
  --context <text>       Workflow and decision context
  --context-file <path>  Read context from a UTF-8 file
  --criteria <path>      JSON array of 2–8 comparison criteria
  --template <name>      general, developer-tools, privacy-first, or daily-use
  --locale en|zh-CN      Output language (default: en)
  --format <name>        json, markdown, or text
                         (default: text on a terminal, json when piped)
  --output <path>        Write output to a file instead of stdout
  --replay-out <path>    Write this run's offline replay bundle to a file
  --min-confidence <n>   Exit 2 if the winner's confidence is below n (0-100)
  --timeout <seconds>    Analysis deadline, 5-600 (default 55)
  --alert-on <list>      Watch: exit 2 and write alerts.json on any of
                         winner, confidence, unknowns, any (comma-separated)
  --no-sample            Require a configured provider for bundled examples
  --bundle <path>        Replay bundle to verify and rerun offline
  --config <path>        Watchlist JSON file
  --output-dir <path>    Snapshot root (default: .fitlens/snapshots)
  --force                Run every watch entry regardless of interval
  --json                 Print doctor diagnostics as redacted JSON
  --check-playwright     Check optional Playwright and Chromium readiness
  --probe-provider       Make one authenticated GET /models health probe
  --version              Print the CLI version
  --help                 Show this help
`;
