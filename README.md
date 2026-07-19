# FitLens

FitLens is an evidence-first product comparison tool. It analyzes two similar
products against a person’s actual workflow, separates verifiable facts from
vendor claims and inference, and explains why one option is a better fit.
It is designed to run locally with each user’s own API credentials.

## Capabilities

- Analyze official product pages and documentation.
- Discover linked GitHub repositories and enrich open-source products with
  license, README, and repository metadata.
- Keep verified, vendor-provided, and inferred evidence visibly separate.
- Recalculate the recommendation as personal priorities change.
- Surface unknowns and generate a short hands-on trial plan.
- Keep recent reports in local browser storage.
- Use an OpenAI API key from `.env.local` or keep one only for the current
  browser session.
- Save reusable preference profiles.
- Show evidence coverage and analysis freshness.
- Add local hands-on research notes.
- Copy a decision brief or export a complete report as Markdown or JSON.
- Import JSON reports for backup and transfer.
- Reject local and private-network URLs before fetching external content.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.
You can enter an OpenAI API key in the local interface. It is kept in
`sessionStorage`, excluded from reports and exports, and removed when the
browser session ends.

Alternatively, create `.env.local` with the variables below.

## Configuration

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
GITHUB_TOKEN=
```

`OPENAI_API_KEY` is the server-side alternative to the session-only key field.
`GITHUB_TOKEN` is optional and raises GitHub API rate limits.

## Analysis pipeline

1. Validate both URLs and reject local or private-network targets.
2. Extract relevant text from each public product page.
3. Discover an official GitHub repository when one is linked.
4. Collect repository metadata and README content.
5. Produce a shared comparison schema with the OpenAI Responses API and
   Structured Outputs.
6. Recalculate weighted fit scores in the browser.
7. Calculate visible evidence coverage from evidence type and source diversity.
8. Save completed reports, preferences, and notes in local browser storage.

## Development commands

```bash
npm test
npm run lint
npm run build
```

## Project structure

```text
app/                  Next.js routes and API endpoint
components/           Interactive comparison workspace
lib/source.ts         Homepage and GitHub evidence collection
lib/analyzer.ts       Structured model analysis
lib/scoring.ts        Preference-weighted scoring
lib/report.ts         Portable reports and evidence coverage
docs/                 Research and product documentation
test/                 URL-safety and scoring tests
```

## Local data and API keys

- Report history, notes, and custom preference profiles stay in
  `localStorage`.
- A key entered in the interface stays in `sessionStorage`.
- API keys are not written into report history, Markdown, JSON, or source
  files.
- Product source material is sent to the configured OpenAI model to generate
  the structured comparison.
