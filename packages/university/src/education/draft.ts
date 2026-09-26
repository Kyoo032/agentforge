import type { AppLocale } from "@agentforge/core";
import { parseAppLocale } from "@agentforge/core/locale";

/**
 * Education copy. English and Bahasa Indonesia only.
 * The words student, course, and campus stay out of this pack's new surface.
 */

export type EducationLocale = AppLocale;

export function educationLocale(value: unknown): EducationLocale {
  return parseAppLocale(value);
}

const LESSON = {
  en: {
    title: (topic: string) => (topic.trim() ? `Lesson: ${topic.trim()}` : "Lesson"),
    aimHeading: "What this lesson is for",
    aimBullet: "Name the one idea the room should be able to say back.",
    exampleHeading: "One worked example",
    exampleBullet: "Walk through a single case before adding a second.",
    checkHeading: "Check yourself",
    checkBullet: "Answer from the lesson, then look at the source again.",
    closeHeading: "What to remember",
    closeBullet: "Keep the idea, the example, and the check.",
    notes: "Say this out loud. Do not add a fact that is not on the slide.",
  },
  id: {
    title: (topic: string) => (topic.trim() ? `Pelajaran: ${topic.trim()}` : "Pelajaran"),
    aimHeading: "Untuk apa pelajaran ini",
    aimBullet: "Sebutkan satu gagasan yang harus dapat diulang oleh ruangan.",
    exampleHeading: "Satu contoh yang dikerjakan",
    exampleBullet: "Bahas satu kasus sebelum menambah kasus kedua.",
    checkHeading: "Periksa pemahaman Anda",
    checkBullet: "Jawab dari pelajaran ini, lalu lihat sumbernya lagi.",
    closeHeading: "Yang perlu diingat",
    closeBullet: "Simpan gagasan, contoh, dan pemeriksaannya.",
    notes: "Ucapkan ini. Jangan menambah fakta yang tidak ada di slide.",
  },
} as const;

export type LessonSlide = {
  kind: "section" | "bullets" | "close";
  heading: string;
  subhead: string;
  bullets: string[];
  aside: string;
  notes: string;
  shapes: [];
};

export type LessonOutline = {
  title: string;
  slides: LessonSlide[];
};

export function draftLesson(locale: unknown, topic: string): LessonOutline {
  const copy = LESSON[educationLocale(locale)];
  const slide = (kind: LessonSlide["kind"], heading: string, bullet: string): LessonSlide => ({
    kind,
    heading,
    subhead: "",
    bullets: [bullet],
    aside: "",
    notes: copy.notes,
    shapes: [],
  });
  return {
    title: copy.title(topic),
    slides: [
      slide("section", copy.aimHeading, copy.aimBullet),
      slide("bullets", copy.exampleHeading, copy.exampleBullet),
      slide("bullets", copy.checkHeading, copy.checkBullet),
      slide("close", copy.closeHeading, copy.closeBullet),
    ],
  };
}

export type ExamPassage = {
  name: string;
  text: string;
};

export type ExamItem = {
  prompt: string;
  choices: string[];
  answer: string;
  citation: string;
};

export type ExamDraft = {
  locale: EducationLocale;
  title: string;
  items: ExamItem[];
  /** True when no indexed passage was available. The exam is still readable. */
  emptyBase: boolean;
};

const EXAM = {
  en: {
    title: (topic: string) => (topic.trim() ? `Exam: ${topic.trim()}` : "Exam"),
    emptyPrompt: "No indexed passage was available. Add a source, then generate this exam again.",
    emptyChoice: "Add a source",
    emptyOther: "Invent a fact that was not saved",
    emptyAnswer: "Add a source",
    prompt: (name: string, excerpt: string) => `Which sentence is supported by “${name}”? ${excerpt}`,
    supported: "The sentence in the citation",
    unsupported: "A claim that does not appear in the passage",
    answer: "The sentence in the citation",
  },
  id: {
    title: (topic: string) => (topic.trim() ? `Ujian: ${topic.trim()}` : "Ujian"),
    emptyPrompt: "Tidak ada kutipan terindeks. Tambahkan sumber, lalu buat ujian ini lagi.",
    emptyChoice: "Tambahkan sumber",
    emptyOther: "Mengarang fakta yang tidak tersimpan",
    emptyAnswer: "Tambahkan sumber",
    prompt: (name: string, excerpt: string) => `Kalimat mana yang didukung oleh “${name}”? ${excerpt}`,
    supported: "Kalimat pada kutipan",
    unsupported: "Klaim yang tidak muncul dalam kutipan",
    answer: "Kalimat pada kutipan",
  },
} as const;

function excerpt(text: string): string {
  const sentence = text.replace(/\s+/g, " ").trim();
  const cut = sentence.split(/(?<=[.!?])\s/)[0] ?? sentence;
  return cut.slice(0, 180);
}

export function draftExam(locale: unknown, topic: string, passages: ExamPassage[]): ExamDraft {
  const lang = educationLocale(locale);
  const copy = EXAM[lang];
  const usable = passages.filter((passage) => passage.text.trim() && passage.name.trim()).slice(0, 5);
  if (usable.length === 0) {
    return {
      locale: lang,
      title: copy.title(topic),
      emptyBase: true,
      items: [
        {
          prompt: copy.emptyPrompt,
          choices: [copy.emptyChoice, copy.emptyOther],
          answer: copy.emptyAnswer,
          citation: "",
        },
      ],
    };
  }
  return {
    locale: lang,
    title: copy.title(topic),
    emptyBase: false,
    items: usable.map((passage) => {
      const quote = excerpt(passage.text);
      return {
        prompt: copy.prompt(passage.name, quote),
        choices: [copy.supported, copy.unsupported],
        answer: copy.answer,
        citation: `${passage.name}: ${quote}`,
      };
    }),
  };
}

export type AvatarMotion = "enter-from-left" | "hold" | "exit-to-right";

export type PresenterPlacement = {
  slideIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  motion: AvatarMotion;
};

export type PresenterCue = {
  slideIndex: number;
  startMs: number;
  endMs: number;
  text: string;
};

export type PresenterPlan = {
  locale: EducationLocale;
  rendered: false;
  avatar: {
    id: string;
    label: string;
    placements: PresenterPlacement[];
  };
  cues: PresenterCue[];
  dubScript: string;
};

const PRESENTER = {
  en: {
    label: "Presenter",
    slide: (index: number, heading: string) => `Slide ${index + 1}. ${heading}`,
    line: (text: string) => text,
  },
  id: {
    label: "Penyaji",
    slide: (index: number, heading: string) => `Slide ${index + 1}. ${heading}`,
    line: (text: string) => text,
  },
} as const;

const MOTION: AvatarMotion[] = ["enter-from-left", "hold", "exit-to-right"];

type DeckSlide = { heading?: string; bullets?: string[] };

export function draftPresenter(locale: unknown, outline: { title?: string; slides?: DeckSlide[] }): PresenterPlan {
  const lang = educationLocale(locale);
  const copy = PRESENTER[lang];
  const slides = Array.isArray(outline.slides) ? outline.slides : [];
  const placements: PresenterPlacement[] = slides.map((_, index) => ({
    slideIndex: index,
    x: 74,
    y: 58,
    w: 18,
    h: 28,
    motion: MOTION[index % MOTION.length] ?? "hold",
  }));
  const cues: PresenterCue[] = [];
  const spoken: string[] = [];
  slides.forEach((slide, index) => {
    const heading = (slide.heading ?? "").trim() || copy.slide(index, "");
    const bullets = (slide.bullets ?? []).map((bullet) => bullet.trim()).filter(Boolean);
    const lines = [copy.slide(index, heading), ...bullets.map((bullet) => copy.line(bullet))];
    lines.forEach((text, lineIndex) => {
      const startMs = index * 8000 + lineIndex * 2000;
      cues.push({ slideIndex: index, startMs, endMs: startMs + 2000, text });
      spoken.push(text);
    });
  });
  return {
    locale: lang,
    rendered: false,
    avatar: { id: "desk-presenter", label: copy.label, placements },
    cues,
    dubScript: spoken.join("\n"),
  };
}

const BOOK = {
  en: {
    "text-layer": "Read from the text already in the file. Nothing was sent away.",
    "local-ocr": "Read on this machine from the page image.",
    "local-ocr-empty":
      "The scan stayed on this machine. Local reading found no letters in the page face. Nothing was sent away.",
    unsupported: "This reader takes a PNG page or a PDF. Nothing was sent away.",
  },
  id: {
    "text-layer": "Dibaca dari teks yang sudah ada di berkas. Tidak ada yang dikirim ke luar.",
    "local-ocr": "Dibaca di mesin ini dari gambar halaman.",
    "local-ocr-empty":
      "Pindaian tetap di mesin ini. Pembacaan lokal tidak menemukan huruf pada wajah halaman. Tidak ada yang dikirim ke luar.",
    unsupported: "Pembaca ini menerima halaman PNG atau PDF. Tidak ada yang dikirim ke luar.",
  },
} as const;

export type BookReadKind = "text-layer" | "local-ocr" | "local-ocr-empty" | "unsupported";

export function bookReadMessage(locale: unknown, kind: BookReadKind): string {
  return BOOK[educationLocale(locale)][kind];
}
