import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

export type ModelProviderKind = "openai" | "compatible";

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

  constructor(code: ProviderRequestErrorCode) {
    super(code);
    this.code = code;
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
  const provider = cleanValue(env.FITLENS_MODEL_PROVIDER) || "openai";
  if (provider !== "openai" && provider !== "compatible") {
    throw new ModelProviderConfigError("providerUnsupported");
  }

  const model =
    provider === "openai"
      ? cleanValue(env.OPENAI_MODEL) || "gpt-5.6-luna"
      : cleanValue(env.FITLENS_MODEL_MODEL);
  if (!model || model.length > 200 || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new ModelProviderConfigError("providerModelInvalid");
  }

  const apiKey =
    cleanValue(sessionApiKey) ||
    (provider === "openai"
      ? cleanValue(env.OPENAI_API_KEY)
      : cleanValue(env.FITLENS_MODEL_API_KEY));

  if (provider === "openai") {
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
  },
): Promise<z.infer<TSchema> | null> {
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
    });
    return response.output_parsed === null
      ? null
      : options.schema.parse(response.output_parsed);
  } catch (error) {
    throw new ModelProviderRequestError(normalizeProviderError(error));
  }
}
