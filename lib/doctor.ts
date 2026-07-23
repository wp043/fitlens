import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  modelProviderCanRun,
  resolveModelProviderConfig,
} from "./model-provider.ts";

export type DoctorStatus = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  summary: string;
  detail?: string;
}

export interface DoctorReport {
  schemaVersion: 1;
  generatedAt: string;
  healthy: boolean;
  system: {
    platform: NodeJS.Platform;
    architecture: string;
    projectDirectory: string;
  };
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  nodeVersion?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  now?: () => Date;
  checkPlaywright?: boolean;
  probeProvider?: boolean;
  command?: (file: string, args: string[]) => Promise<string>;
  fetch?: typeof globalThis.fetch;
  inspectPlaywright?: () => Promise<{ installed: boolean; browserReady: boolean }>;
}

const MINIMUM_NODE = [20, 18, 1] as const;

function numericVersion(value: string): number[] | null {
  const match = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

export function versionAtLeast(value: string, minimum: readonly number[]) {
  const parsed = numericVersion(value);
  if (!parsed) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (parsed[index] > minimum[index]) return true;
    if (parsed[index] < minimum[index]) return false;
  }
  return true;
}

function pnpmFromUserAgent(value: string | undefined) {
  return value?.match(/(?:^|\s)pnpm\/(\d+\.\d+\.\d+)/)?.[1];
}

async function defaultCommand(file: string, args: string[]) {
  const result = await promisify(execFile)(file, args, {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  return result.stdout.trim();
}

async function defaultPlaywrightInspection() {
  const require = createRequire(import.meta.url);
  try {
    require.resolve("playwright/package.json");
    const { chromium } = await import("playwright");
    await access(chromium.executablePath());
    return { installed: true, browserReady: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { installed: code !== "MODULE_NOT_FOUND", browserReady: false };
  }
}

function safeEndpoint(baseURL: string) {
  const url = new URL(baseURL);
  return `${url.protocol}//${url.host}${url.pathname}`;
}

/** Remove secrets and user-home paths from diagnostics before serialization. */
export function redactDiagnostics<T>(
  value: T,
  env: Record<string, string | undefined> = process.env,
): T {
  const secrets = Object.entries(env)
    .filter(([key, secret]) =>
      Boolean(secret) && /(?:KEY|TOKEN|SECRET|PASSWORD|AUTH|COOKIE)/i.test(key),
    )
    .map(([, secret]) => secret!)
    .filter((secret) => secret.length >= 4)
    .sort((left, right) => right.length - left.length);
  const home = env.HOME || env.USERPROFILE;

  const redactString = (input: string) => {
    let output = input;
    for (const secret of secrets) output = output.split(secret).join("<redacted>");
    if (home) output = output.split(home).join("<home>");
    return output
      .replace(/Bearer\s+[^\s,;]+/gi, "Bearer <redacted>")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "<redacted>")
      .replace(/([?&](?:key|token|secret|password)=)[^&#\s]+/gi, "$1<redacted>");
  };

  const visit = (item: unknown): unknown => {
    if (typeof item === "string") return redactString(item);
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item).map(([key, nested]) => [
          key,
          /(?:key|token|secret|password|authorization|cookie)/i.test(key)
            ? "<redacted>"
            : visit(nested),
        ]),
      );
    }
    return item;
  };
  return visit(value) as T;
}

async function providerProbe(
  baseURL: string,
  apiKey: string | undefined,
  fetchImplementation: typeof globalThis.fetch,
  kind: string,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  // Anthropic authenticates with x-api-key and requires a version header;
  // OpenAI and compatible endpoints use a Bearer token.
  const headers: Record<string, string> = apiKey
    ? kind === "anthropic"
      ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${apiKey}` }
    : {};
  try {
    const response = await fetchImplementation(`${baseURL.replace(/\/$/, "")}/models`, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers,
    });
    return response.status;
  } finally {
    clearTimeout(timer);
  }
}

export async function createDoctorReport(
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const command = options.command ?? defaultCommand;
  const checks: DoctorCheck[] = [];
  const nodeVersion = options.nodeVersion ?? process.version;

  checks.push(
    versionAtLeast(nodeVersion, MINIMUM_NODE)
      ? { id: "node", status: "pass", summary: `Node ${nodeVersion.replace(/^v/, "")} is supported.` }
      : { id: "node", status: "fail", summary: `Node ${nodeVersion.replace(/^v/, "")} is unsupported.`, detail: "Install Node 20.18.1 or newer." },
  );

  let pnpmVersion = pnpmFromUserAgent(env.npm_config_user_agent);
  try {
    pnpmVersion ||= await command(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--version"]);
  } catch {
    // The user-agent still identifies pnpm when this command itself was run by pnpm.
  }
  checks.push(
    pnpmVersion?.startsWith("10.")
      ? { id: "pnpm", status: "pass", summary: `pnpm ${pnpmVersion} matches the supported major.` }
      : pnpmVersion
        ? { id: "pnpm", status: "fail", summary: `pnpm ${pnpmVersion} is unsupported.`, detail: "Use pnpm 10 (the packageManager version is pinned in package.json)." }
        : { id: "pnpm", status: "fail", summary: "pnpm was not found.", detail: "Enable Corepack or install pnpm 10." },
  );

  try {
    const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as { name?: string };
    checks.push(
      manifest.name === "fitlens"
        ? { id: "project", status: "pass", summary: "FitLens project files are readable." }
        : { id: "project", status: "fail", summary: "The current directory is not a FitLens checkout." },
    );
  } catch {
    checks.push({ id: "project", status: "fail", summary: "package.json is missing or unreadable." });
  }

  if (env.FITLENS_DISABLE_LIVE_ANALYSIS === "1") {
    checks.push({ id: "provider", status: "warn", summary: "Live analysis is explicitly disabled.", detail: "Unset FITLENS_DISABLE_LIVE_ANALYSIS to use a model provider." });
  } else {
    try {
      const provider = resolveModelProviderConfig(env);
      const configured = modelProviderCanRun(provider);
      checks.push({
        id: "provider",
        status: configured ? "pass" : "warn",
        summary: configured
          ? `${provider.kind} provider is configured for model ${provider.model}.`
          : `${provider.kind} provider has no usable credentials.`,
        detail: provider.baseURL ? `Endpoint: ${safeEndpoint(provider.baseURL)}` : undefined,
      });
      if (options.probeProvider) {
        const baseURL =
          provider.baseURL ??
          (provider.kind === "anthropic"
            ? "https://api.anthropic.com/v1"
            : "https://api.openai.com/v1");
        if (!configured) {
          checks.push({ id: "provider-endpoint", status: "skip", summary: "Provider probe skipped because credentials are unavailable." });
        } else {
          try {
            const status = await providerProbe(baseURL, provider.apiKey, options.fetch ?? globalThis.fetch, provider.kind);
            checks.push({
              id: "provider-endpoint",
              status: status >= 200 && status < 300 ? "pass" : "fail",
              summary: status >= 200 && status < 300
                ? `Provider endpoint responded successfully (${status}).`
                : `Provider endpoint rejected the probe (${status}).`,
            });
          } catch (error) {
            checks.push({
              id: "provider-endpoint",
              status: "fail",
              summary: "Provider endpoint could not be reached.",
              detail: error instanceof Error ? error.message : "Unknown connection error",
            });
          }
        }
      }
    } catch (error) {
      checks.push({
        id: "provider",
        status: "fail",
        summary: "Provider configuration is invalid.",
        detail: error instanceof Error ? error.message : "Unknown configuration error",
      });
    }
  }

  if (options.checkPlaywright) {
    const playwright = await (options.inspectPlaywright ?? defaultPlaywrightInspection)();
    checks.push(
      playwright.browserReady
        ? { id: "playwright", status: "pass", summary: "Playwright and Chromium are ready." }
        : playwright.installed
          ? { id: "playwright", status: "warn", summary: "Playwright is installed but Chromium is unavailable.", detail: "Run: pnpm exec playwright install chromium" }
          : { id: "playwright", status: "warn", summary: "Optional Playwright runtime is not installed." },
    );
  } else {
    checks.push({ id: "playwright", status: "skip", summary: "Optional browser check was not requested.", detail: "Run doctor with --check-playwright to inspect Chromium readiness." });
  }

  return redactDiagnostics({
    schemaVersion: 1,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    healthy: !checks.some((check) => check.status === "fail"),
    system: {
      platform: options.platform ?? process.platform,
      architecture: options.architecture ?? process.arch,
      projectDirectory: basename(cwd),
    },
    checks,
  }, env);
}

export function formatDoctorReport(report: DoctorReport) {
  const icon: Record<DoctorStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" };
  const lines = [
    `FitLens doctor: ${report.healthy ? "healthy" : "issues found"}`,
    `Platform: ${report.system.platform}/${report.system.architecture}`,
    "",
  ];
  for (const check of report.checks) {
    lines.push(`[${icon[check.status]}] ${check.summary}`);
    if (check.detail) lines.push(`       ${check.detail}`);
  }
  return `${lines.join("\n")}\n`;
}
