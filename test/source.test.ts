import assert from "node:assert/strict";
import test from "node:test";
import { SourceError, toPublicUrl } from "../lib/source.ts";

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
