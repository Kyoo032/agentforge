import { z } from "zod";
import { ApiError } from "@agentforge/core";
import { extractJsonObject } from "./presentation-outline";

export const documentSectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
});

export const documentDraftSchema = z.object({
  title: z.string().min(1),
  sections: z.array(documentSectionSchema).min(1),
});

export type DocumentSection = z.infer<typeof documentSectionSchema>;
export type DocumentDraft = z.infer<typeof documentDraftSchema>;

export function parseDocumentDraft(raw: unknown): DocumentDraft {
  if (typeof raw !== "string") {
    throw new ApiError("invalid_document", "Document draft must be a JSON string from the model", 502);
  }
  const jsonText = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ApiError("invalid_document", "Model returned invalid JSON for the document", 502);
  }
  const result = documentDraftSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(
      "invalid_document",
      `Document draft failed validation: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
      502,
    );
  }
  return result.data;
}

export function parseDocumentSection(raw: unknown): DocumentSection {
  if (typeof raw === "string") {
    const jsonText = extractJsonObject(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new ApiError("invalid_document", "Model returned invalid JSON for the section", 502);
    }
    raw = parsed;
  }
  const result = documentSectionSchema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      "invalid_document",
      `Document section failed validation: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
      502,
    );
  }
  return result.data;
}

export function mergeDocumentSection(draft: DocumentDraft, index: number, section: DocumentSection): DocumentDraft {
  if (!Number.isInteger(index) || index < 0 || index >= draft.sections.length) {
    throw new ApiError("invalid_request", "sectionIndex is out of range", 400);
  }
  const sections = draft.sections.map((item, itemIndex) => (itemIndex === index ? section : item));
  return { ...draft, sections };
}

export function parseDocumentDraftBody(body: unknown): DocumentDraft {
  const result = documentDraftSchema.safeParse(body);
  if (!result.success) {
    throw new ApiError(
      "invalid_request",
      `Invalid document draft: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
      400,
    );
  }
  return result.data;
}
