import { readFileSync } from "node:fs";
import { outputLanguageRule, type AppLocale } from "@agentforge/core";
import {
  draftExam,
  draftLesson,
  draftPresenter,
  renderPagePng,
  type ExamDraft,
  type LessonShape,
} from "@agentforge/university";
import { describe, expect, it } from "vitest";
import {
  handlePostEducationBook,
  handlePostEducationExam,
  handlePostEducationLesson,
  handlePostEducationPresenter,
} from "../handlers/education";
import { withRequestLocale } from "../run-context";
import type { HostRequest, HostResult } from "../types";
import {
  passagesFromKnowledge,
  runBookRead,
  runExamFromKnowledge,
  runLessonEdit,
  runPresenter,
  runTeachingDeck,
} from "./harness";

const shape: LessonShape = {
  id: "shape-1",
  kind: "ellipse",
  x: 10,
  y: 12,
  w: 18,
  h: 18,
  text: "",
  fill: "F7F7F6",
  stroke: "0F766E",
};

const passage = { sourceId: "src-rivers", name: "Notes", text: "Rivers carry silt to the mouth." };

function request(body: unknown, files?: HostRequest["files"]): HostRequest {
  return { method: "POST", path: "/api/v1/education/lesson", query: {}, params: {}, headers: {}, body, files };
}

function jsonBody(result: HostResult): Record<string, unknown> {
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return result.body as Record<string, unknown>;
}

describe("education skills", () => {
  it("runs the teaching deck", () => {
    const run = runTeachingDeck("en", "tides");
    expect(run.trace.skill).toBe("teaching-deck");
    expect(run.trace.checked).toBe(true);
    expect(run.trace.attempts).toBe(1);
    expect(run.trace.phases).toEqual(["brief", "draft", "check"]);
    expect(run.outline.title).toBe("Lesson: tides");
    expect(run.outline.slides).toHaveLength(4);
    expect(run.language.brief).toContain(run.language.languageRule);
    expect(run.language.languageRule).toBe(outputLanguageRule("education", "en"));
  });

  it("retries a thin lesson once, then repairs it", () => {
    let calls = 0;
    const once = runTeachingDeck("id", "pasang", (locale, topic) => {
      calls += 1;
      if (calls === 1) {
        return { title: "x", slides: [] };
      }
      return draftLesson(locale, topic);
    });
    expect(once.trace.attempts).toBe(2);
    expect(once.trace.phases).toEqual(["brief", "draft", "check", "retry", "check"]);
    expect(once.trace.checked).toBe(true);
    expect(once.outline.title).toBe("Pelajaran: pasang");

    const always = runTeachingDeck("en", "tides", () => ({ title: "x", slides: [] }));
    expect(always.trace.phases).toContain("repair");
    expect(always.trace.attempts).toBe(2);
    expect(always.trace.checked).toBe(true);
    expect(always.outline.slides).toHaveLength(4);
  });

  it("runs a slide edit and does not retry it", () => {
    const lesson = draftLesson("en", "tides");
    const run = runLessonEdit("en", lesson, { slideIndex: 0, heading: "A clearer aim", shape });
    expect(run.trace.skill).toBe("edit-text-and-shapes");
    expect(run.trace.phases).toEqual(["brief", "edit", "check"]);
    expect(run.trace.attempts).toBe(1);
    expect(run.trace.checked).toBe(true);
    expect(run.outline.slides[0]?.heading).toBe("A clearer aim");
    expect(run.outline.slides[0]?.shapes).toEqual([shape]);
    expect(run.outline.slides[1]).toEqual(lesson.slides[1]);
    expect(run.outline.slides[3]).toEqual(lesson.slides[3]);

    const blank = runLessonEdit("en", lesson, { slideIndex: 0, heading: "  ", shape });
    expect(blank.trace.checked).toBe(false);
    expect(blank.outline).toEqual(lesson);
    expect(blank.trace.phases).not.toContain("retry");
  });

  it("runs a quiz whose citations point at Knowledge sources", () => {
    const passages = passagesFromKnowledge([
      { sourceId: passage.sourceId, sourceName: passage.name, body: passage.text },
      { sourceId: "", sourceName: "Dropped", body: "This chunk has no source." },
    ]);
    expect(passages).toEqual([passage]);
    const run = runExamFromKnowledge("en", "rivers", passages);
    expect(run.trace.skill).toBe("exam-from-knowledge");
    expect(run.trace.checked).toBe(true);
    expect(run.trace.attempts).toBe(1);
    expect(run.exam.emptyBase).toBe(false);
    expect(run.exam.items[0]?.sourceId).toBe("src-rivers");
    expect(run.exam.items[0]?.citation).toContain("src-rivers");
    expect(run.exam.items[0]?.citation).toContain("Rivers carry silt");
    expect(run.language.brief).toContain(outputLanguageRule("education", "en"));
  });

  it("retries a quiz citation that names some other source", () => {
    const passages = [passage];
    let calls = 0;
    const forge = (locale: unknown, topic: string, rows: typeof passages): ExamDraft => {
      calls += 1;
      const exam = draftExam(locale, topic, rows);
      if (calls === 1) {
        return {
          ...exam,
          items: exam.items.map((item) => ({ ...item, sourceId: "forged", citation: "forged: not in the source" })),
        };
      }
      return exam;
    };
    const once = runExamFromKnowledge("id", "sungai", passages, forge);
    expect(once.trace.attempts).toBe(2);
    expect(once.trace.phases).toContain("retry");
    expect(once.exam.items[0]?.sourceId).toBe("src-rivers");
    expect(once.trace.checked).toBe(true);

    const always = runExamFromKnowledge("en", "rivers", passages, (locale, topic, rows) => {
      const exam = draftExam(locale, topic, rows);
      return {
        ...exam,
        items: exam.items.map((item) => ({ ...item, sourceId: "forged", citation: "forged" })),
      };
    });
    expect(always.trace.phases).toContain("repair");
    expect(always.trace.attempts).toBe(2);
    expect(always.exam.items[0]?.sourceId).toBe("src-rivers");
    expect(always.trace.checked).toBe(true);
  });

  it("still runs a readable quiz when nothing was saved", () => {
    const run = runExamFromKnowledge("en", "rivers", []);
    expect(run.exam.emptyBase).toBe(true);
    expect(run.exam.items[0]?.sourceId).toBe("");
    expect(run.exam.items[0]?.citation).toBe("");
    expect(run.exam.items[0]?.prompt).toMatch(/No indexed passage/);
    expect(run.trace.checked).toBe(true);
    expect(run.trace.attempts).toBe(1);
  });

  it("runs a page read on this machine and does not retry it", async () => {
    const png = renderPagePng("LOCAL PAGE SCAN");
    const run = await runBookRead("en", { filename: "page.png", bytes: png });
    expect(run.trace.skill).toBe("book-reader");
    expect(run.trace.phases).toEqual(["brief", "read", "check"]);
    expect(run.trace.attempts).toBe(1);
    expect(run.trace.checked).toBe(true);
    expect(run.read.kind).toBe("local-ocr");
    expect(run.read.text).toBe("LOCAL PAGE SCAN");
    expect(run.trace.phases).not.toContain("retry");

    const refused = await runBookRead("id", { filename: "notes.txt", bytes: new Uint8Array([1, 2, 3, 4]) });
    expect(refused.read.kind).toBe("unsupported");
    expect(refused.read.text).toBe("");
    expect(refused.trace.checked).toBe(true);

    const reader = readFileSync(new URL("./read-book.ts", import.meta.url), "utf8");
    const harness = readFileSync(new URL("./harness.ts", import.meta.url), "utf8");
    for (const source of [reader, harness]) {
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/tesseract|ocr\.space|vision\.googleapis/i);
      expect(source).not.toMatch(/presentation-generate|presentation-pptx|presentation-outline/);
    }
  });

  it("runs the show from the lesson and retries a line that is not on a slide", () => {
    const lesson = draftLesson("id", "pasang");
    const run = runPresenter("id", lesson);
    expect(run.trace.skill).toBe("video-presenter");
    expect(run.trace.checked).toBe(true);
    expect(run.trace.attempts).toBe(1);
    expect(run.plan.rendered).toBe(false);
    expect(run.plan.avatar.label).toBe("Penyaji");
    expect(run.plan.cues[0]?.text).toContain("Untuk apa pelajaran ini");
    expect(run.plan.dubScript).toContain("Periksa pemahaman Anda");
    expect(run.language.languageRule).toBe(outputLanguageRule("education", "id"));

    let calls = 0;
    const once = runPresenter("en", lesson, (locale, outline) => {
      calls += 1;
      const plan = draftPresenter(locale, outline);
      if (calls === 1) {
        return {
          ...plan,
          cues: [...plan.cues, { slideIndex: 0, startMs: 9, endMs: 10, text: "invented fact" }],
          dubScript: "invented fact",
        };
      }
      return plan;
    });
    expect(once.trace.attempts).toBe(2);
    expect(once.trace.phases).toContain("retry");
    expect(once.plan.cues.some((cue) => cue.text === "invented fact")).toBe(false);
    expect(once.trace.checked).toBe(true);

    const always = runPresenter("en", lesson, (locale, outline) => {
      const plan = draftPresenter(locale, outline);
      return { ...plan, cues: [], dubScript: "invented fact" };
    });
    expect(always.trace.phases).toContain("repair");
    expect(always.trace.attempts).toBe(2);
    expect(always.plan.dubScript).not.toContain("invented fact");
    expect(always.trace.checked).toBe(true);
  });

  it("keeps campus nouns out of a skill run", () => {
    const blob = JSON.stringify({
      lesson: runTeachingDeck("en", "desk"),
      exam: runExamFromKnowledge("en", "desk", []),
      show: runPresenter("en", draftLesson("en", "desk")),
    });
    expect(blob).not.toMatch(/\bstudent\b|\bcourse\b|\bcampus\b/i);
  });
});

describe("education routes on the stub desk", () => {
  async function asLocale(locale: AppLocale, run: () => Promise<HostResult>): Promise<HostResult> {
    return withRequestLocale(() => locale, run);
  }

  it("drafts the lesson in the request locale", async () => {
    const result = await asLocale("id", () => handlePostEducationLesson(request({ topic: "pasang" })));
    expect(result.status).toBe(200);
    const body = jsonBody(result);
    const outline = body.outline as { title: string; slides: unknown[] };
    expect(outline.title).toBe("Pelajaran: pasang");
    expect(outline.slides).toHaveLength(4);
    expect(body.brief).toContain(outputLanguageRule("education", "id"));
    expect(body.harness).toMatchObject({ skill: "teaching-deck", checked: true, attempts: 1 });
  });

  it("returns a readable quiz when the desk has no source", async () => {
    const result = await asLocale("en", () => handlePostEducationExam(request({ topic: "rivers" })));
    expect(result.status).toBe(200);
    const body = jsonBody(result);
    expect(body.emptyBase).toBe(true);
    const items = body.items as Array<{ sourceId: string; prompt: string; citation: string }>;
    expect(items[0]?.sourceId).toBe("");
    expect(items[0]?.citation).toBe("");
    expect(items[0]?.prompt.length).toBeGreaterThan(0);
    expect(body.harness).toMatchObject({ skill: "exam-from-knowledge", checked: true });
  });

  it("reads a local page and shows the lesson", async () => {
    const png = renderPagePng("LOCAL PAGE SCAN");
    const book = await asLocale("en", () =>
      handlePostEducationBook(
        request(undefined, [{ field: "file", filename: "page.png", mime: "image/png", bytes: png }]),
      ),
    );
    const bookBody = jsonBody(book);
    expect(bookBody.kind).toBe("local-ocr");
    expect(bookBody.text).toBe("LOCAL PAGE SCAN");
    expect(bookBody.harness).toMatchObject({ skill: "book-reader", attempts: 1, checked: true });

    const lesson = draftLesson("en", "tides");
    const show = await asLocale("en", () => handlePostEducationPresenter(request({ outline: lesson })));
    const showBody = jsonBody(show);
    expect(showBody.rendered).toBe(false);
    expect(showBody.harness).toMatchObject({ skill: "video-presenter", checked: true, attempts: 1 });
    const cues = showBody.cues as Array<{ text: string }>;
    expect(cues[0]?.text).toContain("What this lesson is for");
  });
});
