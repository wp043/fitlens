# Resilient analysis jobs

FitLens treats each analysis as a bounded, cancellable local job. The browser's
request signal reaches source collection and the model provider. The CLI maps
`SIGINT` to the same cancellation path. Cancelling or failing a run does not
clear form inputs or replace the last successful report, so retry always starts
from the visible draft.

## Budgets and retries

- A job has a 55-second service budget, below the route's 60-second ceiling.
  The deadline is an active abort signal, so it interrupts an in-flight source,
  guarded browser, or model operation rather than waiting for an attempt to end.
- At most three candidates collect concurrently and at most one candidate per
  hostname. Input order is preserved.
- Source requests make at most three attempts. Model requests make at most two.
- Backoff is exponential with bounded jitter (250 ms–2 s). A numeric
  `Retry-After` header is honored within the same cap.
- Only transport failures, 408/425/429, 5xx, and equivalent transient provider
  failures retry. Validation, authentication, unsafe URL/DNS, content-type,
  size, and other permanent 4xx failures never retry.
- Every source retry starts collection again. It therefore performs URL and DNS
  validation again; retries never reuse a resolved address or bypass SSRF
  guards.

The clock, sleep function, and jitter source are injectable. Unit tests advance
a fake clock and never wait for retry delays in wall-clock time.

## Public-source cache

Successful, credential-free collection through the built-in collector may be
cached in memory for five minutes. The cache is process-local, clone-on-read,
LRU-bounded to 64 entries, and disappears on restart. `clearPublicSourceCache()`
provides explicit invalidation for tests or future local administration.

The cache is disabled whenever `GITHUB_TOKEN` is present or a custom collector
is injected. It stores only normalized public source snapshots. It never stores
API keys, request headers, user context, criteria, model input/output, reports,
errors, or private-network content.

## Recovery behavior

The UI exposes a cancel action and progress copy in Chinese and English. A
cancelled or timed-out attempt leaves URLs, scenario, criteria, API-key session
state, and the previous successful report untouched. The same Analyze/Refresh
action can be used immediately after the cancellation/error response. The API
uses stable `analysis_cancelled`/`analysis_budget_exceeded` run-manifest codes;
the CLI exits non-zero and accepts Ctrl-C without persisting partial output.
