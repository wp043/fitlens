import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { VERSION } from "../lib/version.ts";

test("the exported version matches package.json", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    VERSION,
    pkg.version,
    "lib/version.ts drifted from package.json; update both together",
  );
});
