import type { Messages } from "@/lib/i18n";

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 42 42">
        <circle cx="18.5" cy="18.5" r="12" />
        <path d="m27.4 27.4 8.5 8.5" />
        <path d="m11.5 17 7 4 7-7" strokeWidth="1.8" />
        <circle cx="11.5" cy="17" r="2" fill="var(--green)" stroke="none" />
        <circle cx="18.5" cy="21" r="2" fill="var(--peach)" stroke="none" />
        <circle cx="25.5" cy="14" r="2" fill="var(--pink)" stroke="none" />
      </svg>
    </span>
  );
}

export function SourcePill({
  mode,
  t,
}: {
  mode: "open-source" | "website-only";
  t: Messages;
}) {
  return (
    <span className={`source-pill ${mode}`}>
      <span className="source-dot" />
      {mode === "open-source" ? t.sourceOpen : t.sourceWebsite}
    </span>
  );
}
