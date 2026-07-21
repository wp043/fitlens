import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelProviderConfigError,
  ModelProviderRequestError,
  modelProviderCanRun,
  normalizeProviderError,
  resolveModelProviderConfig,
} from "../lib/model-provider.ts";

test("OpenAI remains the default and a session key takes precedence", () => {
  const config = resolveModelProviderConfig(
    {
      OPENAI_API_KEY: "environment-secret",
      OPENAI_MODEL: "gpt-test",
    },
    "session-secret",
  );

  assert.deepEqual(config, {
    kind: "openai",
    model: "gpt-test",
    apiKey: "session-secret",
    isLoopback: false,
  });
  assert.equal(modelProviderCanRun(config), true);
});

test("compatible provider accepts a keyless loopback Responses base URL", () => {
  const config = resolveModelProviderConfig({
    FITLENS_MODEL_PROVIDER: "compatible",
    FITLENS_MODEL_BASE_URL: "http://127.0.0.1:11434/v1/",
    FITLENS_MODEL_MODEL: "local-structured-model",
  });

  assert.deepEqual(config, {
    kind: "compatible",
    model: "local-structured-model",
    apiKey: undefined,
    baseURL: "http://127.0.0.1:11434/v1",
    isLoopback: true,
  });
  assert.equal(modelProviderCanRun(config), true);
});

test("compatible provider accepts a credentialed HTTPS endpoint", () => {
  const config = resolveModelProviderConfig({
    FITLENS_MODEL_PROVIDER: "compatible",
    FITLENS_MODEL_BASE_URL: "https://models.example.com/v1",
    FITLENS_MODEL_MODEL: "structured-model",
    FITLENS_MODEL_API_KEY: "provider-secret",
  });

  assert.equal(config.baseURL, "https://models.example.com/v1");
  assert.equal(config.apiKey, "provider-secret");
  assert.equal(modelProviderCanRun(config), true);
});

test("compatible provider rejects unsafe or ambiguous base URLs", () => {
  const invalid = [
    "http://models.example.com/v1",
    "https://user:secret@models.example.com/v1",
    "file:///tmp/model",
    "https://models.example.com/v1?token=secret",
    "https://models.example.com/v1#responses",
  ];

  for (const baseURL of invalid) {
    assert.throws(
      () =>
        resolveModelProviderConfig({
          FITLENS_MODEL_PROVIDER: "compatible",
          FITLENS_MODEL_BASE_URL: baseURL,
          FITLENS_MODEL_MODEL: "structured-model",
        }),
      (error) =>
        error instanceof ModelProviderConfigError &&
        error.code === "providerBaseUrlInvalid",
    );
  }
});

test("provider configuration validates provider and model bounds", () => {
  assert.throws(
    () => resolveModelProviderConfig({ FITLENS_MODEL_PROVIDER: "other" }),
    (error) =>
      error instanceof ModelProviderConfigError &&
      error.code === "providerUnsupported",
  );
  assert.throws(
    () =>
      resolveModelProviderConfig({
        FITLENS_MODEL_PROVIDER: "compatible",
        FITLENS_MODEL_BASE_URL: "https://models.example.com/v1",
        FITLENS_MODEL_MODEL: "x".repeat(201),
      }),
    (error) =>
      error instanceof ModelProviderConfigError &&
      error.code === "providerModelInvalid",
  );
});

test("provider errors normalize without retaining sensitive messages", () => {
  const cases: Array<[unknown, ReturnType<typeof normalizeProviderError>]> = [
    [{ status: 401, message: "secret-token" }, "providerAuthenticationFailed"],
    [{ status: 429 }, "providerRateLimited"],
    [{ code: "ECONNREFUSED" }, "providerConnectionFailed"],
    [{ status: 400 }, "providerRequestRejected"],
    [
      { status: 500, message: "upstream private payload" },
      "providerRequestFailed",
    ],
  ];

  for (const [error, expected] of cases) {
    const normalized = normalizeProviderError(error);
    const wrapped = new ModelProviderRequestError(normalized);
    assert.equal(normalized, expected);
    assert.equal(wrapped.message, expected);
    assert.doesNotMatch(wrapped.message, /secret|private payload/);
  }
});
