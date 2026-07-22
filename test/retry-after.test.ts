import assert from "node:assert/strict";
import test from "node:test";
import { parseRetryAfterMs } from "../lib/retry-after.ts";

test("Retry-After supports delta-seconds and HTTP dates with an injected now", () => {
  const now = Date.parse("2026-07-22T12:00:00Z");
  assert.equal(parseRetryAfterMs("1.5", now), 1_500);
  assert.equal(parseRetryAfterMs("Wed, 22 Jul 2026 12:00:03 GMT", now), 3_000);
  assert.equal(parseRetryAfterMs("Wed, 22 Jul 2026 11:59:00 GMT", now), 0);
  assert.equal(parseRetryAfterMs("later", now), undefined);
});
