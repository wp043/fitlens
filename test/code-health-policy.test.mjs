import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  collectProductionLineCounts,
  validateCodeHealth,
} from "../scripts/code-health-policy.mjs";

function baseline(maxLines) {
  return {
    defaultMaxLines: 3,
    exceptions: {
      "components/legacy.ts": {
        maxLines,
        previousLines: 8,
        reason: "Temporary legacy fixture.",
      },
    },
  };
}

async function fixture(lines) {
  const root = await mkdtemp(join(tmpdir(), "fitlens-code-health-"));
  await mkdir(join(root, "components"));
  await writeFile(
    join(root, "components", "legacy.ts"),
    `${Array.from({ length: lines }, (_, index) => `line ${index}`).join("\n")}\n`,
  );
  return root;
}

test("an exception passes only at its exact recorded line baseline", async () => {
  const root = await fixture(5);
  try {
    const counts = await collectProductionLineCounts(root, ["components"]);
    assert.deepEqual(validateCodeHealth(baseline(5), counts), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a smaller exception fails with an actionable baseline reduction", async () => {
  const root = await fixture(4);
  try {
    const counts = await collectProductionLineCounts(root, ["components"]);
    assert.match(
      validateCodeHealth(baseline(5), counts).join("\n"),
      /shrank.*lower maxLines to 4/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a larger exception fails as baseline growth", async () => {
  const root = await fixture(6);
  try {
    const counts = await collectProductionLineCounts(root, ["components"]);
    assert.match(
      validateCodeHealth(baseline(5), counts).join("\n"),
      /grew.*baseline to 6/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
