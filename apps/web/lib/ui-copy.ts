import { libraryForMode, type LibraryEntry, type LibraryMode } from "@agentforge/core/templates";
import { t } from "./i18n";

export const GALLERY_NS: Record<LibraryMode, string> = {
  documents: "documents",
  research: "research",
  images: "images",
  videos: "videos",
  presentations: "presentation",
};

/** Use `fallback` when the catalog is missing the key (t() returns the key). */
export function labeled(key: string, fallback: string, vars?: Record<string, string | number>): string {
  const value = t(key, vars);
  return value === key ? fallback : value;
}

export function firstCopy(...keys: string[]): string {
  for (const key of keys) {
    const value = t(key);
    if (value !== key) {
      return value;
    }
  }
  return keys[0] ?? "";
}

export function templateSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export type LocalizedLibraryEntry = LibraryEntry & { exampleId: string };

export function localizedLibrary(mode: LibraryMode): LocalizedLibraryEntry[] {
  const ns = GALLERY_NS[mode];
  return libraryForMode(mode).map((entry) => {
    const slug = templateSlug(entry.title);
    const titleKey = `${ns}.templates.${slug}.title`;
    const promptKey = `${ns}.templates.${slug}.prompt`;
    const summaryKey = `${ns}.templates.${slug}.resultSummary`;
    const title = t(titleKey);
    const prompt = t(promptKey);
    const summary = t(summaryKey);
    return {
      ...entry,
      exampleId: `${mode}-${slug}`,
      title: title === titleKey ? entry.title : title,
      prompt: prompt === promptKey ? entry.prompt : prompt,
      resultSummary: summary === summaryKey ? entry.resultSummary : summary,
    };
  });
}

export function galleryChrome(mode: LibraryMode): { title: string; hint: string } {
  const ns = GALLERY_NS[mode];
  return {
    title: firstCopy(`${ns}.galleryTitle`, `${ns}.examplesHeading`, "documents.galleryTitle"),
    hint: firstCopy(`${ns}.galleryHint`, `${ns}.examplesHint`, "documents.galleryHint"),
  };
}
