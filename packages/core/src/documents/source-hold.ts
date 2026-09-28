/**
 * Removes body sentences an attached source does not support.
 * The model is not called. A retry would invent the replacement.
 */

import { checkDraftAgainstSource, type CheckableDraft } from "./source-check";

function tidy(body: string): string {
  return body
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * When `sourceText` is empty the draft is returned unchanged.
 * `onlySection` limits the edit to one rewrite. Title and headings stay.
 * A section whose body is emptied becomes `gapLine` (the caller picks the locale).
 */
export function holdDraftToSource(
  draft: CheckableDraft,
  sourceText: string,
  gapLine: string,
  onlySection?: number,
): CheckableDraft {
  const check = checkDraftAgainstSource(draft, sourceText);
  if (!check.checked) {
    return draft;
  }
  const drop = new Map<number, string[]>();
  for (const item of check.items) {
    if (item.supported || item.sectionIndex < 0) {
      continue;
    }
    const list = drop.get(item.sectionIndex) ?? [];
    list.push(item.sentence);
    drop.set(item.sectionIndex, list);
  }
  if (drop.size === 0) {
    return draft;
  }
  const gap = gapLine.trim();
  let changed = false;
  const sections = draft.sections.map((section, index) => {
    if (onlySection !== undefined && index !== onlySection) {
      return section;
    }
    const sentences = drop.get(index);
    if (!sentences || sentences.length === 0) {
      return section;
    }
    let body = section.body;
    for (const sentence of sentences) {
      if (sentence && body.includes(sentence)) {
        body = body.split(sentence).join("");
        changed = true;
      }
    }
    body = tidy(body);
    if (!body) {
      body = gap || section.body;
      changed = true;
    }
    if (body === section.body) {
      return section;
    }
    changed = true;
    return { ...section, body };
  });
  return changed ? { ...draft, sections } : draft;
}
