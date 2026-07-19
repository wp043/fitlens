# FitLens

FitLens is an evidence-first product comparison tool. It analyzes two similar
products against a person’s actual workflow, separates verifiable facts from
vendor claims and inference, and explains why one option is a better fit.

## Capabilities

- Analyze official product pages and documentation.
- Discover linked GitHub repositories and enrich open-source products with
  license, README, and repository metadata.
- Keep verified, vendor-provided, and inferred evidence visibly separate.
- Recalculate the recommendation as personal priorities change.
- Surface unknowns and generate a short hands-on trial plan.
- Keep recent reports in local browser storage.
- Copy a decision brief or export a complete report as Markdown.
- Reject local and private-network URLs before fetching external content.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.
Create `.env.local` with the variables below to enable live analysis.

## Configuration

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
GITHUB_TOKEN=
```

`OPENAI_API_KEY` enables analysis for arbitrary product URLs.
`GITHUB_TOKEN` is optional and raises GitHub API rate limits.

## Analysis pipeline

1. Validate both URLs and reject local or private-network targets.
2. Extract relevant text from each public product page.
3. Discover an official GitHub repository when one is linked.
4. Collect repository metadata and README content.
5. Produce a shared comparison schema with the OpenAI Responses API and
   Structured Outputs.
6. Recalculate weighted fit scores in the browser.
7. Save completed reports locally for quick return and export.

## Development commands

```bash
npm test
npm run lint
npm run build
npm run build:sites
```

`build:sites` packages the application as an OpenNext Cloudflare Worker in
`.open-next/`.

## Project structure

```text
app/                  Next.js routes and API endpoint
components/           Interactive comparison workspace
lib/source.ts         Homepage and GitHub evidence collection
lib/analyzer.ts       Structured model analysis
lib/scoring.ts        Preference-weighted scoring
docs/                 Research and product documentation
test/                 URL-safety and scoring tests
```
