# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/wp043/fitlens/compare/main...HEAD
