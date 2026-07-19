# FitLens

FitLens compares two similar products against one person's real workflow. It
keeps three evidence levels separate:

- **Verified** — public source code, repository metadata, or README evidence.
- **Vendor** — claims found on the official product site.
- **Inferred** — an explicitly labeled conclusion, never presented as fact.

The included demo compares [cmux](https://cmux.com/) with
[Otty](https://otty.sh/). The interface remains useful without API credentials;
arbitrary URL comparisons require an OpenAI API key.

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
```

## Current MVP boundary

- Two products per report.
- One homepage and one discovered GitHub repository per product.
- No persistence or login yet.
- The deployed sample works without secrets; arbitrary analyses require
  `OPENAI_API_KEY`.
