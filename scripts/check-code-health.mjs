#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  collectProductionLineCounts,
  validateCodeHealth,
} from "./code-health-policy.mjs";

const root = process.cwd();
const baseline = JSON.parse(
  await readFile(join(root, "config", "code-health-baseline.json"), "utf8"),
);
const counts = await collectProductionLineCounts(root);
const failures = validateCodeHealth(baseline, counts);

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
