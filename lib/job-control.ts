import { SourceError } from "./source.ts";
import { ModelProviderRequestError } from "./model-provider.ts";

export class AnalysisCancelledError extends Error {
  constructor() {
    super("analysis_cancelled");
    this.name = "AnalysisCancelledError";
  }
}

export class AnalysisBudgetExceededError extends Error {
  constructor() {
    super("analysis_budget_exceeded");
    this.name = "AnalysisBudgetExceededError";
  }
}

export interface JobClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  random(): number;
}

function abortFailure(signal?: AbortSignal) {
  return signal?.reason instanceof AnalysisBudgetExceededError
    ? signal.reason
    : new AnalysisCancelledError();
}

export const systemJobClock: JobClock = {
  now: Date.now,
  random: Math.random,
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortFailure(signal));
      const timer = setTimeout(done, ms);
      function done() {
        signal?.removeEventListener("abort", cancel);
        resolve();
      }
      function cancel() {
        clearTimeout(timer);
        reject(abortFailure(signal));
      }
      signal?.addEventListener("abort", cancel, { once: true });
    });
  },
};

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortFailure(signal);
}

async function raceWithSignal<T>(operation: Promise<T>, signal?: AbortSignal) {
  if (!signal) return operation;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortFailure(signal));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

/**
 * Creates a signal that aborts in-flight work at the deadline. `dispose` only
 * cancels the timer; it never makes a successful job look user-cancelled.
 */
export function createJobDeadline(
  userSignal: AbortSignal | undefined,
  budgetMs: number,
  clock: JobClock = systemJobClock,
) {
  const deadlineController = new AbortController();
  const timerController = new AbortController();
  const signal = userSignal
    ? AbortSignal.any([userSignal, deadlineController.signal])
    : deadlineController.signal;
  let disposed = false;
  void clock.sleep(Math.max(0, budgetMs), timerController.signal).then(
    () => {
      if (!disposed) {
        deadlineController.abort(new AnalysisBudgetExceededError());
      }
    },
    () => undefined,
  );
  return {
    signal,
    dispose() {
      disposed = true;
      timerController.abort();
    },
  };
}

export function isTransientFailure(error: unknown) {
  if (error instanceof SourceError) {
    return error.retryable;
  }
  if (error instanceof ModelProviderRequestError) {
    return [
      "providerRateLimited",
      "providerConnectionFailed",
      "providerRequestFailed",
    ].includes(error.code);
  }
  return false;
}

function retryAfterMs(error: unknown) {
  if (error instanceof SourceError || error instanceof ModelProviderRequestError) {
    return error.retryAfterMs;
  }
  return undefined;
}

export async function withTransientRetry<T>(
  operation: () => Promise<T>,
  options: {
    signal?: AbortSignal;
    clock?: JobClock;
    policy?: Partial<RetryPolicy>;
    deadline?: number;
  } = {},
): Promise<T> {
  const clock = options.clock ?? systemJobClock;
  const policy = { attempts: 3, baseDelayMs: 250, maxDelayMs: 2_000, ...options.policy };
  for (let attempt = 0; ; attempt += 1) {
    throwIfAborted(options.signal);
    if (options.deadline !== undefined && clock.now() >= options.deadline) {
      throw new AnalysisBudgetExceededError();
    }
    try {
      return await raceWithSignal(operation(), options.signal);
    } catch (error) {
      throwIfAborted(options.signal);
      if (!isTransientFailure(error) || attempt + 1 >= policy.attempts) throw error;
      const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
      const serverDelay = retryAfterMs(error);
      const delay = Math.min(
        policy.maxDelayMs,
        serverDelay ?? Math.round(exponential * (0.75 + clock.random() * 0.5)),
      );
      if (options.deadline !== undefined && clock.now() + delay >= options.deadline) {
        throw new AnalysisBudgetExceededError();
      }
      await clock.sleep(delay, options.signal);
    }
  }
}

export async function mapWithHostLimits<T>(
  urls: string[],
  worker: (url: string, index: number) => Promise<T>,
  options: { overall?: number; perHost?: number; signal?: AbortSignal } = {},
): Promise<PromiseSettledResult<T>[]> {
  const overall = Math.max(1, options.overall ?? 3);
  const perHost = Math.max(1, options.perHost ?? 1);
  const results: PromiseSettledResult<T>[] = new Array(urls.length);
  const pending = urls.map((url, index) => ({
    url,
    index,
    host: new URL(url).hostname.toLowerCase(),
  }));
  const activeHosts = new Map<string, number>();
  let active = 0;

  return new Promise((resolve) => {
    const pump = () => {
      if (active === 0 && pending.length === 0) return resolve(results);
      while (active < overall) {
        const nextIndex = pending.findIndex(
          ({ host }) => (activeHosts.get(host) ?? 0) < perHost,
        );
        if (nextIndex < 0) break;
        const item = pending.splice(nextIndex, 1)[0];
        active += 1;
        activeHosts.set(item.host, (activeHosts.get(item.host) ?? 0) + 1);
        Promise.resolve()
          .then(() => {
            throwIfAborted(options.signal);
            return worker(item.url, item.index);
          })
          .then(
            (value) => { results[item.index] = { status: "fulfilled", value }; },
            (reason) => { results[item.index] = { status: "rejected", reason }; },
          )
          .finally(() => {
            active -= 1;
            activeHosts.set(item.host, (activeHosts.get(item.host) ?? 1) - 1);
            pump();
          });
      }
    };
    pump();
  });
}

export class PublicSourceCache<T> {
  private readonly values = new Map<string, { expiresAt: number; value: T }>();
  private readonly options: { maxEntries: number; ttlMs: number; now?: () => number };
  constructor(options: { maxEntries: number; ttlMs: number; now?: () => number }) {
    this.options = options;
  }
  get(key: string) {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= (this.options.now ?? Date.now)()) {
      this.values.delete(key);
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, entry);
    return structuredClone(entry.value);
  }
  set(key: string, value: T) {
    this.values.delete(key);
    this.values.set(key, {
      expiresAt: (this.options.now ?? Date.now)() + this.options.ttlMs,
      value: structuredClone(value),
    });
    while (this.values.size > this.options.maxEntries) {
      this.values.delete(this.values.keys().next().value!);
    }
  }
  clear() { this.values.clear(); }
  get size() { return this.values.size; }
}
