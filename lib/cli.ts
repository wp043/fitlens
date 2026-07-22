import type { Locale } from "./i18n.ts";

export type CliOutputFormat = "json" | "markdown";

export interface CliOptions {
  command: "analyze" | "watch" | "help";
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
}

export function parseCliArguments(args: string[]): CliOptions {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return {
      command: "help",
      urls: [],
      locale: "en",
      format: "json",
      template: "general",
      allowBundledSample: true,
      force: false,
    };
  }
  if (args[0] !== "analyze" && args[0] !== "watch") {
    throw new Error(`Unknown command: ${args[0]}`);
  }

  const options: CliOptions = {
    command: args[0],
    urls: [],
    locale: "en",
    format: "json",
    template: "general",
    allowBundledSample: true,
    force: false,
  };
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
        if (value !== "json" && value !== "markdown") throw new Error("Format must be json or markdown");
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
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (options.command === "watch") {
    if (!options.configFile) throw new Error("Watch requires --config");
    options.outputDirectory ??= ".fitlens/snapshots";
    return options;
  }
  if (options.urls.length < 2 || options.urls.length > 8) {
    throw new Error("Analyze requires 2–8 --url values");
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
  pnpm fitlens analyze --url <url> --url <url> --context <text> [options]
  pnpm fitlens watch --config <path> [--output-dir <path>] [--force]

Options:
  --url <url>            Product URL; repeat 2–8 times
  --context <text>       Workflow and decision context
  --context-file <path>  Read context from a UTF-8 file
  --criteria <path>      JSON array of 2–8 comparison criteria
  --template <name>      general, developer-tools, privacy-first, or daily-use
  --locale en|zh-CN      Output language (default: en)
  --format json|markdown Output format (default: json)
  --output <path>        Write output to a file instead of stdout
  --no-sample            Require a configured provider for bundled examples
  --config <path>        Watchlist JSON file
  --output-dir <path>    Snapshot root (default: .fitlens/snapshots)
  --force                Run every watch entry regardless of interval
  --help                 Show this help
`;
