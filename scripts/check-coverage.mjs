#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const thresholds = { lines: 100, branches: 90, functions: 100 };
const child = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "--experimental-test-coverage",
    "test/workbench-state.test.ts",
  ],
  { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
);
process.stdout.write(child.stdout ?? "");
process.stderr.write(child.stderr ?? "");

if (child.status !== 0) {
  process.exitCode = child.status ?? 1;
} else {
  // Anchor on the row separator so `workbench-state.test.ts` can never match,
  // and capture the uncovered-lines column so a regression names its lines.
  const match = child.stdout.match(
    /[\s|]workbench-state\.ts\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|([^\n]*)/,
  );
  if (!match) {
    process.stderr.write(
      "Coverage ratchet failed: workbench-state.ts was absent from Node's coverage report.\n",
    );
    process.exitCode = 1;
  } else {
    const actual = {
      lines: Number(match[1]),
      branches: Number(match[2]),
      functions: Number(match[3]),
    };
    const failures = Object.entries(thresholds)
      .filter(([metric, minimum]) => actual[metric] < minimum)
      .map(([metric, minimum]) => `${metric} ${actual[metric]}% < ${minimum}%`);
    if (failures.length > 0) {
      const uncovered = match[4].trim();
      process.stderr.write(
        `Coverage ratchet failed: ${failures.join(", ")}\n` +
          `  file: lib/workbench-state.ts\n` +
          `  uncovered lines: ${uncovered === "" ? "(none reported)" : uncovered}\n` +
          `  node: ${process.version}\n` +
          "  If the uncovered lines are non-executable (a closing brace or a\n" +
          "  multi-line signature), this is V8/tsx line attribution drift rather\n" +
          "  than a real coverage gap. Reproduce on the CI Node version before\n" +
          "  changing thresholds.\n",
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `Coverage ratchet passed: ${actual.lines}% lines, ${actual.branches}% branches, ${actual.functions}% functions.\n`,
      );
    }
  }
}
