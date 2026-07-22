/** Local dev/prod hardening for the one mutation endpoint, `/api/analyze`. */

import { isIP } from "node:net";

export type RequestGuardErrorCode =
  | "crossOriginRejected"
  | "payloadTooLarge"
  | "invalidJson"
  | "invalidContentType"
  | "analysisBusy";

const STATUS_BY_CODE: Record<RequestGuardErrorCode, number> = {
  crossOriginRejected: 403,
  payloadTooLarge: 413,
  invalidJson: 400,
  invalidContentType: 415,
  analysisBusy: 429,
};

export class RequestGuardError extends Error {
  readonly code: RequestGuardErrorCode;
  readonly status: number;

  constructor(code: RequestGuardErrorCode) {
    super(code);
    this.name = "RequestGuardError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

/** Bytes, not characters: comfortably above the 2,000-char context plus 8 URLs/criteria. */
export const MAX_ANALYZE_BODY_BYTES = 64_000;
export const MAX_IN_FLIGHT_ANALYSES = 2;

let inFlightAnalyses = 0;

function parseLoopbackAuthority(authority: string): URL | null {
  if (!authority || authority.length > 255 || /[\s\\/?#]/.test(authority)) {
    return null;
  }

  try {
    const url = new URL(`http://${authority}`);
    if (url.username || url.password || url.pathname !== "/") return null;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || hostname === "::1") return url;
    if (isIP(hostname) === 4 && hostname.split(".")[0] === "127") return url;
    return null;
  } catch {
    return null;
  }
}

/**
 * `next dev`/`next start` binds to localhost with no auth, so any open tab can
 * `fetch()` this endpoint and spend the user's configured model key or trigger
 * SSRF-shaped fetches of attacker-chosen URLs. Browsers attach `Origin` on
 * every same-origin or cross-origin POST/fetch; a same-origin form navigation
 * without JS still carries `Referer`. Treat a request with neither header as
 * untrusted rather than assuming same-origin.
 */
export function isTrustedOrigin(request: Request): boolean {
  const host = request.headers.get("host")?.trim();
  if (!host || !parseLoopbackAuthority(host)) return false;

  const candidate = request.headers.get("origin") ?? request.headers.get("referer");
  if (!candidate) return false;

  try {
    const source = new URL(candidate);
    const requestUrl = new URL(request.url);
    return (
      (source.protocol === "http:" || source.protocol === "https:") &&
      !source.username &&
      !source.password &&
      source.protocol === requestUrl.protocol &&
      source.host.toLowerCase() === host.toLowerCase() &&
      Boolean(parseLoopbackAuthority(source.host))
    );
  } catch {
    return false;
  }
}

/**
 * Reserve one expensive collection/model slot. The returned release callback
 * is idempotent so every route exit can safely invoke it from `finally`.
 */
export function acquireAnalysisSlot(): (() => void) | null {
  if (inFlightAnalyses >= MAX_IN_FLIGHT_ANALYSES) return null;
  inFlightAnalyses += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlightAnalyses = Math.max(0, inFlightAnalyses - 1);
  };
}

/** Stream the body under a byte cap so an oversized payload never gets buffered whole before Zod runs. */
export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestGuardError("invalidContentType");
  }
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new RequestGuardError("payloadTooLarge");
  }
  if (!request.body) return {};

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RequestGuardError("payloadTooLarge");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestGuardError("invalidJson");
  }
}
