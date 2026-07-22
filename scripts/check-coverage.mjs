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
  const match = child.stdout.match(
    /workbench-state\.ts\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/,
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
      process.stderr.write(`Coverage ratchet failed: ${failures.join(", ")}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `Coverage ratchet passed: ${actual.lines}% lines, ${actual.branches}% branches, ${actual.functions}% functions.\n`,
      );
    }
  }
}
