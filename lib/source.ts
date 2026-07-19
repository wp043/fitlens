import * as cheerio from "cheerio";

export interface CollectedSource {
  inputUrl: string;
  homepageUrl: string;
  name: string;
  description: string;
  sourceMode: "open-source" | "website-only";
  pageText: string;
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
  };
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^0(?:\.|$)/,
  /^10(?:\.|$)/,
  /^127(?:\.|$)/,
  /^169\.254(?:\.|$)/,
  /^172\.(?:1[6-9]|2\d|3[01])(?:\.|$)/,
  /^192\.168(?:\.|$)/,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

export function toPublicUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`无效 URL：${raw}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("只支持 http 或 https URL。");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL 不能包含用户名或密码。");
  }
  if (
    PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))
  ) {
    throw new Error("不能分析本地或私有网络地址。");
  }

  parsed.hash = "";
  return parsed;
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

async function fetchText(url: string, accept = "text/html"): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "FitLens/0.1 (+https://fitlens-tools.sites.openai.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`抓取 ${new URL(url).hostname} 失败（${response.status}）。`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 2_000_000) {
    throw new Error("网页内容过大，暂时无法分析。");
  }

  return (await response.text()).slice(0, 1_000_000);
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

  const links = $("a[href]")
    .map((_, element) => {
      const href = $(element).attr("href");
      if (!href) return null;
      try {
        return new URL(href, pageUrl).toString();
      } catch {
        return null;
      }
    })
    .get()
    .filter((value): value is string => Boolean(value));

  const repoUrl = links.find((link) => githubRepoFromUrl(link));
  return { title, description, body, repoUrl };
}

async function collectGitHub(fullName: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "FitLens/0.1",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`读取 GitHub repository 失败（${response.status}）。`);
  }

  const repo = (await response.json()) as {
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

  let readme = "";
  const readmeResponse = await fetch(
    `https://api.github.com/repos/${fullName}/readme`,
    {
      headers: { ...headers, Accept: "application/vnd.github.raw+json" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (readmeResponse.ok) {
    readme = (await readmeResponse.text()).slice(0, 16_000);
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
    },
  };
}

export async function collectProductSource(
  rawUrl: string,
): Promise<CollectedSource> {
  const input = toPublicUrl(rawUrl);
  const directRepo = githubRepoFromUrl(input.toString());

  if (directRepo) {
    const github = await collectGitHub(directRepo);
    return {
      inputUrl: input.toString(),
      homepageUrl: github.homepageUrl,
      name: github.name,
      description: github.repo.description,
      sourceMode: "open-source",
      pageText: github.repo.readme,
      repo: github.repo,
    };
  }

  const html = await fetchText(input.toString());
  const page = extractPage(html, input.toString());
  const discoveredRepo = page.repoUrl
    ? githubRepoFromUrl(page.repoUrl)
    : undefined;
  const github = discoveredRepo
    ? await collectGitHub(discoveredRepo).catch(() => undefined)
    : undefined;

  return {
    inputUrl: input.toString(),
    homepageUrl: input.toString(),
    name: page.title.split(/[—|·-]/)[0]?.trim() || input.hostname,
    description: page.description,
    sourceMode: github ? "open-source" : "website-only",
    pageText: page.body,
    repo: github?.repo,
  };
}
