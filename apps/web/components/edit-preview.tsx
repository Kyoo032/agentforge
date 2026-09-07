import { DEFAULT_CAPTION_STYLE, formatTimecode, layoutTitle, type Clip, type EditProject, type TitleStyle } from "@agentforge/core/edit";
import { mediaSrc } from "@/lib/api-client";
import { timelineEndFrame } from "@/lib/edit-client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

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
  const frameRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const url = project ? assetUrl(project, active) : null;
  const nextUrl = project ? assetUrl(project, nextClip) : null;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    const measure = (cw: number, ch: number) => {
      if (cw <= 0 || ch <= 0 || width <= 0 || height <= 0) {
        return;
      }
      let nextW = cw;
      let nextH = Math.round((nextW * height) / width);
      if (nextH > ch) {
        nextH = ch;
        nextW = Math.round((nextH * width) / height);
      }
      setFit((prev) => (prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH }));
    };
    measure(frame.clientWidth, frame.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) {
        measure(box.width, box.height);
      }
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [height, width]);

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

  const scale = fit.w > 0 ? fit.w / width : 0;
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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)]" data-testid="edit-preview">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden p-3">
        <div ref={frameRef} className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
        <div
          className="relative shrink-0 overflow-hidden bg-black"
          style={{
            width: fit.w > 0 ? fit.w : "100%",
            maxWidth: "100%",
            maxHeight: "100%",
            aspectRatio: `${width} / ${height}`,
          }}
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
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-divider px-3 py-2">
        <button
          type="button"
          className="btn btn-secondary shrink-0 px-3 py-1 text-sm"
          data-testid="edit-play"
          onClick={() => onPlaying(!playing)}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="btn btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => step(-1)} aria-label="Previous frame">
          {"<"}
        </button>
        <button type="button" className="btn btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => step(1)} aria-label="Next frame">
          {">"}
        </button>
        <span className="shrink-0 font-mono text-xs text-ink/70" data-testid="edit-time">
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
