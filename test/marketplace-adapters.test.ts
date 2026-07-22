import assert from "node:assert/strict";
import test from "node:test";
import {
  chromeStoreDocument,
  identifyMarketplace,
  parseMarketplaceMetadata,
} from "../lib/source-adapters/marketplaces.ts";
import {
  collectProductSource,
  type SourceNetworkDependencies,
} from "../lib/source.ts";

test("identifies supported official marketplace listings", () => {
  assert.deepEqual(
    identifyMarketplace("https://www.npmjs.com/package/@scope/tool"),
    {
      kind: "npm",
      id: "@scope/tool",
      pageUrl: "https://www.npmjs.com/package/@scope/tool",
      metadataUrl: "https://registry.npmjs.org/@scope%2Ftool",
    },
  );
  assert.equal(
    identifyMarketplace("https://pypi.org/project/requests/")?.metadataUrl,
    "https://pypi.org/pypi/requests/json",
  );
  assert.equal(
    identifyMarketplace("https://apps.apple.com/us/app/example/id123456789")?.id,
    "123456789",
  );
  assert.equal(
    identifyMarketplace(
      "https://chromewebstore.google.com/detail/example/abcdefghijklmnopabcdefghijklmnop",
    )?.kind,
    "chrome-web-store",
  );
});

test("normalizes npm registry metadata into evidence", () => {
  const target = identifyMarketplace("https://www.npmjs.com/package/fit-tool")!;
  const metadata = parseMarketplaceMetadata(
    target,
    JSON.stringify({
      name: "fit-tool",
      description: "A focused comparison tool",
      "dist-tags": { latest: "2.1.0" },
      time: { "2.1.0": "2026-07-20T00:00:00.000Z" },
      versions: {
        "2.1.0": {
          license: "MIT",
          engines: { node: ">=20" },
          repository: { url: "git+https://github.com/acme/fit-tool.git" },
        },
      },
    }),
  )!;

  assert.equal(metadata.name, "fit-tool");
  assert.equal(metadata.repositoryUrl, "https://github.com/acme/fit-tool");
  assert.equal(metadata.document.kind, "registry");
  assert.match(metadata.document.text, /Latest version: 2.1.0/);
  assert.match(metadata.document.text, /License: MIT/);
});

test("normalizes PyPI and App Store metadata without inventing fields", () => {
  const pypi = parseMarketplaceMetadata(
    identifyMarketplace("https://pypi.org/project/fit-tool/")!,
    JSON.stringify({
      info: {
        name: "fit-tool",
        version: "1.4.0",
        summary: "Evidence-aware comparisons",
        requires_python: ">=3.11",
        project_urls: { Source: "https://github.com/acme/fit-tool" },
      },
      releases: {
        "1.4.0": [{ upload_time_iso_8601: "2026-07-20T00:00:00Z" }],
      },
    }),
  )!;
  assert.equal(pypi.document.kind, "registry");
  assert.match(pypi.document.text, /Python requirement: >=3.11/);

  const app = parseMarketplaceMetadata(
    identifyMarketplace("https://apps.apple.com/us/app/example/id123456789")!,
    JSON.stringify({
      results: [{
        trackName: "Fit Tool",
        sellerName: "Acme",
        version: "3.0",
        formattedPrice: "Free",
        description: "Compare products locally.",
      }],
    }),
  )!;
  assert.equal(app.document.kind, "store");
  assert.match(app.document.text, /Developer: Acme/);
});

test("creates Chrome Web Store evidence from its guarded listing page", () => {
  const target = identifyMarketplace(
    "https://chromewebstore.google.com/detail/example/abcdefghijklmnopabcdefghijklmnop",
  )!;
  const document = chromeStoreDocument(
    target,
    "Example extension",
    "A browser helper",
    "Permissions and support information",
  );
  assert.equal(document.kind, "store");
  assert.match(document.text, /Extension ID: abcdefghijklmnopabcdefghijklmnop/);
});

test("collects registry metadata before falling back to listing HTML", async () => {
  const calls: string[] = [];
  const dependencies: SourceNetworkDependencies = {
    resolveHostname: async () => ["104.16.24.34"],
    fetch: async (input) => {
      calls.push(String(input));
      return Response.json({
        name: "fit-tool",
        description: "A registry-backed product",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { license: "MIT" } },
      });
    },
  };

  const source = await collectProductSource(
    "https://www.npmjs.com/package/fit-tool",
    dependencies,
  );
  assert.equal(source.name, "fit-tool");
  assert.equal(source.documents[0].kind, "registry");
  assert.deepEqual(calls, ["https://registry.npmjs.org/fit-tool"]);
});
