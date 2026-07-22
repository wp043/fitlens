import assert from "node:assert/strict";
import test from "node:test";
import {
  createDoctorReport,
  formatDoctorReport,
  redactDiagnostics,
  versionAtLeast,
} from "../lib/doctor.ts";

const baseOptions = {
  cwd: process.cwd(),
  nodeVersion: "v22.17.0",
  platform: "linux" as const,
  architecture: "x64",
  now: () => new Date("2026-07-21T12:00:00.000Z"),
  command: async () => "10.22.0",
};

test("compares runtime versions numerically", () => {
  assert.equal(versionAtLeast("v20.18.1", [20, 18, 1]), true);
  assert.equal(versionAtLeast("20.18.0", [20, 18, 1]), false);
  assert.equal(versionAtLeast("22.0.0", [20, 18, 1]), true);
  assert.equal(versionAtLeast("not-a-version", [20, 18, 1]), false);
});

test("doctor reports a healthy configured local runtime deterministically", async () => {
  const report = await createDoctorReport({
    ...baseOptions,
    env: {
      FITLENS_MODEL_PROVIDER: "compatible",
      FITLENS_MODEL_BASE_URL: "http://127.0.0.1:11434/v1",
      FITLENS_MODEL_MODEL: "local-model",
    },
  });

  assert.equal(report.healthy, true);
  assert.equal(report.generatedAt, "2026-07-21T12:00:00.000Z");
  assert.equal(report.checks.find((check) => check.id === "node")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "provider")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "playwright")?.status, "skip");
  assert.match(formatDoctorReport(report), /FitLens doctor: healthy/);
});

test("doctor flags unsupported tools and invalid provider config", async () => {
  const report = await createDoctorReport({
    ...baseOptions,
    nodeVersion: "v18.20.0",
    command: async () => "9.15.0",
    env: { FITLENS_MODEL_PROVIDER: "other" },
  });

  assert.equal(report.healthy, false);
  assert.equal(report.checks.find((check) => check.id === "node")?.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "pnpm")?.status, "fail");
  assert.equal(report.checks.find((check) => check.id === "provider")?.status, "fail");
});

test("optional endpoint probe sends credentials but never records them", async () => {
  const secret = "super-secret-provider-token";
  let authorization = "";
  const report = await createDoctorReport({
    ...baseOptions,
    env: {
      FITLENS_MODEL_PROVIDER: "compatible",
      FITLENS_MODEL_BASE_URL: "https://models.example.test/v1",
      FITLENS_MODEL_MODEL: "safe-model",
      FITLENS_MODEL_API_KEY: secret,
    },
    probeProvider: true,
    fetch: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(null, { status: 200 });
    },
  });

  assert.equal(authorization, `Bearer ${secret}`);
  assert.equal(report.checks.find((check) => check.id === "provider-endpoint")?.status, "pass");
  assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
});

test("diagnostic redaction removes secrets, home paths, and sensitive fields", () => {
  const redacted = redactDiagnostics(
    {
      message: "Bearer abc123 at /Users/example/project?token=query-token",
      apiKey: "abc123",
      nested: ["sk-abcdefghijklmnop", "known-secret"],
    },
    { HOME: "/Users/example", OPENAI_API_KEY: "known-secret" },
  );
  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(serialized, /\/Users\/example|query-token|known-secret|abcdefghijklmnop/);
  assert.equal(redacted.apiKey, "<redacted>");
});

test("optional browser readiness is a warning rather than a core failure", async () => {
  const report = await createDoctorReport({
    ...baseOptions,
    env: {},
    checkPlaywright: true,
    inspectPlaywright: async () => ({ installed: true, browserReady: false }),
  });
  assert.equal(report.healthy, true);
  assert.equal(report.checks.find((check) => check.id === "playwright")?.status, "warn");
});
