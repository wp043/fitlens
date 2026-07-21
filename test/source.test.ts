import assert from "node:assert/strict";
import test from "node:test";
import { SourceError, toPublicUrl } from "../lib/source.ts";
import { parseAnalyzeRequest } from "../lib/analyze-request.ts";

test("accepts a public product URL", () => {
  assert.equal(toPublicUrl("https://otty.sh/#pricing").toString(), "https://otty.sh/");
});

test("rejects local and private network targets", () => {
  for (const url of [
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://10.0.0.5",
    "http://192.168.1.2",
  ]) {
    assert.throws(
      () => toPublicUrl(url),
      (error) => error instanceof SourceError && error.code === "privateNetwork",
    );
  }
});

test("rejects non-http protocols and credentials", () => {
  assert.throws(
    () => toPublicUrl("file:///etc/passwd"),
    (error) => error instanceof SourceError && error.code === "httpOnly",
  );
  assert.throws(
    () => toPublicUrl("https://user:secret@example.com"),
    (error) =>
      error instanceof SourceError && error.code === "credentialsNotAllowed",
  );
});

test("validates every URL in a multi-product analysis request", () => {
  const criteria = [
    { key: "fit", label: "Fit", hint: "Workflow fit", weight: 70 },
    { key: "cost", label: "Cost", hint: "Total cost", weight: 60 },
  ];
  const valid = parseAnalyzeRequest({
    urls: [
      "https://one.example/",
      "https://two.example/",
      "https://three.example/",
    ],
    context: "A sufficiently detailed comparison context.",
    criteria,
    locale: "en",
  });
  assert.equal(valid.urls.length, 3);

  assert.throws(() =>
    parseAnalyzeRequest({
      ...valid,
      urls: [valid.urls[0], valid.urls[1], "http://127.0.0.1/admin"],
    }),
  );
  assert.throws(() => parseAnalyzeRequest({ ...valid, urls: [valid.urls[0]] }));
  assert.throws(() =>
    parseAnalyzeRequest({
      ...valid,
      urls: ["https://one.example/#first", "https://one.example/#second"],
    }),
  );
});
