export type SourceDocumentKind =
  | "pricing"
  | "documentation"
  | "privacy"
  | "security"
  | "changelog"
  | "release";

export interface SourceLink {
  url: string;
  label: string;
}

export interface SourceDocumentCandidate extends SourceLink {
  kind: SourceDocumentKind;
  priority: number;
}

export interface CollectedSourceDocument {
  kind: SourceDocumentKind;
  title: string;
  url: string;
  text: string;
}

export interface SourceAdapter {
  kind: SourceDocumentKind;
  priority: number;
  matches(link: SourceLink): boolean;
}
