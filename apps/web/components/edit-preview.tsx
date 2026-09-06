import { DEFAULT_CAPTION_STYLE, formatTimecode, layoutTitle, type Clip, type EditProject, type TitleStyle } from "@agentforge/core/edit";
import { mediaSrc } from "@/lib/api-client";
import { timelineEndFrame } from "@/lib/edit-client";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";

type Props = {
  project: EditProject | null;
  playhead: number;
  playing: boolean;
  onPlayhead: (frame: number) => void;
  onPlaying: (playing: boolean) => void;
  onScrubBucket: (seconds: number) => void;
};

function hex8ToCss(hex8: string): string {
  const raw = hex8.startsWith("#") ? hex8.slice(1) : hex8;
  if (raw.length < 8) {
    return hex8;
  }
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  const a = Number.parseInt(raw.slice(6, 8), 16) / 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function clipAtPlayhead(project: EditProject, playhead: number, kind: "video" | "caption"): Clip | undefined {
  return project.clips.find(
    (clip) =>
      project.tracks.find((track) => track.id === clip.trackId)?.kind === kind &&
      playhead >= clip.timelineStartFrame &&
      playhead < clip.timelineStartFrame + clip.durationFrames,
  );
}

function assetUrl(project: EditProject, clip: Clip | undefined): string | null {
  if (!clip) {
    return null;
  }
  const assetId = clip.source?.assetId ?? clip.fallbackAssetId;
  if (!assetId) {
    return null;
  }
  const asset = project.assets[assetId];
  if (!asset?.mediaId) {
    return null;
  }
  return mediaSrc(`/api/v1/media/${asset.mediaId}/file`);
}

function overlayStyle(style: TitleStyle, canvas: { width: number; height: number }, scale: number): CSSProperties {
  const layout = layoutTitle(style, canvas);
  const tx = layout.textAlign === "center" ? "-50%" : layout.textAlign === "right" ? "-100%" : "0";
  const ty = layout.verticalAlign === "middle" ? "-50%" : layout.verticalAlign === "bottom" ? "-100%" : "0";
  return {
    position: "absolute",
    left: layout.x * scale,
    top: layout.y * scale,
    maxWidth: layout.maxWidth * scale,
    transform: `translate(${tx}, ${ty})`,
    fontFamily: style.fontFamily,
    fontSize: style.fontSizePx * scale,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    color: hex8ToCss(style.primaryColor),
    WebkitTextStroke: style.outlinePx > 0 ? `${style.outlinePx * scale}px ${hex8ToCss(style.outlineColor)}` : undefined,
    paintOrder: "stroke fill",
    textShadow: style.shadowPx > 0 ? `${style.shadowPx * scale}px ${style.shadowPx * scale}px 0 rgba(0,0,0,0.6)` : undefined,
    background: style.box ? hex8ToCss(style.box.color) : undefined,
    padding: style.box ? 4 * scale : undefined,
    textAlign: layout.textAlign,
    whiteSpace: "pre-wrap",
    pointerEvents: "none",
  };
}

export function EditPreview({ project, playhead, playing, onPlayhead, onPlaying, onScrubBucket }: Props) {
  const fps = project?.fps ?? 30;
  const width = project?.width ?? 1920;
  const height = project?.height ?? 1080;
  const end = project ? timelineEndFrame(project) : fps * 10;
  const active = project ? clipAtPlayhead(project, playhead, "video") : undefined;
  const nextClip = useMemo(() => {
    if (!project || !active) {
      return undefined;
    }
    const endFrame = active.timelineStartFrame + active.durationFrames;
    return project.clips
      .filter((clip) => {
        const kind = project.tracks.find((track) => track.id === clip.trackId)?.kind;
        return kind === "video" && clip.timelineStartFrame >= endFrame;
      })
      .sort((a, b) => a.timelineStartFrame - b.timelineStartFrame)[0];
  }, [project, active]);
  const primaryRef = useRef<HTMLVideoElement>(null);
  const bufferRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const url = project ? assetUrl(project, active) : null;
  const nextUrl = project ? assetUrl(project, nextClip) : null;
  const aspect = `${width} / ${height}`;

  useEffect(() => {
    const video = primaryRef.current;
    if (!video || !active || !project) {
      return;
    }
    const local = playhead - active.timelineStartFrame + (active.source?.inFrame ?? 0);
    const seconds = local / fps;
    if (Math.abs(video.currentTime - seconds) > 1 / fps) {
      video.currentTime = Math.max(0, seconds);
    }
    if (playing) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [active, fps, playhead, playing, project, url]);

  useEffect(() => {
    const video = bufferRef.current;
    if (!video || !nextClip) {
      return;
    }
    video.currentTime = (nextClip.source?.inFrame ?? 0) / fps;
  }, [fps, nextClip, nextUrl]);

  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  useEffect(() => {
    if (!playing) {
      return;
    }
    const started = performance.now();
    const startFrame = playheadRef.current;
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = (now - started) / 1000;
      const frame = Math.min(end, startFrame + Math.round(elapsed * fps));
      onPlayhead(frame);
      onScrubBucket(frame / fps);
      if (frame >= end) {
        onPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [end, fps, onPlayhead, onPlaying, onScrubBucket, playing]);

  const stageWidth = stageRef.current?.clientWidth ?? 640;
  const scale = stageWidth / width;
  const titleClip = project ? clipAtPlayhead(project, playhead, "video") : undefined;
  const captionClip = project
    ? project.clips.find(
        (clip) =>
          project.tracks.find((track) => track.id === clip.trackId)?.kind === "caption" &&
          playhead >= clip.timelineStartFrame &&
          playhead < clip.timelineStartFrame + clip.durationFrames,
      )
    : undefined;
  const titleOnVideo = titleClip?.title;

  function step(delta: number) {
    onPlaying(false);
    onPlayhead(Math.max(0, Math.min(end, playhead + delta)));
  }

  function onScrub(value: number) {
    onPlaying(false);
    const frame = Math.round(value);
    onPlayhead(frame);
    onScrubBucket(frame / fps);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)]" data-testid="edit-preview">
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <div
          ref={stageRef}
          className="relative max-h-full w-full overflow-hidden bg-black"
          style={{ aspectRatio: aspect, maxWidth: "100%" }}
        >
          <video
            ref={primaryRef}
            className="absolute inset-0 h-full w-full object-contain"
            src={url ?? undefined}
            muted
            playsInline
          />
          <video
            ref={bufferRef}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-0"
            src={nextUrl ?? undefined}
            muted
            playsInline
            aria-hidden="true"
          />
          {titleOnVideo && project ? (
            <div data-testid="edit-title-overlay" style={overlayStyle(titleOnVideo.style, { width, height }, scale)}>
              {titleOnVideo.text}
            </div>
          ) : null}
          {captionClip?.caption && project ? (
            <div
              data-testid="edit-caption-overlay"
              style={overlayStyle(DEFAULT_CAPTION_STYLE, { width, height }, scale)}
            >
              {captionClip.caption.text}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-divider px-3 py-2">
        <button
          type="button"
          className="btn btn-secondary px-3 py-1 text-sm"
          data-testid="edit-play"
          onClick={() => onPlaying(!playing)}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => step(-1)} aria-label="Previous frame">
          {"<"}
        </button>
        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => step(1)} aria-label="Next frame">
          {">"}
        </button>
        <span className="font-mono text-xs text-ink/70" data-testid="edit-time">
          {formatTimecode(playhead, fps)} / {formatTimecode(end, fps)}
        </span>
        <input
          type="range"
          className="min-w-0 flex-1"
          min={0}
          max={end}
          value={playhead}
          onChange={(event) => onScrub(Number(event.target.value))}
          aria-label="Scrub"
        />
      </div>
    </section>
  );
}
