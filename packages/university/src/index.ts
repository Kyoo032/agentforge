export { universityLabels, universityPack } from "./labels";
export { universityTemplates, agentPacks, STUDENTS_PACK_ID } from "./templates";
export type { AgentTemplate, AgentPack } from "@agentforge/core";
export { registerUniversityTools } from "./register";
export { courseCatalogSearchTool } from "./tools/course-catalog";
export { campusFaqLookupTool } from "./tools/campus-faq";
export {
  applyLessonEdit,
  bookReadStaysLocal,
  examCitationsOk,
  lessonEditOk,
  lessonShapeOk,
  presenterPlanOk,
} from "./education/checks";
export type { LessonEdit } from "./education/checks";
export {
  bookReadMessage,
  draftExam,
  draftLesson,
  draftPresenter,
  educationLocale,
  passageExcerpt,
  presenterSpokenLines,
} from "./education/draft";
export type {
  BookReadKind,
  DeckSlide,
  ExamDraft,
  ExamItem,
  ExamPassage,
  LessonOutline,
  LessonShape,
  PresenterPlan,
} from "./education/draft";
export { readPagePng, renderPagePng } from "./education/page-face";
