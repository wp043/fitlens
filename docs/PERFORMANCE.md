# Performance contracts and soak testing

FitLens separates correctness budgets from machine speed. The fast performance
contract asserts operation counts, concurrency, retry ceilings, retained
collection sizes, and serialized byte caps. It has no wall-clock pass/fail
threshold, so a slower CI runner does not turn into a false regression.

## Commands

```bash
pnpm test:performance
pnpm test:soak
pnpm test:soak -- --iterations 2000 --progress-every 250
pnpm test:soak -- --iterations 500 --heap-growth-mib 96
```

`pnpm check` includes the fast contract. The soak is deliberately separate:
it defaults to 500 iterations, enables explicit garbage collection, uses no
network or model credentials, and prints deterministic counters plus diagnostic
runtime and heap samples. A weekly/manual GitHub Actions workflow runs 1,000
iterations; its manual input can select another count.

## Production budgets

| Boundary | Budget | Contract |
| --- | ---: | --- |
| Candidates and criteria | 8 each | Worst supported comparison fixture uses both maxima. |
| Source scheduling | 3 overall, 1 per host | Eight operations must preserve both concurrency ceilings and input order. |
| Transient source attempts | 3 | A permanently transient fixture performs exactly three calls and two sleeps. |
| Model attempts | 2 | The analysis-service override is exercised independently of the source default. |
| Public source cache | 64 entries, 5-minute TTL | 128 writes cannot retain more than 64; expired reads remove entries. |
| Browser report history | 50 reports | Migration/normalization truncates oversized legacy history. |
| Report revisions | 5 | Complete export accepts five and rejects six. Revision replay payloads remain stripped. |
| Replay source snapshot | 8 sources; 12 documents/source | Max ASCII fixtures reach every source/document count limit. |
| Replay text | 120k page, 80k/document, 120k README | Creation truncates source fields before hashing and export. |
| Replay export | 16 MiB UTF-8 | Creation, serialization, and parsing fail closed above the byte cap. |
| Portable report export | 24 MiB UTF-8 | Complete export and import share the same byte cap. |
| Watch trend | 100 points | 151 deterministic snapshots retain the newest 100. |

The constants are imported from production modules. The contract does not keep
a second test-only copy of the limits.

## Soak workload

Each iteration repeats the same pure, realistic workflow with stable fixtures:

1. Normalize and migrate 75 legacy report records, retaining the newest allowed
   50 and reconstructing eight criteria.
2. Parse and hash-verify a replay bundle, then run its real deterministic
   finalizer for eight products and eight dimensions.
3. Diff the new result and append a real watch trend point, never retaining more
   than 100 points.
4. Churn the clone-safe source cache with four writes and reads, periodically
   advancing the injected clock beyond TTL.
5. Move and remove candidates while proving source failures remain attached to
   the correct URL and the shortlist stays at seven.

At 500 iterations this is 25,000 report migrations, 500 replay validations and
finalizations, 500 diffs, 2,000 cache writes, and 1,000 candidate mutations.
Every retained collection is checked on every iteration. After a 10% warmup,
explicit-GC heap growth must remain within 64 MiB by default. Runtime and peak
sampled heap are diagnostics only, not speed gates.

## Interpreting failures

- A concurrency, attempts, or counter mismatch means orchestration is doing
  more work than the production contract permits.
- A collection-size failure means eviction, truncation, or migration bounds no
  longer hold and long-running local sessions can retain data indefinitely.
- A byte-cap failure means a complete artifact can exceed the supported local
  import/export envelope.
- A replay failure means captured inputs no longer round-trip through the same
  validation and finalization path.
- Heap growth above budget, after deterministic retained counts pass, suggests
  hidden retention outside the explicitly tracked cache/trend/history objects.

## Limitations

These workloads measure application-controlled work, not browser rendering,
filesystem throughput, network collection, provider latency, or model quality.
UTF-8 byte limits are authoritative; character limits alone are not assumed to
predict file size. Explicit garbage collection makes heap comparisons more
useful but V8 can retain arenas and change allocation strategies between Node
versions, so the heap allowance is intentionally broad. Use a profiler before
treating a single heap number as a leak diagnosis.
