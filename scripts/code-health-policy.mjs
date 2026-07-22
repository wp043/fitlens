import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const productionRoots = ["app", "components", "lib", "scripts"];

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

export async function collectProductionLineCounts(
  root,
  directories = productionRoots,
) {
  const files = (
    await Promise.all(
      directories.map((directory) => productionFiles(join(root, directory))),
    )
  ).flat();
  const counts = new Map();
  for (const file of files) {
    const name = relative(root, file).split(sep).join("/");
    counts.set(name, lineCount(await readFile(file, "utf8")));
  }
  return counts;
}

export function validateCodeHealth(baseline, counts) {
  const failures = [];
  for (const [file, lines] of counts) {
    if (!baseline.exceptions[file] && lines > baseline.defaultMaxLines) {
      failures.push(
        `${file}: ${lines} lines exceeds the default ${baseline.defaultMaxLines}`,
      );
    }
  }
  for (const [file, exception] of Object.entries(baseline.exceptions)) {
    const lines = counts.get(file);
    if (lines === undefined) {
      failures.push(
        `${file}: stale exception references a missing production file`,
      );
      continue;
    }
    if (lines > exception.maxLines) {
      failures.push(
        `${file}: grew from the ${exception.maxLines}-line baseline to ${lines}; extract ownership before adding code`,
      );
    } else if (lines < exception.maxLines) {
      const action =
        lines <= baseline.defaultMaxLines
          ? "remove the now-stale exception"
          : `lower maxLines to ${lines}`;
      failures.push(
        `${file}: shrank from the ${exception.maxLines}-line baseline to ${lines}; ${action} so it cannot regrow`,
      );
    }
    if (
      exception.previousLines !== undefined &&
      exception.previousLines <= exception.maxLines
    ) {
      failures.push(
        `${file}: previousLines must prove a real reduction above maxLines`,
      );
    }
    if (!exception.reason?.trim())
      failures.push(`${file}: exception needs a reason`);
  }
  return failures;
}
