"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { MediaPrice } from "@agentforge/core/media-pricing";
import {
  musicCapabilities,
  MUSIC_LYRICS_MAX,
  MUSIC_PROMPT_MAX,
  MUSIC_STYLE_MAX,
  MUSIC_TITLE_MAX,
} from "@agentforge/core/audio-capabilities";
import { ModelSelect } from "@/components/model-select";
import { SettingsLinkHint } from "@/components/settings-link-hint";
import { t } from "@/lib/i18n";
import { mediaPriceHints, musicEstimateView } from "@/lib/media-estimate";
import { keepModelChoice } from "@/lib/model-choice";
import { musicPickerEmpty, readApiErrorMessage } from "@/lib/music-models";
import { apiFetch, mediaSrc } from "@/lib/api-client";
import { useProductBrand } from "@/lib/product-brand";

type StudioModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
  /** Flat per-job price for the cost estimate; null when the gateway catalog has no figure. */
  price?: MediaPrice | null;
};

type LibraryItem = {
  id: string;
  url: string;
  mime: string;
  createdAt: string;
  prompt?: string;
  model?: string;
  title?: string;
  style?: string;
  instrumental?: boolean;
  durationSeconds?: number;
};

/**
 * `speechUnavailable` is the host's reason the voice-over control is off, or null when a
 * text-to-speech model the job route can reach appears in the live catalog.
 */
type LibraryResponse = {
  items: LibraryItem[];
  models: StudioModel[];
  defaultModel: string;
  ready: boolean;
  speechUnavailable: "no_audio_models" | "realtime_only" | null;
};

const MODES = [
  { id: "describe", labelKey: "music.modeDescribe", hintKey: "music.describeHint" },
  { id: "custom", labelKey: "music.modeCustom", hintKey: "music.customHint" },
] as const;

type Mode = (typeof MODES)[number]["id"];

export function MusicStudio() {
  const { gatewayName } = useProductBrand();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [models, setModels] = useState<StudioModel[]>([]);
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<Mode>("describe");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [style, setStyle] = useState("");
  const [title, setTitle] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [ready, setReady] = useState(true);
  const [speechUnavailable, setSpeechUnavailable] = useState<LibraryResponse["speechUnavailable"]>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/v1/music");
      const data = (await response.json().catch(() => ({}))) as LibraryResponse;
      if (!response.ok) {
        setError(readApiErrorMessage(data, t("music.loadError")));
        setReady(false);
        return;
      }
      setItems(data.items ?? []);
      setModels(data.models ?? []);
      // `load` runs again after every generate: keep the model the person chose while it is still listed.
      setModel((current) => keepModelChoice(current, data.models ?? [], data.defaultModel));
      setReady(Boolean(data.ready));
      setSpeechUnavailable(data.speechUnavailable ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("music.loadError"));
      setReady(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const caps = musicCapabilities(model);

  // A model with no lyrics field only ever describes, so a stale "custom" pick is corrected here
  // rather than being sent as a brief the relay cannot read.
  useEffect(() => {
    if (!caps.lyrics) {
      setMode("describe");
    }
  }, [caps.lyrics]);

  const estimate = useMemo(() => musicEstimateView({ model, models }), [model, models]);
  const modelOptions = useMemo(() => {
    const hints = mediaPriceHints("music", models);
    return models.map((item) => ({ ...item, hint: hints[item.id] }));
  }, [models]);

  const brief = mode === "custom" ? lyrics : prompt;
  const busy = generating || drafting;
  // A disabled select with no options says nothing. If the host ever hands back an empty list, say why.
  const noModels = musicPickerEmpty({ loading, models });

  async function draftLyrics() {
    if (!prompt.trim() || busy) {
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      const response = await apiFetch("/api/v1/music/lyrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as { text?: string; title?: string };
      if (!response.ok || !data.text) {
        setError(readApiErrorMessage(data, t("music.lyricsError")));
        return;
      }
      setLyrics(data.text);
      if (data.title && !title.trim()) {
        setTitle(data.title);
      }
      setMode("custom");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("music.lyricsError"));
    } finally {
      setDrafting(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!brief.trim() || busy) {
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const response = await apiFetch("/api/v1/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          prompt: mode === "describe" ? prompt.trim() : undefined,
          lyrics: mode === "custom" ? lyrics.trim() : undefined,
          style: caps.style ? style.trim() || undefined : undefined,
          title: caps.title ? title.trim() || undefined : undefined,
          instrumental: caps.instrumental ? instrumental : undefined,
          model: model || undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        // Whatever the gateway said — model not enabled for this key, quota exhausted, relay missing —
        // is in one of the host's two error shapes. Both reach the banner; neither is swallowed.
        setError(readApiErrorMessage(data, t("music.generateError")));
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("music.generateError"));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-[var(--content-wide)] flex-col px-6 py-10 text-[var(--text)]" data-testid="music-studio">
      <h1 className="text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("music.title")}</h1>
      {/* One outcome line (owner report 2026-09-23). The `subtitle` paragraph below it
          only repeated what the empty state says, so it was deleted with its key. */}
      <p className="mt-2 max-w-[var(--content-narrow)] text-sm text-[var(--text-2)]" data-testid="expected-inputs">{t("music.expectedInputs")}</p>

      {!ready && !loading ? (
        <div
          className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-2)]"
          data-testid="music-studio-needs-key"
        >
          <SettingsLinkHint i18nKey="music.needsKey" vars={{ gateway: gatewayName }} />
        </div>
      ) : null}

      {error ? (
        <div
          className="mt-4 rounded-xl border border-[var(--line)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
          data-testid="music-studio-error"
        >
          {error}
        </div>
      ) : null}

      <form
        className="raise mt-8 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"
        onSubmit={onSubmit}
        data-testid="music-studio-prompt-bar"
      >
        <div className="flex flex-wrap gap-2">
          <select
            className="select-field"
            value={mode}
            onChange={(event) => setMode(event.target.value as Mode)}
            disabled={busy || !caps.lyrics}
            aria-label={t("music.modeLabel")}
            data-testid="music-studio-mode"
          >
            {MODES.map((item) => (
              <option key={item.id} value={item.id}>
                {t(item.labelKey)}
              </option>
            ))}
          </select>
          {noModels ? null : (
            <ModelSelect
              models={modelOptions}
              value={model}
              onChange={setModel}
              disabled={busy}
              testId="music-studio-model"
              className="select-field min-w-[12rem] flex-1"
            />
          )}
        </div>

        {noModels ? (
          <div
            className="rounded-lg border border-[var(--line)] px-3 py-2"
            data-testid="music-studio-no-models"
          >
            <p className="text-sm font-medium text-[var(--text)]">{t("music.noModels.title")}</p>
            <p className="mt-1 text-xs text-[var(--text-2)]">{t("music.noModels.body", { gateway: gatewayName })}</p>
          </div>
        ) : null}

        <p className="text-xs text-[var(--text-3)]" data-testid="music-studio-mode-hint">
          {t(MODES.find((item) => item.id === mode)?.hintKey ?? "music.describeHint")}
        </p>

        {!model ? null : estimate.unknown ? (
          <p className="text-xs text-[var(--text-3)]" data-testid="music-studio-estimate-unknown">
            {estimate.line}
          </p>
        ) : (
          <div className="space-y-0.5">
            <p className="text-xs text-[var(--text-2)]" data-testid="music-studio-estimate">
              {estimate.line}
            </p>
            {estimate.compare ? (
              <p className="text-xs text-[var(--text-3)]" data-testid="music-studio-estimate-compare">
                {estimate.compare}
              </p>
            ) : null}
          </div>
        )}
        <p className="text-xs text-[var(--text-3)]" data-testid="music-studio-takes-note">
          {t("music.takesNote")}
        </p>

        {mode === "custom" ? (
          <textarea
            className="text-field min-h-[9rem] w-full resize-y outline-none placeholder:text-[var(--text-3)]"
            placeholder={t("music.lyricsPlaceholder")}
            maxLength={MUSIC_LYRICS_MAX}
            value={lyrics}
            onChange={(event) => setLyrics(event.target.value)}
            disabled={busy}
            data-testid="music-studio-lyrics"
          />
        ) : null}

        {caps.style || caps.title || caps.instrumental ? (
          /* Style, title and the instrumental toggle are optional on the Suno relay;
             the description and the mode choice already describe the run. */
          <details className="rounded-lg border border-[var(--line)] px-3 py-2" data-testid="music-studio-advanced">
            <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-2)]">
              {t("music.advanced")}
            </summary>
            <div className="mt-2 space-y-2">
              {caps.style || caps.title ? (
                <div className="flex flex-wrap gap-2">
                  {caps.style ? (
                    <input
                      type="text"
                      className="text-field min-w-0 flex-1 outline-none placeholder:text-[var(--text-3)]"
                      placeholder={t("music.stylePlaceholder")}
                      maxLength={MUSIC_STYLE_MAX}
                      value={style}
                      onChange={(event) => setStyle(event.target.value)}
                      disabled={busy}
                      data-testid="music-studio-style"
                    />
                  ) : null}
                  {caps.title ? (
                    <input
                      type="text"
                      className="text-field min-w-0 flex-1 outline-none placeholder:text-[var(--text-3)]"
                      placeholder={t("music.titlePlaceholder")}
                      maxLength={MUSIC_TITLE_MAX}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      disabled={busy}
                      data-testid="music-studio-title"
                    />
                  ) : null}
                </div>
              ) : null}
              {caps.instrumental ? (
                <label className="flex items-center gap-2 text-xs text-[var(--text-2)]">
                  <input
                    type="checkbox"
                    checked={instrumental}
                    onChange={(event) => setInstrumental(event.target.checked)}
                    disabled={busy}
                    data-testid="music-studio-instrumental"
                  />
                  {t("music.instrumental")}
                  <span className="text-[var(--text-3)]">{t("music.instrumentalHint")}</span>
                </label>
              ) : null}
            </div>
          </details>
        ) : null}

        <div className="flex gap-2">
          {caps.lyrics ? (
            <button
              type="button"
              className="shrink-0 wash inline-flex h-8 items-center rounded-pill border border-[var(--line)] px-3 py-2 text-sm text-[var(--text-2)] disabled:opacity-45"
              onClick={() => void draftLyrics()}
              disabled={busy || !ready || noModels || !prompt.trim()}
              data-testid="music-studio-draft-lyrics"
            >
              {drafting ? t("music.writingLyrics") : t("music.writeLyrics")}
            </button>
          ) : null}
          <input
            type="text"
            className="text-field min-w-0 flex-1 outline-none placeholder:text-[var(--text-3)]"
            placeholder={t("music.promptPlaceholder")}
            maxLength={MUSIC_PROMPT_MAX}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={busy}
            data-testid="music-studio-prompt"
          />
          <button
            type="submit"
            className="shrink-0 wash inline-flex h-8 items-center rounded-pill bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--surface)] disabled:opacity-45"
            disabled={busy || !ready || noModels || !brief.trim()}
            data-testid="music-studio-submit"
          >
            {generating ? t("music.generating") : t("music.generate")}
          </button>
        </div>
        {generating ? (
          <p className="text-xs text-[var(--text-3)]" data-testid="music-studio-generating-hint">
            {t("music.generatingHint")}
          </p>
        ) : null}
      </form>

      {/* The voice-over half of the mode. It renders as a reason, not a dead button, because on this
          gateway there is no text-to-speech id a job route can reach. */}
      {speechUnavailable ? (
        <section className="mt-6" data-testid="music-studio-voice">
          <h2 className="text-sm font-medium tracking-[var(--track)] text-[var(--text)]">{t("music.voiceHeading")}</h2>
          <p className="mt-1 max-w-[var(--content-narrow)] text-xs text-[var(--text-3)]" data-testid="music-studio-voice-unavailable">
            {speechUnavailable === "realtime_only"
              ? t("music.voiceUnavailable.realtimeOnly")
              : t("music.voiceUnavailable.noAudioModels")}
          </p>
        </section>
      ) : null}

      <section className="mt-8" data-testid="music-studio-library">
        {loading ? (
          <p className="text-sm text-[var(--text-3)]">{t("music.loadingLibrary")}</p>
        ) : items.length === 0 ? (
          <div
            className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center"
            data-testid="music-studio-empty"
          >
            <p className="text-sm font-medium text-[var(--text)]">{t("music.emptyTitle")}</p>
            <p className="mt-2 text-sm text-[var(--text-2)]">{t("music.emptyBody")}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-3"
                data-testid="music-studio-track"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-[var(--text)]">
                    {item.title?.trim() || t("music.untitled")}
                  </p>
                  <a
                    href={mediaSrc(item.url)}
                    download={`agentforge-track-${item.id}.mp3`}
                    className="shrink-0 text-xs underline text-[var(--text-2)]"
                    data-testid="music-studio-download"
                  >
                    {t("music.download")}
                  </a>
                </div>
                {item.style || item.durationSeconds ? (
                  <p className="mt-0.5 truncate text-xs text-[var(--text-3)]">
                    {[item.style, item.durationSeconds ? t("music.duration", { n: Math.round(item.durationSeconds) }) : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a generated song has no transcript */}
                <audio src={mediaSrc(item.url)} controls className="mt-2 w-full" />
                {item.prompt ? (
                  <p className="mt-2 line-clamp-3 whitespace-pre-line text-xs text-[var(--text-2)]">{item.prompt}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
