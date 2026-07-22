import assert from "node:assert/strict";
import test from "node:test";
import { browserSecurityHeaders } from "../lib/security-headers.ts";

function asRecord(development = false) {
  return Object.fromEntries(
    browserSecurityHeaders(development).map(({ key, value }) => [key, value]),
  );
}

test("production browser headers deny embedding and ambient capabilities", () => {
  const headers = asRecord();
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(headers["Cross-Origin-Resource-Policy"], "same-origin");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.match(headers["Permissions-Policy"], /camera=\(\)/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(headers["Content-Security-Policy"], /object-src 'none'/);
  assert.doesNotMatch(headers["Content-Security-Policy"], /unsafe-eval/);
});

test("development CSP permits only the eval capability required by Next HMR", () => {
  const production = asRecord()["Content-Security-Policy"];
  const development = asRecord(true)["Content-Security-Policy"];
  assert.equal(development, production.replace("'unsafe-inline'", "'unsafe-inline' 'unsafe-eval'"));
});
