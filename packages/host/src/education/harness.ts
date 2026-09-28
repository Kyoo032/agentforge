import { outputLanguageRule, withOutputLanguage, type AppLocale } from "@agentforge/core";
import {
  applyLessonEdit,
  bookReadMessage,
  bookReadStaysLocal,
  draftExam,
  draftLesson,
  draftPresenter,
  examCitationsOk,
  lessonEditOk,
  lessonShapeOk,
  presenterPlanOk,
  type DeckSlide,
  type ExamDraft,
  type ExamPassage,
  type LessonEdit,
  type LessonOutline,
  type PresenterPlan,
} from "@agentforge/university";
import { readBookFile, type BookRead } from "./read-book";

export type EducationSkillId =
  | "teaching-deck"
  | "edit-text-and-shapes"
  | "exam-from-knowledge"
  | "book-reader"
  | "video-presenter";

export type EducationHarnessTrace = {
  skill: EducationSkillId;
  phases: string[];
  /** Draft attempts. A code repair after the one retry does not add a third attempt. */
  attempts: number;
  checked: boolean;
};

export type EducationLanguage = {
  brief: string;
  languageRule: string;
};

type Settled<T> = {
  value: T;
  attempts: number;
  retried: boolean;
  repaired: boolean;
};

function educationBrief(locale: AppLocale, seed: string): EducationLanguage {
  return {
    brief: withOutputLanguage(seed, "education", locale),
    languageRule: outputLanguageRule("education", locale),
  };
}

function withOneRetry<T>(draft: () => T, ok: (value: T) => boolean, repair: () => T): Settled<T> {
  const first = draft();
  if (ok(first)) {
    return { value: first, attempts: 1, retried: false, repaired: false };
  }
  const second = draft();
  if (ok(second)) {
    return { value: second, attempts: 2, retried: true, repaired: false };
  }
  return { value: repair(), attempts: 2, retried: true, repaired: true };
}

function phases(start: string[], settled: { retried: boolean; repaired: boolean }): string[] {
  const list = [...start, "check"];
  if (settled.retried) {
    list.push("retry", "check");
  }
  if (settled.repaired) {
    list.push("repair");
  }
  return list;
}

type LessonDrafter = (locale: unknown, topic: string) => LessonOutline;

/** Topic to a four-slide lesson. One retry when the shape is thin, then the fixed lesson. */
export function runTeachingDeck(
  locale: AppLocale,
  topic: string,
  draft: LessonDrafter = draftLesson,
): { outline: LessonOutline; language: EducationLanguage; trace: EducationHarnessTrace } {
  const language = educationBrief(locale, topic);
  const settled = withOneRetry(
    () => draft(locale, topic),
    lessonShapeOk,
    () => draftLesson(locale, topic),
  );
  return {
    outline: settled.value,
    language,
    trace: {
      skill: "teaching-deck",
      phases: phases(["brief", "draft"], settled),
      attempts: settled.attempts,
      checked: lessonShapeOk(settled.value),
    },
  };
}

/** Change one heading and add one shape. The other slides stay. No retry. */
export function runLessonEdit(
  locale: AppLocale,
  outline: LessonOutline,
  edit: LessonEdit,
): { outline: LessonOutline; language: EducationLanguage; trace: EducationHarnessTrace } {
  const language = educationBrief(locale, edit.heading);
  const next = applyLessonEdit(outline, edit);
  const checked = lessonEditOk(outline, next, edit);
  return {
    outline: checked ? next : outline,
    language,
    trace: {
      skill: "edit-text-and-shapes",
      phases: ["brief", "edit", "check"],
      attempts: 1,
      checked,
    },
  };
}

/** Chunks the exam may cite. A chunk with no Knowledge source id is dropped. */
export function passagesFromKnowledge(
  chunks: Array<{ sourceId?: string; sourceName?: string; body?: string }>,
): ExamPassage[] {
  const passages: ExamPassage[] = [];
  for (const chunk of chunks) {
    const sourceId = typeof chunk.sourceId === "string" ? chunk.sourceId.trim() : "";
    const text = typeof chunk.body === "string" ? chunk.body.trim() : "";
    if (!sourceId || !text) {
      continue;
    }
    const name = (typeof chunk.sourceName === "string" ? chunk.sourceName.trim() : "") || sourceId;
    passages.push({ sourceId, name, text });
  }
  return passages;
}

type ExamDrafter = (locale: unknown, topic: string, passages: ExamPassage[]) => ExamDraft;

/**
 * Quiz from retrieved passages. A citation that does not name one of those source ids
 * is retried once, then rebuilt from the passages.
 */
export function runExamFromKnowledge(
  locale: AppLocale,
  topic: string,
  passages: ExamPassage[],
  draft: ExamDrafter = draftExam,
): { exam: ExamDraft; language: EducationLanguage; trace: EducationHarnessTrace } {
  const language = educationBrief(locale, topic);
  const settled = withOneRetry(
    () => draft(locale, topic, passages),
    (exam) => examCitationsOk(exam, passages),
    () => draftExam(locale, topic, passages),
  );
  return {
    exam: settled.value,
    language,
    trace: {
      skill: "exam-from-knowledge",
      phases: phases(["brief", "retrieve", "draft"], settled),
      attempts: settled.attempts,
      checked: examCitationsOk(settled.value, passages),
    },
  };
}

type PresenterDrafter = (locale: unknown, outline: { title?: string; slides?: DeckSlide[] }) => PresenterPlan;

/** Avatar, cues, and a dub from the lesson. A line that is not on a slide is retried once. */
export function runPresenter(
  locale: AppLocale,
  outline: { title?: string; slides?: DeckSlide[] },
  draft: PresenterDrafter = draftPresenter,
): { plan: PresenterPlan; language: EducationLanguage; trace: EducationHarnessTrace } {
  const slides = Array.isArray(outline.slides) ? outline.slides : [];
  const language = educationBrief(locale, outline.title ?? "");
  const settled = withOneRetry(
    () => draft(locale, { title: outline.title, slides }),
    (plan) => presenterPlanOk(plan, slides),
    () => draftPresenter(locale, { title: outline.title, slides }),
  );
  return {
    plan: settled.value,
    language,
    trace: {
      skill: "video-presenter",
      phases: phases(["brief", "draft"], settled),
      attempts: settled.attempts,
      checked: presenterPlanOk(settled.value, slides),
    },
  };
}

/**
 * Read a page on this machine. There is no retry: a second pass would be the place an OCR
 * service could be called, and this skill does not call one.
 */
export async function runBookRead(
  locale: AppLocale,
  file: { filename: string; bytes: Uint8Array },
): Promise<{ read: BookRead; language: EducationLanguage; trace: EducationHarnessTrace }> {
  const language = educationBrief(locale, file.filename);
  const read = await readBookFile(locale, file);
  const checked = bookReadStaysLocal(read.kind);
  const safe: BookRead = checked
    ? read
    : { kind: "local-ocr-empty", text: "", message: bookReadMessage(locale, "local-ocr-empty") };
  return {
    read: safe,
    language,
    trace: {
      skill: "book-reader",
      phases: ["brief", "read", "check"],
      attempts: 1,
      checked: bookReadStaysLocal(safe.kind),
    },
  };
}
