import { videoCapabilities } from "@agentforge/core/video-capabilities";
import { ModelSelect } from "@/components/model-select";
import { Link } from "@/lib/nav";
import { useEffect, useState } from "react";

type StudioModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
};

const STUB_MODELS: StudioModel[] = [
  { id: "grok-imagine-video", label: "grok-imagine-video", inputModalities: ["text", "image"] },
  { id: "omni-fast-v2v", label: "omni-fast-v2v", inputModalities: ["text"] },
];

type Props = {
  models: StudioModel[];
  needsKey: boolean;
  gatewayName: string;
};

export function EditGenerateTab({ models, needsKey, gatewayName }: Props) {
  const [sub, setSub] = useState<"image" | "video" | "storyboard">("video");
  const catalog = models.length > 0 ? models : STUB_MODELS;
  const [model, setModel] = useState(catalog[0]?.id ?? "");
  const [stillUrl, setStillUrl] = useState("");
  const caps = videoCapabilities(model);
  const imageToVideo = caps.imageToVideo;

  useEffect(() => {
    if (!imageToVideo) {
      setStillUrl("");
    }
  }, [imageToVideo]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 text-sm">
      <div className="flex gap-1">
        <button
          type="button"
          className={`btn px-2 py-1 text-xs ${sub === "image" ? "btn-primary" : "btn-secondary"}`}
          data-testid="edit-generate-image"
          onClick={() => setSub("image")}
        >
          Image
        </button>
        <button
          type="button"
          className={`btn px-2 py-1 text-xs ${sub === "video" ? "btn-primary" : "btn-secondary"}`}
          data-testid="edit-generate-video"
          onClick={() => setSub("video")}
        >
          Video
        </button>
        <button
          type="button"
          className={`btn px-2 py-1 text-xs ${sub === "storyboard" ? "btn-primary" : "btn-secondary"}`}
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
          to generate. Phase 2 will place clips on the timeline.
        </p>
      ) : (
        <p className="text-xs text-ink/50">Generation lands in Phase 2. This tab is a stub.</p>
      )}
      {sub === "video" ? (
        <>
          <ModelSelect
            models={catalog}
            value={model}
            onChange={setModel}
            testId="edit-generate-model"
            className="w-full rounded-md border border-mist bg-paper px-2 py-1 text-xs"
          />
          {imageToVideo ? (
            <input
              type="url"
              className="w-full rounded-md border border-mist bg-transparent px-2 py-1 text-xs"
              placeholder="Still image URL"
              value={stillUrl}
              onChange={(event) => setStillUrl(event.target.value)}
              data-testid="edit-generate-still"
            />
          ) : (
            <p className="text-xs text-ink/50">This model is text-to-video only</p>
          )}
        </>
      ) : null}
    </div>
  );
}
