"use client";

import { useState } from "react";
import { useRouter } from "@/lib/nav";
import { downloadArtifactFile, saveBlob, sendTextToKnowledgeBase } from "@/lib/artifacts-client";
import { requestModeHandoff, suggestedHandoffPrompt, type HandoffTarget } from "@/lib/mode-handoff";

type Props = {
  title: string;
  markdown: string;
  artifactId: string | null;
  kbType: "Dossier" | "Analysis" | "Brief" | "Memo";
  disabled?: boolean;
  testIdPrefix: string;
};

type Busy = "download" | "kb" | null;

/** Download · Send to Knowledge Base · Make a document · Make a presentation. */
export function ArtifactActions({ title, markdown, artifactId, kbType, disabled = false, testIdPrefix }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<string | null>(null);

  async function onDownload() {
    setBusy("download");
    setNote(null);
    try {
      if (artifactId) {
        await downloadArtifactFile(artifactId);
      } else {
        saveBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${slug(title)}.md`);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not download");
    } finally {
      setBusy(null);
    }
  }

  async function onSendToKb() {
    setBusy("kb");
    setNote(null);
    try {
      const result = await sendTextToKnowledgeBase({ name: title, text: markdown, type: kbType, artifactId });
      if (result.status === "Failed") {
        setNote(`Knowledge Base could not index this: ${result.error ?? "unknown reason"}`);
      } else {
        setNote(result.alreadyIndexed ? "Already in the Knowledge Base." : "Added to the Knowledge Base.");
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not add to the Knowledge Base");
    } finally {
      setBusy(null);
    }
  }

  function onHandoff(target: HandoffTarget) {
    const href = requestModeHandoff({
      target,
      sourceText: markdown,
      prompt: suggestedHandoffPrompt(target, title),
      artifactId: artifactId ?? undefined,
      title,
    });
    router.push(href);
  }

  const locked = disabled || busy !== null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`${testIdPrefix}-actions`}>
      <button
        type="button"
        className={PRIMARY}
        onClick={() => void onDownload()}
        disabled={locked}
        data-testid={`${testIdPrefix}-download`}
      >
        {busy === "download" ? "Saving…" : "Download Markdown"}
      </button>
      <button
        type="button"
        className={SECONDARY}
        onClick={() => void onSendToKb()}
        disabled={locked}
        data-testid={`${testIdPrefix}-send-kb`}
      >
        {busy === "kb" ? "Adding…" : "Send to Knowledge Base"}
      </button>
      <button
        type="button"
        className={SECONDARY}
        onClick={() => onHandoff("documents")}
        disabled={locked}
        data-testid={`${testIdPrefix}-make-document`}
      >
        Make a document
      </button>
      <button
        type="button"
        className={SECONDARY}
        onClick={() => onHandoff("presentations")}
        disabled={locked}
        data-testid={`${testIdPrefix}-make-presentation`}
      >
        Make a presentation
      </button>
      {note ? (
        <span className="text-xs text-[var(--text-2)]" data-testid={`${testIdPrefix}-actions-note`} role="status">
          {note}
        </span>
      ) : null}
    </div>
  );
}

const PRIMARY =
  "wash inline-flex h-8 items-center rounded-pill bg-[var(--accent)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-45";
const SECONDARY =
  "wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-transparent px-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--accent-soft)] disabled:opacity-45";

function slug(title: string): string {
  return (
    title
      .replace(/[^\w\s-]+/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 60)
      .toLowerCase() || "artifact"
  );
}
