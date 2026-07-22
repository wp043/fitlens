import type {
  SourceAdapter,
  SourceDocumentCandidate,
  SourceDocumentKind,
  SourceLink,
} from "./types.ts";

const terms: Record<Exclude<SourceDocumentKind, "release">, string[]> = {
  pricing: ["pricing", "plans", "billing", "price", "定价", "价格", "套餐"],
  documentation: [
    "docs",
    "documentation",
    "guide",
    "manual",
    "handbook",
    "文档",
    "指南",
    "手册",
  ],
  privacy: ["privacy", "data-policy", "隐私", "数据政策"],
  security: ["security", "trust", "安全", "信任中心"],
  changelog: [
    "changelog",
    "release-notes",
    "releases",
    "updates",
    "what-s-new",
    "更新日志",
    "发布说明",
    "版本记录",
  ],
};

function searchable(link: SourceLink) {
  let path = "";
  try {
    const url = new URL(link.url);
    path = `${url.pathname} ${url.hostname}`;
  } catch {
    path = link.url;
  }
  return `${path} ${link.label}`.toLowerCase();
}

function termAdapter(
  kind: Exclude<SourceDocumentKind, "release">,
  priority: number,
): SourceAdapter {
  return {
    kind,
    priority,
    matches(link) {
      const value = searchable(link);
      return terms[kind].some((term) => value.includes(term));
    },
  };
}

export const sourceAdapters: readonly SourceAdapter[] = [
  termAdapter("pricing", 100),
  termAdapter("privacy", 95),
  termAdapter("security", 90),
  termAdapter("changelog", 85),
  termAdapter("documentation", 80),
];

function relatedHostname(homepage: URL, candidate: URL) {
  const home = homepage.hostname.replace(/^www\./, "").toLowerCase();
  const other = candidate.hostname.replace(/^www\./, "").toLowerCase();
  return (
    home === other || home.endsWith(`.${other}`) || other.endsWith(`.${home}`)
  );
}

function canonicalUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function discoverSourceDocuments(
  homepageUrl: string,
  links: SourceLink[],
  limit = 5,
): SourceDocumentCandidate[] {
  const homepage = new URL(homepageUrl);
  const candidates: SourceDocumentCandidate[] = [];

  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.url, homepage);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol)) continue;
    if (!relatedHostname(homepage, url)) continue;

    const adapter = sourceAdapters.find((item) => item.matches(link));
    if (!adapter) continue;
    candidates.push({
      kind: adapter.kind,
      priority: adapter.priority,
      label: link.label.trim(),
      url: canonicalUrl(url.toString()),
    });
  }

  const selected = new Map<SourceDocumentKind, SourceDocumentCandidate>();
  for (const candidate of candidates.sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return new URL(left.url).pathname.length - new URL(right.url).pathname.length;
  })) {
    if (!selected.has(candidate.kind)) selected.set(candidate.kind, candidate);
  }
  return [...selected.values()].slice(0, limit);
}
