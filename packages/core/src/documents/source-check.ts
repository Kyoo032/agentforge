/**
 * Marks draft sentences the optional source does not support.
 * Overlap is computed here. The model is not called.
 */

export type SourceCheckItem = {
  sectionIndex: number;
  sentence: string;
  supported: boolean;
};

export type SourceCheck = {
  checked: boolean;
  reason?: "no_source";
  items: SourceCheckItem[];
};

export type CheckableDraft = {
  title: string;
  sections: Array<{ heading: string; body: string }>;
};

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.split(/\s+/).length >= 6);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3);
}

function sentenceSupported(sentence: string, sourceNorm: string, sourceWords: Set<string>): boolean {
  const norm = sentence.toLowerCase().replace(/\s+/g, " ").trim();
  if (norm.length >= 12 && sourceNorm.includes(norm)) {
    return true;
  }
  const own = words(sentence);
  if (own.length === 0) {
    return true;
  }
  const hits = own.filter((word) => sourceWords.has(word)).length;
  return hits / own.length >= 0.6;
}

export function checkDraftAgainstSource(draft: CheckableDraft, sourceText: string): SourceCheck {
  const source = sourceText.trim();
  if (!source) {
    return { checked: false, reason: "no_source", items: [] };
  }
  const sourceNorm = source.toLowerCase().replace(/\s+/g, " ");
  const sourceWords = new Set(words(source));
  const items: SourceCheckItem[] = [];
  const consider = (sectionIndex: number, text: string) => {
    for (const sentence of sentences(text)) {
      items.push({
        sectionIndex,
        sentence,
        supported: sentenceSupported(sentence, sourceNorm, sourceWords),
      });
    }
  };
  consider(-1, draft.title);
  draft.sections.forEach((section, index) => {
    consider(index, `${section.heading}. ${section.body}`);
  });
  return { checked: true, items };
}
