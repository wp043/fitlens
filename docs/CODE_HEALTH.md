# Code-health ratchets

`pnpm check` includes two low-cost, cross-platform ratchets. They are intended
to keep a decomposition moving forward without rewarding tiny files or making
the complete browser suite part of every edit loop.

## Production file size

`pnpm check:code-health` recursively inspects TypeScript, TSX, and MJS files in
`app/`, `components/`, `lib/`, and `scripts/`. A production file may contain at
most 500 physical lines by default. That is a review signal, not a target:
cohesive files should remain smaller when their ownership is naturally narrow.

Existing files above the limit must appear in
`config/code-health-baseline.json` with an exact line baseline and a reason.
Actual lines must equal `maxLines`: growth fails, while shrinkage also fails
with an instruction to lower the baseline (or remove the exception once the
file reaches 500 lines). This prevents a file from shrinking and later growing
back into unused allowance. The workbench entry additionally records its
pre-decomposition size so the gate proves this sprint made a real reduction.
The checker also fails when an exception disappears or lacks a reason.

To intentionally update a baseline:

1. Prefer extracting a cohesive owner and keep every new file under 500 lines.
2. Run `pnpm check:code-health` and record the new physical line count.
3. Lower an existing `maxLines`; never raise it in an unrelated change.
4. If a larger file is genuinely safer, add a narrowly justified exception in
   the same review and explain why splitting it would weaken ownership.

## Focused coverage

`pnpm test:coverage-ratchet` uses Node's built-in test runner and coverage. A
small dependency-free wrapper reads only the `lib/workbench-state.ts` row from
the report, so it works on the project's supported Node line without relying on
the threshold/include flags introduced in Node 22. It requires 100% line
coverage, 100% function coverage, and at least 90% branch coverage. The scope
is explicit so unrelated catalogs or browser-only adapters cannot dilute the
signal.

When adding pure workbench workflow logic, put it in this boundary or another
small deterministic module, add Node tests, and extend the include list and
thresholds deliberately. Do not lower a threshold to accommodate uncovered new
behavior. UI wiring, accessibility, persistence, cancellation, and visual
contracts remain covered by Playwright and the production black-box harness.
