# Security Policy

FitLens is a **local-first** tool. It fetches attacker-controlled URLs and sends
their contents to a language model, so its security posture is documented here
in full rather than summarized.

## Supported versions

FitLens has not cut a stable release. Only the current `main` branch receives
security fixes.

## Reporting a vulnerability

Report privately through GitHub's
[private vulnerability reporting](https://github.com/wp043/fitlens/security/advisories/new)
on this repository. Please do not open a public issue for an unfixed
vulnerability.

Include the affected component, reproduction steps, and what an attacker gains.
Expect an initial response within 7 days. This is a personal project maintained
in spare time; there is no bug bounty and no guaranteed remediation timeline.

## Intended deployment model

FitLens is designed to run on `localhost`, used by the single person who
started it.

**Do not expose FitLens to untrusted users or the public internet.** The
following are deliberate design choices that are safe locally and unsafe when
hosted:

- **No authentication or authorization.** Anyone who can reach the port has
  full use of the tool and the configured model credentials.
- **Rate limits are process-local counters**, not a distributed limiter. They
  bound accidental load, not a determined attacker.
- **Browser storage is not a secret vault.** API keys entered in the UI live in
  `sessionStorage`; reports live in IndexedDB with a `localStorage` fallback.
  This is appropriate for a single-user local tool only.
- **HSTS is intentionally absent**, because local use is over HTTP.

Binding the server to a non-loopback interface, or placing it behind a proxy,
changes the trust model and is unsupported without real authentication and
network policy.

## Server-side request forgery (SSRF)

Fetching user-supplied URLs is the tool's core function, so `lib/source.ts`
treats every submitted URL and every redirect target as hostile:

- Only HTTP and HTTPS URLs without embedded credentials are accepted.
- DNS is resolved before each request. Any private, loopback, link-local,
  reserved, multicast, or unspecified IPv4/IPv6 answer rejects the host.
- The validated address set is immutable and is supplied directly to the HTTP
  connection lookup, so the socket connects to the addresses that policy
  approved. This closes the DNS-rebinding (TOCTOU) window between policy
  evaluation and socket creation.
- Redirects are manual, capped at five hops, and each hop repeats the full
  process with a fresh destination-specific dispatcher.
- `Authorization` is stripped on cross-origin redirects.
- Content types are allowlisted per route.
- Streamed bytes are capped by actual count; `Content-Length` is not trusted.

Opt-in browser rendering gives Chromium the initial HTML offline and re-fetches
external scripts, styles, and data through the same guarded Node transport.
Media, fonts, WebSockets, service workers, non-GET requests, and
bounded-resource overages are blocked.

**Defense in depth:** if you run FitLens anywhere other than a trusted
workstation, enforce an outbound firewall or egress proxy as well. Application
-level SSRF controls are a mitigation, not a substitute for network policy.

## Prompt injection

Collected pages are attacker-controlled text handed to a model, so injection is
treated as expected input rather than an edge case:

- Source material is serialized only under `UNTRUSTED_SOURCE_DATA`, structurally
  separate from `TRUSTED_USER_REQUIREMENTS`.
- Provider instructions forbid those values from changing rules, scoring,
  candidate order, or the response schema.
- Adversarial tests keep embedded page commands out of the instruction channel.
- Structured output and cross-field validation enforce the contract after
  generation.

**Known limitation:** prompt isolation reduces injection risk but cannot
guarantee that every model ignores every adversarial source. Treat FitLens
output as research to review, not as a decision to execute. The model never
receives browser history, saved notes, trial results, or other reports.

## Credentials

- Provider keys are read from the environment or entered per session in the UI.
  They are never written to a report, an export, or a run manifest.
- Remote provider base URLs require HTTPS. Unauthenticated HTTP is permitted
  only on loopback.
- Provider errors map to stable public codes; upstream bodies, stack traces,
  and secret-bearing messages are not retained.
- `fitlens doctor` redacts diagnostics before printing.
- Share-safe exports strip private context, notes, trials, revisions, and
  manual evidence.

`FITLENS_DISABLE_LIVE_ANALYSIS=1` is a fail-closed switch: the request is
schema-validated, then returns the missing-credentials boundary before any
source collection or provider activity.

## Scope

In scope: SSRF and URL/DNS/redirect policy bypass, prompt injection that
escapes the untrusted-data channel, credential leakage into reports, exports,
manifests, logs, or diagnostics, and sandbox escapes in guarded rendering.

Out of scope: anything that requires the operator to have already exposed
FitLens to untrusted users, since that is documented above as unsupported.
