import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { z } from "zod";
import {
  ModelProviderConfigError,
  ModelProviderRequestError,
  modelProviderCanRun,
  normalizeProviderError,
  requestStructuredOutput,
  resolveModelProviderConfig,
} from "../lib/model-provider.ts";

test("compatible provider honors the OpenAI Responses transport contract", async (t) => {
  let requestBody: Record<string, unknown> | undefined;
  let authorization: string | undefined;

  const server = createServer(async (request, response) => {
    authorization = request.headers.authorization;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "resp_contract",
        object: "response",
        created_at: 0,
        status: "completed",
        model: "local-contract-model",
        output: [
          {
            id: "msg_contract",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ answer: "verified" }),
                annotations: [],
              },
            ],
          },
        ],
      }),
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP server address.");
  }

  const result = await requestStructuredOutput(
    {
      kind: "compatible",
      model: "local-contract-model",
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      isLoopback: true,
    },
    {
      schema: z.object({ answer: z.string() }).strict(),
      schemaName: "provider_contract",
      instructions: "Return the contract result.",
      input: "Verify this request.",
    },
  );

  assert.deepEqual(result, { answer: "verified" });
  assert.equal(authorization, "Bearer fitlens-local-provider");
  assert.equal(requestBody?.model, "local-contract-model");
  assert.equal(requestBody?.instructions, "Return the contract result.");
  assert.equal(requestBody?.input, "Verify this request.");
  assert.equal(requestBody?.reasoning, undefined);
  assert.deepEqual(requestBody?.text, {
    format: {
      type: "json_schema",
      name: "provider_contract",
      strict: true,
      schema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    },
  });
});

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

test("Anthropic is selected explicitly with its default model and key", () => {
  const config = resolveModelProviderConfig({
    FITLENS_MODEL_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "anthropic-secret",
  });
  assert.deepEqual(config, {
    kind: "anthropic",
    model: "claude-sonnet-5",
    apiKey: "anthropic-secret",
    isLoopback: false,
  });
  assert.equal(modelProviderCanRun(config), true);
});

test("Anthropic is auto-selected when only its key is present", () => {
  const config = resolveModelProviderConfig({
    ANTHROPIC_API_KEY: "anthropic-secret",
    ANTHROPIC_MODEL: "claude-haiku-4-5",
  });
  assert.equal(config.kind, "anthropic");
  assert.equal(config.model, "claude-haiku-4-5");
});

test("OpenAI wins the default when both keys are present", () => {
  const config = resolveModelProviderConfig({
    OPENAI_API_KEY: "openai-secret",
    ANTHROPIC_API_KEY: "anthropic-secret",
  });
  assert.equal(config.kind, "openai");
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
