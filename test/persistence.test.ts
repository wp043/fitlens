import assert from "node:assert/strict";
import test from "node:test";
import {
  loadMigratedValue,
  persistValue,
  type AsyncValueStore,
} from "../lib/persistence.ts";

function stores(primaryValues = new Map<string, unknown>()) {
  const fallbackValues = new Map<string, string>();
  const primary: AsyncValueStore = {
    async get(key) { return primaryValues.get(key); },
    async set(key, value) { primaryValues.set(key, value); },
    async delete(key) { primaryValues.delete(key); },
  };
  const fallback = {
    getItem: (key: string) => fallbackValues.get(key) ?? null,
    setItem: (key: string, value: string) => { fallbackValues.set(key, value); },
    removeItem: (key: string) => { fallbackValues.delete(key); },
  };
  return { primary, primaryValues, fallback, fallbackValues };
}

test("migrates a normalized legacy value only after the primary write succeeds", async () => {
  const storage = stores();
  storage.fallbackValues.set("reports", JSON.stringify([{ id: "one" }]));
  const value = await loadMigratedValue(
    storage.primary,
    storage.fallback,
    "reports",
    (input) => input as { id: string }[],
  );

  assert.deepEqual(value, [{ id: "one" }]);
  assert.deepEqual(storage.primaryValues.get("reports"), [{ id: "one" }]);
  assert.equal(storage.fallbackValues.has("reports"), false);
});

test("keeps the recoverable legacy copy when primary migration fails", async () => {
  const storage = stores();
  storage.fallbackValues.set("reports", JSON.stringify(["safe-copy"]));
  storage.primary.set = async () => { throw new Error("blocked"); };

  const value = await loadMigratedValue(
    storage.primary,
    storage.fallback,
    "reports",
    (input) => input as string[],
  );
  assert.deepEqual(value, ["safe-copy"]);
  assert.equal(storage.fallbackValues.has("reports"), true);
});

test("falls back to JSON storage when a primary write fails", async () => {
  const storage = stores();
  storage.primary.set = async () => { throw new Error("quota"); };
  await persistValue(storage.primary, storage.fallback, "inbox", [{ id: "one" }]);
  assert.equal(storage.fallbackValues.get("inbox"), '[{"id":"one"}]');
});
