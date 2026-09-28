import {
  passageExcerpt,
  presenterSpokenLines,
  type BookReadKind,
  type DeckSlide,
  type ExamDraft,
  type ExamPassage,
  type LessonOutline,
  type LessonShape,
  type PresenterPlan,
} from "./draft";

const LESSON_KINDS = ["section", "bullets", "bullets", "close"] as const;

/** A lesson is an aim, one example, a self-check, and a close. Each slide has words. */
export function lessonShapeOk(outline: LessonOutline): boolean {
  if (!outline.title.trim() || outline.slides.length !== LESSON_KINDS.length) {
    return false;
  }
  return outline.slides.every((slide, index) => {
    return (
      slide.kind === LESSON_KINDS[index] &&
      slide.heading.trim().length > 0 &&
      slide.bullets.some((bullet) => bullet.trim().length > 0) &&
      slide.notes.trim().length > 0
    );
  });
}

/**
 * Every quiz item points at a retrieved Knowledge source, and the quoted sentence is in that source.
 * An empty desk keeps one readable item and cites nothing.
 */
export function examCitationsOk(exam: ExamDraft, passages: ExamPassage[]): boolean {
  const usable = passages
    .filter((passage) => passage.sourceId.trim() && passage.text.trim() && passage.name.trim())
    .slice(0, 5);
  if (exam.emptyBase) {
    const item = exam.items[0];
    return (
      usable.length === 0 &&
      exam.items.length === 1 &&
      item !== undefined &&
      item.sourceId === "" &&
      item.citation === "" &&
      item.prompt.trim().length > 0 &&
      item.choices.length >= 2 &&
      item.answer.trim().length > 0
    );
  }
  if (usable.length === 0 || exam.items.length !== usable.length) {
    return false;
  }
  return exam.items.every((item) => {
    const source = usable.find((passage) => passage.sourceId === item.sourceId);
    if (!source || !item.sourceId.trim()) {
      return false;
    }
    const quote = passageExcerpt(source.text);
    return (
      quote.length > 0 &&
      source.text.includes(quote) &&
      item.citation.includes(item.sourceId) &&
      item.citation.includes(quote)
    );
  });
}

/** Spoken lines are the slide lines, in order. The plan does not render a video file. */
export function presenterPlanOk(plan: PresenterPlan, slides: DeckSlide[]): boolean {
  if (plan.rendered !== false || (plan.locale !== "en" && plan.locale !== "id")) {
    return false;
  }
  const allowed = presenterSpokenLines(plan.locale, slides);
  if (plan.cues.length !== allowed.length || plan.avatar.placements.length !== slides.length) {
    return false;
  }
  const cuesMatch = plan.cues.every(
    (cue, index) => cue.slideIndex === allowed[index]?.slideIndex && cue.text === allowed[index]?.text,
  );
  if (!cuesMatch || plan.dubScript !== plan.cues.map((cue) => cue.text).join("\n")) {
    return false;
  }
  return plan.avatar.placements.every((placement, index) => placement.slideIndex === index);
}

const LOCAL_BOOK_KINDS: readonly BookReadKind[] = ["text-layer", "local-ocr", "local-ocr-empty", "unsupported"];

/** The page was read on this machine. A kind outside this set is not a result we keep. */
export function bookReadStaysLocal(kind: string): kind is BookReadKind {
  return (LOCAL_BOOK_KINDS as readonly string[]).includes(kind);
}

export type LessonEdit = {
  slideIndex: number;
  heading: string;
  shape: LessonShape;
};

/** Change one heading and add one shape. Other slides are copied through. */
export function applyLessonEdit(outline: LessonOutline, edit: LessonEdit): LessonOutline {
  return {
    ...outline,
    slides: outline.slides.map((slide, index) => {
      if (index !== edit.slideIndex) {
        return slide;
      }
      return {
        ...slide,
        heading: edit.heading.trim(),
        shapes: [...slide.shapes, edit.shape],
      };
    }),
  };
}

/** The edited slide changed, and every other slide is the one we started with. */
export function lessonEditOk(before: LessonOutline, after: LessonOutline, edit: LessonEdit): boolean {
  const target = before.slides[edit.slideIndex];
  const next = after.slides[edit.slideIndex];
  if (!target || !next || !edit.heading.trim() || after.slides.length !== before.slides.length) {
    return false;
  }
  if (next.heading !== edit.heading.trim() || next.shapes.length !== target.shapes.length + 1) {
    return false;
  }
  const added = next.shapes[next.shapes.length - 1];
  if (!added || added.id !== edit.shape.id || added.kind !== edit.shape.kind) {
    return false;
  }
  return after.slides.every((slide, index) => {
    if (index === edit.slideIndex) {
      return (
        slide.kind === target.kind &&
        slide.bullets.join("\n") === target.bullets.join("\n") &&
        slide.notes === target.notes
      );
    }
    return JSON.stringify(slide) === JSON.stringify(before.slides[index]);
  });
}
