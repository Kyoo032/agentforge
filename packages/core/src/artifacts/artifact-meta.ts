import { z } from "zod";

export const ARTIFACT_MODES = [
  "research",
  "data",
  "finance",
  "market",
  "documents",
  "presentations",
  "legal",
] as const;
export const ARTIFACT_KINDS = [
  "dossier",
  "analysis",
  "brief",
  "briefing",
  "draft",
  "memo",
  "redline",
  "report",
  "summary",
  "red-flags",
  "matter",
] as const;
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const ARTIFACT_MIMES = ["text/markdown", "application/json", DOCX_MIME, XLSX_MIME] as const;
/** Binary bodies are stored base64-encoded; the file route decodes them. */
export const BINARY_ARTIFACT_MIMES: ReadonlySet<string> = new Set([DOCX_MIME, XLSX_MIME]);

export function isBinaryArtifactMime(mime: string): boolean {
  return BINARY_ARTIFACT_MIMES.has(mime);
}

export type ArtifactMode = (typeof ARTIFACT_MODES)[number];
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type ArtifactMime = (typeof ARTIFACT_MIMES)[number];

export function isArtifactMode(value: unknown): value is ArtifactMode {
  return typeof value === "string" && (ARTIFACT_MODES as readonly string[]).includes(value);
}

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && (ARTIFACT_KINDS as readonly string[]).includes(value);
}

export function isArtifactMime(value: unknown): value is ArtifactMime {
  return typeof value === "string" && (ARTIFACT_MIMES as readonly string[]).includes(value);
}

/** Free-form provenance. Known keys are typed; extra keys are kept. */
export const artifactMetaSchema = z
  .object({
    model: z.string().optional(),
    models: z.array(z.string()).optional(),
    question: z.string().optional(),
    queries: z.array(z.string()).optional(),
    sourceCount: z.number().int().nonnegative().optional(),
    parentArtifactId: z.string().optional(),
    datasetId: z.string().optional(),
  })
  .passthrough();

export type ArtifactMeta = z.infer<typeof artifactMetaSchema>;

export type ArtifactSummary = {
  id: string;
  workspaceId: string;
  mode: ArtifactMode;
  kind: ArtifactKind;
  title: string;
  mime: ArtifactMime;
  meta: ArtifactMeta;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
};

export type ArtifactRecord = ArtifactSummary & { body: string };

const TITLE_SLUG_MAX = 60;

export function artifactSlug(title: string, fallback = "artifact"): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, TITLE_SLUG_MAX)
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return slug || fallback;
}

const MIME_EXTENSION: Readonly<Record<ArtifactMime, string>> = {
  "text/markdown": "md",
  "application/json": "json",
  [DOCX_MIME]: "docx",
  [XLSX_MIME]: "xlsx",
};

export function artifactExtension(mime: ArtifactMime): string {
  return MIME_EXTENSION[mime] ?? "md";
}

export function artifactFilename(title: string, mime: ArtifactMime, fallback = "artifact"): string {
  return `${artifactSlug(title, fallback)}.${artifactExtension(mime)}`;
}
