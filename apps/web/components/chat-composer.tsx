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
  onComplete: () => Promise<void> | void;
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

  async function readSse(response: Response, onActivity?: () => void) {
    if (!response.body) {
      throw new Error(t("chat.error.noStream"));
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const types: string[] = [];
    let deltaChars = 0;
    let thinkingChars = 0;
    let failedMessage = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const consumed = consumeSse(buffer);
      buffer = consumed.rest;
      for (const event of consumed.events) {
        onActivity?.();
        types.push(event.type);
        if (event.type === "run.started") {
          onStarted?.();
        }
        if (event.type === "run.probing") {
          onStarted?.();
        }
        if (event.type === "assistant.delta" && event.text) {
          deltaChars += event.text.length;
          onDelta(event.text);
        }
        if (event.type === "assistant.thinking" && event.text) {
          thinkingChars += event.text.length;
          onThinking?.(event.text);
        }
        if (event.type === "tool.started" && event.toolKey) {
          onTool?.({ phase: "started", toolKey: event.toolKey, input: event.input });
        }
        if (event.type === "tool.completed" && event.toolKey) {
          onTool?.({ phase: "completed", toolKey: event.toolKey, output: event.output });
        }
        if (event.type === "run.failed" && event.message) {
          failedMessage = event.message;
          onFailed?.(event.message);
          setError(event.message);
        }
      }
    }
  }

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
        setError(t("chat.error.emptySend"));
        setBusy(false);
        return;
      }

      const abort = new AbortController();
      const dog = armStreamWatchdog(model ?? "this model", abort, undefined, Date.now, getLocale());
      try {
        if (decision.route === "text") {
          const id = onEnsureThread ? await onEnsureThread() : threadId;
          if (!id) {
            throw new Error(t("chat.error.start"));
          }
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
            const payload = await response.json();
            const message = payload.error?.message ?? t("chat.error.runFailed");
            setError(message);
            onFailed?.(message);
            await onComplete();
            return;
          }
          setText("");
          setFiles([]);
          await readSse(response, () => dog.touch());
          await onComplete();
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

        onUserSend?.({ text: caption, parts });

        const id = onEnsureThread ? await onEnsureThread() : threadId;
        if (!id) {
          throw new Error(t("chat.error.start"));
        }

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
          const payload = await response.json();
          const message = payload.error?.message ?? t("chat.error.runFailed");
          setError(message);
          onFailed?.(message);
          await onComplete();
          return;
        }
        setText("");
        setFiles([]);
        await readSse(response, () => dog.touch());
        await onComplete();
      } finally {
        dog.close();
      }
    } catch (err) {
      const message = abortErrorMessage(err, getLocale());
      setError(message);
      onFailed?.(message);
      await onComplete();
    } finally {
      setBusy(false);
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
