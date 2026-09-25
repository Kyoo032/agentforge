import { describe, expect, it } from "vitest";
import { draftExam, draftLesson, draftPresenter } from "./draft";

describe("education drafts", () => {
  it("writes a lesson the editor can open, in English and Bahasa Indonesia", () => {
    const en = draftLesson("en", "tides");
    const id = draftLesson("id", "pasang");
    expect(en.title).toBe("Lesson: tides");
    expect(en.slides).toHaveLength(4);
    expect(en.slides[0]?.heading).toBe("What this lesson is for");
    expect(id.title).toBe("Pelajaran: pasang");
    expect(id.slides[2]?.heading).toBe("Periksa pemahaman Anda");
    expect(id.slides[0]?.heading).not.toBe(en.slides[0]?.heading);
  });

  it("builds a readable exam from passages, and still one when the base is empty", () => {
    const empty = draftExam("en", "rivers", []);
    expect(empty.emptyBase).toBe(true);
    expect(empty.items[0]?.prompt).toMatch(/No indexed passage/);
    expect(empty.items[0]?.answer).toBe("Add a source");

    const filled = draftExam("id", "sungai", [{ name: "Catatan", text: "Sungai membawa endapan ke muara." }]);
    expect(filled.emptyBase).toBe(false);
    expect(filled.locale).toBe("id");
    expect(filled.items[0]?.citation).toContain("Catatan");
    expect(filled.items[0]?.citation).toContain("Sungai membawa endapan");
    expect(filled.items[0]?.prompt).toMatch(/didukung/);
  });

  it("emits avatar placement, subtitle cues, and a dub script without rendering video", () => {
    const lesson = draftLesson("id", "pasang");
    const plan = draftPresenter("id", lesson);
    expect(plan.rendered).toBe(false);
    expect(plan.avatar.label).toBe("Penyaji");
    expect(plan.avatar.placements).toHaveLength(lesson.slides.length);
    expect(plan.avatar.placements[0]?.motion).toBe("enter-from-left");
    expect(plan.avatar.placements[1]?.x).toBeGreaterThan(0);
    expect(plan.cues.length).toBeGreaterThan(0);
    expect(plan.cues[0]?.text).toContain("Untuk apa pelajaran ini");
    expect(plan.dubScript).toContain("Periksa pemahaman Anda");
    expect(draftPresenter("en", lesson).avatar.label).toBe("Presenter");
  });

  it("does not use a campus noun in the draft module", () => {
    const blob = JSON.stringify(draftLesson("en", "desk")) + JSON.stringify(draftExam("en", "desk", []));
    expect(blob).not.toMatch(/\bstudent\b|\bcourse\b|\bcampus\b/i);
  });
});
