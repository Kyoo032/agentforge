import { estimateJobUsd, routeEditModel, type PromptTemplate } from "@agentforge/core/edit";
import { formatUsd } from "@agentforge/core/gateway";
import { allowedVideoSeconds, snapVideoSeconds, videoCapabilities } from "@agentforge/core/video-capabilities";
import { EditPromptTemplates } from "@/components/edit-prompt-templates";
import { ModelSelect } from "@/components/model-select";
import { Link } from "@/lib/nav";
import { apiFetch } from "@/lib/api-client";
import type { StillClip } from "@/lib/edit-preview-media";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type StudioModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
};

const STUB_VIDEO: StudioModel[] = [
  { id: "grok-imagine-video", label: "grok-imagine-video", inputModalities: ["text", "image"] },
  { id: "omni-fast-v2v", label: "omni-fast-v2v", inputModalities: ["text"] },
];

const STUB_IMAGE: StudioModel[] = [
  { id: "gpt-image-2", label: "gpt-image-2", inputModalities: ["text", "image"] },
];

const TIERS = ["draft", "standard", "cinematic"] as const;

type Seconds = number;

type Props = {
  project: { id: string; fps?: number } | null;
  playhead?: number;
  /** Image clip under the playhead; offered as the still for "Video from image". */
  stillClip?: StillClip | null;
  models: StudioModel[];
  imageModels?: StudioModel[];
  needsKey: boolean;
  gatewayName: string;
  tier?: string;
  onTierChange?: (tier: string) => void;
  onSubmitted?: () => void;
  onAgentPrompt?: (text: string) => void;
};

export function EditGenerateTab({
  project,
  playhead = 0,
  stillClip = null,
  models,
  imageModels,
  needsKey,
  gatewayName,
  tier: tierProp = "standard",
  onTierChange,
  onSubmitted,
}: Props) {
  const projectId = project?.id;
  const [useClipStill, setUseClipStill] = useState(true);
  const clipStill = useClipStill ? stillClip : null;
  const [sub, setSub] = useState<"image" | "video" | "storyboard">("video");
  const [tier, setTier] = useState<(typeof TIERS)[number]>(
    tierProp === "draft" || tierProp === "cinematic" ? tierProp : "standard",
  );
  const videoCatalog = models.length > 0 ? models : STUB_VIDEO;
  const imageCatalog = imageModels && imageModels.length > 0 ? imageModels : STUB_IMAGE;
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [stillUrl, setStillUrl] = useState("");
  const [seconds, setSeconds] = useState<Seconds>(5);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tierProp === "draft" || tierProp === "standard" || tierProp === "cinematic") {
      setTier(tierProp);
    }
  }, [tierProp]);

  const liveIds = useMemo(
    () => (sub === "image" ? imageCatalog : videoCatalog).map((item) => item.id),
    [imageCatalog, sub, videoCatalog],
  );
  const routed = routeEditModel({
    kind: sub === "image" ? "image" : "video",
    tier,
    liveModelIds: liveIds,
    requireImageToVideo: sub === "video" && (Boolean(clipStill) || Boolean(stillUrl.trim())),
  });
  const activeModel = model || routed || liveIds[0] || "";
  const caps = videoCapabilities(activeModel);
  const imageToVideo = caps.imageToVideo;
  const secondsOptions = allowedVideoSeconds(activeModel);

  useEffect(() => {
    if (!imageToVideo) {
      setStillUrl("");
    }
  }, [imageToVideo]);

  useEffect(() => {
    setSeconds((current) => snapVideoSeconds(activeModel, current));
  }, [activeModel]);

  const estimate = estimateJobUsd(activeModel, {
    seconds: sub === "video" ? seconds : undefined,
    count: 1,
    resolution: "720p",
  });

  function pickTemplate(template: PromptTemplate) {
    setPrompt(template.prompt);
    setSeconds(snapVideoSeconds(activeModel, template.seconds));
    setTemplateId(template.id);
  }

  function changePrompt(next: string) {
    setPrompt(next);
    setTemplateId(null);
  }

  function changeTier(next: (typeof TIERS)[number]) {
    setTier(next);
    onTierChange?.(next);
    setModel("");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!projectId || !prompt.trim() || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/v1/edit/projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: sub === "image" ? "image" : "video",
          prompt: prompt.trim(),
          tier,
          model: activeModel || undefined,
          seconds: sub === "video" ? seconds : undefined,
          imageAssetId: sub === "video" && imageToVideo && clipStill ? clipStill.assetId : undefined,
          imageUrl: sub === "video" && imageToVideo && !clipStill ? stillUrl.trim() || undefined : undefined,
          placeAt: { trackId: "v1", timelineStartFrame: playhead },
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
      if (!response.ok) {
        setError(data.error?.message ?? data.error?.code ?? "Generation failed");
        return;
      }
      setPrompt("");
      setStillUrl("");
      setTemplateId(null);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm" onSubmit={onSubmit} data-testid="edit-generate">
      <div className="flex min-w-0 flex-col gap-1">
        <button
          type="button"
          className={`btn w-full whitespace-nowrap px-2 py-1.5 text-xs ${sub === "image" ? "btn-primary" : "btn-secondary"}`}
          data-testid="edit-generate-image"
          onClick={() => setSub("image")}
        >
          Image
        </button>
        <button
          type="button"
          className={`btn w-full whitespace-nowrap px-2 py-1.5 text-xs ${sub === "video" ? "btn-primary" : "btn-secondary"}`}
          data-testid="edit-generate-video"
          onClick={() => setSub("video")}
        >
          Video from image
        </button>
        <button
          type="button"
          className={`btn w-full whitespace-nowrap px-2 py-1.5 text-xs ${sub === "storyboard" ? "btn-primary" : "btn-secondary"}`}
          data-testid="edit-generate-storyboard"
          onClick={() => setSub("storyboard")}
        >
          Storyboard
        </button>
      </div>
      {needsKey ? (
        <p className="rounded-md border border-mist bg-mist/30 px-2 py-2 text-xs text-ink/70" data-testid="edit-needs-key">
          Add a {gatewayName} gateway key in{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>{" "}
          to generate.
        </p>
      ) : null}
      {sub === "storyboard" ? (
        <p className="text-xs text-ink/50">Storyboard lands in Phase 3.</p>
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-1" data-testid="edit-generate-tier">
            {TIERS.map((id) => (
              <button
                key={id}
                type="button"
                className={`btn w-full px-2 py-1.5 text-[11px] capitalize ${tier === id ? "btn-primary" : "btn-secondary"}`}
                onClick={() => changeTier(id)}
              >
                {id}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-ink/55" data-testid="edit-estimate">
            {estimate == null ? "price unknown" : formatUsd(estimate)}
          </span>
          <ModelSelect
            models={sub === "image" ? imageCatalog : videoCatalog}
            value={activeModel}
            onChange={setModel}
            testId="edit-generate-model"
            className="min-w-0 w-full rounded-md border border-mist bg-paper px-2 py-1 text-xs"
          />
          {sub === "video" ? (
            <select
              className="min-w-0 w-full rounded-md border border-mist bg-paper px-2 py-1 text-xs"
              value={seconds}
              onChange={(event) => setSeconds(Number(event.target.value) as Seconds)}
              data-testid="edit-generate-seconds"
            >
              {secondsOptions.map((value) => (
                <option key={value} value={value}>
                  {value}s
                </option>
              ))}
            </select>
          ) : null}
          {sub === "video" && imageToVideo && stillClip ? (
            <label className="flex items-center gap-2 text-xs" data-testid="edit-generate-still-clip">
              <input type="checkbox" checked={useClipStill} onChange={(event) => setUseClipStill(event.target.checked)} />
              Animate the image clip under the playhead
            </label>
          ) : null}
          {sub === "video" && imageToVideo && !clipStill ? (
            <input
              type="text"
              className="min-w-0 w-full rounded-md border border-mist bg-transparent px-2 py-1 text-xs"
              placeholder={stillClip ? "…or paste a still image URL" : "Still image URL, or move the playhead onto an image clip"}
              value={stillUrl}
              onChange={(event) => setStillUrl(event.target.value)}
              data-testid="edit-generate-still"
            />
          ) : sub === "video" && !imageToVideo ? (
            <p className="text-xs text-ink/50">This model is text-to-video only</p>
          ) : null}
          <textarea
            className="min-h-[72px] min-w-0 w-full rounded-md border border-mist bg-transparent px-2 py-1 text-xs"
            placeholder={sub === "image" ? "Describe an image…" : "Describe a video…"}
            value={prompt}
            onChange={(event) => changePrompt(event.target.value)}
            data-testid="edit-generate-prompt"
          />
          {error ? (
            <p className="text-xs text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="btn btn-primary w-full px-2 py-1.5 text-xs"
            disabled={needsKey || submitting || !prompt.trim() || !projectId}
            data-testid="edit-generate-submit"
          >
            {submitting ? "Generating…" : "Generate"}
          </button>
          {sub === "video" ? <EditPromptTemplates onPick={pickTemplate} selectedId={templateId} /> : null}
        </>
      )}
    </form>
  );
}
