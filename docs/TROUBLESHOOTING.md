# FitLens troubleshooting

Start with `pnpm fitlens doctor`. Add `--check-playwright` only when diagnosing the
optional browser renderer, and `--probe-provider` only when you intend to make
an authenticated endpoint request. Use `--json --output .fitlens/doctor.json`
for a redacted bundle you can inspect before sharing.

## `pnpm install` or the build rejects Node

**Likely cause:** Node is older than 20.18.1, or the active pnpm major is not 10.

**Fix:** switch to a supported Node release, enable Corepack if needed, and run
`corepack prepare pnpm@10.22.0 --activate`. Confirm both versions with
`pnpm fitlens doctor`, then reinstall with `pnpm install --frozen-lockfile`.

## Analysis says the API key is missing

**Likely cause:** `OPENAI_API_KEY` is unset, the compatible provider has no key,
or `FITLENS_DISABLE_LIVE_ANALYSIS=1` is active.

**Fix:** inspect the provider line from `pnpm fitlens doctor`. Configure OpenAI or all
three compatible-provider values (`FITLENS_MODEL_BASE_URL`,
`FITLENS_MODEL_MODEL`, and a key unless the endpoint is loopback). Unset the
disable switch for normal use. Never paste a key into an issue or diagnostics
bundle.

## Compatible provider configuration is invalid

**Likely cause:** the endpoint is missing, remote HTTP is used, or the URL
contains credentials, a query, or a fragment.

**Fix:** use HTTPS for remote endpoints. Plain HTTP is accepted only for
`localhost`, `127.0.0.1`, or `::1`. Put credentials in
`FITLENS_MODEL_API_KEY`, not in the URL. After configuration passes locally,
use `pnpm fitlens doctor --probe-provider` to make one bounded `/models` probe.
A successful probe confirms reachability, not structured-output compatibility.

## Browser fallback does not start

**Likely cause:** Playwright is present but its matching Chromium build is not.

**Fix:** run `pnpm fitlens doctor --check-playwright`, then
`pnpm exec playwright install chromium` if requested. Browser rendering remains
opt-in through `FITLENS_BROWSER_FALLBACK=1`; static collection still works
without it.

## Browser requests to `/api/analyze` return 403 or 415

**Likely cause:** the request did not originate from the same loopback origin,
has no `Origin`/`Referer`, or is not JSON.

**Fix:** open FitLens at its local `localhost`/`127.0.0.1` URL and use the UI.
Custom clients must send `application/json` and an exact same-origin header.
Binding FitLens publicly or weakening these guards is unsupported.

## `pnpm test:production` fails while development works

**Likely cause:** the compiled artifact differs from `next dev`, the selected
port cannot be bound, or a production response contract regressed.

**Fix:** read the retained `next start` output printed on failure. Run
`pnpm build` first for compiler detail, then rerun `pnpm test:production`. The
harness chooses a fresh loopback port, strips provider credentials, sets the
fail-closed live-analysis switch, and never needs a public network connection.
