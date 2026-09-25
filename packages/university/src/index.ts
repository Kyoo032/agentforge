export { universityLabels, universityPack } from "./labels";
export { universityTemplates, agentPacks, STUDENTS_PACK_ID } from "./templates";
export type { AgentTemplate, AgentPack } from "@agentforge/core";
export { registerUniversityTools } from "./register";
export { courseCatalogSearchTool } from "./tools/course-catalog";
export { campusFaqLookupTool } from "./tools/campus-faq";
export {
  bookReadMessage,
  draftExam,
  draftLesson,
  draftPresenter,
  educationLocale,
} from "./education/draft";
export type {
  BookReadKind,
  ExamDraft,
  ExamItem,
  LessonOutline,
  PresenterPlan,
} from "./education/draft";
export { readPagePng, renderPagePng } from "./education/page-face";
