import type { Clip, EditProject } from "@agentforge/core/edit";
import type { EditJob } from "@/lib/edit-client";
import { jobForClip, timelineEndFrame } from "@/lib/edit-client";
import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

type Props = {
  project: EditProject | null;
  playhead: number;
  selectedClipId: string | null;
  lockedClipIds: string[];
  jobs: EditJob[];
  onPlayhead: (frame: number) => void;
  onSelect: (clipId: string | null) => void;
  onMove: (clipId: string, trackId: string, timelineStartFrame: number) => void;
  onTrim: (clipId: string, inFrame: number | undefined, durationFrames: number) => void;
};

const MIN_PX = 4;

export function EditTimeline({
  project,
  playhead,
  selectedClipId,
  lockedClipIds,
  jobs,
  onPlayhead,
  onSelect,
  onMove,
  onTrim,
}: Props) {
  const [zoom, setZoom] = useState(4);
  const px = Math.max(0.4, zoom);
  const fps = project?.fps ?? 30;
  const end = project ? timelineEndFrame(project) : fps * 10;
  const width = Math.max(640, end * px);
  const locked = new Set(lockedClipIds);
  const [drafts, setDrafts] = useState<Record<string, Partial<Clip>>>({});
  const drag = useRef<{
    clipId: string;
    mode: "move" | "trim-in" | "trim-out";
    startX: number;
    startFrame: number;
    inFrame: number;
    duration: number;
    trackId: string;
  } | null>(null);

  function frameFromClientX(clientX: number, target: HTMLElement): number {
    const rect = target.getBoundingClientRect();
    const x = clientX - rect.left + target.scrollLeft;
    return Math.max(0, Math.round(x / px));
  }

  function onTrackClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (drag.current) {
      return;
    }
    onPlayhead(frameFromClientX(event.clientX, event.currentTarget));
  }

  function beginDrag(event: ReactMouseEvent, clip: Clip, mode: "move" | "trim-in" | "trim-out") {
    event.stopPropagation();
    event.preventDefault();
    if (locked.has(clip.id)) {
      return;
    }
    onSelect(clip.id);
    drag.current = {
      clipId: clip.id,
      mode,
      startX: event.clientX,
      startFrame: clip.timelineStartFrame,
      inFrame: clip.source?.inFrame ?? 0,
      duration: clip.durationFrames,
      trackId: clip.trackId,
    };
    const onMoveMove = (moveEvent: globalThis.MouseEvent) => {
      const current = drag.current;
      if (!current) {
        return;
      }
      const delta = Math.round((moveEvent.clientX - current.startX) / px);
      if (current.mode === "move") {
        setDrafts((prev) => ({
          ...prev,
          [current.clipId]: { timelineStartFrame: Math.max(0, current.startFrame + delta) },
        }));
        return;
      }
      if (current.mode === "trim-in") {
        const shift = Math.min(current.duration - 1, Math.max(-current.inFrame, delta));
        const nextDuration = current.duration - shift;
        if (nextDuration < 1) {
          return;
        }
        setDrafts((prev) => ({
          ...prev,
          [current.clipId]: {
            timelineStartFrame: Math.max(0, current.startFrame + shift),
            durationFrames: nextDuration,
            source: { assetId: clip.source?.assetId ?? "", inFrame: current.inFrame + shift },
          },
        }));
        return;
      }
      setDrafts((prev) => ({
        ...prev,
        [current.clipId]: { durationFrames: Math.max(1, current.duration + delta) },
      }));
    };
    const onUp = () => {
      const current = drag.current;
      drag.current = null;
      window.removeEventListener("mousemove", onMoveMove);
      window.removeEventListener("mouseup", onUp);
      if (!current) {
        return;
      }
      setDrafts((prev) => {
        const draft = prev[current.clipId];
        if (draft) {
          if (current.mode === "move" && typeof draft.timelineStartFrame === "number") {
            onMove(current.clipId, current.trackId, draft.timelineStartFrame);
          } else if (current.mode === "trim-in") {
            onMove(current.clipId, current.trackId, draft.timelineStartFrame ?? current.startFrame);
            onTrim(current.clipId, draft.source?.inFrame, draft.durationFrames ?? current.duration);
          } else if (typeof draft.durationFrames === "number") {
            onTrim(current.clipId, undefined, draft.durationFrames);
          }
        }
        const next = { ...prev };
        delete next[current.clipId];
        return next;
      });
    };
    window.addEventListener("mousemove", onMoveMove);
    window.addEventListener("mouseup", onUp);
  }

  const tracks = project?.tracks ?? [
    { id: "v1", kind: "video" as const, name: "V1" },
    { id: "a1", kind: "audio" as const, name: "A1" },
    { id: "c1", kind: "caption" as const, name: "C1" },
  ];

  return (
    <section className="shrink-0 border-t border-divider bg-paper" data-testid="edit-timeline">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-divider px-3 py-1.5 text-xs text-ink/60">
        <label className="flex shrink-0 items-center gap-2">
          Zoom
          <input
            type="range"
            min={1}
            max={16}
            step={0.5}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            data-testid="edit-zoom"
          />
        </label>
        <span className="whitespace-nowrap">snap: frame · S split · Del delete</span>
      </div>
      <div className="relative overflow-x-auto" onClick={onTrackClick}>
        <div className="relative min-h-[132px]" style={{ width }}>
          <div
            className="pointer-events-none absolute top-0 z-10 h-full w-px bg-accent"
            style={{ left: playhead * px }}
            data-testid="edit-playhead"
          />
          {tracks.map((track) => (
            <div
              key={track.id}
              className="relative h-11 border-b border-divider"
              data-testid={`edit-track-${track.id}`}
            >
              <span className="sticky left-0 z-[1] inline-block w-8 bg-paper px-1 text-[12px] uppercase text-ink/50">
                {track.id}
              </span>
              {(project?.clips ?? [])
                .filter((clip) => clip.trackId === track.id)
                .map((raw) => {
                  const clip = { ...raw, ...drafts[raw.id] };
                  const pending = clip.status === "pending";
                  const job = jobForClip(jobs, clip.id, clip.jobId);
                  const progress = job?.progress ?? 0;
                  const selected = selectedClipId === clip.id;
                  const dim = locked.has(clip.id);
                  return (
                    <div
                      key={clip.id}
                      className={`absolute top-1.5 h-8 rounded-sm border text-[12px] ${
                        pending ? "edit-placeholder-shimmer border-accent/40" : "border-mist bg-accent/20"
                      } ${selected ? "ring-1 ring-accent" : ""} ${dim ? "opacity-40" : ""}`}
                      style={{
                        left: clip.timelineStartFrame * px,
                        width: Math.max(MIN_PX, clip.durationFrames * px),
                      }}
                      data-testid={pending ? "edit-placeholder" : "edit-clip"}
                      onMouseDown={(event) => beginDrag(event, clip, "move")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(clip.id);
                      }}
                    >
                      <button
                        type="button"
                        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                        aria-label="Trim start"
                        onMouseDown={(event) => beginDrag(event, clip, "trim-in")}
                      />
                      <span className="block truncate px-2 py-1">
                        {pending ? `pending ${Math.round(progress * 100)}%` : clip.id.slice(0, 8)}
                        {clip.badge ? " ·" : ""}
                      </span>
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                        aria-label="Trim end"
                        onMouseDown={(event) => beginDrag(event, clip, "trim-out")}
                      />
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
