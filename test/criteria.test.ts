import assert from "node:assert/strict";
import test from "node:test";
import {
  criteriaToWeights,
  getBuiltInCriteriaTemplates,
  inferCriteria,
} from "../lib/criteria.ts";
import { defaultPriorities, sampleComparison } from "../lib/sample.ts";

test("built-in templates keep stable keys across locales", () => {
  const chinese = getBuiltInCriteriaTemplates("zh-CN");
  const english = getBuiltInCriteriaTemplates("en");

  assert.deepEqual(
    chinese.map((template) => template.id),
    english.map((template) => template.id),
  );
  assert.deepEqual(
    chinese.map((template) =>
      template.criteria.map((criterion) => criterion.key),
    ),
    english.map((template) =>
      template.criteria.map((criterion) => criterion.key),
    ),
  );
  assert.ok(
    chinese.every(
      (template) =>
        template.criteria.length >= 2 && template.criteria.length <= 8,
    ),
  );
});

test("criteria weights form a dynamic scoring map", () => {
  const criteria = getBuiltInCriteriaTemplates("en")[0].criteria;
  const weights = criteriaToWeights(criteria);

  assert.deepEqual(
    Object.keys(weights),
    criteria.map((criterion) => criterion.key),
  );
  assert.equal(weights[criteria[0].key], criteria[0].weight);
});

test("legacy dimensions can be inferred as editable criteria", () => {
  const criteria = inferCriteria(sampleComparison.dimensions, defaultPriorities);

  assert.equal(criteria.length, sampleComparison.dimensions.length);
  assert.equal(criteria[0].label, sampleComparison.dimensions[0].label);
  assert.equal(criteria[0].weight, defaultPriorities[criteria[0].key]);
});
