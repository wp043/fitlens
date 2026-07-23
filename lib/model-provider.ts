import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { parseRetryAfterMs } from "./retry-after.ts";

export type ModelProviderKind = "openai" | "compatible" | "anthropic";

/** Output-token ceiling for the structured comparison. Ample for 2–8 products. */
const ANTHROPIC_MAX_TOKENS = 16_000;

export type ModelProviderConfig = {
  kind: ModelProviderKind;
  model: string;
  apiKey?: string;
  baseURL?: string;
  isLoopback: boolean;
};

export type ProviderConfigErrorCode =
  | "providerUnsupported"
  | "providerModelInvalid"
  | "providerBaseUrlInvalid"
  | "providerBaseUrlRequired";

export type ProviderRequestErrorCode =
  | "providerAuthenticationFailed"
  | "providerRateLimited"
  | "providerConnectionFailed"
  | "providerRequestRejected"
  | "providerRequestFailed";

export class ModelProviderConfigError extends Error {
  readonly code: ProviderConfigErrorCode;

  constructor(code: ProviderConfigErrorCode) {
    super(code);
    this.code = code;
    this.name = "ModelProviderConfigError";
  }
}

export class ModelProviderRequestError extends Error {
  readonly code: ProviderRequestErrorCode;
  readonly retryAfterMs?: number;

  constructor(code: ProviderRequestErrorCode, retryAfterMs?: number) {
    super(code);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.name = "ModelProviderRequestError";
  }
}

function cleanValue(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function resolveCompatibleBaseURL(value: string | undefined) {
  if (!value) {
    throw new ModelProviderConfigError("providerBaseUrlRequired");
  }
  if (value.length > 2_048) {
    throw new ModelProviderConfigError("providerBaseUrlInvalid");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ModelProviderConfigError("providerBaseUrlInvalid");
  }

  const loopback = isLoopbackHostname(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    throw new ModelProviderConfigError("providerBaseUrlInvalid");
  }

  return {
    baseURL: url.toString().replace(/\/$/, ""),
    isLoopback: loopback,
  };
}

/** Resolve server-only model settings. The returned object is never persisted in a report. */
export function resolveModelProviderConfig(
  env: Record<string, string | undefined>,
  sessionApiKey?: string,
): ModelProviderConfig {
  // Default to Anthropic when only its key is present, so a fresh install with
  // just ANTHROPIC_API_KEY works without also setting FITLENS_MODEL_PROVIDER.
  const defaultProvider =
    !cleanValue(env.OPENAI_API_KEY) && cleanValue(env.ANTHROPIC_API_KEY)
      ? "anthropic"
      : "openai";
  const provider = cleanValue(env.FITLENS_MODEL_PROVIDER) || defaultProvider;
  if (
    provider !== "openai" &&
    provider !== "compatible" &&
    provider !== "anthropic"
  ) {
    throw new ModelProviderConfigError("providerUnsupported");
  }

  const model =
    provider === "openai"
      ? cleanValue(env.OPENAI_MODEL) || "gpt-5.6-luna"
      : provider === "anthropic"
        ? cleanValue(env.ANTHROPIC_MODEL) || "claude-sonnet-5"
        : cleanValue(env.FITLENS_MODEL_MODEL);
  if (!model || model.length > 200 || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new ModelProviderConfigError("providerModelInvalid");
  }

  const apiKey =
    cleanValue(sessionApiKey) ||
    (provider === "openai"
      ? cleanValue(env.OPENAI_API_KEY)
      : provider === "anthropic"
        ? cleanValue(env.ANTHROPIC_API_KEY)
        : cleanValue(env.FITLENS_MODEL_API_KEY));

  if (provider === "openai" || provider === "anthropic") {
    return { kind: provider, model, apiKey, isLoopback: false };
  }

  const endpoint = resolveCompatibleBaseURL(
    cleanValue(env.FITLENS_MODEL_BASE_URL),
  );
  return { kind: provider, model, apiKey, ...endpoint };
}

export function modelProviderCanRun(config: ModelProviderConfig) {
  return (
    Boolean(config.apiKey) ||
    (config.kind === "compatible" && config.isLoopback)
  );
}

function errorRecord(error: unknown): Record<string, unknown> {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)
    : {};
}

/** Convert SDK/network errors to stable codes without returning provider payloads or secrets. */
export function normalizeProviderError(
  error: unknown,
): ProviderRequestErrorCode {
  const record = errorRecord(error);
  const status = typeof record.status === "number" ? record.status : undefined;
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";

  if (status === 401 || status === 403) {
    return "providerAuthenticationFailed";
  }
  if (status === 429) {
    return "providerRateLimited";
  }
  if (
    [
      "econnrefused",
      "econnreset",
      "enotfound",
      "etimedout",
      "und_err_connect_timeout",
    ].includes(code) ||
    error instanceof TypeError
  ) {
    return "providerConnectionFailed";
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return "providerRequestRejected";
  }
  return "providerRequestFailed";
}

export async function requestStructuredOutput<TSchema extends z.ZodTypeAny>(
  config: ModelProviderConfig,
  options: {
    schema: TSchema;
    schemaName: string;
    instructions: string;
    input: string;
    signal?: AbortSignal;
  },
): Promise<z.infer<TSchema> | null> {
  if (config.kind === "anthropic") {
    return requestAnthropicStructuredOutput(config, options);
  }
  const client = new OpenAI({
    apiKey: config.apiKey || "fitlens-local-provider",
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });

  try {
    const response = await client.responses.parse({
      model: config.model,
      ...(config.kind === "openai"
        ? { reasoning: { effort: "low" as const } }
        : {}),
      instructions: options.instructions,
      input: options.input,
      text: {
        format: zodTextFormat(options.schema, options.schemaName),
      },
    }, { signal: options.signal });
    return response.output_parsed === null
      ? null
      : options.schema.parse(response.output_parsed);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const record = errorRecord(error);
    const headers = record.headers as
      | { get?: (name: string) => string | null }
      | undefined;
    throw new ModelProviderRequestError(
      normalizeProviderError(error),
      parseRetryAfterMs(headers?.get?.("retry-after")),
    );
  }
}

/**
 * Anthropic path. FitLens's output schema exceeds Anthropic's strict
 * structured-output grammar-size limit (the OpenAI strict path handles it,
 * Anthropic returns "compiled grammar is too large"), so structure is obtained
 * through a forced tool call instead: the model must emit exactly one tool_use
 * whose input matches the schema. Tool inputs are never wrapped in prose or
 * markdown, unlike a free-text JSON response. The same Zod schema the rest of
 * the pipeline enforces validates the result. Thinking is disabled: this is
 * structured extraction, mirroring the OpenAI path's `effort: "low"`.
 */
async function requestAnthropicStructuredOutput<TSchema extends z.ZodTypeAny>(
  config: ModelProviderConfig,
  options: {
    schema: TSchema;
    schemaName: string;
    instructions: string;
    input: string;
    signal?: AbortSignal;
  },
): Promise<z.infer<TSchema> | null> {
  const client = new Anthropic({
    apiKey: config.apiKey || "fitlens-local-provider",
  });
  const jsonSchema = z.toJSONSchema(options.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;

  try {
    const response = await client.messages.create(
      {
        model: config.model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        thinking: { type: "disabled" },
        system: options.instructions,
        messages: [{ role: "user", content: options.input }],
        tools: [
          {
            name: options.schemaName,
            description: "Return the completed comparison as structured data.",
            input_schema: jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: options.schemaName },
      },
      { signal: options.signal },
    );
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) return null;
    return options.schema.parse(toolUse.input);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const record = errorRecord(error);
    const headers = record.headers as
      | { get?: (name: string) => string | null }
      | undefined;
    throw new ModelProviderRequestError(
      normalizeProviderError(error),
      parseRetryAfterMs(headers?.get?.("retry-after")),
    );
  }
}
