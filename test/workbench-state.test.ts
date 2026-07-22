import assert from "node:assert/strict";
import test from "node:test";
import { getBuiltInCriteriaTemplates } from "../lib/criteria.ts";
import {
  canAnalyzeDraft,
  createCriteriaFromTemplate,
  initialWorkbenchCriteria,
  isSourceFailure,
  moveCandidate,
  normalizeReportHistory,
  removeCandidate,
  type SourceFailure,
} from "../lib/workbench-state.ts";

const failures: SourceFailure[] = [
  { index: 0, url: "https://a.test", code: "fetchFailed", message: "a" },
  { index: 2, url: "https://c.test", code: "pageTooLarge", message: "c" },
];

test("validates public source diagnostics without accepting arbitrary codes", () => {
  assert.equal(isSourceFailure(failures[0]), true);
  assert.equal(
    isSourceFailure({ ...failures[0], code: "secretInternalCode" }),
    false,
  );
  assert.equal(isSourceFailure(null), false);
});

test("removing a candidate removes its failure and reindexes later failures", () => {
  const next = removeCandidate(["a", "b", "c"], failures, 0);
  assert.deepEqual(next.urls, ["b", "c"]);
  assert.deepEqual(next.failures, [{ ...failures[1], index: 1 }]);
  const protectedMinimum = removeCandidate(["a", "b"], failures, 0);
  assert.deepEqual(protectedMinimum.urls, ["a", "b"]);
});

test("moving a candidate keeps diagnostics attached to the same URL", () => {
  const next = moveCandidate(["a", "b", "c"], failures, 0, 1);
  assert.deepEqual(next.urls, ["b", "a", "c"]);
  assert.deepEqual(
    next.failures.map((failure) => failure.index),
    [1, 2],
  );
  assert.deepEqual(moveCandidate(["a", "b"], failures, 0, -1).urls, ["a", "b"]);
});

test("draft readiness enforces candidate, context, and criteria boundaries", () => {
  const criteria = getBuiltInCriteriaTemplates("en")[0].criteria;
  assert.equal(
    canAnalyzeDraft(["a", "b"], "long enough context", criteria),
    true,
  );
  assert.equal(
    canAnalyzeDraft(["a", ""], "long enough context", criteria),
    false,
  );
  assert.equal(canAnalyzeDraft(["a", "b"], "short", criteria), false);
  assert.equal(
    canAnalyzeDraft(["a", "b"], "long enough context", criteria.slice(0, 1)),
    false,
  );
});

test("criteria initialization localizes templates and isolates mutable copies", () => {
  const example = initialWorkbenchCriteria(true, "en");
  const general = initialWorkbenchCriteria(false, "zh-CN");
  assert.equal(example[0].weight > 0, true);
  assert.notEqual(example[0].label, general[0].label);
  const clone = createCriteriaFromTemplate(example);
  clone[0].weight = 0;
  assert.notEqual(example[0].weight, clone[0].weight);
});

test("malformed report history is ignored without hiding valid reports", () => {
  assert.deepEqual(normalizeReportHistory(null), []);
  assert.deepEqual(normalizeReportHistory([{ invalid: true }]), []);
});
