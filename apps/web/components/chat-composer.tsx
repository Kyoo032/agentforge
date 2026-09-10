"use client";

import { useRef, useState } from "react";
import { consumeSse } from "@/lib/sse-client";
import {
  COMPOSER_FILE_ACCEPT,
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
    throw new Error(uploaded.error.message ?? "Upload failed");
  }
  if (typeof uploaded.url !== "string") {
    throw new Error("Upload failed");
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
}: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<HeldFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const pickerModels = models ?? [];
  const showPicker = typeof onModelChange === "function";

  async function readSse(response: Response, onActivity?: () => void) {
    if (!response.body) {
      throw new Error("No stream");
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
    for (const file of Array.from(list)) {
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        kind: classifyAttachment(file),
      });
    }
    setFiles(next);
    setError(null);
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
        setError(decision.message);
        setBusy(false);
        return;
      }

      if (decision.route === "image" && !modalities.includes("image")) {
        setError("This agent or model does not accept image input");
        setBusy(false);
        return;
      }
      if (decision.route === "video" && !modalities.includes("video")) {
        setError("This agent or model does not accept video input");
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
        setError("Type a message or attach a file");
        setBusy(false);
        return;
      }

      const abort = new AbortController();
      const dog = armStreamWatchdog(model ?? "this model", abort);
      try {
        if (decision.route === "text") {
        const id = onEnsureThread ? await onEnsureThread() : threadId;
        if (!id) {
          throw new Error("Could not start a chat");
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
          const message = payload.error?.message ?? "Run failed";
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
        (decision.route === "image" ? "What is in this image?" : "Summarize this video.");

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
        throw new Error("Could not start a chat");
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
        const message = payload.error?.message ?? "Run failed";
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
      const message = abortErrorMessage(err);
      setError(message);
      onFailed?.(message);
      await onComplete();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="blueprint sticky bottom-0 mt-6 bg-app p-4"
      data-testid="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <textarea
        ref={textAreaRef}
        className="input w-full"
        placeholder="Message"
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
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        multiple
        accept={COMPOSER_FILE_ACCEPT}
        onChange={(event) => addFiles(event.target.files)}
        data-testid="composer-file"
      />
      {files.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2" data-testid="composer-attachments">
          {files.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-md border border-mist px-3 py-1 text-sm text-ink"
              data-testid="composer-attachment"
            >
              <span className="max-w-[12rem] truncate">{item.file.name}</span>
              <button
                type="button"
                className="text-ink/50 hover:text-ink"
                aria-label={`Remove ${item.file.name}`}
                onClick={() => removeFile(item.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-700" data-testid="composer-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="composer-toolbar">
        {showPicker ? (
          <ModelPicker
            models={pickerModels}
            value={model ?? ""}
            onChange={onModelChange}
            disabled={modelDisabled || busy}
            returnFocusRef={textAreaRef}
          />
        ) : null}
        {onReasoningEffortChange || onThinkingChange ? (
          <label className="inline-flex items-center" data-testid="thinking-toggle">
            <span className="sr-only">Reasoning effort</span>
            <select
              className={`rounded-md border bg-transparent px-2 py-1.5 text-[12.5px] text-ink disabled:opacity-45 ${
                reasoningEffort !== "none" ? "border-accent text-accent" : "border-divider"
              }`}
              data-testid="reasoning-effort"
              aria-label="Reasoning effort"
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
                  {effort === "medium" ? "Med" : effort[0].toUpperCase() + effort.slice(1)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="composer-attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          Attach
        </button>
        <EnhancePromptButton
          text={text}
          surface="chat"
          model={model}
          disabled={busy}
          onApply={setText}
          onBusyChange={setEnhancing}
        />
        <button
          type="submit"
          className="btn btn-primary ml-auto"
          disabled={busy || enhancing || (!text.trim() && files.length === 0)}
          data-testid="composer-send"
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
