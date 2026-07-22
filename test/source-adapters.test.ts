import assert from "node:assert/strict";
import test from "node:test";
import { discoverSourceDocuments } from "../lib/source-adapters/registry.ts";
import {
  collectProductSource,
  type SourceNetworkDependencies,
} from "../lib/source.ts";

test("discovers one high-value official document per adapter kind", () => {
  const documents = discoverSourceDocuments("https://acme.example/", [
    { url: "https://acme.example/pricing?utm_source=nav#plans", label: "Pricing" },
    { url: "https://docs.acme.example/guide", label: "Documentation" },
    { url: "https://acme.example/legal/privacy", label: "Privacy policy" },
    { url: "https://acme.example/trust/security", label: "Security" },
    { url: "https://acme.example/changelog", label: "What is new" },
    { url: "https://outside.example/pricing", label: "Partner pricing" },
    { url: "mailto:hello@acme.example", label: "Contact" },
  ]);

  assert.deepEqual(
    documents.map(({ kind, url }) => ({ kind, url })),
    [
      { kind: "pricing", url: "https://acme.example/pricing" },
      { kind: "privacy", url: "https://acme.example/legal/privacy" },
      { kind: "security", url: "https://acme.example/trust/security" },
      { kind: "changelog", url: "https://acme.example/changelog" },
      { kind: "documentation", url: "https://docs.acme.example/guide" },
    ],
  );
});

test("collects supplemental pages without failing the homepage on an optional error", async () => {
  const calls: string[] = [];
  const dependencies: SourceNetworkDependencies = {
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/pricing")) {
        return new Response("upstream unavailable", {
          status: 503,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.endsWith("/privacy")) {
        return new Response(
          "<html><title>Privacy</title><body>We retain account data for 30 days.</body></html>",
          { headers: { "content-type": "text/html" } },
        );
      }
      return new Response(
        `<html><head><title>Acme</title><meta name="description" content="Useful software"></head><body>
          <a href="/pricing">Plans</a>
          <a href="/privacy">Privacy policy</a>
          Product homepage
        </body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  };

  const source = await collectProductSource("https://acme.example", dependencies);
  assert.equal(source.name, "Acme");
  assert.deepEqual(source.documents.map((document) => document.kind), ["privacy"]);
  assert.match(source.documents[0].text, /retain account data/i);
  assert.deepEqual(calls, [
    "https://acme.example/",
    "https://acme.example/pricing",
    "https://acme.example/privacy",
  ]);
});
