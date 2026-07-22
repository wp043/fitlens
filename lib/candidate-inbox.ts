export interface CandidateInboxItem {
  id: string;
  url: string;
  name: string;
  note: string;
  tags: string[];
  addedAt: string;
  archived: boolean;
}

export interface CaptureCandidatesResult {
  items: CandidateInboxItem[];
  added: number;
  duplicates: number;
  invalid: number;
}

export function normalizeCandidateUrl(raw: string) {
  const url = new URL(raw.trim());
  if (!["http:", "https:"].includes(url.protocol)) return undefined;
  if (url.username || url.password) return undefined;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

function candidateName(url: string) {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  return hostname.split(".")[0] || hostname;
}

export function captureCandidates(
  current: CandidateInboxItem[],
  raw: string,
  createId: () => string,
  now = new Date(),
): CaptureCandidatesResult {
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  const known = new Set(current.map((item) => item.url));
  const items = [...current];
  let added = 0;
  let duplicates = 0;
  let invalid = 0;

  for (const token of tokens) {
    let url: string | undefined;
    try {
      url = normalizeCandidateUrl(token);
    } catch {
      url = undefined;
    }
    if (!url) {
      invalid += 1;
      continue;
    }
    if (known.has(url)) {
      duplicates += 1;
      continue;
    }
    known.add(url);
    items.push({
      id: createId(),
      url,
      name: candidateName(url),
      note: "",
      tags: [],
      addedAt: now.toISOString(),
      archived: false,
    });
    added += 1;
  }

  return { items, added, duplicates, invalid };
}

export function normalizeCandidateInbox(input: unknown): CandidateInboxItem[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Partial<CandidateInboxItem>;
    if (
      typeof item.id !== "string" ||
      typeof item.url !== "string" ||
      typeof item.name !== "string" ||
      typeof item.addedAt !== "string"
    ) {
      return [];
    }
    try {
      const url = normalizeCandidateUrl(item.url);
      if (!url) return [];
      return [
        {
          id: item.id,
          url,
          name: item.name.trim() || candidateName(url),
          note: typeof item.note === "string" ? item.note : "",
          tags: Array.isArray(item.tags)
            ? item.tags.filter((tag): tag is string => typeof tag === "string")
            : [],
          addedAt: item.addedAt,
          archived: item.archived === true,
        },
      ];
    } catch {
      return [];
    }
  });
}

export function filterCandidates(
  items: CandidateInboxItem[],
  query: string,
  showArchived = false,
) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (!showArchived && item.archived) return false;
    const text = [item.name, item.url, item.note, ...item.tags]
      .join("\n")
      .toLocaleLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}
