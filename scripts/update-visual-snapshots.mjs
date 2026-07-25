#!/usr/bin/env node
// Regenerate the Linux visual snapshot the e2e visual contract compares against.
// Pixel output is OS-specific, so the snapshot is pinned to Linux (matching CI).
// This runs Playwright inside the matching Linux image so a macOS/Windows
// developer can update it without a Linux machine. Requires Docker.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const pwVersion = JSON.parse(
  readFileSync(join(root, "node_modules/@playwright/test/package.json"), "utf8"),
).version;
const image = `mcr.microsoft.com/playwright:v${pwVersion}-noble`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    process.stderr.write(`\n${command} failed (exit ${result.status ?? "?"}).\n`);
    process.exit(result.status ?? 1);
  }
}

// Fail early with a clear message if Docker is missing.
if (spawnSync("docker", ["--version"], { stdio: "ignore" }).status !== 0) {
  process.stderr.write(
    "Docker is required to regenerate the Linux snapshot. Install Docker and retry.\n",
  );
  process.exit(1);
}

// Copy the working tree (minus platform-specific and heavy dirs) so the
// container installs its own Linux node_modules without touching the host's.
const work = mkdtempSync(join(tmpdir(), "fitlens-snap-"));
process.stderr.write(`Staging working tree in ${work} …\n`);
const skip = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "test-results",
  ".pnpm-store",
  ".worktrees",
]);
cpSync(root, work, {
  recursive: true,
  filter: (src) => !skip.has(src.slice(root.length + 1).split("/")[0] || ""),
});

process.stderr.write(`Regenerating in ${image} …\n`);
run("docker", [
  "run",
  "--rm",
  "-v",
  `${work}:/work`,
  "-w",
  "/work",
  "-e",
  "CI=1",
  image,
  "bash",
  "-c",
  "corepack enable pnpm && pnpm install --frozen-lockfile && " +
    "pnpm exec playwright test e2e/workflows.spec.ts --update-snapshots=all",
]);

cpSync(
  join(work, "e2e/__screenshots__/linux/home.png"),
  join(root, "e2e/__screenshots__/linux/home.png"),
);
rmSync(work, { recursive: true, force: true });
process.stderr.write(
  "\nUpdated e2e/__screenshots__/linux/home.png. Commit it with your UI change.\n",
);
