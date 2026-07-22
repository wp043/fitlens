import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireAnalysisSlot,
  isTrustedOrigin,
  MAX_ANALYZE_BODY_BYTES,
  MAX_IN_FLIGHT_ANALYSES,
  readBoundedJson,
  RequestGuardError,
} from "../lib/request-guard.ts";

function requestWithHeaders(headers: Record<string, string>, body?: string) {
  return new Request("http://127.0.0.1:3000/api/analyze", {
    method: "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body,
  });
}

test("accepts a same-origin loopback request identified by Origin", () => {
  const request = requestWithHeaders({
    host: "localhost:3000",
    origin: "http://localhost:3000",
  });
  assert.equal(isTrustedOrigin(request), true);
});

test("accepts a same-origin loopback request identified by Referer when Origin is absent", () => {
  const request = requestWithHeaders({
    host: "127.0.0.1:3000",
    referer: "http://127.0.0.1:3000/",
  });
  assert.equal(isTrustedOrigin(request), true);
});

test("rejects a cross-origin Origin header, as any open tab could send one", () => {
  const request = requestWithHeaders({
    host: "localhost:3000",
    origin: "https://attacker.example",
  });
  assert.equal(isTrustedOrigin(request), false);
});

test("rejects a request with neither Origin nor Referer", () => {
  const request = requestWithHeaders({ host: "localhost:3000" });
  assert.equal(isTrustedOrigin(request), false);
});

test("rejects an unparsable Origin header", () => {
  const request = requestWithHeaders({
    host: "localhost:3000",
    origin: "not a url",
  });
  assert.equal(isTrustedOrigin(request), false);
});

test("rejects a Host header that is not loopback, even with a matching Origin", () => {
  const request = requestWithHeaders({
    host: "app.example:3000",
    origin: "http://app.example:3000",
  });
  assert.equal(isTrustedOrigin(request), false);
});

test("rejects wildcard binds, authority tricks, and a mismatched scheme", () => {
  const cases = [
    { host: "0.0.0.0:3000", origin: "http://0.0.0.0:3000" },
    { host: "attacker.example@localhost:3000", origin: "http://localhost:3000" },
    { host: "localhost:3000", origin: "https://localhost:3000" },
  ];
  for (const headers of cases) {
    assert.equal(isTrustedOrigin(requestWithHeaders(headers)), false);
  }
});

test("accepts explicit IPv4 and IPv6 loopback authorities", () => {
  assert.equal(
    isTrustedOrigin(
      requestWithHeaders({
        host: "127.0.0.2:3000",
        origin: "http://127.0.0.2:3000",
      }),
    ),
    true,
  );
  const ipv6 = new Request("http://[::1]:3000/api/analyze", {
    method: "POST",
    headers: { host: "[::1]:3000", origin: "http://[::1]:3000" },
  });
  assert.equal(isTrustedOrigin(ipv6), true);
});

test("reads a body under the byte cap", async () => {
  const body = JSON.stringify({ ok: true });
  const request = requestWithHeaders(
    { host: "localhost:3000", "content-type": "application/json" },
    body,
  );
  const parsed = await readBoundedJson(request, MAX_ANALYZE_BODY_BYTES);
  assert.deepEqual(parsed, { ok: true });
});

test("rejects a body whose declared Content-Length exceeds the cap", async () => {
  const body = "x".repeat(100);
  const request = requestWithHeaders(
    { host: "localhost:3000", "content-length": "999999" },
    body,
  );
  await assert.rejects(
    readBoundedJson(request, MAX_ANALYZE_BODY_BYTES),
    (error: unknown) =>
      error instanceof RequestGuardError && error.code === "payloadTooLarge",
  );
});

test("rejects a streamed body that exceeds the cap even without a declared Content-Length", async () => {
  const oversized = "x".repeat(200);
  const request = requestWithHeaders({ host: "localhost:3000" }, oversized);
  await assert.rejects(
    readBoundedJson(request, 100),
    (error: unknown) =>
      error instanceof RequestGuardError && error.code === "payloadTooLarge",
  );
});

test("rejects a body that is not valid JSON", async () => {
  const request = requestWithHeaders({ host: "localhost:3000" }, "not json");
  await assert.rejects(
    readBoundedJson(request, MAX_ANALYZE_BODY_BYTES),
    (error: unknown) =>
      error instanceof RequestGuardError && error.code === "invalidJson",
  );
});

test("rejects non-JSON content before reading the request body", async () => {
  const request = requestWithHeaders(
    { host: "localhost:3000", "content-type": "text/plain" },
    "{}",
  );
  await assert.rejects(
    readBoundedJson(request, MAX_ANALYZE_BODY_BYTES),
    (error: unknown) =>
      error instanceof RequestGuardError && error.code === "invalidContentType",
  );
});

test("caps in-flight analysis slots and releases them for reuse", () => {
  const releases: Array<() => void> = [];
  try {
    for (let index = 0; index < MAX_IN_FLIGHT_ANALYSES; index += 1) {
      const release = acquireAnalysisSlot();
      assert.ok(release);
      releases.push(release);
    }
    assert.equal(acquireAnalysisSlot(), null);

    releases[0]();
    releases[0]();
    const replacement = acquireAnalysisSlot();
    assert.ok(replacement);
    releases.push(replacement);
  } finally {
    for (const release of releases) release();
  }
});
