import assert from "node:assert/strict";
import test from "node:test";
import { inferCriteria } from "../lib/criteria.ts";
import { reportToAdr, reportToHtml } from "../lib/durable-exports.ts";
import type { SavedReport } from "../lib/report.ts";
import { defaultPriorities, sampleComparison } from "../lib/sample.ts";

function report(): SavedReport {
  return {
    id: "export",
    title: sampleComparison.title,
    savedAt: sampleComparison.generatedAt,
    urls: ["https://cmux.com/", "https://otty.sh/"],
    context: "Choose safely </style><script>alert(1)</script> for daily work.",
    priorities: defaultPriorities,
    criteria: inferCriteria(sampleComparison.dimensions, defaultPriorities),
    result: structuredClone(sampleComparison),
    notes: "A private local note.",
    locale: "en",
    revisions: [],
    trialResults: [],
    conflicts: [],
    confidenceCalibrations: [],
  };
}

test("creates a self-contained print-ready HTML report without executable user markup", () => {
  const html = reportToHtml(report());
  assert.match(html, /<!doctype html>/);
  assert.match(html, /@media print/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
});

test("creates an architecture decision record with durable sections", () => {
  const adr = reportToAdr(report());
  assert.match(adr, /^# ADR:/);
  assert.match(adr, /## Decision drivers/);
  assert.match(adr, /## Consequences/);
  assert.match(adr, /## Evidence/);
  assert.doesNotMatch(adr, /<script>alert/);
});
