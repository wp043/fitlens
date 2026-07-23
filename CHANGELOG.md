# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `fitlens watch` can alert for a scheduler. `--alert-on winner,confidence,unknowns,any`
  and `--min-confidence <n>` turn a watched comparison's change into a non-zero
  exit (code 2) and an `alerts.json` summary in the output directory. Desktop
  notifications still work for interactive use; this makes the same signal usable
  headless from cron, a systemd timer, or CI. Alerting is opt-in, so the default
  `watch` behavior is unchanged.

## [0.1.0] - 2026-07-23

First published release. `npx fitlens demo`.

### Added

- `fitlens demo` renders a complete bundled comparison report offline, with no
  API key, no network access, and no provider configuration. The bundled sample
  existed before but was reachable only by submitting one exact pair of URLs
  with one exact set of criteria keys, which made it undiscoverable.
- The CLI is now installable. `package.json` declares a `bin` entry, and
  `pnpm build:cli` compiles `scripts/fitlens.ts` and its import graph to `dist/`
  via `tsconfig.cli.json`.
- `SECURITY.md` documents the deployment model, SSRF controls, prompt-injection
  boundary, credential handling, and reporting process.
- `--format text` renders a styled terminal report: score bars, evidence badges
  by level, and section rules. It is the default when stdout is a terminal;
  JSON remains the default for pipes, redirects, and scripts. ANSI is never
  written to a file, and `NO_COLOR` is honored. Zero new dependencies.
  Widths are measured in terminal cells, so East Asian text stays aligned, and
  Chinese line-breaking rules keep punctuation off the start of a line.
- `fitlens --version` (`-v`) prints the CLI version. A test asserts the exported
  constant matches `package.json` so it cannot drift.
- `analyze` reads candidate URLs from piped stdin, one per line, so
  `cat urls.txt | fitlens analyze --context "..."` works. Blank lines and `#`
  comments are ignored.
- `analyze --replay-out <path>` writes the run's offline replay bundle for later
  `fitlens replay`.
- `analyze --min-confidence <n>` exits `2` when the winner's confidence is below
  `n`, so a scheduled job can gate on a shaky recommendation. Exit codes are now
  `0` success, `1` error, `2` threshold not met.

### Changed

- `next`, `react`, `react-dom`, and `sharp` moved from `dependencies` to
  `devDependencies`. The CLI's import graph contains no framework code, so an
  installed package now pulls only `cheerio`, `openai`, `undici`, and `zod`.
  Installed footprint is 52 MB.
- Internal `lib/` modules import siblings by relative path instead of the `@/`
  app alias, so compiled output resolves at runtime outside the bundler.
- CI pins Node to `22.22.0` instead of floating `22`. Line-coverage attribution
  can shift across V8 patch releases, which could fail the 100% ratchet with no
  source change.
- `erasableSyntaxOnly` is enabled. `pnpm test` runs under Node's strip-only
  TypeScript mode, which rejects syntax `tsc` accepts, so the typecheck now
  catches that class of error instead of the test run.
- CI builds and smoke-tests the compiled CLI on every OS (`build:cli`, then
  `demo` in text and JSON, and `--version`), so a broken import path or
  non-erasable syntax in the entry script cannot ship green. A separate
  `cli-engines-floor` job runs the compiled CLI on Node 20.18.1 to test the
  advertised `engines` floor, since the dev toolchain itself requires Node 22.
- A `package-smoke` CI job packs the real tarball, installs it into a clean
  project with npm (as a consumer would), and runs the CLI from the installed
  `bin`. This tests the `files` allowlist, the `bin` mapping, the prepack build,
  and the trimmed dependency set end to end, catching packaging regressions that
  `build:cli` alone cannot.

### Fixed

- `.gitattributes` forces LF checkout. On Windows, CRLF shifted V8's coverage
  offset-to-line mapping and failed the ratchet with phantom uncovered lines.

### Fixed

- The coverage ratchet now reports the offending file, its uncovered lines, and
  the Node version on failure, instead of only a percentage. Its row regex is
  anchored so `workbench-state.test.ts` can no longer match the
  `workbench-state.ts` row.

### Security

- `.autonomous/`, `.wrangler/`, and `.openai/` are gitignored. They were
  untracked but unignored, so a `git add .` would have published local agent
  prompts and transcripts.
- `.env` ignore rule broadened to `.env.*` with an explicit `!.env.example`
  negation.

[Unreleased]: https://github.com/wp043/fitlens/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/wp043/fitlens/releases/tag/v0.1.0
