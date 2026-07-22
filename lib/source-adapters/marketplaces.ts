import type { CollectedSourceDocument } from "./types.ts";

export type MarketplaceKind = "npm" | "pypi" | "app-store" | "chrome-web-store";

export interface MarketplaceTarget {
  kind: MarketplaceKind;
  id: string;
  pageUrl: string;
  metadataUrl?: string;
}

export interface MarketplaceMetadata {
  name: string;
  description: string;
  repositoryUrl?: string;
  document: CollectedSourceDocument;
}

function cleanRepositoryUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
  try {
    const url = new URL(normalized);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function identifyMarketplace(rawUrl: string): MarketplaceTarget | undefined {
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  if (hostname === "npmjs.com") {
    const marker = "/package/";
    const index = url.pathname.indexOf(marker);
    if (index >= 0) {
      const name = decodeURIComponent(url.pathname.slice(index + marker.length)).replace(/\/$/, "");
      if (name) {
        return {
          kind: "npm",
          id: name,
          pageUrl: `https://www.npmjs.com/package/${name}`,
          metadataUrl: `https://registry.npmjs.org/${name.replace("/", "%2F")}`,
        };
      }
    }
  }

  if (hostname === "pypi.org") {
    const match = url.pathname.match(/^\/project\/([^/]+)/i);
    if (match) {
      const name = decodeURIComponent(match[1]);
      return {
        kind: "pypi",
        id: name,
        pageUrl: `https://pypi.org/project/${name}/`,
        metadataUrl: `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
      };
    }
  }

  if (hostname === "apps.apple.com") {
    const match = url.pathname.match(/\/id(\d+)(?:\/|$)/i);
    if (match) {
      return {
        kind: "app-store",
        id: match[1],
        pageUrl: url.toString(),
        metadataUrl: `https://itunes.apple.com/lookup?id=${match[1]}`,
      };
    }
  }

  if (hostname === "chromewebstore.google.com") {
    const match = url.pathname.match(/\/detail\/(?:[^/]+\/)?([a-p]{32})(?:\/|$)/i);
    if (match) {
      return {
        kind: "chrome-web-store",
        id: match[1].toLowerCase(),
        pageUrl: url.toString(),
      };
    }
  }

  return undefined;
}

function parseJson(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function line(label: string, value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return `${label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`;
}

function metadataDocument(
  target: MarketplaceTarget,
  title: string,
  lines: Array<string | undefined>,
): CollectedSourceDocument {
  return {
    kind: target.kind === "npm" || target.kind === "pypi" ? "registry" : "store",
    title,
    url: target.pageUrl,
    text: lines.filter((value): value is string => Boolean(value)).join("\n").slice(0, 8_000),
  };
}

export function parseMarketplaceMetadata(
  target: MarketplaceTarget,
  raw: string,
): MarketplaceMetadata | undefined {
  const payload = parseJson(raw);
  if (!payload) return undefined;

  if (target.kind === "npm") {
    const latestTag = (payload["dist-tags"] as Record<string, unknown> | undefined)?.latest;
    const versions = payload.versions as Record<string, Record<string, unknown>> | undefined;
    const latest = typeof latestTag === "string" ? versions?.[latestTag] : undefined;
    const repository = latest?.repository ?? payload.repository;
    const repositoryUrl = cleanRepositoryUrl(
      typeof repository === "object" && repository
        ? (repository as Record<string, unknown>).url
        : repository,
    );
    const name = String(payload.name ?? target.id);
    const description = String(payload.description ?? latest?.description ?? "");
    return {
      name,
      description,
      repositoryUrl,
      document: metadataDocument(target, `${name} npm registry`, [
        line("Package", name),
        line("Latest version", latestTag),
        line("Description", description),
        line("License", latest?.license ?? payload.license),
        line("Node requirement", (latest?.engines as Record<string, unknown> | undefined)?.node),
        line("Keywords", latest?.keywords ?? payload.keywords),
        line("Published", (payload.time as Record<string, unknown> | undefined)?.[String(latestTag)]),
        line("Repository", repositoryUrl),
      ]),
    };
  }

  if (target.kind === "pypi") {
    const info = payload.info as Record<string, unknown> | undefined;
    if (!info) return undefined;
    const projectUrls = info.project_urls as Record<string, unknown> | undefined;
    const repositoryUrl = cleanRepositoryUrl(
      projectUrls?.Source ?? projectUrls?.Repository ?? projectUrls?.Homepage,
    );
    const releases = payload.releases as Record<string, Array<Record<string, unknown>>> | undefined;
    const version = String(info.version ?? "");
    const latestFiles = releases?.[version] ?? [];
    const uploaded = latestFiles
      .map((file) => file.upload_time_iso_8601)
      .find((value): value is string => typeof value === "string");
    const name = String(info.name ?? target.id);
    const description = String(info.summary ?? "");
    return {
      name,
      description,
      repositoryUrl,
      document: metadataDocument(target, `${name} PyPI registry`, [
        line("Project", name),
        line("Latest version", version),
        line("Summary", description),
        line("License", info.license_expression ?? info.license),
        line("Python requirement", info.requires_python),
        line("Dependencies", info.requires_dist),
        line("Published", uploaded),
        line("Repository", repositoryUrl),
      ]),
    };
  }

  if (target.kind === "app-store") {
    const results = payload.results;
    const item = Array.isArray(results) ? results[0] as Record<string, unknown> | undefined : undefined;
    if (!item) return undefined;
    const name = String(item.trackName ?? target.id);
    const description = String(item.description ?? "");
    return {
      name,
      description,
      document: metadataDocument(target, `${name} App Store listing`, [
        line("App", name),
        line("Developer", item.sellerName),
        line("Version", item.version),
        line("Price", `${String(item.formattedPrice ?? "")} ${String(item.currency ?? "")}`.trim()),
        line("Categories", item.genres),
        line("Minimum OS", item.minimumOsVersion),
        line("Rating", item.averageUserRating),
        line("Rating count", item.userRatingCount),
        line("Release notes", item.currentVersionReleaseNotes),
        line("Description", description),
      ]),
    };
  }

  return undefined;
}

export function chromeStoreDocument(
  target: MarketplaceTarget,
  title: string,
  description: string,
  body: string,
): CollectedSourceDocument {
  return {
    kind: "store",
    title: `${title || target.id} Chrome Web Store listing`,
    url: target.pageUrl,
    text: [line("Extension ID", target.id), line("Description", description), body]
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .slice(0, 8_000),
  };
}
