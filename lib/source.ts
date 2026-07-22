import * as cheerio from "cheerio";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Route } from "playwright";
import { discoverSourceDocuments } from "./source-adapters/registry.ts";
import {
  chromeStoreDocument,
  identifyMarketplace,
  parseMarketplaceMetadata,
} from "./source-adapters/marketplaces.ts";
import type {
  CollectedSourceDocument,
  SourceLink,
} from "./source-adapters/types.ts";

export type SourceErrorCode =
  | "invalidUrl"
  | "httpOnly"
  | "credentialsNotAllowed"
  | "privateNetwork"
  | "fetchFailed"
  | "unsupportedContentType"
  | "pageTooLarge"
  | "githubFailed";

export class SourceError extends Error {
  readonly code: SourceErrorCode;
  readonly detail?: string;

  constructor(code: SourceErrorCode, detail?: string) {
    super(code);
    this.name = "SourceError";
    this.code = code;
    this.detail = detail;
  }
}

export interface CollectedSource {
  inputUrl: string;
  homepageUrl: string;
  name: string;
  description: string;
  sourceMode: "open-source" | "website-only";
  pageText: string;
  documents: CollectedSourceDocument[];
  repo?: {
    fullName: string;
    url: string;
    description: string;
    license: string;
    defaultBranch: string;
    stars: number;
    forks: number;
    openIssues: number;
    pushedAt: string;
    archived: boolean;
    topics: string[];
    readme: string;
    latestRelease?: {
      name: string;
      tagName: string;
      url: string;
      publishedAt: string;
      notes: string;
    };
  };
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
];

export interface SourceNetworkDependencies {
  fetch: typeof globalThis.fetch;
  resolveHostname: (hostname: string) => Promise<string[]>;
  renderHtml?: (html: string, pageUrl: string) => Promise<string>;
}

const defaultNetworkDependencies: SourceNetworkDependencies = {
  fetch: globalThis.fetch,
  async resolveHostname(hostname) {
    const results = await lookup(hostname, { all: true, verbatim: true });
    return results.map(({ address }) => address);
  },
};

function ipv4Number(address: string): number | undefined {
  if (isIP(address) !== 4) return undefined;
  const octets = address.split(".").map(Number);
  return (
    ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>>
    0
  );
}

function inV4Range(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function isForbiddenIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === undefined) return true;
  return [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ].some(([base, prefix]) =>
    inV4Range(value, ipv4Number(base as string)!, prefix as number),
  );
}

function expandIpv6(address: string): number[] | undefined {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) !== 6) return undefined;
  const [leftRaw, rightRaw] = normalized.split("::");
  if (normalized.split("::").length > 2) return undefined;

  const expandSide = (side: string): number[] => {
    if (!side) return [];
    return side.split(":").flatMap((part) => {
      const embedded = ipv4Number(part);
      return embedded === undefined
        ? [Number.parseInt(part, 16)]
        : [embedded >>> 16, embedded & 0xffff];
    });
  };
  const left = expandSide(leftRaw);
  const right = expandSide(rightRaw ?? "");
  const missing = 8 - left.length - right.length;
  if ((rightRaw === undefined && missing !== 0) || missing < 0) return undefined;
  return [...left, ...Array(missing).fill(0), ...right];
}

function ipv6Prefix(parts: number[], base: number[], bits: number): boolean {
  const full = Math.floor(bits / 16);
  const remaining = bits % 16;
  for (let index = 0; index < full; index += 1) {
    if (parts[index] !== base[index]) return false;
  }
  if (!remaining) return true;
  const mask = (0xffff << (16 - remaining)) & 0xffff;
  return (parts[full] & mask) === (base[full] & mask);
}

function isForbiddenIpv6(address: string): boolean {
  const parts = expandIpv6(address);
  if (!parts) return true;

  // IPv4-mapped addresses inherit the embedded IPv4 address's classification.
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    const embedded = `${parts[6] >>> 8}.${parts[6] & 255}.${parts[7] >>> 8}.${parts[7] & 255}`;
    return isForbiddenIpv4(embedded);
  }

  // Only globally routable unicast space is eligible. This also excludes
  // deprecated IPv4-compatible addresses and future/reserved allocations.
  if (!ipv6Prefix(parts, expandIpv6("2000::")!, 3)) return true;

  const ranges: Array<[string, number]> = [
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
  ];
  return ranges.some(([base, bits]) =>
    ipv6Prefix(parts, expandIpv6(base)!, bits),
  );
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address.split("%")[0]);
  if (version === 4) return !isForbiddenIpv4(address);
  if (version === 6) return !isForbiddenIpv6(address);
  return false;
}

export function toPublicUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SourceError("invalidUrl", raw);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new SourceError("httpOnly");
  }
  if (parsed.username || parsed.password) {
    throw new SourceError("credentialsNotAllowed");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (
    PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname)) ||
    (isIP(hostname) !== 0 && !isPublicIpAddress(hostname))
  ) {
    throw new SourceError("privateNetwork");
  }

  parsed.hash = "";
  return parsed;
}

export async function assertPublicHost(
  url: URL,
  dependencies: SourceNetworkDependencies = defaultNetworkDependencies,
): Promise<void> {
  const validated = toPublicUrl(url.toString());
  const hostname = validated.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) throw new SourceError("privateNetwork");
    return;
  }

  let addresses: string[];
  try {
    addresses = await dependencies.resolveHostname(hostname);
  } catch {
    throw new SourceError("fetchFailed", hostname);
  }
  if (!addresses.length || addresses.some((address) => !isPublicIpAddress(address))) {
    throw new SourceError("privateNetwork");
  }
}

function githubRepoFromUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.hostname !== "github.com") return undefined;
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return undefined;
    return `${owner}/${repo.replace(/\.git$/, "")}`;
  } catch {
    return undefined;
  }
}

interface RemoteTextOptions {
  accept: string;
  allowedContentTypes: string[];
  maxBytes: number;
  headers?: Record<string, string>;
  maxRedirects?: number;
  statusError?: "fetchFailed" | "githubFailed";
}

async function readLimitedText(response: Response, maxBytes: number) {
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new SourceError("pageTooLarge");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new SourceError("pageTooLarge");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function fetchRemoteText(
  rawUrl: string,
  options: RemoteTextOptions,
  dependencies: SourceNetworkDependencies = defaultNetworkDependencies,
): Promise<{ text: string; finalUrl: string }> {
  let current = toPublicUrl(rawUrl);
  const credentialOrigin = current.origin;
  const maxRedirects = options.maxRedirects ?? 5;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertPublicHost(current, dependencies);
    let response: Response;
    try {
      const requestHeaders: Record<string, string> = {
        Accept: options.accept,
        "User-Agent": "FitLens/0.2 (local product research tool)",
        ...options.headers,
      };
      if (current.origin !== credentialOrigin) {
        for (const name of Object.keys(requestHeaders)) {
          if (["authorization", "cookie"].includes(name.toLowerCase())) {
            delete requestHeaders[name];
          }
        }
      }
      response = await dependencies.fetch(current, {
        headers: requestHeaders,
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new SourceError("fetchFailed", current.hostname);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirectCount === maxRedirects) {
        throw new SourceError("fetchFailed", `${current.hostname} (redirect)`);
      }
      try {
        current = toPublicUrl(new URL(location, current).toString());
      } catch (error) {
        if (error instanceof SourceError) throw error;
        throw new SourceError("fetchFailed", `${current.hostname} (redirect)`);
      }
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new SourceError(
        options.statusError ?? "fetchFailed",
        `${current.hostname} (${response.status})`,
      );
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!contentType || !options.allowedContentTypes.includes(contentType)) {
      await response.body?.cancel();
      throw new SourceError("unsupportedContentType");
    }

    return {
      text: await readLimitedText(response, options.maxBytes),
      finalUrl: current.toString(),
    };
  }

  throw new SourceError("fetchFailed");
}

async function fetchText(
  url: string,
  dependencies: SourceNetworkDependencies,
): Promise<{ text: string; finalUrl: string }> {
  return fetchRemoteText(
    url,
    {
      accept: "text/html,application/xhtml+xml",
      allowedContentTypes: ["text/html", "application/xhtml+xml"],
      maxBytes: 1_000_000,
    },
    dependencies,
  );
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractPage(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, canvas, iframe").remove();

  const title = compactWhitespace(
    $('meta[property="og:title"]').attr("content") ??
      $("title").first().text() ??
      "",
  );
  const description = compactWhitespace(
    $('meta[name="description"]').attr("content") ??
      $('meta[property="og:description"]').attr("content") ??
      "",
  );
  const body = compactWhitespace($("body").text()).slice(0, 18_000);

  const links: SourceLink[] = $("a[href]")
    .map((_, element) => {
      const href = $(element).attr("href");
      if (!href) return null;
      try {
        return {
          url: new URL(href, pageUrl).toString(),
          label: compactWhitespace($(element).text()),
        };
      } catch {
        return null;
      }
    })
    .get()
    .filter((value): value is SourceLink => Boolean(value));

  const repoUrl = links.find((link) => githubRepoFromUrl(link.url))?.url;
  return { title, description, body, repoUrl, links };
}

export function needsBrowserRendering(html: string, extractedText: string) {
  const scriptCount = html.match(/<script\b/gi)?.length ?? 0;
  const hasApplicationShell =
    /id=["'](?:__next|__nuxt|root|app)["']/i.test(html) ||
    /\/(?:_next|_nuxt)\/static\//i.test(html) ||
    /type=["']module["']/i.test(html);
  return extractedText.trim().length < 800 && scriptCount >= 2 && hasApplicationShell;
}

function prepareBrowserDocument(html: string, pageUrl: string) {
  const $ = cheerio.load(html);
  $('meta[http-equiv="content-security-policy" i]').remove();
  $("base").remove();
  $("head").prepend(`<base href="${pageUrl.replaceAll('"', "&quot;")}">`);
  return $.html();
}

function browserResourceOptions(resourceType: string): RemoteTextOptions | undefined {
  if (resourceType === "script") {
    return {
      accept: "text/javascript,application/javascript,*/*;q=0.1",
      allowedContentTypes: [
        "text/javascript",
        "application/javascript",
        "application/x-javascript",
        "text/plain",
      ],
      maxBytes: 750_000,
    };
  }
  if (resourceType === "stylesheet") {
    return {
      accept: "text/css,*/*;q=0.1",
      allowedContentTypes: ["text/css", "text/plain"],
      maxBytes: 500_000,
    };
  }
  if (["xhr", "fetch"].includes(resourceType)) {
    return {
      accept: "application/json,text/plain,text/html,*/*;q=0.1",
      allowedContentTypes: [
        "application/json",
        "text/plain",
        "text/html",
        "application/javascript",
        "text/javascript",
      ],
      maxBytes: 750_000,
    };
  }
  return undefined;
}

function browserResponseContentType(resourceType: string) {
  if (resourceType === "script") return "application/javascript";
  if (resourceType === "stylesheet") return "text/css";
  return "application/json";
}

async function renderHtmlInGuardedBrowser(
  html: string,
  pageUrl: string,
  dependencies: SourceNetworkDependencies,
) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  let requestCount = 0;
  let totalCharacters = 0;
  try {
    const context = await browser.newContext({
      javaScriptEnabled: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send("Network.enable");
    await client.send("Network.setBlockedURLs", { urls: ["ws://*", "wss://*"] });

    await page.route("**/*", async (route: Route) => {
      const request = route.request();
      const options = browserResourceOptions(request.resourceType());
      if (
        request.method() !== "GET" ||
        !options ||
        requestCount >= 40 ||
        totalCharacters >= 3_000_000
      ) {
        await route.abort("blockedbyclient");
        return;
      }
      requestCount += 1;
      try {
        const response = await fetchRemoteText(
          request.url(),
          options,
          dependencies,
        );
        totalCharacters += response.text.length;
        await route.fulfill({
          status: 200,
          contentType: browserResponseContentType(request.resourceType()),
          headers: { "access-control-allow-origin": "*" },
          body: response.text,
        });
      } catch {
        await route.abort("blockedbyclient");
      }
    });

    await page.setContent(prepareBrowserDocument(html, pageUrl), {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
    await page.waitForTimeout(350);
    const rendered = await page.content();
    if (rendered.length > 1_500_000) throw new SourceError("pageTooLarge");
    return rendered;
  } finally {
    await browser.close();
  }
}

async function collectSupplementalDocuments(
  homepageUrl: string,
  links: SourceLink[],
  dependencies: SourceNetworkDependencies,
): Promise<CollectedSourceDocument[]> {
  const candidates = discoverSourceDocuments(homepageUrl, links);
  const settled = await Promise.allSettled(
    candidates.map(async (candidate): Promise<CollectedSourceDocument> => {
      const response = await fetchRemoteText(
        candidate.url,
        {
          accept: "text/html,application/xhtml+xml",
          allowedContentTypes: ["text/html", "application/xhtml+xml"],
          maxBytes: 500_000,
        },
        dependencies,
      );
      const page = extractPage(response.text, response.finalUrl);
      return {
        kind: candidate.kind,
        title: page.title || candidate.label || candidate.kind,
        url: response.finalUrl,
        text: page.body.slice(0, 4_000),
      };
    }),
  );

  return settled.flatMap((result) =>
    result.status === "fulfilled" && result.value.text
      ? [result.value]
      : [],
  );
}

async function collectGitHub(
  fullName: string,
  dependencies: SourceNetworkDependencies,
) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "FitLens/0.1",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const metadata = await fetchRemoteText(
    `https://api.github.com/repos/${fullName}`,
    {
      accept: headers.Accept,
      allowedContentTypes: ["application/json", "application/vnd.github+json"],
      maxBytes: 1_000_000,
      headers,
      statusError: "githubFailed",
    },
    dependencies,
  );
  let repo: {
    full_name: string;
    html_url: string;
    homepage?: string | null;
    description?: string | null;
    license?: { spdx_id?: string | null } | null;
    default_branch: string;
    stargazers_count: number;
    forks_count: number;
    open_issues_count: number;
    pushed_at: string;
    archived: boolean;
    topics?: string[];
    name: string;
  };
  try {
    repo = JSON.parse(metadata.text) as typeof repo;
  } catch {
    throw new SourceError("githubFailed", "invalid response");
  }

  let readme = "";
  try {
    const readmeResponse = await fetchRemoteText(
      `https://api.github.com/repos/${fullName}/readme`,
      {
        accept: "application/vnd.github.raw+json",
        allowedContentTypes: [
          "application/json",
          "application/vnd.github.raw+json",
          "text/plain",
          "application/octet-stream",
        ],
        maxBytes: 16_000,
        headers: { ...headers, Accept: "application/vnd.github.raw+json" },
        statusError: "githubFailed",
      },
      dependencies,
    );
    readme = readmeResponse.text;
  } catch (error) {
    // Repository metadata remains useful when a README does not exist. Network
    // policy errors are never suppressed because they describe an unsafe hop.
    if (
      error instanceof SourceError &&
      ["privateNetwork", "credentialsNotAllowed", "httpOnly"].includes(
        error.code,
      )
    ) {
      throw error;
    }
  }

  let latestRelease:
    | {
        name: string;
        tagName: string;
        url: string;
        publishedAt: string;
        notes: string;
      }
    | undefined;
  try {
    const releaseResponse = await fetchRemoteText(
      `https://api.github.com/repos/${fullName}/releases/latest`,
      {
        accept: "application/vnd.github+json",
        allowedContentTypes: [
          "application/json",
          "application/vnd.github+json",
        ],
        maxBytes: 250_000,
        headers,
        statusError: "githubFailed",
      },
      dependencies,
    );
    const release = JSON.parse(releaseResponse.text) as {
      name?: string | null;
      tag_name?: string;
      html_url?: string;
      published_at?: string | null;
      body?: string | null;
    };
    if (release.tag_name && release.html_url) {
      latestRelease = {
        name: release.name?.trim() || release.tag_name,
        tagName: release.tag_name,
        url: release.html_url,
        publishedAt: release.published_at ?? "",
        notes: (release.body ?? "").slice(0, 4_000),
      };
    }
  } catch (error) {
    if (
      error instanceof SourceError &&
      ["privateNetwork", "credentialsNotAllowed", "httpOnly"].includes(
        error.code,
      )
    ) {
      throw error;
    }
  }

  return {
    homepageUrl: repo.homepage || repo.html_url,
    name: repo.name,
    repo: {
      fullName: repo.full_name,
      url: repo.html_url,
      description: repo.description ?? "",
      license: repo.license?.spdx_id ?? "Unknown",
      defaultBranch: repo.default_branch,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      openIssues: repo.open_issues_count,
      pushedAt: repo.pushed_at,
      archived: repo.archived,
      topics: repo.topics ?? [],
      readme,
      latestRelease,
    },
    documents: latestRelease
      ? [
          {
            kind: "release" as const,
            title: `${latestRelease.name} (${latestRelease.tagName})`,
            url: latestRelease.url,
            text: [
              latestRelease.publishedAt
                ? `Published: ${latestRelease.publishedAt}`
                : "",
              latestRelease.notes,
            ]
              .filter(Boolean)
              .join("\n")
              .slice(0, 4_000),
          },
        ]
      : [],
  };
}

export async function collectProductSource(
  rawUrl: string,
  dependencies: SourceNetworkDependencies = defaultNetworkDependencies,
): Promise<CollectedSource> {
  const input = toPublicUrl(rawUrl);
  const directRepo = githubRepoFromUrl(input.toString());

  if (directRepo) {
    const github = await collectGitHub(directRepo, dependencies);
    return {
      inputUrl: input.toString(),
      homepageUrl: github.homepageUrl,
      name: github.name,
      description: github.repo.description,
      sourceMode: "open-source",
      pageText: github.repo.readme,
      documents: github.documents,
      repo: github.repo,
    };
  }

  const marketplace = identifyMarketplace(input.toString());
  if (marketplace?.metadataUrl) {
    try {
      const response = await fetchRemoteText(
        marketplace.metadataUrl,
        {
          accept: "application/json,text/javascript",
          allowedContentTypes: ["application/json", "text/javascript"],
          maxBytes: 1_500_000,
        },
        dependencies,
      );
      const metadata = parseMarketplaceMetadata(marketplace, response.text);
      if (metadata) {
        const repository = metadata.repositoryUrl
          ? githubRepoFromUrl(metadata.repositoryUrl)
          : undefined;
        const github = repository
          ? await collectGitHub(repository, dependencies).catch(() => undefined)
          : undefined;
        return {
          inputUrl: input.toString(),
          homepageUrl: marketplace.pageUrl,
          name: metadata.name,
          description: metadata.description,
          sourceMode: github ? "open-source" : "website-only",
          pageText: metadata.document.text,
          documents: [metadata.document, ...(github?.documents ?? [])],
          repo: github?.repo,
        };
      }
    } catch {
      // Registry enrichment is optional; the public listing remains collectable.
    }
  }

  const html = await fetchText(input.toString(), dependencies);
  let page = extractPage(html.text, html.finalUrl);
  if (needsBrowserRendering(html.text, page.body)) {
    const renderHtml =
      dependencies.renderHtml ??
      (process.env.FITLENS_BROWSER_FALLBACK === "1"
        ? (markup: string, pageUrl: string) =>
            renderHtmlInGuardedBrowser(markup, pageUrl, dependencies)
        : undefined);
    if (renderHtml) {
      try {
        const renderedPage = extractPage(
          await renderHtml(html.text, html.finalUrl),
          html.finalUrl,
        );
        if (renderedPage.body.length > page.body.length) page = renderedPage;
      } catch {
        // Rendering is a best-effort enhancement; guarded static HTML remains usable.
      }
    }
  }
  const discoveredRepo = page.repoUrl
    ? githubRepoFromUrl(page.repoUrl)
    : undefined;
  const [supplementalDocuments, github] = await Promise.all([
    collectSupplementalDocuments(html.finalUrl, page.links, dependencies),
    discoveredRepo
      ? collectGitHub(discoveredRepo, dependencies).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  const marketplaceDocuments =
    marketplace?.kind === "chrome-web-store"
      ? [
          chromeStoreDocument(
            marketplace,
            page.title,
            page.description,
            page.body,
          ),
        ]
      : [];

  return {
    inputUrl: input.toString(),
    homepageUrl: html.finalUrl,
    name: page.title.split(/[—|·-]/)[0]?.trim() || input.hostname,
    description: page.description,
    sourceMode: github ? "open-source" : "website-only",
    pageText: page.body,
    documents: [
      ...marketplaceDocuments,
      ...supplementalDocuments,
      ...(github?.documents ?? []),
    ],
    repo: github?.repo,
  };
}
