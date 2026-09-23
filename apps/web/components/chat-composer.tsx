"use client";

import { useEffect, useRef, useState } from "react";
import { consumeSse } from "@/lib/sse-client";
import {
  COMPOSER_FILE_ACCEPT,
  attachmentOverCap,
  classifyAttachment,
  routeDecision,
  type AttachmentKind,
} from "@/lib/composer-attach";
import { ModelPicker, type ChatModel } from "@/components/model-picker";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { apiFetch } from "@/lib/api-client";
import { abortErrorMessage, armStreamWatchdog } from "@agentforge/core/stream-watchdog";
import { REASONING_EFFORTS, type ReasoningEffort } from "@agentforge/core/reasoning-effort";
import { submitOnEnter } from "@/lib/composer-enter";
import { getLocale, t } from "@/lib/i18n";

export type ComposerUserSendPayload = {
  text: string;
  parts?: unknown[];
};

type Props = {
  threadId: string | null;
  onEnsureThread?: () => Promise<string>;
  modalities: string[];
  model?: string;
  models?: ChatModel[];
  onModelChange?: (id: string) => void;
  modelDisabled?: boolean;
  onUserSend?: (payload: ComposerUserSendPayload) => void;
  onStarted?: () => void;
  onDelta: (text: string) => void;
  onThinking?: (text: string) => void;
  onTool?: (event: { phase: "started" | "completed"; toolKey: string; input?: unknown; output?: unknown }) => void;
  onFailed?: (message: string) => void;
  onProbing?: (info: { attempt: number; attempts: number; message: string }) => void;
  /** A run ended. `showing` is false when the pane had moved to another session by then. */
  onComplete: (run: RunEnd) => Promise<void> | void;
  /**
   * The session the pane is showing; the pane changes it when the owner opens another. A run
   * remembers the key it started under, and once the key moves on it draws nothing more — its
   * stream still runs to the end, so the host keeps the reply — and it no longer holds Send.
   */
  sessionKey?: string | number;
  thinkingEnabled?: boolean;
  onThinkingChange?: (enabled: boolean) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  /** A prompt seeded from outside (the empty screen's suggestions). Applied once, then cleared. */
  draft?: string | null;
  onDraftApplied?: () => void;
};

type HeldFile = {
  id: string;
  file: File;
  kind: AttachmentKind;
};

async function uploadMedia(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.set("file", file);
  const uploaded = await apiFetch("/api/v1/media", { method: "POST", body: form }).then((res) => res.json());
  if (uploaded.error) {
    throw new Error(uploaded.error.message ?? t("chat.error.upload"));
  }
  if (typeof uploaded.url !== "string") {
    throw new Error(t("chat.error.upload"));
  }
  return { url: uploaded.url };
}

async function readTextFile(file: File): Promise<string> {
  return file.text();
}

/** Where a run's events are drawn. The pane's live callbacks, gated by `readRunStream`. */
export type RunStreamHandlers = {
  readonly onStarted?: () => void;
  readonly onDelta: (text: string) => void;
  readonly onThinking?: (text: string) => void;
  readonly onTool?: (event: { phase: "started" | "completed"; toolKey: string; input?: unknown; output?: unknown }) => void;
  readonly onFailed?: (message: string) => void;
};

/** How a run ended, for `onComplete`. */
export type RunEnd = {
  /** The thread the run posted to, or null when it failed before it had one. */
  readonly threadId: string | null;
  /** False when the pane had moved to another session by the time the run ended. */
  readonly showing: boolean;
};

/**
 * Read one run's event stream to the end.
 *
 * Events are drawn through `handlers` while `showing()` says the session the run started in is
 * still on screen. Once it is not — the owner opened another session from the rail — the stream is
 * still read to the end, never cancelled: the host aborts a run whose client goes away
 * (`packages/host/src/http-adapter.ts`), and the reply the owner asked for would never be saved.
 * The host keeps it; this only stops drawing it in a conversation it does not belong to.
 * `onActivity` is fed either way, so the stall watchdog stays quiet for a run that is still answering.
 */
export async function readRunStream(
  body: ReadableStream<Uint8Array>,
  handlers: RunStreamHandlers,
  options: { readonly onActivity?: () => void; readonly showing?: () => boolean } = {},
): Promise<void> {
  const showing = options.showing ?? (() => true);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const consumed = consumeSse(buffer);
    buffer = consumed.rest;
    for (const event of consumed.events) {
      options.onActivity?.();
      if (!showing()) {
        continue;
      }
      if (event.type === "run.started" || event.type === "run.probing") {
        handlers.onStarted?.();
      }
      if (event.type === "assistant.delta" && event.text) {
        handlers.onDelta(event.text);
      }
      if (event.type === "assistant.thinking" && event.text) {
        handlers.onThinking?.(event.text);
      }
      if (event.type === "tool.started" && event.toolKey) {
        handlers.onTool?.({ phase: "started", toolKey: event.toolKey, input: event.input });
      }
      if (event.type === "tool.completed" && event.toolKey) {
        handlers.onTool?.({ phase: "completed", toolKey: event.toolKey, output: event.output });
      }
      if (event.type === "run.failed" && event.message) {
        handlers.onFailed?.(event.message);
      }
    }
  }
}

export function ChatComposer({
  threadId,
  onEnsureThread,
  modalities,
  model,
  models,
  onModelChange,
  modelDisabled,
  onUserSend,
  onStarted,
  onDelta,
  onThinking,
  onTool,
  onFailed,
  onComplete,
  thinkingEnabled = true,
  onThinkingChange,
  reasoningEffort = "medium",
  onReasoningEffortChange,
  draft,
  onDraftApplied,
  sessionKey,
}: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<HeldFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  /** The session on screen as of this render, read by a run to know whether it still is. */
  const sessionRef = useRef(sessionKey);
  sessionRef.current = sessionKey;
  const [shownSession, setShownSession] = useState(sessionKey);
  if (shownSession !== sessionKey) {
    // Another session is on screen. Whatever run held Send, and its error, belonged to the last one.
    setShownSession(sessionKey);
    setBusy(false);
    setError(null);
  }

  const pickerModels = models ?? [];
  const showPicker = typeof onModelChange === "function";
  const sendEmpty = !text.trim() && files.length === 0;
  const sendDisabled = busy || enhancing || sendEmpty;

  useEffect(() => {
    if (draft == null) {
      return;
    }
    setText(draft);
    textAreaRef.current?.focus();
    onDraftApplied?.();
  }, [draft, onDraftApplied]);

  useEffect(() => {
    const el = textAreaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "44px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) {
      return;
    }
    const next: HeldFile[] = [...files];
    let tooBig = false;
    let unsupported = false;
    for (const file of Array.from(list)) {
      const kind = classifyAttachment(file);
      if (kind === "unsupported") {
        unsupported = true;
        continue;
      }
      if (attachmentOverCap(kind, file.size)) {
        tooBig = true;
        continue;
      }
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        kind,
      });
    }
    setFiles(next);
    if (tooBig) setError(t("chat.error.fileTooLarge"));
    else if (unsupported) setError(t("chat.error.unsupportedFile"));
    else setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id));
  }

  async function send() {
    // The run belongs to the session on screen now. If the owner opens another before the run
    // reaches the host, nothing is sent and the draft stays in the box; if they open one after, the
    // run streams on to the host — which saves the reply — but writes nothing more into this pane.
    const startedIn = sessionRef.current;
    const showing = () => sessionRef.current === startedIn;
    const typed = text;
    const attached = files;
    let runThread: string | null = null;
    const finish = () => onComplete({ threadId: runThread, showing: showing() });
    const fail = (message: string) => {
      if (showing()) {
        setError(message);
        onFailed?.(message);
      }
    };
    /** Only the draft that was sent is cleared; anything typed or attached since is the owner's. */
    const clearSent = () => {
      setText((current) => (current === typed ? "" : current));
      setFiles((current) => (current === attached ? [] : current));
    };
    const live: RunStreamHandlers = {
      onStarted,
      onDelta,
      onThinking,
      onTool,
      onFailed: (message) => {
        onFailed?.(message);
        setError(message);
      },
    };
    setBusy(true);
    setError(null);
    try {
      const decision = routeDecision(files.map((item) => item.kind));
      if (decision.route === "error") {
        setError(
          decision.message === "Unsupported file type" ? t("chat.error.unsupportedFile") : t("chat.error.mixedMedia"),
        );
        setBusy(false);
        return;
      }

      if (decision.route === "image" && !modalities.includes("image")) {
        setError(t("chat.error.noImageInput"));
        setBusy(false);
        return;
      }
      if (decision.route === "video" && !modalities.includes("video")) {
        setError(t("chat.error.noVideoInput"));
        setBusy(false);
        return;
      }

      const textFiles = files.filter((item) => item.kind === "text");
      const mediaFiles = files.filter((item) => item.kind === "image" || item.kind === "video");

      let composedText = text;
      for (const held of textFiles) {
        const body = await readTextFile(held.file);
        const block = `--- ${held.file.name} ---\n${body}`;
        composedText = composedText.trim().length > 0 ? `${composedText}\n\n${block}` : block;
      }

      const outgoing = composedText.trim();
      if (decision.route === "text" && !outgoing) {
        if (showing()) {
          setError(t("chat.error.emptySend"));
        }
        return;
      }

      const abort = new AbortController();
      const dog = armStreamWatchdog(model ?? "this model", abort, undefined, Date.now, getLocale());
      try {
        if (decision.route === "text") {
          if (!showing()) {
            return; // Moved on before the run reached the host: nothing was sent, the draft stays.
          }
          const id = onEnsureThread ? await onEnsureThread() : threadId;
          if (!id) {
            throw new Error(t("chat.error.start"));
          }
          if (!showing()) {
            return; // Moved on before the run reached the host: nothing was sent, the draft stays.
          }
          runThread = id;
          onUserSend?.({
            text: outgoing,
            parts: outgoing ? [{ type: "text", text: outgoing }] : [],
          });
          const response = await apiFetch(`/api/v1/threads/${id}/runs/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: outgoing,
              model,
              thinking: reasoningEffort !== "none",
              reasoningEffort,
            }),
            signal: abort.signal,
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            fail(payload?.error?.message ?? t("chat.error.runFailed"));
            await finish();
            return;
          }
          clearSent();
          if (!response.body) {
            throw new Error(t("chat.error.noStream"));
          }
          await readRunStream(response.body, live, { onActivity: () => dog.touch(), showing });
          await finish();
          return;
        }

        const uploads: { kind: "image" | "video"; url: string }[] = [];
        for (const held of mediaFiles) {
          const uploaded = await uploadMedia(held.file);
          uploads.push({ kind: held.kind as "image" | "video", url: uploaded.url });
        }

        const caption =
          composedText ||
          (decision.route === "image" ? t("chat.composer.imageCaption") : t("chat.composer.videoCaption"));

        const parts: unknown[] =
          decision.route === "image"
            ? [
                { type: "text", text: caption },
                ...uploads.map((item) => ({
                  type: "image_url",
                  image_url: { url: item.url, detail: "high" },
                })),
              ]
            : [
                { type: "text", text: caption },
                ...uploads.map((item) => ({
                  type: "video_url",
                  video_url: { url: item.url },
                })),
              ];

        if (!showing()) {
          return; // Moved on before the run reached the host: nothing was sent, the draft stays.
        }
        onUserSend?.({ text: caption, parts });

        const id = onEnsureThread ? await onEnsureThread() : threadId;
        if (!id) {
          throw new Error(t("chat.error.start"));
        }
        if (!showing()) {
          return; // Moved on before the run reached the host: nothing was sent, the draft stays.
        }
        runThread = id;

        const response = await apiFetch(`/api/v1/threads/${id}/runs/${decision.route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: parts,
            model,
            thinking: reasoningEffort !== "none",
            reasoningEffort,
          }),
          signal: abort.signal,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          fail(payload?.error?.message ?? t("chat.error.runFailed"));
          await finish();
          return;
        }
        clearSent();
        if (!response.body) {
          throw new Error(t("chat.error.noStream"));
        }
        await readRunStream(response.body, live, { onActivity: () => dog.touch(), showing });
        await finish();
      } finally {
        dog.close();
      }
    } catch (err) {
      fail(abortErrorMessage(err, getLocale()));
      await finish();
    } finally {
      if (showing()) {
        setBusy(false);
      }
    }
  }

  return (
    <form
      className="composer-shell mx-auto mb-6 mt-6 w-full max-w-[var(--composer-max)] rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 pb-3 pt-2"
      data-testid="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div
        className={`rounded-lg border border-dashed px-2 py-1 ${
          dragOver ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]"
        }`}
        data-testid="composer-dropzone"
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragOver(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragOver(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <textarea
          ref={textAreaRef}
          className="min-h-11 max-h-40 w-full resize-none border-0 bg-transparent px-1 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
          style={{ outline: "none" }}
          placeholder={t("chat.composer.placeholder")}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            submitOnEnter(event, () => {
              void send();
            });
          }}
          data-testid="composer-text"
        />
        {/*
          The dropzone used to carry two more instruction lines under the
          textarea — "Drop files or browse…" and the size caps — directly above a
          placeholder that already says the same thing, which is what made the
          box read as three competing prompts. It is one line now, the
          placeholder, and the file types are enforced rather than advertised.
          The size caps still surface when a file is actually refused
          (`composer-error`), so nothing is lost but the noise (owner report
          2026-09-23).
        */}
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          multiple
          accept={COMPOSER_FILE_ACCEPT}
          onChange={(event) => addFiles(event.target.files)}
          data-testid="composer-file"
        />
      </div>
      {files.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2" data-testid="composer-attachments">
          {files.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-1 text-sm text-[var(--text)]"
              data-testid="composer-attachment"
            >
              <span className="max-w-[12rem] truncate">{item.file.name}</span>
              <button
                type="button"
                className="text-[var(--text-3)] hover:text-[var(--text)]"
                aria-label={t("chat.removeAttachment", { name: item.file.name })}
                onClick={() => removeFile(item.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-[var(--danger)]" data-testid="composer-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-end gap-2" data-testid="composer-toolbar">
        <button
          type="button"
          className="btn btn-ghost btn-icon h-8 w-8 shrink-0 wash"
          data-testid="composer-attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          aria-label={t("chat.composer.attach")}
          title={t("chat.composer.attach")}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21.4 11.05 12.25 20.2a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.48-8.49" />
          </svg>
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {showPicker ? (
            <ModelPicker
              models={pickerModels}
              value={model ?? ""}
              onChange={onModelChange}
              disabled={modelDisabled || busy}
              returnFocusRef={textAreaRef}
            />
          ) : null}
          {/*
            One bordered control, like the model picker beside it (owner ruling 2026-09-23).
            The label and the value used to be two framed things — a bordered `label` wrapping
            a bordered `select` — which read as a box inside a box however the padding was
            tuned. It is a single select now, showing just the level ("Normal").
          */}
          {onReasoningEffortChange || onThinkingChange ? (
            <select
              className="h-8 shrink-0 cursor-pointer rounded-lg border border-[var(--line)] bg-transparent pl-2 pr-1 text-xs text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
              data-testid="reasoning-effort"
              aria-label={t("chat.composer.thinkingPrefix")}
              value={reasoningEffort}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value as ReasoningEffort;
                onReasoningEffortChange?.(next);
                onThinkingChange?.(next !== "none");
              }}
            >
              {REASONING_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {t(`chat.thinking.${effort}`)}
                </option>
              ))}
            </select>
          ) : null}
          <EnhancePromptButton
            text={text}
            surface="chat"
            model={model}
            disabled={busy}
            onApply={setText}
            onBusyChange={setEnhancing}
          />
        </div>
        <button
          type="submit"
          className={`wash ml-auto inline-flex h-8 shrink-0 items-center rounded-pill px-4 text-sm ${
            sendDisabled ? "bg-[var(--line)] text-[var(--text-3)]" : "bg-[var(--accent)] text-[var(--bg)]"
          }`}
          disabled={sendDisabled}
          data-testid="composer-send"
        >
          {busy ? t("chat.composer.sending") : t("chat.composer.send")}
        </button>
      </div>
    </form>
  );
}
