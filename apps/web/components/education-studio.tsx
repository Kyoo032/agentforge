"use client";

import { useState, type FormEvent } from "react";
import { PresentationPreview } from "@/components/presentation-preview";
import { apiFetch } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { parsePresentationOutlineBody, type PresentationOutline } from "@/lib/presentation-outline";

type Tab = "lesson" | "exam" | "book" | "presenter";

type ExamItem = {
  prompt: string;
  choices: string[];
  answer: string;
  citation: string;
};

type ExamDraft = {
  title: string;
  emptyBase: boolean;
  items: ExamItem[];
};

type BookRead = {
  kind: string;
  text: string;
  message: string;
};

type PresenterPlan = {
  rendered: false;
  avatar: {
    id: string;
    label: string;
    placements: Array<{ slideIndex: number; x: number; y: number; w: number; h: number; motion: string }>;
  };
  cues: Array<{ slideIndex: number; startMs: number; text: string }>;
  dubScript: string;
};

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

function PresenterStage({
  presenter,
  cueIndex,
  onCue,
  heading,
}: {
  presenter: PresenterPlan;
  cueIndex: number;
  onCue: (index: number) => void;
  heading?: string;
}) {
  const cue = presenter.cues[cueIndex] ?? presenter.cues[0];
  const placement =
    presenter.avatar.placements.find((item) => item.slideIndex === (cue?.slideIndex ?? 0)) ??
    presenter.avatar.placements[0];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]" data-testid="education-presenter-layout">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-3)]">
          {t("education.presenterStage")}
        </p>
        <div
          className="relative aspect-video overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)]"
          data-testid="education-presenter-stage"
        >
          <div className="absolute inset-y-0 left-0 w-1.5 bg-[var(--accent)]" />
          <div className="px-8 py-8">
            <h2 className="max-w-xl text-2xl font-medium">{heading || presenter.avatar.label}</h2>
          </div>
          {placement ? (
            <div
              className="absolute flex flex-col items-center justify-end rounded-t-full bg-[var(--accent)] px-1 pb-1 text-center text-[10px] font-medium leading-tight text-[var(--surface)]"
              data-testid="education-presenter-avatar"
              data-motion={placement.motion}
              style={{
                left: `${placement.x}%`,
                top: `${placement.y}%`,
                width: `${placement.w}%`,
                height: `${placement.h}%`,
              }}
            >
              <span>{presenter.avatar.label}</span>
              <span>
                {placement.motion} {placement.x},{placement.y}
              </span>
            </div>
          ) : null}
          {cue ? (
            <p
              className="absolute bottom-4 left-6 right-6 rounded-lg bg-[var(--text)] px-3 py-2 text-sm text-[var(--surface)]"
              data-testid="education-presenter-cue"
            >
              <span className="mr-2 text-xs uppercase opacity-70">{t("education.subtitleLabel")}</span>
              {cue.text}
            </p>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {presenter.cues.map((item, index) => (
            <button
              key={`${item.slideIndex}-${item.startMs}`}
              type="button"
              className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] px-2 text-xs"
              aria-pressed={index === cueIndex}
              onClick={() => onCue(index)}
            >
              {item.startMs} ms
            </button>
          ))}
        </div>
      </div>
      <aside className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-medium">{t("education.dubHeading")}</h3>
        <div className="mt-3 space-y-3 text-sm leading-relaxed" data-testid="education-presenter-dub">
          {presenter.dubScript.split("\n").map((line, index) => (
            <p key={`${index}-${line.slice(0, 48)}`}>{line}</p>
          ))}
        </div>
      </aside>
    </div>
  );
}

export function EducationStudio() {
  const [tab, setTab] = useState<Tab>("lesson");
  const [topic, setTopic] = useState("");
  const [outline, setOutline] = useState<PresentationOutline | null>(null);
  const [exam, setExam] = useState<ExamDraft | null>(null);
  const [book, setBook] = useState<BookRead | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [presenter, setPresenter] = useState<PresenterPlan | null>(null);
  const [cueIndex, setCueIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onLesson(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy("lesson");
    setError(null);
    setSaved(false);
    try {
      const res = await apiFetch("/api/v1/education/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = (await res.json().catch(() => null)) as { outline?: unknown } | null;
      if (!res.ok || !data?.outline) {
        throw new Error(errorMessage(data, t("education.lessonError")));
      }
      setOutline(parsePresentationOutlineBody(data.outline));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("education.lessonError"));
    } finally {
      setBusy(null);
    }
  }

  async function onExam(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy("exam");
    setError(null);
    try {
      const res = await apiFetch("/api/v1/education/exam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, t("education.examError")));
      }
      setExam(data as ExamDraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("education.examError"));
    } finally {
      setBusy(null);
    }
  }

  async function onBook(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) {
      return;
    }
    setBusy("book");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await apiFetch("/api/v1/education/book", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, t("education.bookError")));
      }
      setBook(data as BookRead);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("education.bookError"));
    } finally {
      setBusy(null);
    }
  }

  async function onPresenter() {
    if (!outline || busy) {
      return;
    }
    setBusy("presenter");
    setError(null);
    try {
      const res = await apiFetch("/api/v1/education/presenter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outline }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, t("education.presenterError")));
      }
      setPresenter(data as PresenterPlan);
      setCueIndex(0);
      setTab("presenter");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("education.presenterError"));
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    if (!outline || busy) {
      return;
    }
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      const res = await apiFetch("/api/v1/presentations/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outline }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, t("education.saveError")));
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("education.saveError"));
    } finally {
      setBusy(null);
    }
  }

  const tabs: Array<{ id: Tab; label: string; testId: string }> = [
    { id: "lesson", label: t("education.tabLesson"), testId: "education-tab-lesson" },
    { id: "exam", label: t("education.tabExam"), testId: "education-tab-exam" },
    { id: "book", label: t("education.tabBook"), testId: "education-tab-book" },
    { id: "presenter", label: t("education.tabPresenter"), testId: "education-tab-presenter" },
  ];

  return (
    <main
      className="mx-auto flex min-h-full max-w-[var(--content-wide)] flex-col px-6 py-10 text-[var(--text)]"
      data-testid="education-studio"
    >
      <h1 className="text-2xl font-medium tracking-[var(--track)]">{t("education.title")}</h1>
      <p className="mt-2 max-w-[var(--content-narrow)] text-sm text-[var(--text-2)]" data-testid="expected-inputs">
        {t("education.expectedInputs")}
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className="wash inline-flex h-8 items-center rounded-pill border border-[var(--line)] px-4 text-sm"
            data-testid={item.testId}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <div
          className="mt-6 rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
          data-testid="education-error"
        >
          {error}
        </div>
      ) : null}

      {tab === "lesson" ? (
        <div className="mt-8">
          <form className="flex flex-wrap gap-2" onSubmit={(event) => void onLesson(event)}>
            <input
              className="text-field min-w-64 flex-1"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder={t("education.topicPlaceholder")}
              aria-label={t("education.topicLabel")}
              data-testid="education-lesson-topic"
            />
            <button
              type="submit"
              className="wash inline-flex h-8 items-center rounded-pill bg-[var(--accent)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-45"
              disabled={busy !== null}
              data-testid="education-lesson-draft"
            >
              {busy === "lesson" ? t("education.drafting") : t("education.draftLesson")}
            </button>
          </form>
          {outline ? (
            <div className="mt-6">
              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="wash inline-flex h-8 items-center rounded-pill border border-[var(--line)] px-4 text-sm"
                  data-testid="education-save-deck"
                  disabled={busy !== null}
                  onClick={() => void onSave()}
                >
                  {t("education.saveDeck")}
                </button>
                <button
                  type="button"
                  className="wash inline-flex h-8 items-center rounded-pill border border-[var(--line)] px-4 text-sm"
                  data-testid="education-presenter-build"
                  disabled={busy !== null}
                  onClick={() => void onPresenter()}
                >
                  {t("education.buildPresenter")}
                </button>
              </div>
              {saved ? <p className="mb-3 text-sm text-[var(--text-2)]">{t("education.deckSaved")}</p> : null}
              <PresentationPreview
                outline={outline}
                onOutlineChange={(next) => {
                  setOutline(next);
                  setSaved(false);
                }}
              />
            </div>
          ) : (
            <p className="mt-8 text-sm text-[var(--text-2)]">{t("education.lessonEmpty")}</p>
          )}
        </div>
      ) : null}

      {tab === "exam" ? (
        <form className="mt-8" onSubmit={(event) => void onExam(event)}>
          <div className="flex flex-wrap gap-2">
            <input
              className="text-field min-w-64 flex-1"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder={t("education.topicPlaceholder")}
              aria-label={t("education.topicLabel")}
              data-testid="education-exam-topic"
            />
            <button
              type="submit"
              className="wash inline-flex h-8 items-center rounded-pill bg-[var(--accent)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-45"
              disabled={busy !== null}
              data-testid="education-exam-generate"
            >
              {busy === "exam" ? t("education.drafting") : t("education.generateExam")}
            </button>
          </div>
          {exam ? (
            <section
              className="mx-auto mt-8 max-w-3xl rounded-xl border border-[var(--line)] bg-[var(--surface)] px-8 py-8"
              data-testid="education-exam-sheet"
            >
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-3)]">
                {t("education.examKicker")}
              </p>
              <h2 className="mt-2 text-2xl font-medium">{exam.title}</h2>
              <ol className="mt-8 space-y-8">
                {exam.items.map((item, index) => (
                  <li key={item.prompt} data-testid="education-exam-item">
                    <p className="text-base font-medium">
                      {index + 1}. {item.prompt}
                    </p>
                    <ul className="mt-3 space-y-2">
                      {item.choices.map((choice, choiceIndex) => (
                        <li
                          key={choice}
                          className="flex items-start gap-3 rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                          data-testid="education-exam-choice"
                          data-correct={choice === item.answer ? "true" : "false"}
                        >
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-xs">
                            {String.fromCharCode(65 + choiceIndex)}
                          </span>
                          <span>{choice}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-sm" data-testid="education-exam-answer">
                      {t("education.answer")}: {item.answer}
                    </p>
                    {item.citation ? <p className="mt-1 text-xs text-[var(--text-3)]">{item.citation}</p> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </form>
      ) : null}

      {tab === "book" ? (
        <form className="mt-8 space-y-3" onSubmit={(event) => void onBook(event)}>
          <input
            type="file"
            accept="image/png,application/pdf,.png,.pdf"
            data-testid="education-book-file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="submit"
            className="wash inline-flex h-8 items-center rounded-pill bg-[var(--accent)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-45"
            disabled={busy !== null || !file}
            data-testid="education-book-read"
          >
            {busy === "book" ? t("education.reading") : t("education.readBook")}
          </button>
          {book ? (
            <div
              className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
              data-testid="education-book-text"
            >
              <p className="text-sm text-[var(--text-2)]">{book.message}</p>
              {book.text ? <pre className="mt-3 whitespace-pre-wrap text-sm">{book.text}</pre> : null}
            </div>
          ) : null}
        </form>
      ) : null}

      {tab === "presenter" ? (
        <div className="mt-8 space-y-4">
          <button
            type="button"
            className="wash inline-flex h-8 items-center rounded-pill bg-[var(--accent)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-45"
            disabled={busy !== null || !outline}
            data-testid="education-presenter-build"
            onClick={() => void onPresenter()}
          >
            {busy === "presenter" ? t("education.drafting") : t("education.buildPresenter")}
          </button>
          {!outline ? <p className="text-sm text-[var(--text-2)]">{t("education.presenterNeedsDeck")}</p> : null}
          {presenter ? (
            <PresenterStage
              presenter={presenter}
              cueIndex={cueIndex}
              onCue={setCueIndex}
              heading={outline?.slides[presenter.cues[cueIndex]?.slideIndex ?? 0]?.heading}
            />
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
