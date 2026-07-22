import assert from "node:assert/strict";
import test from "node:test";
import {
  captureCandidates,
  filterCandidates,
  normalizeCandidateInbox,
} from "../lib/candidate-inbox.ts";

test("captures, canonicalizes, and deduplicates pasted candidate URLs", () => {
  let id = 0;
  const captured = captureCandidates(
    [],
    "https://Example.com/?utm_source=x#hero\nhttps://example.com/ ftp://bad.test",
    () => `candidate-${++id}`,
    new Date("2026-07-21T12:00:00.000Z"),
  );

  assert.equal(captured.added, 1);
  assert.equal(captured.duplicates, 1);
  assert.equal(captured.invalid, 1);
  assert.equal(captured.items[0].url, "https://example.com/");
  assert.equal(captured.items[0].name, "example");
});

test("normalizes stored candidates and drops malformed records", () => {
  const items = normalizeCandidateInbox([
    {
      id: "one",
      url: "https://tool.test/#top",
      name: "Tool",
      addedAt: "2026-07-21T12:00:00.000Z",
      tags: ["terminal", 42],
    },
    { id: "bad", url: "javascript:alert(1)", name: "Bad", addedAt: "now" },
  ]);

  assert.equal(items.length, 1);
  assert.deepEqual(items[0].tags, ["terminal"]);
  assert.equal(items[0].archived, false);
});

test("filters active candidates across names, notes, URLs, and tags", () => {
  const items = normalizeCandidateInbox([
    {
      id: "one",
      url: "https://terminal.test/",
      name: "Terminal",
      note: "Try on macOS",
      tags: ["agent"],
      addedAt: "2026-07-21T12:00:00.000Z",
      archived: false,
    },
    {
      id: "two",
      url: "https://archived.test/",
      name: "Archived",
      addedAt: "2026-07-21T12:00:00.000Z",
      archived: true,
    },
  ]);

  assert.deepEqual(filterCandidates(items, "macOS agent").map((item) => item.id), ["one"]);
  assert.deepEqual(filterCandidates(items, "archived"), []);
  assert.deepEqual(filterCandidates(items, "archived", true).map((item) => item.id), ["two"]);
});
