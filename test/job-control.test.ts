import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalysisBudgetExceededError,
  AnalysisCancelledError,
  mapWithHostLimits,
  PublicSourceCache,
  withTransientRetry,
  type JobClock,
} from "../lib/job-control.ts";
import { SourceError } from "../lib/source.ts";
import { ModelProviderRequestError } from "../lib/model-provider.ts";

function fakeClock(start = 0) {
  let now = start;
  const sleeps: number[] = [];
  const clock: JobClock = {
    now: () => now,
    random: () => 0.5,
    async sleep(ms, signal) {
      if (signal?.aborted) throw new AnalysisCancelledError();
      sleeps.push(ms);
      now += ms;
    },
  };
  return { clock, sleeps, now: () => now };
}

test("transient retries use deterministic capped backoff and Retry-After", async () => {
  const fake = fakeClock();
  let attempts = 0;
  const value = await withTransientRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw new SourceError("fetchFailed", undefined, 900);
    if (attempts === 2) throw new ModelProviderRequestError("providerConnectionFailed");
    return "ok";
  }, { clock: fake.clock, policy: { attempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 } });
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(fake.sleeps, [900, 200]);
});

test("permanent and security failures are never retried", async () => {
  for (const failure of [
    new SourceError("privateNetwork"),
    new SourceError("unsupportedContentType"),
    new ModelProviderRequestError("providerAuthenticationFailed"),
    new ModelProviderRequestError("providerRequestRejected"),
  ]) {
    let attempts = 0;
    await assert.rejects(withTransientRetry(async () => {
      attempts += 1;
      throw failure;
    }, { clock: fakeClock().clock }), (error) => error === failure);
    assert.equal(attempts, 1);
  }
});

test("deadline and cancellation stop before another attempt without wall-clock sleep", async () => {
  const fake = fakeClock();
  await assert.rejects(
    withTransientRetry(async () => { throw new SourceError("fetchFailed"); }, {
      clock: fake.clock,
      deadline: 200,
      policy: { attempts: 3, baseDelayMs: 250 },
    }),
    AnalysisBudgetExceededError,
  );
  assert.deepEqual(fake.sleeps, []);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    withTransientRetry(async () => "unreachable", { signal: controller.signal, clock: fake.clock }),
    AnalysisCancelledError,
  );
});

test("host-aware mapper enforces overall and per-host limits while preserving order", async () => {
  let active = 0;
  let maxActive = 0;
  const activeByHost = new Map<string, number>();
  const maxByHost = new Map<string, number>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const urls = ["https://a.test/1", "https://a.test/2", "https://b.test/1", "https://c.test/1"];
  const work = mapWithHostLimits(urls, async (url) => {
    const host = new URL(url).host;
    active += 1;
    maxActive = Math.max(maxActive, active);
    activeByHost.set(host, (activeByHost.get(host) ?? 0) + 1);
    maxByHost.set(host, Math.max(maxByHost.get(host) ?? 0, activeByHost.get(host)!));
    await gate;
    active -= 1;
    activeByHost.set(host, activeByHost.get(host)! - 1);
    return url;
  }, { overall: 2, perHost: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maxActive, 2);
  assert.equal(maxByHost.get("a.test"), 1);
  release();
  const results = await work;
  assert.deepEqual(results.map((item) => item.status === "fulfilled" ? item.value : "failed"), urls);
});

test("public cache is bounded, clone-safe, and expires using an injected clock", () => {
  let now = 100;
  const cache = new PublicSourceCache<{ text: string }>({ maxEntries: 2, ttlMs: 50, now: () => now });
  cache.set("a", { text: "one" });
  cache.set("b", { text: "two" });
  const copy = cache.get("a")!;
  copy.text = "mutated";
  assert.equal(cache.get("a")!.text, "one");
  cache.set("c", { text: "three" });
  assert.equal(cache.get("b"), undefined);
  now = 151;
  assert.equal(cache.get("a"), undefined);
  cache.clear();
  assert.equal(cache.size, 0);
});
