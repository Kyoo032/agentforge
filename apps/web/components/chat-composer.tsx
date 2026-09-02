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
  onComplete: () => Promise<void> | void;
  thinkingEnabled?: boolean;
  onThinkingChange?: (enabled: boolean) => void;
};

type HeldFile = {
  id: string;
  file: File;
  kind: AttachmentKind;
};

async function uploadMedia(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.set("file", file);
  const uploaded = await fetch("/api/v1/media", { method: "POST", body: form }).then((res) => res.json());
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
}: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<HeldFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const pickerModels = models ?? [];
  const showPicker = typeof onModelChange === "function";

  async function readSse(response: Response) {
    if (!response.body) {
      throw new Error("No stream");
    }
    const reader = response.body.getReader();
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
        if (event.type === "run.started") {
          onStarted?.();
        }
        if (event.type === "assistant.delta" && event.text) {
          onDelta(event.text);
        }
        if (event.type === "assistant.thinking" && event.text) {
          onThinking?.(event.text);
        }
        if (event.type === "tool.started" && event.toolKey) {
          onTool?.({ phase: "started", toolKey: event.toolKey, input: event.input });
        }
        if (event.type === "tool.completed" && event.toolKey) {
          onTool?.({ phase: "completed", toolKey: event.toolKey, output: event.output });
        }
        if (event.type === "run.failed" && event.message) {
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

      if (decision.route === "text") {
        const id = onEnsureThread ? await onEnsureThread() : threadId;
        if (!id) {
          throw new Error("Could not start a chat");
        }
        onUserSend?.({
          text: outgoing,
          parts: outgoing ? [{ type: "text", text: outgoing }] : [],
        });
        const response = await fetch(`/api/v1/threads/${id}/runs/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: outgoing, model, thinking: thinkingEnabled }),
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
        await readSse(response);
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

      const response = await fetch(`/api/v1/threads/${id}/runs/${decision.route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: parts, model, thinking: thinkingEnabled }),
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
      await readSse(response);
      await onComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Run failed";
      setError(message);
      onFailed?.(message);
      await onComplete();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="sticky bottom-0 mt-6 rounded-xl border border-mist bg-paper p-4"
      data-testid="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <textarea
        ref={textAreaRef}
        className="w-full rounded-lg border border-mist bg-paper px-3 py-2 text-ink"
        placeholder="Message"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
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
              className="flex items-center gap-2 rounded-full border border-mist px-3 py-1 text-sm text-ink"
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
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 flex items-center gap-2">
        {showPicker ? (
          <ModelPicker
            models={pickerModels}
            value={model ?? ""}
            onChange={onModelChange}
            disabled={modelDisabled || busy}
            returnFocusRef={textAreaRef}
          />
        ) : null}
        {onThinkingChange ? (
          <button
            type="button"
            className={`rounded-full border px-3 py-1.5 text-sm ${
              thinkingEnabled ? "border-navy bg-navy text-white" : "border-mist text-ink"
            }`}
            data-testid="thinking-toggle"
            aria-pressed={thinkingEnabled}
            onClick={() => onThinkingChange(!thinkingEnabled)}
            disabled={busy}
          >
            Thinking
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-md border border-mist px-3 py-2 text-sm text-ink"
          data-testid="composer-attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          Attach
        </button>
        <button
          type="submit"
          className="rounded-xl bg-navy px-4 py-2 text-white disabled:opacity-50"
          disabled={busy || (!text.trim() && files.length === 0)}
          data-testid="composer-send"
        >
          {busy ? "Running…" : "Send"}
        </button>
      </div>
    </form>
  );
}
