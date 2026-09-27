"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "@/lib/nav";
import { SourceMaterialField } from "@/components/source-material-field";
import { subscribeModeHandoff } from "@/lib/mode-handoff";
import { Confetti } from "@/components/confetti";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ExampleGallery } from "@/components/example-gallery";
import { ModeHeader } from "@/components/mode-header";
import { MascotSlot } from "@/components/mascot-slot";
import { ModelSelect } from "@/components/model-select";
import { WorkingStatus } from "@/components/working-status";
import type { JobRegenSubmit } from "@/components/job-regen-panel";
import { PresentationPreview } from "@/components/presentation-preview";
import { OpenSlideStage } from "@/components/open-slide-stage";
import {
  parseOpenSlideDeck,
  type OpenSlideDeck,
  type OpenSlideDensity,
  type OpenSlideMotion,
  type OpenSlidePageCount,
} from "@agentforge/core/open-slide";
import { getLocale, t } from "@/lib/i18n";
import type { PresentationOutline, PresentationOutlineInput } from "@/lib/presentation-outline";
import { parsePresentationOutlineBody } from "@/lib/presentation-outline";
import { presentationStarters } from "@/lib/job-starters";
import { useJobModel } from "@/lib/use-job-model";
import { modelPickBody, regenModelPick, studioModelPick } from "@/lib/model-choice";
import { apiFetch, isElectron } from "@/lib/api-client";

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

export function PresentationsStudio() {
  const { models, model, pinned: modelPinned, setModel } = useJobModel("presentations");
  const [prompt, setPrompt] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceTitle, setSourceTitle] = useState<string | null>(null);
  const [outline, setOutline] = useState<PresentationOutline | null>(null);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [engine, setEngine] = useState<"nultron" | "open-slide">("open-slide");
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const [openDeck, setOpenDeck] = useState<OpenSlideDeck | null>(null);
  const [openDeckId, setOpenDeckId] = useState<string | null>(null);
  const [openDecks, setOpenDecks] = useState<Array<{ id: string; title: string }>>([]);
  const [pageCount, setPageCount] = useState<OpenSlidePageCount>("standard");
  const [density, setDensity] = useState<OpenSlideDensity>("light");
  const [motion, setMotion] = useState<OpenSlideMotion>("static");
  const [decks, setDecks] = useState<Array<{ id: string; title: string }>>([]);
  const [savedNote, setSavedNote] = useState(false);
  const [busy, setBusy] = useState<"generate" | "download" | "regen" | "save" | null>(null);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [landed, setLanded] = useState(0);

  function showStarter(next: PresentationOutlineInput) {
    setEngine("nultron");
    setOutline(parsePresentationOutlineBody(next));
    setDeckId(null);
    setSavedNote(false);
  }

  function landOutline(next: PresentationOutline) {
    setOutline(next);
    setDeckId(null);
    setSavedNote(false);
    setLanded((count) => count + 1);
  }

  const loadDecks = useCallback(async () => {
    const res = await apiFetch("/api/v1/presentations/decks");
    const data = (await res.json().catch(() => null)) as { decks?: Array<{ id: string; title: string }> } | null;
    if (res.ok && data?.decks) {
      setDecks(data.decks);
    }
  }, []);

  const loadOpenDecks = useCallback(async () => {
    const res = await apiFetch("/api/v1/presentations/open-slide/decks");
    const data = (await res.json().catch(() => null)) as { decks?: Array<{ id: string; title: string }> } | null;
    if (res.ok && data?.decks) {
      setOpenDecks(data.decks);
    }
  }, []);

  useEffect(() => {
    void loadDecks();
    void loadOpenDecks();
  }, [loadDecks, loadOpenDecks]);

  async function openSavedOutline(id: string) {
    const res = await apiFetch(`/api/v1/presentations/decks?id=${encodeURIComponent(id)}`);
    const data = (await res.json().catch(() => null)) as { deck?: { id: string; outline: PresentationOutline } } | null;
    if (!res.ok || !data?.deck) {
      setError(errorMessage(data, t("presentation.saveError")));
      return;
    }
    setEngine("nultron");
    setOutline(parsePresentationOutlineBody(data.deck.outline));
    setDeckId(data.deck.id);
    setSavedNote(false);
    setError(null);
  }

  async function openSavedOpenSlide(id: string) {
    const res = await apiFetch(`/api/v1/presentations/open-slide/decks?id=${encodeURIComponent(id)}`);
    const data = (await res.json().catch(() => null)) as { deck?: { id: string; deck: OpenSlideDeck } } | null;
    if (!res.ok || !data?.deck) {
      setError(errorMessage(data, t("presentation.saveError")));
      return;
    }
    setEngine("open-slide");
    setOpenDeck(parseOpenSlideDeck(data.deck.deck));
    setOpenDeckId(data.deck.id);
    setSavedNote(false);
    setError(null);
  }

  async function onSave() {
    if (busy) {
      return;
    }
    if (engine === "open-slide") {
      if (!openDeck) {
        return;
      }
      setBusy("save");
      setError(null);
      setSavedNote(false);
      try {
        const res = await apiFetch("/api/v1/presentations/open-slide/decks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: openDeckId ?? undefined, deck: openDeck }),
        });
        const data = (await res.json().catch(() => null)) as { deck?: { id: string } } | null;
        if (!res.ok || !data?.deck) {
          throw new Error(errorMessage(data, t("presentation.saveError")));
        }
        setOpenDeckId(data.deck.id);
        setSavedNote(true);
        await loadOpenDecks();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("presentation.saveError"));
      } finally {
        setBusy(null);
      }
      return;
    }
    if (!outline) {
      return;
    }
    setBusy("save");
    setError(null);
    setSavedNote(false);
    try {
      const res = await apiFetch("/api/v1/presentations/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deckId ?? undefined, outline }),
      });
      const data = (await res.json().catch(() => null)) as { deck?: { id: string } } | null;
      if (!res.ok || !data?.deck) {
        throw new Error(errorMessage(data, t("presentation.saveError")));
      }
      setDeckId(data.deck.id);
      setSavedNote(true);
      await loadDecks();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("presentation.saveError"));
    } finally {
      setBusy(null);
    }
  }

  useEffect(
    () =>
      subscribeModeHandoff("presentations", (handoff) => {
        setSourceText(handoff.sourceText);
        setSourceTitle(handoff.title ?? null);
        setPrompt(handoff.prompt);
        setError(null);
      }),
    [],
  );

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    const topic = prompt.trim();
    if (!topic || busy) {
      return;
    }
    setBusy("generate");
    setError(null);
    try {
      if (engine === "open-slide") {
        const res = await apiFetch("/api/v1/presentations/open-slide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: topic,
            brief: { pageCount, density, motion },
            ...modelPickBody(studioModelPick(model, modelPinned)),
            sourceText: sourceText.trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(errorMessage(data, t("presentation.generateError")));
        }
        setOpenDeck(parseOpenSlideDeck(data));
        setOpenDeckId(null);
        setSavedNote(false);
        setLanded((count) => count + 1);
        return;
      }
      const res = await apiFetch("/api/v1/presentations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `${topic}\n\n${t("presentation.shapeNote", {
            length: t(
              pageCount === "short"
                ? "presentation.openSlidePagesShort"
                : pageCount === "deep"
                  ? "presentation.openSlidePagesDeep"
                  : "presentation.openSlidePagesStandard",
            ),
            style: t(
              density === "minimal"
                ? "presentation.openSlideDensityMinimal"
                : density === "standard" || density === "dense"
                  ? "presentation.openSlideDensityStandard"
                  : "presentation.openSlideDensityLight",
            ),
          })}`,
          // Only a deliberate pick travels as pinned: a seeded default stays rescuable by the host's fallback.
          ...modelPickBody(studioModelPick(model, modelPinned)),
          sourceText: sourceText.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, t("presentation.generateError")));
      }
      landOutline(parsePresentationOutlineBody(data));
    } catch (err) {
      if (engine === "open-slide") {
        setOpenDeck(null);
      } else {
        setOutline(null);
      }
      setError(err instanceof Error ? err.message : t("presentation.generateError"));
    } finally {
      setBusy(null);
    }
  }

  async function onRegenerate(index: number, payload: JobRegenSubmit) {
    if (!outline || busy) {
      return;
    }
    setBusy("regen");
    setRegenIndex(index);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/presentations/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outline,
          slideIndex: index,
          prompt,
          instruction: payload.instruction || undefined,
          ...modelPickBody(regenModelPick(payload.model, model, modelPinned)),
          attachments: payload.attachments.length > 0 ? payload.attachments : undefined,
          sourceText: sourceText.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, t("presentation.regenError")));
      }
      setOutline(parsePresentationOutlineBody(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("presentation.regenError"));
    } finally {
      setBusy(null);
      setRegenIndex(null);
    }
  }

  async function onDownload() {
    const payload = engine === "open-slide" ? openDeck : outline;
    if (!payload || busy) {
      return;
    }
    setBusy("download");
    setError(null);
    try {
      const res = await apiFetch(
        engine === "open-slide" ? "/api/v1/presentations/open-slide/pptx" : "/api/v1/presentations/pptx",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(errorMessage(data, t("presentation.downloadError")));
      }
      if (isElectron()) {
        // apiFetch already wrote the bytes through the native save dialog; a second, browser-style
        // download here would open the save dialog twice.
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "presentation.pptx";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("presentation.downloadError"));
    } finally {
      setBusy(null);
    }
  }

  const showingOpenSlide = engine === "open-slide";
  const hasDeck = showingOpenSlide ? openDeck !== null : outline !== null;

  const lengthChips = (
    <div className="flex flex-wrap items-center gap-1" data-testid="presentations-open-slide-pages">
      <span className="mr-1 text-xs text-[var(--text-3)]">{t("presentation.openSlidePages")}</span>
      {(
        [
          ["short", "presentation.openSlidePagesShort"],
          ["standard", "presentation.openSlidePagesStandard"],
          ["deep", "presentation.openSlidePagesDeep"],
        ] as const
      ).map(([value, key]) => (
        <button
          key={value}
          type="button"
          disabled={busy !== null}
          aria-pressed={pageCount === value}
          data-testid={`presentations-length-${value}`}
          className={`btn h-8 rounded-full px-3 text-xs ${pageCount === value ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setPageCount(value)}
        >
          {t(key)}
        </button>
      ))}
    </div>
  );

  const styleChips = (
    <div className="flex flex-wrap items-center gap-1" data-testid="presentations-open-slide-density">
      <span className="mr-1 text-xs text-[var(--text-3)]">{t("presentation.openSlideDensity")}</span>
      {(
        [
          ["minimal", "presentation.openSlideDensityMinimal"],
          ["light", "presentation.openSlideDensityLight"],
          ["standard", "presentation.openSlideDensityStandard"],
        ] as const
      ).map(([value, key]) => (
        <button
          key={value}
          type="button"
          disabled={busy !== null}
          aria-pressed={density === value}
          data-testid={`presentations-style-${value}`}
          className={`btn h-8 rounded-full px-3 text-xs ${density === value ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setDensity(value)}
        >
          {t(key)}
        </button>
      ))}
    </div>
  );

  const topicField = (
    <textarea
      value={prompt}
      onChange={(event) => setPrompt(event.target.value)}
      rows={hasDeck ? 2 : 3}
      className="text-field min-h-24 w-full resize-none text-base outline-none placeholder:text-[var(--text-3)]"
      placeholder={t("presentation.promptPlaceholder")}
      disabled={busy !== null}
      data-testid="presentations-prompt"
      aria-label={t("presentation.ask")}
    />
  );

  return (
    <main
      data-mode="presentations"
      className="flex min-h-full w-full flex-col px-6 py-4 text-[var(--text)]"
      data-testid="presentations-studio"
    >
      <ModeHeader
        icon="presentations"
        title={t("presentation.title")}
        outcome={t("presentation.expectedInputs")}
        actions={
          hasDeck ? (
            <button
              type="button"
              onClick={() => void onDownload()}
              disabled={busy !== null}
              className="btn btn-primary rounded-pill px-4"
              data-testid="presentations-download"
            >
              {busy === "download" ? <WorkingStatus label={t("presentation.building")} /> : t("presentation.download")}
            </button>
          ) : null
        }
      />

      {error ? (
        <div
          className="mt-6 rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
          data-testid="presentations-error"
        >
          {error}
          {/gateway|api key|settings|runtime_stub|live gateway/i.test(error) && !/settings/i.test(error) ? (
            <>
              {" "}
              <Link href="/settings" className="underline">
                {t("presentation.openSettings")}
              </Link>
              .
            </>
          ) : null}
        </div>
      ) : null}

      <ExampleGallery mode="presentations" onSelect={(entry) => setPrompt(entry.prompt)} />

      <form
        className={
          hasDeck
            ? "mt-4"
            : "mt-6 space-y-3 rounded-xl border border-[var(--line)] bg-transparent p-3"
        }
        onSubmit={(event) => void onGenerate(event)}
        data-testid="presentations-studio-prompt-bar"
      >
        {hasDeck ? null : (
          <div className="space-y-3" data-testid="presentations-open-slide-choices">
            <label className="block text-base font-medium text-[var(--text)]">
              {t("presentation.ask")}
              <span className="mt-2 block font-normal">{topicField}</span>
            </label>
            {lengthChips}
            {styleChips}
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <details className="min-w-0 flex-1" data-testid="presentations-more-details">
            <summary className="cursor-pointer text-sm text-[var(--text-3)]" data-testid="presentations-more">
              {t("presentation.more")}
            </summary>
            <div className="mt-3 space-y-3">
              {hasDeck ? (
                <label className="block text-sm text-[var(--text-2)]">
                  {t("presentation.ask")}
                  <span className="mt-1 block">{topicField}</span>
                </label>
              ) : null}
              {hasDeck ? (
                <div className="space-y-2" data-testid="presentations-open-slide-choices">
                  {lengthChips}
                  {styleChips}
                </div>
              ) : null}
              <label className="flex flex-col gap-1 text-xs text-[var(--text-2)]">
                {t("presentation.engineLabel")}
                <select
                  className="select-field w-full"
                  value={engine}
                  disabled={busy !== null}
                  data-testid="presentations-engine"
                  aria-label={t("presentation.engineLabel")}
                  onChange={(event) => setEngine(event.target.value === "open-slide" ? "open-slide" : "nultron")}
                >
                  <option value="nultron">{t("presentation.engineNultron")}</option>
                  <option value="open-slide">{t("presentation.engineOpenSlide")}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--text-2)]">
                {t("presentation.openSlideMotion")}
                <select
                  className="select-field w-full"
                  value={motion}
                  disabled={busy !== null}
                  data-testid="presentations-open-slide-motion"
                  aria-label={t("presentation.openSlideMotion")}
                  onChange={(event) => setMotion(event.target.value as OpenSlideMotion)}
                >
                  <option value="static">{t("presentation.openSlideMotionStatic")}</option>
                  <option value="subtle">{t("presentation.openSlideMotionSubtle")}</option>
                  <option value="rich">{t("presentation.openSlideMotionRich")}</option>
                </select>
              </label>
              <ModelSelect
                models={models}
                value={model}
                onChange={setModel}
                disabled={busy !== null || models.length === 0}
                testId="presentations-studio-model"
                className="select-field w-full"
              />
              <EnhancePromptButton
                text={prompt}
                surface="presentations"
                model={model}
                disabled={busy !== null}
                testId="presentations-enhance"
                onApply={setPrompt}
              />
              <SourceMaterialField
                value={sourceText}
                onChange={setSourceText}
                title={sourceTitle}
                onTitle={setSourceTitle}
                disabled={busy !== null}
                testIdPrefix="presentations"
              />
              <div className="flex flex-wrap gap-2">
                {presentationStarters(getLocale()).map((starter) => (
                  <button
                    key={starter.id}
                    type="button"
                    className="btn btn-ghost h-8 rounded-lg px-3 text-xs"
                    onClick={() => {
                      showStarter(starter.outline);
                      setError(null);
                    }}
                    data-testid="presentations-starter"
                  >
                    {starter.label}
                  </button>
                ))}
              </div>
              {decks.length > 0 ? (
                <div data-testid="presentations-deck-list">
                  <p className="text-xs font-medium text-[var(--text-2)]">{t("presentation.savedDecks")}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {decks.map((deck) => (
                      <button
                        key={deck.id}
                        type="button"
                        className="btn btn-ghost h-8 rounded-lg px-3 text-xs"
                        data-testid="presentations-deck-open"
                        onClick={() => void openSavedOutline(deck.id)}
                      >
                        {deck.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {openDecks.length > 0 ? (
                <div data-testid="presentations-open-slide-deck-list">
                  <div className="mt-2 flex flex-wrap gap-2">
                    {openDecks.map((deck) => (
                      <button
                        key={deck.id}
                        type="button"
                        className="btn btn-ghost h-8 rounded-lg px-3 text-xs"
                        data-testid="presentations-open-slide-deck-open"
                        onClick={() => void openSavedOpenSlide(deck.id)}
                      >
                        {deck.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {hasDeck ? (
                <button
                  type="button"
                  onClick={() => void onSave()}
                  disabled={busy !== null}
                  className="btn btn-ghost h-8 rounded-lg px-3 text-xs"
                  data-testid="presentations-save-deck"
                >
                  {busy === "save" ? t("presentation.savingDeck") : t("presentation.saveDeck")}
                </button>
              ) : null}
              {savedNote ? (
                <p className="text-sm text-[var(--text-2)]" data-testid="presentations-deck-saved">
                  {t("presentation.deckSaved")}
                </p>
              ) : null}
              <p className="text-xs text-[var(--text-3)]" data-testid="presentations-download-note">
                {showingOpenSlide ? t("presentation.openSlideDownloadNote") : t("presentation.downloadNote")}
              </p>
              {hasDeck ? (
                <button
                  type="submit"
                  className="btn btn-ghost h-8 rounded-lg px-3 text-xs"
                  disabled={busy !== null || !prompt.trim()}
                  data-testid="presentations-generate"
                >
                  {busy === "generate" ? t("presentation.generating") : t("presentation.generate")}
                </button>
              ) : null}
              <div ref={setToolsHost} />
            </div>
          </details>
          {hasDeck ? null : (
            <button
              type="submit"
              className="btn btn-primary h-10 shrink-0 rounded-pill px-5"
              disabled={busy !== null || !prompt.trim()}
              data-testid="presentations-generate"
            >
              {busy === "generate" ? (
                <WorkingStatus label={t("presentation.generating")} />
              ) : (
                t("presentation.generate")
              )}
            </button>
          )}
        </div>
        {busy === "generate" ? <MascotSlot mode="presentations" placement="beside" busy /> : null}
      </form>

      <div className="mt-8">
        {showingOpenSlide && openDeck ? (
          <div className="enter-rise relative">
            {landed > 0 ? <Confetti key={landed} /> : null}
            <OpenSlideStage
              key={`${openDeck.id}:${openDeck.meta.createdAt}`}
              deck={openDeck}
              onChange={(next) => {
                setOpenDeck(next);
                setSavedNote(false);
              }}
            />
          </div>
        ) : outline && !showingOpenSlide ? (
          <div className="enter-rise relative">
            {landed > 0 ? <Confetti key={landed} /> : null}
            <PresentationPreview
              outline={outline}
              models={models}
              defaultModel={model}
              regeneratingIndex={regenIndex}
              onRegenerate={(index, payload) => void onRegenerate(index, payload)}
              onOutlineChange={(next) => {
                setOutline(next);
                setSavedNote(false);
              }}
              variant="simple"
              toolsHost={toolsHost}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}
