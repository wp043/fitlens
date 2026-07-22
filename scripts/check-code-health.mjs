#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const baselinePath = join(root, "config", "code-health-baseline.json");
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const productionRoots = ["app", "components", "lib", "scripts"];

async function productionFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return productionFiles(path);
      return /\.(?:ts|tsx|mjs)$/.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

function lineCount(content) {
  if (!content) return 0;
  const lines = content.split(/\r?\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

const files = (
  await Promise.all(
    productionRoots.map((directory) => productionFiles(join(root, directory))),
  )
).flat();
const counts = new Map();
for (const file of files) {
  const name = relative(root, file).split(sep).join("/");
  counts.set(name, lineCount(await readFile(file, "utf8")));
}

const failures = [];
for (const [file, lines] of counts) {
  const exception = baseline.exceptions[file];
  const limit = exception?.maxLines ?? baseline.defaultMaxLines;
  if (lines > limit) failures.push(`${file}: ${lines} lines exceeds ${limit}`);
  if (
    exception?.previousLines !== undefined &&
    exception.previousLines <= exception.maxLines
  ) {
    failures.push(
      `${file}: previousLines must prove a real reduction above maxLines`,
    );
  }
}
for (const [file, exception] of Object.entries(baseline.exceptions)) {
  const lines = counts.get(file);
  if (lines === undefined)
    failures.push(
      `${file}: stale exception references a missing production file`,
    );
  else if (lines <= baseline.defaultMaxLines)
    failures.push(
      `${file}: remove its stale exception (${lines} <= ${baseline.defaultMaxLines})`,
    );
  if (!exception.reason?.trim())
    failures.push(`${file}: exception needs a reason`);
}

if (failures.length > 0) {
  process.stderr.write(
    `Code-health ratchet failed:\n- ${failures.join("\n- ")}\n`,
  );
  process.exitCode = 1;
} else {
  const workbench = counts.get("components/compare-workbench.tsx");
  process.stdout.write(
    `Code-health ratchet passed: ${counts.size} production files; default ${baseline.defaultMaxLines} lines; workbench ${workbench} lines.\n`,
  );
}
