/** Parse Retry-After delta-seconds or an HTTP date into a non-negative delay. */
export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - now);
}
