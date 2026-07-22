import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  assertPublicHost,
  collectProductSource,
  fetchAtValidatedAddresses,
  fetchRemoteText,
  isPublicIpAddress,
  needsBrowserRendering,
  SourceError,
  toPublicUrl,
  type SourceNetworkDependencies,
} from "../lib/source.ts";
import { parseAnalyzeRequest } from "../lib/analyze-request.ts";

test("accepts a public product URL", () => {
  assert.equal(toPublicUrl("https://otty.sh/#pricing").toString(), "https://otty.sh/");
});

test("detects JavaScript application shells without flagging content pages", () => {
  assert.equal(
    needsBrowserRendering(
      '<html><body><div id="root"></div><script src="/app.js"></script><script>boot()</script></body></html>',
      "",
    ),
    true,
  );
  assert.equal(
    needsBrowserRendering(
      '<html><body><main>Complete product documentation with enough directly readable detail for static collection.</main><script src="/metrics.js"></script></body></html>',
      "Complete product documentation with enough directly readable detail for static collection.",
    ),
    false,
  );
});

test("uses an available browser renderer only when it improves a thin page", async () => {
  let renderCalls = 0;
  const dependencies: SourceNetworkDependencies = {
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async () =>
      new Response(
        '<html><head><title>Dynamic Tool</title></head><body><div id="root"></div><script src="/runtime.js"></script><script src="/app.js"></script></body></html>',
        { headers: { "content-type": "text/html" } },
      ),
    async renderHtml() {
      renderCalls += 1;
      return '<html><head><title>Dynamic Tool</title><meta name="description" content="Rendered product"></head><body><main>Rendered pricing, workflow, privacy, and product documentation.</main></body></html>';
    },
  };

  const source = await collectProductSource("https://dynamic.example", dependencies);
  assert.equal(renderCalls, 1);
  assert.match(source.pageText, /Rendered pricing/);
  assert.equal(source.description, "Rendered product");
});

test("rejects local and private network targets", () => {
  for (const url of [
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://10.0.0.5",
    "http://192.168.1.2",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[::ffff:127.0.0.1]/",
  ]) {
    assert.throws(
      () => toPublicUrl(url),
      (error) => error instanceof SourceError && error.code === "privateNetwork",
    );
  }
});

test("classifies public and special-purpose IPv4 and IPv6 addresses", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isPublicIpAddress(address), true, address);
  }
  for (const address of [
    "0.0.0.0",
    "100.64.0.1",
    "127.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::192.168.1.1",
    "::ffff:10.0.0.1",
    "100::1",
    "2001:db8::1",
    "3fff::1",
    "fe80::1",
    "ff02::1",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
});

function network(
  resolveHostname: SourceNetworkDependencies["resolveHostname"],
  fetchImplementation: SourceNetworkDependencies["fetch"],
): SourceNetworkDependencies {
  return { resolveHostname, fetch: fetchImplementation };
}

test("rejects a hostname when any DNS answer is not globally routable", async () => {
  const dependencies = network(
    async () => ["93.184.216.34", "10.0.0.8"],
    async () => new Response("unused"),
  );
  await assert.rejects(
    assertPublicHost(new URL("https://example.com"), dependencies),
    (error) => error instanceof SourceError && error.code === "privateNetwork",
  );
});

test("pins the validated DNS answers to the request transport", async () => {
  const resolved = ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"];
  let pinned: readonly string[] | undefined;
  const dependencies = network(
    async () => [...resolved, resolved[0]],
    async (_input, _init, validatedAddresses) => {
      pinned = validatedAddresses;
      return new Response("safe", {
        headers: { "content-type": "text/plain" },
      });
    },
  );

  const result = await fetchRemoteText(
    "https://safe.example",
    {
      accept: "text/plain",
      allowedContentTypes: ["text/plain"],
      maxBytes: 100,
    },
    dependencies,
  );

  assert.equal(result.text, "safe");
  assert.deepEqual(pinned, resolved);
});

test("the pinned transport connects without resolving the URL hostname", async (t) => {
  let host: string | undefined;
  const server = createServer((request, response) => {
    host = request.headers.host;
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("pinned");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP server address.");
  }
  const response = await fetchAtValidatedAddresses(
    new URL(`http://unresolvable.invalid:${address.port}/evidence`),
    undefined,
    ["127.0.0.1"],
  );

  assert.equal(await response.text(), "pinned");
  assert.equal(host, `unresolvable.invalid:${address.port}`);
});

test("validates the DNS result for every redirect before requesting it", async () => {
  const requested: string[] = [];
  const dependencies = network(
    async (hostname) =>
      hostname === "safe.example" ? ["93.184.216.34"] : ["169.254.169.254"],
    async (input, init) => {
      requested.push(String(input));
      assert.equal(init?.redirect, "manual");
      return new Response(null, {
        status: 302,
        headers: { location: "http://metadata.example/latest" },
      });
    },
  );

  await assert.rejects(
    fetchRemoteText(
      "https://safe.example",
      {
        accept: "text/html",
        allowedContentTypes: ["text/html"],
        maxBytes: 100,
      },
      dependencies,
    ),
    (error) => error instanceof SourceError && error.code === "privateNetwork",
  );
  assert.deepEqual(requested, ["https://safe.example/"]);
});

test("caps redirect chains", async () => {
  let requests = 0;
  const dependencies = network(
    async () => ["93.184.216.34"],
    async () => {
      requests += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `/hop-${requests}` },
      });
    },
  );
  await assert.rejects(
    fetchRemoteText(
      "https://safe.example",
      {
        accept: "text/html",
        allowedContentTypes: ["text/html"],
        maxBytes: 100,
        maxRedirects: 2,
      },
      dependencies,
    ),
    (error) => error instanceof SourceError && error.code === "fetchFailed",
  );
  assert.equal(requests, 3);
});

test("does not forward credentials to a cross-origin redirect", async () => {
  const authorization: Array<string | null> = [];
  const dependencies = network(
    async () => ["93.184.216.34"],
    async (input, init) => {
      authorization.push(new Headers(init?.headers).get("authorization"));
      if (String(input) === "https://api.example/private") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example/public" },
        });
      }
      return new Response("safe", { headers: { "content-type": "text/plain" } });
    },
  );
  const result = await fetchRemoteText(
    "https://api.example/private",
    {
      accept: "text/plain",
      allowedContentTypes: ["text/plain"],
      maxBytes: 100,
      headers: { Authorization: "Bearer secret" },
    },
    dependencies,
  );
  assert.equal(result.text, "safe");
  assert.deepEqual(authorization, ["Bearer secret", null]);
});

test("rejects unexpected content types and streamed bodies over the byte limit", async () => {
  const resolver = async () => ["93.184.216.34"];
  await assert.rejects(
    fetchRemoteText(
      "https://safe.example",
      {
        accept: "text/html",
        allowedContentTypes: ["text/html"],
        maxBytes: 100,
      },
      network(
        resolver,
        async () =>
          new Response("not html", {
            headers: { "content-type": "application/octet-stream" },
          }),
      ),
    ),
    (error) =>
      error instanceof SourceError && error.code === "unsupportedContentType",
  );

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(60));
      controller.enqueue(new Uint8Array(60));
      controller.close();
    },
  });
  await assert.rejects(
    fetchRemoteText(
      "https://safe.example",
      {
        accept: "text/html",
        allowedContentTypes: ["text/html"],
        maxBytes: 100,
      },
      network(
        resolver,
        async () => new Response(body, { headers: { "content-type": "text/html" } }),
      ),
    ),
    (error) => error instanceof SourceError && error.code === "pageTooLarge",
  );
});

test("collects GitHub metadata and README through the guarded transport", async () => {
  const calls: string[] = [];
  const dependencies = network(
    async () => ["140.82.112.5"],
    async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/readme")) {
        return new Response("# Widget\nSecure README", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      if (url.endsWith("/releases/latest")) {
        return Response.json({
          name: "Widget 2.0",
          tag_name: "v2.0.0",
          html_url: "https://github.com/acme/widget/releases/tag/v2.0.0",
          published_at: "2026-07-19T00:00:00Z",
          body: "Adds a faster workflow.",
        });
      }
      return Response.json({
        full_name: "acme/widget",
        html_url: "https://github.com/acme/widget",
        homepage: "https://widget.example",
        description: "A widget",
        license: { spdx_id: "MIT" },
        default_branch: "main",
        stargazers_count: 42,
        forks_count: 3,
        open_issues_count: 1,
        pushed_at: "2026-07-20T00:00:00Z",
        archived: false,
        topics: ["widget"],
        name: "widget",
      });
    },
  );

  const source = await collectProductSource(
    "https://github.com/acme/widget",
    dependencies,
  );
  assert.equal(source.sourceMode, "open-source");
  assert.equal(source.repo?.license, "MIT");
  assert.equal(source.repo?.latestRelease?.tagName, "v2.0.0");
  assert.equal(source.documents[0]?.kind, "release");
  assert.match(source.pageText, /Secure README/);
  assert.deepEqual(calls, [
    "https://api.github.com/repos/acme/widget",
    "https://api.github.com/repos/acme/widget/readme",
    "https://api.github.com/repos/acme/widget/releases/latest",
  ]);
});

test("rejects non-http protocols and credentials", () => {
  assert.throws(
    () => toPublicUrl("file:///etc/passwd"),
    (error) => error instanceof SourceError && error.code === "httpOnly",
  );
  assert.throws(
    () => toPublicUrl("https://user:secret@example.com"),
    (error) =>
      error instanceof SourceError && error.code === "credentialsNotAllowed",
  );
});

test("validates every URL in a multi-product analysis request", () => {
  const criteria = [
    { key: "fit", label: "Fit", hint: "Workflow fit", weight: 70 },
    { key: "cost", label: "Cost", hint: "Total cost", weight: 60 },
  ];
  const valid = parseAnalyzeRequest({
    urls: [
      "https://one.example/",
      "https://two.example/",
      "https://three.example/",
    ],
    context: "A sufficiently detailed comparison context.",
    criteria,
    locale: "en",
  });
  assert.equal(valid.urls.length, 3);

  assert.throws(() =>
    parseAnalyzeRequest({
      ...valid,
      urls: [valid.urls[0], valid.urls[1], "http://127.0.0.1/admin"],
    }),
  );
  assert.throws(() => parseAnalyzeRequest({ ...valid, urls: [valid.urls[0]] }));
  assert.throws(() =>
    parseAnalyzeRequest({
      ...valid,
      urls: ["https://one.example/#first", "https://one.example/#second"],
    }),
  );
});
