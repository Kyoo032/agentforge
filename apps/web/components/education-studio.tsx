"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, usePathname, useSearchParams } from "@/lib/nav";
import { ModeHeader } from "@/components/mode-header";
import { ModeIllustration } from "@/components/mode-illustration";
import { PresentationPreview } from "@/components/presentation-preview";
import { apiFetch } from "@/lib/api-client";
import {
  EDUCATION_PATH,
  EDUCATION_TASKS,
  educationTaskHref,
  taskFromParam,
  type EducationTask,
} from "@/lib/education-task";
import { t } from "@/lib/i18n";
import { parsePresentationOutlineBody, type PresentationOutline } from "@/lib/presentation-outline";

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
  heading,
}: {
  presenter: PresenterPlan;
  cueIndex: number;
  heading?: string;
}) {
  const cue = presenter.cues[cueIndex] ?? presenter.cues[0];
  const placement =
    presenter.avatar.placements.find((item) => item.slideIndex === (cue?.slideIndex ?? 0)) ??
    presenter.avatar.placements[0];
  return (
    <div data-testid="education-presenter-layout">
      <div
        className="relative aspect-video overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)]"
        data-testid="education-presenter-stage"
      >
        <div className="absolute inset-y-0 left-0 w-1.5 bg-[var(--mode)]" />
        <div className="px-8 py-8">
          <h2 className="max-w-xl text-2xl font-medium">{heading || presenter.avatar.label}</h2>
        </div>
        {placement ? (
          <div
            className="absolute flex items-end justify-center rounded-t-full bg-[var(--mode)] px-1 pb-1 text-center text-[10px] font-medium leading-tight text-[var(--surface)]"
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
          </div>
        ) : null}
        {cue ? (
          <p
            className="absolute bottom-4 left-6 right-6 rounded-lg bg-[var(--text)] px-3 py-2 text-sm text-[var(--surface)]"
            data-testid="education-presenter-cue"
          >
            {cue.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function EducationStudio() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onEducation = pathname === EDUCATION_PATH;
  const taskQuery = searchParams.get("task");
  const showChooser = onEducation && (taskQuery == null || taskQuery.trim() === "");
  const urlTask = taskFromParam(taskQuery);
  const lastTaskRef = useRef<EducationTask>(urlTask);
  const task = onEducation ? urlTask : lastTaskRef.current;

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
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (onEducation) {
      lastTaskRef.current = urlTask;
    }
  }, [onEducation, urlTask]);

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

  const lessonFields = (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void onLesson(event)}>
      <label className="block min-w-64 flex-1 text-base font-medium text-[var(--text)]">
        {t("education.ask")}
        <input
          className="text-field mt-2 w-full font-normal"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder={t("education.topicPlaceholder")}
          aria-label={t("education.topicLabel")}
          data-testid="education-lesson-topic"
        />
      </label>
      <button
        type="submit"
        className="btn btn-primary h-10 shrink-0 rounded-pill px-5"
        disabled={busy !== null || !topic.trim()}
        data-testid="education-lesson-draft"
      >
        {busy === "lesson" ? t("education.drafting") : t("education.draftLesson")}
      </button>
    </form>
  );

  const examFields = (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => void onExam(event)}>
      <label className="block min-w-64 flex-1 text-base font-medium text-[var(--text)]">
        {t("education.examAsk")}
        <input
          className="text-field mt-2 w-full font-normal"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder={t("education.topicPlaceholder")}
          aria-label={t("education.examAsk")}
          data-testid="education-exam-topic"
        />
      </label>
      <button
        type="submit"
        className="btn btn-primary h-10 shrink-0 rounded-pill px-5"
        disabled={busy !== null || !topic.trim()}
        data-testid="education-exam-generate"
      >
        {busy === "exam" ? t("education.drafting") : t("education.generateExam")}
      </button>
    </form>
  );

  const outcome = showChooser
    ? t("education.guide.lead")
    : task === "lesson"
      ? t("education.expectedInputs")
      : t(`education.tasks.${task}.hint`);
  const settled = (task === "lesson" && outline) || (task === "quiz" && exam) || (task === "show" && presenter);

  return (
    <main
      data-mode="education"
      className="flex min-h-full w-full flex-col px-6 py-4 text-[var(--text)]"
      data-testid="education-studio"
    >
      <ModeHeader
        icon="education"
        title={t("education.title")}
        outcome={outcome}
        outcomeTestId={showChooser ? "education-guide-lead" : "expected-inputs"}
      />

      {error ? (
        <div
          className="mt-6 rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
          data-testid="education-error"
        >
          {error}
        </div>
      ) : null}

      {showChooser ? (
        <div className="mt-8">
          <ModeIllustration mode="education" />
          <div
            className="mx-auto mt-6 grid w-full max-w-[var(--content-max)] grid-cols-1 gap-3 sm:grid-cols-2"
            data-testid="education-guide-choices"
          >
            {EDUCATION_TASKS.map((id) => (
              <Link
                key={id}
                href={educationTaskHref(id)}
                className="card-live enter-rise flex items-start px-4 py-4 text-left"
                data-testid={`education-guide-${id}`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--text)]">
                    {t(`education.tasks.${id}.label`)}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--text-3)]">{t(`education.tasks.${id}.hint`)}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 flex justify-end">
            <Link
              href={EDUCATION_PATH}
              className="text-xs font-medium text-[var(--accent)]"
              data-testid="education-guide-change"
            >
              {t("education.guide.change")}
            </Link>
          </div>

          <div className="order-1 mt-4">
            {task === "lesson" ? (
              outline ? (
                <div>
                  {saved ? (
                    <p className="mb-3 text-sm text-[var(--text-2)]" data-testid="education-deck-saved">
                      {t("education.deckSaved")}
                    </p>
                  ) : null}
                  <PresentationPreview
                    outline={outline}
                    onOutlineChange={(next) => {
                      setOutline(next);
                      setSaved(false);
                      setPresenter(null);
                    }}
                    variant="simple"
                    toolsHost={toolsHost}
                  />
                </div>
              ) : null
            ) : null}

            {task === "quiz" ? (
              exam ? (
                <section
                  className="mx-auto max-w-3xl rounded-xl border border-[var(--line)] bg-[var(--surface)] px-8 py-8"
                  data-testid="education-exam-sheet"
                >
                  <h2 className="text-2xl font-medium">{exam.title}</h2>
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
              ) : null
            ) : null}

            {task === "page" && book ? (
              <div className="px-4 py-6">
                {book ? (
                  <div
                    className="mx-auto mt-6 max-w-3xl rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
                    data-testid="education-book-text"
                  >
                    <p className="text-sm text-[var(--text-2)]">{book.message}</p>
                    {book.text ? (
                      <pre className="mt-3 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{book.text}</pre>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {task === "show" ? (
              presenter ? (
                <PresenterStage
                  presenter={presenter}
                  cueIndex={cueIndex}
                  heading={outline?.slides[presenter.cues[cueIndex]?.slideIndex ?? 0]?.heading}
                />
              ) : null
            ) : null}
          </div>

          <div
            className={
              settled
                ? "mt-4"
                : "sticky top-0 z-20 -mx-6 mt-4 space-y-3 border-b border-[var(--line)] bg-[var(--bg)] px-6 py-3"
            }
          >
            {task === "lesson" && !outline ? lessonFields : null}
            {task === "quiz" && !exam ? examFields : null}
            {task === "page" ? (
              <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => void onBook(event)}>
                <input
                  type="file"
                  accept="image/png,application/pdf,.png,.pdf"
                  data-testid="education-book-file"
                  aria-label={t("education.bookHint")}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <button
                  type="submit"
                  className="btn btn-primary h-10 shrink-0 rounded-pill px-5"
                  disabled={busy !== null || !file}
                  data-testid="education-book-read"
                >
                  {busy === "book" ? t("education.reading") : t("education.readBook")}
                </button>
              </form>
            ) : null}
            {task === "show" && outline && !presenter ? (
              <button
                type="button"
                className="btn btn-primary h-10 rounded-pill px-5"
                disabled={busy !== null}
                data-testid="education-presenter-build"
                onClick={() => void onPresenter()}
              >
                {busy === "presenter" ? t("education.drafting") : t("education.buildPresenter")}
              </button>
            ) : null}

            <details className="min-w-0" data-testid="education-more-details">
              <summary className="cursor-pointer text-sm text-[var(--text-3)]" data-testid="education-more">
                {t("education.more")}
              </summary>
              <div className="mt-3 space-y-3">
                {task === "lesson" && outline ? lessonFields : null}
                {task === "quiz" && exam ? examFields : null}
                {outline ? (
                  <button
                    type="button"
                    className="btn btn-ghost h-8 rounded-lg px-3 text-xs"
                    data-testid="education-save-deck"
                    disabled={busy !== null}
                    onClick={() => void onSave()}
                  >
                    {t("education.saveDeck")}
                  </button>
                ) : null}
                {saved ? <p className="text-sm text-[var(--text-2)]">{t("education.deckSaved")}</p> : null}
                {outline && task === "show" && presenter ? (
                  <button
                    type="button"
                    className="btn btn-ghost h-8 rounded-lg px-3 text-xs"
                    disabled={busy !== null}
                    data-testid="education-presenter-build"
                    onClick={() => void onPresenter()}
                  >
                    {busy === "presenter" ? t("education.drafting") : t("education.buildPresenter")}
                  </button>
                ) : null}
                {presenter && task === "show" ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {presenter.cues.map((item, index) => (
                        <button
                          key={`${item.slideIndex}-${item.startMs}`}
                          type="button"
                          className="btn btn-ghost h-8 rounded-lg px-2 text-xs"
                          aria-pressed={index === cueIndex}
                          data-testid="education-presenter-cue-pick"
                          onClick={() => setCueIndex(index)}
                        >
                          {index + 1}
                        </button>
                      ))}
                    </div>
                    <div>
                      <h3 className="text-sm font-medium">{t("education.dubHeading")}</h3>
                      <div className="mt-3 space-y-3 text-sm leading-relaxed" data-testid="education-presenter-dub">
                        {presenter.dubScript.split("\n").map((line, index) => (
                          <p key={`${index}-${line.slice(0, 48)}`}>{line}</p>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
                <div ref={setToolsHost} />
              </div>
            </details>
          </div>
        </>
      )}
    </main>
  );
}
