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

export function EducationStudio() {
  const [tab, setTab] = useState<Tab>("lesson");
  const [topic, setTopic] = useState("");
  const [outline, setOutline] = useState<PresentationOutline | null>(null);
  const [exam, setExam] = useState<ExamDraft | null>(null);
  const [book, setBook] = useState<BookRead | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [presenter, setPresenter] = useState<PresenterPlan | null>(null);
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
            <div className="mt-6 space-y-4">
              <h2 className="text-lg font-medium">{exam.title}</h2>
              {exam.items.map((item) => (
                <article
                  key={item.prompt}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
                  data-testid="education-exam-item"
                >
                  <p className="text-sm">{item.prompt}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-2)]">
                    {item.choices.map((choice) => (
                      <li key={choice}>{choice}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm">
                    {t("education.answer")}: {item.answer}
                  </p>
                  {item.citation ? <p className="mt-1 text-xs text-[var(--text-3)]">{item.citation}</p> : null}
                </article>
              ))}
            </div>
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
            <div className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
              <p data-testid="education-presenter-avatar">
                {presenter.avatar.label} ·{" "}
                {presenter.avatar.placements[0]
                  ? `${presenter.avatar.placements[0].motion} ${presenter.avatar.placements[0].x},${presenter.avatar.placements[0].y}`
                  : ""}
              </p>
              <ul className="space-y-1 text-sm">
                {presenter.cues.map((cue) => (
                  <li key={`${cue.slideIndex}-${cue.startMs}`} data-testid="education-presenter-cue">
                    {cue.startMs} ms — {cue.text}
                  </li>
                ))}
              </ul>
              <pre className="whitespace-pre-wrap text-sm" data-testid="education-presenter-dub">
                {presenter.dubScript}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
