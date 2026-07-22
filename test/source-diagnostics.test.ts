import assert from "node:assert/strict";
import test from "node:test";
import {
  collectCandidateSources,
  createSourceFailureResponse,
  sourceFailureHttpStatus,
} from "../lib/source-diagnostics.ts";
import {
  SourceError,
  type CollectedSource,
  type SourceErrorCode,
} from "../lib/source.ts";

function source(url: string): CollectedSource {
  return {
    inputUrl: url,
    homepageUrl: url,
    name: new URL(url).hostname,
    description: "public description",
    sourceMode: "website-only",
    pageText: "public page",
    documents: [],
  };
}

test("collects every candidate outcome and reports failures in input order", async () => {
  const visited: string[] = [];
  const urls = [
    "https://one.example/",
    "https://two.example/",
    "https://three.example/",
  ];
  const result = await collectCandidateSources(urls, async (url) => {
    visited.push(url);
    if (url.includes("one")) return source(url);
    if (url.includes("two")) {
      throw new SourceError("pageTooLarge", "private upstream detail");
    }
    throw new Error("stack and secret must not escape");
  });

  assert.deepEqual(visited, urls);
  assert.deepEqual(result, {
    ok: false,
    failures: [
      { index: 1, url: urls[1], code: "pageTooLarge" },
      { index: 2, url: urls[2], code: "fetchFailed" },
    ],
  });
});

test("returns sources only when every candidate succeeds", async () => {
  const urls = ["https://one.example/", "https://two.example/"];
  const result = await collectCandidateSources(urls, async (url) => source(url));

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.sources.map(({ inputUrl }) => inputUrl), urls);
});

test("creates a stable localized response without collector details", () => {
  const failures = [{
    index: 0,
    url: "https://failed.example/",
    code: "githubFailed" as SourceErrorCode,
  }];
  const response = createSourceFailureResponse(
    failures,
    "Some sources failed.",
    (code) => `Public message for ${code}`,
  );

  assert.deepEqual(response, {
    error: "Some sources failed.",
    code: "source_collection_failed",
    sourceFailures: [{
      ...failures[0],
      message: "Public message for githubFailed",
    }],
  });
  assert.doesNotMatch(JSON.stringify(response), /private|stack|secret/i);
  assert.equal(sourceFailureHttpStatus(failures), 502);
  assert.equal(sourceFailureHttpStatus([{ ...failures[0], code: "pageTooLarge" }]), 422);
});
