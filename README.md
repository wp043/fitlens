# FitLens

FitLens compares two similar products against one person's real workflow. It
keeps three evidence levels separate:

- **Verified** — public source code, repository metadata, or README evidence.
- **Vendor** — claims found on the official product site.
- **Inferred** — an explicitly labeled conclusion, never presented as fact.

The homepage is a blank, product-agnostic comparison flow. A separate
[`/examples/cmux-vs-otty`](http://localhost:3000/examples/cmux-vs-otty) report
shows a completed comparison of [cmux](https://cmux.com/) and
[Otty](https://otty.sh/). The example remains available without API
credentials; arbitrary URL comparisons require an OpenAI API key.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## How analysis works

1. Validate both URLs and reject local/private-network targets.
2. Extract the public homepage text.
3. Discover a linked GitHub repository when one is present.
4. Enrich open-source products with repository metadata and README content.
5. Use the OpenAI Responses API with Structured Outputs to produce the same
   comparison schema for both products.
6. Recalculate the winner in the browser as preference weights change.

The default model is `gpt-5.6-luna`; override it with `OPENAI_MODEL`.

## Commands

```bash
npm test
npm run lint
npm run build
npm run build:sites
```

`build:sites` packages the Next.js output as an OpenNext Cloudflare Worker in
`.open-next/`, which is the artifact shape used by Sites.

## Current MVP boundary

- Two products per report.
- One homepage and one discovered GitHub repository per product.
- No persistence or login yet.
- The deployed sample works without secrets; arbitrary analyses require
  `OPENAI_API_KEY`.

See [the example methodology](docs/examples/cmux-vs-otty.md) for the evidence
boundary used in the bundled report.
