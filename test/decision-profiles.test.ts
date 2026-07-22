import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDecisionProfiles } from "../lib/decision-profiles.ts";

test("normalizes complete workflow profiles and drops malformed entries", () => {
  const profiles = normalizeDecisionProfiles([
    {
      id: "one",
      name: "  Daily tools  ",
      context: "A detailed daily decision workflow.",
      createdAt: "2026-07-21T12:00:00.000Z",
      criteria: [
        { key: "fit", label: "Fit", hint: "Workflow fit", weight: 80 },
        { key: "cost", label: "Cost", hint: "Total cost", weight: 60 },
      ],
    },
    { id: "bad", name: "Bad", context: "short", criteria: [] },
  ]);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, "Daily tools");
  assert.equal(profiles[0].criteria.length, 2);
});
