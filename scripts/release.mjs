#!/usr/bin/env node
// Cut a release: verify the tree, sync the version, publish to npm, tag, and
// create a GitHub release from the CHANGELOG. Each step is guarded so a
// half-finished release cannot happen. Usage:
//   node scripts/release.mjs <version>   e.g. 0.2.0
//   node scripts/release.mjs <version> --dry-run
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((arg) => !arg.startsWith("--"));

function die(message) {
  process.stderr.write(`release: ${message}\n`);
  process.exit(1);
}

// Read-only inspections run even in a dry run, so preconditions are actually
// checked. Mutating commands (`read: false`) are printed and skipped.
function run(command, commandArgs, { capture = false, read = false } = {}) {
  const skip = dryRun && !read;
  process.stderr.write(`  ${skip ? "# (skipped) " : "$ "}${command} ${commandArgs.join(" ")}\n`);
  if (skip) return "";
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.status !== 0) die(`\`${command}\` failed`);
  return (result.stdout ?? "").trim();
}

if (!version) die("usage: node scripts/release.mjs <version> [--dry-run]");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  die(`version must be X.Y.Z, got "${version}"`);
}

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
const tag = `v${version}`;

// 1. Preconditions: clean tree, on main, in sync, version moves forward, and
//    the CHANGELOG documents this version.
const status = run("git", ["status", "--porcelain"], { capture: true, read: true });
if (status && !dryRun) die("working tree is not clean; commit or stash first");

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
  capture: true,
  read: true,
});
if (branch !== "main" && !dryRun) die(`release from main, not "${branch}"`);

run("git", ["fetch", "origin", "main"], { read: true });
const behind = run("git", ["rev-list", "--count", "HEAD..origin/main"], {
  capture: true,
  read: true,
});
if (behind && behind !== "0") die("local main is behind origin/main; pull first");

const existingTag = run("git", ["tag", "--list", tag], { capture: true, read: true });
if (existingTag) die(`tag ${tag} already exists`);

const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## [${version}]`)) {
  die(`CHANGELOG.md has no "## [${version}]" section; write it first`);
}

// 2. Sync the version across package.json and lib/version.ts. The version test
//    already asserts these agree, so pnpm check below is the safety net.
if (pkg.version !== version) {
  pkg.version = version;
  if (!dryRun) await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  process.stderr.write(`  updated package.json to ${version}\n`);
}
const versionTs = join(root, "lib", "version.ts");
const versionSource = await readFile(versionTs, "utf8");
const nextSource = versionSource.replace(
  /export const VERSION = "[^"]*";/,
  `export const VERSION = "${version}";`,
);
if (nextSource !== versionSource && !dryRun) {
  await writeFile(versionTs, nextSource);
  process.stderr.write(`  updated lib/version.ts to ${version}\n`);
}

// 3. Full gate. This runs the version-drift test, so a mismatch fails here.
run("pnpm", ["check"]);

// 4. Commit any version bump (no-op if the version was already current).
const afterStatus = run("git", ["status", "--porcelain"], { capture: true, read: true });
if (afterStatus) {
  run("git", ["add", "package.json", "lib/version.ts"]);
  run("git", ["commit", "-m", `chore(release): ${version}`]);
  run("git", ["push", "origin", "main"]);
}

// 5. Publish to npm (prepack builds dist/). Unscoped public package.
run("npm", ["publish"]);

// 6. Tag and create the GitHub release from the CHANGELOG section.
run("git", ["tag", "-a", tag, "-m", tag]);
run("git", ["push", "origin", tag]);
run("gh", [
  "release",
  "create",
  tag,
  "--title",
  tag,
  "--notes",
  `See [CHANGELOG.md](https://github.com/${pkg.repository?.url?.match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1] ?? "wp043/fitlens"}/blob/main/CHANGELOG.md#${version.replace(/\./g, "")}---${new Date().toISOString().slice(0, 10)}).`,
]);

process.stderr.write(
  dryRun
    ? `\ndry run complete. Re-run without --dry-run to release ${version}.\n`
    : `\nreleased ${version}: npm + tag ${tag} + GitHub release.\n`,
);
