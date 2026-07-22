import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  identifyMarketplace,
  parseMarketplaceMetadata,
} from "../lib/source-adapters/marketplaces.ts";
import { discoverSourceDocuments } from "../lib/source-adapters/registry.ts";
import {
  collectProductSource,
  type SourceNetworkDependencies,
} from "../lib/source.ts";

const fixtureDirectory = fileURLToPath(
  new URL("./fixtures/real-sites/", import.meta.url),
);

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(fixtureDirectory, name), "utf8")) as T;
}

interface FixtureEnvelope<T> {
  fixtureVersion: number;
  sourceUrl: string;
  capturedAt: string;
  payload: T;
}

test("every real-site fixture records a stable source and capture time", async () => {
  const files = (await readdir(fixtureDirectory)).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 5);
  for (const file of files) {
    const value = await fixture<Record<string, unknown>>(file);
    assert.equal(value.fixtureVersion, 1, file);
    assert.equal(Number.isNaN(Date.parse(String(value.capturedAt))), false, file);
    if (value.sourceUrl) assert.equal(new URL(String(value.sourceUrl)).protocol, "https:", file);
    if (Array.isArray(value.sites)) {
      for (const site of value.sites as Array<{ sourceUrl: string }>) {
        assert.equal(new URL(site.sourceUrl).protocol, "https:", file);
      }
    }
  }
});

test("parses curated npm, PyPI, and Apple API snapshots", async () => {
  const npm = await fixture<FixtureEnvelope<Record<string, unknown>>>("npm-next.json");
  const npmMetadata = parseMarketplaceMetadata(
    identifyMarketplace("https://www.npmjs.com/package/next")!,
    JSON.stringify(npm.payload),
  )!;
  assert.equal(npmMetadata.name, "next");
  assert.equal(npmMetadata.repositoryUrl, "https://github.com/vercel/next.js");
  assert.match(npmMetadata.document.text, /Latest version: 16\.2\.11/);

  const pypi = await fixture<FixtureEnvelope<Record<string, unknown>>>("pypi-requests.json");
  const pypiMetadata = parseMarketplaceMetadata(
    identifyMarketplace("https://pypi.org/project/requests/")!,
    JSON.stringify(pypi.payload),
  )!;
  assert.equal(pypiMetadata.repositoryUrl, "https://github.com/psf/requests");
  assert.match(pypiMetadata.document.text, /Latest version: 2\.34\.2/);

  const apple = await fixture<FixtureEnvelope<Record<string, unknown>>>("app-store-bear.json");
  const appMetadata = parseMarketplaceMetadata(
    identifyMarketplace("https://apps.apple.com/us/app/bear-markdown-notes/id1016366447")!,
    JSON.stringify(apple.payload),
  )!;
  assert.equal(appMetadata.name, "Bear - Markdown Notes");
  assert.match(appMetadata.document.text, /Rating count: 6841/);
});

test("keeps Chrome Web Store extraction compatible with a real listing snapshot", async () => {
  const chrome = await fixture<{
    sourceUrl: string;
    html: string;
  }>("chrome-ublock.json");
  const dependencies: SourceNetworkDependencies = {
    resolveHostname: async () => ["142.250.72.206"],
    fetch: async (input) => {
      if (String(input) === chrome.sourceUrl) {
        return new Response(chrome.html, { headers: { "content-type": "text/html" } });
      }
      return new Response("not found", {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  };
  const source = await collectProductSource(chrome.sourceUrl, dependencies);
  assert.equal(source.name, "uBlock Origin");
  assert.equal(source.documents[0].kind, "store");
  assert.match(source.documents[0].text, /12,000,000 users/);
  assert.match(source.documents[0].text, /will not collect or use your data/);
});

test("recognizes live-style official document links without network access", async () => {
  const captured = await fixture<{
    sites: Array<{
      sourceUrl: string;
      links: Array<{ url: string; label: string }>;
    }>;
  }>("product-links.json");
  const otty = discoverSourceDocuments(captured.sites[0].sourceUrl, captured.sites[0].links);
  assert.deepEqual(otty.map((item) => item.kind), [
    "pricing",
    "privacy",
    "changelog",
    "documentation",
  ]);
  const cmux = discoverSourceDocuments(captured.sites[1].sourceUrl, captured.sites[1].links);
  assert.deepEqual(cmux.map((item) => item.kind), [
    "privacy",
    "changelog",
    "documentation",
  ]);
});
